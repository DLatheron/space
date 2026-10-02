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

function makeWorld(entities: EntitySummary[], balance?: EconomyBalance): HexWorld {
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
        economy: {} as EconomyState,
        balance: balance ?? (null as unknown as EconomyBalance)
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
        // Reachable this turn: stays selected to spend any movement left.
        expect(world.selectedShipId).toBe("ship-1");
    });

    it("opens a lone planet and keeps a lone ship selected on a second click", () => {
        const world = makeWorld([planet, ship("ship-1", 1, 1)]);
        expect(click(world, 2, 2)).toEqual({ type: "open-location", locationId: "planet-1" });
        expect(click(world, 1, 1)).toEqual({ type: "select", shipId: "ship-1" });
        expect(click(world, 1, 1)).toEqual({ type: "none" });
        expect(world.selectedShipId).toBe("ship-1");
    });

    it("orders the selected ship onto hexes holding our other ships and locations", () => {
        const world = makeWorld([planet, ship("ship-1", 1, 1), ship("ship-2", 3, 1)]);
        click(world, 1, 1);
        expect(click(world, 3, 1)).toEqual({ type: "move", shipId: "ship-1", to: { q: 3, r: 1 } });
        expect(world.selectedShipId).toBe("ship-1");
        expect(click(world, 2, 2)).toEqual({ type: "move", shipId: "ship-1", to: { q: 2, r: 2 } });
        expect(world.selectedShipId).toBe("ship-1");

        // Selecting elsewhere takes a deselect (Escape) first.
        world.selectShip(null);
        expect(click(world, 3, 1)).toEqual({ type: "select", shipId: "ship-2" });
    });

    it("cycles through everything on the selected ship's hex", () => {
        const world = makeWorld([planet, ship("ship-1", 2, 2), ship("ship-2", 2, 2)]);
        expect(click(world, 2, 2)).toEqual({ type: "select", shipId: "ship-1" });
        expect(click(world, 2, 2)).toEqual({ type: "select", shipId: "ship-2" });
        expect(click(world, 2, 2)).toEqual({ type: "inspect", entityId: "planet-1" });
        expect(click(world, 2, 2)).toEqual({ type: "select", shipId: "ship-1" });
    });

    it("only inspects planets we don't own", () => {
        const unclaimed = { ...planet, id: "planet-2", sideId: null, q: 3, r: 3 } as EntitySummary;
        const enemy = { ...planet, id: "planet-3", sideId: "beta", q: 4, r: 4 } as EntitySummary;
        const world = makeWorld([unclaimed, enemy]);
        expect(click(world, 3, 3)).toEqual({ type: "inspect", entityId: "planet-2" });
        expect(click(world, 4, 4)).toEqual({ type: "inspect", entityId: "planet-3" });
    });

    it("sends a long-range move to an explored hex beyond this turn's movement", () => {
        const world = makeWorld([planet, ship("ship-1", 0, 0, { movementPoints: 1 })]);
        click(world, 0, 0);
        expect(click(world, 4, 4)).toEqual({ type: "move", shipId: "ship-1", to: { q: 4, r: 4 } });
        // Leaving a standing order deselects the ship.
        expect(world.selectedShipId).toBeNull();
        // A far location is a destination too while a ship is selected.
        click(world, 0, 0);
        expect(click(world, 2, 2)).toEqual({ type: "move", shipId: "ship-1", to: { q: 2, r: 2 } });
        expect(world.selectedShipId).toBeNull();
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

    it("places a displaced jumper at its refuge hex", () => {
        const world = makeWorld([ship("ship-1", 1, 1, { hyperjump: { target: { q: 3, r: 3 } } })]);
        world.applyShipJumped({
            shipId: "ship-1",
            from: { q: 1, r: 1 },
            to: { q: 3, r: 3 },
            outcome: "arrived",
            destroyedIds: [],
            displacedTo: { q: 4, r: 3 }
        });
        expect(world.findEntity("ship-1", "ship")).toMatchObject({ q: 4, r: 3 });
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

describe("HexWorld carriers", () => {
    const carrier = ship("carrier-1", 1, 1, {
        shipType: "star_destroyer",
        carriedShipIds: ["fighter-1"],
        carriedShipCount: 1
    });
    const fighter = ship("fighter-1", 1, 1, {
        shipType: "fighter_squadron",
        carriedBy: "carrier-1"
    });

    it("leaves carried ships out of click cycling, selection and the hex lists", () => {
        const world = makeWorld([carrier, fighter]);
        expect(world.clickCycle(world.entitiesAt(1, 1)).map((e) => e.id)).toEqual(["carrier-1"]);
        expect(click(world, 1, 1)).toEqual({ type: "select", shipId: "carrier-1" });
        // Nothing else to cycle to: a second click keeps the carrier rather than picking the fighter.
        expect(click(world, 1, 1)).toEqual({ type: "none" });
        expect(world.mapFocus).toMatchObject({ entities: [{ id: "carrier-1" }] });
        expect(world.ownShipsAt(1, 1).map((s) => s.id)).toEqual(["carrier-1"]);
        expect(world.carriedShips(world.selectedShip!).map((s) => s.id)).toEqual(["fighter-1"]);
    });

    it("drops the selection when the selected ship boards a carrier", () => {
        const world = makeWorld([
            carrier,
            ship("fighter-2", 1, 1, { shipType: "fighter_squadron" })
        ]);
        world.selectShip("fighter-2");
        world.applyTilesUpdate({
            tiles: [
                {
                    q: 1,
                    r: 1,
                    fog: "visible",
                    entities: [
                        carrier,
                        ship("fighter-2", 1, 1, {
                            shipType: "fighter_squadron",
                            carriedBy: "carrier-1"
                        })
                    ]
                }
            ],
            visible: ["1,1"]
        });
        expect(world.selectedShipId).toBeNull();
    });

    it("carries ships along when the carrier moves", () => {
        const world = makeWorld([carrier, fighter]);
        world.applyShipMoved({
            shipId: "carrier-1",
            from: { q: 1, r: 1 },
            to: { q: 2, r: 1 },
            path: [{ q: 2, r: 1 }],
            facing: 0,
            movementPoints: 10
        });
        expect(world.findEntity("fighter-1", "ship")).toMatchObject({ q: 2, r: 1 });
        expect(world.entitiesAt(1, 1)).toEqual([]);
    });
});

describe("HexWorld combat", () => {
    const participant = (
        id: string,
        sideId: string,
        role: "attacker" | "defender",
        hpBefore: number,
        hpAfter: number
    ) => ({
        id,
        kind: "ship" as const,
        sideId,
        role,
        shipType: "scout" as const,
        maxHp: 100,
        hpBefore,
        hpAfter,
        damageDealt: 0,
        damageTaken: hpBefore - hpAfter,
        evaded: false,
        destroyed: hpAfter === 0
    });
    const combat = {
        kind: "space" as const,
        cause: "move" as const,
        hex: { q: 2, r: 1 },
        from: { q: 1, r: 1 },
        attackerSideId: "alpha",
        defenderSideIds: ["beta"],
        participants: [
            participant("ship-1", "alpha", "attacker", 100, 70),
            participant("enemy-1", "beta", "defender", 100, 0)
        ],
        destroyedIds: ["enemy-1"],
        destroyedUnitIds: [],
        outcome: "attacker_won" as const,
        attackerMovedIn: true,
        rounds: 1
    };

    it("applies hp, removes losses (they explode as an effect) and logs the report", () => {
        const enemy = { ...ship("enemy-1", 2, 1), sideId: "beta" } as EntitySummary;
        const world = makeWorld([ship("ship-1", 1, 1), enemy]);
        world.applyCombat(combat);

        expect(world.findEntity("ship-1", "ship")).toMatchObject({ q: 1, r: 1, hp: 70 });
        expect(world.findEntityById("enemy-1")).toBeUndefined();
        expect(world.combatReports.map((r) => r.result)).toEqual([combat]);

        // The follow-up advance and tiles update don't bring the loss back.
        world.applyShipMoved({
            shipId: "ship-1",
            from: { q: 1, r: 1 },
            to: { q: 2, r: 1 },
            path: [{ q: 2, r: 1 }],
            facing: 0,
            movementPoints: 0
        });
        world.applyTilesUpdate({
            tiles: [
                { q: 1, r: 1, fog: "visible", entities: [] },
                { q: 2, r: 1, fog: "visible", entities: [ship("ship-1", 2, 1, { hp: 70 })] }
            ],
            visible: ["1,1", "2,1"]
        });
        expect(world.findEntity("ship-1", "ship")).toMatchObject({ q: 2, r: 1, hp: 70 });
        expect(world.findEntityById("enemy-1")).toBeUndefined();
    });

    it("drops a destroyed selected ship from the selection", () => {
        const enemy = { ...ship("enemy-1", 2, 1), sideId: "beta" } as EntitySummary;
        const world = makeWorld([ship("ship-1", 1, 1), enemy]);
        world.selectShip("ship-1");
        world.applyCombat({
            ...combat,
            participants: [
                participant("ship-1", "alpha", "attacker", 100, 0),
                participant("enemy-1", "beta", "defender", 100, 40)
            ],
            destroyedIds: ["ship-1"],
            outcome: "attacker_destroyed",
            attackerMovedIn: false
        });
        expect(world.selectedShipId).toBeNull();
        expect(world.findEntity("enemy-1", "ship")).toMatchObject({ hp: 40 });
    });
});

describe("HexWorld repair outlook", () => {
    const balance = {
        ships: {
            scout: { hp: 6, attack: 1, defence: 1, maxMovementPoints: 5, repairsInSpace: true },
            star_destroyer: {
                hp: 30,
                attack: 8,
                defence: 8,
                maxMovementPoints: 2,
                repairsInSpace: true
            },
            bomber_squadron: {
                hp: 10,
                attack: 4,
                defence: 0,
                maxMovementPoints: 4,
                repairsInSpace: false
            }
        },
        shipTiers: {
            hpMultiplier: [1, 1.5, 2],
            movementBonus: [0, 0, 1],
            attackBonus: [0, 1, 2],
            defenceBonus: [0, 1, 2]
        },
        repair: {
            baseFraction: 0.1,
            minPerTurn: 1,
            techBonus: {},
            atOwnedShipyardBonus: 0.15,
            carriedBonus: 0.1
        }
    } as unknown as EconomyBalance;

    it("flags strike craft that need a hangar or shipyard to repair", () => {
        const world = makeWorld(
            [
                ship("scout-1", 0, 0, { hp: 2 }),
                ship("bomber-1", 1, 0, { shipType: "bomber_squadron", hp: 2 }),
                ship("carrier-1", 3, 0, { shipType: "star_destroyer" }),
                ship("bomber-2", 3, 0, {
                    shipType: "bomber_squadron",
                    hp: 2,
                    carriedBy: "carrier-1"
                })
            ],
            balance
        );
        const repairOf = (id: string) => world.repairOf(world.findEntity(id, "ship")!);
        expect(repairOf("scout-1")).toEqual({ status: "repairing", perTurn: 1 });
        expect(repairOf("bomber-1")).toEqual({ status: "needsDock" });
        expect(repairOf("bomber-2")).toEqual({ status: "repairing", perTurn: 2 });
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

    it("rejects targets beyond our circular jump range", () => {
        const balance = {
            hyperspace: {
                rangeFraction: { base: 0.25, hyperdrive_range_1: 0.5, hyperdrive_range_2: 1 }
            }
        } as unknown as EconomyBalance;
        // The 8x8 map's diagonal is ~9.6 hexes, so the base range is ~2.4.
        const world = makeWorld([ship("ship-1", 1, 1)], balance);
        expect(world.jumpRange()).toBeCloseTo(2.41, 2);
        world.startHyperjumpTargeting("ship-1");
        expect(click(world, 4, 1)).toEqual({
            type: "rejected",
            reason: "Beyond hyperdrive range (2.4 hexes)"
        });
        expect(click(world, 3, 3)).toMatchObject({ type: "rejected" });
        expect(world.hyperjumpTargeting?.id).toBe("ship-1");
        expect(click(world, 3, 1)).toEqual({
            type: "hyperjump",
            shipId: "ship-1",
            target: { q: 3, r: 1 }
        });
    });
});
