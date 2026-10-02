import {
    addResources,
    borrowedPopulation,
    buildItemCost,
    buildItemName,
    buildItemTurns,
    buildSlots,
    canBuild,
    canBombardShip,
    canCarryShip,
    combatDamage,
    countQueuedShips,
    createBuildOrder,
    depositCapped,
    fundLocationOrders,
    fundOrders,
    groundUnitStats,
    hangarFor,
    HOME_PLANET_LEVEL,
    incomeFor,
    isFullyFunded,
    locationDemand,
    locationIncome,
    maxEnhancementTierFor,
    moveOrderInQueue,
    orderDemands,
    packCargo,
    partitionOrders,
    queueCategory,
    ratePerTurn,
    repairsAtEndOf,
    resourceUnits,
    shipCapFor,
    shipRepairPerTurn,
    shipStats,
    siteForEntity,
    slotsForEntity,
    slotsUsed,
    stockpileCap,
    storageRoom,
    structureDef,
    subtractResources,
    structureOutput,
    supplyCapacityFor,
    supplyShipStats,
    supplySpeedFor,
    sumResources,
    surplusStock,
    zeroResources,
    type BuildContext,
    type BuildItem,
    type BuildOrder,
    type BuildPriority,
    type EconomyBalance,
    type Installation,
    type LocationEconomy,
    type Resources,
    type ShipBalance,
    type StorageStructureBalance,
    type StructureBalance
} from "../index.js";

function res(money = 0, materials = 0, population = 0, science = 0): Resources {
    return { money, materials, population, science };
}

function storage(capBonus: Resources, pillageProtection = 0.5): StorageStructureBalance {
    return {
        cost: res(100, 50, 5),
        buildTurns: 2,
        sites: ["planet", "moon"],
        slots: 1,
        capBonus,
        pillageProtection,
        maxTier: 3
    };
}

function structure(overrides: Partial<StructureBalance>): StructureBalance {
    return {
        cost: res(100, 150, 10),
        buildTurns: 2,
        sites: ["planet"],
        requires: [],
        requiresTech: null,
        produces: res(),
        shipCapBonus: 0,
        unique: false,
        slots: 1,
        maxTier: 1,
        ...overrides
    };
}

function ship(overrides: Partial<ShipBalance>): ShipBalance {
    return {
        cost: res(100, 100, 5),
        buildTurns: 2,
        maxMovementPoints: 3,
        hp: 6,
        attack: 1,
        defence: 1,
        requires: ["shipyard"],
        requiresTech: null,
        maxTier: 3,
        unitCapacity: 0,
        canColonise: false,
        canBombard: false,
        ...overrides
    };
}

const STARTING_STOCKPILE = res(1000, 1000, 200, 100);

const balance: EconomyBalance = {
    startingStockpile: STARTING_STOCKPILE,
    startingShips: ["scout", "frigate"],
    planetBaseIncomePerLevel: res(5, 5, 2, 1),
    structureTierOutput: [1, 1.5, 2],
    enhancementCostFactor: { "2": 0.5, "3": 1 },
    structures: {
        habitat: structure({
            cost: res(50, 100),
            sites: ["planet", "moon"],
            produces: res(0, 0, 10),
            maxTier: 3
        }),
        mine: structure({
            cost: res(100, 0, 10),
            sites: ["planet", "moon", "asteroid"],
            produces: res(0, 40),
            maxTier: 3
        }),
        trade_hub: structure({
            cost: res(0, 100, 10),
            sites: ["planet", "moon"],
            produces: res(40),
            maxTier: 3
        }),
        shipyard: structure({ cost: res(150, 200, 20), buildTurns: 3, unique: true }),
        advanced_shipyard: structure({
            cost: res(250, 300, 30),
            buildTurns: 4,
            requires: ["shipyard"],
            requiresTech: "advanced_shipyard",
            unique: true
        }),
        docks: structure({ requires: ["shipyard"], shipCapBonus: 1 }),
        science_academy: structure({
            cost: res(200, 150, 20),
            buildTurns: 3,
            produces: res(0, 0, 0, 20),
            unique: true,
            maxTier: 3
        }),
        barracks: structure({
            sites: ["planet", "moon"],
            requiresTech: "ground_forces",
            unique: true
        })
    },
    ships: {
        scout: ship({ maxMovementPoints: 5 }),
        frigate: ship({
            cost: res(200, 300, 15),
            buildTurns: 3,
            hp: 12,
            attack: 4,
            defence: 3,
            requires: ["advanced_shipyard"],
            hyperdrive: { cooldownTurns: 3, accuracy: { onTarget: 20, oneOff: 50, twoOff: 30 } }
        }),
        colony_ship: ship({
            cost: res(200, 200, 50),
            buildTurns: 3,
            maxMovementPoints: 2,
            hp: 4,
            attack: 0,
            maxTier: 1,
            canColonise: true
        }),
        transport: ship({
            cost: res(100, 150, 5),
            hp: 8,
            requiresTech: "transports",
            unitCapacity: 4
        }),
        fighter_squadron: ship({ cost: res(80, 60, 10), maxMovementPoints: 6, hp: 4 }),
        advanced_fighter_squadron: ship({
            cost: res(150, 120, 15),
            buildTurns: 3,
            maxMovementPoints: 6,
            hp: 7,
            requires: ["advanced_shipyard"]
        }),
        star_destroyer: ship({
            cost: res(600, 800, 60),
            buildTurns: 6,
            maxMovementPoints: 2,
            hp: 30,
            attack: 8,
            defence: 8,
            requires: ["advanced_shipyard", "docks"],
            unitCapacity: 4,
            canBombard: true,
            hyperdrive: { cooldownTurns: 4, accuracy: { onTarget: 30, oneOff: 50, twoOff: 20 } },
            hangar: { capacity: 4, carries: ["fighter_squadron", "advanced_fighter_squadron"] }
        })
    },
    shipTiers: {
        hpMultiplier: [1, 1.5, 2],
        movementBonus: [0, 0, 1],
        hyperdriveAccuracyBonus: [0, 10, 20],
        attackBonus: [0, 1, 2],
        defenceBonus: [0, 1, 2]
    },
    combat: {
        spread: 0.25,
        minDamage: 1,
        defenceScale: 10,
        groundMaxRounds: 6,
        bombardmentInstallationChance: 0.4
    },
    supplyShips: {
        hp: 6,
        defence: 1,
        evasion: 0.3,
        maxEvasion: 0.75,
        techBonus: {
            evasive_manoeuvres_1: { hp: 0, defence: 0, evasion: 0.15 },
            evasive_manoeuvres_2: { hp: 0, defence: 0, evasion: 0.4 },
            armoured_freighters: { hp: 6, defence: 2, evasion: 0 }
        }
    },
    repair: {
        baseFraction: 0.1,
        minPerTurn: 1,
        techBonus: { damage_control_1: 0.05, damage_control_2: 0.1 },
        atOwnedShipyardBonus: 0.15,
        carriedBonus: 0.05
    },
    hyperspace: {
        hazards: {
            sun: { destroyChance: 0.5, damageFraction: 0.6 },
            planet: { destroyChance: 0.3, damageFraction: 0.4 },
            moon: { destroyChance: 0.25, damageFraction: 0.35 },
            large_asteroid: { destroyChance: 0.2, damageFraction: 0.3 },
            asteroid_belt: { destroyChance: 0.15, damageFraction: 0.25 },
            black_hole: { destroyChance: 0.9, damageFraction: 0.9 }
        },
        collision: { bothDestroyedChance: 0.25 },
        techAccuracyBonus: { hyperdrive_calibration_1: 10, hyperdrive_calibration_2: 15 }
    },
    groundUnits: {
        infantry: {
            cost: res(50, 30, 20),
            buildTurns: 2,
            attack: 2,
            defence: 3,
            hp: 10,
            requires: ["barracks"],
            requiresTech: "ground_forces",
            maxTier: 3
        },
        armour: {
            cost: res(120, 150, 10),
            buildTurns: 3,
            attack: 5,
            defence: 4,
            hp: 16,
            requires: ["barracks"],
            requiresTech: "ground_forces",
            maxTier: 3
        }
    },
    groundUnitTiers: { attackBonus: [0, 1, 2], defenceBonus: [0, 1, 2] },
    stockpileCaps: { default: res(100, 50, 50, 50), home: res(2000, 2000, 500, 500) },
    storageStructures: {
        vault: storage(res(200)),
        depot: storage(res(0, 200)),
        archive: storage(res(0, 0, 0, 150)),
        quarters: storage(res(0, 0, 150)),
        warehouse: { ...storage(res(75, 75, 50, 50), 0.2), slots: 2 }
    },
    buildSlots: {
        base: { ships: 0, installations: 1, groundUnits: 0, research: 0 },
        structures: {
            shipyard: { ships: 1 },
            advanced_shipyard: { ships: 1 },
            barracks: { groundUnits: 1 },
            science_academy: { research: 1 }
        }
    }
};

let nextId = 0;
function inst(type: Installation["type"], tier = 1): Installation {
    return { id: `i${++nextId}`, type, tier, populationFrom: "p1" };
}

function location(overrides: Partial<LocationEconomy> = {}): LocationEconomy {
    return {
        locationId: "p1",
        site: "planet",
        level: HOME_PLANET_LEVEL,
        slots: HOME_PLANET_LEVEL,
        stockpile: { ...STARTING_STOCKPILE },
        installations: [],
        orders: [],
        ...overrides
    };
}

function ctx(overrides: Partial<BuildContext> = {}): BuildContext {
    return { shipCount: 2, shipCap: 3, techs: [], balance, ...overrides };
}

/** Order with a hand-picked cost and build time (money only unless given). */
function order(
    id: string,
    priority: BuildPriority,
    cost: Resources,
    buildTurns: number,
    applied: Resources = zeroResources()
): BuildOrder {
    return {
        id,
        item: { kind: "structure", structureType: "mine" },
        priority,
        cost,
        applied,
        ratePerTurn: ratePerTurn(cost, buildTurns)
    };
}

const mine: BuildItem = { kind: "structure", structureType: "mine" };
const scout: BuildItem = { kind: "ship", shipType: "scout" };

describe("ratePerTurn", () => {
    it("rounds each resource up", () => {
        expect(ratePerTurn(res(100, 30, 10, 0), 4)).toEqual(res(25, 8, 3, 0));
    });

    it("treats a zero-turn build as one turn", () => {
        expect(ratePerTurn(res(7, 0, 0, 0), 0)).toEqual(res(7, 0, 0, 0));
    });
});

describe("createBuildOrder", () => {
    it("fills cost and rate from the item, defaulting to medium priority", () => {
        const o = createBuildOrder("o1", mine, balance);
        expect(o).toEqual({
            id: "o1",
            item: mine,
            priority: "medium",
            cost: res(100, 0, 10, 0),
            applied: zeroResources(),
            ratePerTurn: res(50, 0, 5, 0)
        });
        expect(createBuildOrder("o2", scout, balance, "high").priority).toBe("high");
    });
});

describe("fundOrders", () => {
    it("draws up to the per-turn rate and leaves the rest in the stockpile", () => {
        const result = fundOrders(res(100), [order("a", "medium", res(100), 4)]);
        expect(result.drawn.a).toEqual(res(25));
        expect(result.stockpile).toEqual(res(75));
        expect(result.orders[0]!.applied).toEqual(res(25));
    });

    it("caps the draw at what the order still needs", () => {
        const result = fundOrders(res(100), [order("a", "medium", res(100), 4, res(90))]);
        expect(result.drawn.a).toEqual(res(10));
        expect(result.stockpile).toEqual(res(90));
        expect(isFullyFunded(result.orders[0]!)).toBe(true);
    });

    it("never completes a build before buildTurns, even with plenty of stock", () => {
        let orders = [order("a", "medium", res(100, 50, 10, 0), 4)];
        let stockpile = res(1000, 1000, 1000, 0);
        let turns = 0;
        while (!isFullyFunded(orders[0]!)) {
            ({ orders, stockpile } = fundOrders(stockpile, orders));
            turns++;
        }
        expect(turns).toBe(4);
        expect(stockpile).toEqual(res(900, 950, 990, 0));
    });

    it("splits equally within a tier", () => {
        const result = fundOrders(res(30), [
            order("a", "medium", res(100), 1),
            order("b", "medium", res(100), 1),
            order("c", "medium", res(100), 1)
        ]);
        expect(result.drawn).toEqual({ a: res(10), b: res(10), c: res(10) });
        expect(result.stockpile).toEqual(res(0));
    });

    it("gives indivisible leftovers to the earliest orders", () => {
        const result = fundOrders(res(11), [
            order("a", "medium", res(100), 1),
            order("b", "medium", res(100), 1),
            order("c", "medium", res(100), 1)
        ]);
        expect(result.drawn).toEqual({ a: res(4), b: res(4), c: res(3) });
        expect(result.stockpile).toEqual(res(0));
    });

    it("redistributes a capped order's share within the tier", () => {
        const result = fundOrders(res(90), [
            order("small", "medium", res(20), 2), // rate 10
            order("b", "medium", res(100), 1),
            order("c", "medium", res(100), 1)
        ]);
        expect(result.drawn).toEqual({ small: res(10), b: res(40), c: res(40) });
        expect(result.stockpile).toEqual(res(0));
    });

    it("keeps redistributing across several rounds of capping", () => {
        const result = fundOrders(res(100), [
            order("a", "medium", res(5), 1),
            order("b", "medium", res(100), 4), // rate 25
            order("c", "medium", res(200), 1)
        ]);
        expect(result.drawn).toEqual({ a: res(5), b: res(25), c: res(70) });
    });

    it("leaves stock unused when every order in every tier is capped", () => {
        const result = fundOrders(res(100), [
            order("a", "high", res(40), 4),
            order("b", "low", res(40), 4)
        ]);
        expect(result.drawn).toEqual({ a: res(10), b: res(10) });
        expect(result.stockpile).toEqual(res(80));
    });

    it("serves high, then medium, then low", () => {
        const result = fundOrders(res(50), [
            order("low", "low", res(100), 1),
            order("med", "medium", res(30), 1),
            order("high", "high", res(40), 2) // rate 20
        ]);
        expect(result.drawn).toEqual({ high: res(20), med: res(30), low: res(0) });
        expect(result.stockpile).toEqual(res(0));
    });

    it("lets a lower tier take what a higher tier can't use", () => {
        const result = fundOrders(res(50), [
            order("low", "low", res(100), 1),
            order("high", "high", res(40), 4) // rate 10
        ]);
        expect(result.drawn).toEqual({ high: res(10), low: res(40) });
    });

    it("shares each resource independently", () => {
        const result = fundOrders(res(10, 100, 0, 5), [
            order("a", "medium", res(100, 20, 0, 0), 1),
            order("b", "medium", res(100, 100, 0, 10), 1)
        ]);
        expect(result.drawn.a).toEqual(res(5, 20, 0, 0));
        expect(result.drawn.b).toEqual(res(5, 80, 0, 5));
        expect(result.stockpile).toEqual(res(0, 0, 0, 0));
    });

    it("carries excess over to later turns", () => {
        const first = fundOrders(res(60), [order("a", "medium", res(100), 4)]);
        expect(first.stockpile).toEqual(res(35));
        const second = fundOrders(first.stockpile, first.orders);
        expect(second.orders[0]!.applied).toEqual(res(50));
        expect(second.stockpile).toEqual(res(10));
    });

    it("includes zero draws, handles no orders and doesn't mutate inputs", () => {
        const stockpile = res(10);
        const orders = [order("done", "high", res(10), 1, res(10))];
        const result = fundOrders(stockpile, orders);
        expect(result.drawn).toEqual({ done: zeroResources() });
        expect(stockpile).toEqual(res(10));
        expect(orders[0]!.applied).toEqual(res(10));
        expect(fundOrders(res(5), [])).toEqual({ stockpile: res(5), drawn: {}, orders: [] });
    });

    it("never draws more than the stockpile holds", () => {
        const orders = Array.from({ length: 7 }, (_, i) =>
            order(`o${i}`, i % 3 === 0 ? "high" : "low", res(13 + i, 5, 3, 1), 1 + (i % 4))
        );
        const stockpile = res(17, 9, 4, 2);
        const result = fundOrders(stockpile, orders);
        const total = sumResources([...Object.values(result.drawn), result.stockpile]);
        expect(total).toEqual(stockpile);
        for (const k of ["money", "materials", "population", "science"] as const) {
            expect(result.stockpile[k]).toBeGreaterThanOrEqual(0);
        }
    });
});

describe("orderDemands / locationDemand", () => {
    const orders = [
        order("low", "low", res(100, 50), 1),
        order("high", "high", res(80, 0, 20), 1, res(30)),
        order("med", "medium", res(40), 1)
    ];

    it("lists remaining need by priority when nothing is covered", () => {
        expect(orderDemands(zeroResources(), orders)).toEqual([
            { orderId: "high", priority: "high", amount: res(50, 0, 20) },
            { orderId: "med", priority: "medium", amount: res(40) },
            { orderId: "low", priority: "low", amount: res(100, 50) }
        ]);
    });

    it("subtracts stockpile then in-flight cargo, high priority first", () => {
        const demand = orderDemands(res(60, 10), orders, res(20, 0, 20));
        expect(demand).toEqual([
            { orderId: "med", priority: "medium", amount: res(10) },
            { orderId: "low", priority: "low", amount: res(100, 40) }
        ]);
        expect(locationDemand(res(60, 10), orders, res(20, 0, 20))).toEqual({
            high: zeroResources(),
            medium: res(10),
            low: res(100, 40)
        });
    });

    it("is empty when everything is covered", () => {
        expect(orderDemands(res(1000, 1000, 1000), orders)).toEqual([]);
    });
});

describe("surplusStock", () => {
    it("keeps back what local orders still need", () => {
        const orders = [order("a", "low", res(100, 20), 4, res(50))];
        expect(surplusStock(res(80, 10, 5), orders)).toEqual(res(30, 0, 5));
        expect(surplusStock(res(80, 10, 5), [])).toEqual(res(80, 10, 5));
    });
});

describe("packCargo", () => {
    it("fills ships up to capacity with mixed resources", () => {
        const loads = packCargo(res(120, 50, 30, 0), 100);
        expect(loads).toEqual([res(100), res(20, 50, 30)]);
        expect(loads.every((l) => resourceUnits(l) <= 100)).toBe(true);
    });

    it("returns nothing for empty cargo or zero capacity", () => {
        expect(packCargo(zeroResources(), 100)).toEqual([]);
        expect(packCargo(res(10), 0)).toEqual([]);
    });

    it("splits exact multiples without an empty trailing load", () => {
        expect(packCargo(res(200), 100)).toEqual([res(100), res(100)]);
    });
});

describe("buildItem helpers", () => {
    it("cover every item kind", () => {
        const research: BuildItem = { kind: "research", techId: "ground_forces" };
        const infantry: BuildItem = { kind: "groundUnit", unitType: "infantry" };
        const upgrade: BuildItem = {
            kind: "enhancement",
            target: { kind: "ship", shipId: "s1", shipType: "frigate" },
            tier: 2
        };
        expect(buildItemName(research)).toBe("Ground Forces");
        expect(buildItemName(infantry)).toBe("Infantry");
        expect(buildItemName(upgrade)).toBe("Frigate tier 2");
        expect(buildItemTurns(upgrade, balance)).toBe(3);
        expect(buildItemCost(upgrade, balance)).toEqual(res(100, 150, 0, 0));
        expect(buildItemCost({ ...upgrade, tier: 3 } as BuildItem, balance)).toEqual(
            res(200, 300, 0, 0)
        );
    });

    it("borrows population only for things that exist afterwards", () => {
        expect(borrowedPopulation(mine, balance)).toBe(10);
        expect(borrowedPopulation({ kind: "groundUnit", unitType: "infantry" }, balance)).toBe(20);
        expect(borrowedPopulation({ kind: "research", techId: "transports" }, balance)).toBe(0);
    });
});

describe("tier stats", () => {
    it("scales structure output, ship stats and ground unit stats", () => {
        expect(structureOutput("mine", 1, balance)).toEqual(res(0, 40));
        expect(structureOutput("mine", 3, balance)).toEqual(res(0, 80));
        expect(shipStats("frigate", 2, balance)).toEqual({
            hp: 18,
            maxMovementPoints: 3,
            attack: 5,
            defence: 4
        });
        expect(shipStats("frigate", 3, balance)).toEqual({
            hp: 24,
            maxMovementPoints: 4,
            attack: 6,
            defence: 5
        });
        expect(shipStats("colony_ship", 3, balance)).toMatchObject({ attack: 0, defence: 3 });
        expect(groundUnitStats("armour", 3, balance)).toEqual({ attack: 7, defence: 6, hp: 16 });
    });

    it("takes tier multipliers and bonuses from the balance", () => {
        const custom: EconomyBalance = {
            ...balance,
            structureTierOutput: [1, 3, 5],
            shipTiers: {
                hpMultiplier: [1, 1, 3],
                movementBonus: [0, 2, 2],
                hyperdriveAccuracyBonus: [0, 0, 0],
                attackBonus: [0, 3, 3],
                defenceBonus: [0, 0, 1]
            },
            groundUnitTiers: { attackBonus: [0, 0, 4], defenceBonus: [0, 5, 5] },
            enhancementCostFactor: { "2": 0.25, "3": 2 }
        };
        expect(structureOutput("mine", 2, custom)).toEqual(res(0, 120));
        expect(shipStats("frigate", 2, custom)).toEqual({
            hp: 12,
            maxMovementPoints: 5,
            attack: 7,
            defence: 3
        });
        expect(shipStats("frigate", 3, custom)).toEqual({
            hp: 36,
            maxMovementPoints: 5,
            attack: 7,
            defence: 4
        });
        expect(groundUnitStats("armour", 3, custom)).toEqual({ attack: 9, defence: 9, hp: 16 });
        const upgrade: BuildItem = {
            kind: "enhancement",
            target: { kind: "ship", shipId: "s1", shipType: "frigate" },
            tier: 2
        };
        expect(buildItemCost(upgrade, custom)).toEqual(res(50, 75, 0, 0));
        expect(buildItemCost({ ...upgrade, tier: 3 } as BuildItem, custom)).toEqual(
            res(400, 600, 0, 0)
        );
    });
});

describe("structureDef", () => {
    it("merges balance stats and derives what a structure unlocks", () => {
        expect(structureDef("shipyard", balance)).toMatchObject({
            name: "Shipyard",
            cost: res(150, 200, 20),
            unique: true,
            unlocksShips: ["scout", "colony_ship", "transport", "fighter_squadron"],
            unlocksGroundUnits: []
        });
        expect(structureDef("advanced_shipyard", balance).unlocksShips).toEqual([
            "frigate",
            "advanced_fighter_squadron",
            "star_destroyer"
        ]);
        expect(structureDef("docks", balance).unlocksShips).toEqual(["star_destroyer"]);
        expect(structureDef("barracks", balance).unlocksGroundUnits).toEqual([
            "infantry",
            "armour"
        ]);
        const moved: EconomyBalance = {
            ...balance,
            ships: {
                ...balance.ships,
                frigate: { ...balance.ships.frigate, requires: ["shipyard"] }
            }
        };
        expect(structureDef("shipyard", moved).unlocksShips).toContain("frigate");
        expect(structureDef("advanced_shipyard", moved).unlocksShips).not.toContain("frigate");
    });
});

describe("tech helpers", () => {
    it("takes the best supply stats and enhancement tier known", () => {
        expect(supplySpeedFor([])).toBe(6);
        expect(supplySpeedFor(["supply_speed_1", "supply_speed_2"])).toBe(10);
        expect(supplyCapacityFor(["supply_capacity_1"])).toBe(150);
        expect(supplyCapacityFor([], 120)).toBe(120);
        expect(maxEnhancementTierFor([])).toBe(1);
        expect(maxEnhancementTierFor(["enhancement_tier_2"])).toBe(2);
    });
});

describe("location entities", () => {
    it("maps entities to sites and slots", () => {
        const base = { id: "x", q: 0, r: 0, sideId: null, systemId: "s" };
        expect(siteForEntity({ ...base, kind: "planet", level: 7 })).toBe("planet");
        expect(slotsForEntity({ ...base, kind: "planet", level: 7 })).toBe(7);
        expect(slotsForEntity({ ...base, kind: "moon" })).toBe(3);
        expect(siteForEntity({ ...base, kind: "large_asteroid" })).toBeUndefined();
        expect(slotsForEntity({ ...base, kind: "large_asteroid" })).toBe(0);
        expect(siteForEntity({ ...base, kind: "large_asteroid", mineable: true })).toBe("asteroid");
        expect(slotsForEntity({ ...base, kind: "large_asteroid", mineable: true, slots: 4 })).toBe(
            4
        );
    });
});

describe("shipCapFor", () => {
    it("gives a level-10 home planet a cap of 3", () => {
        expect(shipCapFor([location()], balance)).toBe(3);
    });

    it("adds 1 per Docks, sums across planets and ignores moons' level", () => {
        const docked = location({ installations: [inst("shipyard"), inst("docks")] });
        expect(shipCapFor([docked], balance)).toBe(4);
        expect(
            shipCapFor([location(), location({ level: 4 }), location({ level: 20 })], balance)
        ).toBe(3 + 1 + 5);
        expect(shipCapFor([location({ site: "moon", level: 0, slots: 3 })], balance)).toBe(0);
    });

    it("takes the Docks bonus from the balance", () => {
        const bigDocks: EconomyBalance = {
            ...balance,
            structures: {
                ...balance.structures,
                docks: { ...balance.structures.docks, shipCapBonus: 3 }
            }
        };
        const docked = location({ installations: [inst("shipyard"), inst("docks")] });
        expect(shipCapFor([docked], bigDocks)).toBe(6);
    });
});

describe("incomeFor", () => {
    it("scales planet base income by level and adds tiered installation output", () => {
        expect(incomeFor([location()], balance)).toEqual(res(50, 50, 20, 10));
        expect(
            incomeFor(
                [
                    location({
                        installations: [
                            inst("mine"),
                            inst("mine", 2),
                            inst("habitat"),
                            inst("shipyard")
                        ]
                    }),
                    location({ level: 1 })
                ],
                balance
            )
        ).toEqual(res(55, 50 + 40 + 60 + 5, 20 + 10 + 2, 11));
        expect(
            incomeFor([location()], { ...balance, planetBaseIncomePerLevel: res(1, 2, 3, 4) })
        ).toEqual(res(10, 20, 30, 40));
    });

    it("gives moons and asteroids no base income", () => {
        const asteroid = location({
            site: "asteroid",
            level: 0,
            slots: 2,
            installations: [inst("mine")]
        });
        expect(locationIncome(asteroid, balance)).toEqual(res(0, 40));
    });
});

describe("slotsUsed / countQueuedShips", () => {
    it("counts installations and ordered structures, and ordered ships", () => {
        const p = location({
            installations: [inst("mine")],
            orders: [createBuildOrder("a", mine, balance), createBuildOrder("b", scout, balance)]
        });
        expect(slotsUsed(p, balance)).toBe(2);
        expect(
            countQueuedShips([p, location({ orders: [createBuildOrder("c", scout, balance)] })])
        ).toBe(2);
    });
});

describe("canBuild", () => {
    it("allows a mine on an empty home planet regardless of stock", () => {
        expect(canBuild(ctx(), location({ stockpile: zeroResources() }), mine)).toEqual({
            ok: true
        });
    });

    it("checks allowed sites", () => {
        const asteroid = location({ site: "asteroid", level: 0, slots: 2 });
        expect(canBuild(ctx(), asteroid, mine)).toEqual({ ok: true });
        expect(canBuild(ctx(), asteroid, { kind: "structure", structureType: "shipyard" })).toEqual(
            {
                ok: false,
                reason: "Can't be built on an asteroid"
            }
        );
    });

    it("rejects when slots are full, counting ordered structures", () => {
        const p = location({
            slots: 2,
            installations: [inst("mine")],
            orders: [createBuildOrder("a", mine, balance)]
        });
        expect(canBuild(ctx(), p, mine)).toEqual({ ok: false, reason: "No free structure slots" });
    });

    it("requires prerequisites to be built, not ordered", () => {
        const docks: BuildItem = { kind: "structure", structureType: "docks" };
        const shipyard: BuildItem = { kind: "structure", structureType: "shipyard" };
        expect(canBuild(ctx(), location(), docks)).toEqual({
            ok: false,
            reason: "Requires Shipyard"
        });
        const ordered = location({ orders: [createBuildOrder("a", shipyard, balance)] });
        expect(canBuild(ctx(), ordered, docks)).toEqual({ ok: false, reason: "Requires Shipyard" });
        expect(canBuild(ctx(), location({ installations: [inst("shipyard")] }), docks)).toEqual({
            ok: true
        });
    });

    it("allows only one shipyard per location", () => {
        const shipyard: BuildItem = { kind: "structure", structureType: "shipyard" };
        expect(canBuild(ctx(), location({ installations: [inst("shipyard")] }), shipyard)).toEqual({
            ok: false,
            reason: "Only one Shipyard per location"
        });
    });

    it("requires techs for gated structures, ships and ground units", () => {
        const barracks: BuildItem = { kind: "structure", structureType: "barracks" };
        const transport: BuildItem = { kind: "ship", shipType: "transport" };
        const infantry: BuildItem = { kind: "groundUnit", unitType: "infantry" };
        expect(canBuild(ctx(), location(), barracks)).toEqual({
            ok: false,
            reason: "Requires Ground Forces"
        });
        expect(canBuild(ctx({ techs: ["ground_forces"] }), location(), barracks)).toEqual({
            ok: true
        });
        const yard = location({ installations: [inst("shipyard")] });
        expect(canBuild(ctx(), yard, transport)).toEqual({
            ok: false,
            reason: "Requires Troop Transports"
        });
        expect(canBuild(ctx({ techs: ["transports"] }), yard, transport)).toEqual({ ok: true });
        expect(canBuild(ctx({ techs: ["ground_forces"] }), location(), infantry)).toEqual({
            ok: false,
            reason: "Requires Barracks"
        });
        expect(
            canBuild(
                ctx({ techs: ["ground_forces"] }),
                location({ installations: [inst("barracks")] }),
                infantry
            )
        ).toEqual({ ok: true });
    });

    it("requires the right shipyard for ships", () => {
        const frigate: BuildItem = { kind: "ship", shipType: "frigate" };
        expect(canBuild(ctx(), location(), scout)).toEqual({
            ok: false,
            reason: "Requires Shipyard"
        });
        expect(canBuild(ctx(), location({ installations: [inst("shipyard")] }), frigate)).toEqual({
            ok: false,
            reason: "Requires Advanced Shipyard"
        });
        const yard = location({ installations: [inst("shipyard")] });
        expect(canBuild(ctx(), yard, scout)).toEqual({ ok: true });
        expect(canBuild(ctx(), yard, { kind: "ship", shipType: "colony_ship" })).toEqual({
            ok: true
        });
        expect(canBuild(ctx(), yard, { kind: "ship", shipType: "fighter_squadron" })).toEqual({
            ok: true
        });
    });

    it("needs an Advanced Shipyard and Docks for a Star Destroyer", () => {
        const destroyer: BuildItem = { kind: "ship", shipType: "star_destroyer" };
        const advanced = [inst("shipyard"), inst("advanced_shipyard")];
        expect(canBuild(ctx(), location({ installations: advanced }), destroyer)).toEqual({
            ok: false,
            reason: "Requires Docks"
        });
        expect(
            canBuild(ctx(), location({ installations: [...advanced, inst("docks")] }), destroyer)
        ).toEqual({ ok: true });
        expect(
            canBuild(ctx(), location({ installations: advanced }), {
                kind: "ship",
                shipType: "advanced_fighter_squadron"
            })
        ).toEqual({ ok: true });
    });

    it("rejects ships at the ship cap", () => {
        expect(
            canBuild(ctx({ shipCount: 3 }), location({ installations: [inst("shipyard")] }), scout)
        ).toEqual({ ok: false, reason: "Ship cap reached" });
    });

    describe("research", () => {
        const academy = location({ installations: [inst("science_academy")] });
        const research = (techId: "transports" | "ground_forces"): BuildItem => ({
            kind: "research",
            techId
        });

        it("needs a Science Academy", () => {
            expect(canBuild(ctx(), location(), research("ground_forces"))).toEqual({
                ok: false,
                reason: "Requires Science Academy"
            });
            expect(canBuild(ctx(), academy, research("ground_forces"))).toEqual({ ok: true });
        });

        it("checks prerequisites, known techs and duplicates", () => {
            expect(canBuild(ctx(), academy, research("transports"))).toEqual({
                ok: false,
                reason: "Requires Ground Forces"
            });
            expect(
                canBuild(ctx({ techs: ["ground_forces"] }), academy, research("ground_forces"))
            ).toEqual({ ok: false, reason: "Already researched" });
            expect(
                canBuild(
                    ctx({ researching: ["ground_forces"] }),
                    academy,
                    research("ground_forces")
                )
            ).toEqual({ ok: false, reason: "Already being researched" });
        });
    });

    describe("enhancement", () => {
        const mineInst = inst("mine");
        const upgradeMine = (tier: number): BuildItem =>
            ({
                kind: "enhancement",
                target: {
                    kind: "installation",
                    installationId: mineInst.id,
                    structureType: "mine"
                },
                tier
            }) as BuildItem;
        const withMine = location({ installations: [mineInst] });

        it("needs the tier tech", () => {
            expect(canBuild(ctx(), withMine, upgradeMine(2))).toEqual({
                ok: false,
                reason: "Requires Refits"
            });
            expect(
                canBuild(ctx({ techs: ["enhancement_tier_2"] }), withMine, upgradeMine(2))
            ).toEqual({
                ok: true
            });
        });

        it("only allows the next tier, up to the maximum", () => {
            const techs = ctx({ techs: ["enhancement_tier_2", "enhancement_tier_3"] });
            expect(canBuild(techs, withMine, upgradeMine(3))).toEqual({
                ok: false,
                reason: "Next upgrade is tier 2"
            });
            const maxed = location({ installations: [{ ...mineInst, tier: 3 }] });
            expect(canBuild(techs, maxed, upgradeMine(3))).toEqual({
                ok: false,
                reason: "Already at maximum tier"
            });
            const shipyard = inst("shipyard");
            expect(
                canBuild(techs, location({ installations: [shipyard] }), {
                    kind: "enhancement",
                    target: {
                        kind: "installation",
                        installationId: shipyard.id,
                        structureType: "shipyard"
                    },
                    tier: 2
                })
            ).toEqual({ ok: false, reason: "Already at maximum tier" });
        });

        it("rejects targets elsewhere and duplicate upgrades", () => {
            const techs = ctx({ techs: ["enhancement_tier_2"] });
            expect(canBuild(techs, location(), upgradeMine(2))).toEqual({
                ok: false,
                reason: "Target not at this location"
            });
            const shipUpgrade: BuildItem = {
                kind: "enhancement",
                target: { kind: "ship", shipId: "s1", shipType: "scout" },
                tier: 2
            };
            expect(canBuild(techs, location(), shipUpgrade)).toEqual({
                ok: false,
                reason: "Target not at this location"
            });
            expect(canBuild({ ...techs, targetTier: 1 }, location(), shipUpgrade)).toEqual({
                ok: true
            });
            const pending = location({
                installations: [mineInst],
                orders: [createBuildOrder("u", upgradeMine(2), balance)]
            });
            expect(canBuild(techs, pending, upgradeMine(2))).toEqual({
                ok: false,
                reason: "Already being upgraded"
            });
        });
    });

    describe("storage structures and build slots", () => {
        const vault: BuildItem = { kind: "structure", structureType: "vault" };
        const warehouse: BuildItem = { kind: "structure", structureType: "warehouse" };

        it("takes sites and slot use from the balance", () => {
            const asteroid = location({ site: "asteroid", level: 0, slots: 2 });
            expect(canBuild(ctx(), asteroid, vault)).toEqual({
                ok: false,
                reason: "Can't be built on an asteroid"
            });
            const oneFree = location({ slots: 2, installations: [inst("mine")] });
            expect(canBuild(ctx(), oneFree, vault)).toEqual({ ok: true });
            expect(canBuild(ctx(), oneFree, warehouse)).toEqual({
                ok: false,
                reason: "No free structure slots"
            });
            expect(slotsUsed(location({ installations: [inst("warehouse")] }), balance)).toBe(2);
        });

        it("rejects a category the location has no build slots for", () => {
            const noYardSlots: EconomyBalance = {
                ...balance,
                buildSlots: { ...balance.buildSlots, structures: {} }
            };
            const yard = location({ installations: [inst("shipyard")] });
            expect(canBuild(ctx({ balance: noYardSlots }), yard, scout)).toEqual({
                ok: false,
                reason: "No ship build slots here"
            });
            expect(canBuild(ctx(), yard, scout)).toEqual({ ok: true });
        });
    });
});

describe("stockpile caps", () => {
    it("uses the default or home base cap plus tiered storage bonuses", () => {
        expect(stockpileCap(location(), balance)).toEqual(res(100, 50, 50, 50));
        expect(stockpileCap(location({ home: true }), balance)).toEqual(res(2000, 2000, 500, 500));
        const stored = location({
            installations: [inst("vault", 2), inst("depot"), inst("warehouse", 3), inst("mine")]
        });
        // Vault T2: 200 * 1.5; Warehouse T3: 2x its bonus.
        expect(stockpileCap(stored, balance)).toEqual(
            res(100 + 300 + 150, 50 + 200 + 150, 150, 150)
        );
    });

    it("exposes pillage protection per storage structure", () => {
        expect(structureDef("vault", balance).pillageProtection).toBe(0.5);
        expect(structureDef("warehouse", balance).pillageProtection).toBe(0.2);
        expect(structureDef("mine", balance).pillageProtection).toBeUndefined();
    });

    it("costs storage structures from the balance", () => {
        const vault: BuildItem = { kind: "structure", structureType: "vault" };
        expect(buildItemCost(vault, balance)).toEqual(res(100, 50, 5));
        expect(buildItemTurns(vault, balance)).toBe(2);
        expect(buildItemName(vault)).toBe("Vault");
    });

    it("deposits only what fits and keeps an existing excess", () => {
        expect(depositCapped(res(80, 40), res(50, 50), res(100, 50))).toEqual({
            stockpile: res(100, 50),
            accepted: res(20, 10),
            overflow: res(30, 40)
        });
        expect(depositCapped(res(150), res(10), res(100)).stockpile).toEqual(res(150));
        expect(storageRoom(res(150, 10), res(100, 50))).toEqual(res(0, 40));
    });
});

describe("buildSlots / partitionOrders", () => {
    const ids = (orders: readonly BuildOrder[]) => orders.map((o) => o.id);

    it("gives 1 ship slot per Shipyard and another for an Advanced Shipyard", () => {
        expect(buildSlots(location(), balance)).toEqual({
            ships: 0,
            installations: 1,
            groundUnits: 0,
            research: 0
        });
        const yards = location({ installations: [inst("shipyard"), inst("advanced_shipyard")] });
        expect(buildSlots(yards, balance).ships).toBe(2);
    });

    it("activates orders within each category by priority, then age", () => {
        const p = location({
            installations: [inst("shipyard")],
            orders: [
                createBuildOrder("s1", scout, balance),
                createBuildOrder("m1", mine, balance),
                createBuildOrder("s2", scout, balance, "high"),
                createBuildOrder("m2", mine, balance),
                createBuildOrder("s3", scout, balance)
            ]
        });
        const { active, waiting } = partitionOrders(p, balance);
        expect(ids(active)).toEqual(["m1", "s2"]);
        expect(ids(waiting)).toEqual(["s1", "m2", "s3"]);
    });

    it("lets two ships build at once with an Advanced Shipyard", () => {
        const p = location({
            installations: [inst("shipyard"), inst("advanced_shipyard")],
            orders: [
                createBuildOrder("s1", scout, balance),
                createBuildOrder("s2", scout, balance),
                createBuildOrder("s3", scout, balance)
            ]
        });
        expect(ids(partitionOrders(p, balance).active)).toEqual(["s1", "s2"]);
    });

    it("counts installation upgrades as installations and never limits ship upgrades", () => {
        const mineInst = inst("mine");
        const upgradeMine = createBuildOrder(
            "u1",
            {
                kind: "enhancement",
                target: {
                    kind: "installation",
                    installationId: mineInst.id,
                    structureType: "mine"
                },
                tier: 2
            },
            balance
        );
        const upgradeShip = createBuildOrder(
            "u2",
            {
                kind: "enhancement",
                target: { kind: "ship", shipId: "s1", shipType: "scout" },
                tier: 2
            },
            balance
        );
        const p = location({
            installations: [mineInst],
            orders: [upgradeMine, createBuildOrder("m1", mine, balance), upgradeShip]
        });
        const { active, waiting } = partitionOrders(p, balance);
        expect(ids(active)).toEqual(["u1", "u2"]);
        expect(ids(waiting)).toEqual(["m1"]);
    });

    it("breaks priority ties by queue position after a move", () => {
        const orders = [
            createBuildOrder("s1", scout, balance),
            createBuildOrder("m1", mine, balance),
            createBuildOrder("s2", scout, balance),
            createBuildOrder("s3", scout, balance, "high")
        ];
        const moved = moveOrderInQueue(orders, "s2", "up")!;
        expect(ids(moved)).toEqual(["s2", "m1", "s1", "s3"]);
        const yard = { installations: [inst("shipyard"), inst("advanced_shipyard")] };
        const before = partitionOrders(location({ ...yard, orders }), balance);
        expect(ids(before.active)).toEqual(["s1", "m1", "s3"]);
        const after = partitionOrders(location({ ...yard, orders: moved }), balance);
        expect(ids(after.active)).toEqual(["s2", "m1", "s3"]);
        expect(ids(after.waiting)).toEqual(["s1"]);
    });

    it("sets fully funded orders aside as ready without holding a slot", () => {
        const funded = createBuildOrder("s1", scout, balance);
        funded.applied = { ...funded.cost };
        const p = location({
            installations: [inst("shipyard")],
            orders: [
                funded,
                createBuildOrder("s2", scout, balance),
                createBuildOrder("s3", scout, balance)
            ]
        });
        const { active, waiting, ready } = partitionOrders(p, balance);
        expect(ids(ready)).toEqual(["s1"]);
        expect(ids(active)).toEqual(["s2"]);
        expect(ids(waiting)).toEqual(["s3"]);
        // Still counted against the ship cap until it completes.
        expect(countQueuedShips([p])).toBe(3);
    });
});

describe("fundLocationOrders", () => {
    /** An order with exactly one turn's draw left. */
    const lastTurn = (id: string) => {
        const order = createBuildOrder(id, scout, balance);
        order.applied = subtractResources(order.cost, order.ratePerTurn);
        return order;
    };
    const yard = { installations: [inst("shipyard")] };

    it("hands a slot freed by a newly funded order to the next, from what is left", () => {
        const first = lastTurn("s1");
        const second = createBuildOrder("s2", scout, balance);
        const third = createBuildOrder("s3", scout, balance);
        const stock = res(1000, 1000, 1000, 1000);
        const result = fundLocationOrders(
            stock,
            location({ ...yard, orders: [first, second, third] }),
            balance
        );
        expect(result.drawn).toEqual({ s1: first.ratePerTurn, s2: second.ratePerTurn });
        expect(result.orders.map((o) => o.applied)).toEqual([
            first.cost,
            second.ratePerTurn,
            zeroResources()
        ]);
        expect(result.stockpile).toEqual(
            subtractResources(stock, addResources(first.ratePerTurn, second.ratePerTurn))
        );
    });

    it("draws nothing for ready orders and leaves the next unfunded when stock runs out", () => {
        const ready = createBuildOrder("s0", scout, balance);
        ready.applied = { ...ready.cost };
        const first = lastTurn("s1");
        const second = createBuildOrder("s2", scout, balance);
        const result = fundLocationOrders(
            first.ratePerTurn,
            location({ ...yard, orders: [ready, first, second] }),
            balance
        );
        expect(result.drawn.s0).toBeUndefined();
        expect(result.drawn.s2).toEqual(zeroResources());
        expect(result.orders.map((o) => o.applied)).toEqual([
            ready.cost,
            first.cost,
            zeroResources()
        ]);
        expect(result.stockpile).toEqual(zeroResources());
    });
});

describe("queueCategory / moveOrderInQueue", () => {
    const ids = (orders: readonly BuildOrder[]) => orders.map((o) => o.id);
    const shipUpgrade: BuildItem = {
        kind: "enhancement",
        target: { kind: "ship", shipId: "s1", shipType: "scout" },
        tier: 2
    };
    const unitUpgrade: BuildItem = {
        kind: "enhancement",
        target: { kind: "groundUnit", unitId: "g1", unitType: "infantry" },
        tier: 2
    };

    it("puts ship and ground unit upgrades in their queues without a slot category", () => {
        expect(queueCategory(shipUpgrade)).toBe("ships");
        expect(queueCategory(unitUpgrade)).toBe("groundUnits");
        expect(queueCategory(mine)).toBe("installations");
        expect(queueCategory(scout)).toBe("ships");
    });

    it("swaps only with the neighbour in the same queue", () => {
        const orders = [
            createBuildOrder("s1", scout, balance),
            createBuildOrder("m1", mine, balance),
            createBuildOrder("u1", shipUpgrade, balance),
            createBuildOrder("m2", mine, balance)
        ];
        expect(ids(moveOrderInQueue(orders, "s1", "down")!)).toEqual(["u1", "m1", "s1", "m2"]);
        expect(ids(moveOrderInQueue(orders, "m2", "up")!)).toEqual(["s1", "m2", "u1", "m1"]);
        expect(ids(orders)).toEqual(["s1", "m1", "u1", "m2"]);
    });

    it("refuses moves past the end of the queue or for unknown orders", () => {
        const orders = [
            createBuildOrder("s1", scout, balance),
            createBuildOrder("m1", mine, balance)
        ];
        expect(moveOrderInQueue(orders, "m1", "up")).toBeUndefined();
        expect(moveOrderInQueue(orders, "s1", "down")).toBeUndefined();
        expect(moveOrderInQueue(orders, "s1", "up")).toBeUndefined();
        expect(moveOrderInQueue(orders, "nope", "up")).toBeUndefined();
    });
});

describe("combat helpers", () => {
    const combat = balance.combat;

    it("scales damage by the roll and the target's defence, never below minDamage", () => {
        expect(combatDamage(8, 0, combat, 0.5)).toBe(8);
        expect(combatDamage(8, 10, combat, 0.5)).toBe(4);
        expect(combatDamage(8, 0, combat, 0)).toBe(6);
        expect(combatDamage(8, 0, combat, 0.999)).toBe(10);
        expect(combatDamage(1, 30, combat, 0)).toBe(1);
        expect(combatDamage(0, 0, combat, 0.5)).toBe(0);
        expect(combatDamage(8, 0, { ...combat, minDamage: 0, spread: 0 }, 0.9)).toBe(8);
    });

    it("adds supply ship tech bonuses, capping evasion", () => {
        expect(supplyShipStats(balance, [])).toEqual({
            hp: 6,
            defence: 1,
            evasion: 0.3,
            attack: 0
        });
        expect(supplyShipStats(balance, ["armoured_freighters"])).toMatchObject({
            hp: 12,
            defence: 3
        });
        expect(supplyShipStats(balance, ["evasive_manoeuvres_1"]).evasion).toBeCloseTo(0.45);
        expect(
            supplyShipStats(balance, ["evasive_manoeuvres_1", "evasive_manoeuvres_2"]).evasion
        ).toBe(0.75);
    });

    it("repairs a base fraction of max hp per turn, at least minPerTurn, capped at max", () => {
        expect(balance.repair.baseFraction).toBe(0.1);
        expect(shipRepairPerTurn(balance, 10, 40, [])).toBe(4);
        expect(shipRepairPerTurn(balance, 1, 6, [])).toBe(1);
        expect(shipRepairPerTurn(balance, 38, 40, [])).toBe(2);
        expect(shipRepairPerTurn(balance, 40, 40, [])).toBe(0);
        expect(shipRepairPerTurn(balance, 0, 40, [])).toBe(0);
        const noMin = { ...balance, repair: { ...balance.repair, minPerTurn: 0 } };
        expect(shipRepairPerTurn(noMin, 1, 4, [])).toBe(0);
    });

    it("adds tech, shipyard and carrier repair bonuses", () => {
        expect(shipRepairPerTurn(balance, 1, 40, ["damage_control_1"])).toBe(6);
        expect(shipRepairPerTurn(balance, 1, 40, ["damage_control_1", "damage_control_2"])).toBe(
            10
        );
        expect(shipRepairPerTurn(balance, 1, 40, ["armoured_freighters"])).toBe(4);
        expect(shipRepairPerTurn(balance, 1, 40, [], { atOwnedShipyard: true })).toBe(10);
        expect(shipRepairPerTurn(balance, 1, 40, [], { carried: true })).toBe(6);
        expect(
            shipRepairPerTurn(balance, 1, 40, ["damage_control_1", "damage_control_2"], {
                atOwnedShipyard: true,
                carried: true
            })
        ).toBe(18);
        expect(
            shipRepairPerTurn(balance, 35, 40, ["damage_control_2"], { atOwnedShipyard: true })
        ).toBe(5);
    });

    it("repairs only after a whole turn without combat", () => {
        expect(repairsAtEndOf(undefined, 1)).toBe(true);
        expect(repairsAtEndOf(3, 4)).toBe(true);
        expect(repairsAtEndOf(4, 4)).toBe(false);
    });

    it("reads hangars from the balance", () => {
        expect(hangarFor(balance, "star_destroyer")?.capacity).toBe(4);
        expect(hangarFor(balance, "frigate")).toBeUndefined();
        expect(canCarryShip(balance, "star_destroyer", "fighter_squadron")).toBe(true);
        expect(canCarryShip(balance, "star_destroyer", "scout")).toBe(false);
        expect(canCarryShip(balance, "frigate", "fighter_squadron")).toBe(false);
        expect(canBombardShip(balance, "star_destroyer")).toBe(true);
        expect(canBombardShip(balance, "frigate")).toBe(false);
        expect(balance.ships.star_destroyer.unitCapacity).toBe(4);
    });
});
