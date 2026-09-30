import type { StructureType } from "./Economy.js";
import type { ShipType } from "./PrimitiveTypes.js";
import type { Resources } from "./Resources.js";
import type { TechId } from "./Tech.js";

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
    /** `cost.population` is the crew, borrowed and returned home when the ship is lost. */
    cost: Resources;
    buildTurns: number;
    /** Structures that must be built on the planet building this ship. */
    requires: StructureType[];
    requiresTech?: TechId;
    /** Highest enhancement tier; 1 means it can't be upgraded. */
    maxTier: number;
    /** Can be consumed to claim an unowned planet, moon or mineable asteroid on its hex. */
    canColonise?: boolean;
    /** Ground units it can carry. */
    unitCapacity?: number;
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
        moveSpeed: 2,
        cost: { money: 100, materials: 100, population: 5, science: 0 },
        buildTurns: 2,
        requires: ["shipyard"],
        maxTier: 3
    },
    // 180° turn 0.6s + 1 hex 0.67s → ≤ 1.27s (≈ 0.87s for a 60° turn)
    frigate: {
        name: "Frigate",
        maxMovementPoints: 3,
        hp: 12,
        scale: 0.6,
        rotationSpeed: 300,
        moveSpeed: 1.5,
        cost: { money: 200, materials: 300, population: 15, science: 0 },
        buildTurns: 3,
        requires: ["advanced_shipyard"],
        maxTier: 3
    },
    // 180° turn 0.75s + 1 hex 0.8s → ≤ 1.55s
    colony_ship: {
        name: "Colony Ship",
        maxMovementPoints: 2,
        hp: 4,
        scale: 0.55,
        rotationSpeed: 240,
        moveSpeed: 1.25,
        cost: { money: 200, materials: 200, population: 50, science: 0 },
        buildTurns: 3,
        requires: ["shipyard"],
        maxTier: 1,
        canColonise: true
    },
    // 180° turn 0.75s + 1 hex 0.8s → ≤ 1.55s
    transport: {
        name: "Transport",
        maxMovementPoints: 3,
        hp: 8,
        scale: 0.55,
        rotationSpeed: 240,
        moveSpeed: 1.25,
        cost: { money: 100, materials: 150, population: 5, science: 0 },
        buildTurns: 2,
        requires: ["shipyard"],
        requiresTech: "transports",
        maxTier: 3,
        unitCapacity: 4
    }
};

/** Tier 2 has 1.5× hp; tier 3 has 2× hp and +1 movement point. */
export function shipStats(
    shipType: ShipType,
    tier: number
): { hp: number; maxMovementPoints: number } {
    const def = SHIP_TYPES[shipType];
    return {
        hp: Math.ceil(def.hp * (1 + 0.5 * (tier - 1))),
        maxMovementPoints: def.maxMovementPoints + (tier >= 3 ? 1 : 0)
    };
}
