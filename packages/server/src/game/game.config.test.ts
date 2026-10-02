import { axialRange } from "@space/maths";
import { type EconomyBalance, type ServerToClientMessage } from "@space/shared-data";
import { defaultEconomyBalance, EconomyBalanceConfig } from "../config/config.schema.js";
import type { Client } from "./Client.js";
import { Game } from "./Game.js";
import type { EntityOf } from "./map/types.js";
import { validateShipMove } from "./moveShip.js";

const mockConfig = vi.hoisted(() => ({
    port: 0,
    highlanderGameMode: true,
    mapWidth: 30,
    mapHeight: 30,
    hexPointToPoint: 100,
    visionRange: 3,
    mapSeed: 7,
    revealMap: false,
    fullVisibility: false,
    economy: undefined as EconomyBalance | undefined,
    logLevels: {}
}));

const DEFAULTS = defaultEconomyBalance();

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
    const last = <T extends ServerToClientMessage["type"]>(type: T) =>
        messages.filter((m): m is MessageOf<T> => m.type === type).at(-1);
    return { client, messages, last };
}

function createGame(flags: {
    revealMap: boolean;
    fullVisibility: boolean;
    economy?: EconomyBalance;
}) {
    Object.assign(mockConfig, { economy: undefined }, flags);
    const game = new Game("owner");
    const alpha = connect(game, "client-alpha");
    const beta = connect(game, "client-beta");
    return { game, alpha, beta, totalHexes: mockConfig.mapWidth * mockConfig.mapHeight };
}

describe("Game with revealMap", () => {
    it("sends every hex as explored in map:init while visibility stays range-limited", () => {
        const { game, alpha, totalHexes } = createGame({ revealMap: true, fullVisibility: false });
        const init = alpha.last("server:map:init")!;
        expect(init.payload.tiles).toHaveLength(totalHexes);
        expect(init.payload.visible.length).toBeGreaterThan(0);
        expect(init.payload.visible.length).toBeLessThan(totalHexes);
        expect(init.payload.tiles.some((t) => t.fog === "explored" && t.entities.length > 0)).toBe(
            true
        );
        game.destroyGame();
    });
});

describe("Game with fullVisibility", () => {
    it("shows the whole map live and sends every side the from/to hexes of each move", async () => {
        const { game, alpha, beta, totalHexes } = createGame({
            revealMap: false,
            fullVisibility: true
        });
        const init = alpha.last("server:map:init")!;
        expect(init.payload.tiles).toHaveLength(totalHexes);
        expect(init.payload.visible).toHaveLength(totalHexes);
        expect(init.payload.tiles.every((t) => t.fog === "visible")).toBe(true);

        const ship = game.entities.ofKind("ship").find((s) => s.sideId === "beta")!;
        const from = { q: ship.q, r: ship.r };
        const to = axialRange(ship, 1).find(
            (hex) => validateShipMove(game.entities, "beta", ship.id, hex).ok
        )!;
        expect(to).toBeDefined();

        game.queueMessage(
            { type: "client:ship:move", payload: { shipId: ship.id, to } },
            beta.client
        );
        await vi.waitFor(() => expect(alpha.last("server:tiles:update")).toBeDefined());

        for (const observer of [alpha, beta]) {
            const update = observer.last("server:tiles:update")!;
            const fromTile = update.payload.tiles.find((t) => t.q === from.q && t.r === from.r);
            const toTile = update.payload.tiles.find((t) => t.q === to.q && t.r === to.r);
            expect(fromTile?.entities.some((e) => e.id === ship.id)).toBe(false);
            expect(toTile?.fog).toBe("visible");
            expect(toTile?.entities.some((e) => e.id === ship.id)).toBe(true);
            expect(update.payload.visible).toHaveLength(totalHexes);
        }
        game.destroyGame();
    });
});

describe("Game economy messages", () => {
    it("includes economy in map:init and sends tiles, economy then turn state on advance", async () => {
        const { game, alpha, beta } = createGame({ revealMap: false, fullVisibility: false });
        const init = alpha.last("server:map:init")!.payload;
        expect(init.economy).toMatchObject({ shipCount: 2, shipCap: 3, techs: [] });
        expect(init.economy.locations[0].stockpile).toEqual(DEFAULTS.startingStockpile);
        expect(init).not.toHaveProperty("battles");
        expect(init).not.toHaveProperty("groundBattles");
        expect(init.balance).toEqual(defaultEconomyBalance());

        const mark = alpha.messages.length;
        game.queueMessage({ type: "client:turn:end", payload: {} }, alpha.client);
        game.queueMessage({ type: "client:turn:end", payload: {} }, beta.client);
        await vi.waitFor(() => expect(alpha.last("server:turn:state")?.payload.turn).toBe(2));

        const types = alpha.messages.slice(mark).map((m) => m.type);
        const tiles = types.lastIndexOf("server:tiles:update");
        const economy = types.indexOf("server:economy:state");
        expect(tiles).toBeGreaterThanOrEqual(0);
        expect(economy).toBeGreaterThan(tiles);
        expect(types.lastIndexOf("server:turn:state")).toBeGreaterThan(economy);
        expect(
            alpha.last("server:economy:state")!.payload.locations[0].stockpile.money
        ).toBeGreaterThan(DEFAULTS.startingStockpile.money);
        game.destroyGame();
    });

    it("replies to builds with economy state or an error", async () => {
        const { game, alpha } = createGame({ revealMap: false, fullVisibility: false });
        const home = game.entities.ofKind("planet").find((p) => p.sideId === "alpha")!;

        game.queueMessage(
            {
                type: "client:location:build",
                payload: {
                    locationId: home.id,
                    item: { kind: "ship", shipType: "scout" },
                    priority: "medium"
                }
            },
            alpha.client
        );
        await vi.waitFor(() => expect(alpha.last("server:error")).toBeDefined());
        expect(alpha.last("server:error")!.payload.message).toBe("Requires Shipyard");

        game.queueMessage(
            {
                type: "client:location:build",
                payload: {
                    locationId: home.id,
                    item: { kind: "structure", structureType: "habitat" },
                    priority: "high"
                }
            },
            alpha.client
        );
        await vi.waitFor(() => expect(alpha.last("server:economy:state")).toBeDefined());
        expect(alpha.last("server:economy:state")!.payload.locations[0].orders).toMatchObject([
            { priority: "high" }
        ]);
        game.destroyGame();
    });

    it("moves orders within their queue and rejects moves at another side's location", async () => {
        const { game, alpha, beta } = createGame({ revealMap: false, fullVisibility: false });
        const home = game.entities.ofKind("planet").find((p) => p.sideId === "alpha")!;
        const betaHome = game.entities.ofKind("planet").find((p) => p.sideId === "beta")!;
        for (const structureType of ["habitat", "mine"] as const) {
            game.economy.build("alpha", home.id, { kind: "structure", structureType });
        }
        const [habitat, mine] = game.economy.locationEconomy(home.id)!.orders.map((o) => o.id);

        game.queueMessage(
            {
                type: "client:order:move",
                payload: { locationId: home.id, orderId: mine!, direction: "up" }
            },
            alpha.client
        );
        await vi.waitFor(() => expect(alpha.last("server:economy:state")).toBeDefined());
        const orders = alpha
            .last("server:economy:state")!
            .payload.locations.find((l) => l.locationId === home.id)!.orders;
        expect(orders.map((o) => o.id)).toEqual([mine, habitat]);
        expect(game.economy.activeOrders(home.id).map((o) => o.id)).toEqual([mine]);

        game.queueMessage(
            {
                type: "client:order:move",
                payload: { locationId: home.id, orderId: mine!, direction: "down" }
            },
            beta.client
        );
        game.queueMessage(
            {
                type: "client:order:move",
                payload: { locationId: betaHome.id, orderId: mine!, direction: "down" }
            },
            alpha.client
        );
        await vi.waitFor(() => expect(beta.last("server:error")).toBeDefined());
        await vi.waitFor(() => expect(alpha.last("server:error")).toBeDefined());
        expect(game.economy.locationEconomy(home.id)!.orders.map((o) => o.id)).toEqual([
            mine,
            habitat
        ]);
        game.destroyGame();
    });

    it("sets a Shield Generator's priority, replying with economy state or an error", async () => {
        const { game, alpha } = createGame({ revealMap: false, fullVisibility: false });
        const home = game.entities.ofKind("planet").find((p) => p.sideId === "alpha")!;
        const setPriority = () =>
            game.queueMessage(
                {
                    type: "client:shield:priority",
                    payload: { locationId: home.id, priority: "high" }
                },
                alpha.client
            );

        setPriority();
        await vi.waitFor(() => expect(alpha.last("server:error")).toBeDefined());
        expect(alpha.last("server:error")!.payload.message).toBe(
            `No Shield Generator at ${home.id}`
        );

        game.economy.research.add("alpha", "planetary_shields");
        game.economy.build("alpha", home.id, {
            kind: "structure",
            structureType: "shield_generator"
        });
        for (let turn = 0; turn < DEFAULTS.structures.shield_generator.buildTurns; turn++) {
            game.economy.fund();
        }
        game.economy.completeReady();
        setPriority();
        await vi.waitFor(() => expect(alpha.last("server:economy:state")).toBeDefined());
        const location = alpha
            .last("server:economy:state")!
            .payload.locations.find((l) => l.locationId === home.id)!;
        expect(location.shield).toMatchObject({ priority: "high" });
        game.destroyGame();
    });

    it("uses ship, structure and starting values from the economy config", async () => {
        const economy = EconomyBalanceConfig.parse({
            startingShips: ["scout", "colony_ship"],
            planetBaseIncomePerLevel: { money: 0, materials: 0, population: 0, science: 0 },
            structures: {
                trade_hub: { cost: { materials: 30, population: 0 }, buildTurns: 1 },
                habitat: { produces: { population: 0, money: 77 } }
            },
            ships: { colony_ship: { hp: 9, maxMovementPoints: 4 } }
        });
        const { game, alpha, beta } = createGame({
            revealMap: false,
            fullVisibility: false,
            economy
        });
        const init = alpha.last("server:map:init")!.payload;
        expect(init.balance).toEqual(economy);
        const fleet = game.entities.ofKind("ship").filter((s) => s.sideId === "alpha");
        expect(fleet.map((s) => s.shipType).sort()).toEqual(["colony_ship", "scout"]);
        expect(fleet.find((s) => s.shipType === "colony_ship")).toMatchObject({
            hp: 9,
            maxMovementPoints: 4
        });

        const home = game.entities.ofKind("planet").find((p) => p.sideId === "alpha")!;
        const trade = game.economy.build("alpha", home.id, {
            kind: "structure",
            structureType: "trade_hub"
        });
        expect(trade.ok && trade.order.cost).toEqual({
            money: 0,
            materials: 30,
            population: 0,
            science: 0
        });
        expect(trade.ok && trade.order.ratePerTurn.materials).toBe(30);
        game.economy.build("alpha", home.id, { kind: "structure", structureType: "habitat" });

        const endTurn = async (turn: number) => {
            game.queueMessage({ type: "client:turn:end", payload: {} }, alpha.client);
            game.queueMessage({ type: "client:turn:end", payload: {} }, beta.client);
            await vi.waitFor(() =>
                expect(alpha.last("server:turn:state")?.payload.turn).toBe(turn)
            );
        };
        const installed = () =>
            game.economy.locationEconomy(home.id)!.installations.map((i) => i.type);
        // Funded in one turn, the hub completes the turn after; its slot passes straight to the
        // habitat, which takes its default 2 turns plus one to complete.
        await endTurn(2);
        expect(installed()).toEqual([]);
        expect(game.economy.activeOrders(home.id).map((o) => o.item)).toEqual([
            { kind: "structure", structureType: "habitat" }
        ]);
        await endTurn(3);
        expect(installed()).toEqual(["trade_hub"]);
        await endTurn(4);
        expect(installed()).toEqual(["trade_hub", "habitat"]);
        expect(game.economy.stateFor("alpha").lastIncome).toEqual({
            money: 40 + 77,
            materials: 0,
            population: 0,
            science: 0
        });
        game.destroyGame();
    });

    it("colonises and shows the new owner to every side that sees the hex", async () => {
        const { game, alpha, beta } = createGame({ revealMap: false, fullVisibility: true });
        const planet = game.entities.ofKind("planet").find((p) => p.sideId === null)!;
        const colony = game.entities.add<EntityOf<"ship">>({
            id: "test-colony",
            kind: "ship",
            shipType: "colony_ship",
            sideId: "alpha",
            q: planet.q,
            r: planet.r,
            facing: 0,
            movementPoints: 2,
            maxMovementPoints: 2
        });

        game.queueMessage(
            {
                type: "client:location:colonise",
                payload: { locationId: planet.id, shipId: colony.id }
            },
            alpha.client
        );
        await vi.waitFor(() => expect(alpha.last("server:economy:state")).toBeDefined());

        expect(alpha.last("server:economy:state")!.payload.locations).toHaveLength(2);
        expect(beta.last("server:economy:state")).toBeUndefined();
        for (const observer of [alpha, beta]) {
            const tile = observer
                .last("server:tiles:update")!
                .payload.tiles.find((t) => t.q === planet.q && t.r === planet.r)!;
            expect(tile.entities.find((e) => e.id === planet.id)).toMatchObject({
                sideId: "alpha"
            });
            expect(tile.entities.some((e) => e.id === colony.id)).toBe(false);
        }
        game.destroyGame();
    });
});
