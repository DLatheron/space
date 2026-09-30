import { z } from "zod";
import {
    GROUND_UNIT_TYPE_INFO,
    GroundUnit,
    groundUnitDef,
    GroundUnitType
} from "./GroundUnitTypes.js";
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
import { SHIP_TYPE_INFO, shipDef } from "./ShipTypes.js";
import { maxEnhancementTierFor, missingTechPrerequisite, TechId, TECHS } from "./Tech.js";

export const StructureType = z.enum([
    "habitat",
    "mine",
    "trade_hub",
    "shipyard",
    "advanced_shipyard",
    "docks",
    "science_academy",
    "barracks",
    "vault",
    "depot",
    "archive",
    "quarters",
    "warehouse"
]);
export type StructureType = z.infer<typeof StructureType>;

/** Installations that only raise the location's stockpile caps; their stats come from `EconomyBalance`. */
export const StorageStructureType = StructureType.extract([
    "vault",
    "depot",
    "archive",
    "quarters",
    "warehouse"
]);
export type StorageStructureType = z.infer<typeof StorageStructureType>;
export const BaseStructureType = StructureType.exclude(StorageStructureType.options);
export type BaseStructureType = z.infer<typeof BaseStructureType>;

export function isStorageStructure(type: StructureType): type is StorageStructureType {
    return (StorageStructureType.options as readonly StructureType[]).includes(type);
}

/** Kind of location an installation can be built on; `asteroid` means a mineable large asteroid. */
export const StructureSite = z.enum(["planet", "moon", "asteroid"]);
export type StructureSite = z.infer<typeof StructureSite>;

/** Kinds of work each location can only run a limited number of at once (see `buildSlots`). */
export const BuildCategory = z.enum(["ships", "installations", "groundUnits", "research"]);
export type BuildCategory = z.infer<typeof BuildCategory>;
export const BUILD_CATEGORIES = BuildCategory.options;

export const BuildSlots = z.object({
    ships: z.number().int().min(0),
    installations: z.number().int().min(0),
    groundUnits: z.number().int().min(0),
    research: z.number().int().min(0)
});
export type BuildSlots = z.infer<typeof BuildSlots>;

export const StorageStructureBalance = z.object({
    cost: Resources,
    buildTurns: z.number().int().positive(),
    sites: z.array(StructureSite).min(1),
    /** Structure slots it occupies. */
    slots: z.number().int().min(0),
    /** Cap increase at tier 1, scaled by tier like output (see `EconomyBalance.structureTierOutput`). */
    capBonus: Resources,
    /** Share of the stockpile protected from pillage (0-1). Not used yet. */
    pillageProtection: z.number().min(0).max(1),
    maxTier: z.number().int().min(1).max(3)
});
export type StorageStructureBalance = z.infer<typeof StorageStructureBalance>;

const MaxTier = z.number().int().min(1).max(3);
/** One value per enhancement tier (index = tier - 1). */
const PerTier = <T extends z.ZodType>(value: T) => z.tuple([value, value, value]);

export const StructureBalance = z.object({
    /** `cost.population` is borrowed and returns home when the installation is demolished. */
    cost: Resources,
    buildTurns: z.number().int().positive(),
    sites: z.array(StructureSite).min(1),
    /** Structures that must already be built (not merely ordered) at the same location. */
    requires: z.array(StructureType),
    requiresTech: TechId.nullable(),
    /** Per-turn output at tier 1, added to the local stockpile (see `structureOutput`). */
    produces: Resources,
    shipCapBonus: z.number().int().min(0),
    /** At most one per location (built or ordered). */
    unique: z.boolean(),
    /** Structure slots it occupies. */
    slots: z.number().int().min(0),
    maxTier: MaxTier
});
export type StructureBalance = z.infer<typeof StructureBalance>;

export const ShipBalance = z.object({
    /** `cost.population` is the crew, borrowed and returned home when the ship is lost. */
    cost: Resources,
    buildTurns: z.number().int().positive(),
    maxMovementPoints: z.number().int().min(0),
    hp: z.number().int().positive(),
    /** Structures that must be built on the planet building this ship. */
    requires: z.array(StructureType),
    requiresTech: TechId.nullable(),
    maxTier: MaxTier,
    /** Ground units it can carry. */
    unitCapacity: z.number().int().min(0),
    /** Can be consumed to claim an unowned planet, moon or mineable asteroid on its hex. */
    canColonise: z.boolean()
});
export type ShipBalance = z.infer<typeof ShipBalance>;

export const GroundUnitBalance = z.object({
    /** `cost.population` is borrowed and returns home when the unit is disbanded or destroyed. */
    cost: Resources,
    buildTurns: z.number().int().positive(),
    attack: z.number().int().min(0),
    defence: z.number().int().min(0),
    /** Structures that must be built at the location training this unit. */
    requires: z.array(StructureType),
    requiresTech: TechId.nullable(),
    maxTier: MaxTier
});
export type GroundUnitBalance = z.infer<typeof GroundUnitBalance>;

/** Server-configured economy balance, sent to clients so previews and checks match the server. */
export const EconomyBalance = z.object({
    /** Local stockpile each side's home planet starts with. */
    startingStockpile: Resources,
    /** Ships each side starts with near its home planet. */
    startingShips: z.array(ShipType),
    /** Owned planets only; moons and asteroids produce solely from installations. */
    planetBaseIncomePerLevel: Resources,
    /** Installation output and storage cap bonus multiplier by tier. */
    structureTierOutput: PerTier(z.number().min(0)),
    /** Enhancement cost as a fraction of the target's base cost, by the tier reached. */
    enhancementCostFactor: z.object({ "2": z.number().min(0), "3": z.number().min(0) }),
    structures: z.record(BaseStructureType, StructureBalance),
    ships: z.record(ShipType, ShipBalance),
    shipTiers: z.object({
        hpMultiplier: PerTier(z.number().positive()),
        movementBonus: PerTier(z.number().int())
    }),
    groundUnits: z.record(GroundUnitType, GroundUnitBalance),
    groundUnitTiers: z.object({
        attackBonus: PerTier(z.number().int()),
        defenceBonus: PerTier(z.number().int())
    }),
    stockpileCaps: z.object({
        /** Base cap for every location except home planets. */
        default: Resources,
        home: Resources
    }),
    storageStructures: z.record(StorageStructureType, StorageStructureBalance),
    buildSlots: z.object({
        /** Concurrent orders per category at every location. */
        base: BuildSlots,
        /** Added per built installation of that type. */
        structures: z.partialRecord(StructureType, BuildSlots.partial())
    })
});
export type EconomyBalance = z.infer<typeof EconomyBalance>;

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
    /** A side's starting planet, which uses the home stockpile caps. */
    home: z.boolean().optional(),
    /** Local production and delivered cargo; builds here draw from it (see `stockpileCap`). */
    stockpile: Resources,
    installations: z.array(Installation),
    /** Active orders (see `partitionOrders`) are funded concurrently by priority (see `fundOrders`). */
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
    requiresTech?: TechId | null;
    /** Per-turn output at tier 1, added to the local stockpile (see `structureOutput`). */
    produces?: Resources;
    shipCapBonus?: number;
    /** Ships / ground units whose `requires` names this structure. */
    unlocksShips?: ShipType[];
    unlocksGroundUnits?: GroundUnitType[];
    /** Research orders can be placed at this location. */
    enablesResearch?: boolean;
    /** At most one per location (built or ordered). */
    unique?: boolean;
    /** Highest enhancement tier; 1 means it can't be upgraded. */
    maxTier: number;
    /** Structure slots it occupies; 1 when absent. */
    slots?: number;
    /** Stockpile cap increase at tier 1 (storage structures). */
    capBonus?: Resources;
    /** Share of the stockpile protected from pillage, 0-1 (storage structures; not used yet). */
    pillageProtection?: number;
};

export const HOME_PLANET_LEVEL = 10;

/** Presentation and fixed behaviour; gameplay stats come from `EconomyBalance` (see `structureDef`). */
export const STRUCTURE_INFO: Record<
    StructureType,
    { name: string; description: string; enablesResearch?: boolean }
> = {
    habitat: { name: "Habitat", description: "Grows population each turn." },
    mine: { name: "Mine", description: "Produces materials each turn." },
    trade_hub: { name: "Trade Hub", description: "Produces money each turn." },
    shipyard: { name: "Shipyard", description: "Builds Scouts, Colony Ships and Transports." },
    advanced_shipyard: { name: "Advanced Shipyard", description: "Builds Frigates." },
    docks: { name: "Docks", description: "Raises the ship cap." },
    science_academy: {
        name: "Science Academy",
        description: "Produces science each turn and researches techs.",
        enablesResearch: true
    },
    barracks: { name: "Barracks", description: "Trains Infantry and Armour." },
    vault: { name: "Vault", description: "Raises the money cap." },
    depot: { name: "Depot", description: "Raises the materials cap." },
    archive: { name: "Archive", description: "Raises the science cap." },
    quarters: { name: "Quarters", description: "Raises the population cap." },
    warehouse: { name: "Warehouse", description: "Raises every stockpile cap a little." }
};

export function structureDef(
    type: StructureType,
    balance: EconomyBalance
): StructureTypeDefinition {
    if (!isStorageStructure(type)) {
        const unlocking = <K extends string>(defs: Record<K, { requires: StructureType[] }>) =>
            (Object.keys(defs) as K[]).filter((k) => defs[k].requires.includes(type));
        return {
            ...STRUCTURE_INFO[type],
            ...balance.structures[type],
            unlocksShips: unlocking(balance.ships),
            unlocksGroundUnits: unlocking(balance.groundUnits)
        };
    }
    const stats = balance.storageStructures[type];
    return {
        ...STRUCTURE_INFO[type],
        cost: stats.cost,
        buildTurns: stats.buildTurns,
        sites: stats.sites,
        requires: [],
        maxTier: stats.maxTier,
        slots: stats.slots,
        capBonus: stats.capBonus,
        pillageProtection: stats.pillageProtection
    };
}

export function structureName(type: StructureType): string {
    return STRUCTURE_INFO[type].name;
}

/** Balance stats for non-storage structures (undefined for storage structures). */
function baseStats(type: StructureType, balance: EconomyBalance): StructureBalance | undefined {
    return isStorageStructure(type) ? undefined : balance.structures[type];
}

function tierMultiplier(tier: number, balance: EconomyBalance): number {
    return balance.structureTierOutput[tier - 1] ?? 1;
}

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

export function structureOutput(
    type: StructureType,
    tier: number,
    balance: EconomyBalance
): Resources {
    const base = baseStats(type, balance)?.produces ?? zeroResources();
    return scaleResources(base, tierMultiplier(tier, balance));
}

/** Stockpile cap increase from one storage installation at `tier` (zero for other structures). */
export function structureCapBonus(
    type: StructureType,
    tier: number,
    balance: EconomyBalance
): Resources {
    const bonus = structureDef(type, balance).capBonus ?? zeroResources();
    return scaleResources(bonus, tierMultiplier(tier, balance));
}

/**
 * Most of each resource a location's stockpile holds: the base (home or default) cap plus
 * storage installations. Production beyond it is lost; supply ships wait for room.
 */
export function stockpileCap(
    location: Pick<LocationEconomy, "home" | "installations">,
    balance: EconomyBalance
): Resources {
    let cap = { ...(location.home ? balance.stockpileCaps.home : balance.stockpileCaps.default) };
    for (const inst of location.installations) {
        cap = addResources(cap, structureCapBonus(inst.type, inst.tier, balance));
    }
    return cap;
}

/** Room left under `cap` (zero where the stockpile is at or over it). */
export function storageRoom(stockpile: Resources, cap: Resources): Resources {
    return subtractClamped(cap, stockpile);
}

export type CappedDeposit = { stockpile: Resources; accepted: Resources; overflow: Resources };

/** Adds what fits under `cap`; a stockpile already over the cap keeps its excess. */
export function depositCapped(
    stockpile: Resources,
    amount: Resources,
    cap: Resources
): CappedDeposit {
    const accepted = minResources(amount, storageRoom(stockpile, cap));
    return {
        stockpile: addResources(stockpile, accepted),
        accepted,
        overflow: subtractClamped(amount, accepted)
    };
}

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

function enhancementTargetDef(
    target: EnhancementTarget,
    balance: EconomyBalance
): {
    name: string;
    cost: Resources;
    buildTurns: number;
    maxTier: number;
} {
    switch (target.kind) {
        case "installation":
            return structureDef(target.structureType, balance);
        case "ship":
            return shipDef(target.shipType, balance);
        case "groundUnit":
            return groundUnitDef(target.unitType, balance);
    }
}

export function maxTierFor(target: EnhancementTarget, balance: EconomyBalance): number {
    return enhancementTargetDef(target, balance).maxTier;
}

export function buildItemCost(item: BuildItem, balance: EconomyBalance): Resources {
    switch (item.kind) {
        case "structure":
            return structureDef(item.structureType, balance).cost;
        case "ship":
            return balance.ships[item.shipType].cost;
        case "groundUnit":
            return balance.groundUnits[item.unitType].cost;
        case "research":
            return TECHS[item.techId].cost;
        case "enhancement": {
            const base = enhancementTargetDef(item.target, balance).cost;
            const factors = balance.enhancementCostFactor;
            const factor = item.tier === 2 ? factors["2"] : item.tier === 3 ? factors["3"] : 1;
            return { ...mapResources((k) => Math.ceil(base[k] * factor)), population: 0 };
        }
    }
}

export function buildItemTurns(item: BuildItem, balance: EconomyBalance): number {
    switch (item.kind) {
        case "structure":
            return structureDef(item.structureType, balance).buildTurns;
        case "ship":
            return balance.ships[item.shipType].buildTurns;
        case "groundUnit":
            return balance.groundUnits[item.unitType].buildTurns;
        case "research":
            return TECHS[item.techId].buildTurns;
        case "enhancement":
            return enhancementTargetDef(item.target, balance).buildTurns;
    }
}

function enhancementTargetName(target: EnhancementTarget): string {
    switch (target.kind) {
        case "installation":
            return structureName(target.structureType);
        case "ship":
            return SHIP_TYPE_INFO[target.shipType].name;
        case "groundUnit":
            return GROUND_UNIT_TYPE_INFO[target.unitType].name;
    }
}

export function buildItemName(item: BuildItem): string {
    switch (item.kind) {
        case "structure":
            return structureName(item.structureType);
        case "ship":
            return SHIP_TYPE_INFO[item.shipType].name;
        case "groundUnit":
            return GROUND_UNIT_TYPE_INFO[item.unitType].name;
        case "research":
            return TECHS[item.techId].name;
        case "enhancement":
            return `${enhancementTargetName(item.target)} tier ${item.tier}`;
    }
}

/** Population the completed item borrows (returned home when it is released). */
export function borrowedPopulation(item: BuildItem, balance: EconomyBalance): number {
    return item.kind === "structure" || item.kind === "ship" || item.kind === "groundUnit"
        ? buildItemCost(item, balance).population
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
    balance: EconomyBalance,
    priority: BuildPriority = DEFAULT_BUILD_PRIORITY
): BuildOrder {
    const cost = buildItemCost(item, balance);
    return {
        id,
        item,
        priority,
        cost: { ...cost },
        applied: zeroResources(),
        ratePerTurn: ratePerTurn(cost, buildItemTurns(item, balance))
    };
}

/**
 * The concurrency limit an item counts against. Installation upgrades share the
 * installations limit; ship and ground unit upgrades aren't limited.
 */
export function buildCategory(item: BuildItem): BuildCategory | undefined {
    switch (item.kind) {
        case "structure":
            return "installations";
        case "ship":
            return "ships";
        case "groundUnit":
            return "groundUnits";
        case "research":
            return "research";
        case "enhancement":
            return item.target.kind === "installation" ? "installations" : undefined;
    }
}

/** Orders a location may run at once per category: the base plus built installations' bonuses. */
export function buildSlots(
    location: Pick<LocationEconomy, "installations">,
    balance: EconomyBalance
): BuildSlots {
    const slots = { ...balance.buildSlots.base };
    for (const inst of location.installations) {
        const bonus = balance.buildSlots.structures[inst.type];
        if (!bonus) continue;
        for (const category of BUILD_CATEGORIES) slots[category] += bonus[category] ?? 0;
    }
    return slots;
}

export type OrderPartition<T> = {
    /** Funded and generating supply demand; in list order. */
    active: T[];
    /** Over their category's limit: not funded and no demand until a slot frees up. */
    waiting: T[];
};

/**
 * Splits a location's orders by its `buildSlots`: within each category the highest priority
 * orders are active, older first (list order is placement order). Uncategorised orders
 * are always active.
 */
export function partitionOrders<T extends Pick<BuildOrder, "id" | "item" | "priority">>(
    location: Pick<LocationEconomy, "installations"> & { orders: readonly T[] },
    balance: EconomyBalance
): OrderPartition<T> {
    const slots = buildSlots(location, balance);
    const activeIds = new Set<OrderId>();
    const tier = (o: T) => BUILD_PRIORITIES.indexOf(o.priority);
    for (const category of BUILD_CATEGORIES) {
        const candidates = location.orders
            .filter((o) => buildCategory(o.item) === category)
            .sort((a, b) => tier(a) - tier(b));
        for (const o of candidates.slice(0, slots[category])) activeIds.add(o.id);
    }
    const active: T[] = [];
    const waiting: T[] = [];
    for (const o of location.orders) {
        if (buildCategory(o.item) === undefined || activeIds.has(o.id)) active.push(o);
        else waiting.push(o);
    }
    return { active, waiting };
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

function structureSlots(type: StructureType, balance: EconomyBalance): number {
    return structureDef(type, balance).slots ?? 1;
}

/** Structure slots taken at a location: installations plus structures still on order. */
export function slotsUsed(
    location: Pick<LocationEconomy, "installations" | "orders">,
    balance: EconomyBalance
): number {
    let used = 0;
    for (const inst of location.installations) used += structureSlots(inst.type, balance);
    for (const order of location.orders) {
        if (order.item.kind === "structure") {
            used += structureSlots(order.item.structureType, balance);
        }
    }
    return used;
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
export function shipCapFor(locations: IncomeSource[], balance: EconomyBalance): number {
    let cap = 0;
    for (const location of locations) {
        if (location.site === "planet") {
            cap += 1 + Math.floor(location.level / 5);
        }
        for (const inst of location.installations) {
            cap += baseStats(inst.type, balance)?.shipCapBonus ?? 0;
        }
    }
    return cap;
}

/** Per-turn production at one location: planet base income plus installation output. */
export function locationIncome(location: IncomeSource, balance: EconomyBalance): Resources {
    const perLevel = balance.planetBaseIncomePerLevel;
    let income =
        location.site === "planet"
            ? mapResources((k) => perLevel[k] * location.level)
            : zeroResources();
    for (const inst of location.installations) {
        income = addResources(income, structureOutput(inst.type, inst.tier, balance));
    }
    return income;
}

export function incomeFor(locations: IncomeSource[], balance: EconomyBalance): Resources {
    return sumResources(locations.map((l) => locationIncome(l, balance)));
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
    balance: EconomyBalance;
};

const CATEGORY_LABELS: Record<BuildCategory, string> = {
    ships: "ship",
    installations: "installation",
    groundUnits: "ground unit",
    research: "research"
};

/**
 * Whether `item` may be ordered at `location`. Affordability isn't checked: orders are funded
 * over time from the local stockpile and supply deliveries. Orders over the location's
 * concurrency limit are allowed (they wait), but not in a category it has no slots for.
 */
export function canBuild(
    ctx: BuildContext,
    location: LocationEconomy,
    item: BuildItem
): CanBuildResult {
    const result = canBuildItem(ctx, location, item);
    if (!result.ok) return result;
    const category = buildCategory(item);
    if (category && buildSlots(location, ctx.balance)[category] <= 0) {
        return { ok: false, reason: `No ${CATEGORY_LABELS[category]} build slots here` };
    }
    return result;
}

function canBuildItem(
    ctx: BuildContext,
    location: LocationEconomy,
    item: BuildItem
): CanBuildResult {
    const balance = ctx.balance;
    const built = new Set(location.installations.map((i) => i.type));
    const missingStructure = (requires: StructureType[]): CanBuildResult | undefined => {
        const missing = requires.find((s) => !built.has(s));
        return missing ? { ok: false, reason: `Requires ${structureName(missing)}` } : undefined;
    };
    const missingTech = (tech: TechId | null | undefined): CanBuildResult | undefined =>
        tech && !ctx.techs.includes(tech)
            ? { ok: false, reason: `Requires ${TECHS[tech].name}` }
            : undefined;

    switch (item.kind) {
        case "structure": {
            const def = structureDef(item.structureType, balance);
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
            if (slotsUsed(location, balance) + (def.slots ?? 1) > location.slots) {
                return { ok: false, reason: "No free structure slots" };
            }
            return { ok: true };
        }
        case "ship": {
            const def = balance.ships[item.shipType];
            const blocked = missingStructure(def.requires) ?? missingTech(def.requiresTech);
            if (blocked) return blocked;
            if (ctx.shipCount >= ctx.shipCap) {
                return { ok: false, reason: "Ship cap reached" };
            }
            return { ok: true };
        }
        case "groundUnit": {
            const def = balance.groundUnits[item.unitType];
            return missingStructure(def.requires) ?? missingTech(def.requiresTech) ?? { ok: true };
        }
        case "research": {
            const academy = location.installations.some(
                (i) => STRUCTURE_INFO[i.type].enablesResearch
            );
            if (!academy) {
                return { ok: false, reason: `Requires ${STRUCTURE_INFO.science_academy.name}` };
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
            if (current >= maxTierFor(target, balance)) {
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
