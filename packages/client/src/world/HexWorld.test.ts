import { axialToPixel } from "@space/maths";
import type { EconomyBalance, EconomyState, EntitySummary } from "@space/shared-data";
import { describe, expect, it } from "vitest";
import { HexWorld } from "./HexWorld.js";

const canvas = { width: 800, height: 600 } as HTMLCanvasElement;

const ship = (id: string, q: number, r: number): EntitySummary => ({
    id,
    kind: "ship",
    shipType: "scout",
    facing: 0,
    sideId: "alpha",
    q,
    r,
    movementPoints: 30,
    maxMovementPoints: 30
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
});
