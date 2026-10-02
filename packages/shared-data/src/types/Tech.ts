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
    "hyperdrive_calibration_2",
    "hyperdrive_range_1",
    "hyperdrive_range_2",
    "evasive_manoeuvres_1",
    "evasive_manoeuvres_2",
    "armoured_freighters",
    "damage_control_1",
    "damage_control_2",
    "capital_ship_engineering",
    "planetary_shields",
    "orbital_defence_platforms"
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
    },
    hyperdrive_range_1: {
        name: "Extended Jump Range",
        description: "Hyperspace jumps reach much further.",
        cost: { money: 100, materials: 0, population: 0, science: 150 },
        buildTurns: 3,
        requires: ["advanced_shipyard"]
    },
    hyperdrive_range_2: {
        name: "Deep Space Jumps",
        description: "Hyperspace jumps can cross the whole map.",
        cost: { money: 200, materials: 0, population: 0, science: 350 },
        buildTurns: 5,
        requires: ["hyperdrive_range_1"]
    },
    evasive_manoeuvres_1: {
        name: "Evasive Manoeuvres I",
        description: "Supply ships are more likely to evade attacks.",
        cost: { money: 50, materials: 0, population: 0, science: 100 },
        buildTurns: 3,
        requires: []
    },
    evasive_manoeuvres_2: {
        name: "Evasive Manoeuvres II",
        description: "Supply ships are much more likely to evade attacks.",
        cost: { money: 100, materials: 0, population: 0, science: 200 },
        buildTurns: 4,
        requires: ["evasive_manoeuvres_1"]
    },
    armoured_freighters: {
        name: "Armoured Freighters",
        description: "Supply ships get more hp and defence.",
        cost: { money: 50, materials: 100, population: 0, science: 120 },
        buildTurns: 3,
        requires: []
    },
    damage_control_1: {
        name: "Damage Control I",
        description: "Damaged ships and supply ships repair faster out of combat.",
        cost: { money: 50, materials: 50, population: 0, science: 100 },
        buildTurns: 3,
        requires: []
    },
    damage_control_2: {
        name: "Damage Control II",
        description: "Damaged ships and supply ships repair much faster out of combat.",
        cost: { money: 100, materials: 100, population: 0, science: 200 },
        buildTurns: 4,
        requires: ["damage_control_1"]
    },
    capital_ship_engineering: {
        name: "Capital Ship Engineering",
        description: "Unlocks the Super Star Destroyer.",
        cost: { money: 200, materials: 0, population: 0, science: 400 },
        buildTurns: 6,
        requires: ["advanced_shipyard"]
    },
    planetary_shields: {
        name: "Planetary Shields",
        description: "Unlocks the Shield Generator.",
        cost: { money: 100, materials: 0, population: 0, science: 150 },
        buildTurns: 3,
        requires: []
    },
    orbital_defence_platforms: {
        name: "Orbital Defence Platforms",
        description: "Unlocks the Orbital Platform.",
        cost: { money: 150, materials: 0, population: 0, science: 250 },
        buildTurns: 4,
        requires: ["advanced_shipyard"]
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
