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
    type SpaceStructureEntity,
    SpaceStructureType,
    SupplyShipEntity
} from "./PrimitiveTypes.js";
import {
    SpaceStructureBalance,
    spaceStructureMaxTier,
    spaceStructureName,
    spaceStructureTier
} from "./SpaceStructures.js";
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
import {
    CombatBalance,
    DefenceStructureType,
    DefencesBalance,
    HangarBalance,
    RepairBalance,
    ShipClass,
    SupplyShipBalance,
    TargetClass
} from "./Combat.js";
import { HyperdriveBalance, HyperspaceBalance } from "./Hyperspace.js";
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
    "warehouse",
    ...DefenceStructureType.options
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

/**
 * Kind of location an installation can be built on; `asteroid` means a mineable large asteroid.
 * `space` is a space structure's own site (see `LocationEconomy.structure`), which takes no
 * installations.
 */
export const StructureSite = z.enum(["planet", "moon", "asteroid", "space"]);
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
    /** Damage output at tier 1 (see `combatDamage`); `shipTiers.attackBonus` adds to it. */
    attack: z.number().int().min(0),
    /** At tier 1; `shipTiers.defenceBonus` adds to it. */
    defence: z.number().int().min(0),
    /** Structures that must be built on the planet building this ship. */
    requires: z.array(StructureType),
    requiresTech: TechId.nullable(),
    maxTier: MaxTier,
    /** Ground units it can carry. */
    unitCapacity: z.number().int().min(0),
    /** Can be consumed to claim an unowned planet, moon or mineable asteroid on its hex. */
    canColonise: z.boolean(),
    /** Can orbital-bombard an enemy location on its hex (see `client:bombard`). */
    canBombard: z.boolean(),
    class: ShipClass,
    /** Damage multiplier against each target class; 1 where absent (see `attackMultiplier`). */
    attackMultipliers: z.partialRecord(TargetClass, z.number().min(0)),
    /**
     * Repairs anywhere out of combat; otherwise only aboard a hangar or at an owned shipyard
     * (see `shipRepairPerTurn`).
     */
    repairsInSpace: z.boolean(),
    /** Absent for ship types without a hyperdrive. */
    hyperdrive: HyperdriveBalance.optional(),
    /** Absent for ship types that can't carry ships. */
    hangar: HangarBalance.optional(),
    /** Can start space structure construction sites on empty hexes (see `client:builder:construct`). */
    canConstruct: z.boolean()
});
export type ShipBalance = z.infer<typeof ShipBalance>;

export const GroundUnitBalance = z.object({
    /** `cost.population` is borrowed and returns home when the unit is disbanded or destroyed. */
    cost: Resources,
    buildTurns: z.number().int().positive(),
    attack: z.number().int().min(0),
    defence: z.number().int().min(0),
    hp: z.number().int().positive(),
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
        movementBonus: PerTier(z.number().int()),
        /** Hyperjump accuracy bonus in percentage points (see `hyperjumpAccuracy`). */
        hyperdriveAccuracyBonus: PerTier(z.number().min(0)),
        attackBonus: PerTier(z.number().int()),
        defenceBonus: PerTier(z.number().int())
    }),
    hyperspace: HyperspaceBalance,
    combat: CombatBalance,
    supplyShips: SupplyShipBalance,
    repair: RepairBalance,
    defences: DefencesBalance,
    spaceStructures: z.record(SpaceStructureType, SpaceStructureBalance),
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
    z.object({ kind: z.literal("groundUnit"), unitId: EntityId, unitType: GroundUnitType }),
    /** Ordered at the structure's own site; each tier needs its own tech (see `spaceStructureTier`). */
    z.object({
        kind: z.literal("spaceStructure"),
        structureId: EntityId,
        structureType: SpaceStructureType
    })
]);
export type EnhancementTarget = z.infer<typeof EnhancementTarget>;

export const BuildItem = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("structure"), structureType: StructureType }),
    /** Construction of the space structure at this site; only placed by a Builder. */
    z.object({ kind: z.literal("spaceStructure"), structureType: SpaceStructureType }),
    z.object({ kind: z.literal("ship"), shipType: ShipType }),
    z.object({ kind: z.literal("groundUnit"), unitType: GroundUnitType }),
    /** Only at a location with a Science Academy; unlocks the tech side-wide. */
    z.object({ kind: z.literal("research"), techId: TechId }),
    /** `tier` is the tier reached on completion (current tier + 1). */
    z.object({ kind: z.literal("enhancement"), target: EnhancementTarget, tier: EnhancementTier })
]);
export type BuildItem = z.infer<typeof BuildItem>;

/**
 * A build in progress. Funding is progress, drawing at most `ratePerTurn` of each resource per
 * turn. Once `applied` reaches `cost` it is ready (see `isFullyFunded`): it stays listed for a
 * turn and completes at the start of the next end of turn.
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
    populationFrom: EntityId,
    /** Orbital platforms: current hp; absent means full (see `platformStats`). */
    hp: z.number().min(0).optional(),
    /** Orbital platforms: last turn it fought (see `repairsAtEndOf`); absent means never. */
    lastCombatTurn: z.number().int().min(0).optional()
});
export type Installation = z.infer<typeof Installation>;

/** A location's Shield Generator pool (see `shieldRecharge`). */
export const ShieldState = z.object({
    hp: z.number().min(0),
    /** Funding priority of its upkeep, alongside the location's orders (see `shieldUpkeepOrder`). */
    priority: BuildPriority,
    /** Share (0-1) of its upkeep supplied at the last end of turn. */
    supplied: z.number().min(0).max(1)
});
export type ShieldState = z.infer<typeof ShieldState>;

/** Mirrors the space structure entity for its economy entry. */
export const SpaceStructureSiteState = z.object({
    type: SpaceStructureType,
    tier: EnhancementTier,
    constructing: z.boolean()
});
export type SpaceStructureSiteState = z.infer<typeof SpaceStructureSiteState>;

/** Private to the owning side; never part of the shared entity data. */
export const LocationEconomy = z.object({
    /** Planet, moon, mineable large asteroid or space structure entity id. */
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
    /**
     * Every queue's orders in one list; each queue (see `queueCategory`) keeps its relative
     * order here, which breaks priority ties. Active orders (see `partitionOrders`) are funded
     * concurrently by priority (see `fundLocationOrders`); ready ones wait to complete.
     */
    orders: z.array(BuildOrder),
    /** Present while a Shield Generator is built here. */
    shield: ShieldState.optional(),
    /** Space structure sites (`site: "space"`): the structure this entry belongs to. */
    structure: SpaceStructureSiteState.optional()
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
    shipyard: {
        name: "Shipyard",
        description: "Builds Scouts, Colony Ships, Transports and Fighter Squadrons."
    },
    advanced_shipyard: {
        name: "Advanced Shipyard",
        description:
            "Builds Frigates, Advanced Fighter Squadrons, Bomber Squadrons and, with Docks, Star Destroyers and Super Star Destroyers."
    },
    docks: {
        name: "Docks",
        description: "Raises the ship cap. Needed for Star Destroyers and Super Star Destroyers."
    },
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
    warehouse: { name: "Warehouse", description: "Raises every stockpile cap a little." },
    defensive_battery: {
        name: "Defensive Battery",
        description: "Fires on ships bombarding this location and on transports invading it."
    },
    shield_generator: {
        name: "Shield Generator",
        description: "Absorbs orbital bombardment while charged. Needs upkeep each turn."
    },
    orbital_platform: {
        name: "Orbital Platform",
        description: "Armed station that blocks enemy ships from entering this hex until destroyed."
    }
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

/** Anything with its own economy entry: a location or a space structure. */
export type BuildSiteEntity = LocationEntity | SpaceStructureEntity;

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
 * storage installations. Production beyond it is lost; supply ships wait for room. A space
 * structure's site holds exactly what its orders still need.
 */
export function stockpileCap(
    location: Pick<LocationEconomy, "home" | "installations"> & {
        site?: StructureSite;
        orders?: readonly Pick<BuildOrder, "cost" | "applied">[];
    },
    balance: EconomyBalance
): Resources {
    if (location.site === "space") {
        return sumResources((location.orders ?? []).map(remainingNeed));
    }
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
        case "spaceStructure":
            return target.structureId;
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
        case "spaceStructure":
            return {
                ...balance.spaceStructures[target.structureType],
                name: spaceStructureName(target.structureType),
                maxTier: spaceStructureMaxTier(target.structureType, balance)
            };
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
        case "spaceStructure":
            return balance.spaceStructures[item.structureType].cost;
        case "enhancement": {
            if (item.target.kind === "spaceStructure") {
                const tier = spaceStructureTier(item.target.structureType, item.tier, balance);
                return { ...(tier?.cost ?? zeroResources()), population: 0 };
            }
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
        case "spaceStructure":
            return balance.spaceStructures[item.structureType].buildTurns;
        case "enhancement":
            if (item.target.kind === "spaceStructure") {
                return (
                    spaceStructureTier(item.target.structureType, item.tier, balance)?.buildTurns ??
                    1
                );
            }
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
        case "spaceStructure":
            return spaceStructureName(target.structureType);
    }
}

export function buildItemName(item: BuildItem): string {
    switch (item.kind) {
        case "structure":
            return structureName(item.structureType);
        case "spaceStructure":
            return spaceStructureName(item.structureType);
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
        case "spaceStructure":
            return "installations";
        case "ship":
            return "ships";
        case "groundUnit":
            return "groundUnits";
        case "research":
            return "research";
        case "enhancement":
            return item.target.kind === "installation" || item.target.kind === "spaceStructure"
                ? "installations"
                : undefined;
    }
}

/**
 * The build queue an item is listed and reordered in. Like `buildCategory`, except ship and
 * ground unit upgrades join the ships and ground units queues (still without using a slot).
 */
export function queueCategory(item: BuildItem): BuildCategory {
    if (item.kind === "enhancement") {
        switch (item.target.kind) {
            case "installation":
            case "spaceStructure":
                return "installations";
            case "ship":
                return "ships";
            case "groundUnit":
                return "groundUnits";
        }
    }
    return buildCategory(item)!;
}

export const QueueDirection = z.enum(["up", "down"]);
export type QueueDirection = z.infer<typeof QueueDirection>;

/**
 * A copy of `orders` with `orderId` swapped with its neighbour in the same queue (see
 * `queueCategory`); orders in other queues keep their places. Undefined when the order is
 * missing or already at that end of its queue.
 */
export function moveOrderInQueue<T extends Pick<BuildOrder, "id" | "item">>(
    orders: readonly T[],
    orderId: OrderId,
    direction: QueueDirection
): T[] | undefined {
    const from = orders.findIndex((o) => o.id === orderId);
    if (from < 0) return undefined;
    const queue = queueCategory(orders[from]!.item);
    const step = direction === "up" ? -1 : 1;
    let to = from + step;
    while (to >= 0 && to < orders.length && queueCategory(orders[to]!.item) !== queue) to += step;
    if (to < 0 || to >= orders.length) return undefined;
    const result = [...orders];
    [result[from], result[to]] = [result[to]!, result[from]!];
    return result;
}

type SlotSource = Pick<LocationEconomy, "installations"> & {
    structure?: LocationEconomy["structure"];
};

/**
 * Orders a location may run at once per category: the base plus built installations' bonuses.
 * A space structure site runs its construction or upgrade, plus a completed dock's ship slots.
 */
export function buildSlots(location: SlotSource, balance: EconomyBalance): BuildSlots {
    if (location.structure) {
        const { type, constructing } = location.structure;
        return {
            ships: constructing ? 0 : balance.spaceStructures[type].shipSlots,
            installations: 1,
            groundUnits: 0,
            research: 0
        };
    }
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
    /**
     * Fully funded, completing at the next end of turn; in list order. They draw nothing and
     * don't hold a build slot.
     */
    ready: T[];
};

type PartitionableOrder = Pick<BuildOrder, "id" | "item" | "priority" | "cost" | "applied">;

/**
 * Splits a location's orders by its `buildSlots`: fully funded orders are ready; of the rest,
 * within each category the highest priority orders are active, earlier in the queue first
 * (list order is queue order; see `moveOrderInQueue`). Uncategorised orders are always active.
 */
export function partitionOrders<T extends PartitionableOrder>(
    location: SlotSource & { orders: readonly T[] },
    balance: EconomyBalance
): OrderPartition<T> {
    const slots = buildSlots(location, balance);
    const activeIds = new Set<OrderId>();
    const tier = (o: T) => BUILD_PRIORITIES.indexOf(o.priority);
    for (const category of BUILD_CATEGORIES) {
        const candidates = location.orders
            .filter((o) => buildCategory(o.item) === category && !isFullyFunded(o))
            .sort((a, b) => tier(a) - tier(b));
        for (const o of candidates.slice(0, slots[category])) activeIds.add(o.id);
    }
    const active: T[] = [];
    const waiting: T[] = [];
    const ready: T[] = [];
    for (const o of location.orders) {
        if (isFullyFunded(o)) ready.push(o);
        else if (buildCategory(o.item) === undefined || activeIds.has(o.id)) active.push(o);
        else waiting.push(o);
    }
    return { active, waiting, ready };
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

/**
 * One end of turn's funding at a location: its active orders and `standing` draws (such as
 * the shield upkeep, see `shieldUpkeepOrder`; their ids must not clash with order ids) draw
 * together (see `fundOrders`), then the slots freed by orders that just became fully funded
 * pass straight on, and the newly active orders draw from what is left. Each draws at most
 * once. `orders` in the result is every order of the location, in list order, with `applied`
 * updated; `drawn` also has the standing draws.
 */
export function fundLocationOrders<T extends PartitionableOrder & FundableOrder>(
    stockpile: Resources,
    location: SlotSource & { orders: readonly T[] },
    balance: EconomyBalance,
    standing: readonly FundableOrder[] = []
): FundingResult<T> {
    const drawn: Record<OrderId, Resources> = {};
    let orders = [...location.orders];
    let left = { ...stockpile };
    let pending = standing;
    for (;;) {
        const fresh = partitionOrders(
            { installations: location.installations, structure: location.structure, orders },
            balance
        ).active.filter((o) => !(o.id in drawn));
        if (fresh.length === 0 && pending.length === 0) break;
        const funded = fundOrders<FundableOrder>(left, [...pending, ...fresh]);
        pending = [];
        left = funded.stockpile;
        Object.assign(drawn, funded.drawn);
        const applied = new Map(funded.orders.map((o) => [o.id, o.applied]));
        orders = orders.map((o) => {
            const next = applied.get(o.id);
            return next ? { ...o, applied: next } : o;
        });
    }
    return { stockpile: left, drawn, orders };
}

/** Id of the shield upkeep's standing draw in `fundLocationOrders`. */
export const SHIELD_UPKEEP_ID = "shield-upkeep";

/**
 * The shield upkeep as a standing draw: it draws up to the full upkeep each end of turn at the
 * shield's priority, alongside the location's orders.
 */
export function shieldUpkeepOrder(shield: ShieldState, balance: EconomyBalance): FundableOrder {
    const upkeep = balance.defences.shield_generator.upkeep;
    return {
        id: SHIELD_UPKEEP_ID,
        priority: shield.priority,
        cost: { ...upkeep },
        applied: zeroResources(),
        ratePerTurn: { ...upkeep }
    };
}

/** Lowest supplied share (0-1) across the resources `need` asks for; 1 when it asks for none. */
export function suppliedFraction(need: Resources, drawn: Resources): number {
    let fraction = 1;
    for (const k of RESOURCE_KEYS) {
        if (need[k] > 0) fraction = Math.min(fraction, drawn[k] / need[k]);
    }
    return Math.max(0, Math.min(1, fraction));
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

/**
 * Whether a Space Dock can build `shipType`: anything a Shipyard plus Advanced Shipyard
 * builds, except colony ships and transports.
 */
export function spaceDockBuilds(shipType: ShipType, balance: EconomyBalance): boolean {
    const def = balance.ships[shipType];
    return (
        def.requires.every((s) => s === "shipyard" || s === "advanced_shipyard") &&
        !def.canColonise &&
        def.unitCapacity === 0
    );
}

function canBuildAtSpaceSite(
    ctx: BuildContext,
    location: LocationEconomy,
    structure: NonNullable<LocationEconomy["structure"]>,
    item: BuildItem
): CanBuildResult {
    const balance = ctx.balance;
    const missingTech = (tech: TechId | null | undefined): CanBuildResult | undefined =>
        tech && !ctx.techs.includes(tech)
            ? { ok: false, reason: `Requires ${TECHS[tech].name}` }
            : undefined;
    const name = spaceStructureName(structure.type);
    switch (item.kind) {
        case "spaceStructure":
            return { ok: false, reason: "Construction sites are placed by a Builder" };
        case "ship": {
            if (structure.constructing) return { ok: false, reason: `The ${name} isn't finished` };
            if (balance.spaceStructures[structure.type].shipSlots <= 0) {
                return { ok: false, reason: `A ${name} can't build ships` };
            }
            if (!spaceDockBuilds(item.shipType, balance)) {
                return { ok: false, reason: "Can't be built at a Space Dock" };
            }
            const blocked = missingTech(balance.ships[item.shipType].requiresTech);
            if (blocked) return blocked;
            if (ctx.shipCount >= ctx.shipCap) return { ok: false, reason: "Ship cap reached" };
            return { ok: true };
        }
        case "enhancement": {
            const target = item.target;
            if (target.kind !== "spaceStructure" || target.structureId !== location.locationId) {
                return { ok: false, reason: "Target not at this location" };
            }
            if (structure.constructing) return { ok: false, reason: `The ${name} isn't finished` };
            if (structure.tier >= spaceStructureMaxTier(structure.type, balance)) {
                return { ok: false, reason: "Already at maximum tier" };
            }
            if (item.tier !== structure.tier + 1) {
                return { ok: false, reason: `Next upgrade is tier ${structure.tier + 1}` };
            }
            const blocked = missingTech(
                spaceStructureTier(structure.type, item.tier, balance)?.requiresTech
            );
            if (blocked) return blocked;
            if (location.orders.some((o) => o.item.kind === "enhancement")) {
                return { ok: false, reason: "Already being upgraded" };
            }
            return { ok: true };
        }
        default:
            return { ok: false, reason: `Not available at a ${name}` };
    }
}

function canBuildItem(
    ctx: BuildContext,
    location: LocationEconomy,
    item: BuildItem
): CanBuildResult {
    if (location.structure) return canBuildAtSpaceSite(ctx, location, location.structure, item);
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
        case "spaceStructure":
            return { ok: false, reason: "Space structures are built by a Builder in open space" };
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
            if (target.kind === "spaceStructure") {
                return { ok: false, reason: "Target not at this location" };
            }
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
