import { z } from "zod";
import type { EconomyBalance, GroundUnitBalance } from "./Economy.js";
import { BattleId, EnhancementTier, EntityId, SideId } from "./PrimitiveTypes.js";

export const GroundUnitType = z.enum(["infantry", "armour"]);
export type GroundUnitType = z.infer<typeof GroundUnitType>;

/** Presentation fields; gameplay stats come from `EconomyBalance.groundUnits` (see `groundUnitDef`). */
export type GroundUnitTypeInfo = {
    name: string;
    description: string;
};

export type GroundUnitTypeDefinition = GroundUnitTypeInfo & GroundUnitBalance;

export const GROUND_UNIT_TYPE_INFO: Record<GroundUnitType, GroundUnitTypeInfo> = {
    infantry: { name: "Infantry", description: "Cheap troops, best at holding ground." },
    armour: { name: "Armour", description: "Heavy vehicles that spearhead invasions." }
};

export function groundUnitDef(
    unitType: GroundUnitType,
    balance: EconomyBalance
): GroundUnitTypeDefinition {
    return { ...GROUND_UNIT_TYPE_INFO[unitType], ...balance.groundUnits[unitType] };
}

/** Tier-boosted attack and defence (see `EconomyBalance.groundUnitTiers`). */
export function groundUnitStats(
    unitType: GroundUnitType,
    tier: number,
    balance: EconomyBalance
): { attack: number; defence: number } {
    const def = balance.groundUnits[unitType];
    const index = Math.min(Math.max(tier, 1), 3) - 1;
    return {
        attack: def.attack + balance.groundUnitTiers.attackBonus[index],
        defence: def.defence + balance.groundUnitTiers.defenceBonus[index]
    };
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
