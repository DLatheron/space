import {
    RESOURCE_KEYS,
    sumResources,
    zeroResources,
    type AxialCoord,
    type Resources,
    type ServerToClientMessage,
    type ShipType
} from "@space/shared-data";
import type { Client } from "./Client.js";
import { Game } from "./Game.js";
import type { EntityOf } from "./map/types.js";

const mockConfig = vi.hoisted(() => ({
    port: 0,
    highlanderGameMode: true,
    mapWidth: 30,
    mapHeight: 30,
    hexPointToPoint: 100,
    visionRange: 6,
    supplyVisionRange: 1,
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

const res = (partial: Partial<Resources>): Resources => ({ ...zeroResources(), ...partial });

function connect(game: Game, id: string) {
    const client = game.addClient(id, id) as Client;
    const messages: ServerToClientMessage[] = [];
    vi.spyOn(client, "sendMessage").mockImplementation((message) => {
        messages.push(message);
    });
    game.clientConnected(client);
    const all = <T extends ServerToClientMessage["type"]>(type: T, since = 0) =>
        messages.slice(since).filter((m): m is MessageOf<T> => m.type === type);
    const last = <T extends ServerToClientMessage["type"]>(type: T) => all(type).at(-1);
    const types = (since: number) => messages.slice(since).map((m) => m.type);
    return { client, messages, all, last, types };
}

type Connection = ReturnType<typeof connect>;

/** A game on an empty map, so tests place exactly what they need. */
function createGame() {
    const game = new Game("owner");
    for (const entity of [...game.entities.all()]) game.entities.remove(entity.id);
    const alpha = connect(game, "client-alpha");
    const beta = connect(game, "client-beta");
    const add = game.entities.add.bind(game.entities);
    const planet = (id: string, sideId: string | null, q: number, r: number) =>
        add<EntityOf<"planet">>({ id, kind: "planet", sideId, systemId: "sys-1", q, r, level: 5 });
    const ship = (id: string, sideId: string, at: AxialCoord, shipType: ShipType = "scout") =>
        add<EntityOf<"ship">>({
            id,
            kind: "ship",
            shipType,
            sideId,
            q: at.q,
            r: at.r,
            facing: 0,
            movementPoints: 5,
            maxMovementPoints: 5,
            ...(shipType === "transport" ? { carriedUnitIds: [] } : {})
        });
    return { game, alpha, beta, planet, ship };
}

async function moveShip(game: Game, from: Connection, shipId: string, to: AxialCoord) {
    const mark = from.messages.length;
    game.queueMessage({ type: "client:ship:move", payload: { shipId, to } }, from.client);
    await vi.waitFor(() => expect(from.all("server:tiles:update", mark).length).toBeGreaterThan(0));
}

async function endTurn(game: Game, alpha: Connection, beta: Connection) {
    const turn = game.turns.turn;
    game.queueMessage({ type: "client:turn:end", payload: {} }, alpha.client);
    game.queueMessage({ type: "client:turn:end", payload: {} }, beta.client);
    await vi.waitFor(() => expect(alpha.last("server:turn:state")?.payload.turn).toBe(turn + 1));
}

function tileEntity(connection: Connection, since: number, at: AxialCoord, id: string) {
    for (const update of connection.all("server:tiles:update", since).reverse()) {
        const tile = update.payload.tiles.find((t) => t.q === at.q && t.r === at.r);
        const entity = tile?.entities.find((e) => e.id === id);
        if (entity) return entity;
    }
    return undefined;
}

describe("Game supply ship messages", () => {
    async function supplyScenario(betaWatcherAt: AxialCoord) {
        const world = createGame();
        const { game, alpha, beta, planet, ship } = world;
        planet("home-a", "alpha", 2, 10);
        planet("dest-a", "alpha", 12, 10);
        planet("home-b", "beta", 5, 25);
        const supply = game.entities.add<EntityOf<"supply_ship">>({
            id: "supply-1",
            kind: "supply_ship",
            name: "Supply 1",
            sideId: "alpha",
            q: 2,
            r: 10,
            facing: 0,
            originId: "home-a",
            destinationId: "dest-a",
            cargo: res({ money: 10 }),
            reservedFor: [{ orderId: "order-x", amount: res({ money: 10 }) }],
            speed: 6,
            capacity: 100
        });
        // Beta moves a watcher so its visibility reflects the new map before the turn ends.
        ship("watcher-b", "beta", { q: betaWatcherAt.q, r: betaWatcherAt.r + 1 });
        await moveShip(game, beta, "watcher-b", betaWatcherAt);
        const marks = { alpha: alpha.messages.length, beta: beta.messages.length };
        await endTurn(game, alpha, beta);
        return { ...world, supply, marks };
    }

    it("sends server:supply:moved to sides that see the route, redacting route and reservations", async () => {
        const { game, alpha, beta, supply, marks } = await supplyScenario({ q: 5, r: 13 });
        const path = [3, 4, 5, 6, 7, 8].map((q) => ({ q, r: 10 }));
        const moved = {
            supplyShipId: supply.id,
            from: { q: 2, r: 10 },
            to: { q: 8, r: 10 },
            path,
            facing: 0
        };
        expect(alpha.all("server:supply:moved", marks.alpha).map((m) => m.payload)).toEqual([
            moved
        ]);
        expect(beta.all("server:supply:moved", marks.beta).map((m) => m.payload)).toEqual([moved]);
        for (const [connection, mark] of [
            [alpha, marks.alpha],
            [beta, marks.beta]
        ] as const) {
            const types = connection.types(mark);
            expect(types.indexOf("server:supply:moved")).toBeGreaterThanOrEqual(0);
            expect(types.indexOf("server:tiles:update")).toBeGreaterThan(
                types.indexOf("server:supply:moved")
            );
        }

        const remaining = [9, 10, 11, 12].map((q) => ({ q, r: 10 }));
        const [own] = alpha.last("server:economy:state")!.payload.supplyShips;
        expect(own).toMatchObject({ id: supply.id, q: 8, r: 10, route: remaining });
        expect(own.reservedFor).toHaveLength(1);
        expect(tileEntity(alpha, marks.alpha, moved.to, supply.id)).toMatchObject({
            route: remaining,
            reservedFor: [{ orderId: "order-x" }]
        });

        const seen = tileEntity(beta, marks.beta, moved.to, supply.id);
        expect(seen).toMatchObject({ kind: "supply_ship", cargo: res({ money: 10 }) });
        expect(seen).toHaveProperty("reservedFor", []);
        expect(seen).not.toHaveProperty("route");
        expect(beta.last("server:economy:state")!.payload.supplyShips).toEqual([]);
        game.destroyGame();
    });

    it("keeps server:supply:moved from sides that can't see the route", async () => {
        const { game, alpha, beta, supply, marks } = await supplyScenario({ q: 10, r: 21 });
        expect(alpha.all("server:supply:moved", marks.alpha)).toHaveLength(1);
        expect(beta.all("server:supply:moved", marks.beta)).toEqual([]);
        expect(tileEntity(beta, marks.beta, supply, supply.id)).toBeUndefined();
        game.destroyGame();
    });

    it("announces an arriving ship's move before the tiles update that removes it", async () => {
        const { game, alpha, beta, planet } = createGame();
        planet("home-a", "alpha", 2, 10);
        planet("dest-a", "alpha", 5, 10);
        planet("home-b", "beta", 5, 25);
        game.entities.add<EntityOf<"supply_ship">>({
            id: "supply-1",
            kind: "supply_ship",
            name: "Supply 1",
            sideId: "alpha",
            q: 2,
            r: 10,
            facing: 0,
            originId: "home-a",
            destinationId: "dest-a",
            cargo: res({ money: 10 }),
            reservedFor: [],
            speed: 6,
            capacity: 100
        });
        const mark = alpha.messages.length;
        await endTurn(game, alpha, beta);

        expect(alpha.all("server:supply:moved", mark).map((m) => m.payload)).toEqual([
            {
                supplyShipId: "supply-1",
                from: { q: 2, r: 10 },
                to: { q: 5, r: 10 },
                path: [3, 4, 5].map((q) => ({ q, r: 10 })),
                facing: 0
            }
        ]);
        const types = alpha.types(mark);
        const tiles = types.indexOf("server:tiles:update");
        expect(tiles).toBeGreaterThan(types.indexOf("server:supply:moved"));
        expect(game.entities.get("supply-1")).toBeUndefined();
        const update = alpha.all("server:tiles:update", mark)[0].payload;
        const dest = update.tiles.find((t) => t.q === 5 && t.r === 10);
        expect(dest?.entities.map((e) => e.id)).not.toContain("supply-1");
        game.destroyGame();
    });

    function dispatchScenario(destAt: AxialCoord) {
        const world = createGame();
        const { game, planet } = world;
        const home = planet("home-a", "alpha", 2, 10);
        const dest = planet("dest-a", "alpha", destAt.q, destAt.r);
        planet("home-b", "beta", 5, 25);
        game.economy.deposit(home.id, res({ money: 1000, metal: 1000 }));
        const ordered = game.economy.build(
            "alpha",
            dest.id,
            { kind: "structure", structureType: "shipyard" },
            "high"
        );
        expect(ordered.ok).toBe(true);
        return { ...world, home, dest };
    }

    it("flies a ship dispatched this turn out from its source in the same advance", async () => {
        const { game, alpha, beta, home, dest } = dispatchScenario({ q: 12, r: 10 });
        const mark = alpha.messages.length;
        await endTurn(game, alpha, beta);

        const ships = game.supply.shipsOf("alpha");
        expect(ships.length).toBeGreaterThan(0);
        const [dispatched] = ships;
        expect(dispatched).toMatchObject({ q: 8, r: 10, destinationId: dest.id });
        const moves = alpha.all("server:supply:moved", mark).map((m) => m.payload);
        expect(moves.map((m) => m.supplyShipId)).toEqual(ships.map((s) => s.id));
        expect(moves[0]).toMatchObject({
            supplyShipId: dispatched.id,
            from: { q: home.q, r: home.r },
            to: { q: 8, r: 10 },
            path: [3, 4, 5, 6, 7, 8].map((q) => ({ q, r: 10 })),
            supplyShip: { id: dispatched.id, kind: "supply_ship", originId: home.id }
        });
        const types = alpha.types(mark);
        expect(types.indexOf("server:tiles:update")).toBeGreaterThan(
            types.indexOf("server:supply:moved")
        );
        expect(tileEntity(alpha, mark, { q: 8, r: 10 }, dispatched.id)).toMatchObject({
            kind: "supply_ship"
        });

        // Next turn it moves once more, now without the launch snapshot.
        const next = alpha.messages.length;
        await endTurn(game, alpha, beta);
        const ids = new Set(ships.map((s) => s.id));
        const again = alpha
            .all("server:supply:moved", next)
            .map((m) => m.payload)
            .filter((m) => ids.has(m.supplyShipId));
        expect(again).toHaveLength(ships.length);
        for (const move of again) {
            expect(move).toMatchObject({ from: { q: 8, r: 10 }, to: { q: 12, r: 10 } });
            expect(move).not.toHaveProperty("supplyShip");
        }
        game.destroyGame();
    });

    it("unloads a ship arriving on launch without funding from its cargo until next turn", async () => {
        const { game, alpha, beta, dest } = dispatchScenario({ q: 5, r: 10 });
        const mark = alpha.messages.length;
        await endTurn(game, alpha, beta);

        const moves = alpha.all("server:supply:moved", mark).map((m) => m.payload);
        expect(moves.length).toBeGreaterThan(0);
        for (const move of moves) {
            expect(move).toMatchObject({
                to: { q: 5, r: 10 },
                path: [3, 4, 5].map((q) => ({ q, r: 10 }))
            });
        }
        const cargo = sumResources(moves.map((m) => m.supplyShip!.cargo));
        expect(game.supply.shipsOf("alpha")).toEqual([]);

        const economy = game.economy.locationEconomy(dest.id)!;
        for (const [k, amount] of Object.entries(cargo) as [keyof Resources, number][]) {
            expect(economy.stockpile[k]).toBeGreaterThanOrEqual(amount);
        }
        const applied = { ...economy.orders[0].applied };
        await endTurn(game, alpha, beta);
        const after = game.economy.locationEconomy(dest.id)!.orders[0]?.applied;
        const progressed = RESOURCE_KEYS.some((k) => (after?.[k] ?? Infinity) > applied[k]);
        expect(progressed).toBe(true);
        game.destroyGame();
    });
});

describe("Game ground messages", () => {
    function invasionScenario(defended: boolean) {
        const world = createGame();
        const { game, planet, ship } = world;
        const home = planet("home-a", "alpha", 2, 10);
        const target = planet("target-b", "beta", 8, 10);
        planet("home-b", "beta", 5, 25);
        const transport = ship("transport-a", "alpha", target, "transport");
        const units = game.economy.units;
        const invaders = [0, 1].map(() => units.create("alpha", "infantry", home.id, home.id).id);
        for (const id of invaders) {
            units.relocate(id, { kind: "transport", shipId: transport.id });
        }
        const defender = defended ? units.create("beta", "infantry", target.id, target.id) : null;
        return { ...world, home, target, transport, invaders, defender };
    }

    it("includes pending ground battles in map:init on reconnect and follows resolution with tiles and economy", async () => {
        const { game, alpha, beta, target, transport, invaders, defender } = invasionScenario(true);
        game.queueMessage(
            { type: "client:invade", payload: { locationId: target.id, shipIds: [transport.id] } },
            alpha.client
        );
        await vi.waitFor(() => expect(beta.last("server:ground:start")).toBeDefined());
        const battle = alpha.last("server:ground:start")!.payload;
        expect(battle).toMatchObject({
            locationId: target.id,
            attackerSideId: "alpha",
            defenderSideId: "beta",
            youAreAttacker: true,
            defenderUnits: [{ id: defender!.id }]
        });

        game.clientConnected(beta.client);
        const info: Partial<typeof battle> = { ...battle };
        delete info.youAreAttacker;
        expect(beta.last("server:map:init")!.payload.groundBattles).toEqual([info]);
        game.clientConnected(alpha.client);
        expect(alpha.last("server:map:init")!.payload.groundBattles).toEqual([info]);

        const marks = { alpha: alpha.messages.length, beta: beta.messages.length };
        game.queueMessage(
            {
                type: "client:ground:resolve",
                payload: { battleId: battle.battleId, winnerSideId: "alpha" }
            },
            alpha.client
        );
        await vi.waitFor(() => expect(beta.last("server:economy:state")).toBeDefined());
        for (const [connection, mark] of [
            [alpha, marks.alpha],
            [beta, marks.beta]
        ] as const) {
            const types = connection.types(mark);
            const resolved = types.indexOf("server:ground:resolved");
            expect(resolved).toBeGreaterThanOrEqual(0);
            expect(types.indexOf("server:tiles:update")).toBeGreaterThan(resolved);
            expect(types.indexOf("server:economy:state")).toBeGreaterThan(
                types.indexOf("server:tiles:update")
            );
            expect(connection.last("server:ground:resolved")!.payload).toMatchObject({
                captured: true,
                winnerSideId: "alpha",
                destroyedUnitIds: [defender!.id]
            });
        }
        expect(tileEntity(alpha, marks.alpha, target, target.id)).toMatchObject({
            sideId: "alpha",
            garrison: invaders
        });
        const economy = alpha.last("server:economy:state")!.payload;
        expect(economy.locations.map((l) => l.locationId)).toContain(target.id);
        expect(economy.groundUnits.map((u) => u.location)).toEqual([
            { kind: "garrison", locationId: target.id },
            { kind: "garrison", locationId: target.id }
        ]);
        expect(
            beta.last("server:economy:state")!.payload.locations.map((l) => l.locationId)
        ).toEqual(["home-b"]);
        game.destroyGame();
    });

    it("announces an undefended capture before the tiles and economy that confirm it", async () => {
        const { game, alpha, beta, target, transport } = invasionScenario(false);
        const marks = { alpha: alpha.messages.length, beta: beta.messages.length };
        game.queueMessage(
            { type: "client:invade", payload: { locationId: target.id, shipIds: [transport.id] } },
            alpha.client
        );
        await vi.waitFor(() => expect(beta.last("server:economy:state")).toBeDefined());
        for (const [connection, mark] of [
            [alpha, marks.alpha],
            [beta, marks.beta]
        ] as const) {
            const types = connection.types(mark);
            expect(types).not.toContain("server:ground:start");
            const resolved = types.indexOf("server:ground:resolved");
            expect(resolved).toBeGreaterThanOrEqual(0);
            expect(types.indexOf("server:tiles:update")).toBeGreaterThan(resolved);
            expect(types.indexOf("server:economy:state")).toBeGreaterThan(
                types.indexOf("server:tiles:update")
            );
        }
        expect(tileEntity(alpha, marks.alpha, target, target.id)).toMatchObject({
            sideId: "alpha"
        });
        game.destroyGame();
    });

    it("keeps economy groundUnits in sync through load, unload and a lost transport", async () => {
        const { game, alpha, beta, ship, home, invaders, transport } = invasionScenario(false);
        const units = () => alpha.last("server:economy:state")!.payload.groundUnits;
        game.entities.move(transport.id, home);
        game.queueMessage(
            {
                type: "client:unit:unload",
                payload: { shipId: transport.id, locationId: home.id, unitIds: invaders }
            },
            alpha.client
        );
        await vi.waitFor(() =>
            expect(units()?.every((u) => u.location.kind === "garrison")).toBe(true)
        );
        expect(tileEntity(alpha, 0, home, transport.id)).toMatchObject({ carriedUnitIds: [] });

        game.queueMessage(
            { type: "client:unit:load", payload: { shipId: transport.id, unitIds: [invaders[0]] } },
            alpha.client
        );
        await vi.waitFor(() =>
            expect(units()?.find((u) => u.id === invaders[0])?.location).toEqual({
                kind: "transport",
                shipId: transport.id
            })
        );
        expect(tileEntity(alpha, 0, home, transport.id)).toMatchObject({
            carriedUnitIds: [invaders[0]]
        });

        await moveShip(game, alpha, transport.id, { q: 4, r: 10 });
        ship("raider-b", "beta", { q: 6, r: 10 }, "frigate");
        const mark = beta.messages.length;
        game.queueMessage(
            { type: "client:ship:move", payload: { shipId: "raider-b", to: { q: 4, r: 10 } } },
            beta.client
        );
        await vi.waitFor(() => expect(beta.all("server:battle:start", mark)).toHaveLength(1));
        const battleId = beta.last("server:battle:start")!.payload.battleId;
        game.queueMessage(
            { type: "client:battle:resolve", payload: { battleId, winnerSideId: "beta" } },
            beta.client
        );
        await vi.waitFor(() => expect(units()?.map((u) => u.id)).toEqual([invaders[1]]));
        expect(alpha.last("server:battle:resolved")!.payload).toMatchObject({
            destroyedShipIds: [transport.id],
            destroyedUnitIds: [invaders[0]]
        });
        game.destroyGame();
    });
});
