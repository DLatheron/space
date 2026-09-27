import { axialDistance, axialKey } from "@space/maths";
import { EntitySummary, SHIP_TYPES } from "@space/shared-data";
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
});

describe("validateShipMove / moveShip", () => {
    it("rejects unknown, foreign, off-map and out-of-range moves", () => {
        const { entities, alphaShip } = smallWorld();
        expect(validateShipMove(entities, "alpha", "nope", { q: 0, r: 0 }).ok).toBe(false);
        expect(validateShipMove(entities, "beta", alphaShip.id, { q: 3, r: 5 }).ok).toBe(false);
        expect(validateShipMove(entities, null, alphaShip.id, { q: 3, r: 5 }).ok).toBe(false);
        expect(validateShipMove(entities, "alpha", alphaShip.id, { q: -50, r: 5 }).ok).toBe(false);
        expect(
            validateShipMove(entities, "alpha", alphaShip.id, { q: alphaShip.q + 4, r: 5 }).ok
        ).toBe(false);
    });

    it("moves, deducts MP per hex and updates tile stacks", () => {
        const { entities, alphaShip } = smallWorld();
        const from = { q: alphaShip.q, r: alphaShip.r };
        const to = { q: from.q + 2, r: from.r };
        const result = moveShip(entities, "alpha", alphaShip.id, to);
        expect(result.ok).toBe(true);
        expect(alphaShip).toMatchObject({ ...to, movementPoints: 1 });
        expect(entities.entitiesAt(from.q, from.r)).toHaveLength(0);
        expect(entities.entitiesAt(to.q, to.r).map((e) => e.id)).toEqual([alphaShip.id]);
        expect(moveShip(entities, "alpha", alphaShip.id, { q: to.q + 2, r: to.r }).ok).toBe(false);
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
