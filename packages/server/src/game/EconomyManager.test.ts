import {
    buildItemCost,
    HOME_PLANET_LEVEL,
    locationIncome,
    zeroResources,
    type BuildItem,
    type EconomyBalance,
    type Resources,
    type StructureType
} from "@space/shared-data";
import { defaultEconomyBalance } from "../config/config.schema.js";
import { BattleManager } from "./Battle.js";
import { EconomyManager, type BuildResult, type EconomyOptions } from "./EconomyManager.js";
import { EntityManager } from "./EntityManager.js";
import { createEmptyMap } from "./map/SpaceMap.js";
import type { EntityOf } from "./map/types.js";
import { TurnManager } from "./TurnManager.js";

const DEFAULTS = defaultEconomyBalance();
const res = (partial: Partial<Resources>): Resources => ({ ...zeroResources(), ...partial });
const structure = (structureType: StructureType): BuildItem => ({
    kind: "structure",
    structureType
});
const orderId = (result: BuildResult) => (result.ok ? result.order.id : "");

/** No stockpile caps or concurrency limits, for tests about funding itself. */
function unlimitedBalance(): EconomyBalance {
    const balance = defaultEconomyBalance();
    const lots = { money: 1e9, materials: 1e9, population: 1e9, science: 1e9 };
    return {
        ...balance,
        stockpileCaps: { default: lots, home: lots },
        buildSlots: {
            ...balance.buildSlots,
            base: { ships: 99, installations: 99, groundUnits: 99, research: 99 }
        }
    };
}

function economyWorld(options: EconomyOptions = {}) {
    const map = createEmptyMap({ width: 20, height: 20, hexSize: 50, seed: 1 });
    const entities = new EntityManager(map);
    const home = entities.add<EntityOf<"planet">>({
        id: "home-a",
        kind: "planet",
        sideId: "alpha",
        systemId: "sys-1",
        q: 5,
        r: 5,
        level: HOME_PLANET_LEVEL
    });
    const moon = entities.add<EntityOf<"moon">>({
        id: "moon-a",
        kind: "moon",
        sideId: "alpha",
        systemId: "sys-1",
        q: 10,
        r: 5
    });
    const economy = new EconomyManager(entities, ["alpha", "beta"], {
        balance: unlimitedBalance(),
        ...options
    });
    const battles = new BattleManager(entities, economy);
    // No supply manager: stockpiles only change through production and funding.
    const turns = new TurnManager(["alpha", "beta"], entities, economy);
    const endTurn = () => {
        turns.endTurn("alpha");
        return turns.endTurn("beta");
    };
    const installed = (locationId: string) =>
        economy.locationEconomy(locationId)!.installations.map((i) => i.type);
    const orders = (locationId: string) => economy.locationEconomy(locationId)!.orders;
    return { entities, economy, battles, turns, endTurn, home, moon, installed, orders };
}

function addScout(entities: EntityManager, at: { q: number; r: number }): EntityOf<"ship"> {
    return entities.add<EntityOf<"ship">>({
        id: "scout-1",
        kind: "ship",
        shipType: "scout",
        sideId: "alpha",
        q: at.q,
        r: at.r,
        facing: 0,
        movementPoints: DEFAULTS.ships.scout.maxMovementPoints,
        maxMovementPoints: DEFAULTS.ships.scout.maxMovementPoints,
        hp: DEFAULTS.ships.scout.hp
    });
}

describe("EconomyManager funding at end of turn", () => {
    it("splits a tier's stock equally and serves lower tiers only from what is left", () => {
        const { economy, endTurn, moon, orders } = economyWorld();
        economy.deposit(moon.id, res({ money: 30 }));
        economy.build("alpha", moon.id, structure("habitat"), "high");
        economy.build("alpha", moon.id, structure("habitat"), "medium");
        economy.build("alpha", moon.id, structure("habitat"), "high");
        endTurn();
        expect(orders(moon.id).map((o) => [o.priority, o.applied.money])).toEqual([
            ["high", 15],
            ["medium", 0],
            ["high", 15]
        ]);
        expect(economy.stockpile(moon.id)).toEqual(zeroResources());
    });

    it("caps each order at its per-turn rate and carries the excess to the next turn", () => {
        const { economy, endTurn, moon, orders, installed } = economyWorld();
        economy.deposit(moon.id, res({ money: 1000, materials: 1000 }));
        economy.build("alpha", moon.id, structure("habitat"));
        endTurn();
        expect(orders(moon.id)[0].applied).toEqual(res({ money: 25, materials: 50 }));
        expect(economy.stockpile(moon.id)).toEqual(res({ money: 975, materials: 950 }));
        endTurn();
        expect(installed(moon.id)).toEqual(["habitat"]);
        expect(economy.stockpile(moon.id)).toEqual(res({ money: 950, materials: 900 }));
    });

    it.each(["habitat", "mine", "trade_hub", "shipyard", "science_academy"] as const)(
        "never completes a %s before its build turns, however much stock there is",
        (structureType) => {
            const { economy, endTurn, home, installed } = economyWorld();
            economy.deposit(home.id, res({ money: 10_000, materials: 10_000, population: 1000 }));
            economy.build("alpha", home.id, structure(structureType));
            for (let turn = 1; turn < DEFAULTS.structures[structureType].buildTurns; turn++) {
                endTurn();
                expect(installed(home.id)).toEqual([]);
            }
            expect(endTurn().economy?.completed).toMatchObject([
                { locationId: home.id, item: structure(structureType) }
            ]);
            expect(installed(home.id)).toEqual([structureType]);
        }
    );

    it("takes ship cost, build turns and stats from the balance", () => {
        const balance = unlimitedBalance();
        balance.ships = {
            ...balance.ships,
            scout: {
                ...balance.ships.scout,
                cost: res({ money: 7, population: 1 }),
                buildTurns: 1,
                requires: [],
                hp: 2,
                maxMovementPoints: 9
            }
        };
        const { entities, economy, endTurn, home } = economyWorld({ balance });
        const built = economy.build("alpha", home.id, { kind: "ship", shipType: "scout" });
        expect(built.ok && built.order.cost).toEqual(res({ money: 7, population: 1 }));
        expect(built.ok && built.order.ratePerTurn).toEqual(res({ money: 7, population: 1 }));
        expect(endTurn().economy?.spawnedShips).toMatchObject([
            { shipType: "scout", hp: 2, maxMovementPoints: 9, movementPoints: 9 }
        ]);
        expect(entities.ofKind("ship")).toHaveLength(1);
    });

    it("refunds applied resources to the local stockpile and drops cargo reservations on cancel", () => {
        const { entities, economy, endTurn, moon, orders } = economyWorld();
        economy.deposit(moon.id, res({ money: 1000, materials: 1000 }));
        const id = orderId(economy.build("alpha", moon.id, structure("habitat")));
        const inbound = entities.add<EntityOf<"supply_ship">>({
            id: "supply-1",
            kind: "supply_ship",
            name: "Supply 1",
            sideId: "alpha",
            q: 7,
            r: 5,
            facing: 0,
            originId: "home-a",
            destinationId: moon.id,
            cargo: res({ money: 20 }),
            reservedFor: [{ orderId: id, amount: res({ money: 20 }) }],
            speed: 6,
            capacity: 100
        });
        endTurn();
        expect(orders(moon.id)[0].applied).toEqual(res({ money: 25, materials: 50 }));

        expect(economy.cancel("alpha", moon.id, id)).toEqual({ ok: true });
        expect(orders(moon.id)).toEqual([]);
        expect(economy.stockpile(moon.id)).toEqual(res({ money: 1000, materials: 1000 }));
        expect(inbound.reservedFor).toEqual([]);
        expect(inbound.cargo).toEqual(res({ money: 20 }));
    });
});

describe("EconomyManager research", () => {
    it("needs a Science Academy, completes over its build turns and unlocks side-wide", () => {
        const { economy, endTurn, home, moon, installed } = economyWorld();
        const research: BuildItem = { kind: "research", techId: "ground_forces" };
        expect(economy.build("alpha", home.id, research)).toEqual({
            ok: false,
            error: "Requires Science Academy"
        });
        expect(economy.build("alpha", home.id, structure("barracks"))).toEqual({
            ok: false,
            error: "Requires Ground Forces"
        });

        economy.build("alpha", home.id, structure("science_academy"));
        for (let turn = 0; turn < DEFAULTS.structures.science_academy.buildTurns; turn++) endTurn();
        expect(installed(home.id)).toEqual(["science_academy"]);

        expect(economy.build("alpha", home.id, research).ok).toBe(true);
        expect(economy.build("alpha", home.id, research)).toEqual({
            ok: false,
            error: "Already being researched"
        });
        endTurn();
        expect(economy.stateFor("alpha").techs).toEqual([]);
        endTurn();
        expect(economy.stateFor("alpha").techs).toEqual(["ground_forces"]);
        expect(economy.stateFor("beta").techs).toEqual([]);
        expect(economy.build("alpha", home.id, research)).toEqual({
            ok: false,
            error: "Already researched"
        });
        // Unlocked everywhere on the side, not just at the Academy.
        expect(economy.build("alpha", moon.id, structure("barracks")).ok).toBe(true);
        expect(economy.build("beta", "home-a", structure("barracks")).ok).toBe(false);
    });

    it("enforces tech prerequisites", () => {
        const { economy, home } = economyWorld({ instantBuild: true });
        economy.deposit(home.id, res({ science: 1000 }));
        economy.build("alpha", home.id, structure("science_academy"));
        expect(
            economy.build("alpha", home.id, { kind: "research", techId: "supply_speed_2" })
        ).toEqual({ ok: false, error: "Requires Improved Drives" });
        expect(economy.build("alpha", home.id, { kind: "research", techId: "transports" })).toEqual(
            { ok: false, error: "Requires Ground Forces" }
        );
        expect(
            economy.build("alpha", home.id, { kind: "research", techId: "supply_speed_1" })
        ).toMatchObject({ ok: true, completed: true });
        expect(economy.stateFor("alpha")).toMatchObject({ supplySpeed: 8, supplyCapacity: 100 });
        expect(
            economy.build("alpha", home.id, { kind: "research", techId: "supply_speed_2" }).ok
        ).toBe(true);
        expect(economy.stateFor("alpha").supplySpeed).toBe(10);
    });

    it("unlocks structures, ships and ground units", () => {
        const { economy, home } = economyWorld({ instantBuild: true });
        economy.deposit(home.id, res({ money: 5000, materials: 5000, population: 500 }));
        economy.build("alpha", home.id, structure("shipyard"));

        expect(economy.build("alpha", home.id, structure("advanced_shipyard"))).toEqual({
            ok: false,
            error: "Requires Advanced Shipbuilding"
        });
        expect(economy.build("alpha", home.id, { kind: "ship", shipType: "transport" })).toEqual({
            ok: false,
            error: "Requires Troop Transports"
        });
        expect(
            economy.build("alpha", home.id, { kind: "groundUnit", unitType: "infantry" })
        ).toEqual({ ok: false, error: "Requires Barracks" });

        economy.research.add("alpha", "advanced_shipyard");
        economy.research.add("alpha", "ground_forces");
        economy.research.add("alpha", "transports");
        expect(economy.build("alpha", home.id, structure("advanced_shipyard")).ok).toBe(true);
        expect(economy.build("alpha", home.id, structure("barracks")).ok).toBe(true);
        expect(
            economy.build("alpha", home.id, { kind: "ship", shipType: "transport" })
        ).toMatchObject({ ok: true, completed: true, spawnedShip: { carriedUnitIds: [] } });
        const unit = economy.build("alpha", home.id, { kind: "groundUnit", unitType: "infantry" });
        expect(unit).toMatchObject({
            ok: true,
            completed: true,
            spawnedUnit: {
                sideId: "alpha",
                unitType: "infantry",
                tier: 1,
                populationFrom: home.id,
                location: { kind: "garrison", locationId: home.id }
            }
        });
        const unitId = unit.ok ? unit.spawnedUnit!.id : "";
        expect(home.garrison).toEqual([unitId]);
        expect(economy.stateFor("alpha").groundUnits.map((u) => u.id)).toEqual([unitId]);
    });

    it("gates enhancement tiers behind the refit techs", () => {
        const { economy, home, installed } = economyWorld({ instantBuild: true });
        economy.build("alpha", home.id, structure("mine"));
        economy.build("alpha", home.id, structure("shipyard"));
        expect(installed(home.id)).toEqual(["mine", "shipyard"]);
        const [mine, shipyard] = economy.locationEconomy(home.id)!.installations;
        const upgrade = (tier: number): BuildItem => ({
            kind: "enhancement",
            target: { kind: "installation", installationId: mine.id, structureType: "mine" },
            tier
        });

        expect(economy.build("alpha", home.id, upgrade(2))).toEqual({
            ok: false,
            error: "Requires Refits"
        });
        economy.research.add("alpha", "enhancement_tier_2");
        expect(economy.build("alpha", home.id, upgrade(3))).toEqual({
            ok: false,
            error: "Next upgrade is tier 2"
        });
        expect(economy.build("alpha", home.id, upgrade(2))).toMatchObject({ completed: true });
        expect(economy.build("alpha", home.id, upgrade(3))).toEqual({
            ok: false,
            error: "Requires Advanced Refits"
        });
        economy.research.add("alpha", "enhancement_tier_3");
        expect(economy.build("alpha", home.id, upgrade(3))).toMatchObject({ completed: true });
        expect(economy.build("alpha", home.id, upgrade(4))).toEqual({
            ok: false,
            error: "Already at maximum tier"
        });
        expect(
            economy.build("alpha", home.id, {
                kind: "enhancement",
                target: {
                    kind: "installation",
                    installationId: shipyard.id,
                    structureType: "shipyard"
                },
                tier: 2
            })
        ).toEqual({ ok: false, error: "Already at maximum tier" });
    });
});

describe("EconomyManager enhancements", () => {
    it("raises an installation's output with its tier", () => {
        const { economy, endTurn, moon, installed } = economyWorld();
        economy.research.add("alpha", "enhancement_tier_2");
        economy.deposit(moon.id, res({ money: 1000, population: 100 }));
        economy.build("alpha", moon.id, structure("mine"));
        endTurn();
        endTurn();
        expect(installed(moon.id)).toEqual(["mine"]);
        const [mine] = economy.locationEconomy(moon.id)!.installations;
        const item: BuildItem = {
            kind: "enhancement",
            target: { kind: "installation", installationId: mine.id, structureType: "mine" },
            tier: 2
        };
        expect(buildItemCost(item, economy.balance)).toEqual(res({ money: 50 }));
        economy.build("alpha", moon.id, item);

        const materials = () => economy.stockpile(moon.id).materials;
        const before = materials();
        endTurn();
        expect(materials() - before).toBe(40);
        endTurn();
        expect(economy.locationEconomy(moon.id)!.installations[0].tier).toBe(2);
        const upgraded = materials();
        endTurn();
        expect(materials() - upgraded).toBe(60);
        expect(
            locationIncome(
                { site: "moon", level: 0, installations: [{ ...mine, tier: 2 }] },
                DEFAULTS
            )
        ).toEqual(res({ materials: 60 }));
    });

    it("raises a ship's hp and movement with its tier", () => {
        const { entities, economy, home } = economyWorld({ instantBuild: true });
        economy.research.add("alpha", "enhancement_tier_2");
        economy.research.add("alpha", "enhancement_tier_3");
        const scout = addScout(entities, home);
        scout.movementPoints = 2;
        const upgrade = (tier: number): BuildItem => ({
            kind: "enhancement",
            target: { kind: "ship", shipId: scout.id, shipType: "scout" },
            tier
        });

        expect(economy.build("alpha", home.id, upgrade(2))).toMatchObject({ completed: true });
        expect(scout).toMatchObject({ tier: 2, hp: 9, maxMovementPoints: 5, movementPoints: 2 });
        expect(economy.build("alpha", home.id, upgrade(3))).toMatchObject({ completed: true });
        expect(scout).toMatchObject({ tier: 3, hp: 12, maxMovementPoints: 6, movementPoints: 3 });

        entities.move(scout.id, { q: 7, r: 5 });
        expect(economy.build("alpha", home.id, upgrade(4))).toEqual({
            ok: false,
            error: "Target not at this location"
        });
    });

    it("cancels a ship's upgrade when it moves away, keeping delivered resources locally", () => {
        const { entities, economy, battles, endTurn, home, orders } = economyWorld();
        economy.research.add("alpha", "enhancement_tier_2");
        const scout = addScout(entities, home);
        economy.build("alpha", home.id, {
            kind: "enhancement",
            target: { kind: "ship", shipId: scout.id, shipType: "scout" },
            tier: 2
        });
        endTurn();
        expect(orders(home.id)[0].applied).toEqual(res({ money: 25, materials: 25 }));
        expect(economy.onShipMoved(scout)).toBe(false);

        const stock = economy.stockpile(home.id);
        expect(battles.moveShip("alpha", scout.id, { q: 7, r: 5 }).ok).toBe(true);
        expect(economy.onShipMoved(scout)).toBe(true);
        expect(orders(home.id)).toEqual([]);
        expect(economy.stockpile(home.id)).toEqual({
            ...stock,
            money: stock.money + 25,
            materials: stock.materials + 25
        });
        expect(scout.tier).toBeUndefined();
    });
});

describe("EconomyManager stockpile caps", () => {
    const limited = (options: EconomyOptions = {}) =>
        economyWorld({ balance: defaultEconomyBalance(), ...options });

    it("loses production over the cap but still reports it as income", () => {
        const { economy, endTurn, moon, installed } = limited();
        expect(economy.stockpileCap(moon.id)).toEqual(
            res({ money: 100, materials: 50, population: 50, science: 50 })
        );
        economy.deposit(moon.id, res({ money: 100, population: 10 }));
        economy.build("alpha", moon.id, structure("mine"));
        endTurn();
        endTurn();
        expect(installed(moon.id)).toEqual(["mine"]);
        endTurn();
        expect(economy.stockpile(moon.id).materials).toBe(40);
        endTurn();
        expect(economy.stockpile(moon.id).materials).toBe(50);
        expect(economy.stateFor("alpha").lastIncome.materials).toBeGreaterThanOrEqual(40);
    });

    it("gives the home planet its own caps and clamps the starting stockpile to them", () => {
        const { economy, home } = limited();
        expect(economy.stockpileCap(home.id)).toEqual(
            res({ money: 2000, materials: 2000, population: 500, science: 500 })
        );
        expect(economy.locationEconomy(home.id)?.home).toBe(true);

        const balance = defaultEconomyBalance();
        balance.stockpileCaps.home = res({
            money: 300,
            materials: 5000,
            population: 50,
            science: 0
        });
        const small = economyWorld({ balance });
        expect(small.economy.stockpile(small.home.id)).toEqual(
            res({ money: 300, materials: 1000, population: 50, science: 0 })
        );
    });

    it("raises caps with storage installations and their tiers", () => {
        const { economy, moon, installed } = limited({ instantBuild: true });
        economy.research.add("alpha", "enhancement_tier_2");
        economy.deposit(moon.id, res({ money: 100, materials: 50, population: 5 }));
        const built = economy.build("alpha", moon.id, structure("depot"));
        expect(built.ok && built.completed).toBe(true);
        expect(installed(moon.id)).toEqual(["depot"]);
        expect(economy.stockpileCap(moon.id).materials).toBe(250);

        const [depot] = economy.locationEconomy(moon.id)!.installations;
        economy.deposit(moon.id, res({ money: 50, materials: 25 }));
        const upgraded = economy.build("alpha", moon.id, {
            kind: "enhancement",
            target: { kind: "installation", installationId: depot.id, structureType: "depot" },
            tier: 2
        });
        expect(upgraded.ok && upgraded.completed).toBe(true);
        expect(economy.stockpileCap(moon.id).materials).toBe(350);
    });
});

describe("EconomyManager concurrent build limits", () => {
    const scout: BuildItem = { kind: "ship", shipType: "scout" };

    function withYards(yards: StructureType[]) {
        const world = economyWorld({ balance: defaultEconomyBalance() });
        world.economy.research.add("alpha", "advanced_shipyard");
        for (const yard of yards) {
            expect(world.economy.build("alpha", world.home.id, structure(yard)).ok).toBe(true);
            while (!world.installed(world.home.id).includes(yard)) world.endTurn();
        }
        return world;
    }

    it("builds one installation at a time, leaving the next unfunded", () => {
        const { economy, endTurn, home, orders, installed } = economyWorld({
            balance: defaultEconomyBalance()
        });
        const first = orderId(economy.build("alpha", home.id, structure("mine")));
        const second = orderId(economy.build("alpha", home.id, structure("trade_hub")));
        expect(economy.activeOrders(home.id).map((o) => o.id)).toEqual([first]);
        endTurn();
        expect(orders(home.id).find((o) => o.id === second)?.applied).toEqual(zeroResources());
        endTurn();
        expect(installed(home.id)).toEqual(["mine"]);
        endTurn();
        expect(orders(home.id)[0].applied.materials).toBeGreaterThan(0);
    });

    it("holds an extra ship order until the first completes", () => {
        const { economy, endTurn, home, orders } = withYards(["shipyard"]);
        const first = orderId(economy.build("alpha", home.id, scout));
        const second = orderId(economy.build("alpha", home.id, scout));
        endTurn();
        const applied = (id: string) => orders(home.id).find((o) => o.id === id)?.applied;
        expect(applied(first)).toEqual(res({ money: 50, materials: 50, population: 3 }));
        expect(applied(second)).toEqual(zeroResources());
        const done = endTurn().economy!;
        expect(done.completed.map((c) => c.orderId)).toEqual([first]);
        expect(applied(second)).toEqual(zeroResources());
        endTurn();
        expect(applied(second)).toEqual(res({ money: 50, materials: 50, population: 3 }));
    });

    it("lets a later high priority order take the slot", () => {
        const { economy, endTurn, home, orders } = withYards(["shipyard"]);
        const first = orderId(economy.build("alpha", home.id, scout));
        const urgent = orderId(economy.build("alpha", home.id, scout, "high"));
        endTurn();
        const applied = (id: string) => orders(home.id).find((o) => o.id === id)?.applied;
        expect(applied(first)).toEqual(zeroResources());
        expect(applied(urgent)?.money).toBe(50);
    });

    it("builds two ships at once with an Advanced Shipyard", () => {
        const { economy, endTurn, home, orders, installed } = withYards([
            "shipyard",
            "advanced_shipyard"
        ]);
        expect(installed(home.id)).toEqual(["shipyard", "advanced_shipyard"]);
        economy.build("alpha", home.id, scout);
        economy.build("alpha", home.id, scout);
        endTurn();
        expect(orders(home.id).map((o) => o.applied.money)).toEqual([50, 50]);
        expect(endTurn().economy!.spawnedShips).toHaveLength(2);
    });
});
