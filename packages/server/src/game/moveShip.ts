import { axialDirectionTowards, axialDistance, axialLine } from "@space/maths";
import type { AxialCoord, EntityId, SideId } from "@space/shared-data";
import type { EntityManager } from "./EntityManager.js";
import { findTileByAxial } from "./map/SpaceMap.js";
import type { EntityOf } from "./map/types.js";

/** Movement point cost per hex travelled. */
export const MOVE_COST_PER_HEX = 1;

export type MoveValidation =
    | { ok: true; ship: EntityOf<"ship">; from: AxialCoord; to: AxialCoord; cost: number }
    | { ok: false; error: string };

export function validateShipMove(
    entities: EntityManager,
    sideId: SideId | null,
    shipId: EntityId,
    to: AxialCoord
): MoveValidation {
    if (!sideId) return { ok: false, error: "You are not assigned to a side" };

    const ship = entities.getOfKind(shipId, "ship");
    if (!ship) return { ok: false, error: `Unknown ship ${shipId}` };
    if (ship.sideId !== sideId) return { ok: false, error: `Ship ${shipId} is not yours` };

    const target = findTileByAxial(entities.map, to.q, to.r);
    if (!target) return { ok: false, error: `Destination ${to.q},${to.r} is off the map` };

    const from = { q: ship.q, r: ship.r };
    const distance = axialDistance(from, to);
    if (distance === 0) return { ok: false, error: "Ship is already at that hex" };
    if (ship.movementPoints <= 0)
        return { ok: false, error: `Ship ${shipId} has no movement left` };

    const cost = distance * MOVE_COST_PER_HEX;
    if (cost > ship.movementPoints) {
        return {
            ok: false,
            error: `Destination needs ${cost} MP but ship has ${ship.movementPoints}`
        };
    }
    if (!entities.canEnter(ship, target)) {
        return { ok: false, error: `Ship cannot enter ${to.q},${to.r}` };
    }

    return { ok: true, ship, from, to: { q: target.q, r: target.r }, cost };
}

/** Direction of the last step on the hex line `from` → `to` (the path clients animate). */
export function facingAfterMove(from: AxialCoord, to: AxialCoord): number {
    const path = axialLine(from, to);
    return axialDirectionTowards(path[path.length - 2] ?? from, path[path.length - 1]);
}

/** Validate then apply a move. On success the ship is relocated and MP deducted. */
export function moveShip(
    entities: EntityManager,
    sideId: SideId | null,
    shipId: EntityId,
    to: AxialCoord
): MoveValidation {
    const result = validateShipMove(entities, sideId, shipId, to);
    if (!result.ok) return result;
    entities.move(result.ship.id, result.to);
    result.ship.movementPoints -= result.cost;
    result.ship.facing = facingAfterMove(result.from, result.to);
    return result;
}
