import { LogLevel } from "@space/misc";
import {
    BuildSlots,
    ShipClass,
    ShipType,
    StructureSite,
    StructureType,
    TargetClass,
    TechId,
    type EconomyBalance,
    type GroundUnitBalance,
    type HangarBalance,
    type HyperdriveBalance,
    type SupplyShipTechBonus,
    type Resources,
    type ShipBalance,
    type SpaceStructureBalance,
    type SpaceStructureTierBalance,
    type StorageStructureBalance,
    type StructureBalance
} from "@space/shared-data";
import { readFileSync } from "fs";
import z from "zod";

/** Each resource may be given on its own; the rest take their defaults. */
function resources(defaults: Resources) {
    return z
        .object({
            money: z.number().min(0).default(defaults.money),
            materials: z.number().min(0).default(defaults.materials),
            population: z.number().min(0).default(defaults.population),
            science: z.number().min(0).default(defaults.science)
        })
        .strict()
        .prefault({});
}

function storageStructure(defaults: StorageStructureBalance) {
    return z
        .object({
            cost: resources(defaults.cost),
            buildTurns: z.int().positive().default(defaults.buildTurns),
            sites: z
                .array(StructureSite)
                .min(1)
                .default(() => [...defaults.sites]),
            /** Structure slots it occupies. */
            slots: z.int().min(0).default(defaults.slots),
            /** Cap increase at tier 1; tiers 2 and 3 give 1.5x and 2x. */
            capBonus: resources(defaults.capBonus),
            /** Share of the stockpile protected from pillage (0-1). Stored for ground-war pillage; not used yet. */
            pillageProtection: z.number().min(0).max(1).default(defaults.pillageProtection),
            /** Highest enhancement tier (1-3); 1 means it can't be upgraded. */
            maxTier: z.int().min(1).max(3).default(defaults.maxTier)
        })
        .strict()
        .prefault({});
}

const maxTier = (defaultTier: number) => z.int().min(1).max(3).default(defaultTier);
const requires = (defaults: StructureType[]) => z.array(StructureType).default(() => [...defaults]);
/** `null` means no tech is needed. */
const requiresTech = (defaultTech: TechId | null) => TechId.nullable().default(defaultTech);
/** Tier 1, 2 and 3 values; replaced as a whole. */
function perTier(value: z.ZodNumber, [t1, t2, t3]: [number, number, number]) {
    const defaults = (): [number, number, number] => [t1, t2, t3];
    return z.tuple([value, value, value]).default(defaults);
}

function structure(defaults: StructureBalance) {
    return z
        .object({
            cost: resources(defaults.cost),
            buildTurns: z.int().positive().default(defaults.buildTurns),
            sites: z
                .array(StructureSite)
                .min(1)
                .default(() => [...defaults.sites]),
            /** Structures that must already be built at the same location. */
            requires: requires(defaults.requires),
            requiresTech: requiresTech(defaults.requiresTech),
            /** Per-turn output at tier 1, scaled by `structureTierOutput`. */
            produces: resources(defaults.produces),
            /** Added to the side's ship cap per installation. */
            shipCapBonus: z.int().min(0).default(defaults.shipCapBonus),
            /** At most one per location. */
            unique: z.boolean().default(defaults.unique),
            /** Structure slots it occupies. */
            slots: z.int().min(0).default(defaults.slots),
            maxTier: maxTier(defaults.maxTier)
        })
        .strict()
        .prefault({});
}

/** Used when a ship type without a default hyperdrive is given one in config. */
const GENERIC_HYPERDRIVE: HyperdriveBalance = {
    cooldownTurns: 3,
    accuracy: { onTarget: 20, oneOff: 50, twoOff: 30 }
};

function hyperdriveSchema(defaults: HyperdriveBalance) {
    return z
        .object({
            /** Turns after a jump before it can be engaged again. */
            cooldownTurns: z.int().min(0).default(defaults.cooldownTurns),
            /** Percentage chances of landing on target, 1 hex off or 2 hexes off. */
            accuracy: z
                .object({
                    onTarget: z.number().min(0).default(defaults.accuracy.onTarget),
                    oneOff: z.number().min(0).default(defaults.accuracy.oneOff),
                    twoOff: z.number().min(0).default(defaults.accuracy.twoOff)
                })
                .strict()
                .prefault({})
        })
        .strict();
}

/**
 * Ship types with a default hyperdrive may set `null` to remove it; others may add one,
 * missing values taking `GENERIC_HYPERDRIVE`.
 */
function hyperdrive(defaults: HyperdriveBalance | undefined) {
    if (!defaults) return hyperdriveSchema(GENERIC_HYPERDRIVE).optional();
    return hyperdriveSchema(defaults)
        .nullable()
        .prefault({})
        .transform((value) => value ?? undefined);
}

function hangarSchema(defaults: HangarBalance) {
    return z
        .object({
            /** Ships carried at once. */
            capacity: z.int().min(0).default(defaults.capacity),
            /** Ship types it may carry. */
            carries: z.array(ShipType).default(() => [...defaults.carries])
        })
        .strict();
}

/**
 * Ship types with a default hangar may set `null` to remove it; others may add one, giving at
 * least `capacity` and `carries`.
 */
function hangar(defaults: HangarBalance | undefined) {
    if (!defaults) {
        return z
            .object({ capacity: z.int().min(0), carries: z.array(ShipType) })
            .strict()
            .nullable()
            .optional()
            .transform((value) => value ?? undefined);
    }
    return hangarSchema(defaults)
        .nullable()
        .prefault({})
        .transform((value) => value ?? undefined);
}

function supplyTechBonus(defaults: SupplyShipTechBonus) {
    return z
        .object({
            hp: z.int().min(0).default(defaults.hp),
            defence: z.int().min(0).default(defaults.defence),
            evasion: z.number().min(0).max(1).default(defaults.evasion)
        })
        .strict()
        .prefault({});
}

function hazard(destroyChance: number, damageFraction: number) {
    return z
        .object({
            /** Chance (0-1) a ship landing here is destroyed. */
            destroyChance: z.number().min(0).max(1).default(destroyChance),
            /** Otherwise the share (0-1) of its full hp it loses, never dropping below 1 hp. */
            damageFraction: z.number().min(0).max(1).default(damageFraction)
        })
        .strict()
        .prefault({});
}

function ship(defaults: ShipBalance) {
    return z
        .object({
            /** `population` is the crew, returned home when the ship is lost. */
            cost: resources(defaults.cost),
            buildTurns: z.int().positive().default(defaults.buildTurns),
            /** At tier 1; `shipTiers.movementBonus` adds to it. */
            maxMovementPoints: z.int().min(0).default(defaults.maxMovementPoints),
            /** At tier 1; `shipTiers.hpMultiplier` scales it. */
            hp: z.int().positive().default(defaults.hp),
            /** At tier 1; `shipTiers.attackBonus` adds to it (unarmed ships stay at 0). */
            attack: z.int().min(0).default(defaults.attack),
            /** At tier 1; `shipTiers.defenceBonus` adds to it. */
            defence: z.int().min(0).default(defaults.defence),
            /** Structures the building planet needs. */
            requires: requires(defaults.requires),
            requiresTech: requiresTech(defaults.requiresTech),
            maxTier: maxTier(defaults.maxTier),
            /** Ground units it can carry; 0 for none. */
            unitCapacity: z.int().min(0).default(defaults.unitCapacity),
            canColonise: z.boolean().default(defaults.canColonise),
            /** Orbital bombardment of enemy locations on its hex. */
            canBombard: z.boolean().default(defaults.canBombard),
            /** `strike_craft`, `capital` or `support`; what other ships' multipliers single out. */
            class: ShipClass.default(defaults.class),
            /**
             * Damage multiplier per target class (`strike_craft`, `capital`, `support`,
             * `orbital_platform`); absent classes take 1. Replaced as a whole.
             */
            attackMultipliers: z
                .partialRecord(TargetClass, z.number().min(0))
                .default(() => ({ ...defaults.attackMultipliers })),
            /** Repairs anywhere out of combat; otherwise only in a hangar or at an owned shipyard. */
            repairsInSpace: z.boolean().default(defaults.repairsInSpace),
            hyperdrive: hyperdrive(defaults.hyperdrive),
            /** Ships it can carry; `null` removes a default hangar. */
            hangar: hangar(defaults.hangar),
            /** Starts space structure construction sites on empty open-space hexes. */
            canConstruct: z.boolean().default(defaults.canConstruct)
        })
        .strict()
        .prefault({});
}

function spaceStructureTier(defaults: SpaceStructureTierBalance) {
    return z
        .object({
            cost: resources(defaults.cost),
            buildTurns: z.int().positive().default(defaults.buildTurns),
            requiresTech: requiresTech(defaults.requiresTech)
        })
        .strict();
}

function spaceStructure(defaults: SpaceStructureBalance) {
    const tiers = z
        .array(spaceStructureTier(defaults.tiers[0] ?? GENERIC_SPACE_STRUCTURE_TIER))
        .max(2)
        .default(() => defaults.tiers.map((t) => ({ ...t, cost: { ...t.cost } })));
    return z
        .object({
            cost: resources(defaults.cost),
            buildTurns: z.int().positive().default(defaults.buildTurns),
            requiresTech: requiresTech(defaults.requiresTech),
            /** Full hp at tier 1. */
            hp: z.int().positive().default(defaults.hp),
            /** 0 for unarmed structures. */
            attack: z.int().min(0).default(defaults.attack),
            defence: z.int().min(0).default(defaults.defence),
            /** Fires at every enemy ship within this many hexes each end of turn; 0 never fires. */
            fireRadius: z.int().min(0).default(defaults.fireRadius),
            /** Vision range at tiers 1, 2 and 3. */
            visionRange: perTier(z.int().min(0), defaults.visionRange),
            /** Repair fraction added for own ships on its hex. */
            repairBonus: z.number().min(0).max(1).default(defaults.repairBonus),
            /** Strike craft (which otherwise only repair docked) repair on its hex. */
            docksShips: z.boolean().default(defaults.docksShips),
            /** Ships built at once; 0 for none. */
            shipSlots: z.int().min(0).default(defaults.shipSlots),
            /** Upgrades to tier 2 and 3; replaced as a whole. */
            tiers
        })
        .strict()
        .prefault({});
}

/** Used for upgrade entries given in config without a default to fall back on. */
const GENERIC_SPACE_STRUCTURE_TIER: SpaceStructureTierBalance = {
    cost: { money: 200, materials: 200, population: 0, science: 100 },
    buildTurns: 4,
    requiresTech: null
};

function groundUnit(defaults: GroundUnitBalance) {
    return z
        .object({
            cost: resources(defaults.cost),
            buildTurns: z.int().positive().default(defaults.buildTurns),
            /** At tier 1; `groundUnitTiers.attackBonus` adds to it. */
            attack: z.int().min(0).default(defaults.attack),
            /** At tier 1; `groundUnitTiers.defenceBonus` adds to it. */
            defence: z.int().min(0).default(defaults.defence),
            /** Full hp; damage persists between combats. */
            hp: z.int().positive().default(defaults.hp),
            /** Structures the training location needs. */
            requires: requires(defaults.requires),
            requiresTech: requiresTech(defaults.requiresTech),
            maxTier: maxTier(defaults.maxTier)
        })
        .strict()
        .prefault({});
}

const NO_RESOURCES: Resources = { money: 0, materials: 0, population: 0, science: 0 };

const STRUCTURE_DEFAULTS = {
    requires: [],
    requiresTech: null,
    produces: NO_RESOURCES,
    shipCapBonus: 0,
    unique: false,
    slots: 1
} satisfies Partial<StructureBalance>;

const SHIP_DEFAULTS = {
    requires: ["shipyard"],
    requiresTech: null,
    unitCapacity: 0,
    canColonise: false,
    canBombard: false,
    attackMultipliers: {},
    repairsInSpace: true,
    canConstruct: false
} satisfies Partial<ShipBalance>;

const SPACE_STRUCTURE_DEFAULTS = {
    attack: 0,
    fireRadius: 0,
    visionRange: [2, 2, 2],
    repairBonus: 0,
    docksShips: false,
    shipSlots: 0,
    tiers: []
} satisfies Partial<SpaceStructureBalance>;

/** Fighters and bombers only repair docked in a hangar or at an owned shipyard. */
const STRIKE_CRAFT_DEFAULTS = {
    ...SHIP_DEFAULTS,
    class: "strike_craft",
    repairsInSpace: false
} satisfies Partial<ShipBalance>;

/** Ship types a capital ship hangar takes by default. */
const HANGAR_CARRIES: ShipType[] = [
    "fighter_squadron",
    "advanced_fighter_squadron",
    "bomber_squadron"
];

const DEFAULT_STRUCTURE_BUILD_SLOTS: EconomyBalance["buildSlots"]["structures"] = {
    shipyard: { ships: 1 },
    advanced_shipyard: { ships: 1 },
    barracks: { groundUnits: 1 },
    science_academy: { research: 1 }
};

/** Economy balance; sent to clients in `server:map:init`. */
export const EconomyBalanceConfig = z
    .object({
        /** Local stockpile at each side's home planet at game start (clamped to the home cap). */
        startingStockpile: resources({
            money: 1000,
            materials: 1000,
            population: 200,
            science: 100
        }),
        /** Ships each side starts with next to its home planet. */
        startingShips: z.array(ShipType).default((): ShipType[] => ["scout", "frigate"]),
        /** Per-turn income per planet level at every owned planet (not moons or asteroids). */
        planetBaseIncomePerLevel: resources({ money: 5, materials: 5, population: 2, science: 1 }),
        /** Installation output and storage cap bonus multiplier at tiers 1, 2 and 3. */
        structureTierOutput: perTier(z.number().min(0), [1, 1.5, 2]),
        /** Enhancement cost as a fraction of the target's base cost (never population), by tier reached. */
        enhancementCostFactor: z
            .object({
                "2": z.number().min(0).default(0.5),
                "3": z.number().min(0).default(1)
            })
            .strict()
            .prefault({}),
        /** Installations other than storage (see `storageStructures`). */
        structures: z
            .object({
                habitat: structure({
                    ...STRUCTURE_DEFAULTS,
                    cost: { money: 50, materials: 100, population: 0, science: 0 },
                    buildTurns: 2,
                    sites: ["planet", "moon"],
                    produces: { ...NO_RESOURCES, population: 10 },
                    maxTier: 3
                }),
                mine: structure({
                    ...STRUCTURE_DEFAULTS,
                    cost: { money: 100, materials: 0, population: 10, science: 0 },
                    buildTurns: 2,
                    sites: ["planet", "moon", "asteroid"],
                    produces: { ...NO_RESOURCES, materials: 40 },
                    maxTier: 3
                }),
                trade_hub: structure({
                    ...STRUCTURE_DEFAULTS,
                    cost: { money: 0, materials: 100, population: 10, science: 0 },
                    buildTurns: 2,
                    sites: ["planet", "moon"],
                    produces: { ...NO_RESOURCES, money: 40 },
                    maxTier: 3
                }),
                shipyard: structure({
                    ...STRUCTURE_DEFAULTS,
                    cost: { money: 150, materials: 200, population: 20, science: 0 },
                    buildTurns: 3,
                    sites: ["planet"],
                    unique: true,
                    maxTier: 1
                }),
                advanced_shipyard: structure({
                    ...STRUCTURE_DEFAULTS,
                    cost: { money: 250, materials: 300, population: 30, science: 0 },
                    buildTurns: 4,
                    sites: ["planet"],
                    requires: ["shipyard"],
                    requiresTech: "advanced_shipyard",
                    unique: true,
                    maxTier: 1
                }),
                docks: structure({
                    ...STRUCTURE_DEFAULTS,
                    cost: { money: 100, materials: 150, population: 10, science: 0 },
                    buildTurns: 2,
                    sites: ["planet"],
                    requires: ["shipyard"],
                    shipCapBonus: 1,
                    maxTier: 1
                }),
                science_academy: structure({
                    ...STRUCTURE_DEFAULTS,
                    cost: { money: 200, materials: 150, population: 20, science: 0 },
                    buildTurns: 3,
                    sites: ["planet"],
                    produces: { ...NO_RESOURCES, science: 20 },
                    unique: true,
                    maxTier: 3
                }),
                barracks: structure({
                    ...STRUCTURE_DEFAULTS,
                    cost: { money: 100, materials: 150, population: 10, science: 0 },
                    buildTurns: 2,
                    sites: ["planet", "moon"],
                    requiresTech: "ground_forces",
                    unique: true,
                    maxTier: 1
                }),
                /** Combat stats under `defences`. */
                defensive_battery: structure({
                    ...STRUCTURE_DEFAULTS,
                    cost: { money: 120, materials: 150, population: 10, science: 0 },
                    buildTurns: 2,
                    sites: ["planet", "moon"],
                    maxTier: 3
                }),
                shield_generator: structure({
                    ...STRUCTURE_DEFAULTS,
                    cost: { money: 200, materials: 200, population: 10, science: 50 },
                    buildTurns: 3,
                    sites: ["planet", "moon"],
                    requiresTech: "planetary_shields",
                    unique: true,
                    maxTier: 3
                }),
                orbital_platform: structure({
                    ...STRUCTURE_DEFAULTS,
                    cost: { money: 300, materials: 400, population: 20, science: 0 },
                    buildTurns: 4,
                    sites: ["planet", "moon"],
                    requires: ["shipyard"],
                    requiresTech: "orbital_defence_platforms",
                    unique: true,
                    maxTier: 3
                })
            })
            .strict()
            .prefault({}),
        ships: z
            .object({
                scout: ship({
                    ...SHIP_DEFAULTS,
                    class: "support",
                    cost: { money: 100, materials: 100, population: 5, science: 0 },
                    buildTurns: 2,
                    maxMovementPoints: 5,
                    hp: 6,
                    attack: 1,
                    defence: 1,
                    maxTier: 3
                }),
                frigate: ship({
                    ...SHIP_DEFAULTS,
                    class: "capital",
                    cost: { money: 200, materials: 300, population: 15, science: 0 },
                    buildTurns: 3,
                    maxMovementPoints: 3,
                    hp: 12,
                    attack: 4,
                    defence: 3,
                    requires: ["advanced_shipyard"],
                    maxTier: 3,
                    hyperdrive: {
                        cooldownTurns: 3,
                        accuracy: { onTarget: 20, oneOff: 50, twoOff: 30 }
                    }
                }),
                colony_ship: ship({
                    ...SHIP_DEFAULTS,
                    class: "support",
                    cost: { money: 200, materials: 200, population: 50, science: 0 },
                    buildTurns: 3,
                    maxMovementPoints: 2,
                    hp: 4,
                    attack: 0,
                    defence: 1,
                    maxTier: 1,
                    canColonise: true
                }),
                transport: ship({
                    ...SHIP_DEFAULTS,
                    class: "support",
                    cost: { money: 100, materials: 150, population: 5, science: 0 },
                    buildTurns: 2,
                    maxMovementPoints: 3,
                    hp: 8,
                    attack: 0,
                    defence: 2,
                    requiresTech: "transports",
                    maxTier: 3,
                    unitCapacity: 4
                }),
                fighter_squadron: ship({
                    ...STRIKE_CRAFT_DEFAULTS,
                    cost: { money: 80, materials: 60, population: 10, science: 0 },
                    buildTurns: 2,
                    maxMovementPoints: 6,
                    hp: 4,
                    attack: 3,
                    defence: 1,
                    maxTier: 3,
                    attackMultipliers: { orbital_platform: 2 }
                }),
                advanced_fighter_squadron: ship({
                    ...STRIKE_CRAFT_DEFAULTS,
                    cost: { money: 150, materials: 120, population: 15, science: 0 },
                    buildTurns: 3,
                    maxMovementPoints: 6,
                    hp: 7,
                    attack: 5,
                    defence: 2,
                    requires: ["advanced_shipyard"],
                    maxTier: 3,
                    attackMultipliers: { orbital_platform: 2 }
                }),
                bomber_squadron: ship({
                    ...STRIKE_CRAFT_DEFAULTS,
                    cost: { money: 100, materials: 80, population: 10, science: 0 },
                    buildTurns: 2,
                    maxMovementPoints: 4,
                    hp: 5,
                    attack: 4,
                    defence: 0,
                    requires: ["advanced_shipyard"],
                    maxTier: 3,
                    attackMultipliers: { capital: 2.5, orbital_platform: 2 }
                }),
                star_destroyer: ship({
                    ...SHIP_DEFAULTS,
                    class: "capital",
                    cost: { money: 600, materials: 800, population: 60, science: 0 },
                    buildTurns: 6,
                    maxMovementPoints: 2,
                    hp: 30,
                    attack: 8,
                    defence: 8,
                    requires: ["advanced_shipyard", "docks"],
                    maxTier: 3,
                    unitCapacity: 4,
                    canBombard: true,
                    hangar: { capacity: 4, carries: HANGAR_CARRIES },
                    hyperdrive: {
                        cooldownTurns: 4,
                        accuracy: { onTarget: 30, oneOff: 50, twoOff: 20 }
                    }
                }),
                super_star_destroyer: ship({
                    ...SHIP_DEFAULTS,
                    class: "capital",
                    cost: { money: 1800, materials: 2400, population: 150, science: 0 },
                    buildTurns: 10,
                    maxMovementPoints: 2,
                    hp: 90,
                    attack: 20,
                    defence: 14,
                    requires: ["advanced_shipyard", "docks"],
                    requiresTech: "capital_ship_engineering",
                    maxTier: 3,
                    unitCapacity: 8,
                    canBombard: true,
                    hangar: { capacity: 10, carries: HANGAR_CARRIES },
                    hyperdrive: {
                        cooldownTurns: 5,
                        accuracy: { onTarget: 40, oneOff: 45, twoOff: 15 }
                    }
                }),
                builder: ship({
                    ...SHIP_DEFAULTS,
                    class: "support",
                    cost: { money: 150, materials: 200, population: 10, science: 0 },
                    buildTurns: 3,
                    maxMovementPoints: 4,
                    hp: 8,
                    attack: 0,
                    defence: 2,
                    requiresTech: "space_construction",
                    maxTier: 3,
                    canConstruct: true
                })
            })
            .strict()
            .prefault({}),
        /**
         * Ship stat changes at tiers 1, 2 and 3: hp is multiplied (rounded up), movement,
         * defence and attack (armed ships only) added, and hyperjump accuracy improved by
         * percentage points (see `hyperjumpAccuracy`).
         */
        shipTiers: z
            .object({
                hpMultiplier: perTier(z.number().positive(), [1, 1.5, 2]),
                movementBonus: perTier(z.int(), [0, 0, 1]),
                hyperdriveAccuracyBonus: perTier(z.number().min(0), [0, 10, 20]),
                attackBonus: perTier(z.int(), [0, 1, 2]),
                defenceBonus: perTier(z.int(), [0, 1, 2])
            })
            .strict()
            .prefault({}),
        /**
         * Automatic combat. Each hit deals
         * `max(minDamage, round(attack * roll(1 - spread, 1 + spread) * defenceScale / (defenceScale + defence)))`.
         */
        combat: z
            .object({
                spread: z.number().min(0).max(1).default(0.25),
                minDamage: z.int().min(0).default(1),
                defenceScale: z.number().positive().default(10),
                /** Ground combat rounds before undecided invaders re-embark. */
                groundMaxRounds: z.int().min(1).default(6),
                /**
                 * Chance each bombarding ship destroys one random installation after firing on
                 * the garrison.
                 */
                bombardmentInstallationChance: z.number().min(0).max(1).default(0.4)
            })
            .strict()
            .prefault({}),
        /** Supply ship combat stats (they never attack) and the techs that improve them. */
        supplyShips: z
            .object({
                hp: z.int().positive().default(6),
                defence: z.int().min(0).default(1),
                /** Chance (0-1) of evading each attack, taking no damage and staying on course. */
                evasion: z.number().min(0).max(1).default(0.3),
                maxEvasion: z.number().min(0).max(1).default(0.75),
                /** Added per known tech. */
                techBonus: z
                    .object({
                        evasive_manoeuvres_1: supplyTechBonus({ hp: 0, defence: 0, evasion: 0.15 }),
                        evasive_manoeuvres_2: supplyTechBonus({ hp: 0, defence: 0, evasion: 0.15 }),
                        armoured_freighters: supplyTechBonus({ hp: 6, defence: 2, evasion: 0 })
                    })
                    .strict()
                    .prefault({})
            })
            .strict()
            .prefault({}),
        /**
         * Ships and supply ships with no combat during a whole turn regain
         * `max(minPerTurn, round(maxHp * fraction))` hp at its end, capped at max; `fraction` is
         * `baseFraction` plus every applicable bonus.
         */
        repair: z
            .object({
                baseFraction: z.number().min(0).max(1).default(0.1),
                minPerTurn: z.int().min(0).default(1),
                /** Added per known tech. */
                techBonus: z
                    .object({
                        damage_control_1: z.number().min(0).max(1).default(0.05),
                        damage_control_2: z.number().min(0).max(1).default(0.1)
                    })
                    .strict()
                    .prefault({}),
                /** On the hex of an owned location with a Shipyard or Advanced Shipyard. */
                atOwnedShipyardBonus: z.number().min(0).max(1).default(0.15),
                /** Aboard a carrier's hangar. */
                carriedBonus: z.number().min(0).max(1).default(0.05)
            })
            .strict()
            .prefault({}),
        /**
         * Combat stats of defensive installations at tier 1; tiers 2 and 3 scale attack,
         * defence, hp, shield capacity and recharge by `structureTierOutput` (rounded up).
         */
        defences: z
            .object({
                /** Fires once at bombarding ships and once at invading transports. */
                defensive_battery: z
                    .object({
                        attack: z.int().min(0).default(5),
                        defence: z.int().min(0).default(4)
                    })
                    .strict()
                    .prefault({}),
                /**
                 * Hp pool absorbing bombarding ships' shots. Each end of turn its upkeep is
                 * funded with the location's orders at the shield's priority; with a share `f`
                 * supplied the cap is `capacity * f` and it recharges `rechargePerTurn * f`.
                 */
                shield_generator: z
                    .object({
                        capacity: z.int().min(0).default(40),
                        rechargePerTurn: z.int().min(0).default(10),
                        upkeep: resources({ money: 15, materials: 0, population: 0, science: 5 })
                    })
                    .strict()
                    .prefault({}),
                /** Blocks enemy ships from entering its hex; damage persists and is repaired. */
                orbital_platform: z
                    .object({
                        attack: z.int().min(0).default(8),
                        defence: z.int().min(0).default(8),
                        hp: z.int().positive().default(40)
                    })
                    .strict()
                    .prefault({})
            })
            .strict()
            .prefault({}),
        /**
         * Structures a Builder constructs in open space. Hp, attack and defence are at tier 1;
         * upgrades (`tiers`, each needing its tech) scale them by `structureTierOutput`.
         */
        spaceStructures: z
            .object({
                sensor_array: spaceStructure({
                    ...SPACE_STRUCTURE_DEFAULTS,
                    cost: { money: 150, materials: 150, population: 0, science: 50 },
                    buildTurns: 3,
                    requiresTech: "space_construction",
                    hp: 15,
                    defence: 2,
                    visionRange: [10, 13, 16],
                    tiers: [
                        {
                            cost: { money: 100, materials: 100, population: 0, science: 100 },
                            buildTurns: 3,
                            requiresTech: "sensor_arrays_2"
                        },
                        {
                            cost: { money: 200, materials: 150, population: 0, science: 200 },
                            buildTurns: 4,
                            requiresTech: "sensor_arrays_3"
                        }
                    ]
                }),
                space_station: spaceStructure({
                    ...SPACE_STRUCTURE_DEFAULTS,
                    cost: { money: 400, materials: 500, population: 20, science: 0 },
                    buildTurns: 5,
                    requiresTech: "space_stations_1",
                    hp: 50,
                    attack: 8,
                    defence: 8,
                    fireRadius: 1,
                    visionRange: [5, 6, 7],
                    repairBonus: 0.1,
                    tiers: [
                        {
                            cost: { money: 250, materials: 300, population: 0, science: 50 },
                            buildTurns: 4,
                            requiresTech: "space_stations_2"
                        },
                        {
                            cost: { money: 400, materials: 500, population: 0, science: 100 },
                            buildTurns: 5,
                            requiresTech: "space_stations_3"
                        }
                    ]
                }),
                missile_battery: spaceStructure({
                    ...SPACE_STRUCTURE_DEFAULTS,
                    cost: { money: 200, materials: 250, population: 5, science: 0 },
                    buildTurns: 3,
                    requiresTech: "missile_batteries",
                    hp: 20,
                    attack: 5,
                    defence: 3,
                    fireRadius: 2,
                    visionRange: [3, 3, 3]
                }),
                space_dock: spaceStructure({
                    ...SPACE_STRUCTURE_DEFAULTS,
                    cost: { money: 300, materials: 400, population: 20, science: 0 },
                    buildTurns: 4,
                    requiresTech: "space_construction",
                    hp: 30,
                    defence: 4,
                    repairBonus: 0.25,
                    docksShips: true,
                    shipSlots: 1
                }),
                stargate: spaceStructure({
                    ...SPACE_STRUCTURE_DEFAULTS,
                    cost: { money: 500, materials: 600, population: 0, science: 150 },
                    buildTurns: 6,
                    requiresTech: "stargates",
                    hp: 30,
                    defence: 4
                })
            })
            .strict()
            .prefault({}),
        /** Hyperspace jump risks; per-ship hyperdrives are under `ships.<type>.hyperdrive`. */
        hyperspace: z
            .object({
                /** Rolled for each hazard on the landing hex. */
                hazards: z
                    .object({
                        sun: hazard(0.5, 0.6),
                        planet: hazard(0.3, 0.4),
                        moon: hazard(0.25, 0.35),
                        large_asteroid: hazard(0.2, 0.3),
                        asteroid_belt: hazard(0.15, 0.25),
                        black_hole: hazard(0.9, 0.9)
                    })
                    .strict()
                    .prefault({}),
                collision: z
                    .object({
                        /**
                         * Chance (0-1) both ships are destroyed when a jump lands on a ship.
                         * Otherwise one is: the jumper with chance otherHp / (otherHp + jumperHp).
                         */
                        bothDestroyedChance: z.number().min(0).max(1).default(0.25)
                    })
                    .strict()
                    .prefault({}),
                /** Percentage points of accuracy per calibration tech; they add up. */
                techAccuracyBonus: z
                    .object({
                        hyperdrive_calibration_1: z.number().min(0).default(10),
                        hyperdrive_calibration_2: z.number().min(0).default(15)
                    })
                    .strict()
                    .prefault({}),
                /** Jump range as a share of the map diagonal; the highest known applies. */
                rangeFraction: z
                    .object({
                        base: z.number().positive().default(0.25),
                        hyperdrive_range_1: z.number().positive().default(0.5),
                        hyperdrive_range_2: z.number().positive().default(1)
                    })
                    .strict()
                    .prefault({})
            })
            .strict()
            .prefault({}),
        groundUnits: z
            .object({
                infantry: groundUnit({
                    cost: { money: 50, materials: 30, population: 20, science: 0 },
                    buildTurns: 2,
                    attack: 2,
                    defence: 3,
                    hp: 10,
                    requires: ["barracks"],
                    requiresTech: "ground_forces",
                    maxTier: 3
                }),
                armour: groundUnit({
                    cost: { money: 120, materials: 150, population: 10, science: 0 },
                    buildTurns: 3,
                    attack: 5,
                    defence: 4,
                    hp: 16,
                    requires: ["barracks"],
                    requiresTech: "ground_forces",
                    maxTier: 3
                })
            })
            .strict()
            .prefault({}),
        /** Added to ground unit attack and defence at tiers 1, 2 and 3. */
        groundUnitTiers: z
            .object({
                attackBonus: perTier(z.int(), [0, 1, 2]),
                defenceBonus: perTier(z.int(), [0, 1, 2])
            })
            .strict()
            .prefault({}),
        stockpileCaps: z
            .object({
                /** Per-resource cap on every location's stockpile, before storage installations. */
                default: resources({ money: 100, materials: 50, population: 50, science: 50 }),
                /**
                 * Base cap at each side's home planet. It should hold the starting stockpile
                 * (1000 money, 1000 materials, 200 population, 100 science); anything over
                 * it is clamped away at game start.
                 */
                home: resources({ money: 2000, materials: 2000, population: 500, science: 500 })
            })
            .strict()
            .prefault({}),
        /** Storage installations that raise stockpile caps. */
        storageStructures: z
            .object({
                vault: storageStructure({
                    cost: { money: 50, materials: 100, population: 5, science: 0 },
                    buildTurns: 2,
                    sites: ["planet", "moon"],
                    slots: 1,
                    capBonus: { ...NO_RESOURCES, money: 200 },
                    pillageProtection: 0.5,
                    maxTier: 3
                }),
                depot: storageStructure({
                    cost: { money: 100, materials: 50, population: 5, science: 0 },
                    buildTurns: 2,
                    sites: ["planet", "moon", "asteroid"],
                    slots: 1,
                    capBonus: { ...NO_RESOURCES, materials: 200 },
                    pillageProtection: 0.5,
                    maxTier: 3
                }),
                archive: storageStructure({
                    cost: { money: 100, materials: 100, population: 5, science: 0 },
                    buildTurns: 2,
                    sites: ["planet", "moon"],
                    slots: 1,
                    capBonus: { ...NO_RESOURCES, science: 150 },
                    pillageProtection: 0.5,
                    maxTier: 3
                }),
                quarters: storageStructure({
                    cost: { money: 100, materials: 100, population: 0, science: 0 },
                    buildTurns: 2,
                    sites: ["planet", "moon"],
                    slots: 1,
                    capBonus: { ...NO_RESOURCES, population: 150 },
                    pillageProtection: 0.5,
                    maxTier: 3
                }),
                warehouse: storageStructure({
                    cost: { money: 100, materials: 150, population: 5, science: 0 },
                    buildTurns: 3,
                    sites: ["planet", "moon", "asteroid"],
                    slots: 1,
                    capBonus: { money: 75, materials: 75, population: 50, science: 50 },
                    pillageProtection: 0.2,
                    maxTier: 3
                })
            })
            .strict()
            .prefault({}),
        /**
         * Orders each location runs at once per category (ships, installations, groundUnits,
         * research). Orders over the limit wait unfunded, with no supply demand, until a slot
         * frees up; active orders are picked by priority, then age.
         */
        buildSlots: z
            .object({
                base: z
                    .object({
                        ships: z.int().min(0).default(0),
                        installations: z.int().min(0).default(1),
                        groundUnits: z.int().min(0).default(0),
                        research: z.int().min(0).default(0)
                    })
                    .strict()
                    .prefault({}),
                /**
                 * Slots added per built installation of a type. Merged over the defaults
                 * (Shipyard +1 ship, Advanced Shipyard +1 ship, Barracks +1 ground unit,
                 * Science Academy +1 research); set a category to 0 to remove one.
                 */
                structures: z
                    .partialRecord(StructureType, BuildSlots.partial().strict())
                    .default({})
                    .transform((overrides) => {
                        const merged = { ...DEFAULT_STRUCTURE_BUILD_SLOTS };
                        for (const [type, slots] of Object.entries(overrides)) {
                            const key = type as StructureType;
                            merged[key] = { ...merged[key], ...slots };
                        }
                        return merged;
                    })
            })
            .strict()
            .prefault({})
    })
    .strict()
    .prefault({}) satisfies z.ZodType<EconomyBalance, unknown>;

export const Config = z
    .object({
        port: z.int().min(1024).max(65534).optional().default(3000),
        highlanderGameMode: z.boolean().optional().default(true),
        mapWidth: z.int().positive().optional().default(50),
        mapHeight: z.int().positive().optional().default(50),
        hexPointToPoint: z.number().positive().optional().default(100),
        visionRange: z.int().nonnegative().optional().default(6),
        mapSeed: z.int().optional(),
        /** Every hex starts explored for every side, remembering its initial contents. */
        revealMap: z.boolean().optional().default(false),
        /** Every hex is visible to every side at all times (implies explored). */
        fullVisibility: z.boolean().optional().default(false),
        /** Orders are funded from any of the side's stockpiles when placed, completing if covered. */
        instantBuild: z.boolean().optional().default(false),
        /** Supply ship hexes per turn before techs. */
        supplySpeed: z.int().nonnegative().optional().default(6),
        /** Supply ship capacity (total units) before techs. */
        supplyCapacity: z.int().positive().optional().default(100),
        /** How far a supply ship sees. */
        supplyVisionRange: z.int().nonnegative().optional().default(1),
        economy: EconomyBalanceConfig,
        logLevels: z
            .object({
                gameManager: LogLevel.optional(),
                game: LogLevel.optional(),
                server: LogLevel.optional()
            })
            .optional()
            .default({
                gameManager: LogLevel.enum.info,
                game: LogLevel.enum.info,
                server: LogLevel.enum.info
            })
    })
    .strict();
export type Config = z.infer<typeof Config>;

/** The economy balance with every value at its default. */
export function defaultEconomyBalance(): EconomyBalance {
    return EconomyBalanceConfig.parse(undefined);
}

function loadConfig(configFile = `${import.meta.dirname}/../../config/config.json`) {
    const fileContents = readFileSync(configFile, "utf-8");
    const rawConfig = JSON.parse(fileContents);
    return Config.parse(rawConfig);
}

export const config = loadConfig();
