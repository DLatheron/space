import { axialDirectionTowards, planHexPath } from "@space/maths";
import {
    hexHasObstacle,
    MOVE_COST_PER_HEX,
    type AxialCoord,
    type EntityId,
    type SideId
} from "@space/shared-data";
import type { EntityManager } from "./EntityManager.js";
import { findTileByAxial } from "./map/SpaceMap.js";
import type { EntityOf } from "./map/types.js";

export type MoveValidation =
    | {
          ok: true;
          ship: EntityOf<"ship">;
          from: AxialCoord;
          /** Final hex reached (last entry of `path`). */
          to: AxialCoord;
          /** Hexes stepped into, in order; stops early when MP run out. */
          path: AxialCoord[];
          cost: number;
      }
    | { ok: false; error: string };

export type MovePlanOptions = {
    /**
     * Whether the mover believes `hex` holds an obstacle. Pass the moving side's
     * knowledge so plans don't leak hidden contents; defaults to the true map.
     */
    isObstacle?: (hex: AxialCoord) => boolean;
    /** The move ends early on the first stepped-into hex for which this returns true. */
    stopAt?: (hex: AxialCoord) => boolean;
};

export function validateShipMove(
    entities: EntityManager,
    sideId: SideId | null,
    shipId: EntityId,
    to: AxialCoord,
    options: MovePlanOptions = {}
): MoveValidation {
    if (!sideId) return { ok: false, error: "You are not assigned to a side" };

    const ship = entities.getOfKind(shipId, "ship");
    if (!ship) return { ok: false, error: `Unknown ship ${shipId}` };
    if (ship.sideId !== sideId) return { ok: false, error: `Ship ${shipId} is not yours` };

    const target = findTileByAxial(entities.map, to.q, to.r);
    if (!target) return { ok: false, error: `Destination ${to.q},${to.r} is off the map` };

    const from = { q: ship.q, r: ship.r };
    if (from.q === target.q && from.r === target.r) {
        return { ok: false, error: "Ship is already at that hex" };
    }
    const maxSteps = Math.floor(ship.movementPoints / MOVE_COST_PER_HEX);
    if (maxSteps <= 0) return { ok: false, error: `Ship ${shipId} has no movement left` };

    const isObstacle =
        options.isObstacle ??
        ((hex: AxialCoord) => hexHasObstacle(entities.entitiesAt(hex.q, hex.r)));
    const inBounds = (hex: AxialCoord) => !!findTileByAxial(entities.map, hex.q, hex.r);
    const route = planHexPath(from, target, { inBounds, passable: (hex) => !isObstacle(hex) });

    const path: AxialCoord[] = [];
    for (const hex of route.slice(1, maxSteps + 1)) {
        if (!inBounds(hex)) break;
        path.push({ q: hex.q, r: hex.r });
        if (options.stopAt?.(hex)) break;
    }
    const end = path.at(-1);
    const endTile = end && findTileByAxial(entities.map, end.q, end.r);
    if (!endTile) return { ok: false, error: `No route towards ${to.q},${to.r}` };
    if (!entities.canEnter(ship, endTile)) {
        return { ok: false, error: `Ship cannot enter ${endTile.q},${endTile.r}` };
    }

    return {
        ok: true,
        ship,
        from,
        to: { q: endTile.q, r: endTile.r },
        path,
        cost: path.length * MOVE_COST_PER_HEX
    };
}

/** Direction of the last step of a move from `from` along `path`. */
export function facingAfterPath(from: AxialCoord, path: AxialCoord[]): number {
    return axialDirectionTowards(path.at(-2) ?? from, path[path.length - 1]);
}

/** Validate then apply a move. On success the ship is relocated and MP deducted. */
export function moveShip(
    entities: EntityManager,
    sideId: SideId | null,
    shipId: EntityId,
    to: AxialCoord,
    options: MovePlanOptions = {}
): MoveValidation {
    const result = validateShipMove(entities, sideId, shipId, to, options);
    if (result.ok) applyShipMove(entities, result);
    return result;
}

/** Relocate the ship of a validated move, deduct MP and update facing. */
export function applyShipMove(
    entities: EntityManager,
    move: Extract<MoveValidation, { ok: true }>
): void {
    entities.move(move.ship.id, move.to);
    move.ship.movementPoints -= move.cost;
    move.ship.facing = facingAfterPath(move.from, move.path);
}
