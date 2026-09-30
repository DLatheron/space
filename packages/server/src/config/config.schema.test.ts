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
            requires: ["shipyard"],
            requiresTech: "transports",
            maxTier: 3,
            unitCapacity: 4,
            canColonise: false
        });
        expect(economy.ships.frigate.requires).toEqual(["advanced_shipyard"]);
        expect(economy.ships.colony_ship).toMatchObject({ canColonise: true, maxTier: 1 });
        expect(economy.shipTiers).toEqual({ hpMultiplier: [1, 1.5, 2], movementBonus: [0, 0, 1] });
        expect(economy.groundUnits.armour).toEqual({
            cost: { money: 120, materials: 150, population: 10, science: 0 },
            buildTurns: 3,
            attack: 5,
            defence: 4,
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
        expect(economy.shipTiers).toEqual({ hpMultiplier: [1, 1.5, 2], movementBonus: [0, 1, 2] });
        expect(economy.groundUnits.infantry).toMatchObject({ attack: 4, defence: 3, requires: [] });
        expect(economy.groundUnits.armour).toEqual(defaults.groundUnits.armour);
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
