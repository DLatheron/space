import {
    ClientId,
    ClientToServerMessage,
    GameId,
    ServerToClientMessage,
    SideId
} from "@space/shared-data";
import { CastToArray, Logger, MessageManager } from "@space/misc";
import { Client } from "./Client.js";
import { ClientManager } from "./ClientManager.js";
import { gameManager } from "./GameManager.js";
import { config } from "../config/config.schema.js";
import { generateSpaceMap, type SpaceMap } from "./map/generateSpaceMap.js";
import { Side } from "./Side.js";

const GAME_ID_CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const DEFAULT_SIDE_IDS: SideId[] = ["alpha", "beta"];

function randomSegment(length: number): string {
    let result = "";
    for (let i = 0; i < length; i++) {
        result += GAME_ID_CHARSET[Math.floor(Math.random() * GAME_ID_CHARSET.length)];
    }
    return result;
}

function generateGameId(): GameId {
    return `${randomSegment(4)}-${randomSegment(4)}`;
}

interface ClientMessageContext {
    game: Game;
}

export type ClientMessageManager = MessageManager<
    ClientMessageContext,
    ClientToServerMessage,
    Client
>;

/**
 * Authoritative game session: hex map, sides, shared per-side visibility.
 */
export class Game {
    readonly logger: Logger;

    private readonly _id: GameId;
    private readonly _ownerId: ClientId;
    private readonly _clientManager: ClientManager;
    private readonly _messageManager: ClientMessageManager;
    private readonly _sides = new Map<SideId, Side>();
    private readonly _map: SpaceMap;
    private _isDestroying = false;
    private _nextSideIndex = 0;

    constructor(ownerId: ClientId) {
        const gameId = generateGameId();

        this.logger = new Logger(`Game-${gameId}`, config.logLevels?.game);
        this._id = gameId;
        this._ownerId = ownerId;
        this._clientManager = new ClientManager();
        this._messageManager = new MessageManager({ game: this });

        for (const sideId of DEFAULT_SIDE_IDS) {
            this._sides.set(sideId, new Side(sideId));
        }

        const seed = config.mapSeed ?? Math.floor(Math.random() * 1_000_000_000);
        this._map = generateSpaceMap({
            width: config.mapWidth,
            height: config.mapHeight,
            hexSize: config.hexPointToPoint / 2,
            seed,
            sideIds: DEFAULT_SIDE_IDS
        });

        for (const side of this._sides.values()) {
            side.recomputeVisibility(this._map, config.visionRange);
        }

        this._registerMessageHandlers();
        this.logger.info(
            "Created game",
            this._id,
            "owned by",
            ownerId,
            "map",
            `${this._map.width}x${this._map.height}`,
            "seed",
            seed
        );
    }

    get gameId(): GameId {
        return this._id;
    }

    get id(): GameId {
        return this._id;
    }

    get ownerId(): ClientId {
        return this._ownerId;
    }

    get clients(): Client[] {
        return this._clientManager.clients;
    }

    get numClients(): number {
        return this._clientManager.clients.length;
    }

    get map(): SpaceMap {
        return this._map;
    }

    private _registerMessageHandlers() {
        this._messageManager.registerHandler("client:ping", (_context, payload, from) => {
            from.sendMessage({ type: "server:pong", payload: { nonce: payload.nonce } });
        });

        this._messageManager.registerHandler("client:rename", (_context, payload, from) => {
            from.name = payload.name;
        });
    }

    private _assignSide(client: Client): Side {
        const sideIds = Array.from(this._sides.keys());
        const sideId = sideIds[this._nextSideIndex % sideIds.length];
        this._nextSideIndex += 1;
        const side = this._sides.get(sideId)!;
        client.sideId = side.id;
        side.addClient(client.id);
        return side;
    }

    private _sendMapInit(client: Client, side: Side) {
        client.sendMessage({
            type: "server:map:init",
            payload: {
                width: this._map.width,
                height: this._map.height,
                hexSize: this._map.hexSize,
                sideId: side.id,
                tiles: side.buildTileViews(this._map),
                visible: side.visibleKeys()
            }
        });
    }

    addClient(clientId: ClientId, name: string): Client | null {
        const existingClient = this._clientManager.findClient(clientId);
        if (existingClient) {
            this.logger.warn(`Client ${clientId} is already in game ${this.gameId}`);
            return existingClient;
        }

        const client = new Client({ id: clientId, name }, this);
        this._clientManager.addClient(client);
        this.logger.info(`Client ${clientId} (${name}) added to game ${this.gameId}`);
        return client;
    }

    removeClient(clientId: ClientId): boolean {
        const client = this._clientManager.findClient(clientId);
        if (client?.sideId) {
            this._sides.get(client.sideId)?.removeClient(clientId);
        }

        const removed = this._clientManager.removeClient(clientId);

        if (removed && this.numClients === 0 && !this._isDestroying) {
            this.destroyGame();
            gameManager.removeGame(this.gameId);
        }

        return removed;
    }

    getClient(clientId: ClientId) {
        return this._clientManager.getClient(clientId);
    }

    findClient(clientId: ClientId): Client | undefined {
        return this._clientManager.findClient(clientId);
    }

    clientConnected(client: Client): void {
        client.sendMessage({
            type: "server:hello",
            payload: { gameId: this.gameId }
        });

        const side = client.sideId
            ? (this._sides.get(client.sideId) ?? this._assignSide(client))
            : this._assignSide(client);

        this._sendMapInit(client, side);

        this.broadcastMessage(
            {
                type: "server:client:connected",
                payload: { client: { id: client.id, name: client.name } }
            },
            client.id
        );
    }

    clientDisconnected(client: Client): void {
        this.broadcastMessage(
            {
                type: "server:client:disconnected",
                payload: { client: { id: client.id, name: client.name } }
            },
            client.id
        );
    }

    sendMessage(message: ServerToClientMessage, to: ClientId | ClientId[]) {
        const clients = CastToArray(to).map((clientId) => this.getClient(clientId));
        clients.forEach((client) => client.sendMessage(message));
    }

    broadcastMessage(message: ServerToClientMessage, exclude?: ClientId | ClientId[]) {
        const excludes = exclude ? CastToArray(exclude) : [];

        this.logger.info("Broadcasting", message.type, "excluding", excludes);

        for (const client of this._clientManager.clients) {
            if (!excludes.includes(client.id)) {
                client.sendMessage(message);
            }
        }
    }

    /** Send a tiles/visibility update to every client on a side. */
    broadcastToSide(sideId: SideId, message: ServerToClientMessage) {
        const side = this._sides.get(sideId);
        if (!side) return;
        for (const clientId of side.clientIds) {
            this.findClient(clientId)?.sendMessage(message);
        }
    }

    queueMessage(message: ClientToServerMessage, from: Client) {
        this._messageManager.enqueueMessage(message, from);
    }

    receiveMessage(data: MessageEvent, from: Client) {
        const messageString = data.toString();

        try {
            const message = ClientToServerMessage.parse(JSON.parse(messageString));
            this.queueMessage(message, from);
        } catch (error) {
            this.logger.error("Issue decoding message", messageString);
            throw error;
        }
    }

    destroyGame() {
        if (this._isDestroying) {
            return;
        }

        this._isDestroying = true;
        this.logger.info("Destroying game", this.gameId);

        while (this.clients.length > 0) {
            const client = this.clients[0];
            client.forceDisconnect();
            this._clientManager.removeClient(client.id);
        }
    }
}
