import {
    canCarryShip,
    HANGAR_LOAD_COST,
    hangarFor,
    SHIP_TYPE_INFO,
    type EconomyBalance,
    type EntityId,
    type SideId
} from "@space/shared-data";
import { defaultEconomyBalance } from "../config/config.schema.js";
import type { EntityManager } from "./EntityManager.js";
import type { EntityOf } from "./map/types.js";

export type CarrierResult = { ok: true; carrier: EntityOf<"ship"> } | { ok: false; error: string };

/**
 * Carrier hangars (see `ShipBalance.hangar`). Ships board and launch only on the carrier's
 * hex. Carried ships are stowed in the EntityManager: they keep the carrier's position (moving
 * and jumping with it) but are off the hex's stack, so they don't occupy it, fight or show to
 * other sides. They still count towards the ship cap and are destroyed with the carrier.
 */
export class CarrierManager {
    private readonly _entities: EntityManager;
    private readonly _balance: EconomyBalance;

    constructor(entities: EntityManager, balance: EconomyBalance = defaultEconomyBalance()) {
        this._entities = entities;
        this._balance = balance;
    }

    /**
     * Board ships into the carrier's hangar. Each spends `HANGAR_LOAD_COST` movement and loses
     * its move order and pending jump.
     */
    load(sideId: SideId | null, carrierId: EntityId, shipIds: EntityId[]): CarrierResult {
        const owned = this._carrier(sideId, carrierId);
        if (!owned.ok) return owned;
        const { carrier } = owned;
        const hangar = hangarFor(this._balance, carrier.shipType);
        const carried = carrier.carriedShipIds ?? [];
        if (new Set(shipIds).size !== shipIds.length) {
            return { ok: false, error: "A ship is listed more than once" };
        }
        if (carried.length + shipIds.length > (hangar?.capacity ?? 0)) {
            return { ok: false, error: "Not enough room in the hangar" };
        }
        const ships: EntityOf<"ship">[] = [];
        for (const shipId of shipIds) {
            const ship = this._entities.getOfKind(shipId, "ship");
            if (!ship || ship.sideId !== sideId)
                return { ok: false, error: `Unknown ship ${shipId}` };
            if (ship.id === carrier.id) return { ok: false, error: "A carrier can't board itself" };
            if (ship.carriedBy)
                return { ok: false, error: `Ship ${shipId} is already aboard a carrier` };
            if (ship.q !== carrier.q || ship.r !== carrier.r) {
                return { ok: false, error: `Ship ${shipId} is not at the carrier` };
            }
            if ((ship.carriedShipIds ?? []).length > 0) {
                return { ok: false, error: `Ship ${shipId} is carrying ships` };
            }
            if (!canCarryShip(this._balance, carrier.shipType, ship.shipType)) {
                const carrierName = SHIP_TYPE_INFO[carrier.shipType].name;
                return {
                    ok: false,
                    error: `${carrierName} cannot carry a ${SHIP_TYPE_INFO[ship.shipType].name}`
                };
            }
            if (ship.movementPoints < HANGAR_LOAD_COST) {
                return { ok: false, error: `Ship ${shipId} has no movement left to board` };
            }
            ships.push(ship);
        }
        for (const ship of ships) {
            ship.movementPoints -= HANGAR_LOAD_COST;
            ship.carriedBy = carrier.id;
            delete ship.moveOrder;
            delete ship.hyperjump;
            delete ship.hyperdriveCharging;
            this._entities.stow(ship.id);
        }
        carrier.carriedShipIds = [...carried, ...ships.map((s) => s.id)];
        return { ok: true, carrier };
    }

    /** Launch carried ships onto the carrier's hex; they keep their movement points. */
    unload(sideId: SideId | null, carrierId: EntityId, shipIds: EntityId[]): CarrierResult {
        const owned = this._carrier(sideId, carrierId);
        if (!owned.ok) return owned;
        const { carrier } = owned;
        const carried = carrier.carriedShipIds ?? [];
        const missing = shipIds.find((id) => !carried.includes(id));
        if (missing) return { ok: false, error: `Ship ${missing} is not aboard` };
        for (const shipId of shipIds) {
            const ship = this._entities.getOfKind(shipId, "ship");
            if (!ship) continue;
            delete ship.carriedBy;
            this._entities.move(ship.id, carrier);
            this._entities.unstow(ship.id);
        }
        const rest = carried.filter((id) => !shipIds.includes(id));
        if (rest.length > 0) carrier.carriedShipIds = rest;
        else delete carrier.carriedShipIds;
        return { ok: true, carrier };
    }

    private _carrier(sideId: SideId | null, carrierId: EntityId): CarrierResult {
        if (!sideId) return { ok: false, error: "You are not assigned to a side" };
        const carrier = this._entities.getOfKind(carrierId, "ship");
        if (!carrier || carrier.sideId !== sideId) {
            return { ok: false, error: `Unknown ship ${carrierId}` };
        }
        const hangar = hangarFor(this._balance, carrier.shipType);
        if (!hangar || hangar.capacity <= 0) {
            return { ok: false, error: `${SHIP_TYPE_INFO[carrier.shipType].name} has no hangar` };
        }
        if (carrier.carriedBy) return { ok: false, error: `Ship ${carrierId} is aboard a carrier` };
        return { ok: true, carrier };
    }
}
