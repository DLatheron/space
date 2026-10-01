import { axialKey, axialRange, offsetToAxial } from "@space/maths";
import {
    addResources,
    zeroResources,
    type AxialCoord,
    type BuildItem,
    type EconomyBalance,
    type Resources
} from "@space/shared-data";
import { defaultEconomyBalance } from "../config/config.schema.js";
import { BattleManager } from "./Battle.js";
import { destroyVessels } from "./destroyShips.js";
import { EconomyManager, type BuildResult } from "./EconomyManager.js";
import { EntityManager } from "./EntityManager.js";
import { createEmptyMap } from "./map/SpaceMap.js";
import type { EntityOf } from "./map/types.js";
import { Side } from "./Side.js";
import { SupplyManager, type SupplyKnowledge } from "./SupplyManager.js";
import { TurnManager } from "./TurnManager.js";

const DEFAULTS = defaultEconomyBalance();
const res = (partial: Partial<Resources>): Resources => ({ ...zeroResources(), ...partial });
const habitat: BuildItem = { kind: "structure", structureType: "habitat" };
const mine: BuildItem = { kind: "structure", structureType: "mine" };
const orderId = (result: BuildResult) => (result.ok ? result.order.id : "");
const hex = (q: number, r: number): AxialCoord => ({ q, r });

/** No stockpile caps or concurrency limits, for tests about supply itself. */
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

function makeMoon(
    entities: EntityManager,
    id: string,
    q: number,
    r: number,
    sideId: string | null = "alpha"
): EntityOf<"moon"> {
    return entities.add<EntityOf<"moon">>({ id, kind: "moon", sideId, systemId: "sys-1", q, r });
}

function makeWarship(
    entities: EntityManager,
    id: string,
    sideId: string,
    q: number,
    r: number
): EntityOf<"ship"> {
    return entities.add<EntityOf<"ship">>({
        id,
        kind: "ship",
        shipType: "frigate",
        sideId,
        q,
        r,
        facing: 0,
        movementPoints: 3,
        maxMovementPoints: 3
    });
}

function makeSupplyShip(
    entities: EntityManager,
    id: string,
    at: AxialCoord,
    originId: string,
    destinationId: string,
    cargo: Resources = res({ money: 10 })
): EntityOf<"supply_ship"> {
    return entities.add<EntityOf<"supply_ship">>({
        id,
        kind: "supply_ship",
        name: id,
        sideId: "alpha",
        q: at.q,
        r: at.r,
        facing: 0,
        originId,
        destinationId,
        cargo,
        reservedFor: [],
        speed: 6,
        capacity: 100
    });
}

/** Moons have no base income, so stockpiles only change through orders and supply. */
function supplyWorld(
    knowledge?: (sideId: string) => SupplyKnowledge,
    balance: EconomyBalance = unlimitedBalance(),
    rng: () => number = () => 0.5
) {
    const map = createEmptyMap({ width: 30, height: 30, hexSize: 50, seed: 1 });
    const entities = new EntityManager(map);
    const economy = new EconomyManager(entities, ["alpha", "beta"], { balance });
    const battles = new BattleManager(entities, economy, { rng });
    const supply = new SupplyManager(entities, economy, { battles, knowledge });
    const turns = new TurnManager(["alpha", "beta"], entities, economy, supply);
    const endTurn = () => {
        turns.endTurn("alpha");
        return turns.endTurn("beta");
    };
    return { map, entities, economy, battles, supply, turns, endTurn };
}

const blind = (): SupplyKnowledge => ({ isObstacle: () => false, isHostile: () => false });

describe("SupplyManager dispatch", () => {
    it("serves higher priority orders first when stock is short", () => {
        const { entities, economy, supply } = supplyWorld();
        const source = makeMoon(entities, "source", 0, 10);
        const urgent = makeMoon(entities, "urgent", 10, 10);
        const later = makeMoon(entities, "later", 10, 14);
        economy.deposit(source.id, res({ money: 60 }));
        const low = orderId(economy.build("alpha", later.id, habitat, "low"));
        const high = orderId(economy.build("alpha", urgent.id, habitat, "high"));

        const dispatched = supply.dispatch();
        expect(dispatched).toHaveLength(2);
        const to = (id: string) => dispatched.find((s) => s.destinationId === id)!;
        expect(to(urgent.id)).toMatchObject({
            originId: source.id,
            cargo: res({ money: 50 }),
            reservedFor: [{ orderId: high, amount: res({ money: 50 }) }]
        });
        expect(to(later.id)).toMatchObject({
            cargo: res({ money: 10 }),
            reservedFor: [{ orderId: low, amount: res({ money: 10 }) }]
        });
        expect(economy.stockpile(source.id)).toEqual(zeroResources());
    });

    it("takes from the nearest source by route length first", () => {
        const { entities, economy, supply } = supplyWorld();
        const near = makeMoon(entities, "near", 13, 10);
        const far = makeMoon(entities, "far", 4, 10);
        const dest = makeMoon(entities, "dest", 10, 10);
        economy.deposit(near.id, res({ money: 30 }));
        economy.deposit(far.id, res({ money: 30 }));
        economy.build("alpha", dest.id, habitat);

        const dispatched = supply.dispatch();
        expect(dispatched.map((s) => [s.originId, s.cargo.money])).toEqual([
            [near.id, 30],
            [far.id, 20]
        ]);
        expect(economy.stockpile(far.id)).toEqual(res({ money: 10 }));
        expect(dispatched[0].route).toEqual([hex(12, 10), hex(11, 10), hex(10, 10)]);
    });

    it("only sends stock the source's own orders won't need", () => {
        const { entities, economy, supply } = supplyWorld();
        const source = makeMoon(entities, "source", 0, 10);
        const dest = makeMoon(entities, "dest", 10, 10);
        economy.deposit(source.id, res({ money: 80, materials: 100 }));
        economy.build("alpha", source.id, habitat);
        economy.build("alpha", dest.id, habitat);

        const dispatched = supply.dispatch();
        expect(dispatched).toHaveLength(1);
        expect(dispatched[0]).toMatchObject({ destinationId: dest.id, cargo: res({ money: 30 }) });
        expect(economy.stockpile(source.id)).toEqual(res({ money: 50, materials: 100 }));
    });

    it("reserves in-flight cargo so nothing is over-supplied across turns", () => {
        const { entities, economy, supply, endTurn } = supplyWorld();
        const source = makeMoon(entities, "source", 0, 10);
        const dest = makeMoon(entities, "dest", 10, 10);
        economy.deposit(source.id, res({ money: 1000, materials: 1000 }));
        economy.build("alpha", dest.id, habitat);

        // Dispatched and under way at once: the in-flight cargo covers the demand.
        const launched = endTurn().supply;
        expect(launched?.dispatched).toHaveLength(2);
        expect(launched?.arrivals).toEqual([]);
        expect(supply.shipsOf("alpha").map((s) => s.q)).toEqual([6, 6]);
        expect(supply.inFlightTo(dest.id)).toEqual(res({ money: 50, materials: 100 }));
        expect(supply.dispatch()).toEqual([]);
        // Arrived and partly drawn: the stockpile covers the rest.
        const arrived = endTurn().supply;
        expect(arrived?.dispatched).toEqual([]);
        expect(arrived?.arrivals).toHaveLength(2);
        expect(supply.shipsOf("alpha")).toEqual([]);
        expect(economy.stockpile(dest.id)).toEqual(res({ money: 25, materials: 50 }));
        // Fully funded: nothing more is dispatched while it waits a turn to complete.
        expect(endTurn().supply?.dispatched).toEqual([]);
        expect(economy.stockpile(dest.id)).toEqual(zeroResources());
        expect(endTurn().economy?.completed).toMatchObject([{ locationId: dest.id }]);

        // Completed before income, the habitat produces that same end of turn.
        expect(economy.stockpile(dest.id)).toEqual(DEFAULTS.structures.habitat.produces);
        expect(economy.stockpile(source.id)).toEqual(res({ money: 950, materials: 900 }));
        expect(supply.shipsOf("alpha")).toEqual([]);
    });

    it("packs mixed cargo into ships by capacity, splitting reservations", () => {
        const { entities, economy, supply } = supplyWorld();
        const source = makeMoon(entities, "source", 0, 10);
        const dest = makeMoon(entities, "dest", 10, 10);
        economy.deposit(source.id, res({ money: 1000, materials: 1000, population: 100 }));
        const hab = orderId(economy.build("alpha", dest.id, habitat, "high"));
        const min = orderId(economy.build("alpha", dest.id, mine, "medium"));

        const dispatched = supply.dispatch();
        expect(dispatched.map((s) => s.cargo)).toEqual([
            res({ money: 50, materials: 50 }),
            res({ money: 50, materials: 50 }),
            res({ money: 50, population: 10 })
        ]);
        expect(dispatched.map((s) => s.reservedFor)).toEqual([
            [{ orderId: hab, amount: res({ money: 50, materials: 50 }) }],
            [
                { orderId: hab, amount: res({ materials: 50 }) },
                { orderId: min, amount: res({ money: 50 }) }
            ],
            [{ orderId: min, amount: res({ money: 50, population: 10 }) }]
        ]);
        expect(dispatched.every((s) => s.capacity === 100)).toBe(true);
    });

    it("packs into larger ships once supply capacity is researched", () => {
        const { entities, economy, supply } = supplyWorld();
        const source = makeMoon(entities, "source", 0, 10);
        const dest = makeMoon(entities, "dest", 10, 10);
        economy.deposit(source.id, res({ money: 1000, materials: 1000, population: 100 }));
        economy.build("alpha", dest.id, habitat, "high");
        economy.build("alpha", dest.id, mine, "medium");
        economy.research.add("alpha", "supply_capacity_1");

        const dispatched = supply.dispatch();
        expect(dispatched.map((s) => s.cargo)).toEqual([
            res({ money: 50, materials: 100 }),
            res({ money: 100, population: 10 })
        ]);
        expect(dispatched.every((s) => s.capacity === 150)).toBe(true);
    });

    it("re-sends surplus left at a destination by local production to other demand", () => {
        const { entities, economy, supply } = supplyWorld();
        const busy = makeMoon(entities, "busy", 10, 10);
        const other = makeMoon(entities, "other", 10, 14);
        // Cargo arrived after local production already covered the order.
        economy.deposit(busy.id, res({ money: 40 }));
        economy.build("alpha", other.id, habitat);

        const dispatched = supply.dispatch();
        expect(dispatched).toMatchObject([
            { originId: busy.id, destinationId: other.id, cargo: res({ money: 40 }) }
        ]);
    });
});

describe("SupplyManager with stockpile caps and build limits", () => {
    const limitedWorld = () => supplyWorld(undefined, defaultEconomyBalance());

    it("sends no more than fits under the destination's cap, counting cargo in flight", () => {
        const { entities, economy, supply } = limitedWorld();
        const source = makeMoon(entities, "source", 0, 10);
        const dest = makeMoon(entities, "dest", 10, 10);
        economy.depositUncapped(source.id, res({ money: 1000, materials: 1000 }));
        economy.deposit(dest.id, res({ materials: 20 }));
        const order = orderId(economy.build("alpha", dest.id, habitat));

        // Habitat needs 50 money and 100 materials; the moon holds 100 money and 50 materials.
        const [ship] = supply.dispatch();
        expect(ship.cargo).toEqual(res({ money: 50, materials: 30 }));
        expect(ship.reservedFor).toEqual([
            { orderId: order, amount: res({ money: 50, materials: 30 }) }
        ]);
        expect(supply.dispatch()).toEqual([]);
    });

    it("sends nothing for orders waiting on a build slot", () => {
        const { entities, economy, supply } = limitedWorld();
        const source = makeMoon(entities, "source", 0, 10);
        const dest = makeMoon(entities, "dest", 10, 10);
        economy.depositUncapped(source.id, res({ money: 1000, materials: 1000, population: 100 }));
        const first = orderId(economy.build("alpha", dest.id, habitat));
        const waiting = orderId(economy.build("alpha", dest.id, mine));
        expect(economy.activeOrders(dest.id).map((o) => o.id)).toEqual([first]);
        const reserved = supply.dispatch().flatMap((s) => s.reservedFor.map((r) => r.orderId));
        expect(reserved).toContain(first);
        expect(reserved).not.toContain(waiting);
    });

    it("keeps a ship waiting at a full destination, unloading what fits each turn", () => {
        const { entities, economy, supply } = limitedWorld();
        const source = makeMoon(entities, "source", 0, 10);
        const dest = makeMoon(entities, "dest", 10, 10);
        economy.deposit(dest.id, res({ money: 60 }));
        const ship = makeSupplyShip(
            entities,
            "late",
            hex(10, 10),
            source.id,
            dest.id,
            res({ money: 80 })
        );
        ship.reservedFor = [{ orderId: "o1", amount: res({ money: 80 }) }];

        const first = supply.move();
        expect(first.arrivals).toEqual([
            {
                supplyShipId: ship.id,
                sideId: "alpha",
                locationId: dest.id,
                cargo: res({ money: 40 }),
                at: hex(10, 10),
                waiting: true
            }
        ]);
        expect(economy.stockpile(dest.id)).toEqual(res({ money: 100 }));
        expect(entities.get(ship.id)).toBe(ship);
        expect(ship).toMatchObject({ cargo: res({ money: 40 }), waiting: true });
        expect(ship.reservedFor).toEqual([{ orderId: "o1", amount: res({ money: 40 }) }]);
        expect(supply.inFlightTo(dest.id)).toEqual(res({ money: 40 }));

        // Still full: nothing unloads and nothing is reported.
        expect(supply.move().arrivals).toEqual([]);
        expect(ship.cargo).toEqual(res({ money: 40 }));

        economy.withdraw(dest.id, res({ money: 70 }));
        const last = supply.move();
        expect(last.arrivals).toMatchObject([{ cargo: res({ money: 40 }), waiting: false }]);
        expect(entities.get(ship.id)).toBeUndefined();
        expect(economy.stockpile(dest.id)).toEqual(res({ money: 70 }));
    });
});

describe("SupplyManager movement", () => {
    it("moves 6 hexes a turn along its route, then unloads at the destination", () => {
        const { entities, economy, supply } = supplyWorld();
        const source = makeMoon(entities, "source", 0, 10);
        const dest = makeMoon(entities, "dest", 15, 10);
        economy.deposit(source.id, res({ money: 50 }));
        economy.build("alpha", dest.id, habitat);
        const [ship] = supply.dispatch();
        expect(ship).toMatchObject({ q: 0, r: 10, speed: 6 });
        expect(ship.route).toHaveLength(15);
        expect(ship.route![0]).toEqual(hex(1, 10));

        const first = supply.move();
        expect(first.moves).toHaveLength(1);
        expect(first.moves[0]).toMatchObject({ from: hex(0, 10), to: hex(6, 10) });
        expect(first.moves[0].path).toHaveLength(6);
        expect(ship).toMatchObject({ q: 6, r: 10 });
        expect(ship.route).toHaveLength(9);
        expect(ship.route![0]).toEqual(hex(7, 10));

        supply.move();
        expect(ship).toMatchObject({ q: 12, r: 10 });
        const last = supply.move();
        expect(last.arrivals).toEqual([
            {
                supplyShipId: ship.id,
                sideId: "alpha",
                locationId: dest.id,
                cargo: res({ money: 50 }),
                at: hex(15, 10),
                waiting: false
            }
        ]);
        expect(entities.get(ship.id)).toBeUndefined();
        expect(economy.stockpile(dest.id)).toEqual(res({ money: 50 }));
    });

    it("moves further once supply speed is researched", () => {
        const { entities, economy, supply } = supplyWorld();
        makeMoon(entities, "source", 0, 10);
        const dest = makeMoon(entities, "dest", 15, 10);
        const ship = makeSupplyShip(entities, "s1", hex(0, 10), "source", dest.id);
        economy.research.add("alpha", "supply_speed_1");
        supply.move();
        expect(ship).toMatchObject({ q: 8, r: 10, speed: 8 });
        // Research completes after movement; dispatch updates ships under way.
        economy.research.add("alpha", "supply_speed_2");
        supply.dispatch();
        expect(economy.stateFor("alpha").supplyShips).toMatchObject([{ id: ship.id, speed: 10 }]);
        supply.move();
        expect(entities.get(ship.id)).toBeUndefined();
        expect(economy.stateFor("alpha")).toMatchObject({ supplySpeed: 10 });
    });

    it("re-plans around known enemy warships every turn", () => {
        const { entities, supply } = supplyWorld();
        makeMoon(entities, "source", 0, 10);
        const dest = makeMoon(entities, "dest", 12, 10);
        makeWarship(entities, "enemy", "beta", 3, 10);
        const ship = makeSupplyShip(entities, "s1", hex(0, 10), "source", dest.id);

        const first = supply.move();
        expect(first.combats).toEqual([]);
        expect(first.moves[0].path).toHaveLength(6);
        expect(first.moves[0].path).not.toContainEqual(hex(3, 10));

        const blocker = makeWarship(
            entities,
            "enemy-2",
            "beta",
            ship.route![0].q,
            ship.route![0].r
        );
        const second = supply.move();
        expect(second.combats).toEqual([]);
        expect(second.moves[0].path).not.toContainEqual(hex(blocker.q, blocker.r));
        expect(ship.route?.some((h) => h.q === blocker.q && h.r === blocker.r)).toBe(false);
    });

    it("waits while its destination is hostile or it has no route", () => {
        const { entities, supply } = supplyWorld();
        makeMoon(entities, "source", 0, 10);
        const dest = makeMoon(entities, "dest", 10, 10);
        const guard = makeWarship(entities, "guard", "beta", 10, 10);
        const ship = makeSupplyShip(entities, "s1", hex(4, 10), "source", dest.id);

        expect(supply.move().moves).toEqual([]);
        expect(ship).toMatchObject({ q: 4, r: 10, route: [] });

        entities.remove(guard.id);
        const ring = axialRange(ship, 1)
            .filter((h) => h.q !== ship.q || h.r !== ship.r)
            .map((h, i) => makeWarship(entities, `ring-${i}`, "beta", h.q, h.r));
        expect(supply.move().moves).toEqual([]);
        expect(ship).toMatchObject({ q: 4, r: 10, route: [] });

        for (const blocker of ring) entities.remove(blocker.id);
        expect(supply.move().arrivals).toHaveLength(1);
    });

    it("heads for the nearest owned location when its destination is lost", () => {
        const { entities, economy, supply } = supplyWorld();
        makeMoon(entities, "source", 0, 10);
        const dest = makeMoon(entities, "dest", 12, 10);
        const nearest = makeMoon(entities, "nearest", 6, 7);
        const ship = makeSupplyShip(entities, "s1", hex(4, 10), "source", dest.id);
        ship.reservedFor = [{ orderId: "order-x", amount: res({ money: 10 }) }];
        dest.sideId = "beta";

        const result = supply.move();
        expect(result.arrivals).toMatchObject([{ supplyShipId: ship.id, locationId: nearest.id }]);
        expect(ship).toMatchObject({ destinationId: nearest.id, reservedFor: [] });
        expect(economy.stockpile(nearest.id)).toEqual(res({ money: 10 }));
        expect(economy.stockpile(dest.id)).toEqual(zeroResources());
    });

    it("stops before enemy warships it didn't know about and routes around known ones", () => {
        const setup = (knowledge?: (sideId: string) => SupplyKnowledge) => {
            const world = supplyWorld(knowledge);
            const { entities } = world;
            makeMoon(entities, "source", 0, 10);
            const dest = makeMoon(entities, "dest", 10, 10);
            makeWarship(entities, "enemy", "beta", 4, 10);
            const ship = makeSupplyShip(entities, "s1", hex(0, 10), "source", dest.id);
            return { ...world, ship };
        };

        const unaware = setup(blind);
        const result = unaware.supply.move();
        expect(unaware.ship).toMatchObject({ q: 3, r: 10 });
        expect(unaware.ship.route![0]).toEqual(hex(4, 10));
        expect(result.combats).toHaveLength(1);

        const aware = setup();
        const around = aware.supply.move();
        expect(around.combats).toEqual([]);
        expect(around.moves[0].path).toHaveLength(6);
        expect(around.moves[0].path).not.toContainEqual(hex(4, 10));
    });

    it("risks a remembered enemy sighting rather than waiting forever on the only route", () => {
        const map = createEmptyMap({ width: 30, height: 30, hexSize: 50, seed: 1 });
        const entities = new EntityManager(map);
        // A wall of rocks down column 15 with a single gap at 10,10.
        for (let row = 0; row < map.height; row++) {
            const at = offsetToAxial(15, row);
            if (at.q === 10 && at.r === 10) continue;
            entities.add<EntityOf<"large_asteroid">>({
                id: `rock-${row}`,
                kind: "large_asteroid",
                sideId: null,
                systemId: "sys-1",
                q: at.q,
                r: at.r
            });
        }
        makeMoon(entities, "source", 2, 10);
        const dest = makeMoon(entities, "dest", 18, 10);
        const enemy = makeWarship(entities, "enemy", "beta", 10, 10);
        const side = new Side("alpha");
        side.recomputeVisibility(entities, 2);
        side.exploreAll(entities);
        // The enemy leaves unseen; alpha still remembers it in the gap.
        entities.remove(enemy.id);
        expect(side.knowsEnemyAt(entities, hex(10, 10))).toBe(true);

        const economy = new EconomyManager(entities, ["alpha", "beta"], {
            balance: unlimitedBalance()
        });
        const supply = new SupplyManager(entities, economy, {
            knowledge: () => ({
                isObstacle: (h) => side.knowsObstacleAt(entities, h),
                isHostile: (h) => side.knowsEnemyAt(entities, h),
                isVisible: (h) => side.seesAll([h])
            })
        });
        const ship = makeSupplyShip(entities, "s1", hex(2, 10), "source", dest.id);
        side.recomputeVisibility(entities, 2);

        let arrived = false;
        for (let turn = 0; turn < 4 && !arrived; turn++) {
            arrived = supply.move().arrivals.length > 0;
            side.recomputeVisibility(entities, 2);
        }
        expect(arrived).toBe(true);
        expect(entities.get(ship.id)).toBeUndefined();
        expect(economy.stockpile(dest.id)).toEqual(res({ money: 10 }));
    });
});

describe("SupplyManager combat", () => {
    it("loses its cargo when destroyed by an attacking warship, which moves in", () => {
        const { entities, economy, battles, supply } = supplyWorld();
        const source = makeMoon(entities, "source", 0, 10);
        const dest = makeMoon(entities, "dest", 12, 10);
        economy.deposit(source.id, res({ money: 1000, materials: 1000 }));
        economy.build("alpha", dest.id, habitat);
        const convoy = supply.dispatch();
        supply.move();
        expect(convoy.map((s) => axialKey(s.q, s.r))).toEqual([axialKey(6, 10), axialKey(6, 10)]);
        for (const ship of convoy) ship.hp = 1;

        const raider = makeWarship(entities, "raider", "beta", 8, 10);
        const moved = battles.moveShip("beta", raider.id, hex(6, 10));
        expect(moved.ok && moved.combat).toMatchObject({
            attackerSideId: "beta",
            defenderSideIds: ["alpha"],
            outcome: "attacker_won",
            attackerMovedIn: true,
            destroyedIds: convoy.map((s) => s.id)
        });
        expect(raider).toMatchObject({ q: 6, r: 10 });
        expect(supply.shipsOf("alpha")).toEqual([]);
        expect(supply.inFlightTo(dest.id)).toEqual(zeroResources());

        // The cargo is gone, so the demand is dispatched again from the source.
        expect(economy.stockpile(source.id)).toEqual(res({ money: 950, materials: 900 }));
        expect(supply.dispatch()).toHaveLength(2);
        expect(economy.stockpile(source.id)).toEqual(res({ money: 900, materials: 800 }));
    });

    it("survives an ambush damaged, stopping before the ambushers", () => {
        const { entities, supply } = supplyWorld(blind);
        makeMoon(entities, "source", 0, 10);
        const dest = makeMoon(entities, "dest", 10, 10);
        const lurker = makeWarship(entities, "lurker", "beta", 3, 10);
        const ship = makeSupplyShip(entities, "s1", hex(0, 10), "source", dest.id);

        const result = supply.move();
        expect(ship).toMatchObject({ q: 2, r: 10, hp: 2 });
        expect(result.arrivals).toEqual([]);
        expect(result.combats).toEqual([
            expect.objectContaining({
                kind: "space",
                cause: "ambush",
                hex: hex(2, 10),
                from: hex(3, 10),
                attackerSideId: "beta",
                defenderSideIds: ["alpha"],
                outcome: "inconclusive",
                attackerMovedIn: false,
                destroyedIds: []
            })
        ]);
        expect(result.combats[0]!.participants.map((p) => [p.id, p.role])).toEqual([
            [lurker.id, "attacker"],
            [ship.id, "defender"]
        ]);
        expect(lurker).toMatchObject({ q: 3, r: 10 });
    });

    it("is destroyed by an ambush, losing its cargo", () => {
        const { entities, economy, supply } = supplyWorld(blind);
        makeMoon(entities, "source", 0, 10);
        const dest = makeMoon(entities, "dest", 10, 10);
        makeWarship(entities, "lurker-1", "beta", 3, 10);
        makeWarship(entities, "lurker-2", "beta", 3, 10);
        const ship = makeSupplyShip(entities, "s1", hex(0, 10), "source", dest.id);

        const result = supply.move();
        expect(result.combats).toMatchObject([
            { outcome: "attacker_won", destroyedIds: [ship.id], rounds: 2 }
        ]);
        expect(entities.get(ship.id)).toBeUndefined();
        expect(supply.move().moves).toEqual([]);
        expect(economy.stockpile(dest.id)).toEqual(zeroResources());
    });

    it("evades ambushes more often with evasive manoeuvres", () => {
        const ambush = (techs: boolean) => {
            const world = supplyWorld(blind, unlimitedBalance(), () => 0.4);
            if (techs) world.economy.research.add("alpha", "evasive_manoeuvres_1");
            makeMoon(world.entities, "source", 0, 10);
            const dest = makeMoon(world.entities, "dest", 10, 10);
            makeWarship(world.entities, "lurker", "beta", 3, 10);
            const ship = makeSupplyShip(world.entities, "s1", hex(0, 10), "source", dest.id);
            const [combat] = world.supply.move().combats;
            return { ship, defender: combat!.participants[1]! };
        };

        // Base evasion 0.3: a 0.4 roll hits for round(4 * 0.95 * 10 / 11) = 3.
        const plain = ambush(false);
        expect(plain.defender).toMatchObject({ evaded: false, damageTaken: 3 });
        expect(plain.ship.hp).toBe(3);

        // Evasive manoeuvres I adds 0.15: the same roll misses.
        const evasive = ambush(true);
        expect(evasive.defender).toMatchObject({ evaded: true, damageTaken: 0 });
        expect(evasive.ship.hp).toBeUndefined();
        expect(evasive.ship).toMatchObject({ q: 2, r: 10 });
    });
});

describe("SupplyManager population returns", () => {
    function populationWorld(frigateAt: AxialCoord) {
        const map = createEmptyMap({ width: 30, height: 30, hexSize: 50, seed: 1 });
        const entities = new EntityManager(map);
        const home = entities.add<EntityOf<"planet">>({
            id: "home",
            kind: "planet",
            sideId: "alpha",
            systemId: "sys-1",
            q: 0,
            r: 10,
            level: 10
        });
        const outpost = makeMoon(entities, "outpost", 15, 12);
        const frigate = makeWarship(entities, "frigate", "alpha", frigateAt.q, frigateAt.r);
        const economy = new EconomyManager(entities, ["alpha", "beta"], {
            balance: unlimitedBalance()
        });
        const supply = new SupplyManager(entities, economy);
        const destroyFrigate = () => {
            destroyVessels(entities, economy, [frigate]);
            expect(entities.get(frigate.id)).toBeUndefined();
        };
        return { entities, economy, supply, home, outpost, frigate, destroyFrigate };
    }
    const crew = DEFAULTS.ships.frigate.cost.population;

    it("ships a destroyed ship's crew home from the nearest owned location", () => {
        const world = populationWorld(hex(14, 10));
        const { entities, economy, supply, home, outpost } = world;
        expect(economy.shipCrewOrigin(world.frigate.id)).toBe(home.id);
        world.destroyFrigate();

        const [ship] = supply.returnPopulation();
        expect(ship).toMatchObject({
            originId: outpost.id,
            destinationId: home.id,
            q: outpost.q,
            r: outpost.r,
            cargo: res({ population: crew }),
            reservedFor: []
        });
        for (let turn = 0; turn < 3 && entities.get(ship.id); turn++) supply.move();
        expect(entities.get(ship.id)).toBeUndefined();
        expect(economy.stockpile(home.id)).toEqual(
            addResources(DEFAULTS.startingStockpile, { population: crew })
        );
    });

    it("deposits directly when home is the nearest owned location", () => {
        const world = populationWorld(hex(2, 10));
        world.destroyFrigate();
        expect(world.supply.returnPopulation()).toEqual([]);
        expect(world.economy.stockpile(world.home.id)).toEqual(
            addResources(DEFAULTS.startingStockpile, { population: crew })
        );
    });

    it("goes to the nearest owned location when home was lost", () => {
        const world = populationWorld(hex(14, 10));
        world.home.sideId = "beta";
        world.destroyFrigate();
        expect(world.supply.returnPopulation()).toEqual([]);
        expect(world.economy.stockpile(world.outpost.id)).toEqual(res({ population: crew }));
    });

    it("returns a demolished installation's population", () => {
        const { economy, supply, outpost } = populationWorld(hex(14, 10));
        economy.deposit(outpost.id, res({ money: 100, population: 10 }));
        economy.build("alpha", outpost.id, mine);
        economy.fund();
        economy.fund();
        economy.completeReady();
        const [installation] = economy.locationEconomy(outpost.id)!.installations;
        expect(installation).toMatchObject({ type: "mine", populationFrom: outpost.id });
        expect(economy.stockpile(outpost.id)).toEqual(zeroResources());

        expect(economy.demolish("beta", outpost.id, installation.id).ok).toBe(false);
        expect(economy.demolish("alpha", outpost.id, installation.id).ok).toBe(true);
        expect(economy.locationEconomy(outpost.id)!.installations).toEqual([]);
        expect(supply.returnPopulation()).toEqual([]);
        expect(economy.stockpile(outpost.id)).toEqual(res({ population: 10 }));
    });
});
