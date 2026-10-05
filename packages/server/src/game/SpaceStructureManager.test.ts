import { axialDistance, parseAxialKey } from "@space/maths";
import {
    shipRepairPerTurn,
    shipStats,
    spaceStructureStats,
    zeroResources,
    type AxialCoord,
    type EconomyBalance,
    type ShipType,
    type SideId,
    type SpaceStructureType,
    type TechId
} from "@space/shared-data";
import { describe, expect, it } from "vitest";
import { defaultEconomyBalance } from "../config/config.schema.js";
import { BattleManager, isDefendedHex } from "./Battle.js";
import { EconomyManager } from "./EconomyManager.js";
import { EntityManager } from "./EntityManager.js";
import { createEmptyMap } from "./map/SpaceMap.js";
import type { EntityOf } from "./map/types.js";
import { RepairManager } from "./RepairManager.js";
import { Side } from "./Side.js";
import { SpaceStructureManager } from "./SpaceStructureManager.js";
import { SupplyManager, type SupplyKnowledge } from "./SupplyManager.js";
import { TurnManager } from "./TurnManager.js";

const DEFAULTS = defaultEconomyBalance();
const ALL_TECHS: TechId[] = [
    "space_construction",
    "sensor_arrays_2",
    "sensor_arrays_3",
    "space_stations_1",
    "space_stations_2",
    "missile_batteries",
    "stargates"
];

/** No stockpile caps or concurrency limits, so funding only depends on the rules under test. */
function unlimitedBalance(): EconomyBalance {
    const balance = defaultEconomyBalance();
    const lots = { money: 1e9, materials: 1e9, population: 1e9, science: 1e9 };
    return { ...balance, stockpileCaps: { default: lots, home: lots } };
}

type WorldOptions = {
    instantBuild?: boolean;
    techs?: TechId[];
    rng?: () => number;
    knowledge?: (sideId: SideId) => SupplyKnowledge;
};

function world({
    instantBuild = false,
    techs = ALL_TECHS,
    rng = () => 0.5,
    knowledge
}: WorldOptions = {}) {
    const map = createEmptyMap({ width: 30, height: 30, hexSize: 50, seed: 1 });
    const entities = new EntityManager(map);
    const home = entities.add<EntityOf<"planet">>({
        id: "home-a",
        kind: "planet",
        sideId: "alpha",
        systemId: "sys-1",
        q: 2,
        r: 2,
        level: 10
    });
    const economy = new EconomyManager(entities, ["alpha", "beta"], {
        instantBuild,
        balance: unlimitedBalance(),
        homes: { alpha: home.id }
    });
    for (const tech of techs) economy.research.add("alpha", tech);
    const turns: { manager?: TurnManager } = {};
    const turn = () => turns.manager?.combatTurn ?? 1;
    const battles = new BattleManager(entities, economy, { rng, turn });
    const structures = new SpaceStructureManager(entities, economy, { rng, turn });
    const supply = new SupplyManager(entities, economy, { battles, knowledge });
    const manager = new TurnManager(["alpha", "beta"], entities, economy, supply, {
        repairs: new RepairManager(entities, economy),
        structures
    });
    turns.manager = manager;
    const endTurn = () => {
        manager.endTurn("alpha");
        return manager.endTurn("beta");
    };
    return { entities, economy, battles, structures, supply, turns: manager, endTurn, home };
}

function makeShip(
    entities: EntityManager,
    id: string,
    sideId: SideId,
    at: AxialCoord,
    shipType: ShipType = "builder"
): EntityOf<"ship"> {
    const stats = shipStats(shipType, 1, DEFAULTS);
    return entities.add<EntityOf<"ship">>({
        id,
        kind: "ship",
        shipType,
        sideId,
        q: at.q,
        r: at.r,
        facing: 0,
        movementPoints: stats.maxMovementPoints,
        maxMovementPoints: stats.maxMovementPoints
    });
}

/** A finished structure with its economy entry, as if a Builder had completed it. */
function addStructure(
    w: ReturnType<typeof world>,
    id: string,
    type: SpaceStructureType,
    at: AxialCoord,
    sideId: SideId = "alpha",
    extra: Partial<EntityOf<"space_structure">> = {}
): EntityOf<"space_structure"> {
    const structure = w.entities.add<EntityOf<"space_structure">>({
        id,
        kind: "space_structure",
        structureType: type,
        sideId,
        q: at.q,
        r: at.r,
        constructing: true
    });
    const builder = makeShip(w.entities, `${id}-builder`, sideId, at);
    w.economy.startConstruction(structure);
    const balance = DEFAULTS.spaceStructures[type];
    w.economy.deposit(id, balance.cost);
    for (let i = 0; i < balance.buildTurns; i++) w.economy.fund();
    w.economy.completeReady();
    w.entities.remove(builder.id);
    if (structure.constructing) throw new Error(`${id} didn't complete`);
    return Object.assign(structure, extra);
}

const hex = (q: number, r: number): AxialCoord => ({ q, r });

describe("Builder construction", () => {
    it("starts a construction site on the Builder's empty hex", () => {
        const w = world();
        makeShip(w.entities, "builder-1", "alpha", hex(10, 10));
        const result = w.structures.construct("alpha", "builder-1", "sensor_array");
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.structure).toMatchObject({
            kind: "space_structure",
            structureType: "sensor_array",
            sideId: "alpha",
            q: 10,
            r: 10,
            constructing: true
        });
        const site = w.economy.locationEconomy(result.structure.id)!;
        expect(site).toMatchObject({
            site: "space",
            structure: { type: "sensor_array", tier: 1, constructing: true }
        });
        expect(site.orders.map((o) => o.item)).toEqual([
            { kind: "spaceStructure", structureType: "sensor_array" }
        ]);
    });

    it("refuses without the tech, a Builder, an empty hex or with enemies present", () => {
        const w = world({ techs: ["space_construction"] });
        makeShip(w.entities, "builder-1", "alpha", hex(10, 10));
        makeShip(w.entities, "frigate-1", "alpha", hex(12, 10), "frigate");
        makeShip(w.entities, "builder-home", "alpha", hex(2, 2));
        expect(w.structures.construct("alpha", "builder-1", "space_station")).toMatchObject({
            ok: false
        });
        expect(w.structures.construct("alpha", "frigate-1", "sensor_array")).toMatchObject({
            ok: false
        });
        expect(w.structures.construct("alpha", "builder-home", "sensor_array")).toMatchObject({
            ok: false
        });
        expect(w.structures.construct("beta", "builder-1", "sensor_array")).toMatchObject({
            ok: false
        });

        expect(w.structures.construct("alpha", "builder-1", "sensor_array").ok).toBe(true);
        expect(w.structures.construct("alpha", "builder-1", "space_dock")).toMatchObject({
            ok: false
        });

        makeShip(w.entities, "builder-2", "alpha", hex(14, 10));
        makeShip(w.entities, "raider", "beta", hex(14, 10), "frigate");
        expect(w.structures.construct("alpha", "builder-2", "sensor_array")).toMatchObject({
            ok: false
        });
    });

    it("only funds a site while a Builder is on its hex, then completes it", () => {
        const w = world();
        const builder = makeShip(w.entities, "builder-1", "alpha", hex(10, 10));
        const result = w.structures.construct("alpha", "builder-1", "sensor_array");
        if (!result.ok) throw new Error(result.error);
        const id = result.structure.id;
        const cost = DEFAULTS.spaceStructures.sensor_array.cost;
        w.economy.deposit(id, cost);
        w.entities.move(builder.id, hex(11, 10));

        w.economy.fund();
        expect(w.economy.locationEconomy(id)!.orders[0].applied).toEqual(zeroResources());

        w.entities.move(builder.id, hex(10, 10));
        for (let i = 0; i < DEFAULTS.spaceStructures.sensor_array.buildTurns; i++) {
            w.economy.fund();
        }
        expect(w.economy.locationEconomy(id)!.orders[0].applied).toEqual(cost);
        w.economy.completeReady();
        expect(result.structure.constructing).toBeUndefined();
        expect(w.economy.locationEconomy(id)).toMatchObject({
            orders: [],
            structure: { type: "sensor_array", tier: 1, constructing: false }
        });
    });

    it("cancelling construction removes the site", () => {
        const w = world();
        makeShip(w.entities, "builder-1", "alpha", hex(10, 10));
        const result = w.structures.construct("alpha", "builder-1", "missile_battery");
        if (!result.ok) throw new Error(result.error);
        const order = w.economy.locationEconomy(result.structure.id)!.orders[0];
        expect(w.economy.cancel("alpha", result.structure.id, order.id).ok).toBe(true);
        expect(w.entities.get(result.structure.id)).toBeUndefined();
        expect(w.economy.locationEconomy(result.structure.id)).toBeUndefined();
    });
});

describe("space structure upgrades and docks", () => {
    function completed(type: SpaceStructureType, techs = ALL_TECHS) {
        const w = world({ instantBuild: true, techs });
        w.economy.deposit(w.home.id, { money: 1e5, materials: 1e5, population: 1e5, science: 1e5 });
        makeShip(w.entities, "builder-1", "alpha", hex(10, 10));
        const result = w.structures.construct("alpha", "builder-1", type);
        if (!result.ok) throw new Error(result.error);
        w.economy.completeReady();
        expect(result.structure.constructing).toBeUndefined();
        return { ...w, structure: result.structure };
    }

    it("upgrades a tier once its tech is researched", () => {
        const w = completed("sensor_array", ["space_construction"]);
        const upgrade = (tier: 2 | 3) =>
            w.economy.build(
                "alpha",
                w.structure.id,
                {
                    kind: "enhancement",
                    target: {
                        kind: "spaceStructure",
                        structureId: w.structure.id,
                        structureType: "sensor_array"
                    },
                    tier
                },
                "medium"
            );
        expect(upgrade(2)).toMatchObject({ ok: false });
        w.economy.research.add("alpha", "sensor_arrays_2");
        expect(upgrade(2)).toMatchObject({ ok: true, completed: true });
        expect(w.structure.tier).toBe(2);
        expect(upgrade(3)).toMatchObject({ ok: false });
    });

    it("builds shipyard ships at a Space Dock, but not colony ships or transports", () => {
        const w = completed("space_dock");
        const build = (shipType: ShipType) =>
            w.economy.build("alpha", w.structure.id, { kind: "ship", shipType }, "medium");
        expect(build("scout").ok).toBe(true);
        expect(build("colony_ship")).toMatchObject({ ok: false });
        expect(build("star_destroyer")).toMatchObject({ ok: false });
        const scouts = w.entities.ofKind("ship").filter((s) => s.shipType === "scout");
        expect(scouts.map((s) => [s.q, s.r])).toEqual([[10, 10]]);
    });

    it("can't build ships at structures other than docks", () => {
        const w = completed("sensor_array");
        expect(
            w.economy.build("alpha", w.structure.id, { kind: "ship", shipType: "scout" }, "medium")
        ).toMatchObject({ ok: false });
    });
});

describe("space structure combat", () => {
    it("armed structures fire on enemy ships within their radius at end of turn", () => {
        const w = world();
        const battery = addStructure(w, "battery", "missile_battery", hex(10, 10));
        const target = makeShip(w.entities, "target", "beta", hex(12, 10), "frigate");
        makeShip(w.entities, "far", "beta", hex(14, 10), "frigate");

        const ranged = w.endTurn().ranged ?? [];
        expect(ranged).toHaveLength(1);
        expect(ranged[0]).toMatchObject({
            cause: "ranged",
            attackerSideId: "alpha",
            hex: { q: 12, r: 10 },
            from: { q: 10, r: 10 }
        });
        const stats = spaceStructureStats("missile_battery", 1, DEFAULTS);
        expect(stats.fireRadius).toBe(2);
        const hit = w.entities.getOfKind(target.id, "ship");
        expect(!hit || (hit.hp ?? Infinity) < shipStats("frigate", 1, DEFAULTS).hp).toBe(true);
        expect(battery.lastCombatTurn).toBe(1);
        expect(w.entities.getOfKind("far", "ship")?.hp).toBeUndefined();
    });

    it("structures under construction don't fire", () => {
        const w = world();
        makeShip(w.entities, "builder-1", "alpha", hex(10, 10));
        w.structures.construct("alpha", "builder-1", "space_station");
        makeShip(w.entities, "target", "beta", hex(11, 10), "frigate");
        expect(w.structures.fireRanged()).toEqual([]);
    });

    it("enemy structures defend their hex; unarmed ones are destroyed when attacked", () => {
        const w = world();
        const sensor = addStructure(w, "sensor", "sensor_array", hex(10, 10), "alpha", { hp: 1 });
        expect(isDefendedHex(w.entities, w.economy, sensor, "beta")).toBe(true);
        expect(isDefendedHex(w.entities, w.economy, sensor, "alpha")).toBe(false);
        makeShip(w.entities, "raider", "beta", hex(11, 10), "star_destroyer");

        const outcome = w.battles.moveShip("beta", "raider", hex(10, 10));
        expect(outcome.ok).toBe(true);
        if (!outcome.ok) return;
        expect(outcome.combat?.destroyedStructureIds).toEqual(["sensor"]);
        expect(w.entities.get("sensor")).toBeUndefined();
        expect(w.economy.locationEconomy("sensor")).toBeUndefined();
    });
});

describe("space structure vision and repair", () => {
    it("structures see by their tier's vision range; sites see their neighbours", () => {
        const w = world();
        w.entities.remove(w.home.id);
        const sensor = addStructure(w, "sensor", "sensor_array", hex(8, 15));
        const side = new Side("alpha");
        const distances = () =>
            [...side.visible].map((key) => axialDistance(parseAxialKey(key), sensor));
        const range = spaceStructureStats("sensor_array", 1, DEFAULTS).visionRange;
        side.recomputeVisibility(w.entities, 1, 1, () => range);
        expect(Math.max(...distances())).toBe(range);

        sensor.constructing = true;
        side.recomputeVisibility(w.entities, 1, 1);
        expect(Math.max(...distances())).toBe(1);
    });

    it("Space Docks repair ships faster than Space Stations, which beat open space", () => {
        const w = world();
        addStructure(w, "dock", "space_dock", hex(10, 10));
        addStructure(w, "station", "space_station", hex(14, 10));
        const hp = 2;
        const max = shipStats("frigate", 1, DEFAULTS).hp;
        const ships = [hex(10, 10), hex(14, 10), hex(18, 10)].map((at, i) => {
            const ship = makeShip(w.entities, `ship-${i}`, "alpha", at, "frigate");
            ship.hp = hp;
            return ship;
        });
        new RepairManager(w.entities, w.economy).repair(1);
        const gained = ships.map((s) => (s.hp ?? max) - hp);
        expect(gained[0]).toBe(
            shipRepairPerTurn(DEFAULTS, hp, max, [], {
                atSpaceDock: true,
                structureBonus: DEFAULTS.spaceStructures.space_dock.repairBonus
            })
        );
        expect(gained[0]).toBeGreaterThan(gained[1]);
        expect(gained[1]).toBeGreaterThan(gained[2]);
    });

    it("damaged structures repair out of combat", () => {
        const w = world();
        const station = addStructure(w, "station", "space_station", hex(10, 10), "alpha", {
            hp: 10
        });
        const events = new RepairManager(w.entities, w.economy).repair(1);
        expect(events).toMatchObject([{ id: "station", kind: "space_structure", hpBefore: 10 }]);
        expect(station.hp).toBeGreaterThan(10);
    });
});

describe("Stargates", () => {
    it("takes a ship (and its cargo of ships) to another friendly gate, using all its MP", () => {
        const w = world();
        addStructure(w, "gate-a", "stargate", hex(5, 4));
        addStructure(w, "gate-b", "stargate", hex(20, 4));
        const ship = makeShip(w.entities, "ship", "alpha", hex(5, 4), "frigate");

        const result = w.structures.stargate("alpha", ship.id, "gate-b");
        expect(result).toMatchObject({
            ok: true,
            from: { q: 5, r: 4 },
            to: { q: 20, r: 4 },
            fromGateId: "gate-a",
            toGateId: "gate-b"
        });
        expect([ship.q, ship.r, ship.movementPoints]).toEqual([20, 4, 0]);
        expect(w.structures.stargate("alpha", ship.id, "gate-a")).toMatchObject({ ok: false });
    });

    it("refuses unfinished, enemy-held or enemy-owned exits", () => {
        const w = world();
        addStructure(w, "gate-a", "stargate", hex(5, 4));
        addStructure(w, "gate-b", "stargate", hex(20, 4));
        addStructure(w, "gate-c", "stargate", hex(15, 6), "alpha", { constructing: true });
        addStructure(w, "gate-d", "stargate", hex(10, 8), "beta");
        makeShip(w.entities, "guard", "beta", hex(20, 4), "frigate");
        const ship = makeShip(w.entities, "ship", "alpha", hex(5, 4), "frigate");
        for (const gate of ["gate-b", "gate-c", "gate-d"]) {
            expect(w.structures.stargate("alpha", ship.id, gate)).toMatchObject({ ok: false });
        }
        expect([ship.q, ship.r]).toEqual([5, 4]);
    });

    it("supply ships route through friendly gates when it saves turns", () => {
        const blind = (): SupplyKnowledge => ({
            isObstacle: () => false,
            isHostile: () => false
        });
        const w = world({ knowledge: blind });
        addStructure(w, "gate-a", "stargate", hex(3, 2));
        addStructure(w, "gate-b", "stargate", hex(27, 2));
        w.entities.add<EntityOf<"moon">>({
            id: "far-moon",
            kind: "moon",
            sideId: "alpha",
            systemId: "sys-1",
            q: 28,
            r: 2
        });
        const route = w.supply.planRoute("alpha", hex(2, 2), hex(28, 2))!;
        const hopAt = route.findIndex((h) => h.q === 27 && h.r === 2);
        expect(route[hopAt - 1]).toEqual({ q: 3, r: 2 });
        expect(route.length).toBeLessThan(10);

        const supplyShip = w.entities.add<EntityOf<"supply_ship">>({
            id: "freighter",
            kind: "supply_ship",
            sideId: "alpha",
            q: 2,
            r: 2,
            facing: 0,
            originId: "home-a",
            destinationId: "far-moon",
            cargo: zeroResources(),
            reservedFor: [],
            speed: 6,
            capacity: 100,
            route
        });
        const moved = w.supply.move([supplyShip.id]);
        expect(moved.stargates).toMatchObject([
            { from: { q: 3, r: 2 }, to: { q: 27, r: 2 }, fromGateId: "gate-a" }
        ]);
        expect([supplyShip.q, supplyShip.r]).toEqual([27, 2]);
    });
});
