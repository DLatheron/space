import {
    AxialCoord,
    BattleId,
    BattleInfo,
    BuildItem,
    BuildPriority,
    ClientId,
    ClientToServerMessage,
    EntityId,
    GameId,
    GroundBattleInfo,
    HexKey,
    OrderId,
    ServerToClientMessage,
    SideId
} from "@space/shared-data";
import { CastToArray, Logger, MessageManager } from "@space/misc";
import { Client } from "./Client.js";
import { ClientManager } from "./ClientManager.js";
import { gameManager } from "./GameManager.js";
import { axialKey } from "@space/maths";
import { config } from "../config/config.schema.js";
import { BattleManager } from "./Battle.js";
import { EconomyManager } from "./EconomyManager.js";
import type { EntityManager } from "./EntityManager.js";
import { GroundManager } from "./GroundManager.js";
import { generateSpaceMap, type SpaceMap, type StarSystem } from "./map/generateSpaceMap.js";
import { ResearchManager } from "./ResearchManager.js";
import { Side, type VisibilityDiff } from "./Side.js";
import { SupplyManager, type SupplyKnowledge } from "./SupplyManager.js";
import { TurnManager, type EndTurnResult } from "./TurnManager.js";

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
    private readonly _entities: EntityManager;
    private readonly _systems: StarSystem[];
    private readonly _turns: TurnManager;
    private readonly _battles: BattleManager;
    private readonly _economy: EconomyManager;
    private readonly _supply: SupplyManager;
    private readonly _ground: GroundManager;
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
            this._sides.set(sideId, new Side(sideId, { fullVisibility: config.fullVisibility }));
        }

        const seed = config.mapSeed ?? Math.floor(Math.random() * 1_000_000_000);
        const galaxy = generateSpaceMap({
            width: config.mapWidth,
            height: config.mapHeight,
            hexSize: config.hexPointToPoint / 2,
            seed,
            sideIds: DEFAULT_SIDE_IDS
        });
        this._map = galaxy.map;
        this._entities = galaxy.entities;
        this._systems = galaxy.systems;
        const research = new ResearchManager({
            baseSupplySpeed: config.supplySpeed,
            baseSupplyCapacity: config.supplyCapacity
        });
        this._economy = new EconomyManager(this._entities, this._sides.keys(), {
            instantBuild: config.instantBuild,
            research,
            homes: galaxy.homePlanets
        });
        this._battles = new BattleManager(this._entities, this._economy);
        this._supply = new SupplyManager(this._entities, this._economy, {
            battles: this._battles,
            knowledge: (sideId) => this._supplyKnowledge(sideId)
        });
        this._ground = new GroundManager(this._entities, this._economy, this._battles);
        this._turns = new TurnManager(
            this._sides.keys(),
            this._entities,
            this._economy,
            this._supply
        );

        for (const side of this._sides.values()) {
            side.recomputeVisibility(this._entities, config.visionRange, config.supplyVisionRange);
            if (config.revealMap) {
                side.exploreAll(this._entities);
            }
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
            seed,
            "systems",
            this._systems.length,
            "entities",
            this._entities.size
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

    get entities(): EntityManager {
        return this._entities;
    }

    get turns(): TurnManager {
        return this._turns;
    }

    get battles(): BattleManager {
        return this._battles;
    }

    get economy(): EconomyManager {
        return this._economy;
    }

    get supply(): SupplyManager {
        return this._supply;
    }

    get ground(): GroundManager {
        return this._ground;
    }

    private _registerMessageHandlers() {
        this._messageManager.registerHandler("client:ping", (_context, payload, from) => {
            from.sendMessage({ type: "server:pong", payload: { nonce: payload.nonce } });
        });

        this._messageManager.registerHandler("client:rename", (_context, payload, from) => {
            from.name = payload.name;
        });

        this._messageManager.registerHandler("client:ship:move", (_context, payload, from) => {
            this._handleShipMove(from, payload.shipId, payload.to);
        });

        this._messageManager.registerHandler("client:turn:end", (_context, _payload, from) => {
            this._handleTurnEnd(from);
        });

        this._messageManager.registerHandler("client:battle:resolve", (_context, payload, from) => {
            this._handleBattleResolve(from, payload.battleId, payload.winnerSideId);
        });

        this._messageManager.registerHandler("client:location:build", (_context, payload, from) => {
            this._handleBuild(from, payload.locationId, payload.item, payload.priority);
        });

        this._messageManager.registerHandler(
            "client:location:cancel",
            (_context, payload, from) => {
                this._handleCancel(from, payload.locationId, payload.orderId);
            }
        );

        this._messageManager.registerHandler("client:order:priority", (_context, payload, from) => {
            this._handlePriority(from, payload.locationId, payload.orderId, payload.priority);
        });

        this._messageManager.registerHandler(
            "client:location:colonise",
            (_context, payload, from) => {
                this._handleColonise(from, payload.locationId, payload.shipId);
            }
        );

        this._messageManager.registerHandler("client:unit:load", (_context, payload, from) => {
            this._handleUnitLoad(from, payload.shipId, payload.unitIds);
        });

        this._messageManager.registerHandler("client:unit:unload", (_context, payload, from) => {
            this._handleUnitUnload(from, payload.shipId, payload.locationId, payload.unitIds);
        });

        this._messageManager.registerHandler("client:invade", (_context, payload, from) => {
            this._handleInvade(from, payload.locationId, payload.shipIds);
        });

        this._messageManager.registerHandler("client:ground:resolve", (_context, payload, from) => {
            this._handleGroundResolve(from, payload.battleId, payload.winnerSideId);
        });
    }

    /** What a side believes about a hex for supply routing (pending battles count as hostile). */
    private _supplyKnowledge(sideId: SideId): SupplyKnowledge {
        const side = this._sides.get(sideId);
        return {
            isObstacle: (hex) => side?.knowsObstacleAt(this._entities, hex) ?? false,
            isHostile: (hex) => {
                if (side?.knowsEnemyAt(this._entities, hex)) return true;
                const battle = this._battles.findAt(hex);
                return (
                    !!battle &&
                    (battle.attackerSideId === sideId ||
                        battle.defenderSideId === sideId ||
                        !!side?.seesAll([hex]))
                );
            },
            isVisible: (hex) => side?.seesAll([hex]) ?? false
        };
    }

    private _sendError(client: Client, message: string) {
        client.sendMessage({ type: "server:error", payload: { message } });
    }

    private _handleShipMove(client: Client, shipId: EntityId, to: AxialCoord) {
        const side = client.sideId ? this._sides.get(client.sideId) : undefined;
        const outcome = this._battles.moveShip(client.sideId, shipId, to, {
            isObstacle: side ? (hex) => side.knowsObstacleAt(this._entities, hex) : undefined
        });
        if (!outcome.ok) {
            this.logger.warn("Rejected move from", client.id, outcome.error);
            this._sendError(client, outcome.error);
            return;
        }

        const result = outcome.move;
        const { ship, from, path, cost } = result;
        this.logger.info("Ship", ship.id, "moved", from, "->", result.to, "cost", cost);

        // Sent before the tiles update so clients animate along the real path. Other
        // sides only get it when they can see every hex of the route (their own
        // visibility doesn't depend on this ship); otherwise they infer from tiles.
        const moved: ServerToClientMessage = {
            type: "server:ship:moved",
            payload: {
                shipId: ship.id,
                from,
                to: result.to,
                path,
                facing: ship.facing,
                movementPoints: ship.movementPoints
            }
        };
        for (const other of this._sides.values()) {
            if (other.id === ship.sideId || other.seesAll([from, ...path])) {
                this.broadcastToSide(other.id, moved);
            }
        }

        this._refreshVisibility([axialKey(from.q, from.r), axialKey(result.to.q, result.to.r)]);
        if (this._economy.onShipMoved(ship)) this._sendEconomyState(ship.sideId);

        if (outcome.battle) {
            this.logger.info("Battle", outcome.battle.battleId, "started", outcome.battle);
            this._sendBattleStart(outcome.battle);
        }
    }

    private _sendBattleStart(battle: BattleInfo) {
        for (const sideId of [battle.attackerSideId, battle.defenderSideId]) {
            this.broadcastToSide(sideId, {
                type: "server:battle:start",
                payload: { ...battle, youAreAttacker: sideId === battle.attackerSideId }
            });
        }
    }

    private _handleBattleResolve(client: Client, battleId: BattleId, winnerSideId: SideId) {
        const battle = this._battles.get(battleId);
        // Capture viewers first: losers may lose sight of the hex once their ships are gone.
        const viewers = battle
            ? [...this._sides.values()].filter(
                  (side) =>
                      side.id === battle.attackerSideId ||
                      side.id === battle.defenderSideId ||
                      side.seesAll([battle])
              )
            : [];

        const result = this._battles.resolve(battleId, client.sideId, winnerSideId);
        if (!result.ok) {
            this.logger.warn("Rejected battle resolve from", client.id, result.error);
            this._sendError(client, result.error);
            return;
        }

        const { q, r } = result.battle;
        this.logger.info("Battle", battleId, "won by", winnerSideId, result.destroyedShipIds);
        const resolved: ServerToClientMessage = {
            type: "server:battle:resolved",
            payload: {
                battleId,
                q,
                r,
                winnerSideId,
                loserSideId: result.loserSideId,
                destroyedShipIds: result.destroyedShipIds,
                destroyedUnitIds: result.destroyedUnitIds
            }
        };
        for (const side of viewers) {
            this.broadcastToSide(side.id, resolved);
        }

        this._refreshVisibility([axialKey(q, r)], result.destroyedShipIds);
        this._sendEconomyState(result.battle.attackerSideId);
        this._sendEconomyState(result.battle.defenderSideId);
    }

    private _handleTurnEnd(client: Client) {
        if (!client.sideId || !this._sides.has(client.sideId)) {
            this._sendError(client, "You are not assigned to a side");
            return;
        }

        const result = this._turns.endTurn(client.sideId);
        this.logger.info("Side", client.sideId, "ended turn", result.state);
        if (result.advanced) this._broadcastAdvance(result);
        this._broadcastTurnState();
    }

    /**
     * After an advance: supply ship moves (visibility-filtered like ship moves), battles
     * started by supply ships, then tiles and every side's economy.
     */
    private _broadcastAdvance({ economy, supply }: EndTurnResult) {
        if (economy && economy.completed.length > 0) {
            this.logger.info("Builds completed", economy.completed);
        }
        const touched: HexKey[] = [];
        const removed: EntityId[] = [];
        if (supply) {
            const launched = new Set([...supply.returning, ...supply.dispatched].map((s) => s.id));
            for (const move of supply.moves) {
                for (const side of this._sides.values()) {
                    if (side.id !== move.ship.sideId && !side.seesAll([move.from, ...move.path])) {
                        continue;
                    }
                    const summary = launched.has(move.ship.id)
                        ? side.summarize(move.ship)
                        : undefined;
                    this.broadcastToSide(side.id, {
                        type: "server:supply:moved",
                        payload: {
                            supplyShipId: move.ship.id,
                            from: move.from,
                            to: move.to,
                            path: move.path,
                            facing: move.ship.facing,
                            ...(summary?.kind === "supply_ship" ? { supplyShip: summary } : {})
                        }
                    });
                }
                touched.push(axialKey(move.from.q, move.from.r));
            }
            for (const arrival of supply.arrivals) {
                touched.push(axialKey(arrival.at.q, arrival.at.r));
                removed.push(arrival.supplyShipId);
            }
        }
        // Ship hexes (spawns included) are resent so clients see restored MP.
        for (const vessel of [
            ...this._entities.ofKind("ship"),
            ...this._entities.ofKind("supply_ship")
        ]) {
            touched.push(axialKey(vessel.q, vessel.r));
        }
        for (const unit of economy?.spawnedUnits ?? []) {
            const location =
                unit.location.kind === "garrison"
                    ? this._economy.locationEntity(unit.location.locationId)
                    : undefined;
            if (location) touched.push(axialKey(location.q, location.r));
        }
        this._refreshVisibility(touched, removed);
        for (const battle of supply?.battles ?? []) {
            this.logger.info("Battle", battle.battleId, "started by supply ship", battle);
            this._sendBattleStart(battle);
        }
        for (const sideId of this._sides.keys()) this._sendEconomyState(sideId);
    }

    private _reject(client: Client, what: string, error: string) {
        this.logger.warn("Rejected", what, "from", client.id, error);
        this._sendError(client, error);
    }

    private _handleBuild(
        client: Client,
        locationId: EntityId,
        item: BuildItem,
        priority: BuildPriority
    ) {
        const result = this._economy.build(client.sideId, locationId, item, priority);
        if (!result.ok) return this._reject(client, "build", result.error);
        this.logger.info(
            "Side",
            client.sideId,
            result.completed ? "built" : "ordered",
            item,
            "at",
            locationId
        );
        const location = this._economy.locationEntity(locationId);
        if (location && (result.spawnedShip || result.spawnedUnit)) {
            this._refreshVisibility([axialKey(location.q, location.r)]);
        }
        this._sendEconomyState(client.sideId!);
    }

    private _handleCancel(client: Client, locationId: EntityId, orderId: OrderId) {
        const result = this._economy.cancel(client.sideId, locationId, orderId);
        if (!result.ok) return this._reject(client, "cancel", result.error);
        this.logger.info("Side", client.sideId, "cancelled", orderId, "at", locationId);
        this._sendEconomyState(client.sideId!);
    }

    private _handlePriority(
        client: Client,
        locationId: EntityId,
        orderId: OrderId,
        priority: BuildPriority
    ) {
        const result = this._economy.setPriority(client.sideId, locationId, orderId, priority);
        if (!result.ok) return this._reject(client, "priority", result.error);
        this._sendEconomyState(client.sideId!);
    }

    private _handleColonise(client: Client, locationId: EntityId, shipId: EntityId) {
        const result = this._economy.colonise(client.sideId, locationId, shipId);
        if (!result.ok) return this._reject(client, "colonise", result.error);
        const { location, consumedShipId } = result;
        this.logger.info("Side", client.sideId, "colonised", location.id, "using", consumedShipId);
        this._refreshVisibility([axialKey(location.q, location.r)], [consumedShipId]);
        this._sendEconomyState(client.sideId!);
    }

    private _handleUnitLoad(client: Client, shipId: EntityId, unitIds: EntityId[]) {
        const result = this._ground.load(client.sideId, shipId, unitIds);
        if (!result.ok) return this._reject(client, "load", result.error);
        this._afterUnitTransfer(client.sideId!, shipId);
    }

    private _handleUnitUnload(
        client: Client,
        shipId: EntityId,
        locationId: EntityId,
        unitIds: EntityId[]
    ) {
        const result = this._ground.unload(client.sideId, shipId, locationId, unitIds);
        if (!result.ok) return this._reject(client, "unload", result.error);
        this._afterUnitTransfer(client.sideId!, shipId);
    }

    private _afterUnitTransfer(sideId: SideId, shipId: EntityId) {
        const ship = this._entities.get(shipId);
        if (ship) this._refreshVisibility([axialKey(ship.q, ship.r)]);
        this._sendEconomyState(sideId);
    }

    private _handleInvade(client: Client, locationId: EntityId, shipIds: EntityId[]) {
        const result = this._ground.invade(client.sideId, locationId, shipIds);
        if (!result.ok) return this._reject(client, "invasion", result.error);
        const { location, defenderSideId, battle } = result;
        const attackerSideId = client.sideId!;
        const hex = axialKey(location.q, location.r);
        if (battle) {
            this.logger.info("Ground battle", battle.battleId, "started", battle);
            this._refreshVisibility([hex]);
            this._sendGroundStart(battle);
        } else {
            this.logger.info("Side", attackerSideId, "captured undefended", location.id);
            const viewers = this._groundViewers(location, attackerSideId, defenderSideId);
            const resolved: ServerToClientMessage = {
                type: "server:ground:resolved",
                payload: {
                    battleId: `capture-${location.id}-${this._turns.turn}`,
                    locationId: location.id,
                    q: location.q,
                    r: location.r,
                    winnerSideId: attackerSideId,
                    loserSideId: defenderSideId,
                    destroyedUnitIds: [],
                    captured: true
                }
            };
            for (const side of viewers) this.broadcastToSide(side.id, resolved);
            this._refreshVisibility([hex]);
        }
        this._sendEconomyState(attackerSideId);
        this._sendEconomyState(defenderSideId);
    }

    private _sendGroundStart(battle: GroundBattleInfo) {
        for (const sideId of [battle.attackerSideId, battle.defenderSideId]) {
            this.broadcastToSide(sideId, {
                type: "server:ground:start",
                payload: { ...battle, youAreAttacker: sideId === battle.attackerSideId }
            });
        }
    }

    /** Both combatants plus every side that can currently see the location. */
    private _groundViewers(hex: AxialCoord, attackerSideId: SideId, defenderSideId: SideId) {
        return [...this._sides.values()].filter(
            (side) =>
                side.id === attackerSideId || side.id === defenderSideId || side.seesAll([hex])
        );
    }

    private _handleGroundResolve(client: Client, battleId: BattleId, winnerSideId: SideId) {
        const battle = this._ground.get(battleId);
        // Capture viewers first: the loser may lose sight of the location once it changes hands.
        const viewers = battle
            ? this._groundViewers(battle, battle.attackerSideId, battle.defenderSideId)
            : [];
        const result = this._ground.resolve(battleId, client.sideId, winnerSideId);
        if (!result.ok) return this._reject(client, "ground resolve", result.error);

        const { locationId, q, r, attackerSideId, defenderSideId } = result.battle;
        this.logger.info("Ground battle", battleId, "won by", winnerSideId, result);
        const resolved: ServerToClientMessage = {
            type: "server:ground:resolved",
            payload: {
                battleId,
                locationId,
                q,
                r,
                winnerSideId,
                loserSideId: result.loserSideId,
                destroyedUnitIds: result.destroyedUnitIds,
                captured: result.captured
            }
        };
        for (const side of viewers) this.broadcastToSide(side.id, resolved);
        this._refreshVisibility([axialKey(q, r)]);
        this._sendEconomyState(attackerSideId);
        this._sendEconomyState(defenderSideId);
    }

    private _sendEconomyState(sideId: SideId) {
        if (!this._sides.has(sideId)) return;
        this.broadcastToSide(sideId, {
            type: "server:economy:state",
            payload: this._economy.stateFor(sideId)
        });
    }

    /**
     * Recompute FOW for every side and send each side its `server:tiles:update`
     * diff. `touched` hexes had their contents change and are resent if visible.
     * `destroyed` entities are scrubbed from every side's memory.
     */
    private _refreshVisibility(touched: HexKey[], destroyed: EntityId[] = []) {
        for (const side of this._sides.values()) {
            const diff = side.recomputeVisibility(
                this._entities,
                config.visionRange,
                config.supplyVisionRange
            );
            const forgotten = side.forgetEntities(destroyed);
            diff.forgetEntityIds = [...new Set([...diff.forgetEntityIds, ...forgotten])];
            this._sendTilesUpdate(side, diff, touched);
        }
    }

    private _sendTilesUpdate(side: Side, diff: VisibilityDiff, touched: Iterable<HexKey>) {
        const payload = side.buildTilesUpdate(this._entities, diff, touched);
        if (payload) {
            this.broadcastToSide(side.id, { type: "server:tiles:update", payload });
        }
    }

    private _broadcastTurnState() {
        const state = this._turns.state();
        for (const client of this._clientManager.clients) {
            if (!client.sideId) continue;
            client.sendMessage({
                type: "server:turn:state",
                payload: { ...state, yourSideId: client.sideId }
            });
        }
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
                tiles: side.buildTileViews(this._entities),
                visible: side.visibleKeys(),
                turn: this._turns.state(),
                battles: this._battles.involving(side.id),
                groundBattles: this._ground.involving(side.id),
                economy: this._economy.stateFor(side.id)
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
