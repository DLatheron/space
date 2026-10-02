import {
    BOMBARD_COST,
    canBombardShip,
    shipDef,
    SHIP_TYPE_INFO,
    type CombatOutcome,
    type CombatResult,
    type EntityId,
    type GroundUnit,
    type LocationEntity,
    type SideId
} from "@space/shared-data";
import { hasEnemyWarships } from "./Battle.js";
import {
    groundRounds,
    isAlive,
    orbitalStrike,
    shipFighter,
    toParticipant,
    unitFighter
} from "./combat.js";
import type { EconomyManager } from "./EconomyManager.js";
import type { EntityManager } from "./EntityManager.js";
import type { EntityOf } from "./map/types.js";

export type GroundResult = { ok: true } | { ok: false; error: string };

export type InvadeResult =
    | {
          ok: true;
          location: LocationEntity;
          /** Defender side (the location's owner before the invasion). */
          defenderSideId: SideId;
          /** The ground combat (rounds 0 when the location was undefended). */
          combat: CombatResult;
          /** Units that landed and now garrison the captured location. */
          landedUnitIds: EntityId[];
      }
    | { ok: false; error: string };

export type BombardResult =
    | {
          ok: true;
          location: LocationEntity;
          defenderSideId: SideId;
          combat: CombatResult;
      }
    | { ok: false; error: string };

export type GroundOptions = {
    /** Random numbers in [0, 1) for damage rolls; defaults to `Math.random`. */
    rng?: () => number;
    /**
     * Turn combat counts against for bombarding ships (`lastCombatTurn`); defaults to 1.
     */
    turn?: () => number;
};

/**
 * Transports, invasions, orbital bombardment and automatic ground combat. Units board and land
 * only at locations on the transport's hex. Invading needs the orbit free of enemy ships;
 * landing on an undefended enemy location captures it at once, otherwise ground combat is
 * fought in rounds (see `groundRounds`). Wiping out the defenders captures the location;
 * invaders that are wiped out are destroyed; undecided invaders stay aboard their transports.
 * Damage persists on units. Bombardment fires one-way from capable ships in orbit and may
 * destroy installations; it never captures the location.
 */
export class GroundManager {
    private readonly _entities: EntityManager;
    private readonly _economy: EconomyManager;
    private readonly _rng: () => number;
    private readonly _turn: () => number;

    constructor(entities: EntityManager, economy: EconomyManager, options: GroundOptions = {}) {
        this._entities = entities;
        this._economy = economy;
        this._rng = options.rng ?? Math.random;
        this._turn = options.turn ?? (() => 1);
    }

    /** Board garrisoned units at an owned location on the transport's hex. */
    load(sideId: SideId | null, shipId: EntityId, unitIds: EntityId[]): GroundResult {
        const transport = this._transport(sideId, shipId);
        if (!transport.ok) return transport;
        const { ship } = transport;
        const carried = ship.carriedUnitIds ?? [];
        const capacity = this._economy.balance.ships[ship.shipType].unitCapacity;
        if (carried.length + unitIds.length > capacity) {
            return { ok: false, error: "Not enough room aboard" };
        }
        for (const unitId of unitIds) {
            const unit = this._economy.units.get(unitId);
            if (!unit || unit.sideId !== sideId)
                return { ok: false, error: `Unknown unit ${unitId}` };
            if (unit.location.kind !== "garrison") {
                return { ok: false, error: `Unit ${unitId} is not in a garrison` };
            }
            const location = this._economy.locationEntity(unit.location.locationId);
            if (!location || location.q !== ship.q || location.r !== ship.r) {
                return { ok: false, error: `Unit ${unitId} is not at the transport` };
            }
            if (location.sideId !== sideId || !(location.garrison ?? []).includes(unitId)) {
                return { ok: false, error: `Unit ${unitId} is not in your garrison` };
            }
        }
        for (const unitId of unitIds) {
            this._economy.onUnitMoved(unitId);
            this._economy.units.relocate(unitId, { kind: "transport", shipId: ship.id });
        }
        return { ok: true };
    }

    /** Land carried units into the garrison of an owned location on the transport's hex. */
    unload(
        sideId: SideId | null,
        shipId: EntityId,
        locationId: EntityId,
        unitIds: EntityId[]
    ): GroundResult {
        const transport = this._transport(sideId, shipId);
        if (!transport.ok) return transport;
        const { ship } = transport;
        const location = this._economy.locationEntity(locationId);
        if (!location) return { ok: false, error: `Unknown location ${locationId}` };
        if (location.sideId !== sideId) {
            return { ok: false, error: `Location ${locationId} is not yours` };
        }
        if (location.q !== ship.q || location.r !== ship.r) {
            return { ok: false, error: "Transport is not at the location" };
        }
        const carried = ship.carriedUnitIds ?? [];
        const missing = unitIds.find((id) => !carried.includes(id));
        if (missing) return { ok: false, error: `Unit ${missing} is not aboard` };
        for (const unitId of unitIds) {
            this._economy.units.relocate(unitId, { kind: "garrison", locationId });
        }
        return { ok: true };
    }

    /**
     * Land every unit aboard the given transports on an enemy location on their hex and fight
     * for it at once. An undefended location is captured immediately.
     */
    invade(sideId: SideId | null, locationId: EntityId, shipIds: EntityId[]): InvadeResult {
        if (!sideId) return { ok: false, error: "You are not assigned to a side" };
        const location = this._economy.locationEntity(locationId);
        if (!location) return { ok: false, error: `Unknown location ${locationId}` };
        const defenderSideId = location.sideId;
        if (!defenderSideId) return { ok: false, error: "Unowned locations are colonised" };
        if (defenderSideId === sideId) return { ok: false, error: "Location is already yours" };
        if (hasEnemyWarships(this._entities, location, sideId)) {
            return { ok: false, error: "Enemy ships are defending the location" };
        }

        const unitIds: EntityId[] = [];
        for (const shipId of shipIds) {
            const transport = this._transport(sideId, shipId);
            if (!transport.ok) return transport;
            const { ship } = transport;
            if (ship.q !== location.q || ship.r !== location.r) {
                return { ok: false, error: `Transport ${shipId} is not at the location` };
            }
            unitIds.push(...(ship.carriedUnitIds ?? []));
        }
        if (unitIds.length === 0) return { ok: false, error: "No units aboard" };

        const balance = this._economy.balance;
        const units = this._economy.units;
        const attackers = unitIds.flatMap((id) => units.get(id) ?? []);
        const defenders = units.garrisonOf(locationId);
        const attackerFighters = attackers.map((u) => unitFighter(u, "attacker", balance));
        const defenderFighters = defenders.map((u) => unitFighter(u, "defender", balance));
        const rounds = groundRounds(attackerFighters, defenderFighters, balance.combat, this._rng);

        const all = [...attackerFighters, ...defenderFighters];
        const byId = new Map<EntityId, GroundUnit>(
            [...attackers, ...defenders].map((u) => [u.id, u])
        );
        for (const f of all) {
            const unit = byId.get(f.id)!;
            if (f.hp < f.maxHp) unit.hp = f.hp;
        }
        const destroyedUnitIds = all.filter((f) => !isAlive(f)).map((f) => f.id);
        this._economy.onUnitsDestroyed(destroyedUnitIds, location);

        const survivors = attackerFighters.filter(isAlive).map((f) => f.id);
        const defendersLeft = defenderFighters.some(isAlive);
        const captured = survivors.length > 0 && !defendersLeft;
        const outcome: CombatOutcome =
            survivors.length === 0
                ? "attacker_destroyed"
                : captured
                  ? "attacker_won"
                  : "inconclusive";
        if (captured) {
            this._economy.captureLocation(locationId, sideId);
            for (const unitId of survivors) {
                units.relocate(unitId, { kind: "garrison", locationId });
            }
        }
        const hex = { q: location.q, r: location.r };
        return {
            ok: true,
            location,
            defenderSideId,
            combat: {
                kind: "ground",
                cause: "invasion",
                hex,
                from: { ...hex },
                attackerSideId: sideId,
                defenderSideIds: [defenderSideId],
                participants: all.map(toParticipant),
                destroyedIds: [],
                destroyedUnitIds,
                outcome,
                attackerMovedIn: captured,
                rounds,
                locationId,
                captured
            },
            landedUnitIds: captured ? survivors : []
        };
    }

    /**
     * Fire orbital bombardment from capable ships on an enemy location on their hex. Ships
     * spend `BOMBARD_COST` movement each. Garrison units take one-way fire; each ship may then
     * destroy one random installation. Does not capture the location.
     */
    bombard(sideId: SideId | null, locationId: EntityId, shipIds: EntityId[]): BombardResult {
        if (!sideId) return { ok: false, error: "You are not assigned to a side" };
        const location = this._economy.locationEntity(locationId);
        if (!location) return { ok: false, error: `Unknown location ${locationId}` };
        const defenderSideId = location.sideId;
        if (!defenderSideId) return { ok: false, error: "Unowned locations are colonised" };
        if (defenderSideId === sideId) return { ok: false, error: "Location is already yours" };
        if (new Set(shipIds).size !== shipIds.length) {
            return { ok: false, error: "A ship is listed more than once" };
        }

        const balance = this._economy.balance;
        const ships: EntityOf<"ship">[] = [];
        for (const shipId of shipIds) {
            const ship = this._entities.getOfKind(shipId, "ship");
            if (!ship || ship.sideId !== sideId) {
                return { ok: false, error: `Unknown ship ${shipId}` };
            }
            if (ship.carriedBy) {
                return { ok: false, error: `Ship ${shipId} is aboard a carrier` };
            }
            if (!canBombardShip(balance, ship.shipType)) {
                return {
                    ok: false,
                    error: `${SHIP_TYPE_INFO[ship.shipType].name} cannot bombard`
                };
            }
            if (ship.q !== location.q || ship.r !== location.r) {
                return { ok: false, error: `Ship ${shipId} is not at the location` };
            }
            if (ship.movementPoints < BOMBARD_COST) {
                return { ok: false, error: `Ship ${shipId} has no movement left to bombard` };
            }
            ships.push(ship);
        }

        const units = this._economy.units;
        const defenders = units.garrisonOf(locationId);
        const installationsBefore = this._economy.locationEconomy(locationId)?.installations ?? [];
        if (defenders.length === 0 && installationsBefore.length === 0) {
            return { ok: false, error: "Nothing to bombard" };
        }

        const attackerFighters = ships.map((s) => shipFighter(s, "attacker", balance));
        const defenderFighters = defenders.map((u) => unitFighter(u, "defender", balance));
        orbitalStrike(attackerFighters, defenderFighters, balance.combat, this._rng);

        const turn = this._turn();
        for (const ship of ships) {
            ship.movementPoints -= BOMBARD_COST;
            ship.lastCombatTurn = turn;
            delete ship.moveOrder;
            delete ship.hyperjump;
            delete ship.hyperdriveCharging;
        }

        const byId = new Map<EntityId, GroundUnit>(defenders.map((u) => [u.id, u]));
        for (const f of defenderFighters) {
            const unit = byId.get(f.id)!;
            if (f.hp < f.maxHp) unit.hp = f.hp;
        }
        const destroyedUnitIds = defenderFighters.filter((f) => !isAlive(f)).map((f) => f.id);
        this._economy.onUnitsDestroyed(destroyedUnitIds, location);

        const destroyedInstallationIds: EntityId[] = [];
        const remaining = [
            ...(this._economy.locationEconomy(locationId)?.installations ?? [])
        ];
        for (const _ship of ships) {
            if (remaining.length === 0) break;
            if (this._rng() >= balance.combat.bombardmentInstallationChance) continue;
            const index = Math.floor(this._rng() * remaining.length);
            const [hit] = remaining.splice(index, 1);
            if (hit) destroyedInstallationIds.push(hit.id);
        }
        this._economy.destroyInstallations(locationId, destroyedInstallationIds);

        const garrisonCleared =
            defenderFighters.length === 0
                ? destroyedInstallationIds.length > 0
                : !defenderFighters.some(isAlive);
        const outcome: CombatOutcome = garrisonCleared ? "attacker_won" : "inconclusive";

        const hex = { q: location.q, r: location.r };
        const all = [...attackerFighters, ...defenderFighters];
        return {
            ok: true,
            location,
            defenderSideId,
            combat: {
                kind: "ground",
                cause: "bombardment",
                hex,
                from: { ...hex },
                attackerSideId: sideId,
                defenderSideIds: [defenderSideId],
                participants: all.map(toParticipant),
                destroyedIds: [],
                destroyedUnitIds,
                outcome,
                attackerMovedIn: false,
                rounds: 1,
                locationId,
                captured: false,
                destroyedInstallationIds
            }
        };
    }

    private _transport(
        sideId: SideId | null,
        shipId: EntityId
    ): { ok: true; ship: EntityOf<"ship"> } | { ok: false; error: string } {
        if (!sideId) return { ok: false, error: "You are not assigned to a side" };
        const ship = this._entities.getOfKind(shipId, "ship");
        if (!ship || ship.sideId !== sideId) return { ok: false, error: `Unknown ship ${shipId}` };
        const def = shipDef(ship.shipType, this._economy.balance);
        if (!def.unitCapacity) {
            return { ok: false, error: `${def.name} cannot carry units` };
        }
        if (ship.carriedBy) return { ok: false, error: `Ship ${shipId} is aboard a carrier` };
        return { ok: true, ship };
    }
}
