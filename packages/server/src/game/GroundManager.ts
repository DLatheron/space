import {
    SHIP_TYPES,
    type BattleId,
    type EntityId,
    type GroundBattleInfo,
    type GroundUnit,
    type LocationEntity,
    type SideId
} from "@space/shared-data";
import { hasEnemyWarships, type BattleManager } from "./Battle.js";
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
          /** Pending ground battle, or null when the location was undefended and captured. */
          battle: GroundBattleInfo | null;
          landedUnitIds: EntityId[];
      }
    | { ok: false; error: string };

export type GroundResolveResult =
    | {
          ok: true;
          battle: GroundBattleInfo;
          loserSideId: SideId;
          destroyedUnitIds: EntityId[];
          captured: boolean;
      }
    | { ok: false; error: string };

const summary = (unit: GroundUnit) => ({ id: unit.id, unitType: unit.unitType, tier: unit.tier });

/**
 * Transports, invasions and ground battles. Units board and land only at locations on the
 * transport's hex. Invading needs the orbit free of enemy ships; landing on an undefended
 * enemy location captures it at once, otherwise a ground battle starts that the attacker
 * resolves by naming a winner (as with space battles).
 */
export class GroundManager {
    private readonly _entities: EntityManager;
    private readonly _economy: EconomyManager;
    private readonly _battles: BattleManager | undefined;
    private readonly _groundBattles = new Map<BattleId, GroundBattleInfo>();
    private _nextId = 1;

    constructor(entities: EntityManager, economy: EconomyManager, battles?: BattleManager) {
        this._entities = entities;
        this._economy = economy;
        this._battles = battles;
    }

    get(battleId: BattleId): GroundBattleInfo | undefined {
        return this._groundBattles.get(battleId);
    }

    pending(): GroundBattleInfo[] {
        return [...this._groundBattles.values()];
    }

    involving(sideId: SideId): GroundBattleInfo[] {
        return this.pending().filter(
            (b) => b.attackerSideId === sideId || b.defenderSideId === sideId
        );
    }

    findAt(locationId: EntityId): GroundBattleInfo | undefined {
        return this.pending().find((b) => b.locationId === locationId);
    }

    /** Board garrisoned units at an owned location on the transport's hex. */
    load(sideId: SideId | null, shipId: EntityId, unitIds: EntityId[]): GroundResult {
        const transport = this._transport(sideId, shipId);
        if (!transport.ok) return transport;
        const { ship } = transport;
        const carried = ship.carriedUnitIds ?? [];
        if (carried.length + unitIds.length > (SHIP_TYPES[ship.shipType].unitCapacity ?? 0)) {
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
            if (this.findAt(location.id)) {
                return { ok: false, error: "A ground battle is in progress there" };
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
        if (this.findAt(location.id)) {
            return { ok: false, error: "A ground battle is in progress there" };
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
     * Land every unit aboard the given transports on an enemy location on their hex. An
     * undefended location is captured immediately; otherwise a ground battle starts.
     */
    invade(sideId: SideId | null, locationId: EntityId, shipIds: EntityId[]): InvadeResult {
        if (!sideId) return { ok: false, error: "You are not assigned to a side" };
        const location = this._economy.locationEntity(locationId);
        if (!location) return { ok: false, error: `Unknown location ${locationId}` };
        const defenderSideId = location.sideId;
        if (!defenderSideId) return { ok: false, error: "Unowned locations are colonised" };
        if (defenderSideId === sideId) return { ok: false, error: "Location is already yours" };
        if (this.findAt(locationId)) {
            return { ok: false, error: "A ground battle is already in progress there" };
        }
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

        const defenders = this._economy.units.garrisonOf(locationId);
        if (defenders.length === 0) {
            this._economy.captureLocation(locationId, sideId);
            for (const unitId of unitIds) {
                this._economy.units.relocate(unitId, { kind: "garrison", locationId });
            }
            return { ok: true, location, defenderSideId, battle: null, landedUnitIds: unitIds };
        }

        for (const unitId of unitIds) {
            this._economy.units.relocate(
                unitId,
                { kind: "garrison", locationId },
                { listed: false }
            );
        }
        const battle: GroundBattleInfo = {
            battleId: `ground-${this._nextId++}`,
            locationId,
            q: location.q,
            r: location.r,
            attackerSideId: sideId,
            defenderSideId,
            attackerUnits: unitIds.map((id) => summary(this._economy.units.get(id)!)),
            defenderUnits: defenders.map(summary)
        };
        this._groundBattles.set(battle.battleId, battle);
        return { ok: true, location, defenderSideId, battle, landedUnitIds: unitIds };
    }

    /**
     * Resolve a ground battle on behalf of the attacker. The loser's units are destroyed
     * (their population goes home). If the attacker wins, it captures the location and
     * its landed units become the garrison.
     */
    resolve(
        battleId: BattleId,
        bySideId: SideId | null,
        winnerSideId: SideId
    ): GroundResolveResult {
        const battle = this._groundBattles.get(battleId);
        if (!battle) return { ok: false, error: `Unknown ground battle ${battleId}` };
        if (bySideId !== battle.attackerSideId) {
            return { ok: false, error: "Only the invading side can resolve this battle" };
        }
        const { attackerSideId, defenderSideId, locationId } = battle;
        if (winnerSideId !== attackerSideId && winnerSideId !== defenderSideId) {
            return { ok: false, error: `Side ${winnerSideId} is not part of this battle` };
        }
        const attackerWon = winnerSideId === attackerSideId;
        const loserSideId = attackerWon ? defenderSideId : attackerSideId;
        const attackers = battle.attackerUnits
            .map((u) => u.id)
            .filter((id) => this._economy.units.get(id));
        const defenders = this._economy.units.garrisonOf(locationId).map((u) => u.id);
        const destroyedUnitIds = attackerWon ? defenders : attackers;
        this._economy.onUnitsDestroyed(destroyedUnitIds, battle);
        this._groundBattles.delete(battleId);

        if (attackerWon) {
            this._economy.captureLocation(locationId, attackerSideId);
            for (const unitId of attackers) {
                this._economy.units.relocate(unitId, { kind: "garrison", locationId });
            }
        }
        return { ok: true, battle, loserSideId, destroyedUnitIds, captured: attackerWon };
    }

    private _transport(
        sideId: SideId | null,
        shipId: EntityId
    ): { ok: true; ship: EntityOf<"ship"> } | { ok: false; error: string } {
        if (!sideId) return { ok: false, error: "You are not assigned to a side" };
        const ship = this._entities.getOfKind(shipId, "ship");
        if (!ship || ship.sideId !== sideId) return { ok: false, error: `Unknown ship ${shipId}` };
        if (!SHIP_TYPES[ship.shipType].unitCapacity) {
            return { ok: false, error: `${SHIP_TYPES[ship.shipType].name} cannot carry units` };
        }
        if (this._battles?.findByShip(shipId)) {
            return { ok: false, error: `Ship ${shipId} is locked in battle` };
        }
        return { ok: true, ship };
    }
}
