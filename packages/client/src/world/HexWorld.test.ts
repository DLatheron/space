import { axialToPixel } from "@space/maths";
import type { EconomyBalance, EconomyState, EntitySummary } from "@space/shared-data";
import { describe, expect, it } from "vitest";
import { HexWorld } from "./HexWorld.js";

const canvas = { width: 800, height: 600 } as HTMLCanvasElement;

const ship = (
    id: string,
    q: number,
    r: number,
    extra: Partial<Extract<EntitySummary, { kind: "ship" }>> = {}
): EntitySummary => ({
    id,
    kind: "ship",
    shipType: "scout",
    facing: 0,
    sideId: "alpha",
    q,
    r,
    movementPoints: 30,
    maxMovementPoints: 30,
    ...extra
});

const planet: EntitySummary = {
    id: "planet-1",
    kind: "planet",
    sideId: "alpha",
    systemId: "sys-1",
    level: 3,
    q: 2,
    r: 2
};

function makeWorld(entities: EntitySummary[]): HexWorld {
    const world = new HexWorld();
    const tiles = [];
    for (let q = 0; q < 5; q++) {
        for (let r = 0; r < 5; r++) {
            tiles.push({
                q,
                r,
                fog: "visible" as const,
                entities: entities.filter((e) => e.q === q && e.r === r)
            });
        }
    }
    world.applyMapInit({
        width: 8,
        height: 8,
        hexSize: 50,
        sideId: "alpha",
        tiles,
        visible: tiles.map((t) => `${t.q},${t.r}` as const),
        turn: { turn: 1, sideReady: {} } as never,
        battles: [],
        groundBattles: [],
        economy: {} as EconomyState,
        balance: null as unknown as EconomyBalance
    });
    return world;
}

function click(world: HexWorld, q: number, r: number) {
    return world.handleClick(world.worldToScreen(axialToPixel(q, r, 50), canvas), canvas);
}

describe("HexWorld.handleClick", () => {
    it("cycles from our ship to the planet sharing its hex and back", () => {
        const world = makeWorld([planet, ship("ship-1", 2, 2)]);

        expect(click(world, 2, 2)).toEqual({ type: "select", shipId: "ship-1" });
        expect(click(world, 2, 2)).toEqual({ type: "inspect", entityId: "planet-1" });
        expect(world.selectedShipId).toBeNull();
        expect(world.inspectedEntityId).toBe("planet-1");
        expect(world.mapFocus).toMatchObject({ mode: "selection", entity: { id: "planet-1" } });
        expect(click(world, 2, 2)).toEqual({ type: "select", shipId: "ship-1" });
    });

    it("still moves the selected ship when another hex is clicked", () => {
        const world = makeWorld([planet, ship("ship-1", 2, 2)]);
        click(world, 2, 2);
        expect(click(world, 3, 2)).toEqual({
            type: "move",
            shipId: "ship-1",
            to: { q: 3, r: 2 }
        });
    });

    it("opens a lone planet and deselects a lone ship on a second click", () => {
        const world = makeWorld([planet, ship("ship-1", 1, 1)]);
        expect(click(world, 2, 2)).toEqual({ type: "open-location", locationId: "planet-1" });
        expect(click(world, 1, 1)).toEqual({ type: "select", shipId: "ship-1" });
        expect(click(world, 1, 1)).toEqual({ type: "deselect" });
    });

    it("sends a long-range move to an explored hex beyond this turn's movement", () => {
        const world = makeWorld([planet, ship("ship-1", 0, 0, { movementPoints: 1 })]);
        click(world, 0, 0);
        expect(click(world, 4, 4)).toEqual({ type: "move", shipId: "ship-1", to: { q: 4, r: 4 } });
        // A far location is a destination too while a ship is selected.
        expect(click(world, 2, 2)).toEqual({ type: "move", shipId: "ship-1", to: { q: 2, r: 2 } });
    });

    it("stores a move order even with no movement left", () => {
        const world = makeWorld([ship("ship-1", 0, 0, { movementPoints: 0 })]);
        click(world, 0, 0);
        expect(click(world, 3, 1)).toEqual({ type: "move", shipId: "ship-1", to: { q: 3, r: 1 } });
    });

    it("rejects moves into unexplored hexes without changing the selection", () => {
        const world = makeWorld([ship("ship-1", 1, 1)]);
        click(world, 1, 1);
        expect(click(world, 6, 2)).toMatchObject({ type: "rejected" });
        expect(world.selectedShipId).toBe("ship-1");
    });

    it("rejects normal moves while the hyperdrive is charging", () => {
        const world = makeWorld([ship("ship-1", 1, 1, { hyperdriveCharging: true })]);
        click(world, 1, 1);
        expect(click(world, 2, 1)).toMatchObject({ type: "rejected" });
    });

    it("previews routes through explored hexes only", () => {
        const world = makeWorld([ship("ship-1", 0, 0)]);
        click(world, 0, 0);
        expect(world.previewRoute({ q: 3, r: 0 })).toEqual([
            { q: 1, r: 0 },
            { q: 2, r: 0 },
            { q: 3, r: 0 }
        ]);
        expect(world.previewRoute({ q: 6, r: 0 })).toBeNull();
    });
});

describe("HexWorld server events", () => {
    it("moves a jumper to its landing hex and drops ships destroyed by the jump", () => {
        const enemy = { ...ship("enemy-1", 3, 3), sideId: "beta" } as EntitySummary;
        const world = makeWorld([
            ship("ship-1", 1, 1, {
                hyperjump: { target: { q: 3, r: 3 } },
                hyperdriveCharging: true
            }),
            enemy
        ]);
        world.applyShipJumped({
            shipId: "ship-1",
            from: { q: 1, r: 1 },
            to: { q: 3, r: 3 },
            outcome: "arrived",
            collidedWithId: "enemy-1",
            destroyedIds: ["enemy-1"]
        });
        const jumper = world.findEntity("ship-1", "ship");
        expect(jumper).toMatchObject({ q: 3, r: 3 });
        expect(jumper?.hyperjump).toBeUndefined();
        expect(jumper?.hyperdriveCharging).toBeUndefined();
        expect(world.findEntityById("enemy-1")).toBeUndefined();
    });

    it("trims the walked part of a move order on each step", () => {
        const route = [
            { q: 1, r: 0 },
            { q: 2, r: 0 },
            { q: 3, r: 0 }
        ];
        const world = makeWorld([
            ship("ship-1", 0, 0, { moveOrder: { destination: { q: 3, r: 0 }, route } })
        ]);
        const step = (to: { q: number; r: number }) =>
            world.applyShipMoved({
                shipId: "ship-1",
                from: { q: 0, r: 0 },
                to,
                path: [to],
                facing: 0,
                movementPoints: 0
            });
        step({ q: 2, r: 0 });
        expect(world.findEntity("ship-1", "ship")?.moveOrder?.route).toEqual([{ q: 3, r: 0 }]);
        step({ q: 3, r: 0 });
        expect(world.findEntity("ship-1", "ship")?.moveOrder).toBeUndefined();
    });
});

describe("HexWorld hyperjump targeting", () => {
    it("sends the next click on an explored hex as the jump target", () => {
        const world = makeWorld([planet, ship("ship-1", 1, 1)]);
        world.startHyperjumpTargeting("ship-1");
        expect(world.selectedShipId).toBe("ship-1");
        expect(world.hyperjumpTargeting?.id).toBe("ship-1");

        expect(click(world, 2, 2)).toEqual({
            type: "hyperjump",
            shipId: "ship-1",
            target: { q: 2, r: 2 }
        });
        expect(world.hyperjumpTargeting).toBeUndefined();
        expect(world.selectedShipId).toBe("ship-1");
    });

    it("stays in targeting mode after clicks on unexplored hexes or the ship's own hex", () => {
        const world = makeWorld([ship("ship-1", 1, 1), ship("ship-2", 3, 3)]);
        world.startHyperjumpTargeting("ship-1");
        expect(click(world, 6, 1)).toMatchObject({ type: "rejected" });
        expect(click(world, 1, 1)).toMatchObject({ type: "rejected" });
        expect(world.hyperjumpTargeting?.id).toBe("ship-1");
        // Another of our ships' hexes is a target rather than a selection.
        expect(click(world, 3, 3)).toEqual({
            type: "hyperjump",
            shipId: "ship-1",
            target: { q: 3, r: 3 }
        });
        expect(world.selectedShipId).toBe("ship-1");
    });

    it("leaves targeting on cancel or when the selection changes", () => {
        const world = makeWorld([ship("ship-1", 1, 1), ship("ship-2", 3, 3)]);
        world.startHyperjumpTargeting("ship-1");
        world.cancelHyperjumpTargeting();
        expect(world.hyperjumpTargeting).toBeUndefined();
        expect(click(world, 2, 1)).toEqual({ type: "move", shipId: "ship-1", to: { q: 2, r: 1 } });

        world.startHyperjumpTargeting("ship-1");
        world.selectShip("ship-2");
        expect(world.hyperjumpTargetingId).toBeNull();
    });
});
