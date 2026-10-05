import {
    batteryStats,
    GROUND_UNIT_TYPE_INFO,
    groundUnitDef,
    groundUnitStats,
    GroundUnitType,
    isFullyFunded,
    platformStats,
    RESOURCE_KEYS,
    shieldStats,
    SHIP_TYPE_INFO,
    shipStats,
    ShipType,
    SPACE_STRUCTURE_INFO,
    spaceStructureName,
    spaceStructureStats,
    structureCapBonus,
    structureDef,
    STRUCTURE_INFO,
    structureOutput,
    StructureType,
    TargetClass,
    TECHS,
    TechId,
    type BuildCategory,
    type BuildItem,
    type BuildOrder,
    type BuildPriority,
    type EconomyBalance,
    type EnhancementTarget,
    type GroundUnit,
    type LocationEconomy,
    type Resources,
    type ShipClass,
    type SpaceStructureType
} from "@space/shared-data";
import { formatNumber, RESOURCE_LABELS, RESOURCE_SHORT_LABELS } from "../../components/format.js";

/** Low to high, as shown in the priority control. */
export const PRIORITY_OPTIONS: BuildPriority[] = ["low", "medium", "high"];

export const PRIORITY_LABELS: Record<BuildPriority, string> = {
    low: "Low",
    medium: "Medium",
    high: "High"
};

export const CATEGORY_LABELS: Record<BuildCategory, string> = {
    ships: "Ships",
    installations: "Installations",
    groundUnits: "Ground units",
    research: "Research"
};

export const STRUCTURE_ITEMS: BuildItem[] = StructureType.options.map((structureType) => ({
    kind: "structure",
    structureType
}));

export const SHIP_ITEMS: BuildItem[] = ShipType.options.map((shipType) => ({
    kind: "ship",
    shipType
}));

export const GROUND_UNIT_ITEMS: BuildItem[] = GroundUnitType.options.map((unitType) => ({
    kind: "groundUnit",
    unitType
}));

export const RESEARCH_ITEMS: BuildItem[] = TechId.options.map((techId) => ({
    kind: "research",
    techId
}));

export function itemKey(item: BuildItem): string {
    switch (item.kind) {
        case "structure":
            return `structure:${item.structureType}`;
        case "spaceStructure":
            return `spaceStructure:${item.structureType}`;
        case "ship":
            return `ship:${item.shipType}`;
        case "groundUnit":
            return `groundUnit:${item.unitType}`;
        case "research":
            return `research:${item.techId}`;
        case "enhancement":
            return `enhancement:${item.target.kind}:${item.tier}`;
    }
}

export function outputSummary(output: Partial<Resources>): string[] {
    return RESOURCE_KEYS.filter((key) => output[key]).map(
        (key) => `+${formatNumber(output[key] ?? 0)} ${RESOURCE_SHORT_LABELS[key]}/turn`
    );
}

export function capSummary(bonus: Resources): string[] {
    return RESOURCE_KEYS.filter((key) => bonus[key]).map(
        (key) => `+${formatNumber(bonus[key])} ${RESOURCE_SHORT_LABELS[key]} cap`
    );
}

const SHIP_CLASS_LABELS: Record<ShipClass, string> = {
    strike_craft: "Strike craft",
    capital: "Capital ship",
    support: "Support ship"
};

const TARGET_CLASS_LABELS: Record<TargetClass, string> = {
    strike_craft: "strike craft",
    capital: "capital ships",
    support: "support ships",
    orbital_platform: "orbital platforms"
};

/** Tier 1 combat stats of a defensive structure; empty for other structures. */
export function defenceSummary(type: StructureType, balance: EconomyBalance): string[] {
    switch (type) {
        case "defensive_battery": {
            const { attack, defence } = batteryStats(1, balance);
            return [`Attack ${attack}`, `Defence ${defence}`];
        }
        case "shield_generator": {
            const { capacity, rechargePerTurn, upkeep } = shieldStats(1, balance);
            const cost = RESOURCE_KEYS.filter((key) => upkeep[key] > 0)
                .map((key) => `${formatNumber(upkeep[key])} ${RESOURCE_SHORT_LABELS[key]}`)
                .join(" + ");
            return [
                `${formatNumber(capacity)} shield HP`,
                `+${formatNumber(rechargePerTurn)} HP/turn`,
                ...(cost ? [`Upkeep ${cost}/turn`] : [])
            ];
        }
        case "orbital_platform": {
            const { attack, defence, hp } = platformStats(1, balance);
            return [`${formatNumber(hp)} HP`, `Attack ${attack}`, `Defence ${defence}`];
        }
        default:
            return [];
    }
}

export function itemDescription(item: BuildItem, balance: EconomyBalance): string | undefined {
    switch (item.kind) {
        case "structure":
            return structureDef(item.structureType, balance).description;
        case "groundUnit":
            return groundUnitDef(item.unitType, balance).description;
        case "research":
            return TECHS[item.techId].description;
        case "spaceStructure":
            return SPACE_STRUCTURE_INFO[item.structureType].description;
        case "ship":
        case "enhancement":
            return undefined;
    }
}

/** Tier-scaled combat, vision and support stats of a space structure, as short chips. */
export function spaceStructureSummary(
    type: SpaceStructureType,
    tier: number,
    balance: EconomyBalance
): string[] {
    const def = balance.spaceStructures[type];
    const stats = spaceStructureStats(type, tier, balance);
    const chips = [`${formatNumber(stats.hp)} HP`];
    if (stats.attack > 0) chips.push(`Attack ${stats.attack}`);
    chips.push(`Defence ${stats.defence}`);
    if (stats.fireRadius > 0) {
        chips.push(`Fires ${stats.fireRadius} hex${stats.fireRadius === 1 ? "" : "es"}`);
    }
    chips.push(`Vision ${stats.visionRange}`);
    if (def.repairBonus > 0) chips.push(`+${Math.round(def.repairBonus * 100)}% repair`);
    if (def.shipSlots > 0)
        chips.push(`Builds ${def.shipSlots} ship${def.shipSlots === 1 ? "" : "s"}`);
    return chips;
}

/** Output, stats and footprint of a new build, as short chips. */
export function itemStats(item: BuildItem, balance: EconomyBalance): string[] {
    switch (item.kind) {
        case "ship": {
            const def = balance.ships[item.shipType];
            const { attack, defence } = shipStats(item.shipType, 1, balance);
            const stats = [
                `${def.maxMovementPoints} MP`,
                `${def.hp} HP`,
                `Attack ${attack}`,
                `Defence ${defence}`
            ];
            stats.push(SHIP_CLASS_LABELS[def.class]);
            for (const target of TargetClass.options) {
                const multiplier = def.attackMultipliers[target];
                if (multiplier !== undefined && multiplier !== 1) {
                    stats.push(`×${formatNumber(multiplier)} vs ${TARGET_CLASS_LABELS[target]}`);
                }
            }
            if (!def.repairsInSpace) stats.push("Repairs only docked or carried");
            if (def.canColonise) stats.push("Can colonise");
            if (def.canBombard) stats.push("Can bombard");
            if (def.unitCapacity) stats.push(`Carries ${def.unitCapacity} units`);
            if (def.hangar?.capacity) {
                const kinds = def.hangar.carries.map((t) => SHIP_TYPE_INFO[t].name).join(", ");
                stats.push(`Hangar for ${def.hangar.capacity} (${kinds})`);
            }
            return stats;
        }
        case "structure": {
            const def = structureDef(item.structureType, balance);
            const stats = [
                ...outputSummary(def.produces ?? {}),
                ...capSummary(structureCapBonus(item.structureType, 1, balance))
            ];
            stats.push(...defenceSummary(item.structureType, balance));
            if (def.shipCapBonus) stats.push(`+${def.shipCapBonus} ship cap`);
            if (def.pillageProtection) {
                stats.push(`${Math.round(def.pillageProtection * 100)}% pillage protection`);
            }
            const slots = def.slots ?? 1;
            stats.push(`Uses ${slots} slot${slots === 1 ? "" : "s"}`);
            if (def.unique) stats.push("One per location");
            return stats;
        }
        case "groundUnit": {
            const def = groundUnitDef(item.unitType, balance);
            return [`Attack ${def.attack}`, `Defence ${def.defence}`, `${def.hp} HP`];
        }
        case "spaceStructure":
            return spaceStructureSummary(item.structureType, 1, balance);
        case "research":
        case "enhancement":
            return [];
    }
}

/** Ready-order status text; ready orders complete at the start of the next end of turn. */
export const READY_LABEL = "Complete · ready next turn";

/**
 * The location as next end of turn's funding sees it: ready orders have completed, adding
 * installations and installation tiers. Other completions don't affect funding here.
 */
export function settleReadyOrders(economy: LocationEconomy): LocationEconomy {
    const ready = economy.orders.filter(isFullyFunded);
    if (ready.length === 0) return economy;
    const installations = economy.installations.map((inst) => {
        const tier = ready.flatMap(({ item }) =>
            item.kind === "enhancement" &&
            item.target.kind === "installation" &&
            item.target.installationId === inst.id
                ? [item.tier]
                : []
        )[0];
        return tier ? { ...inst, tier } : inst;
    });
    for (const order of ready) {
        if (order.item.kind !== "structure") continue;
        installations.push({
            id: order.id,
            type: order.item.structureType,
            tier: 1,
            populationFrom: economy.locationId
        });
    }
    return {
        ...economy,
        installations,
        orders: economy.orders.filter((o) => !isFullyFunded(o))
    };
}

/** Share of the total cost applied so far, 0-1. */
export function orderProgress(order: Pick<BuildOrder, "cost" | "applied">): number {
    let cost = 0;
    let applied = 0;
    for (const key of RESOURCE_KEYS) {
        cost += order.cost[key];
        applied += Math.min(order.cost[key], order.applied[key]);
    }
    return cost > 0 ? applied / cost : 1;
}

export type UpgradeItem = Extract<BuildItem, { kind: "enhancement" }>;

export function upgradeItem(target: EnhancementTarget, currentTier: number): UpgradeItem {
    return { kind: "enhancement", target, tier: currentTier + 1 };
}

export function targetTypeName(target: EnhancementTarget): string {
    switch (target.kind) {
        case "installation":
            return STRUCTURE_INFO[target.structureType].name;
        case "ship":
            return SHIP_TYPE_INFO[target.shipType].name;
        case "groundUnit":
            return GROUND_UNIT_TYPE_INFO[target.unitType].name;
        case "spaceStructure":
            return spaceStructureName(target.structureType);
    }
}

export type TierStat = { label: string; value: number; text: string };

/** Stats an upgrade changes, at `tier`, in a stable order for side-by-side comparison. */
export function tierStats(
    target: EnhancementTarget,
    tier: number,
    balance: EconomyBalance
): TierStat[] {
    switch (target.kind) {
        case "installation": {
            const type = target.structureType;
            const base = structureOutput(type, 1, balance);
            const baseCap = structureCapBonus(type, 1, balance);
            const output = structureOutput(type, tier, balance);
            const cap = structureCapBonus(type, tier, balance);
            return [
                ...RESOURCE_KEYS.filter((key) => base[key] > 0).map((key) => ({
                    label: `${RESOURCE_LABELS[key]} output`,
                    value: output[key],
                    text: `+${formatNumber(output[key])}/turn`
                })),
                ...RESOURCE_KEYS.filter((key) => baseCap[key] > 0).map((key) => ({
                    label: `${RESOURCE_LABELS[key]} cap`,
                    value: cap[key],
                    text: `+${formatNumber(cap[key])}`
                }))
            ];
        }
        case "ship": {
            const stats = shipStats(target.shipType, tier, balance);
            return [
                { label: "Hull", value: stats.hp, text: `${formatNumber(stats.hp)} HP` },
                {
                    label: "Movement",
                    value: stats.maxMovementPoints,
                    text: `${stats.maxMovementPoints} MP`
                },
                { label: "Attack", value: stats.attack, text: `${stats.attack}` },
                { label: "Defence", value: stats.defence, text: `${stats.defence}` }
            ];
        }
        case "groundUnit": {
            const stats = groundUnitStats(target.unitType, tier, balance);
            return [
                { label: "Attack", value: stats.attack, text: `${stats.attack}` },
                { label: "Defence", value: stats.defence, text: `${stats.defence}` }
            ];
        }
        case "spaceStructure": {
            const stats = spaceStructureStats(target.structureType, tier, balance);
            return [
                { label: "Hull", value: stats.hp, text: `${formatNumber(stats.hp)} HP` },
                ...(stats.attack > 0
                    ? [{ label: "Attack", value: stats.attack, text: `${stats.attack}` }]
                    : []),
                { label: "Defence", value: stats.defence, text: `${stats.defence}` },
                {
                    label: "Vision",
                    value: stats.visionRange,
                    text: `${stats.visionRange} hexes`
                }
            ];
        }
    }
}

/** Tier-boosted "attack/defence". */
export function unitStatsLabel(unit: GroundUnit, balance: EconomyBalance): string {
    const stats = groundUnitStats(unit.unitType, unit.tier, balance);
    return `${stats.attack}/${stats.defence}`;
}
