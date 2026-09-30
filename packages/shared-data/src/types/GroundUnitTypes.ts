import { z } from "zod";
import type { StructureType } from "./Economy.js";
import { BattleId, EnhancementTier, EntityId, SideId } from "./PrimitiveTypes.js";
import type { Resources } from "./Resources.js";
import type { TechId } from "./Tech.js";

export const GroundUnitType = z.enum(["infantry", "armour"]);
export type GroundUnitType = z.infer<typeof GroundUnitType>;

export type GroundUnitTypeDefinition = {
    name: string;
    description: string;
    /** `cost.population` is borrowed and returns home when the unit is disbanded or destroyed. */
    cost: Resources;
    buildTurns: number;
    attack: number;
    defence: number;
    /** Structures that must be built at the location training this unit. */
    requires: StructureType[];
    requiresTech?: TechId;
    maxTier: number;
};

export const GROUND_UNIT_TYPES: Record<GroundUnitType, GroundUnitTypeDefinition> = {
    infantry: {
        name: "Infantry",
        description: "Cheap troops, best at holding ground.",
        cost: { money: 50, materials: 30, population: 20, science: 0 },
        buildTurns: 2,
        attack: 2,
        defence: 3,
        requires: ["barracks"],
        requiresTech: "ground_forces",
        maxTier: 3
    },
    armour: {
        name: "Armour",
        description: "Heavy vehicles that spearhead invasions.",
        cost: { money: 120, materials: 150, population: 10, science: 0 },
        buildTurns: 3,
        attack: 5,
        defence: 4,
        requires: ["barracks"],
        requiresTech: "ground_forces",
        maxTier: 3
    }
};

/** Each tier above 1 adds 1 attack and 1 defence. */
export function groundUnitStats(
    unitType: GroundUnitType,
    tier: number
): { attack: number; defence: number } {
    const def = GROUND_UNIT_TYPES[unitType];
    return { attack: def.attack + (tier - 1), defence: def.defence + (tier - 1) };
}

export const GroundUnitLocation = z.discriminatedUnion("kind", [
    /** Stationed at a planet, moon or asteroid (listed in its `garrison`). */
    z.object({ kind: z.literal("garrison"), locationId: EntityId }),
    /** Aboard a transport (listed in its `carriedUnitIds`). */
    z.object({ kind: z.literal("transport"), shipId: EntityId })
]);
export type GroundUnitLocation = z.infer<typeof GroundUnitLocation>;

/** Private to the owning side (see `EconomyState.groundUnits`). */
export const GroundUnit = z.object({
    id: EntityId,
    sideId: SideId,
    unitType: GroundUnitType,
    tier: EnhancementTier,
    /** Location the borrowed population returns to. */
    populationFrom: EntityId,
    location: GroundUnitLocation
});
export type GroundUnit = z.infer<typeof GroundUnit>;

/** What an opponent may see of a unit, e.g. in a ground battle. */
export const GroundUnitSummary = GroundUnit.pick({ id: true, unitType: true, tier: true });
export type GroundUnitSummary = z.infer<typeof GroundUnitSummary>;

/** A pending ground battle: units landed from transports on an enemy location. */
export const GroundBattleInfo = z.object({
    battleId: BattleId,
    locationId: EntityId,
    q: z.number().int(),
    r: z.number().int(),
    /** Invading side; only its clients may resolve the battle. */
    attackerSideId: SideId,
    defenderSideId: SideId,
    attackerUnits: z.array(GroundUnitSummary),
    defenderUnits: z.array(GroundUnitSummary)
});
export type GroundBattleInfo = z.infer<typeof GroundBattleInfo>;
