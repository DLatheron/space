import { z } from "zod";
import { GROUND_UNIT_TYPES, GroundUnit, GroundUnitType } from "./GroundUnitTypes.js";
import {
    EnhancementTier,
    EntityId,
    LARGE_ASTEROID_DEFAULT_SLOTS,
    type LargeAsteroidEntity,
    MOON_DEFAULT_SLOTS,
    type MoonEntity,
    OrderId,
    PLANET_LEVEL_MAX,
    type PlanetEntity,
    ShipType,
    SupplyShipEntity
} from "./PrimitiveTypes.js";
import {
    addResources,
    mapResources,
    minResources,
    RESOURCE_KEYS,
    Resources,
    scaleResources,
    subtractClamped,
    sumResources,
    zeroResources
} from "./Resources.js";
import { SHIP_TYPES } from "./ShipTypes.js";
import { maxEnhancementTierFor, missingTechPrerequisite, TechId, TECHS } from "./Tech.js";

export const StructureType = z.enum([
    "habitat",
    "mine",
    "trade_hub",
    "shipyard",
    "advanced_shipyard",
    "docks",
    "science_academy",
    "barracks"
]);
export type StructureType = z.infer<typeof StructureType>;

/** Kind of location an installation can be built on; `asteroid` means a mineable large asteroid. */
export const StructureSite = z.enum(["planet", "moon", "asteroid"]);
export type StructureSite = z.infer<typeof StructureSite>;

export const BuildPriority = z.enum(["low", "medium", "high"]);
export type BuildPriority = z.infer<typeof BuildPriority>;

/** Funding and dispatch order: high first. */
export const BUILD_PRIORITIES = [
    "high",
    "medium",
    "low"
] as const satisfies readonly BuildPriority[];
export const DEFAULT_BUILD_PRIORITY: BuildPriority = "medium";

/** The installation, ship or ground unit an enhancement upgrades; its type fixes the cost. */
export const EnhancementTarget = z.discriminatedUnion("kind", [
    z.object({
        kind: z.literal("installation"),
        installationId: EntityId,
        structureType: StructureType
    }),
    z.object({ kind: z.literal("ship"), shipId: EntityId, shipType: ShipType }),
    z.object({ kind: z.literal("groundUnit"), unitId: EntityId, unitType: GroundUnitType })
]);
export type EnhancementTarget = z.infer<typeof EnhancementTarget>;

export const BuildItem = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("structure"), structureType: StructureType }),
    z.object({ kind: z.literal("ship"), shipType: ShipType }),
    z.object({ kind: z.literal("groundUnit"), unitType: GroundUnitType }),
    /** Only at a location with a Science Academy; unlocks the tech side-wide. */
    z.object({ kind: z.literal("research"), techId: TechId }),
    /** `tier` is the tier reached on completion (current tier + 1). */
    z.object({ kind: z.literal("enhancement"), target: EnhancementTarget, tier: EnhancementTier })
]);
export type BuildItem = z.infer<typeof BuildItem>;

/**
 * A build in progress. Funding is progress: it completes at the end of the turn in which
 * `applied` reaches `cost`, drawing at most `ratePerTurn` of each resource per turn.
 */
export const BuildOrder = z.object({
    id: OrderId,
    item: BuildItem,
    priority: BuildPriority,
    cost: Resources,
    applied: Resources,
    /** `ceil(cost / buildTurns)` per resource (see `ratePerTurn`). */
    ratePerTurn: Resources
});
export type BuildOrder = z.infer<typeof BuildOrder>;

export const Installation = z.object({
    id: EntityId,
    type: StructureType,
    tier: EnhancementTier,
    /** Location the borrowed population returns to when demolished. */
    populationFrom: EntityId
});
export type Installation = z.infer<typeof Installation>;

/** Private to the owning side; never part of the shared entity data. */
export const LocationEconomy = z.object({
    /** Planet, moon or mineable large asteroid entity id. */
    locationId: EntityId,
    site: StructureSite,
    /** Planet level (drives base income and ship cap); 0 for moons and asteroids. */
    level: z.number().int().min(0).max(PLANET_LEVEL_MAX),
    /** Structure slots (a planet's level, or the moon / asteroid slot count). */
    slots: z.number().int().min(0),
    /** Local production and delivered cargo; builds here draw from it. */
    stockpile: Resources,
    installations: z.array(Installation),
    /** Funded concurrently by priority (see `fundOrders`). */
    orders: z.array(BuildOrder)
});
export type LocationEconomy = z.infer<typeof LocationEconomy>;

export const EconomyState = z.object({
    lastIncome: Resources,
    /** Built ships plus ships still on order. */
    shipCount: z.number().int().min(0),
    shipCap: z.number().int().min(0),
    locations: z.array(LocationEconomy),
    techs: z.array(TechId),
    /** The side's own supply ships, including their routes. */
    supplyShips: z.array(SupplyShipEntity),
    groundUnits: z.array(GroundUnit),
    /** Current supply ship speed (hexes per turn) and capacity (units), after techs. */
    supplySpeed: z.number().int().min(0),
    supplyCapacity: z.number().int().min(0)
});
export type EconomyState = z.infer<typeof EconomyState>;

export type StructureTypeDefinition = {
    name: string;
    description: string;
    /** `cost.population` is borrowed and returns home when the installation is demolished. */
    cost: Resources;
    buildTurns: number;
    sites: StructureSite[];
    /** Structures that must already be built (not merely ordered) at the same location. */
    requires: StructureType[];
    requiresTech?: TechId;
    /** Per-turn output at tier 1, added to the local stockpile (see `structureOutput`). */
    produces?: Partial<Resources>;
    shipCapBonus?: number;
    unlocksShips?: ShipType[];
    unlocksGroundUnits?: GroundUnitType[];
    /** Research orders can be placed at this location. */
    enablesResearch?: boolean;
    /** At most one per location (built or ordered). */
    unique?: boolean;
    /** Highest enhancement tier; 1 means it can't be upgraded. */
    maxTier: number;
};

/** Starting local stockpile at each side's home planet. */
export const STARTING_STOCKPILE: Resources = {
    money: 1000,
    materials: 1000,
    population: 200,
    science: 100
};
export const HOME_PLANET_LEVEL = 10;
/** Owned planets only; moons and asteroids produce solely from installations. */
export const PLANET_BASE_INCOME_PER_LEVEL: Resources = {
    money: 5,
    materials: 5,
    population: 2,
    science: 1
};

export const STRUCTURE_TYPES: Record<StructureType, StructureTypeDefinition> = {
    habitat: {
        name: "Habitat",
        description: "Grows population each turn.",
        cost: { money: 50, materials: 100, population: 0, science: 0 },
        buildTurns: 2,
        sites: ["planet", "moon"],
        requires: [],
        produces: { population: 10 },
        maxTier: 3
    },
    mine: {
        name: "Mine",
        description: "Produces materials each turn.",
        cost: { money: 100, materials: 0, population: 10, science: 0 },
        buildTurns: 2,
        sites: ["planet", "moon", "asteroid"],
        requires: [],
        produces: { materials: 40 },
        maxTier: 3
    },
    trade_hub: {
        name: "Trade Hub",
        description: "Produces money each turn.",
        cost: { money: 0, materials: 100, population: 10, science: 0 },
        buildTurns: 2,
        sites: ["planet", "moon"],
        requires: [],
        produces: { money: 40 },
        maxTier: 3
    },
    shipyard: {
        name: "Shipyard",
        description: "Builds Scouts, Colony Ships and Transports.",
        cost: { money: 150, materials: 200, population: 20, science: 0 },
        buildTurns: 3,
        sites: ["planet"],
        requires: [],
        unlocksShips: ["scout", "colony_ship", "transport"],
        unique: true,
        maxTier: 1
    },
    advanced_shipyard: {
        name: "Advanced Shipyard",
        description: "Builds Frigates.",
        cost: { money: 250, materials: 300, population: 30, science: 0 },
        buildTurns: 4,
        sites: ["planet"],
        requires: ["shipyard"],
        requiresTech: "advanced_shipyard",
        unlocksShips: ["frigate"],
        unique: true,
        maxTier: 1
    },
    docks: {
        name: "Docks",
        description: "Raises the ship cap by 1.",
        cost: { money: 100, materials: 150, population: 10, science: 0 },
        buildTurns: 2,
        sites: ["planet"],
        requires: ["shipyard"],
        shipCapBonus: 1,
        maxTier: 1
    },
    science_academy: {
        name: "Science Academy",
        description: "Produces science each turn and researches techs.",
        cost: { money: 200, materials: 150, population: 20, science: 0 },
        buildTurns: 3,
        sites: ["planet"],
        requires: [],
        produces: { science: 20 },
        enablesResearch: true,
        unique: true,
        maxTier: 3
    },
    barracks: {
        name: "Barracks",
        description: "Trains Infantry and Armour.",
        cost: { money: 100, materials: 150, population: 10, science: 0 },
        buildTurns: 2,
        sites: ["planet", "moon"],
        requires: [],
        requiresTech: "ground_forces",
        unlocksGroundUnits: ["infantry", "armour"],
        unique: true,
        maxTier: 1
    }
};

export type LocationEntity = PlanetEntity | MoonEntity | LargeAsteroidEntity;

/** Build site for a location entity; undefined for asteroids that aren't mineable. */
export function siteForEntity(entity: LocationEntity): StructureSite | undefined {
    switch (entity.kind) {
        case "planet":
            return "planet";
        case "moon":
            return "moon";
        case "large_asteroid":
            return entity.mineable ? "asteroid" : undefined;
    }
}

export function slotsForEntity(entity: LocationEntity): number {
    switch (entity.kind) {
        case "planet":
            return entity.level;
        case "moon":
            return entity.slots ?? MOON_DEFAULT_SLOTS;
        case "large_asteroid":
            return entity.mineable ? (entity.slots ?? LARGE_ASTEROID_DEFAULT_SLOTS) : 0;
    }
}

/** Output multiplier by tier (index = tier - 1). */
export const STRUCTURE_TIER_OUTPUT = [1, 1.5, 2] as const;

export function structureOutput(type: StructureType, tier: number): Resources {
    const base = addResources(zeroResources(), STRUCTURE_TYPES[type].produces ?? {});
    return scaleResources(base, STRUCTURE_TIER_OUTPUT[tier - 1] ?? 1);
}

/** Enhancement cost as a fraction of the target's base cost, by the tier reached. Never costs population. */
export const ENHANCEMENT_COST_FACTOR: Record<number, number> = { 2: 0.5, 3: 1 };

/** Tech that allows ordering enhancements up to `tier`. */
export function enhancementTechFor(tier: number): TechId | undefined {
    return (Object.keys(TECHS) as TechId[]).find((t) => TECHS[t].enhancementTier === tier);
}

export function enhancementTargetId(target: EnhancementTarget): EntityId {
    switch (target.kind) {
        case "installation":
            return target.installationId;
        case "ship":
            return target.shipId;
        case "groundUnit":
            return target.unitId;
    }
}

function enhancementTargetDef(target: EnhancementTarget): {
    name: string;
    cost: Resources;
    buildTurns: number;
    maxTier: number;
} {
    switch (target.kind) {
        case "installation":
            return STRUCTURE_TYPES[target.structureType];
        case "ship":
            return SHIP_TYPES[target.shipType];
        case "groundUnit":
            return GROUND_UNIT_TYPES[target.unitType];
    }
}

export function maxTierFor(target: EnhancementTarget): number {
    return enhancementTargetDef(target).maxTier;
}

export function buildItemCost(item: BuildItem): Resources {
    switch (item.kind) {
        case "structure":
            return STRUCTURE_TYPES[item.structureType].cost;
        case "ship":
            return SHIP_TYPES[item.shipType].cost;
        case "groundUnit":
            return GROUND_UNIT_TYPES[item.unitType].cost;
        case "research":
            return TECHS[item.techId].cost;
        case "enhancement": {
            const base = enhancementTargetDef(item.target).cost;
            const factor = ENHANCEMENT_COST_FACTOR[item.tier] ?? 1;
            return { ...mapResources((k) => Math.ceil(base[k] * factor)), population: 0 };
        }
    }
}

export function buildItemTurns(item: BuildItem): number {
    switch (item.kind) {
        case "structure":
            return STRUCTURE_TYPES[item.structureType].buildTurns;
        case "ship":
            return SHIP_TYPES[item.shipType].buildTurns;
        case "groundUnit":
            return GROUND_UNIT_TYPES[item.unitType].buildTurns;
        case "research":
            return TECHS[item.techId].buildTurns;
        case "enhancement":
            return enhancementTargetDef(item.target).buildTurns;
    }
}

export function buildItemName(item: BuildItem): string {
    switch (item.kind) {
        case "structure":
            return STRUCTURE_TYPES[item.structureType].name;
        case "ship":
            return SHIP_TYPES[item.shipType].name;
        case "groundUnit":
            return GROUND_UNIT_TYPES[item.unitType].name;
        case "research":
            return TECHS[item.techId].name;
        case "enhancement":
            return `${enhancementTargetDef(item.target).name} tier ${item.tier}`;
    }
}

/** Population the completed item borrows (returned home when it is released). */
export function borrowedPopulation(item: BuildItem): number {
    return item.kind === "structure" || item.kind === "ship" || item.kind === "groundUnit"
        ? buildItemCost(item).population
        : 0;
}

/** Most of each resource a build may draw per turn: `ceil(cost / buildTurns)`. */
export function ratePerTurn(cost: Resources, buildTurns: number): Resources {
    const turns = Math.max(1, buildTurns);
    return mapResources((k) => Math.ceil(cost[k] / turns));
}

export function createBuildOrder(
    id: OrderId,
    item: BuildItem,
    priority: BuildPriority = DEFAULT_BUILD_PRIORITY
): BuildOrder {
    const cost = buildItemCost(item);
    return {
        id,
        item,
        priority,
        cost: { ...cost },
        applied: zeroResources(),
        ratePerTurn: ratePerTurn(cost, buildItemTurns(item))
    };
}

export type FundableOrder = Pick<
    BuildOrder,
    "id" | "priority" | "cost" | "applied" | "ratePerTurn"
>;

export function remainingNeed(order: Pick<BuildOrder, "cost" | "applied">): Resources {
    return subtractClamped(order.cost, order.applied);
}

export function isFullyFunded(order: Pick<BuildOrder, "cost" | "applied">): boolean {
    return RESOURCE_KEYS.every((k) => order.applied[k] >= order.cost[k]);
}

export type FundingResult<T extends FundableOrder> = {
    stockpile: Resources;
    /** Amount each order draws this turn, keyed by order id (zero entries included). */
    drawn: Record<OrderId, Resources>;
    /** The input orders, in the same order, with `applied` increased by what they drew. */
    orders: T[];
};

/**
 * One turn of funding from a location's stockpile. Tiers are served high, then medium, then
 * low. Within a tier each resource is split into equal shares, each capped by the order's
 * per-turn rate and remaining need; whatever a capped order can't take is shared among the
 * rest. Indivisible leftover units go to the earliest orders in the list.
 */
export function fundOrders<T extends FundableOrder>(
    stockpile: Resources,
    orders: readonly T[]
): FundingResult<T> {
    const drawn: Record<OrderId, Resources> = {};
    for (const order of orders) {
        drawn[order.id] = zeroResources();
    }
    const left = { ...stockpile };
    for (const priority of BUILD_PRIORITIES) {
        const tier = orders.filter((o) => o.priority === priority);
        for (const k of RESOURCE_KEYS) {
            const caps = new Map<OrderId, number>();
            for (const o of tier) {
                const cap = Math.min(o.ratePerTurn[k], Math.max(0, o.cost[k] - o.applied[k]));
                if (cap > 0) caps.set(o.id, cap);
            }
            left[k] = shareOut(left[k], caps, (id, amount) => {
                drawn[id]![k] += amount;
            });
        }
    }
    return {
        stockpile: left,
        drawn,
        orders: orders.map((o) => ({ ...o, applied: addResources(o.applied, drawn[o.id]!) }))
    };
}

/** Water-fills `available` across `caps` (in insertion order); returns what is left over. */
function shareOut(
    available: number,
    caps: Map<OrderId, number>,
    give: (id: OrderId, amount: number) => void
): number {
    let active = [...caps.keys()];
    while (available > 0 && active.length > 0) {
        const share = Math.floor(available / active.length);
        if (share === 0) {
            for (const id of active) {
                if (available <= 0) break;
                const amount = Math.min(1, available, caps.get(id)!);
                give(id, amount);
                available -= amount;
            }
            break;
        }
        const next: OrderId[] = [];
        for (const id of active) {
            const cap = caps.get(id)!;
            const amount = Math.min(share, cap);
            give(id, amount);
            available -= amount;
            caps.set(id, cap - amount);
            if (cap - amount > 0) next.push(id);
        }
        active = next;
    }
    return available;
}

export type OrderDemand = { orderId: OrderId; priority: BuildPriority; amount: Resources };

/**
 * What each order at a destination still needs delivered: its remaining need, less whatever
 * the local stockpile plus in-flight cargo already covers. Cover goes to high priority first,
 * then list order. Orders with nothing outstanding are omitted; result is sorted by priority.
 */
export function orderDemands(
    stockpile: Resources,
    orders: readonly FundableOrder[],
    inFlight: Resources = zeroResources()
): OrderDemand[] {
    let cover = addResources(stockpile, inFlight);
    const result: OrderDemand[] = [];
    for (const priority of BUILD_PRIORITIES) {
        for (const order of orders.filter((o) => o.priority === priority)) {
            const need = remainingNeed(order);
            const covered = minResources(cover, need);
            cover = subtractClamped(cover, covered);
            const amount = subtractClamped(need, covered);
            if (RESOURCE_KEYS.some((k) => amount[k] > 0)) {
                result.push({ orderId: order.id, priority, amount });
            }
        }
    }
    return result;
}

/** `orderDemands` totalled per priority tier. */
export function locationDemand(
    stockpile: Resources,
    orders: readonly FundableOrder[],
    inFlight: Resources = zeroResources()
): Record<BuildPriority, Resources> {
    const result = { high: zeroResources(), medium: zeroResources(), low: zeroResources() };
    for (const d of orderDemands(stockpile, orders, inFlight)) {
        result[d.priority] = addResources(result[d.priority], d.amount);
    }
    return result;
}

/** Stock a location can send elsewhere: whatever its own orders won't still need. */
export function surplusStock(stockpile: Resources, orders: readonly FundableOrder[]): Resources {
    return subtractClamped(stockpile, sumResources(orders.map(remainingNeed)));
}

/** Splits cargo into loads of at most `capacity` units each, filling one ship before the next. */
export function packCargo(cargo: Resources, capacity: number): Resources[] {
    if (capacity <= 0) return [];
    const loads: Resources[] = [];
    let current = zeroResources();
    let room = capacity;
    for (const k of RESOURCE_KEYS) {
        let amount = cargo[k];
        while (amount > 0) {
            const take = Math.min(amount, room);
            current[k] += take;
            amount -= take;
            room -= take;
            if (room <= 0) {
                loads.push(current);
                current = zeroResources();
                room = capacity;
            }
        }
    }
    if (room < capacity) loads.push(current);
    return loads;
}

/** Structure slots taken at a location: installations plus structures still on order. */
export function slotsUsed(location: Pick<LocationEconomy, "installations" | "orders">): number {
    return (
        location.installations.length +
        location.orders.filter((o) => o.item.kind === "structure").length
    );
}

export function countQueuedShips(locations: Pick<LocationEconomy, "orders">[]): number {
    let count = 0;
    for (const location of locations) {
        count += location.orders.filter((o) => o.item.kind === "ship").length;
    }
    return count;
}

type IncomeSource = Pick<LocationEconomy, "site" | "level" | "installations">;

/** Ships allowed: `1 + floor(level / 5)` per owned planet plus installation bonuses. */
export function shipCapFor(locations: IncomeSource[]): number {
    let cap = 0;
    for (const location of locations) {
        if (location.site === "planet") {
            cap += 1 + Math.floor(location.level / 5);
        }
        for (const inst of location.installations) {
            cap += STRUCTURE_TYPES[inst.type].shipCapBonus ?? 0;
        }
    }
    return cap;
}

/** Per-turn production at one location: planet base income plus installation output. */
export function locationIncome(location: IncomeSource): Resources {
    let income =
        location.site === "planet"
            ? mapResources((k) => PLANET_BASE_INCOME_PER_LEVEL[k] * location.level)
            : zeroResources();
    for (const inst of location.installations) {
        income = addResources(income, structureOutput(inst.type, inst.tier));
    }
    return income;
}

export function incomeFor(locations: IncomeSource[]): Resources {
    return sumResources(locations.map(locationIncome));
}

export type CanBuildResult = { ok: true } | { ok: false; reason: string };

export type BuildContext = {
    /** Built ships plus ships already on order at any location. */
    shipCount: number;
    shipCap: number;
    techs: readonly TechId[];
    /** Techs on order anywhere on the side. */
    researching?: readonly TechId[];
    /**
     * Current tier of the ship or ground unit an enhancement targets, provided only when the
     * caller has checked it is at this location. Installations are looked up directly.
     */
    targetTier?: number;
};

/**
 * Whether `item` may be ordered at `location`. Affordability isn't checked: orders are funded
 * over time from the local stockpile and supply deliveries.
 */
export function canBuild(
    ctx: BuildContext,
    location: LocationEconomy,
    item: BuildItem
): CanBuildResult {
    const built = new Set(location.installations.map((i) => i.type));
    const missingStructure = (requires: StructureType[]): CanBuildResult | undefined => {
        const missing = requires.find((s) => !built.has(s));
        return missing
            ? { ok: false, reason: `Requires ${STRUCTURE_TYPES[missing].name}` }
            : undefined;
    };
    const missingTech = (tech: TechId | undefined): CanBuildResult | undefined =>
        tech && !ctx.techs.includes(tech)
            ? { ok: false, reason: `Requires ${TECHS[tech].name}` }
            : undefined;

    switch (item.kind) {
        case "structure": {
            const def = STRUCTURE_TYPES[item.structureType];
            if (!def.sites.includes(location.site)) {
                const article = location.site === "asteroid" ? "an" : "a";
                return { ok: false, reason: `Can't be built on ${article} ${location.site}` };
            }
            const blocked = missingStructure(def.requires) ?? missingTech(def.requiresTech);
            if (blocked) return blocked;
            if (def.unique) {
                const ordered = location.orders.some(
                    (o) =>
                        o.item.kind === "structure" && o.item.structureType === item.structureType
                );
                if (built.has(item.structureType) || ordered) {
                    return { ok: false, reason: `Only one ${def.name} per location` };
                }
            }
            if (slotsUsed(location) >= location.slots) {
                return { ok: false, reason: "No free structure slots" };
            }
            return { ok: true };
        }
        case "ship": {
            const def = SHIP_TYPES[item.shipType];
            const blocked = missingStructure(def.requires) ?? missingTech(def.requiresTech);
            if (blocked) return blocked;
            if (ctx.shipCount >= ctx.shipCap) {
                return { ok: false, reason: "Ship cap reached" };
            }
            return { ok: true };
        }
        case "groundUnit": {
            const def = GROUND_UNIT_TYPES[item.unitType];
            return missingStructure(def.requires) ?? missingTech(def.requiresTech) ?? { ok: true };
        }
        case "research": {
            const academy = location.installations.some(
                (i) => STRUCTURE_TYPES[i.type].enablesResearch
            );
            if (!academy) {
                return { ok: false, reason: `Requires ${STRUCTURE_TYPES.science_academy.name}` };
            }
            if (ctx.techs.includes(item.techId)) {
                return { ok: false, reason: "Already researched" };
            }
            const ordered = location.orders.some(
                (o) => o.item.kind === "research" && o.item.techId === item.techId
            );
            if (ordered || ctx.researching?.includes(item.techId)) {
                return { ok: false, reason: "Already being researched" };
            }
            const prereq = missingTechPrerequisite(ctx.techs, item.techId);
            return prereq ? { ok: false, reason: `Requires ${TECHS[prereq].name}` } : { ok: true };
        }
        case "enhancement": {
            const target = item.target;
            const targetId = enhancementTargetId(target);
            const current =
                target.kind === "installation"
                    ? location.installations.find(
                          (i) => i.id === targetId && i.type === target.structureType
                      )?.tier
                    : ctx.targetTier;
            if (current === undefined) {
                return { ok: false, reason: "Target not at this location" };
            }
            if (current >= maxTierFor(target)) {
                return { ok: false, reason: "Already at maximum tier" };
            }
            if (item.tier !== current + 1) {
                return { ok: false, reason: `Next upgrade is tier ${current + 1}` };
            }
            if (item.tier > maxEnhancementTierFor(ctx.techs)) {
                const blocked = missingTech(enhancementTechFor(item.tier));
                if (blocked) return blocked;
            }
            const upgrading = location.orders.some(
                (o) =>
                    o.item.kind === "enhancement" &&
                    o.item.target.kind === target.kind &&
                    enhancementTargetId(o.item.target) === targetId
            );
            if (upgrading) {
                return { ok: false, reason: "Already being upgraded" };
            }
            return { ok: true };
        }
    }
}
