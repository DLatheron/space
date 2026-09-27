import { axialRange } from "@space/maths";
import type { ServerToClientMessage } from "@space/shared-data";
import type { Client } from "./Client.js";
import { Game } from "./Game.js";
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
    logLevels: {}
}));

vi.mock("../config/config.schema.js", () => ({ config: mockConfig }));

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

function createGame(flags: { revealMap: boolean; fullVisibility: boolean }) {
    Object.assign(mockConfig, flags);
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
