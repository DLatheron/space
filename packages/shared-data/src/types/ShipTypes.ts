import type { ShipType } from "./PrimitiveTypes.js";

export type ShipTypeDefinition = {
    /** Display name, also used in generated ship names. */
    name: string;
    maxMovementPoints: number;
    hp: number;
    /** Placeholder size hint (see `EntityBase.scale`). */
    scale: number;
    /** Turn rate while animating a move, in degrees per second. */
    rotationSpeed: number;
    /** Travel speed while animating a move, in hexes per second (independent of zoom / hex size). */
    moveSpeed: number;
};

/**
 * Per-class ship stats. A one-hex move animates as rotate-to-face (up to 180°)
 * then travel one hex, so worst case ≈ 180 / rotationSpeed + 1 / moveSpeed seconds.
 */
export const SHIP_TYPES: Record<ShipType, ShipTypeDefinition> = {
    // 180° turn 0.5s + 1 hex 0.5s → ≤ 1.0s
    scout: {
        name: "Scout",
        maxMovementPoints: 5,
        hp: 6,
        scale: 0.45,
        rotationSpeed: 360,
        moveSpeed: 2
    },
    // 180° turn 0.6s + 1 hex 0.67s → ≤ 1.27s (≈ 0.87s for a 60° turn)
    frigate: {
        name: "Frigate",
        maxMovementPoints: 3,
        hp: 12,
        scale: 0.6,
        rotationSpeed: 300,
        moveSpeed: 1.5
    }
};
