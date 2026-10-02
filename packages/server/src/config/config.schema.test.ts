import { canAfford, EconomyBalance } from "@space/shared-data";
import { readFileSync } from "fs";
import { config, Config, defaultEconomyBalance } from "./config.schema.js";

describe("economy balance config", () => {
    it("fills every economy value with its default", () => {
        const economy = Config.parse({}).economy;
        expect(economy).toEqual(defaultEconomyBalance());
        expect(EconomyBalance.parse(economy)).toEqual(economy);
        expect(economy.stockpileCaps.default).toEqual({
            money: 100,
            materials: 50,
            population: 50,
            science: 50
        });
        expect(canAfford(economy.stockpileCaps.home, economy.startingStockpile)).toBe(true);
        expect(economy.buildSlots.base).toEqual({
            ships: 0,
            installations: 1,
            groundUnits: 0,
            research: 0
        });
        expect(economy.buildSlots.structures).toEqual({
            shipyard: { ships: 1 },
            advanced_shipyard: { ships: 1 },
            barracks: { groundUnits: 1 },
            science_academy: { research: 1 }
        });
        const { vault, warehouse } = economy.storageStructures;
        expect(vault.capBonus.money).toBeGreaterThan(warehouse.capBonus.money);
        expect(vault.pillageProtection).toBeGreaterThan(warehouse.pillageProtection);
    });

    it("defaults ships, ground units, installations and tier scaling", () => {
        const economy = defaultEconomyBalance();
        expect(economy.startingStockpile).toEqual({
            money: 1000,
            materials: 1000,
            population: 200,
            science: 100
        });
        expect(economy.startingShips).toEqual(["scout", "frigate"]);
        expect(economy.planetBaseIncomePerLevel).toEqual({
            money: 5,
            materials: 5,
            population: 2,
            science: 1
        });
        expect(economy.structureTierOutput).toEqual([1, 1.5, 2]);
        expect(economy.enhancementCostFactor).toEqual({ "2": 0.5, "3": 1 });
        expect(economy.structures.mine).toEqual({
            cost: { money: 100, materials: 0, population: 10, science: 0 },
            buildTurns: 2,
            sites: ["planet", "moon", "asteroid"],
            requires: [],
            requiresTech: null,
            produces: { money: 0, materials: 40, population: 0, science: 0 },
            shipCapBonus: 0,
            unique: false,
            slots: 1,
            maxTier: 3
        });
        expect(economy.structures.advanced_shipyard).toMatchObject({
            requires: ["shipyard"],
            requiresTech: "advanced_shipyard",
            unique: true,
            maxTier: 1
        });
        expect(economy.structures.docks.shipCapBonus).toBe(1);
        expect(economy.ships.transport).toEqual({
            cost: { money: 100, materials: 150, population: 5, science: 0 },
            buildTurns: 2,
            maxMovementPoints: 3,
            hp: 8,
            attack: 0,
            defence: 2,
            requires: ["shipyard"],
            requiresTech: "transports",
            maxTier: 3,
            unitCapacity: 4,
            canColonise: false,
            canBombard: false,
            class: "support",
            attackMultipliers: {},
            repairsInSpace: true
        });
        expect(economy.ships.frigate.requires).toEqual(["advanced_shipyard"]);
        expect(economy.ships.colony_ship).toMatchObject({ canColonise: true, maxTier: 1 });
        expect(economy.ships.fighter_squadron).toMatchObject({
            maxMovementPoints: 6,
            hp: 4,
            requires: ["shipyard"]
        });
        expect(economy.ships.advanced_fighter_squadron.requires).toEqual(["advanced_shipyard"]);
        expect(economy.ships.star_destroyer).toMatchObject({
            maxMovementPoints: 2,
            hp: 30,
            requires: ["advanced_shipyard", "docks"],
            maxTier: 3,
            unitCapacity: 4,
            canBombard: true
        });
        expect(economy.shipTiers).toEqual({
            hpMultiplier: [1, 1.5, 2],
            movementBonus: [0, 0, 1],
            hyperdriveAccuracyBonus: [0, 10, 20],
            attackBonus: [0, 1, 2],
            defenceBonus: [0, 1, 2]
        });
        expect(economy.groundUnits.armour).toEqual({
            cost: { money: 120, materials: 150, population: 10, science: 0 },
            buildTurns: 3,
            attack: 5,
            defence: 4,
            hp: 16,
            requires: ["barracks"],
            requiresTech: "ground_forces",
            maxTier: 3
        });
        expect(economy.groundUnitTiers).toEqual({
            attackBonus: [0, 1, 2],
            defenceBonus: [0, 1, 2]
        });
    });

    it("merges partial overrides over the defaults", () => {
        const economy = Config.parse({
            economy: {
                stockpileCaps: { default: { money: 300 } },
                storageStructures: { vault: { pillageProtection: 0.9, cost: { money: 10 } } },
                buildSlots: {
                    base: { installations: 2 },
                    structures: { docks: { installations: 1 }, shipyard: { ships: 2 } }
                }
            }
        }).economy;
        expect(economy.stockpileCaps.default).toEqual({
            money: 300,
            materials: 50,
            population: 50,
            science: 50
        });
        expect(economy.storageStructures.vault).toMatchObject({
            pillageProtection: 0.9,
            cost: { money: 10, materials: 100 },
            buildTurns: 2
        });
        expect(economy.buildSlots.base.installations).toBe(2);
        expect(economy.buildSlots.structures).toMatchObject({
            docks: { installations: 1 },
            shipyard: { ships: 2 },
            advanced_shipyard: { ships: 1 }
        });
    });

    it("merges partial ship, ground unit and installation overrides per type", () => {
        const defaults = defaultEconomyBalance();
        const economy = Config.parse({
            economy: {
                startingStockpile: { money: 50 },
                enhancementCostFactor: { "3": 1.5 },
                structureTierOutput: [1, 2, 4],
                structures: {
                    mine: { produces: { materials: 90 }, buildTurns: 5 },
                    barracks: { requiresTech: null, sites: ["moon"] }
                },
                ships: { scout: { cost: { money: 60 }, buildTurns: 1, hp: 3 } },
                shipTiers: { movementBonus: [0, 1, 2] },
                groundUnits: { infantry: { attack: 4, requires: [] } }
            }
        }).economy;
        expect(economy.startingStockpile).toEqual({ ...defaults.startingStockpile, money: 50 });
        expect(economy.enhancementCostFactor).toEqual({ "2": 0.5, "3": 1.5 });
        expect(economy.structureTierOutput).toEqual([1, 2, 4]);
        expect(economy.structures.mine).toEqual({
            ...defaults.structures.mine,
            produces: { ...defaults.structures.mine.produces, materials: 90 },
            buildTurns: 5
        });
        expect(economy.structures.barracks).toMatchObject({
            requiresTech: null,
            sites: ["moon"],
            unique: true
        });
        expect(economy.structures.habitat).toEqual(defaults.structures.habitat);
        expect(economy.ships.scout).toEqual({
            ...defaults.ships.scout,
            cost: { ...defaults.ships.scout.cost, money: 60 },
            buildTurns: 1,
            hp: 3
        });
        expect(economy.ships.frigate).toEqual(defaults.ships.frigate);
        expect(economy.shipTiers).toEqual({
            ...defaults.shipTiers,
            movementBonus: [0, 1, 2]
        });
        expect(economy.groundUnits.infantry).toMatchObject({ attack: 4, defence: 3, requires: [] });
        expect(economy.groundUnits.armour).toEqual(defaults.groundUnits.armour);
    });

    it("defaults combat stats, hangars, the damage formula and supply ship defences", () => {
        const economy = defaultEconomyBalance();
        const attackDefence = Object.fromEntries(
            Object.entries(economy.ships).map(([type, ship]) => [type, [ship.attack, ship.defence]])
        );
        expect(attackDefence).toEqual({
            scout: [1, 1],
            frigate: [4, 3],
            colony_ship: [0, 1],
            transport: [0, 2],
            fighter_squadron: [3, 1],
            advanced_fighter_squadron: [5, 2],
            bomber_squadron: [4, 0],
            star_destroyer: [8, 8],
            super_star_destroyer: [20, 14]
        });
        expect(economy.ships.star_destroyer.hangar).toEqual({
            capacity: 4,
            carries: ["fighter_squadron", "advanced_fighter_squadron", "bomber_squadron"]
        });
        expect(economy.ships.super_star_destroyer).toMatchObject({
            hp: 90,
            requires: ["advanced_shipyard", "docks"],
            requiresTech: "capital_ship_engineering",
            unitCapacity: 8,
            canBombard: true,
            hangar: {
                capacity: 10,
                carries: ["fighter_squadron", "advanced_fighter_squadron", "bomber_squadron"]
            },
            hyperdrive: { cooldownTurns: 5, accuracy: { onTarget: 40, oneOff: 45, twoOff: 15 } }
        });
        expect(economy.ships.frigate.hangar).toBeUndefined();
        expect(economy.combat).toEqual({
            spread: 0.25,
            minDamage: 1,
            defenceScale: 10,
            groundMaxRounds: 6,
            bombardmentInstallationChance: 0.4
        });
        expect(economy.supplyShips).toEqual({
            hp: 6,
            defence: 1,
            evasion: 0.3,
            maxEvasion: 0.75,
            techBonus: {
                evasive_manoeuvres_1: { hp: 0, defence: 0, evasion: 0.15 },
                evasive_manoeuvres_2: { hp: 0, defence: 0, evasion: 0.15 },
                armoured_freighters: { hp: 6, defence: 2, evasion: 0 }
            }
        });
        expect(economy.groundUnits.infantry.hp).toBe(10);
    });

    it("defaults and merges out-of-combat repair rates", () => {
        expect(defaultEconomyBalance().repair).toEqual({
            baseFraction: 0.1,
            minPerTurn: 1,
            techBonus: { damage_control_1: 0.05, damage_control_2: 0.1 },
            atOwnedShipyardBonus: 0.15,
            carriedBonus: 0.05
        });
        const economy = Config.parse({
            economy: { repair: { minPerTurn: 2, techBonus: { damage_control_2: 0.2 } } }
        }).economy;
        expect(economy.repair).toMatchObject({
            baseFraction: 0.1,
            minPerTurn: 2,
            techBonus: { damage_control_1: 0.05, damage_control_2: 0.2 }
        });
        expect(() => Config.parse({ economy: { repair: { baseFraction: 1.5 } } })).toThrow();
        expect(() =>
            Config.parse({ economy: { repair: { techBonus: { warp_repair: 0.1 } } } })
        ).toThrow();
    });

    it("defaults ship classes, attack multipliers, space repair and defences", () => {
        const economy = defaultEconomyBalance();
        const classes = Object.fromEntries(
            Object.entries(economy.ships).map(([type, ship]) => [type, ship.class])
        );
        expect(classes).toEqual({
            scout: "support",
            frigate: "capital",
            colony_ship: "support",
            transport: "support",
            fighter_squadron: "strike_craft",
            advanced_fighter_squadron: "strike_craft",
            bomber_squadron: "strike_craft",
            star_destroyer: "capital",
            super_star_destroyer: "capital"
        });
        expect(economy.ships.fighter_squadron.attackMultipliers).toEqual({ orbital_platform: 2 });
        expect(economy.ships.bomber_squadron.attackMultipliers).toEqual({
            capital: 2.5,
            orbital_platform: 2
        });
        expect(economy.ships.frigate.attackMultipliers).toEqual({});
        const docked = Object.entries(economy.ships)
            .filter(([, ship]) => !ship.repairsInSpace)
            .map(([type]) => type);
        expect(docked).toEqual([
            "fighter_squadron",
            "advanced_fighter_squadron",
            "bomber_squadron"
        ]);
        expect(economy.defences).toEqual({
            defensive_battery: { attack: 5, defence: 4 },
            shield_generator: {
                capacity: 40,
                rechargePerTurn: 10,
                upkeep: { money: 15, materials: 0, population: 0, science: 5 }
            },
            orbital_platform: { attack: 8, defence: 8, hp: 40 }
        });
        expect(economy.structures.shield_generator).toMatchObject({
            sites: ["planet", "moon"],
            requiresTech: "planetary_shields",
            unique: true
        });
        expect(economy.structures.orbital_platform).toMatchObject({
            requires: ["shipyard"],
            requiresTech: "orbital_defence_platforms",
            unique: true
        });
        expect(economy.structures.defensive_battery).toMatchObject({
            requiresTech: null,
            unique: false,
            slots: 1
        });

        const custom = Config.parse({
            economy: {
                ships: { frigate: { attackMultipliers: { strike_craft: 1.5 }, class: "support" } },
                defences: { shield_generator: { upkeep: { money: 40 } } }
            }
        }).economy;
        expect(custom.ships.frigate).toMatchObject({
            class: "support",
            attackMultipliers: { strike_craft: 1.5 }
        });
        expect(custom.defences.shield_generator).toEqual({
            capacity: 40,
            rechargePerTurn: 10,
            upkeep: { money: 40, materials: 0, population: 0, science: 5 }
        });
        const parse = (value: unknown) => () => Config.parse({ economy: value });
        expect(parse({ ships: { frigate: { class: "battleship" } } })).toThrow();
        expect(parse({ ships: { frigate: { attackMultipliers: { planet: 2 } } } })).toThrow();
        expect(parse({ ships: { frigate: { attackMultipliers: { capital: -1 } } } })).toThrow();
        expect(parse({ defences: { orbital_platform: { hp: 0 } } })).toThrow();
        expect(parse({ defences: { minefield: {} } })).toThrow();
    });

    it("adds, changes and removes hangars", () => {
        const economy = Config.parse({
            economy: {
                ships: {
                    star_destroyer: { hangar: null },
                    frigate: { hangar: { capacity: 1, carries: ["scout"] } },
                    transport: { attack: 2 }
                },
                combat: { spread: 0 },
                supplyShips: { techBonus: { armoured_freighters: { hp: 10 } } }
            }
        }).economy;
        expect(economy.ships.star_destroyer.hangar).toBeUndefined();
        expect(economy.ships.frigate.hangar).toEqual({ capacity: 1, carries: ["scout"] });
        expect(economy.ships.transport.attack).toBe(2);
        expect(economy.combat).toMatchObject({ spread: 0, minDamage: 1 });
        expect(economy.supplyShips.techBonus.armoured_freighters).toEqual({
            hp: 10,
            defence: 2,
            evasion: 0
        });
        const partial = Config.parse({
            economy: { ships: { star_destroyer: { hangar: { capacity: 6 } } } }
        }).economy;
        expect(partial.ships.star_destroyer.hangar).toEqual({
            capacity: 6,
            carries: ["fighter_squadron", "advanced_fighter_squadron", "bomber_squadron"]
        });
        expect(() =>
            Config.parse({ economy: { ships: { frigate: { hangar: { capacity: 1 } } } } })
        ).toThrow();
    });

    it("defaults hyperdrives, hyperspace hazards, collisions and accuracy bonuses", () => {
        const economy = defaultEconomyBalance();
        expect(economy.ships.frigate.hyperdrive).toEqual({
            cooldownTurns: 3,
            accuracy: { onTarget: 20, oneOff: 50, twoOff: 30 }
        });
        expect(economy.ships.star_destroyer.hyperdrive).toEqual({
            cooldownTurns: 4,
            accuracy: { onTarget: 30, oneOff: 50, twoOff: 20 }
        });
        for (const type of [
            "scout",
            "colony_ship",
            "transport",
            "fighter_squadron",
            "advanced_fighter_squadron"
        ] as const) {
            expect(economy.ships[type].hyperdrive).toBeUndefined();
        }
        expect(economy.hyperspace).toEqual({
            hazards: {
                sun: { destroyChance: 0.5, damageFraction: 0.6 },
                planet: { destroyChance: 0.3, damageFraction: 0.4 },
                moon: { destroyChance: 0.25, damageFraction: 0.35 },
                large_asteroid: { destroyChance: 0.2, damageFraction: 0.3 },
                asteroid_belt: { destroyChance: 0.15, damageFraction: 0.25 },
                black_hole: { destroyChance: 0.9, damageFraction: 0.9 }
            },
            collision: { bothDestroyedChance: 0.25 },
            techAccuracyBonus: { hyperdrive_calibration_1: 10, hyperdrive_calibration_2: 15 },
            rangeFraction: { base: 0.25, hyperdrive_range_1: 0.5, hyperdrive_range_2: 1 }
        });
    });

    it("merges hyperdrive and hyperspace overrides, adding or removing hyperdrives", () => {
        const economy = Config.parse({
            economy: {
                ships: {
                    frigate: { hyperdrive: { accuracy: { onTarget: 60 } } },
                    star_destroyer: { hyperdrive: null },
                    scout: { hyperdrive: { cooldownTurns: 1 } }
                },
                hyperspace: {
                    hazards: { sun: { destroyChance: 1 } },
                    collision: { bothDestroyedChance: 0 }
                }
            }
        }).economy;
        expect(economy.ships.frigate.hyperdrive).toEqual({
            cooldownTurns: 3,
            accuracy: { onTarget: 60, oneOff: 50, twoOff: 30 }
        });
        expect(economy.ships.star_destroyer.hyperdrive).toBeUndefined();
        expect(economy.ships.scout.hyperdrive).toEqual({
            cooldownTurns: 1,
            accuracy: { onTarget: 20, oneOff: 50, twoOff: 30 }
        });
        expect(economy.hyperspace.hazards.sun).toEqual({ destroyChance: 1, damageFraction: 0.6 });
        expect(economy.hyperspace.hazards.planet).toEqual({
            destroyChance: 0.3,
            damageFraction: 0.4
        });
        expect(economy.hyperspace.collision.bothDestroyedChance).toBe(0);
        expect(EconomyBalance.parse(economy)).toEqual(economy);

        const parse = (value: unknown) => () => Config.parse({ economy: value });
        expect(parse({ hyperspace: { hazards: { wormhole: {} } } })).toThrow();
        expect(parse({ hyperspace: { hazards: { sun: { destroyChance: 1.5 } } } })).toThrow();
        expect(parse({ hyperspace: { techAccuracyBonus: { warp: 5 } } })).toThrow();
        expect(parse({ hyperspace: { rangeFraction: { base: 0 } } })).toThrow();
        expect(parse({ hyperspace: { rangeFraction: { hyperdrive_range_3: 2 } } })).toThrow();
        expect(parse({ ships: { frigate: { hyperdrive: { cooldownTurns: -1 } } } })).toThrow();
        expect(parse({ shipTiers: { hyperdriveAccuracyBonus: [0, 10] } })).toThrow();
    });

    it("rejects out-of-range and unknown values", () => {
        const parse = (economy: unknown) => () => Config.parse({ economy });
        expect(parse({ storageStructures: { vault: { pillageProtection: 1.5 } } })).toThrow();
        expect(parse({ storageStructures: { vault: { maxTier: 4 } } })).toThrow();
        expect(parse({ buildSlots: { base: { ships: -1 } } })).toThrow();
        expect(parse({ buildSlots: { structures: { castle: { ships: 1 } } } })).toThrow();
        expect(parse({ stockpileCaps: { vault: {} } })).toThrow();
        expect(parse({ ships: { battleship: {} } })).toThrow();
        expect(parse({ ships: { scout: { buildTurns: 0 } } })).toThrow();
        expect(parse({ ships: { scout: { requiresTech: "warp" } } })).toThrow();
        expect(parse({ groundUnits: { infantry: { maxTier: 4 } } })).toThrow();
        expect(parse({ structures: { vault: {} } })).toThrow();
        expect(parse({ structures: { mine: { requires: ["castle"] } } })).toThrow();
        expect(parse({ structureTierOutput: [1, 2] })).toThrow();
        expect(parse({ startingShips: ["battleship"] })).toThrow();
    });

    it("loads config.json with every value written out", () => {
        expect(EconomyBalance.parse(config.economy)).toEqual(config.economy);
        const raw = JSON.parse(
            readFileSync(`${import.meta.dirname}/../../config/config.json`, "utf-8")
        );
        /** Object key paths, treating arrays as leaf values. */
        const paths = (value: unknown, prefix = ""): string[] =>
            value !== null && typeof value === "object" && !Array.isArray(value)
                ? Object.entries(value).flatMap(([k, v]) => paths(v, `${prefix}.${k}`))
                : [prefix];
        expect(paths(raw.economy).sort()).toEqual(paths(defaultEconomyBalance()).sort());
    });
});
