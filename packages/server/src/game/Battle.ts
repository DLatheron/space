import { axialDirectionTowards } from "@space/maths";
import {
    hexHasObstacle,
    MOVE_COST_PER_HEX,
    platformStats,
    ringHexes,
    spaceStructureStats,
    type AxialCoord,
    type CombatCause,
    type CombatOutcome,
    type CombatResult,
    type EconomyBalance,
    type EntityId,
    type Installation,
    type LocationEntity,
    type ShipMoveOrder,
    type SideId
} from "@space/shared-data";
import { defaultEconomyBalance } from "../config/config.schema.js";
import {
    isAlive,
    platformFighter,
    shipFighter,
    spaceExchange,
    structureFighter,
    supplyFighter,
    toParticipant,
    type Fighter
} from "./combat.js";
import { destroySpaceStructures, destroyVessels, type Vessel } from "./destroyShips.js";
import type { EconomyManager } from "./EconomyManager.js";
import type { EntityManager } from "./EntityManager.js";
import { isLocationEntity } from "./GroundUnits.js";
import { findTileByAxial } from "./map/SpaceMap.js";
import type { EntityOf } from "./map/types.js";
import {
    applyShipMove,
    moveFromSteps,
    planShipRoute,
    stepAlongRoute,
    type MovePlanOptions,
    type MoveValidation
} from "./moveShip.js";

export type BattleMoveResult =
    | {
          ok: true;
          /**
           * Steps taken before any combat; null when the ship didn't move (no MP, or the
           * first hex on its path held enemies).
           */
          move: Extract<MoveValidation, { ok: true }> | null;
          /** Combat fought at the first hex on the path holding enemy vessels, if any. */
          combat: CombatResult | null;
          /** Order left for the rest of the route, if the destination wasn't reached. */
          moveOrder: ShipMoveOrder | null;
      }
    | { ok: false; error: string };

export type BattleOptions = {
    /** Defaults to the economy's balance, else the config defaults. */
    balance?: EconomyBalance;
    /** Random numbers in [0, 1) for evasion and damage rolls; defaults to `Math.random`. */
    rng?: () => number;
    /**
     * Turn combat counts against, recorded as `lastCombatTurn` on every participant (see
     * `TurnManager.combatTurn`); defaults to 1.
     */
    turn?: () => number;
};

function shipsAt(entities: EntityManager, hex: AxialCoord): EntityOf<"ship">[] {
    return entities
        .entitiesAt(hex.q, hex.r)
        .filter((entity): entity is EntityOf<"ship"> => entity.kind === "ship");
}

function vesselsAt(entities: EntityManager, hex: AxialCoord): Vessel[] {
    return entities
        .entitiesAt(hex.q, hex.r)
        .filter(
            (entity): entity is Vessel => entity.kind === "ship" || entity.kind === "supply_ship"
        );
}

/** Whether `hex` (true server state) holds any ship not belonging to `sideId`; supply ships don't count. */
export function hasEnemyWarships(
    entities: EntityManager,
    hex: AxialCoord,
    sideId: SideId
): boolean {
    return shipsAt(entities, hex).some((ship) => ship.sideId !== sideId);
}

/** Whether `hex` (true server state) holds any ship or supply ship not belonging to `sideId`. */
export function hasEnemyVessels(entities: EntityManager, hex: AxialCoord, sideId: SideId): boolean {
    return vesselsAt(entities, hex).some((vessel) => vessel.sideId !== sideId);
}

export type EnemyPlatform = { location: LocationEntity; installation: Installation };

/** Orbital Platforms on `hex` at locations owned by a side other than `sideId`. */
export function enemyPlatformsAt(
    entities: EntityManager,
    economy: EconomyManager | undefined,
    hex: AxialCoord,
    sideId: SideId
): EnemyPlatform[] {
    if (!economy) return [];
    const platforms: EnemyPlatform[] = [];
    for (const entity of entities.entitiesAt(hex.q, hex.r)) {
        if (!isLocationEntity(entity) || !entity.sideId || entity.sideId === sideId) continue;
        for (const installation of economy.installationsAt(entity.id)) {
            if (installation.type === "orbital_platform") {
                platforms.push({ location: entity, installation });
            }
        }
    }
    return platforms;
}

/** Space structures (sites included) on `hex` belonging to a side other than `sideId`. */
export function enemyStructuresAt(
    entities: EntityManager,
    hex: AxialCoord,
    sideId: SideId
): EntityOf<"space_structure">[] {
    return entities
        .entitiesAt(hex.q, hex.r)
        .filter(
            (e): e is EntityOf<"space_structure"> =>
                e.kind === "space_structure" && e.sideId !== sideId
        );
}

/**
 * Whether a ship of `sideId` has to fight its way into `hex`: enemy vessels, an enemy
 * Orbital Platform or an enemy space structure hold it.
 */
export function isDefendedHex(
    entities: EntityManager,
    economy: EconomyManager | undefined,
    hex: AxialCoord,
    sideId: SideId
): boolean {
    return (
        hasEnemyVessels(entities, hex, sideId) ||
        enemyStructuresAt(entities, hex, sideId).length > 0 ||
        enemyPlatformsAt(entities, economy, hex, sideId).length > 0
    );
}

/**
 * Whether a supply ship of `sideId` stepping into `hex` is ambushed (see
 * `BattleManager.ambush`): enemy warships, an armed enemy Orbital Platform or an armed,
 * completed enemy space structure hold it.
 */
export function hasAmbushers(
    entities: EntityManager,
    economy: EconomyManager | undefined,
    hex: AxialCoord,
    sideId: SideId
): boolean {
    if (hasEnemyWarships(entities, hex, sideId)) return true;
    if (!economy) return false;
    const armedStructure = enemyStructuresAt(entities, hex, sideId).some(
        (s) =>
            !s.constructing &&
            spaceStructureStats(s.structureType, s.tier ?? 1, economy.balance).attack > 0
    );
    if (armedStructure) return true;
    return enemyPlatformsAt(entities, economy, hex, sideId).some(
        ({ installation }) => platformStats(installation.tier, economy.balance).attack > 0
    );
}

/**
 * Automatic space combat. An aggressor attacking a hex fights every enemy ship, supply ship
 * and Orbital Platform there in one exchange (see `spaceExchange`): its attack is shared
 * across the defenders and each defender fires back. Supply ships may evade. Damage persists
 * on the entities and platforms; ships at 0 hp are destroyed (see `destroyVessels`), platforms
 * at 0 hp are removed from their location. If every defender that didn't evade is destroyed
 * the attacker won; if the attacker is destroyed it lost; otherwise it is inconclusive.
 */
export class BattleManager {
    private readonly _entities: EntityManager;
    private readonly _economy: EconomyManager | undefined;
    private readonly _balance: EconomyBalance;
    private readonly _rng: () => number;
    private readonly _turn: () => number;

    constructor(entities: EntityManager, economy?: EconomyManager, options: BattleOptions = {}) {
        this._entities = entities;
        this._economy = economy;
        this._balance = options.balance ?? economy?.balance ?? defaultEconomyBalance();
        this._rng = options.rng ?? Math.random;
        this._turn = options.turn ?? (() => 1);
    }

    /**
     * Validate and apply a manual move towards `to`, as far as movement allows this turn. If
     * the path meets a defended hex (see `isDefendedHex`), the ship stops on the hex before it
     * and attacks; it advances into the hex only if it wins. Attacking ends its movement for
     * the turn and clears its order. Otherwise, if the destination isn't reached, the rest of
     * the route is stored as the ship's `moveOrder`.
     */
    moveShip(
        sideId: SideId | null,
        shipId: EntityId,
        to: AxialCoord,
        options: MovePlanOptions = {}
    ): BattleMoveResult {
        if (this._entities.getOfKind(shipId, "ship")?.hyperjump) {
            return { ok: false, error: `Ship ${shipId} is preparing a hyperspace jump` };
        }
        const plan = planShipRoute(this._entities, sideId, shipId, to, options);
        if (!plan.ok) return plan;

        const ship = plan.ship;
        const maxSteps = Math.floor(ship.movementPoints / MOVE_COST_PER_HEX);
        const steps = stepAlongRoute(plan, maxSteps, {
            stopAt: (hex) => this._defended(hex, ship.sideId)
        });
        const last = steps.path.at(-1);
        const target = last && this._defended(last, ship.sideId) ? last : null;
        const approach = target ? steps.path.slice(0, -1) : steps.path;

        let move: Extract<MoveValidation, { ok: true }> | null = null;
        if (approach.length > 0) {
            const validated = moveFromSteps(this._entities, plan, {
                path: approach,
                remaining: plan.route.slice(approach.length)
            });
            if (!validated.ok) return validated;
            move = validated;
            applyShipMove(this._entities, move);
        }

        if (target) {
            delete ship.moveOrder;
            const from = { q: ship.q, r: ship.r };
            ship.facing = axialDirectionTowards(from, target);
            ship.movementPoints = 0;
            const combat = this._fight(ship, target, from, "move");
            if (combat.outcome === "attacker_won") {
                this._entities.move(ship.id, target);
                combat.attackerMovedIn = true;
            }
            return { ok: true, move, combat, moveOrder: null };
        }

        if (steps.remaining.length > 0) {
            ship.moveOrder = { destination: plan.destination, route: steps.remaining };
        } else {
            delete ship.moveOrder;
        }
        return { ok: true, move, combat: null, moveOrder: ship.moveOrder ?? null };
    }

    /**
     * A supply ship tried to step into `hex`, which holds enemy warships or an enemy Orbital
     * Platform it didn't know about. Each armed enemy warship there, then each armed platform,
     * attacks it in turn (it may evade each attack) until it is destroyed. It never enters the
     * hex. Null when nothing there is armed.
     */
    ambush(supplyShip: EntityOf<"supply_ship">, hex: AxialCoord): CombatResult | null {
        const enemies = [
            ...shipsAt(this._entities, hex)
                .filter((s) => s.sideId !== supplyShip.sideId)
                .map((s) => shipFighter(s, "attacker", this._balance)),
            ...this._platformFighters(hex, supplyShip.sideId, "attacker"),
            ...this._structureFighters(hex, supplyShip.sideId, "attacker")
        ];
        const attackerSideId = enemies[0]?.sideId;
        const aggressors = enemies.filter((f) => f.sideId === attackerSideId && f.attack > 0);
        if (!attackerSideId || aggressors.length === 0) return null;

        const target = supplyFighter(
            supplyShip,
            "defender",
            this._balance,
            this._techs(supplyShip.sideId)
        );
        let rounds = 0;
        for (const aggressor of aggressors) {
            if (!isAlive(target)) break;
            spaceExchange(aggressor, [target], this._balance.combat, this._rng);
            rounds += 1;
        }
        const fought = aggressors.slice(0, rounds);
        const destroyed = this._apply([...fought, target]);
        return {
            kind: "space",
            cause: "ambush",
            hex: { q: supplyShip.q, r: supplyShip.r },
            from: { q: hex.q, r: hex.r },
            attackerSideId,
            defenderSideIds: [supplyShip.sideId],
            participants: [...fought, target].map(toParticipant),
            ...destroyed,
            outcome: isAlive(target) ? "inconclusive" : "attacker_won",
            attackerMovedIn: false,
            rounds
        };
    }

    /**
     * A ship arrived out of hyperspace from `origin`. If its hex is defended (see
     * `isDefendedHex`) it attacks at once. Unless it clears the hex (or is destroyed) it is
     * displaced to the nearest safe hex (see `nearestSafeHex`). Null when the hex is quiet.
     */
    arrival(ship: EntityOf<"ship">, origin: AxialCoord): CombatResult | null {
        if (!this._defended(ship, ship.sideId)) return null;
        const hex = { q: ship.q, r: ship.r };
        const combat = this._fight(ship, hex, origin, "hyperjump");
        if (combat.outcome === "attacker_won") {
            combat.attackerMovedIn = true;
        } else if (combat.outcome === "inconclusive") {
            const refuge = this.nearestSafeHex(hex, ship.sideId);
            if (refuge) {
                this._entities.move(ship.id, refuge);
                combat.displacedTo = refuge;
            }
        }
        return combat;
    }

    /**
     * Nearest hex to `from` (excluded) that is in bounds, free of obstacles, of other sides'
     * vessels and of enemy Orbital Platforms.
     */
    nearestSafeHex(from: AxialCoord, sideId: SideId): AxialCoord | undefined {
        const map = this._entities.map;
        const inBounds = (hex: AxialCoord) => !!findTileByAxial(map, hex.q, hex.r);
        const maxRadius = map.width + map.height;
        for (let radius = 1; radius <= maxRadius; radius++) {
            for (const hex of ringHexes(from, radius, inBounds)) {
                const contents = this._entities.entitiesAt(hex.q, hex.r);
                if (hexHasObstacle(contents)) continue;
                if (this._defended(hex, sideId)) continue;
                return hex;
            }
        }
        return undefined;
    }

    private _defended(hex: AxialCoord, sideId: SideId): boolean {
        return isDefendedHex(this._entities, this._economy, hex, sideId);
    }

    private _techs(sideId: SideId) {
        return this._economy?.research.techs(sideId) ?? [];
    }

    /** Enemy Orbital Platforms on `hex` (enemies of `sideId`) as fighters. */
    private _platformFighters(hex: AxialCoord, sideId: SideId, role: Fighter["role"]): Fighter[] {
        return enemyPlatformsAt(this._entities, this._economy, hex, sideId).map(
            ({ location, installation }) =>
                platformFighter(installation, location.id, location.sideId!, role, this._balance)
        );
    }

    /** Enemy space structures on `hex` (enemies of `sideId`) as fighters. */
    private _structureFighters(hex: AxialCoord, sideId: SideId, role: Fighter["role"]): Fighter[] {
        return enemyStructuresAt(this._entities, hex, sideId).map((s) =>
            structureFighter(s, role, this._balance)
        );
    }

    private _fighterFor(vessel: Vessel, role: Fighter["role"]): Fighter {
        return vessel.kind === "ship"
            ? shipFighter(vessel, role, this._balance)
            : supplyFighter(vessel, role, this._balance, this._techs(vessel.sideId));
    }

    /** One exchange between `attacker` and every enemy vessel and Orbital Platform on `hex`. */
    private _fight(
        attacker: EntityOf<"ship">,
        hex: AxialCoord,
        from: AxialCoord,
        cause: CombatCause
    ): CombatResult {
        const defenders = [
            ...vesselsAt(this._entities, hex)
                .filter((v) => v.sideId !== attacker.sideId)
                .map((v) => this._fighterFor(v, "defender")),
            ...this._platformFighters(hex, attacker.sideId, "defender"),
            ...this._structureFighters(hex, attacker.sideId, "defender")
        ];
        const aggressor = shipFighter(attacker, "attacker", this._balance);
        spaceExchange(aggressor, defenders, this._balance.combat, this._rng);
        const fighters = [aggressor, ...defenders];
        const destroyed = this._apply(fighters);
        const cleared = defenders.every(
            (d) => !isAlive(d) || (d.attacked > 0 && d.evadedCount === d.attacked)
        );
        const outcome: CombatOutcome = !isAlive(aggressor)
            ? "attacker_destroyed"
            : cleared
              ? "attacker_won"
              : "inconclusive";
        return {
            kind: "space",
            cause,
            hex: { q: hex.q, r: hex.r },
            from: { q: from.q, r: from.r },
            attackerSideId: attacker.sideId,
            defenderSideIds: [...new Set(defenders.map((d) => d.sideId))],
            participants: fighters.map(toParticipant),
            ...destroyed,
            outcome,
            attackerMovedIn: false,
            rounds: 1
        };
    }

    /**
     * Write fighters' hp and the combat turn back to their vessels and platforms, and destroy
     * those at 0 hp.
     */
    private _apply(
        fighters: readonly Fighter[]
    ): Pick<
        CombatResult,
        "destroyedIds" | "destroyedUnitIds" | "destroyedInstallationIds" | "destroyedStructureIds"
    > {
        const lost: Vessel[] = [];
        const turn = this._turn();
        const destroyedInstallationIds = this._applyPlatforms(fighters, turn);
        const destroyedStructureIds = this._applyStructures(fighters, turn);
        const installations = {
            ...(destroyedInstallationIds.length ? { destroyedInstallationIds } : {}),
            ...(destroyedStructureIds.length ? { destroyedStructureIds } : {})
        };
        for (const f of fighters) {
            const vessel = this._entities.get(f.id);
            if (vessel?.kind !== "ship" && vessel?.kind !== "supply_ship") continue;
            vessel.lastCombatTurn = turn;
            if (!isAlive(f)) {
                lost.push(vessel);
            } else if (vessel.kind === "ship") {
                vessel.hp = f.hp;
            } else if (f.hp < f.maxHp) {
                vessel.hp = f.hp;
            }
        }
        if (lost.length === 0) return { destroyedIds: [], destroyedUnitIds: [], ...installations };
        const result = destroyVessels(this._entities, this._economy, lost);
        return {
            destroyedIds: result.destroyedShipIds,
            destroyedUnitIds: result.destroyedUnitIds,
            ...installations
        };
    }

    /** Space structure fighters' hp and combat turn onto their entities; returns those destroyed. */
    private _applyStructures(fighters: readonly Fighter[], turn: number): EntityId[] {
        const destroyed: EntityId[] = [];
        for (const f of fighters) {
            if (f.kind !== "space_structure") continue;
            const structure = this._entities.getOfKind(f.id, "space_structure");
            if (!structure) continue;
            structure.lastCombatTurn = turn;
            if (!isAlive(f)) destroyed.push(f.id);
            else if (f.hp < f.maxHp) structure.hp = f.hp;
            else delete structure.hp;
        }
        destroySpaceStructures(this._entities, this._economy, destroyed);
        return destroyed;
    }

    /** Platform fighters' hp and combat turn onto their installations; returns those destroyed. */
    private _applyPlatforms(fighters: readonly Fighter[], turn: number): EntityId[] {
        const destroyed: EntityId[] = [];
        for (const f of fighters) {
            if (f.kind !== "installation" || !f.locationId || !this._economy) continue;
            const installation = this._economy
                .installationsAt(f.locationId)
                .find((i) => i.id === f.id);
            if (!installation) continue;
            installation.lastCombatTurn = turn;
            if (!isAlive(f)) {
                this._economy.destroyInstallations(f.locationId, [f.id]);
                destroyed.push(f.id);
            } else if (f.hp < f.maxHp) {
                installation.hp = f.hp;
            } else {
                delete installation.hp;
            }
        }
        return destroyed;
    }
}
