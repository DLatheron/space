import { z } from "zod";
import type { Resources } from "./Resources.js";

/**
 * Side-wide techs, researched as build orders at a Science Academy. Structures, ships and
 * ground units name the tech they need via `requiresTech`.
 */
export const TechId = z.enum([
    "supply_speed_1",
    "supply_speed_2",
    "supply_capacity_1",
    "supply_capacity_2",
    "ground_forces",
    "advanced_shipyard",
    "transports",
    "enhancement_tier_2",
    "enhancement_tier_3",
    "hyperdrive_calibration_1",
    "hyperdrive_calibration_2"
]);
export type TechId = z.infer<typeof TechId>;

export type TechDefinition = {
    name: string;
    description: string;
    cost: Resources;
    buildTurns: number;
    /** Techs that must already be researched. */
    requires: TechId[];
    /** New supply ship speed in hexes per turn (the highest known value applies). */
    supplySpeed?: number;
    /** New supply ship capacity in units (the highest known value applies). */
    supplyCapacity?: number;
    /** Highest enhancement tier that may be ordered once known. */
    enhancementTier?: number;
};

export const DEFAULT_SUPPLY_SPEED = 6;
export const DEFAULT_SUPPLY_CAPACITY = 100;

export const TECHS: Record<TechId, TechDefinition> = {
    supply_speed_1: {
        name: "Improved Drives",
        description: "Supply ships move 8 hexes per turn.",
        cost: { money: 50, materials: 0, population: 0, science: 100 },
        buildTurns: 3,
        requires: [],
        supplySpeed: 8
    },
    supply_speed_2: {
        name: "Advanced Drives",
        description: "Supply ships move 10 hexes per turn.",
        cost: { money: 100, materials: 0, population: 0, science: 200 },
        buildTurns: 4,
        requires: ["supply_speed_1"],
        supplySpeed: 10
    },
    supply_capacity_1: {
        name: "Expanded Holds",
        description: "Supply ships carry 150 units.",
        cost: { money: 0, materials: 50, population: 0, science: 100 },
        buildTurns: 3,
        requires: [],
        supplyCapacity: 150
    },
    supply_capacity_2: {
        name: "Bulk Freighters",
        description: "Supply ships carry 200 units.",
        cost: { money: 0, materials: 100, population: 0, science: 200 },
        buildTurns: 4,
        requires: ["supply_capacity_1"],
        supplyCapacity: 200
    },
    ground_forces: {
        name: "Ground Forces",
        description: "Unlocks the Barracks, Infantry and Armour.",
        cost: { money: 50, materials: 0, population: 0, science: 80 },
        buildTurns: 2,
        requires: []
    },
    advanced_shipyard: {
        name: "Advanced Shipbuilding",
        description: "Unlocks the Advanced Shipyard.",
        cost: { money: 50, materials: 0, population: 0, science: 120 },
        buildTurns: 3,
        requires: []
    },
    transports: {
        name: "Troop Transports",
        description: "Unlocks the Transport.",
        cost: { money: 50, materials: 0, population: 0, science: 100 },
        buildTurns: 3,
        requires: ["ground_forces"]
    },
    enhancement_tier_2: {
        name: "Refits",
        description: "Installations, ships and ground units can be upgraded to tier 2.",
        cost: { money: 50, materials: 0, population: 0, science: 120 },
        buildTurns: 3,
        requires: [],
        enhancementTier: 2
    },
    enhancement_tier_3: {
        name: "Advanced Refits",
        description: "Installations, ships and ground units can be upgraded to tier 3.",
        cost: { money: 100, materials: 0, population: 0, science: 250 },
        buildTurns: 5,
        requires: ["enhancement_tier_2"],
        enhancementTier: 3
    },
    hyperdrive_calibration_1: {
        name: "Hyperdrive Calibration I",
        description: "Hyperspace jumps land closer to their target.",
        cost: { money: 100, materials: 0, population: 0, science: 150 },
        buildTurns: 3,
        requires: ["advanced_shipyard"]
    },
    hyperdrive_calibration_2: {
        name: "Hyperdrive Calibration II",
        description: "Hyperspace jumps land much closer to their target.",
        cost: { money: 150, materials: 0, population: 0, science: 300 },
        buildTurns: 5,
        requires: ["hyperdrive_calibration_1"]
    }
};

export function supplySpeedFor(techs: readonly TechId[], base = DEFAULT_SUPPLY_SPEED): number {
    return techs.reduce((speed, t) => Math.max(speed, TECHS[t].supplySpeed ?? 0), base);
}

export function supplyCapacityFor(
    techs: readonly TechId[],
    base = DEFAULT_SUPPLY_CAPACITY
): number {
    return techs.reduce((cap, t) => Math.max(cap, TECHS[t].supplyCapacity ?? 0), base);
}

/** Highest enhancement tier a side may order: 1 (no upgrades) until researched. */
export function maxEnhancementTierFor(techs: readonly TechId[]): number {
    return techs.reduce((tier, t) => Math.max(tier, TECHS[t].enhancementTier ?? 0), 1);
}

export function missingTechPrerequisite(
    techs: readonly TechId[],
    techId: TechId
): TechId | undefined {
    return TECHS[techId].requires.find((t) => !techs.includes(t));
}
