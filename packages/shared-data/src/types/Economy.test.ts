import {
    borrowedPopulation,
    buildItemCost,
    buildItemName,
    buildItemTurns,
    canBuild,
    countQueuedShips,
    createBuildOrder,
    fundOrders,
    groundUnitStats,
    HOME_PLANET_LEVEL,
    incomeFor,
    isFullyFunded,
    locationDemand,
    locationIncome,
    maxEnhancementTierFor,
    orderDemands,
    packCargo,
    ratePerTurn,
    resourceUnits,
    shipCapFor,
    shipStats,
    siteForEntity,
    slotsForEntity,
    slotsUsed,
    STARTING_STOCKPILE,
    structureOutput,
    supplyCapacityFor,
    supplySpeedFor,
    sumResources,
    surplusStock,
    zeroResources,
    type BuildContext,
    type BuildItem,
    type BuildOrder,
    type BuildPriority,
    type Installation,
    type LocationEconomy,
    type Resources
} from "../index.js";

function res(money = 0, materials = 0, population = 0, science = 0): Resources {
    return { money, materials, population, science };
}

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
    return { shipCount: 2, shipCap: 3, techs: [], ...overrides };
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
        const o = createBuildOrder("o1", mine);
        expect(o).toEqual({
            id: "o1",
            item: mine,
            priority: "medium",
            cost: res(100, 0, 10, 0),
            applied: zeroResources(),
            ratePerTurn: res(50, 0, 5, 0)
        });
        expect(createBuildOrder("o2", scout, "high").priority).toBe("high");
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
        expect(buildItemTurns(upgrade)).toBe(3);
        expect(buildItemCost(upgrade)).toEqual(res(100, 150, 0, 0));
        expect(buildItemCost({ ...upgrade, tier: 3 } as BuildItem)).toEqual(res(200, 300, 0, 0));
    });

    it("borrows population only for things that exist afterwards", () => {
        expect(borrowedPopulation(mine)).toBe(10);
        expect(borrowedPopulation({ kind: "groundUnit", unitType: "infantry" })).toBe(20);
        expect(borrowedPopulation({ kind: "research", techId: "transports" })).toBe(0);
    });
});

describe("tier stats", () => {
    it("scales structure output, ship stats and ground unit stats", () => {
        expect(structureOutput("mine", 1)).toEqual(res(0, 40));
        expect(structureOutput("mine", 3)).toEqual(res(0, 80));
        expect(shipStats("frigate", 2)).toEqual({ hp: 18, maxMovementPoints: 3 });
        expect(shipStats("frigate", 3)).toEqual({ hp: 24, maxMovementPoints: 4 });
        expect(groundUnitStats("armour", 3)).toEqual({ attack: 7, defence: 6 });
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
        expect(shipCapFor([location()])).toBe(3);
    });

    it("adds 1 per Docks, sums across planets and ignores moons' level", () => {
        expect(shipCapFor([location({ installations: [inst("shipyard"), inst("docks")] })])).toBe(
            4
        );
        expect(shipCapFor([location(), location({ level: 4 }), location({ level: 20 })])).toBe(
            3 + 1 + 5
        );
        expect(shipCapFor([location({ site: "moon", level: 0, slots: 3 })])).toBe(0);
    });
});

describe("incomeFor", () => {
    it("scales planet base income by level and adds tiered installation output", () => {
        expect(incomeFor([location()])).toEqual(res(50, 50, 20, 10));
        expect(
            incomeFor([
                location({
                    installations: [
                        inst("mine"),
                        inst("mine", 2),
                        inst("habitat"),
                        inst("shipyard")
                    ]
                }),
                location({ level: 1 })
            ])
        ).toEqual(res(55, 50 + 40 + 60 + 5, 20 + 10 + 2, 11));
    });

    it("gives moons and asteroids no base income", () => {
        const asteroid = location({
            site: "asteroid",
            level: 0,
            slots: 2,
            installations: [inst("mine")]
        });
        expect(locationIncome(asteroid)).toEqual(res(0, 40));
    });
});

describe("slotsUsed / countQueuedShips", () => {
    it("counts installations and ordered structures, and ordered ships", () => {
        const p = location({
            installations: [inst("mine")],
            orders: [createBuildOrder("a", mine), createBuildOrder("b", scout)]
        });
        expect(slotsUsed(p)).toBe(2);
        expect(countQueuedShips([p, location({ orders: [createBuildOrder("c", scout)] })])).toBe(2);
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
            orders: [createBuildOrder("a", mine)]
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
        const ordered = location({ orders: [createBuildOrder("a", shipyard)] });
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
                orders: [createBuildOrder("u", upgradeMine(2))]
            });
            expect(canBuild(techs, pending, upgradeMine(2))).toEqual({
                ok: false,
                reason: "Already being upgraded"
            });
        });
    });
});
