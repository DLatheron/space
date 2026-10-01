import type { AxialCoord, ServerToClientMessage, ShipType } from "@space/shared-data";
import type { Client } from "./Client.js";
import { Game } from "./Game.js";
import type { EntityOf } from "./map/types.js";

const mockConfig = vi.hoisted(() => ({
    port: 0,
    highlanderGameMode: true,
    mapWidth: 40,
    mapHeight: 30,
    hexPointToPoint: 100,
    visionRange: 4,
    supplyVisionRange: 1,
    mapSeed: 7,
    revealMap: false,
    fullVisibility: false,
    logLevels: {}
}));

vi.mock("../config/config.schema.js", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../config/config.schema.js")>()),
    config: mockConfig
}));

type MessageOf<T extends ServerToClientMessage["type"]> = Extract<
    ServerToClientMessage,
    { type: T }
>;

function connect(game: Game, id: string) {
    const client = game.addClient(id, id) as Client;
    const messages: ServerToClientMessage[] = [];
    vi.spyOn(client, "sendMessage").mockImplementation((message) => {
        messages.push(message);
    });
    game.clientConnected(client);
    const all = <T extends ServerToClientMessage["type"]>(type: T, since = 0) =>
        messages.slice(since).filter((m): m is MessageOf<T> => m.type === type);
    const types = (since: number) => messages.slice(since).map((m) => m.type);
    return { client, messages, all, types };
}

type Connection = ReturnType<typeof connect>;

/** Returns the scripted values in order, then 0. */
function scripted(values: number[]): () => number {
    const queue = [...values];
    return () => queue.shift() ?? 0;
}

/** A game on an empty map with visibility refreshed after placing `ships`. */
function createGame(
    ships: { id: string; sideId: string; at: AxialCoord; shipType: ShipType; mp: number }[],
    rng?: () => number
) {
    const game = new Game("owner", { rng });
    for (const entity of [...game.entities.all()]) game.entities.remove(entity.id);
    const alpha = connect(game, "client-alpha");
    const beta = connect(game, "client-beta");
    for (const { id, sideId, at, shipType, mp } of ships) {
        game.entities.add<EntityOf<"ship">>({
            id,
            kind: "ship",
            shipType,
            sideId,
            q: at.q,
            r: at.r,
            facing: 0,
            movementPoints: mp,
            maxMovementPoints: mp,
            hp: 12
        });
    }
    for (const sideId of ["alpha", "beta"]) {
        game.side(sideId)!.recomputeVisibility(game.entities, mockConfig.visionRange);
    }
    return { game, alpha, beta };
}

async function send(
    game: Game,
    from: Connection,
    message: Parameters<Game["queueMessage"]>[0],
    expected: ServerToClientMessage["type"]
) {
    const mark = from.messages.length;
    game.queueMessage(message, from.client);
    await vi.waitFor(() => expect(from.all(expected, mark).length).toBeGreaterThan(0));
    return mark;
}

async function endTurn(game: Game, alpha: Connection, beta: Connection) {
    const turn = game.turns.turn;
    const marks = { alpha: alpha.messages.length, beta: beta.messages.length };
    game.queueMessage({ type: "client:turn:end", payload: {} }, alpha.client);
    game.queueMessage({ type: "client:turn:end", payload: {} }, beta.client);
    await vi.waitFor(() =>
        expect(alpha.all("server:turn:state", marks.alpha).at(-1)?.payload.turn).toBe(turn + 1)
    );
    return marks;
}

function lastShipView(connection: Connection, since: number, id: string) {
    for (const update of connection.all("server:tiles:update", since).reverse()) {
        for (const tile of update.payload.tiles) {
            const entity = tile.entities.find((e) => e.id === id);
            if (entity) return entity;
        }
    }
    return undefined;
}

describe("Game move orders", () => {
    it("moves now, keeps the rest as an order and runs it at end of turn", async () => {
        const { game, alpha, beta } = createGame([
            { id: "ship-a", sideId: "alpha", at: { q: 5, r: 10 }, shipType: "frigate", mp: 3 },
            { id: "watch-b", sideId: "beta", at: { q: 8, r: 12 }, shipType: "scout", mp: 5 }
        ]);
        const mark = await send(
            game,
            alpha,
            { type: "client:ship:move", payload: { shipId: "ship-a", to: { q: 9, r: 10 } } },
            "server:tiles:update"
        );
        expect(alpha.all("server:ship:moved", mark).map((m) => m.payload.to)).toEqual([
            { q: 8, r: 10 }
        ]);
        expect(lastShipView(alpha, mark, "ship-a")).toMatchObject({
            moveOrder: { destination: { q: 9, r: 10 }, route: [{ q: 9, r: 10 }] }
        });
        const seen = lastShipView(beta, 0, "ship-a");
        expect(seen).toBeDefined();
        expect(seen).not.toHaveProperty("moveOrder");

        const marks = await endTurn(game, alpha, beta);
        for (const [connection, since] of [
            [alpha, marks.alpha],
            [beta, marks.beta]
        ] as const) {
            const moved = connection.all("server:ship:moved", since);
            expect(moved.map((m) => m.payload)).toEqual([
                {
                    shipId: "ship-a",
                    from: { q: 8, r: 10 },
                    to: { q: 9, r: 10 },
                    path: [{ q: 9, r: 10 }],
                    facing: 0,
                    movementPoints: 2
                }
            ]);
            const types = connection.types(since);
            expect(types.indexOf("server:tiles:update")).toBeGreaterThan(
                types.indexOf("server:ship:moved")
            );
        }
        expect(game.entities.get("ship-a")).not.toHaveProperty("moveOrder");
        game.destroyGame();
    });

    it("rejects unexplored destinations and cancels orders on request", async () => {
        const { game, alpha } = createGame([
            { id: "ship-a", sideId: "alpha", at: { q: 5, r: 10 }, shipType: "frigate", mp: 3 }
        ]);
        const explored = game.side("alpha")!.explored;
        const row = Array.from({ length: 30 }, (_, i) => ({ q: 5 + i, r: 10 }));
        const unexplored = row.find((hex) => !explored.has(`${hex.q},${hex.r}`))!;
        expect(unexplored).toBeDefined();
        let mark = await send(
            game,
            alpha,
            { type: "client:ship:move", payload: { shipId: "ship-a", to: unexplored } },
            "server:error"
        );
        expect(alpha.all("server:error", mark)[0]!.payload.message).toBe(
            `Destination ${unexplored.q},${unexplored.r} is unexplored`
        );

        await send(
            game,
            alpha,
            { type: "client:ship:move", payload: { shipId: "ship-a", to: { q: 9, r: 10 } } },
            "server:tiles:update"
        );
        mark = await send(
            game,
            alpha,
            { type: "client:ship:order:cancel", payload: { shipId: "ship-a" } },
            "server:tiles:update"
        );
        expect(lastShipView(alpha, mark, "ship-a")).not.toHaveProperty("moveOrder");
        game.destroyGame();
    });
});

describe("Game hyperspace jumps", () => {
    it("shows charging to other sides and broadcasts the jump before the tiles update", async () => {
        const { game, alpha, beta } = createGame(
            [
                { id: "ship-a", sideId: "alpha", at: { q: 5, r: 10 }, shipType: "frigate", mp: 3 },
                { id: "watch-b", sideId: "beta", at: { q: 6, r: 12 }, shipType: "scout", mp: 5 }
            ],
            scripted([0, 0])
        );
        const target = { q: 8, r: 8 };
        const betaMark = beta.messages.length;
        let mark = await send(
            game,
            alpha,
            { type: "client:ship:hyperjump", payload: { shipId: "ship-a", target } },
            "server:tiles:update"
        );
        expect(lastShipView(alpha, mark, "ship-a")).toMatchObject({
            hyperjump: { target },
            hyperdriveCharging: true
        });
        const seen = lastShipView(beta, betaMark, "ship-a");
        expect(seen).toMatchObject({ hyperdriveCharging: true });
        expect(seen).not.toHaveProperty("hyperjump");

        mark = await send(
            game,
            alpha,
            { type: "client:ship:move", payload: { shipId: "ship-a", to: { q: 6, r: 10 } } },
            "server:error"
        );
        expect(alpha.all("server:error", mark)[0]!.payload.message).toMatch(/hyperspace jump/);

        const marks = await endTurn(game, alpha, beta);
        const jumped = {
            shipId: "ship-a",
            from: { q: 5, r: 10 },
            to: target,
            outcome: "arrived",
            destroyedIds: []
        };
        for (const [connection, since] of [
            [alpha, marks.alpha],
            [beta, marks.beta]
        ] as const) {
            expect(connection.all("server:ship:jumped", since).map((m) => m.payload)).toEqual([
                jumped
            ]);
            const types = connection.types(since);
            expect(types.indexOf("server:tiles:update")).toBeGreaterThan(
                types.indexOf("server:ship:jumped")
            );
        }
        expect(lastShipView(alpha, marks.alpha, "ship-a")).toMatchObject({
            ...target,
            hyperdriveCooldown: 3
        });
        expect(lastShipView(beta, marks.beta, "ship-a")).not.toHaveProperty("hyperdriveCooldown");
        game.destroyGame();
    });

    it("keeps the jump from sides that see neither end and tells sides that lost ships", async () => {
        const { game, alpha, beta } = createGame(
            [
                { id: "ship-a", sideId: "alpha", at: { q: 5, r: 10 }, shipType: "frigate", mp: 3 },
                { id: "watch-b", sideId: "beta", at: { q: 25, r: 20 }, shipType: "scout", mp: 5 }
            ],
            scripted([0, 0])
        );
        await send(
            game,
            alpha,
            {
                type: "client:ship:hyperjump",
                payload: { shipId: "ship-a", target: { q: 8, r: 8 } }
            },
            "server:tiles:update"
        );
        const marks = await endTurn(game, alpha, beta);
        expect(alpha.all("server:ship:jumped", marks.alpha)).toHaveLength(1);
        expect(beta.all("server:ship:jumped", marks.beta)).toEqual([]);
        game.destroyGame();
    });

    it("tells sides that see only the landing hex, and sides whose ships it destroys", async () => {
        const ships = [
            { id: "ship-a", sideId: "alpha", at: { q: 5, r: 10 }, shipType: "frigate", mp: 3 },
            { id: "watch-b", sideId: "beta", at: { q: 27, r: 10 }, shipType: "scout", mp: 5 }
        ] as const;
        const landing = createGame([...ships], scripted([0, 0]));
        landing.game.side("alpha")!.exploreAll(landing.game.entities);
        await send(
            landing.game,
            landing.alpha,
            {
                type: "client:ship:hyperjump",
                payload: { shipId: "ship-a", target: { q: 25, r: 10 } }
            },
            "server:tiles:update"
        );
        let marks = await endTurn(landing.game, landing.alpha, landing.beta);
        expect(landing.beta.all("server:ship:jumped", marks.beta).map((m) => m.payload)).toEqual([
            {
                shipId: "ship-a",
                from: { q: 5, r: 10 },
                to: { q: 25, r: 10 },
                outcome: "arrived",
                destroyedIds: []
            }
        ]);
        landing.game.destroyGame();

        // Hits beta's only ship, which is destroyed.
        const { game, alpha, beta } = createGame([...ships], scripted([0, 0, 0, 0.5, 0.99]));
        game.side("alpha")!.exploreAll(game.entities);
        await send(
            game,
            alpha,
            {
                type: "client:ship:hyperjump",
                payload: { shipId: "ship-a", target: { q: 27, r: 10 } }
            },
            "server:tiles:update"
        );
        marks = await endTurn(game, alpha, beta);
        const jumped = {
            shipId: "ship-a",
            from: { q: 5, r: 10 },
            to: { q: 27, r: 10 },
            outcome: "arrived",
            collidedWithId: "watch-b",
            destroyedIds: ["watch-b"]
        };
        for (const [connection, since] of [
            [alpha, marks.alpha],
            [beta, marks.beta]
        ] as const) {
            expect(connection.all("server:ship:jumped", since).map((m) => m.payload)).toEqual([
                jumped
            ]);
            expect(connection.all("server:economy:state", since).length).toBeGreaterThan(0);
        }
        // Alpha sees the landing hex without it; beta, now blind, forgets it.
        const landingTile = alpha
            .all("server:tiles:update", marks.alpha)
            .flatMap((m) => m.payload.tiles)
            .find((tile) => tile.q === 27 && tile.r === 10);
        expect(landingTile?.entities.map((e) => e.id)).toEqual(["ship-a"]);
        const forgotten = beta
            .all("server:tiles:update", marks.beta)
            .flatMap((m) => m.payload.forgetEntityIds ?? []);
        expect(forgotten).toContain("watch-b");
        expect(game.entities.get("watch-b")).toBeUndefined();
        game.destroyGame();
    });

    it("sends a jump's combat to both sides right after the jump, before the tiles", async () => {
        // Lands on target and hits ship-b1 (first on the hex), which alone is destroyed; the
        // jumper then fights ship-b2 with low rolls, fails to clear the hex and is displaced.
        const { game, alpha, beta } = createGame(
            [
                { id: "ship-a", sideId: "alpha", at: { q: 5, r: 10 }, shipType: "frigate", mp: 3 },
                // Scouts the target so it is explored.
                { id: "ship-a2", sideId: "alpha", at: { q: 8, r: 10 }, shipType: "frigate", mp: 3 },
                { id: "ship-b1", sideId: "beta", at: { q: 10, r: 10 }, shipType: "frigate", mp: 3 },
                { id: "ship-b2", sideId: "beta", at: { q: 10, r: 10 }, shipType: "frigate", mp: 3 }
            ],
            scripted([0, 0, 0, 0.99, 0.99])
        );
        await send(
            game,
            alpha,
            {
                type: "client:ship:hyperjump",
                payload: { shipId: "ship-a", target: { q: 10, r: 10 } }
            },
            "server:tiles:update"
        );

        const marks = await endTurn(game, alpha, beta);
        const ship = game.entities.getOfKind("ship-a", "ship")!;
        for (const [connection, since] of [
            [alpha, marks.alpha],
            [beta, marks.beta]
        ] as const) {
            const jumped = connection.all("server:ship:jumped", since);
            expect(jumped.map((m) => m.payload)).toEqual([
                expect.objectContaining({
                    shipId: "ship-a",
                    to: { q: 10, r: 10 },
                    destroyedIds: ["ship-b1"],
                    displacedTo: { q: ship.q, r: ship.r }
                })
            ]);
            expect(connection.all("server:combat", since).map((m) => m.payload)).toEqual([
                expect.objectContaining({
                    kind: "space",
                    cause: "hyperjump",
                    hex: { q: 10, r: 10 },
                    from: { q: 5, r: 10 },
                    attackerSideId: "alpha",
                    defenderSideIds: ["beta"],
                    outcome: "inconclusive",
                    attackerMovedIn: false,
                    displacedTo: { q: ship.q, r: ship.r }
                })
            ]);
            const types = connection.types(since);
            const combatAt = types.indexOf("server:combat");
            expect(combatAt).toBeGreaterThan(types.indexOf("server:ship:jumped"));
            expect(types.indexOf("server:tiles:update", combatAt)).toBeGreaterThan(combatAt);
        }
        expect(ship.hp).toBe(10);
        expect(game.entities.getOfKind("ship-b2", "ship")!.hp).toBe(10);
        game.destroyGame();
    });

    it("rejects jumps for ships without a hyperdrive and cancels pending jumps", async () => {
        const { game, alpha } = createGame([
            { id: "ship-a", sideId: "alpha", at: { q: 5, r: 10 }, shipType: "frigate", mp: 3 },
            { id: "scout-a", sideId: "alpha", at: { q: 5, r: 11 }, shipType: "scout", mp: 5 }
        ]);
        let mark = await send(
            game,
            alpha,
            {
                type: "client:ship:hyperjump",
                payload: { shipId: "scout-a", target: { q: 8, r: 8 } }
            },
            "server:error"
        );
        expect(alpha.all("server:error", mark)[0]!.payload.message).toBe(
            "Ship scout-a has no hyperdrive"
        );
        await send(
            game,
            alpha,
            {
                type: "client:ship:hyperjump",
                payload: { shipId: "ship-a", target: { q: 8, r: 8 } }
            },
            "server:tiles:update"
        );
        mark = await send(
            game,
            alpha,
            { type: "client:ship:hyperjump:cancel", payload: { shipId: "ship-a" } },
            "server:tiles:update"
        );
        const view = lastShipView(alpha, mark, "ship-a");
        expect(view).not.toHaveProperty("hyperjump");
        expect(view).not.toHaveProperty("hyperdriveCharging");
        game.destroyGame();
    });
});
