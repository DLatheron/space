import type { EntityKind } from "./PrimitiveTypes.js";

/** Movement point cost per hex travelled. */
export const MOVE_COST_PER_HEX = 1;

/**
 * Entity kinds that ships path around. A ship can still end its move on one of
 * these when the player targets that hex explicitly. Ships never block.
 */
export const OBSTACLE_KINDS: ReadonlySet<EntityKind> = new Set<EntityKind>([
    "planet",
    "moon",
    "large_asteroid",
    "sun",
    "asteroid_belt",
    "wormhole",
    "black_hole",
    "hyperspace_tunnel"
]);

export function isObstacleKind(kind: EntityKind): boolean {
    return OBSTACLE_KINDS.has(kind);
}

/** Whether a hex holding `entities` should be avoided when pathing through it. */
export function hexHasObstacle(entities: Iterable<{ kind: EntityKind }>): boolean {
    for (const entity of entities) {
        if (isObstacleKind(entity.kind)) return true;
    }
    return false;
}
