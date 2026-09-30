import { axialDistance, axialKey } from "@space/maths";
import {
    addResources,
    EntitySummary,
    HOME_PLANET_LEVEL,
    locationIncome,
    PLANET_LEVEL_MAX,
    PLANET_LEVEL_MIN,
    SHIP_TYPES,
    STARTING_STOCKPILE,
    STRUCTURE_TYPES,
    subtractResources,
    zeroResources,
    type BuildItem,
    type ShipType,
    type StructureType
} from "@space/shared-data";
import { BattleManager } from "./Battle.js";
import { EconomyManager } from "./EconomyManager.js";
import { EntityManager } from "./EntityManager.js";
import { generateSpaceMap } from "./map/generateSpaceMap.js";
import { createEmptyMap } from "./map/SpaceMap.js";
import type { EntityOf } from "./map/types.js";
import { moveShip, validateShipMove } from "./moveShip.js";
import { Side } from "./Side.js";
import { TurnManager } from "./TurnManager.js";

function makeShip(id: string, sideId: string, q: number, r: number, mp = 3): EntityOf<"ship"> {
    return {
        id,
        kind: "ship",
        shipType: "frigate",
        sideId,
        q,
        r,
        facing: 0,
        movementPoints: mp,
        maxMovementPoints: mp
    };
}

function makePlanet(
    id: string,
    q: number,
    r: number,
    level = 5,
    sideId: string | null = null
): EntityOf<"planet"> {
    return { id, kind: "planet", sideId, systemId: "sys-1", q, r, level };
}

function smallWorld() {
    const map = createEmptyMap({ width: 20, height: 20, hexSize: 50, seed: 1 });
    const entities = new EntityManager(map);
    const alphaShip = entities.add(makeShip("ship-a", "alpha", 5, 5));
    const betaShip = entities.add(makeShip("ship-b", "beta", 8, 15));
    return { map, entities, alphaShip, betaShip };
}

describe("generateSpaceMap", () => {
    const options = { width: 50, height: 50, hexSize: 50, seed: 42, sideIds: ["alpha", "beta"] };

    it("is deterministic for a seed", () => {
        const a = [...generateSpaceMap(options).entities.all()];
        const b = [...generateSpaceMap(options).entities.all()];
        expect(a).toEqual(b);
    });

    it("produces schema-valid entities, clustered systems and fleets per side", () => {
        const { entities, systems } = generateSpaceMap(options);
        for (const entity of entities.all()) {
            expect(() => EntitySummary.parse(entity)).not.toThrow();
            expect(entities.tileOf(entity)?.entityIds).toContain(entity.id);
        }
        expect(systems.length).toBeGreaterThanOrEqual(2);
        expect(entities.ofKind("sun").length).toBeGreaterThanOrEqual(systems.length);
        expect(entities.ofKind("planet").length).toBeGreaterThan(systems.length);
        for (const sideId of options.sideIds) {
            expect(entities.ofKind("ship").some((s) => s.sideId === sideId)).toBe(true);
            expect(entities.ofKind("planet").some((p) => p.sideId === sideId)).toBe(true);
        }
        expect(entities.ofKind("hyperspace_tunnel").every((t) => !t.active)).toBe(true);
        for (const ship of entities.ofKind("ship")) {
            expect(ship.maxMovementPoints).toBe(SHIP_TYPES[ship.shipType].maxMovementPoints);
        }
    });

    it("gives planets levels, a level-10 home and exactly a Scout and a Frigate per side", () => {
        const { entities } = generateSpaceMap(options);
        for (const planet of entities.ofKind("planet")) {
            expect(planet.level).toBeGreaterThanOrEqual(PLANET_LEVEL_MIN);
            expect(planet.level).toBeLessThanOrEqual(PLANET_LEVEL_MAX);
        }
        for (const sideId of options.sideIds) {
            const homes = entities.ofKind("planet").filter((p) => p.sideId === sideId);
            expect(homes.map((p) => p.level)).toEqual([HOME_PLANET_LEVEL]);
            const ships = entities.ofKind("ship").filter((s) => s.sideId === sideId);
            expect(ships.map((s) => s.shipType).sort()).toEqual(["frigate", "scout"]);
        }
    });
});

describe("EconomyManager", () => {
    function economyWorld(homeLevel = HOME_PLANET_LEVEL) {
        const world = smallWorld();
        const { entities } = world;
        const home = entities.add(makePlanet("home-a", 5, 7, homeLevel, "alpha"));
        entities.add(makeShip("ship-a2", "alpha", 5, 6));
        const betaHome = entities.add(makePlanet("home-b", 8, 13, HOME_PLANET_LEVEL, "beta"));
        entities.add(makeShip("ship-b2", "beta", 8, 14));
        const economy = new EconomyManager(entities, ["alpha", "beta"]);
        return { ...world, home, betaHome, economy };
    }

    const structure = (structureType: StructureType): BuildItem => ({
        kind: "structure",
        structureType
    });
    const ship = (shipType: ShipType): BuildItem => ({ kind: "ship", shipType });

    function advance(economy: EconomyManager, turns: number) {
        const spawned: EntityOf<"ship">[] = [];
        for (let i = 0; i < turns; i++) spawned.push(...economy.advanceTurn().spawnedShips);
        return spawned;
    }

    function withShipyard() {
        const world = economyWorld();
        expect(world.economy.build("alpha", world.home.id, structure("shipyard")).ok).toBe(true);
        advance(world.economy, STRUCTURE_TYPES.shipyard.buildTurns);
        expect(
            world.economy.locationEconomy(world.home.id)?.installations.map((i) => i.type)
        ).toEqual(["shipyard"]);
        return world;
    }

    it("starts with the starting stockpile at home and 2/3 ships", () => {
        const { economy, home } = economyWorld();
        const state = economy.stateFor("alpha");
        expect(state.lastIncome).toEqual(zeroResources());
        expect(state.shipCount).toBe(2);
        expect(state.shipCap).toBe(3);
        expect(state.locations).toEqual([
            {
                locationId: home.id,
                site: "planet",
                level: HOME_PLANET_LEVEL,
                slots: HOME_PLANET_LEVEL,
                stockpile: STARTING_STOCKPILE,
                installations: [],
                orders: []
            }
        ]);
        expect(economy.totalStockpile("alpha")).toEqual(STARTING_STOCKPILE);
    });

    it("places orders without paying up front and rejects locations that are not yours", () => {
        const { economy, home, betaHome } = economyWorld();
        const result = economy.build("alpha", home.id, structure("habitat"), "high");
        expect(result.ok).toBe(true);
        expect(economy.stockpile(home.id)).toEqual(STARTING_STOCKPILE);
        expect(economy.locationEconomy(home.id)?.orders).toEqual([
            {
                id: result.ok ? result.order.id : "",
                item: structure("habitat"),
                priority: "high",
                cost: STRUCTURE_TYPES.habitat.cost,
                applied: zeroResources(),
                ratePerTurn: { money: 25, materials: 50, population: 0, science: 0 }
            }
        ]);

        expect(economy.build("alpha", betaHome.id, structure("habitat")).ok).toBe(false);
        expect(economy.build(null, home.id, structure("habitat")).ok).toBe(false);
        expect(economy.build("alpha", "nope", structure("habitat")).ok).toBe(false);
    });

    it("limits structures (built and ordered) to the location's slots", () => {
        const { economy, home } = economyWorld(2);
        expect(economy.build("alpha", home.id, structure("habitat")).ok).toBe(true);
        advance(economy, 2);
        expect(economy.build("alpha", home.id, structure("mine")).ok).toBe(true);
        expect(economy.build("alpha", home.id, structure("trade_hub"))).toEqual({
            ok: false,
            error: "No free structure slots"
        });
    });

    it("enforces structure requirements for structures and ships", () => {
        const { economy, home } = economyWorld();
        expect(economy.build("alpha", home.id, structure("docks"))).toEqual({
            ok: false,
            error: "Requires Shipyard"
        });
        expect(economy.build("alpha", home.id, ship("scout"))).toEqual({
            ok: false,
            error: "Requires Shipyard"
        });
        // An ordered (unfinished) shipyard does not count.
        expect(economy.build("alpha", home.id, structure("shipyard")).ok).toBe(true);
        expect(economy.build("alpha", home.id, structure("docks")).ok).toBe(false);
        expect(economy.build("alpha", home.id, structure("shipyard")).ok).toBe(false);
    });

    it("counts ordered ships towards the ship cap", () => {
        const { economy, home } = withShipyard();
        expect(economy.build("alpha", home.id, ship("frigate")).ok).toBe(false);
        expect(economy.build("alpha", home.id, ship("scout")).ok).toBe(true);
        expect(economy.stateFor("alpha")).toMatchObject({ shipCount: 3, shipCap: 3 });
        expect(economy.build("alpha", home.id, ship("scout"))).toEqual({
            ok: false,
            error: "Ship cap reached"
        });
    });

    it("funds orders concurrently at their per-turn rate and completes them when funded", () => {
        const { economy, home } = economyWorld();
        economy.build("alpha", home.id, structure("habitat"));
        economy.build("alpha", home.id, structure("mine"));
        advance(economy, 1);
        expect(economy.locationEconomy(home.id)?.orders.map((o) => o.applied)).toEqual([
            { money: 25, materials: 50, population: 0, science: 0 },
            { money: 50, materials: 0, population: 5, science: 0 }
        ]);
        advance(economy, 1);
        expect(economy.locationEconomy(home.id)).toMatchObject({
            installations: [
                { type: "habitat", tier: 1, populationFrom: home.id },
                { type: "mine", tier: 1, populationFrom: home.id }
            ],
            orders: []
        });
    });

    it("serves high priority before lower priorities when stock is short", () => {
        const { entities, economy } = economyWorld();
        const moon = entities.add<EntityOf<"moon">>({
            id: "moon-a",
            kind: "moon",
            sideId: "alpha",
            systemId: "sys-1",
            q: 12,
            r: 12
        });
        economy.deposit(moon.id, { ...zeroResources(), money: 30, materials: 50 });
        economy.build("alpha", moon.id, structure("habitat"), "low");
        economy.build("alpha", moon.id, structure("habitat"), "high");
        economy.fundAndComplete();
        const [low, high] = economy.locationEconomy(moon.id)!.orders;
        expect(high.applied).toMatchObject({ money: 25, materials: 50 });
        expect(low.applied).toMatchObject({ money: 5, materials: 0 });
    });

    it("spawns a finished ship on the location hex with full MP", () => {
        const { entities, economy, home } = withShipyard();
        economy.build("alpha", home.id, ship("scout"));
        expect(advance(economy, 1)).toEqual([]);
        const [spawned] = advance(economy, 1);
        expect(spawned).toMatchObject({
            kind: "ship",
            shipType: "scout",
            sideId: "alpha",
            name: "Scout 1",
            q: home.q,
            r: home.r,
            movementPoints: SHIP_TYPES.scout.maxMovementPoints,
            maxMovementPoints: SHIP_TYPES.scout.maxMovementPoints
        });
        expect(entities.get(spawned.id)).toBe(spawned);
        expect(entities.entitiesAt(home.q, home.r).map((e) => e.id)).toContain(spawned.id);
        expect(economy.shipCrewOrigin(spawned.id)).toBe(home.id);
        expect(economy.stateFor("alpha")).toMatchObject({ shipCount: 3, shipCap: 3 });
        expect(economy.locationEconomy(home.id)?.orders).toEqual([]);
    });

    it("holds a finished ship while enemy ships occupy the location hex", () => {
        const { entities, economy, home } = withShipyard();
        economy.build("alpha", home.id, ship("scout"));
        const enemy = entities.add(makeShip("ship-e", "beta", home.q, home.r));
        expect(advance(economy, 3)).toEqual([]);
        expect(economy.locationEconomy(home.id)?.orders[0].applied).toEqual(SHIP_TYPES.scout.cost);
        entities.remove(enemy.id);
        expect(advance(economy, 1)).toHaveLength(1);
    });

    it("adds income to the local stockpile before funding", () => {
        const { economy, home, betaHome } = economyWorld();
        economy.build("alpha", home.id, structure("habitat"));

        advance(economy, 1);
        const base = locationIncome({
            site: "planet",
            level: HOME_PLANET_LEVEL,
            installations: []
        });
        expect(economy.stateFor("alpha").lastIncome).toEqual(base);
        expect(economy.stockpile(home.id)).toEqual(
            subtractResources(addResources(STARTING_STOCKPILE, base), {
                money: 25,
                materials: 50
            })
        );

        // The habitat completes during turn 2's advance, after that turn's income.
        advance(economy, 2);
        expect(economy.stateFor("alpha").lastIncome).toEqual(
            addResources(base, STRUCTURE_TYPES.habitat.produces!)
        );
        expect(economy.stockpile(betaHome.id)).toEqual(
            addResources(STARTING_STOCKPILE, {
                money: base.money * 3,
                materials: base.materials * 3,
                population: base.population * 3,
                science: base.science * 3
            })
        );
    });

    it("refunds what a cancelled order had drawn into the local stockpile", () => {
        const { economy, home, betaHome } = economyWorld();
        const habitat = economy.build("alpha", home.id, structure("habitat"));
        const orderId = habitat.ok ? habitat.order.id : "";
        advance(economy, 1);
        const base = locationIncome({
            site: "planet",
            level: HOME_PLANET_LEVEL,
            installations: []
        });
        expect(economy.cancel("alpha", home.id, "nope").ok).toBe(false);
        expect(economy.cancel("alpha", betaHome.id, orderId).ok).toBe(false);
        expect(economy.cancel("alpha", home.id, orderId).ok).toBe(true);
        expect(economy.stockpile(home.id)).toEqual(addResources(STARTING_STOCKPILE, base));
        expect(economy.locationEconomy(home.id)?.orders).toEqual([]);
    });

    it("changes an order's priority", () => {
        const { economy, home } = economyWorld();
        const result = economy.build("alpha", home.id, structure("habitat"));
        const orderId = result.ok ? result.order.id : "";
        expect(economy.setPriority("alpha", home.id, orderId, "low").ok).toBe(true);
        expect(economy.locationEconomy(home.id)?.orders[0].priority).toBe("low");
        expect(economy.setPriority("beta", home.id, orderId, "high").ok).toBe(false);
    });

    it("colonises an unowned planet with a colony ship on its hex", () => {
        const { entities, economy } = economyWorld();
        const target = entities.add(makePlanet("free", 12, 5, 7));
        const colony = entities.add({
            ...makeShip("colony", "alpha", 12, 5),
            shipType: "colony_ship"
        });

        const result = economy.colonise("alpha", target.id, colony.id);
        expect(result.ok).toBe(true);
        expect(entities.get(colony.id)).toBeUndefined();
        expect(target.sideId).toBe("alpha");
        const state = economy.stateFor("alpha");
        expect(state.locations.map((l) => l.locationId)).toEqual(["home-a", target.id]);
        expect(state.locations[1]).toEqual({
            locationId: target.id,
            site: "planet",
            level: 7,
            slots: 7,
            stockpile: { ...zeroResources(), population: SHIP_TYPES.colony_ship.cost.population },
            installations: [],
            orders: []
        });
        expect(state).toMatchObject({ shipCount: 2, shipCap: 3 + 1 + Math.floor(7 / 5) });
        expect(economy.build("alpha", target.id, structure("habitat")).ok).toBe(true);
    });

    it("colonises moons and mineable asteroids but not barren asteroids", () => {
        const { entities, economy } = economyWorld();
        const colonyAt = (id: string, q: number, r: number) =>
            entities.add({ ...makeShip(id, "alpha", q, r), shipType: "colony_ship" as const });
        const moon = entities.add<EntityOf<"moon">>({
            id: "moon-free",
            kind: "moon",
            sideId: null,
            systemId: "sys-1",
            q: 12,
            r: 5
        });
        const rock = entities.add<EntityOf<"large_asteroid">>({
            id: "rock",
            kind: "large_asteroid",
            sideId: null,
            systemId: "sys-1",
            q: 13,
            r: 5
        });
        const ore = entities.add<EntityOf<"large_asteroid">>({
            id: "ore",
            kind: "large_asteroid",
            sideId: null,
            systemId: "sys-1",
            q: 14,
            r: 5,
            mineable: true
        });
        expect(economy.colonise("alpha", moon.id, colonyAt("c1", 12, 5).id).ok).toBe(true);
        expect(economy.colonise("alpha", rock.id, colonyAt("c2", 13, 5).id).ok).toBe(false);
        expect(economy.colonise("alpha", ore.id, colonyAt("c3", 14, 5).id).ok).toBe(true);
        expect(economy.locationEconomy(ore.id)).toMatchObject({ site: "asteroid", slots: 2 });
        expect(economy.build("alpha", ore.id, structure("mine")).ok).toBe(true);
        expect(economy.build("alpha", ore.id, structure("habitat"))).toEqual({
            ok: false,
            error: "Can't be built on an asteroid"
        });
    });

    it("rejects invalid colonise requests", () => {
        const { entities, economy, alphaShip, home } = economyWorld();
        const target = entities.add(makePlanet("free", 12, 5));
        const colony = entities.add({
            ...makeShip("colony", "alpha", 12, 5),
            shipType: "colony_ship"
        });
        const away = entities.add({
            ...makeShip("colony-away", "alpha", 14, 5),
            shipType: "colony_ship"
        });
        const betaColony = entities.add({
            ...makeShip("colony-b", "beta", 12, 5),
            shipType: "colony_ship"
        });

        expect(economy.colonise(null, target.id, colony.id).ok).toBe(false);
        expect(economy.colonise("alpha", "nope", colony.id).ok).toBe(false);
        expect(economy.colonise("alpha", target.id, "nope").ok).toBe(false);
        expect(economy.colonise("alpha", target.id, betaColony.id).ok).toBe(false);
        expect(economy.colonise("alpha", target.id, away.id).ok).toBe(false);
        entities.move(alphaShip.id, target);
        expect(economy.colonise("alpha", target.id, alphaShip.id).ok).toBe(false);
        // Enemy ships on the hex block colonising.
        expect(economy.colonise("alpha", target.id, colony.id).ok).toBe(false);
        entities.remove(betaColony.id);
        entities.move(colony.id, home);
        expect(economy.colonise("alpha", home.id, colony.id)).toEqual({
            ok: false,
            error: "Location is already owned"
        });
        expect(target.sideId).toBeNull();
        expect(entities.get(colony.id)).toBeDefined();
    });
});

describe("EconomyManager with instantBuild", () => {
    it("funds from the stockpile and completes as soon as an order is placed", () => {
        const map = createEmptyMap({ width: 20, height: 20, hexSize: 50, seed: 1 });
        const entities = new EntityManager(map);
        const home = entities.add(makePlanet("home-a", 5, 5, HOME_PLANET_LEVEL, "alpha"));
        const economy = new EconomyManager(entities, ["alpha", "beta"], { instantBuild: true });

        const built = economy.build("alpha", home.id, {
            kind: "structure",
            structureType: "shipyard"
        });
        expect(built).toMatchObject({ ok: true, completed: true });
        expect(economy.locationEconomy(home.id)).toMatchObject({
            installations: [{ type: "shipyard" }],
            orders: []
        });
        expect(economy.stockpile(home.id)).toEqual(
            subtractResources(STARTING_STOCKPILE, STRUCTURE_TYPES.shipyard.cost)
        );

        const result = economy.build("alpha", home.id, { kind: "ship", shipType: "scout" });
        expect(result.ok && result.completed).toBe(true);
        const spawned = result.ok ? result.spawnedShip : undefined;
        expect(spawned).toMatchObject({ shipType: "scout", sideId: "alpha", q: 5, r: 5 });
        expect(entities.get(spawned!.id)).toBeDefined();
    });

    it("keeps a funded ship on order while enemy ships occupy the location", () => {
        const map = createEmptyMap({ width: 20, height: 20, hexSize: 50, seed: 1 });
        const entities = new EntityManager(map);
        const home = entities.add(makePlanet("home-a", 5, 5, HOME_PLANET_LEVEL, "alpha"));
        entities.add(makeShip("enemy", "beta", 5, 5));
        const economy = new EconomyManager(entities, ["alpha", "beta"], { instantBuild: true });

        economy.build("alpha", home.id, { kind: "structure", structureType: "shipyard" });
        const result = economy.build("alpha", home.id, { kind: "ship", shipType: "scout" });
        expect(result).toMatchObject({ ok: true, completed: false });
        expect(economy.locationEconomy(home.id)?.orders).toHaveLength(1);
    });
});

describe("TurnManager with an economy", () => {
    it("runs the economy after restoring MP and reports spawned ships", () => {
        const map = createEmptyMap({ width: 20, height: 20, hexSize: 50, seed: 1 });
        const entities = new EntityManager(map);
        const home = entities.add(makePlanet("home-a", 5, 5, HOME_PLANET_LEVEL, "alpha"));
        const economy = new EconomyManager(entities, ["alpha", "beta"]);
        const turns = new TurnManager(["alpha", "beta"], entities, economy);

        economy.build("alpha", home.id, { kind: "structure", structureType: "shipyard" });
        for (let i = 0; i < STRUCTURE_TYPES.shipyard.buildTurns; i++) {
            turns.endTurn("alpha");
            turns.endTurn("beta");
        }
        economy.build("alpha", home.id, { kind: "ship", shipType: "scout" });
        turns.endTurn("alpha");
        expect(turns.endTurn("beta").economy?.spawnedShips).toEqual([]);
        turns.endTurn("alpha");
        const result = turns.endTurn("beta");
        expect(result.advanced).toBe(true);
        expect(result.economy?.spawnedShips).toHaveLength(1);
        expect(result.economy?.spawnedShips[0].movementPoints).toBe(
            SHIP_TYPES.scout.maxMovementPoints
        );
    });
});

describe("validateShipMove / moveShip", () => {
    it("rejects unknown, foreign, off-map, same-hex and no-MP moves", () => {
        const { entities, alphaShip } = smallWorld();
        expect(validateShipMove(entities, "alpha", "nope", { q: 0, r: 0 }).ok).toBe(false);
        expect(validateShipMove(entities, "beta", alphaShip.id, { q: 3, r: 5 }).ok).toBe(false);
        expect(validateShipMove(entities, null, alphaShip.id, { q: 3, r: 5 }).ok).toBe(false);
        expect(validateShipMove(entities, "alpha", alphaShip.id, { q: -50, r: 5 }).ok).toBe(false);
        expect(validateShipMove(entities, "alpha", alphaShip.id, alphaShip).ok).toBe(false);
        alphaShip.movementPoints = 0;
        expect(validateShipMove(entities, "alpha", alphaShip.id, { q: 6, r: 5 }).ok).toBe(false);
    });

    it("moves, deducts MP per hex and updates tile stacks", () => {
        const { entities, alphaShip } = smallWorld();
        const from = { q: alphaShip.q, r: alphaShip.r };
        const to = { q: from.q + 2, r: from.r };
        const result = moveShip(entities, "alpha", alphaShip.id, to);
        expect(result.ok && result.path).toEqual([{ q: 6, r: 5 }, to]);
        expect(alphaShip).toMatchObject({ ...to, movementPoints: 1 });
        expect(entities.entitiesAt(from.q, from.r)).toHaveLength(0);
        expect(entities.entitiesAt(to.q, to.r).map((e) => e.id)).toEqual([alphaShip.id]);
    });

    it("stops early when MP run out and only deducts the steps taken", () => {
        const { entities, alphaShip } = smallWorld();
        alphaShip.movementPoints = 2;
        const result = moveShip(entities, "alpha", alphaShip.id, { q: 10, r: 5 });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.path).toEqual([
            { q: 6, r: 5 },
            { q: 7, r: 5 }
        ]);
        expect(result.to).toEqual({ q: 7, r: 5 });
        expect(result.cost).toBe(2);
        expect(alphaShip).toMatchObject({ q: 7, r: 5, movementPoints: 0, facing: 0 });
        expect(moveShip(entities, "alpha", alphaShip.id, { q: 10, r: 5 }).ok).toBe(false);
    });

    it("paths around obstacles but can move into an explicitly targeted one", () => {
        const { entities, alphaShip } = smallWorld();
        entities.add(makePlanet("planet-1", 6, 5));
        const around = validateShipMove(entities, "alpha", alphaShip.id, { q: 7, r: 5 });
        expect(around.ok && around.path).toHaveLength(3);
        expect(around.ok && around.path).not.toContainEqual({ q: 6, r: 5 });

        const into = moveShip(entities, "alpha", alphaShip.id, { q: 6, r: 5 });
        expect(into.ok && into.path).toEqual([{ q: 6, r: 5 }]);
        expect(alphaShip).toMatchObject({ q: 6, r: 5, movementPoints: 2 });
    });

    it("plans with the moving side's knowledge, not hidden truth", () => {
        const { entities, alphaShip } = smallWorld();
        entities.add(makePlanet("hidden-planet", 7, 5));
        const side = new Side("alpha");
        side.recomputeVisibility(entities, 1);
        expect(side.knowsObstacleAt(entities, { q: 7, r: 5 })).toBe(false);

        const omniscient = validateShipMove(entities, "alpha", alphaShip.id, { q: 8, r: 5 });
        expect(omniscient.ok && omniscient.path).not.toContainEqual({ q: 7, r: 5 });

        const result = moveShip(
            entities,
            "alpha",
            alphaShip.id,
            { q: 8, r: 5 },
            {
                isObstacle: (hex) => side.knowsObstacleAt(entities, hex)
            }
        );
        expect(result.ok && result.path).toEqual([
            { q: 6, r: 5 },
            { q: 7, r: 5 },
            { q: 8, r: 5 }
        ]);
    });

    it("turns the ship to face the direction of its final step", () => {
        const { entities, alphaShip } = smallWorld();
        moveShip(entities, "alpha", alphaShip.id, { q: alphaShip.q - 1, r: alphaShip.r });
        expect(alphaShip.facing).toBe(3);
        moveShip(entities, "alpha", alphaShip.id, { q: alphaShip.q, r: alphaShip.r + 1 });
        expect(alphaShip.facing).toBe(5);
    });
});

describe("TurnManager", () => {
    it("advances only when all sides are ready and restores MP", () => {
        const { entities, alphaShip, betaShip } = smallWorld();
        alphaShip.movementPoints = 0;
        betaShip.movementPoints = 1;
        const turns = new TurnManager(["alpha", "beta"], entities);

        expect(turns.state()).toEqual({ turn: 1, sideReady: { alpha: false, beta: false } });

        const first = turns.endTurn("alpha");
        expect(first.advanced).toBe(false);
        expect(first.state.sideReady).toEqual({ alpha: true, beta: false });
        expect(alphaShip.movementPoints).toBe(0);

        const second = turns.endTurn("beta");
        expect(second.advanced).toBe(true);
        expect(second.state).toEqual({ turn: 2, sideReady: { alpha: false, beta: false } });
        expect(alphaShip.movementPoints).toBe(alphaShip.maxMovementPoints);
        expect(betaShip.movementPoints).toBe(betaShip.maxMovementPoints);
    });
});

describe("Side visibility diffs", () => {
    it("reveals/hides hexes when own ship moves and resends touched visible hexes", () => {
        const { entities, alphaShip } = smallWorld();
        const side = new Side("alpha");
        side.recomputeVisibility(entities, 2);
        const from = { q: alphaShip.q, r: alphaShip.r };

        moveShip(entities, "alpha", alphaShip.id, { q: from.q + 3, r: from.r });
        const diff = side.recomputeVisibility(entities, 2);
        expect(diff.revealed.length).toBeGreaterThan(0);
        expect(diff.hidden.length).toBeGreaterThan(0);

        const update = side.buildTilesUpdate(entities, diff, [
            axialKey(from.q, from.r),
            axialKey(alphaShip.q, alphaShip.r)
        ]);
        expect(update).not.toBeNull();
        const shipTile = update!.tiles.find((t) => t.q === alphaShip.q && t.r === alphaShip.r);
        expect(shipTile?.fog).toBe("visible");
        expect(shipTile?.entities[0]).toMatchObject({ id: alphaShip.id, movementPoints: 0 });
    });

    it("forgets remembered enemy positions once the enemy is seen elsewhere", () => {
        const { entities, alphaShip } = smallWorld();
        const enemy = entities.add(makeShip("ship-e", "beta", alphaShip.q + 2, alphaShip.r, 10));
        const side = new Side("alpha");
        side.recomputeVisibility(entities, 2);
        const seenAt = axialKey(enemy.q, enemy.r);

        // Alpha looks away: the enemy's last-known hex drops to explored memory.
        moveShip(entities, "alpha", alphaShip.id, { q: alphaShip.q - 3, r: alphaShip.r });
        let diff = side.recomputeVisibility(entities, 2);
        expect(diff.hidden).toContain(seenAt);
        expect(side.buildTileView(entities, seenAt)?.entities.map((e) => e.id)).toContain(enemy.id);

        // Enemy moves into alpha's vision somewhere else.
        const target = { q: alphaShip.q - 1, r: alphaShip.r };
        expect(axialDistance(enemy, target)).toBeLessThanOrEqual(10);
        moveShip(entities, "beta", enemy.id, target);
        diff = side.recomputeVisibility(entities, 2);
        expect(diff.forgetEntityIds).toEqual([enemy.id]);
        expect(side.buildTileView(entities, seenAt)?.entities).toEqual([]);
    });
});

describe("Side planet vision", () => {
    it("uses owned planets as vision sources", () => {
        const { entities, alphaShip } = smallWorld();
        const planet = entities.add(makePlanet("planet-far", 15, 5));
        const side = new Side("alpha");
        side.recomputeVisibility(entities, 2);
        expect(side.visible.has(axialKey(planet.q, planet.r))).toBe(false);

        planet.sideId = "alpha";
        const diff = side.recomputeVisibility(entities, 2);
        expect(diff.revealed).toContain(axialKey(planet.q, planet.r));
        expect(diff.revealed).toContain(axialKey(planet.q + 2, planet.r));

        // Vision persists without any ships.
        entities.remove(alphaShip.id);
        side.recomputeVisibility(entities, 2);
        expect(side.visible.has(axialKey(planet.q, planet.r))).toBe(true);
        expect(side.visible.has(axialKey(alphaShip.q, alphaShip.r))).toBe(false);
    });
});

describe("Side exploreAll (revealMap)", () => {
    it("explores every hex with remembered contents while visibility stays range-limited", () => {
        const { map, entities, betaShip } = smallWorld();
        const side = new Side("alpha");
        side.recomputeVisibility(entities, 2);
        side.exploreAll(entities);

        expect(side.explored.size).toBe(map.width * map.height);
        expect(side.visible.size).toBeLessThan(map.width * map.height);
        expect(side.buildTileViews(entities)).toHaveLength(map.width * map.height);

        const betaKey = axialKey(betaShip.q, betaShip.r);
        const betaView = side.buildTileView(entities, betaKey);
        expect(betaView?.fog).toBe("explored");
        expect(betaView?.entities.map((e) => e.id)).toEqual([betaShip.id]);

        // Enemy moves while unseen: alpha keeps the stale memory and gets no update.
        moveShip(entities, "beta", betaShip.id, { q: betaShip.q + 1, r: betaShip.r });
        const diff = side.recomputeVisibility(entities, 2);
        expect(side.buildTileView(entities, betaKey)?.entities.map((e) => e.id)).toEqual([
            betaShip.id
        ]);
        expect(
            side.buildTilesUpdate(entities, diff, [betaKey, axialKey(betaShip.q, betaShip.r)])
        ).toBeNull();
    });
});

describe("Side fullVisibility", () => {
    it("sees every hex and receives live updates for enemy moves", () => {
        const { map, entities, betaShip } = smallWorld();
        const side = new Side("alpha", { fullVisibility: true });
        side.recomputeVisibility(entities, 2);

        expect(side.visible.size).toBe(map.width * map.height);
        expect(side.explored.size).toBe(map.width * map.height);
        expect(side.buildTileViews(entities).every((t) => t.fog === "visible")).toBe(true);

        const from = { q: betaShip.q, r: betaShip.r };
        moveShip(entities, "beta", betaShip.id, { q: from.q + 1, r: from.r });
        const diff = side.recomputeVisibility(entities, 2);
        expect(diff).toEqual({ revealed: [], hidden: [], forgetEntityIds: [] });

        const update = side.buildTilesUpdate(entities, diff, [
            axialKey(from.q, from.r),
            axialKey(betaShip.q, betaShip.r)
        ]);
        expect(update?.tiles).toHaveLength(2);
        const fromTile = update!.tiles.find((t) => t.q === from.q && t.r === from.r);
        const toTile = update!.tiles.find((t) => t.q === betaShip.q && t.r === betaShip.r);
        expect(fromTile).toMatchObject({ fog: "visible", entities: [] });
        expect(toTile?.fog).toBe("visible");
        expect(toTile?.entities.map((e) => e.id)).toEqual([betaShip.id]);
    });
});

describe("BattleManager", () => {
    function battleWorld() {
        const world = smallWorld();
        const enemy = world.entities.add(makeShip("ship-e", "beta", 7, 5));
        const battles = new BattleManager(world.entities);
        return { ...world, enemy, battles };
    }

    it("stops a move in the first hex holding enemy ships and starts a battle", () => {
        const { entities, alphaShip, enemy, battles } = battleWorld();
        const result = battles.moveShip("alpha", alphaShip.id, { q: 8, r: 5 });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.move.path).toEqual([
            { q: 6, r: 5 },
            { q: 7, r: 5 }
        ]);
        expect(alphaShip).toMatchObject({ q: 7, r: 5, movementPoints: 1 });
        expect(result.battle).toMatchObject({
            q: 7,
            r: 5,
            attackerSideId: "alpha",
            defenderSideId: "beta",
            attackerShipIds: [alphaShip.id],
            defenderShipIds: [enemy.id]
        });
        expect(battles.pending()).toHaveLength(1);
        expect(entities.entitiesAt(7, 5).map((e) => e.id)).toEqual([enemy.id, alphaShip.id]);
    });

    it("does not start a battle when moving among friendly ships", () => {
        const { entities, alphaShip, battles } = battleWorld();
        entities.add(makeShip("ship-a2", "alpha", 6, 5));
        const result = battles.moveShip("alpha", alphaShip.id, { q: 6, r: 5 });
        expect(result.ok && result.battle).toBeNull();
    });

    it("locks involved ships and the battle hex while pending", () => {
        const { entities, alphaShip, enemy, battles } = battleWorld();
        battles.moveShip("alpha", alphaShip.id, { q: 7, r: 5 });
        expect(battles.moveShip("alpha", alphaShip.id, { q: 6, r: 5 }).ok).toBe(false);
        expect(battles.moveShip("beta", enemy.id, { q: 8, r: 5 }).ok).toBe(false);

        const other = entities.add(makeShip("ship-a3", "alpha", 5, 6));
        const into = battles.moveShip("alpha", other.id, { q: 7, r: 5 });
        expect(into.ok).toBe(false);
        expect(other).toMatchObject({ q: 5, r: 6, movementPoints: 3 });
    });

    it("only lets the attacker resolve, with a combatant as winner", () => {
        const { alphaShip, battles } = battleWorld();
        const start = battles.moveShip("alpha", alphaShip.id, { q: 7, r: 5 });
        const battleId = start.ok ? start.battle!.battleId : "";
        expect(battles.resolve(battleId, "beta", "beta").ok).toBe(false);
        expect(battles.resolve(battleId, null, "alpha").ok).toBe(false);
        expect(battles.resolve(battleId, "alpha", "gamma").ok).toBe(false);
        expect(battles.resolve("nope", "alpha", "alpha").ok).toBe(false);
        expect(battles.pending()).toHaveLength(1);
    });

    it("destroys the loser's ships in the hex and clears the battle", () => {
        const { entities, alphaShip, enemy, battles } = battleWorld();
        const second = entities.add(makeShip("ship-e2", "beta", 7, 5));
        const start = battles.moveShip("alpha", alphaShip.id, { q: 7, r: 5 });
        const battleId = start.ok ? start.battle!.battleId : "";

        const result = battles.resolve(battleId, "alpha", "alpha");
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.loserSideId).toBe("beta");
        expect(result.destroyedShipIds.sort()).toEqual([enemy.id, second.id].sort());
        expect(entities.get(enemy.id)).toBeUndefined();
        expect(entities.get(second.id)).toBeUndefined();
        expect(entities.entitiesAt(7, 5).map((e) => e.id)).toEqual([alphaShip.id]);
        expect(battles.pending()).toHaveLength(0);
        expect(battles.moveShip("alpha", alphaShip.id, { q: 8, r: 5 }).ok).toBe(true);
    });

    it("destroys the attacker when the defender is named winner and scrubs side memory", () => {
        const { entities, alphaShip, enemy, battles } = battleWorld();
        const alpha = new Side("alpha");
        const start = battles.moveShip("alpha", alphaShip.id, { q: 7, r: 5 });
        const battleId = start.ok ? start.battle!.battleId : "";
        alpha.recomputeVisibility(entities, 1);

        const result = battles.resolve(battleId, "alpha", "beta");
        expect(result.ok && result.destroyedShipIds).toEqual([alphaShip.id]);
        expect(entities.get(alphaShip.id)).toBeUndefined();
        expect(entities.get(enemy.id)).toBeDefined();

        // Alpha loses its only ship, so the hex drops to memory still holding it.
        const diff = alpha.recomputeVisibility(entities, 1);
        expect(diff.hidden).toContain(axialKey(7, 5));
        expect(alpha.forgetEntities([alphaShip.id])).toEqual([alphaShip.id]);
        expect(alpha.buildTileView(entities, axialKey(7, 5))?.entities.map((e) => e.id)).toEqual([
            enemy.id
        ]);
    });
});
