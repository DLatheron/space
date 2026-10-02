import {
    hyperdriveFor,
    hyperjumpAccuracy,
    hyperjumpRange,
    inHyperjumpRange,
    isHyperspaceHazardKind,
    MAX_SCATTER_RING,
    ringHexes,
    scatterRing,
    shipStats,
    type AxialCoord,
    type CombatResult,
    type EconomyBalance,
    type EntityId,
    type HyperjumpOutcome,
    type SideId,
    type TechId
} from "@space/shared-data";
import { defaultEconomyBalance } from "../config/config.schema.js";
import type { BattleManager } from "./Battle.js";
import { destroyVessels } from "./destroyShips.js";
import type { EconomyManager } from "./EconomyManager.js";
import type { EntityManager } from "./EntityManager.js";
import { findTileByAxial } from "./map/SpaceMap.js";
import type { EntityOf } from "./map/types.js";

export type HyperspaceResult = { ok: true } | { ok: false; error: string };

export type HyperjumpEvent = {
    shipId: EntityId;
    sideId: SideId;
    from: AxialCoord;
    to: AxialCoord;
    outcome: HyperjumpOutcome;
    collidedWithId?: EntityId;
    /** Ships destroyed by hazards or collision (the jumper and/or the ship it hit, plus ships aboard). */
    destroyedIds: EntityId[];
    /** Ground units lost aboard ships destroyed by hazards or collision. */
    destroyedUnitIds: EntityId[];
    /** Sides that lost ships to hazards or collision. */
    lossSideIds: SideId[];
    /** Combat fought by the survivor landing among enemies (see `BattleManager.arrival`). */
    combat: CombatResult | null;
    /** Where the survivor ended up when it didn't clear the enemies at `to`. */
    displacedTo?: AxialCoord;
};

export type HyperspaceOptions = {
    battles: BattleManager;
    economy?: EconomyManager;
    /** Defaults to the economy's balance, else the config defaults. */
    balance?: EconomyBalance;
    /** Random numbers in [0, 1); defaults to `Math.random`. */
    rng?: () => number;
    /** Whether a side has explored a hex; defaults to everything explored. */
    isExplored?: (sideId: SideId, hex: AxialCoord) => boolean;
};

/**
 * Hyperspace jumps. A ship with a hyperdrive engages it during its turn, aiming at any hex
 * its side has explored within its side's circular jump range (see `hyperjumpRange`); it
 * can't move normally until the jump resolves at end of turn.
 *
 * Each jump, in a fixed order (so later arrivals can hit earlier ones), uses the random
 * number generator in this order: the scatter ring roll, the pick among in-bounds hexes on
 * that ring, one roll per hazard on the landing hex (destroyed below its `destroyChance`,
 * else damaged), then, if ships are there, the pick of one ship, the both-destroyed roll and
 * the which-one roll. A survivor landing among enemies then attacks them at once (using the
 * BattleManager's random numbers) and is displaced if it doesn't clear the hex. Carried ships
 * jump with their carrier.
 */
export class HyperspaceManager {
    private readonly _entities: EntityManager;
    private readonly _battles: BattleManager;
    private readonly _economy: EconomyManager | undefined;
    private readonly _balance: EconomyBalance;
    private readonly _rng: () => number;
    private readonly _isExplored: (sideId: SideId, hex: AxialCoord) => boolean;

    constructor(entities: EntityManager, options: HyperspaceOptions) {
        this._entities = entities;
        this._battles = options.battles;
        this._economy = options.economy;
        this._balance = options.balance ?? options.economy?.balance ?? defaultEconomyBalance();
        this._rng = options.rng ?? Math.random;
        this._isExplored = options.isExplored ?? (() => true);
    }

    /** Engage a ship's hyperdrive towards `target`, replacing any earlier target and move order. */
    activate(sideId: SideId | null, shipId: EntityId, target: AxialCoord): HyperspaceResult {
        const owned = this._owned(sideId, shipId);
        if (!owned.ok) return owned;
        const { ship } = owned;
        if (!hyperdriveFor(this._balance, ship.shipType)) {
            return { ok: false, error: `Ship ${shipId} has no hyperdrive` };
        }
        if ((ship.hyperdriveCooldown ?? 0) > 0) {
            return {
                ok: false,
                error: `Hyperdrive is cooling down for ${ship.hyperdriveCooldown} more turn(s)`
            };
        }
        if (ship.carriedBy) return { ok: false, error: `Ship ${shipId} is aboard a carrier` };
        const tile = findTileByAxial(this._entities.map, target.q, target.r);
        if (!tile) return { ok: false, error: `Target ${target.q},${target.r} is off the map` };
        if (tile.q === ship.q && tile.r === ship.r) {
            return { ok: false, error: "Ship is already at that hex" };
        }
        if (!this._isExplored(ship.sideId, tile)) {
            return { ok: false, error: `Target ${target.q},${target.r} is unexplored` };
        }
        const { width, height } = this._entities.map;
        const range = hyperjumpRange(this._balance, this._techs(ship.sideId), width, height);
        if (!inHyperjumpRange(ship, tile, range)) {
            return {
                ok: false,
                error: `Target ${target.q},${target.r} is beyond hyperdrive range (${range.toFixed(1)} hexes)`
            };
        }
        ship.hyperjump = { target: { q: tile.q, r: tile.r } };
        ship.hyperdriveCharging = true;
        delete ship.moveOrder;
        return { ok: true };
    }

    cancel(sideId: SideId | null, shipId: EntityId): HyperspaceResult {
        const owned = this._owned(sideId, shipId);
        if (!owned.ok) return owned;
        if (!owned.ship.hyperjump) {
            return { ok: false, error: `Ship ${shipId} has no jump pending` };
        }
        delete owned.ship.hyperjump;
        delete owned.ship.hyperdriveCharging;
        return { ok: true };
    }

    /** One turn off every hyperdrive cooldown. */
    tickCooldowns(): void {
        for (const ship of this._entities.ofKind("ship")) {
            if (ship.hyperdriveCooldown === undefined) continue;
            if (ship.hyperdriveCooldown <= 1) delete ship.hyperdriveCooldown;
            else ship.hyperdriveCooldown -= 1;
        }
    }

    /** Resolve every pending jump. */
    resolve(): HyperjumpEvent[] {
        const events: HyperjumpEvent[] = [];
        for (const ship of this._entities.ofKind("ship")) {
            if (!ship.hyperjump || ship.carriedBy) continue;
            // Earlier jumps this turn may have destroyed it.
            if (!this._entities.get(ship.id)) continue;
            events.push(this._jump(ship, ship.hyperjump.target));
        }
        return events;
    }

    private _owned(
        sideId: SideId | null,
        shipId: EntityId
    ): { ok: true; ship: EntityOf<"ship"> } | { ok: false; error: string } {
        if (!sideId) return { ok: false, error: "You are not assigned to a side" };
        const ship = this._entities.getOfKind(shipId, "ship");
        if (!ship) return { ok: false, error: `Unknown ship ${shipId}` };
        if (ship.sideId !== sideId) return { ok: false, error: `Ship ${shipId} is not yours` };
        return { ok: true, ship };
    }

    private _techs(sideId: SideId): TechId[] {
        return this._economy?.research.techs(sideId) ?? [];
    }

    private _maxHp(ship: EntityOf<"ship">): number {
        return shipStats(ship.shipType, ship.tier ?? 1, this._balance).hp;
    }

    private _hp(ship: EntityOf<"ship">): number {
        return ship.hp ?? this._maxHp(ship);
    }

    private _landing(ship: EntityOf<"ship">, target: AxialCoord): AxialCoord {
        const accuracy = hyperjumpAccuracy(
            this._balance,
            ship.shipType,
            ship.tier ?? 1,
            this._techs(ship.sideId)
        ) ?? { onTarget: 100, oneOff: 0, twoOff: 0 };
        const inBounds = (hex: AxialCoord) => !!findTileByAxial(this._entities.map, hex.q, hex.r);
        let ring: number = scatterRing(accuracy, this._rng());
        const pick = this._rng();
        for (; ring >= 0; ring--) {
            const hexes = ringHexes(target, Math.min(ring, MAX_SCATTER_RING), inBounds);
            if (hexes.length > 0)
                return hexes[Math.min(hexes.length - 1, Math.floor(pick * hexes.length))]!;
        }
        return target;
    }

    private _jump(ship: EntityOf<"ship">, target: AxialCoord): HyperjumpEvent {
        const from = { q: ship.q, r: ship.r };
        const to = this._landing(ship, target);
        delete ship.hyperjump;
        delete ship.hyperdriveCharging;
        delete ship.moveOrder;
        const cooldown = hyperdriveFor(this._balance, ship.shipType)?.cooldownTurns ?? 0;
        if (cooldown > 0) ship.hyperdriveCooldown = cooldown;
        this._entities.move(ship.id, to);

        const event: HyperjumpEvent = {
            shipId: ship.id,
            sideId: ship.sideId,
            from,
            to,
            outcome: "arrived",
            destroyedIds: [],
            destroyedUnitIds: [],
            lossSideIds: [],
            combat: null
        };
        const destroyed: EntityOf<"ship">[] = [];

        const hazards = this._entities
            .entitiesAt(to.q, to.r)
            .flatMap((e) => (isHyperspaceHazardKind(e.kind) ? [e.kind] : []));
        for (const kind of hazards) {
            const risk = this._balance.hyperspace.hazards[kind];
            if (this._rng() < risk.destroyChance) {
                destroyed.push(ship);
                break;
            }
            const damage = Math.ceil(this._maxHp(ship) * risk.damageFraction);
            if (damage > 0) {
                ship.hp = Math.max(1, this._hp(ship) - damage);
                event.outcome = "damaged";
            }
        }

        if (destroyed.length === 0) {
            const others = this._entities
                .entitiesAt(to.q, to.r)
                .filter((e): e is EntityOf<"ship"> => e.kind === "ship" && e.id !== ship.id);
            if (others.length > 0) {
                const other =
                    others[Math.min(others.length - 1, Math.floor(this._rng() * others.length))]!;
                event.collidedWithId = other.id;
                if (this._rng() < this._balance.hyperspace.collision.bothDestroyedChance) {
                    destroyed.push(ship, other);
                } else {
                    const otherHp = this._hp(other);
                    const jumperLost = this._rng() < otherHp / (otherHp + this._hp(ship));
                    destroyed.push(jumperLost ? ship : other);
                }
            }
        }

        if (destroyed.length > 0) {
            const result = destroyVessels(this._entities, this._economy, destroyed);
            event.destroyedIds = result.destroyedShipIds;
            event.destroyedUnitIds = result.destroyedUnitIds;
            event.lossSideIds = [...new Set(destroyed.map((s) => s.sideId))];
        }
        if (destroyed.includes(ship)) {
            event.outcome = "destroyed";
        } else {
            event.combat = this._battles.arrival(ship, from);
            if (event.combat?.displacedTo) event.displacedTo = event.combat.displacedTo;
            if (this._entities.get(ship.id)) this._economy?.onShipMoved(ship);
        }
        return event;
    }
}
