import { axialDirectionTowards, findHexPath, planHexPath } from "@space/maths";
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
          /** Hex the move was planned towards. */
          destination: AxialCoord;
          /** Planned hexes after `to`, ending at `destination`; empty once it is reached. */
          remaining: AxialCoord[];
      }
    | { ok: false; error: string };

export type RoutePlan =
    | {
          ok: true;
          ship: EntityOf<"ship">;
          from: AxialCoord;
          destination: AxialCoord;
          /** Planned hexes from `from` (excluded) to `destination` (included). */
          route: AxialCoord[];
      }
    | { ok: false; error: string };

export type MovePlanOptions = {
    /**
     * Whether the mover believes `hex` holds an obstacle. Pass the moving side's
     * knowledge so plans don't leak hidden contents; defaults to the true map.
     */
    isObstacle?: (hex: AxialCoord) => boolean;
    /**
     * Whether the mover has explored `hex`. When given, the destination must be explored and
     * the route only passes through explored hexes; otherwise anything goes.
     */
    isExplored?: (hex: AxialCoord) => boolean;
    /** The move ends early on the first stepped-into hex for which this returns true. */
    stopAt?: (hex: AxialCoord) => boolean;
    /** The move ends just before the first hex for which this returns true. */
    stopBefore?: (hex: AxialCoord) => boolean;
};

/** Route from the ship's hex to `to` using the mover's knowledge; movement points aren't checked. */
export function planShipRoute(
    entities: EntityManager,
    sideId: SideId | null,
    shipId: EntityId,
    to: AxialCoord,
    options: MovePlanOptions = {}
): RoutePlan {
    if (!sideId) return { ok: false, error: "You are not assigned to a side" };

    const ship = entities.getOfKind(shipId, "ship");
    if (!ship) return { ok: false, error: `Unknown ship ${shipId}` };
    if (ship.sideId !== sideId) return { ok: false, error: `Ship ${shipId} is not yours` };

    const target = findTileByAxial(entities.map, to.q, to.r);
    if (!target) return { ok: false, error: `Destination ${to.q},${to.r} is off the map` };
    const destination = { q: target.q, r: target.r };

    const from = { q: ship.q, r: ship.r };
    if (from.q === destination.q && from.r === destination.r) {
        return { ok: false, error: "Ship is already at that hex" };
    }
    const { isExplored } = options;
    if (isExplored && !isExplored(destination)) {
        return { ok: false, error: `Destination ${to.q},${to.r} is unexplored` };
    }

    const isObstacle =
        options.isObstacle ??
        ((hex: AxialCoord) => hexHasObstacle(entities.entitiesAt(hex.q, hex.r)));
    const inBounds = (hex: AxialCoord) => !!findTileByAxial(entities.map, hex.q, hex.r);
    const pathOptions = {
        inBounds,
        passable: (hex: AxialCoord) => !isObstacle(hex) && (!isExplored || isExplored(hex))
    };
    const path = isExplored
        ? findHexPath(from, destination, pathOptions)
        : planHexPath(from, destination, pathOptions);
    if (!path) return { ok: false, error: `No known route to ${to.q},${to.r}` };

    const route: AxialCoord[] = [];
    for (const hex of path.slice(1)) {
        if (!inBounds(hex)) break;
        route.push({ q: hex.q, r: hex.r });
    }
    if (route.length === 0) return { ok: false, error: `No route towards ${to.q},${to.r}` };
    return { ok: true, ship, from, destination, route };
}

/**
 * Steps along a planned route for at most `maxSteps` hexes, honouring `stopAt` and
 * `stopBefore`. `path` may be empty when the first hex is blocked.
 */
export function stepAlongRoute(
    plan: Extract<RoutePlan, { ok: true }>,
    maxSteps: number,
    options: Pick<MovePlanOptions, "stopAt" | "stopBefore"> = {}
): { path: AxialCoord[]; remaining: AxialCoord[] } {
    const path: AxialCoord[] = [];
    for (const hex of plan.route.slice(0, Math.max(0, maxSteps))) {
        if (options.stopBefore?.(hex)) break;
        path.push(hex);
        if (options.stopAt?.(hex)) break;
    }
    return { path, remaining: plan.route.slice(path.length) };
}

/** Turn a stepped route into a move, checking the ship may end on its final hex. */
export function moveFromSteps(
    entities: EntityManager,
    plan: Extract<RoutePlan, { ok: true }>,
    steps: { path: AxialCoord[]; remaining: AxialCoord[] }
): MoveValidation {
    const end = steps.path.at(-1);
    const endTile = end && findTileByAxial(entities.map, end.q, end.r);
    if (!endTile) {
        const next = plan.route[0]!;
        return { ok: false, error: `Route blocked at ${next.q},${next.r}` };
    }
    if (!entities.canEnter(plan.ship, endTile)) {
        return { ok: false, error: `Ship cannot enter ${endTile.q},${endTile.r}` };
    }
    return {
        ok: true,
        ship: plan.ship,
        from: plan.from,
        to: { q: endTile.q, r: endTile.r },
        path: steps.path,
        cost: steps.path.length * MOVE_COST_PER_HEX,
        destination: plan.destination,
        remaining: steps.remaining
    };
}

/** This turn's part of a move towards `to`: the route is cut where MP run out. */
export function validateShipMove(
    entities: EntityManager,
    sideId: SideId | null,
    shipId: EntityId,
    to: AxialCoord,
    options: MovePlanOptions = {}
): MoveValidation {
    const plan = planShipRoute(entities, sideId, shipId, to, options);
    if (!plan.ok) return plan;
    const maxSteps = Math.floor(plan.ship.movementPoints / MOVE_COST_PER_HEX);
    if (maxSteps <= 0) return { ok: false, error: `Ship ${shipId} has no movement left` };
    return moveFromSteps(entities, plan, stepAlongRoute(plan, maxSteps, options));
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
