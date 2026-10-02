import type { EconomyBalance, ShipBalance } from "./Economy.js";
import type { ShipType } from "./PrimitiveTypes.js";

/** Presentation fields; gameplay stats come from `EconomyBalance.ships` (see `shipDef`). */
export type ShipTypeInfo = {
    /** Display name, also used in generated ship names. */
    name: string;
    /** Placeholder size hint (see `EntityBase.scale`). */
    scale: number;
    /** Turn rate while animating a move, in degrees per second. */
    rotationSpeed: number;
    /** Travel speed while animating a move, in hexes per second (independent of zoom / hex size). */
    moveSpeed: number;
};

export type ShipTypeDefinition = ShipTypeInfo & ShipBalance;

/**
 * Per-class presentation. A one-hex move animates as rotate-to-face (up to 180°)
 * then travel one hex, so worst case ≈ 180 / rotationSpeed + 1 / moveSpeed seconds.
 */
export const SHIP_TYPE_INFO: Record<ShipType, ShipTypeInfo> = {
    // 180° turn 0.5s + 1 hex 0.5s → ≤ 1.0s
    scout: { name: "Scout", scale: 0.45, rotationSpeed: 360, moveSpeed: 2 },
    // 180° turn 0.6s + 1 hex 0.67s → ≤ 1.27s (≈ 0.87s for a 60° turn)
    frigate: { name: "Frigate", scale: 0.6, rotationSpeed: 300, moveSpeed: 1.5 },
    // 180° turn 0.75s + 1 hex 0.8s → ≤ 1.55s
    colony_ship: { name: "Colony Ship", scale: 0.55, rotationSpeed: 240, moveSpeed: 1.25 },
    // 180° turn 0.75s + 1 hex 0.8s → ≤ 1.55s
    transport: { name: "Transport", scale: 0.55, rotationSpeed: 240, moveSpeed: 1.25 },
    // 180° turn 0.4s + 1 hex 0.4s → ≤ 0.8s
    fighter_squadron: {
        name: "Fighter Squadron",
        scale: 0.4,
        rotationSpeed: 450,
        moveSpeed: 2.5
    },
    // 180° turn 0.4s + 1 hex 0.4s → ≤ 0.8s
    advanced_fighter_squadron: {
        name: "Advanced Fighter Squadron",
        scale: 0.42,
        rotationSpeed: 450,
        moveSpeed: 2.5
    },
    // 180° turn 0.4s + 1 hex 0.45s → ≤ 0.85s
    bomber_squadron: {
        name: "Bomber Squadron",
        scale: 0.42,
        rotationSpeed: 450,
        moveSpeed: 2.2
    },
    // 180° turn 1.2s + 1 hex 1.0s → ≤ 2.2s
    star_destroyer: { name: "Star Destroyer", scale: 0.8, rotationSpeed: 150, moveSpeed: 1 },
    // 180° turn 1.8s + 1 hex 1.25s → ≤ 3.05s
    super_star_destroyer: {
        name: "Super Star Destroyer",
        scale: 1,
        rotationSpeed: 100,
        moveSpeed: 0.8
    }
};

export function shipDef(shipType: ShipType, balance: EconomyBalance): ShipTypeDefinition {
    return { ...SHIP_TYPE_INFO[shipType], ...balance.ships[shipType] };
}

/** Tier-scaled hp, movement, attack and defence (see `EconomyBalance.shipTiers`). */
export function shipStats(
    shipType: ShipType,
    tier: number,
    balance: EconomyBalance
): { hp: number; maxMovementPoints: number; attack: number; defence: number } {
    const def = balance.ships[shipType];
    const tiers = balance.shipTiers;
    const index = Math.min(Math.max(tier, 1), 3) - 1;
    return {
        hp: Math.ceil(def.hp * tiers.hpMultiplier[index]),
        maxMovementPoints: def.maxMovementPoints + tiers.movementBonus[index],
        attack: Math.max(0, def.attack + (def.attack > 0 ? tiers.attackBonus[index] : 0)),
        defence: Math.max(0, def.defence + tiers.defenceBonus[index])
    };
}
