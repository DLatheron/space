import { axialDirectionTowards } from "@space/maths";
import {
    addResources,
    buildItemCost,
    buildItemTurns,
    canBuild,
    countQueuedShips,
    incomeFor,
    SHIP_TYPES,
    shipCapFor,
    STARTING_STOCKPILE,
    subtractResources,
    zeroResources,
    type BuildItem,
    type EconomyState,
    type EntityId,
    type PlanetEconomy,
    type Resources,
    type ShipType,
    type SideId
} from "@space/shared-data";
import { hasEnemyShips } from "./Battle.js";
import type { EntityManager } from "./EntityManager.js";
import type { EntityOf } from "./map/types.js";

export type EconomyResult = { ok: true } | { ok: false; error: string };

export type BuildResult =
    { ok: true; completed: boolean; spawnedShip?: EntityOf<"ship"> } | { ok: false; error: string };

export type EconomyOptions = {
    /** Builds complete as soon as they are ordered instead of being queued. */
    instantBuild?: boolean;
};

export type ColoniseResult =
    | { ok: true; planet: EntityOf<"planet">; consumedShipId: EntityId }
    | { ok: false; error: string };

export type CompletedBuild = { sideId: SideId; planetId: EntityId; item: BuildItem };

export type EconomyAdvance = {
    completed: CompletedBuild[];
    spawnedShips: EntityOf<"ship">[];
};

type SideEconomy = {
    stockpile: Resources;
    lastIncome: Resources;
};

type PlanetRecord = Pick<PlanetEconomy, "structures" | "queue">;

/**
 * Per-side stockpiles plus each owned planet's structures and FIFO build queue.
 * Planet level and ownership live on the planet entity; this only holds private state.
 */
export class EconomyManager {
    private readonly _entities: EntityManager;
    private readonly _sides = new Map<SideId, SideEconomy>();
    private readonly _planets = new Map<EntityId, PlanetRecord>();
    private readonly _instantBuild: boolean;
    private _nextShipSeq = 1;

    constructor(entities: EntityManager, sideIds: Iterable<SideId>, options: EconomyOptions = {}) {
        this._entities = entities;
        this._instantBuild = options.instantBuild ?? false;
        for (const sideId of sideIds) {
            this._sides.set(sideId, {
                stockpile: { ...STARTING_STOCKPILE },
                lastIncome: zeroResources()
            });
        }
    }

    stockpile(sideId: SideId): Resources {
        return { ...this._side(sideId).stockpile };
    }

    ownedPlanets(sideId: SideId): EntityOf<"planet">[] {
        return this._entities.ofKind("planet").filter((planet) => planet.sideId === sideId);
    }

    planetEconomy(planetId: EntityId): PlanetEconomy | undefined {
        const planet = this._entities.getOfKind(planetId, "planet");
        if (!planet?.sideId) return undefined;
        return this._view(planet);
    }

    /** Built ships plus ships queued on any owned planet. */
    shipCount(sideId: SideId): number {
        const built = this._entities.ofKind("ship").filter((s) => s.sideId === sideId).length;
        return built + countQueuedShips(this._economies(sideId));
    }

    shipCap(sideId: SideId): number {
        return shipCapFor(this._economies(sideId));
    }

    stateFor(sideId: SideId): EconomyState {
        const side = this._side(sideId);
        const planets = this._economies(sideId);
        return {
            stockpile: { ...side.stockpile },
            lastIncome: { ...side.lastIncome },
            shipCount: this.shipCount(sideId),
            shipCap: shipCapFor(planets),
            planets
        };
    }

    /**
     * Validate and queue `item` on an owned planet, paying the full cost now.
     * With `instantBuild` the item completes immediately; a ship still queues
     * if enemy ships occupy the planet's hex.
     */
    build(sideId: SideId | null, planetId: EntityId, item: BuildItem): BuildResult {
        const owned = this._ownedPlanet(sideId, planetId);
        if (!owned.ok) return owned;
        const { planet, side } = owned;

        const check = canBuild(
            {
                stockpile: side.stockpile,
                shipCount: this.shipCount(planet.sideId!),
                shipCap: this.shipCap(planet.sideId!)
            },
            this._view(planet),
            item
        );
        if (!check.ok) return { ok: false, error: check.reason };

        side.stockpile = subtractResources(side.stockpile, buildItemCost(item));
        const record = this._record(planet.id);

        if (this._instantBuild) {
            if (item.kind === "structure") {
                record.structures.push(item.structureType);
                return { ok: true, completed: true };
            }
            if (!hasEnemyShips(this._entities, planet, planet.sideId!)) {
                const spawnedShip = this._spawnShip(planet, planet.sideId!, item.shipType);
                return { ok: true, completed: true, spawnedShip };
            }
        }

        const turns = buildItemTurns(item);
        record.queue.push({ item, turnsRemaining: turns, totalTurns: turns });
        return { ok: true, completed: false };
    }

    /** Remove queue entry `index` from an owned planet and refund its full cost. */
    cancel(sideId: SideId | null, planetId: EntityId, index: number): EconomyResult {
        const owned = this._ownedPlanet(sideId, planetId);
        if (!owned.ok) return owned;
        const { planet, side } = owned;

        const queue = this._record(planet.id).queue;
        const entry = queue[index];
        if (!entry) return { ok: false, error: `No queue entry ${index} on ${planetId}` };

        queue.splice(index, 1);
        side.stockpile = addResources(side.stockpile, buildItemCost(entry.item));
        return { ok: true };
    }

    /** Consume a colonising ship on an unowned planet's hex to claim the planet. */
    colonise(sideId: SideId | null, planetId: EntityId, shipId: EntityId): ColoniseResult {
        if (!sideId || !this._sides.has(sideId)) {
            return { ok: false, error: "You are not assigned to a side" };
        }
        const planet = this._entities.getOfKind(planetId, "planet");
        if (!planet) return { ok: false, error: `Unknown planet ${planetId}` };
        const ship = this._entities.getOfKind(shipId, "ship");
        if (!ship) return { ok: false, error: `Unknown ship ${shipId}` };
        if (ship.sideId !== sideId) return { ok: false, error: `Ship ${shipId} is not yours` };
        if (!SHIP_TYPES[ship.shipType].canColonise) {
            return { ok: false, error: `${SHIP_TYPES[ship.shipType].name} cannot colonise` };
        }
        if (ship.q !== planet.q || ship.r !== planet.r) {
            return { ok: false, error: "Ship is not at the planet" };
        }
        if (planet.sideId !== null) return { ok: false, error: "Planet is already owned" };
        if (hasEnemyShips(this._entities, planet, sideId)) {
            return { ok: false, error: "Enemy ships are at the planet" };
        }

        this._entities.remove(ship.id);
        planet.sideId = sideId;
        this._planets.set(planet.id, { structures: [], queue: [] });
        return { ok: true, planet, consumedShipId: ship.id };
    }

    /**
     * End-of-turn economy for every side: add income, progress the head of each
     * planet's queue by one turn, then complete finished items. A finished ship
     * spawns on its planet's hex with full MP; it waits (at 0 turns) while enemy
     * ships occupy that hex.
     */
    advanceTurn(): EconomyAdvance {
        const result: EconomyAdvance = { completed: [], spawnedShips: [] };
        for (const [sideId, side] of this._sides) {
            const income = incomeFor(this._economies(sideId));
            side.lastIncome = income;
            side.stockpile = addResources(side.stockpile, income);

            for (const planet of this.ownedPlanets(sideId)) {
                const record = this._record(planet.id);
                const head = record.queue[0];
                if (!head) continue;
                head.turnsRemaining = Math.max(0, head.turnsRemaining - 1);
                if (head.turnsRemaining > 0) continue;

                if (head.item.kind === "structure") {
                    record.structures.push(head.item.structureType);
                } else {
                    if (hasEnemyShips(this._entities, planet, sideId)) continue;
                    result.spawnedShips.push(this._spawnShip(planet, sideId, head.item.shipType));
                }
                record.queue.shift();
                result.completed.push({ sideId, planetId: planet.id, item: head.item });
            }
        }
        return result;
    }

    private _spawnShip(
        planet: EntityOf<"planet">,
        sideId: SideId,
        shipType: ShipType
    ): EntityOf<"ship"> {
        const template = SHIP_TYPES[shipType];
        let id: EntityId;
        do {
            id = `ship-built-${this._nextShipSeq++}`;
        } while (this._entities.get(id));

        const number =
            this._entities
                .ofKind("ship")
                .filter((s) => s.sideId === sideId && s.shipType === shipType).length + 1;
        const sun = this._entities
            .ofKind("sun")
            .find((s) => s.systemId === planet.systemId && (s.q !== planet.q || s.r !== planet.r));

        return this._entities.add<EntityOf<"ship">>({
            id,
            kind: "ship",
            shipType,
            name: `${template.name} ${number}`,
            q: planet.q,
            r: planet.r,
            facing: sun ? axialDirectionTowards(sun, planet) : 0,
            sideId,
            movementPoints: template.maxMovementPoints,
            maxMovementPoints: template.maxMovementPoints,
            hp: template.hp,
            scale: template.scale
        });
    }

    private _side(sideId: SideId): SideEconomy {
        const side = this._sides.get(sideId);
        if (!side) throw new Error(`Unknown side ${sideId}`);
        return side;
    }

    private _ownedPlanet(
        sideId: SideId | null,
        planetId: EntityId
    ): { ok: true; planet: EntityOf<"planet">; side: SideEconomy } | { ok: false; error: string } {
        const side = sideId ? this._sides.get(sideId) : undefined;
        if (!side) return { ok: false, error: "You are not assigned to a side" };
        const planet = this._entities.getOfKind(planetId, "planet");
        if (!planet) return { ok: false, error: `Unknown planet ${planetId}` };
        if (planet.sideId !== sideId)
            return { ok: false, error: `Planet ${planetId} is not yours` };
        return { ok: true, planet, side };
    }

    private _record(planetId: EntityId): PlanetRecord {
        let record = this._planets.get(planetId);
        if (!record) {
            record = { structures: [], queue: [] };
            this._planets.set(planetId, record);
        }
        return record;
    }

    /** Detached snapshot of an owned planet's economy. */
    private _view(planet: EntityOf<"planet">): PlanetEconomy {
        const record = this._record(planet.id);
        return {
            planetId: planet.id,
            level: planet.level,
            structures: [...record.structures],
            queue: record.queue.map((entry) => ({ ...entry, item: { ...entry.item } }))
        };
    }

    private _economies(sideId: SideId): PlanetEconomy[] {
        return this.ownedPlanets(sideId).map((planet) => this._view(planet));
    }
}
