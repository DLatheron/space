import { axialKey } from "@space/maths";
import type { AxialCoord, ShipType } from "@space/shared-data";
import { defaultEconomyBalance } from "../config/config.schema.js";
import { BattleManager } from "./Battle.js";
import { EntityManager } from "./EntityManager.js";
import { HyperspaceManager } from "./HyperspaceManager.js";
import { createEmptyMap } from "./map/SpaceMap.js";
import type { EntityOf } from "./map/types.js";
import { MoveOrderManager, type MoveOrderKnowledge } from "./MoveOrderManager.js";
import { TurnManager } from "./TurnManager.js";

function makeShip(
    id: string,
    sideId: string,
    at: AxialCoord,
    mp = 3,
    shipType: ShipType = "frigate"
): EntityOf<"ship"> {
    return {
        id,
        kind: "ship",
        shipType,
        sideId,
        q: at.q,
        r: at.r,
        facing: 0,
        movementPoints: mp,
        maxMovementPoints: mp
    };
}

function orderWorld(knowledge?: (sideId: string) => MoveOrderKnowledge) {
    const map = createEmptyMap({ width: 30, height: 20, hexSize: 50, seed: 1 });
    const entities = new EntityManager(map);
    const battles = new BattleManager(entities);
    const orders = new MoveOrderManager(entities, { knowledge });
    const balance = defaultEconomyBalance();
    balance.hyperspace.rangeFraction.base = 1;
    const hyperspace = new HyperspaceManager(entities, { battles, balance, rng: () => 0 });
    const turns = new TurnManager(["alpha", "beta"], entities, undefined, undefined, {
        moveOrders: orders,
        hyperspace
    });
    const ship = entities.add(makeShip("ship-a", "alpha", { q: 2, r: 5 }));
    const endTurn = () => {
        turns.endTurn("alpha");
        return turns.endTurn("beta");
    };
    return { map, entities, battles, orders, hyperspace, turns, ship, endTurn };
}

const row = (r: number, from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, i) => ({ q: from + i, r }));

describe("move orders", () => {
    it("moves as far as movement allows now and stores the rest as an order", () => {
        const { battles, ship } = orderWorld();
        const result = battles.moveShip("alpha", ship.id, { q: 10, r: 5 });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.move?.path).toEqual(row(5, 3, 5));
        expect(ship).toMatchObject({ q: 5, r: 5, movementPoints: 0 });
        expect(result.moveOrder).toEqual({ destination: { q: 10, r: 5 }, route: row(5, 6, 10) });
        expect(ship.moveOrder).toEqual(result.moveOrder);
    });

    it("clears the order when a manual move reaches its destination", () => {
        const { battles, ship } = orderWorld();
        battles.moveShip("alpha", ship.id, { q: 10, r: 5 });
        ship.movementPoints = 3;
        const result = battles.moveShip("alpha", ship.id, { q: 6, r: 5 });
        expect(result.ok && result.moveOrder).toBeNull();
        expect(ship.moveOrder).toBeUndefined();
    });

    it("only stores an order when the ship has no movement left", () => {
        const { battles, ship } = orderWorld();
        ship.movementPoints = 0;
        const result = battles.moveShip("alpha", ship.id, { q: 6, r: 5 });
        expect(result.ok && result.move).toBeNull();
        expect(ship).toMatchObject({ q: 2, r: 5 });
        expect(ship.moveOrder).toEqual({ destination: { q: 6, r: 5 }, route: row(5, 3, 6) });
    });

    it("runs orders at end of turn after restoring movement, clearing them on arrival", () => {
        const { battles, ship, endTurn } = orderWorld();
        battles.moveShip("alpha", ship.id, { q: 10, r: 5 });

        const first = endTurn();
        expect(first.orders?.moves).toEqual([
            { ship, from: { q: 5, r: 5 }, to: { q: 8, r: 5 }, path: row(5, 6, 8) }
        ]);
        expect(ship).toMatchObject({ q: 8, r: 5, movementPoints: 0 });
        expect(ship.moveOrder).toEqual({ destination: { q: 10, r: 5 }, route: row(5, 9, 10) });

        const second = endTurn();
        expect(second.orders?.moves[0]?.path).toEqual(row(5, 9, 10));
        expect(second.orders?.arrived).toEqual([ship.id]);
        expect(ship).toMatchObject({ q: 10, r: 5, movementPoints: 1 });
        expect(ship.moveOrder).toBeUndefined();
    });

    it("stops before enemy ships without attacking and keeps the order", () => {
        const { entities, battles, ship, endTurn } = orderWorld();
        ship.movementPoints = 0;
        battles.moveShip("alpha", ship.id, { q: 10, r: 5 });
        const enemy = entities.add(makeShip("ship-b", "beta", { q: 4, r: 5 }));

        const result = endTurn();
        expect(result.orders?.moves[0]?.path).toEqual([{ q: 3, r: 5 }]);
        expect(ship).toMatchObject({ q: 3, r: 5 });
        expect(ship.moveOrder?.destination).toEqual({ q: 10, r: 5 });
        expect(enemy.hp).toBeUndefined();
        expect(ship.hp).toBeUndefined();

        // Still blocked: the ship waits and keeps its order.
        expect(endTurn().orders?.moves).toEqual([]);
        expect(ship.moveOrder?.destination).toEqual({ q: 10, r: 5 });

        entities.remove(enemy.id);
        endTurn();
        expect(ship).toMatchObject({ q: 6, r: 5 });
    });

    it("re-plans each turn around obstacles the side knows about", () => {
        const { entities, battles, ship, endTurn } = orderWorld();
        battles.moveShip("alpha", ship.id, { q: 10, r: 5 });
        entities.add<EntityOf<"planet">>({
            id: "planet-1",
            kind: "planet",
            sideId: null,
            systemId: "sys-1",
            q: 6,
            r: 5,
            level: 3
        });
        const result = endTurn();
        expect(result.orders?.moves[0]?.path).not.toContainEqual({ q: 6, r: 5 });
        expect(ship.moveOrder?.route).not.toContainEqual({ q: 6, r: 5 });
    });

    it("refuses unexplored destinations and routes only through explored hexes", () => {
        const explored = new Set(
            [...row(5, 0, 10), ...row(6, 0, 10)].map((h) => axialKey(h.q, h.r))
        );
        const knowledge = {
            isExplored: (hex: AxialCoord) => explored.has(axialKey(hex.q, hex.r))
        };
        const { battles, ship } = orderWorld();
        expect(battles.moveShip("alpha", ship.id, { q: 12, r: 5 }, knowledge)).toEqual({
            ok: false,
            error: "Destination 12,5 is unexplored"
        });
        expect(battles.moveShip("alpha", ship.id, { q: 4, r: 3 }, knowledge).ok).toBe(false);

        // A planet blocks row 5, so the route detours through explored row 6, never row 4.
        const blocked = (hex: AxialCoord) => hex.q === 5 && hex.r === 5;
        const result = battles.moveShip(
            "alpha",
            ship.id,
            { q: 8, r: 5 },
            {
                ...knowledge,
                isObstacle: blocked
            }
        );
        expect(result.ok).toBe(true);
        const route = [
            ...(result.ok ? (result.move?.path ?? []) : []),
            ...(ship.moveOrder?.route ?? [])
        ];
        expect(route.every((hex) => explored.has(axialKey(hex.q, hex.r)))).toBe(true);
        expect(route).not.toContainEqual({ q: 5, r: 5 });
    });

    it("re-plans with the side's knowledge at end of turn", () => {
        let open = false;
        const knowledge = () => ({
            isExplored: (hex: AxialCoord) => open || hex.r === 5
        });
        const { battles, ship, endTurn } = orderWorld(knowledge);
        battles.moveShip("alpha", ship.id, { q: 10, r: 5 }, knowledge());
        ship.moveOrder = { destination: { q: 10, r: 8 } };
        // Unexplored destination: no known route, so the ship waits with its order.
        expect(endTurn().orders?.moves).toEqual([]);
        expect(ship.moveOrder.destination).toEqual({ q: 10, r: 8 });
        open = true;
        expect(endTurn().orders?.moves).toHaveLength(1);
    });

    it("re-plans around obstacles the side learns about after the order was made", () => {
        const known = new Set<string>();
        const knowledge = () => ({
            isObstacle: (hex: AxialCoord) => known.has(axialKey(hex.q, hex.r))
        });
        const { battles, ship, endTurn } = orderWorld(knowledge);
        battles.moveShip("alpha", ship.id, { q: 12, r: 5 }, knowledge());
        expect(ship.moveOrder?.route).toEqual(row(5, 6, 12));

        known.add(axialKey(7, 5));
        const result = endTurn();
        const path = result.orders?.moves[0]?.path ?? [];
        expect(path).toHaveLength(3);
        expect([...path, ...(ship.moveOrder?.route ?? [])]).not.toContainEqual({ q: 7, r: 5 });
        expect(ship.moveOrder?.destination).toEqual({ q: 12, r: 5 });
    });

    it("stops before enemy supply ships too", () => {
        const { entities, battles, ship, endTurn } = orderWorld();
        ship.movementPoints = 0;
        battles.moveShip("alpha", ship.id, { q: 10, r: 5 });
        entities.add<EntityOf<"supply_ship">>({
            id: "supply-b",
            kind: "supply_ship",
            name: "Supply B",
            sideId: "beta",
            q: 4,
            r: 5,
            facing: 0,
            originId: "home-b",
            destinationId: "home-b",
            cargo: { money: 0, materials: 0, population: 0, science: 0 },
            reservedFor: [],
            speed: 6,
            capacity: 100
        });
        endTurn();
        expect(ship).toMatchObject({ q: 3, r: 5 });
        expect(ship.moveOrder?.destination).toEqual({ q: 10, r: 5 });
    });

    it("waits before enemies at its destination without attacking, then arrives once they leave", () => {
        const { entities, battles, ship, endTurn } = orderWorld();
        ship.movementPoints = 0;
        battles.moveShip("alpha", ship.id, { q: 5, r: 5 });
        const enemy = entities.add(makeShip("ship-b", "beta", { q: 5, r: 5 }, 3, "scout"));

        const waiting = endTurn();
        expect(waiting.orders?.moves[0]?.path).toEqual(row(5, 3, 4));
        expect(ship).toMatchObject({ q: 4, r: 5 });
        expect(ship.moveOrder?.destination).toEqual({ q: 5, r: 5 });
        expect(endTurn().orders?.moves).toEqual([]);
        expect(ship.moveOrder?.destination).toEqual({ q: 5, r: 5 });
        expect(enemy.hp).toBeUndefined();

        entities.remove(enemy.id);
        const arrived = endTurn();
        expect(arrived.orders?.arrived).toEqual([ship.id]);
        expect(ship).toMatchObject({ q: 5, r: 5 });
        expect(ship.moveOrder).toBeUndefined();
    });

    it("drops the order of a ship that has a jump pending", () => {
        const { hyperspace, orders, ship } = orderWorld();
        hyperspace.activate("alpha", ship.id, { q: 15, r: 10 });
        ship.moveOrder = { destination: { q: 10, r: 5 } };
        expect(orders.run()).toEqual({ moves: [], arrived: [] });
        expect(ship.moveOrder).toBeUndefined();
        expect(ship).toMatchObject({ q: 2, r: 5 });
    });

    it("cancels orders for the owning side only", () => {
        const { battles, orders, ship } = orderWorld();
        expect(orders.cancel("alpha", ship.id).ok).toBe(false);
        battles.moveShip("alpha", ship.id, { q: 10, r: 5 });
        expect(orders.cancel("beta", ship.id).ok).toBe(false);
        expect(orders.cancel(null, ship.id).ok).toBe(false);
        expect(orders.cancel("alpha", "nope").ok).toBe(false);
        expect(orders.cancel("alpha", ship.id)).toEqual({ ok: true });
        expect(ship.moveOrder).toBeUndefined();
    });

    it("rejects moves while a jump is pending; engaging the hyperdrive clears the order", () => {
        const { battles, hyperspace, ship } = orderWorld();
        battles.moveShip("alpha", ship.id, { q: 10, r: 5 });
        expect(hyperspace.activate("alpha", ship.id, { q: 15, r: 10 })).toEqual({ ok: true });
        expect(ship.moveOrder).toBeUndefined();
        ship.movementPoints = 3;
        expect(battles.moveShip("alpha", ship.id, { q: 6, r: 5 })).toEqual({
            ok: false,
            error: `Ship ${ship.id} is preparing a hyperspace jump`
        });
        expect(hyperspace.cancel("alpha", ship.id).ok).toBe(true);
        expect(battles.moveShip("alpha", ship.id, { q: 6, r: 5 }).ok).toBe(true);
    });
});
