import { MOVE_COST_PER_HEX, type AxialCoord, type EntityId, type SideId } from "@space/shared-data";
import { isDefendedHex } from "./Battle.js";
import type { EconomyManager } from "./EconomyManager.js";
import type { EntityManager } from "./EntityManager.js";
import type { EntityOf } from "./map/types.js";
import {
    applyShipMove,
    moveFromSteps,
    planShipRoute,
    stepAlongRoute,
    type MovePlanOptions
} from "./moveShip.js";

/** What a side believes about the map, for re-planning its ships' orders. */
export type MoveOrderKnowledge = Pick<MovePlanOptions, "isObstacle" | "isExplored">;

export type ShipMoveEvent = {
    ship: EntityOf<"ship">;
    from: AxialCoord;
    to: AxialCoord;
    /** Hexes stepped into, in order, ending at `to`. */
    path: AxialCoord[];
};

export type MoveOrderResult = {
    moves: ShipMoveEvent[];
    /** Ships whose order was completed (and cleared) this turn. */
    arrived: EntityId[];
};

export type MoveOrderOptions = {
    economy?: EconomyManager;
    /** Defaults to the true map with every hex explored. */
    knowledge?: (sideId: SideId) => MoveOrderKnowledge;
};

/**
 * Runs ships' multi-turn move orders at end of turn: each order is re-planned with the
 * side's knowledge, then the ship steps until its movement runs out. Orders never attack: the
 * ship stops before defended hexes (enemy vessels or an enemy Orbital Platform, see
 * `isDefendedHex`) and keeps its order to try again next turn.
 * Ships with a jump pending drop their order.
 */
export class MoveOrderManager {
    private readonly _entities: EntityManager;
    private readonly _economy: EconomyManager | undefined;
    private readonly _knowledge: (sideId: SideId) => MoveOrderKnowledge;

    constructor(entities: EntityManager, options: MoveOrderOptions = {}) {
        this._entities = entities;
        this._economy = options.economy;
        this._knowledge = options.knowledge ?? (() => ({}));
    }

    /** Clear a ship's move order. */
    cancel(sideId: SideId | null, shipId: EntityId): { ok: true } | { ok: false; error: string } {
        if (!sideId) return { ok: false, error: "You are not assigned to a side" };
        const ship = this._entities.getOfKind(shipId, "ship");
        if (!ship) return { ok: false, error: `Unknown ship ${shipId}` };
        if (ship.sideId !== sideId) return { ok: false, error: `Ship ${shipId} is not yours` };
        if (!ship.moveOrder) return { ok: false, error: `Ship ${shipId} has no move order` };
        delete ship.moveOrder;
        return { ok: true };
    }

    run(): MoveOrderResult {
        const result: MoveOrderResult = { moves: [], arrived: [] };
        for (const ship of this._entities.ofKind("ship")) {
            const order = ship.moveOrder;
            if (!order) continue;
            if (ship.hyperjump) {
                delete ship.moveOrder;
                continue;
            }
            if (ship.q === order.destination.q && ship.r === order.destination.r) {
                delete ship.moveOrder;
                result.arrived.push(ship.id);
                continue;
            }

            const plan = planShipRoute(
                this._entities,
                ship.sideId,
                ship.id,
                order.destination,
                this._knowledge(ship.sideId)
            );
            if (!plan.ok) continue;
            const steps = stepAlongRoute(
                plan,
                Math.floor(ship.movementPoints / MOVE_COST_PER_HEX),
                {
                    stopBefore: (hex) =>
                        isDefendedHex(this._entities, this._economy, hex, ship.sideId)
                }
            );
            if (steps.path.length === 0) {
                ship.moveOrder = { destination: plan.destination, route: plan.route };
                continue;
            }

            const move = moveFromSteps(this._entities, plan, steps);
            if (!move.ok) continue;
            applyShipMove(this._entities, move);
            this._economy?.onShipMoved(ship);
            result.moves.push({ ship, from: move.from, to: move.to, path: move.path });
            if (steps.remaining.length > 0) {
                ship.moveOrder = { destination: plan.destination, route: steps.remaining };
            } else {
                delete ship.moveOrder;
                result.arrived.push(ship.id);
            }
        }
        return result;
    }
}
