import {
    AxialCoord,
    BuildItem,
    BuildPriority,
    ClientId,
    ClientToServerMessage,
    CombatResult,
    EntityId,
    GameId,
    HexKey,
    OrderId,
    QueueDirection,
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
import { CarrierManager } from "./CarrierManager.js";
import { EconomyManager } from "./EconomyManager.js";
import type { EntityManager } from "./EntityManager.js";
import { GroundManager } from "./GroundManager.js";
import { HyperspaceManager, type HyperjumpEvent } from "./HyperspaceManager.js";
import { generateSpaceMap, type SpaceMap, type StarSystem } from "./map/generateSpaceMap.js";
import {
    MoveOrderManager,
    type MoveOrderKnowledge,
    type ShipMoveEvent
} from "./MoveOrderManager.js";
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

export type GameOptions = {
    /** Random numbers in [0, 1) for hyperspace jumps and combat; defaults to `Math.random`. */
    rng?: () => number;
};

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
    private readonly _moveOrders: MoveOrderManager;
    private readonly _hyperspace: HyperspaceManager;
    private readonly _carriers: CarrierManager;
    private _isDestroying = false;
    private _nextSideIndex = 0;

    constructor(ownerId: ClientId, options: GameOptions = {}) {
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
            sideIds: DEFAULT_SIDE_IDS,
            balance: config.economy
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
            balance: config.economy,
            research,
            homes: galaxy.homePlanets
        });
        this._battles = new BattleManager(this._entities, this._economy, { rng: options.rng });
        this._carriers = new CarrierManager(this._entities, this._economy.balance);
        this._supply = new SupplyManager(this._entities, this._economy, {
            battles: this._battles,
            knowledge: (sideId) => this._supplyKnowledge(sideId)
        });
        this._ground = new GroundManager(this._entities, this._economy, { rng: options.rng });
        this._moveOrders = new MoveOrderManager(this._entities, {
            economy: this._economy,
            knowledge: (sideId) => this._moveKnowledge(sideId)
        });
        this._hyperspace = new HyperspaceManager(this._entities, {
            battles: this._battles,
            economy: this._economy,
            rng: options.rng,
            isExplored: (sideId, hex) =>
                this._sides.get(sideId)?.explored.has(axialKey(hex.q, hex.r)) ?? false
        });
        this._turns = new TurnManager(
            this._sides.keys(),
            this._entities,
            this._economy,
            this._supply,
            { hyperspace: this._hyperspace, moveOrders: this._moveOrders }
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

    get moveOrders(): MoveOrderManager {
        return this._moveOrders;
    }

    get hyperspace(): HyperspaceManager {
        return this._hyperspace;
    }

    get carriers(): CarrierManager {
        return this._carriers;
    }

    side(sideId: SideId): Side | undefined {
        return this._sides.get(sideId);
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

        this._messageManager.registerHandler(
            "client:ship:order:cancel",
            (_context, payload, from) => {
                const result = this._moveOrders.cancel(from.sideId, payload.shipId);
                if (!result.ok) return this._reject(from, "order cancel", result.error);
                this._refreshShipHex(payload.shipId);
            }
        );

        this._messageManager.registerHandler("client:ship:hyperjump", (_context, payload, from) => {
            const result = this._hyperspace.activate(from.sideId, payload.shipId, payload.target);
            if (!result.ok) return this._reject(from, "hyperjump", result.error);
            this.logger.info("Ship", payload.shipId, "engaged hyperdrive to", payload.target);
            this._refreshShipHex(payload.shipId);
        });

        this._messageManager.registerHandler(
            "client:ship:hyperjump:cancel",
            (_context, payload, from) => {
                const result = this._hyperspace.cancel(from.sideId, payload.shipId);
                if (!result.ok) return this._reject(from, "hyperjump cancel", result.error);
                this._refreshShipHex(payload.shipId);
            }
        );

        this._messageManager.registerHandler("client:turn:end", (_context, _payload, from) => {
            this._handleTurnEnd(from);
        });

        this._messageManager.registerHandler("client:ship:load", (_context, payload, from) => {
            const result = this._carriers.load(from.sideId, payload.carrierId, payload.shipIds);
            if (!result.ok) return this._reject(from, "ship load", result.error);
            this.logger.info("Carrier", payload.carrierId, "loaded", payload.shipIds);
            this._refreshShipHex(payload.carrierId);
        });

        this._messageManager.registerHandler("client:ship:unload", (_context, payload, from) => {
            const result = this._carriers.unload(from.sideId, payload.carrierId, payload.shipIds);
            if (!result.ok) return this._reject(from, "ship unload", result.error);
            this.logger.info("Carrier", payload.carrierId, "unloaded", payload.shipIds);
            this._refreshShipHex(payload.carrierId);
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

        this._messageManager.registerHandler("client:order:move", (_context, payload, from) => {
            this._handleMoveOrder(from, payload.locationId, payload.orderId, payload.direction);
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
    }

    /** What a side believes about a hex for supply routing. */
    private _supplyKnowledge(sideId: SideId): SupplyKnowledge {
        const side = this._sides.get(sideId);
        return {
            isObstacle: (hex) => side?.knowsObstacleAt(this._entities, hex) ?? false,
            isHostile: (hex) => side?.knowsEnemyAt(this._entities, hex) ?? false,
            isVisible: (hex) => side?.seesAll([hex]) ?? false
        };
    }

    /** Planning knowledge for a side's ships: explored hexes only, around known obstacles. */
    private _moveKnowledge(sideId: SideId): MoveOrderKnowledge {
        const side = this._sides.get(sideId);
        if (!side) return {};
        return {
            isObstacle: (hex) => side.knowsObstacleAt(this._entities, hex),
            isExplored: (hex) => side.explored.has(axialKey(hex.q, hex.r))
        };
    }

    private _sendError(client: Client, message: string) {
        client.sendMessage({ type: "server:error", payload: { message } });
    }

    /** Resend a ship's hex so its owner sees order / hyperdrive changes. */
    private _refreshShipHex(shipId: EntityId) {
        const ship = this._entities.get(shipId);
        if (ship) this._refreshVisibility([axialKey(ship.q, ship.r)]);
    }

    private _handleShipMove(client: Client, shipId: EntityId, to: AxialCoord) {
        const outcome = this._battles.moveShip(
            client.sideId,
            shipId,
            to,
            client.sideId ? this._moveKnowledge(client.sideId) : {}
        );
        if (!outcome.ok) {
            this.logger.warn("Rejected move from", client.id, outcome.error);
            this._sendError(client, outcome.error);
            return;
        }

        const { move, combat } = outcome;
        if (!move && !combat) {
            this.logger.info("Ship", shipId, "ordered to", outcome.moveOrder?.destination);
            this._refreshShipHex(shipId);
            return;
        }
        const touched: HexKey[] = [];
        if (move) {
            const { ship, from, cost } = move;
            this.logger.info("Ship", ship.id, "moved", from, "->", move.to, "cost", cost);
            this._broadcastShipMoves([{ ship, from, to: move.to, path: move.path }]);
            touched.push(axialKey(from.q, from.r), axialKey(move.to.q, move.to.r));
        }
        const ship = this._entities.getOfKind(shipId, "ship");
        if (combat) {
            this.logger.info("Combat", combat.outcome, "at", combat.hex, combat.destroyedIds);
            this._broadcastCombat(combat);
            if (ship && combat.attackerMovedIn) {
                this._broadcastShipMoves([
                    { ship, from: combat.from, to: combat.hex, path: [combat.hex] }
                ]);
            }
            touched.push(axialKey(combat.hex.q, combat.hex.r));
            touched.push(axialKey(combat.from.q, combat.from.r));
        }
        this._refreshVisibility(touched, combat?.destroyedIds ?? []);
        const economyChanged = !!ship && this._economy.onShipMoved(ship);
        if (combat) {
            for (const sideId of this._combatSides(combat)) this._sendEconomyState(sideId);
        } else if (economyChanged) {
            this._sendEconomyState(ship!.sideId);
        }
    }

    /** Sides with a participant in the combat. */
    private _combatSides(combat: CombatResult): SideId[] {
        return [
            ...new Set([
                combat.attackerSideId,
                ...combat.defenderSideIds,
                ...combat.participants.map((p) => p.sideId)
            ])
        ];
    }

    /**
     * Sent before the tiles update to sides that can see the attacked hex or the attacker's
     * origin, and to the owners of every participant.
     */
    private _broadcastCombat(combat: CombatResult) {
        const message: ServerToClientMessage = { type: "server:combat", payload: combat };
        const involved = this._combatSides(combat);
        for (const side of this._sides.values()) {
            if (
                involved.includes(side.id) ||
                side.seesAll([combat.hex]) ||
                side.seesAll([combat.from])
            ) {
                this.broadcastToSide(side.id, message);
            }
        }
    }

    /**
     * Sent before the tiles update so clients animate along the real path. Other sides only
     * get a move when they can see every hex of the route (their own visibility doesn't
     * depend on this ship); otherwise they infer from tiles.
     */
    private _broadcastShipMoves(moves: ShipMoveEvent[]) {
        for (const { ship, from, to, path } of moves) {
            const moved: ServerToClientMessage = {
                type: "server:ship:moved",
                payload: {
                    shipId: ship.id,
                    from,
                    to,
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
        }
    }

    /**
     * Sent before the tiles update to the owner, sides that could see the origin or landing
     * hex, and sides that lost ships. Each jump's landing combat, if any, follows it.
     */
    private _broadcastJumps(jumps: HyperjumpEvent[]) {
        for (const jump of jumps) {
            const message: ServerToClientMessage = {
                type: "server:ship:jumped",
                payload: {
                    shipId: jump.shipId,
                    from: jump.from,
                    to: jump.to,
                    outcome: jump.outcome,
                    ...(jump.collidedWithId ? { collidedWithId: jump.collidedWithId } : {}),
                    destroyedIds: jump.destroyedIds,
                    ...(jump.displacedTo ? { displacedTo: jump.displacedTo } : {})
                }
            };
            for (const side of this._sides.values()) {
                if (
                    side.id === jump.sideId ||
                    jump.lossSideIds.includes(side.id) ||
                    side.seesAll([jump.from]) ||
                    side.seesAll([jump.to])
                ) {
                    this.broadcastToSide(side.id, message);
                }
            }
            if (jump.combat) this._broadcastCombat(jump.combat);
        }
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
     * After an advance: hyperspace jumps with their landing combats, move order steps, supply
     * ship moves and ambushes (each visibility-filtered), then tiles and every side's economy.
     */
    private _broadcastAdvance({ jumps, orders, economy, supply }: EndTurnResult) {
        if (economy && economy.completed.length > 0) {
            this.logger.info("Builds completed", economy.completed);
        }
        const touched: HexKey[] = [];
        const removed: EntityId[] = [];
        if (jumps && jumps.length > 0) {
            this.logger.info("Hyperspace jumps", jumps);
            this._broadcastJumps(jumps);
            for (const jump of jumps) {
                touched.push(axialKey(jump.from.q, jump.from.r), axialKey(jump.to.q, jump.to.r));
                if (jump.displacedTo)
                    touched.push(axialKey(jump.displacedTo.q, jump.displacedTo.r));
                removed.push(...jump.destroyedIds, ...(jump.combat?.destroyedIds ?? []));
            }
        }
        if (orders) {
            this._broadcastShipMoves(orders.moves);
            for (const move of orders.moves) touched.push(axialKey(move.from.q, move.from.r));
        }
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
            for (const combat of supply.combats) {
                this.logger.info("Supply ambush", combat.outcome, "at", combat.hex);
                this._broadcastCombat(combat);
                touched.push(axialKey(combat.hex.q, combat.hex.r));
                touched.push(axialKey(combat.from.q, combat.from.r));
                removed.push(...combat.destroyedIds);
            }
            for (const arrival of supply.arrivals) {
                touched.push(axialKey(arrival.at.q, arrival.at.r));
                if (!arrival.waiting) removed.push(arrival.supplyShipId);
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

    private _handleMoveOrder(
        client: Client,
        locationId: EntityId,
        orderId: OrderId,
        direction: QueueDirection
    ) {
        const result = this._economy.moveOrder(client.sideId, locationId, orderId, direction);
        if (!result.ok) return this._reject(client, "move order", result.error);
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
        const { location, defenderSideId, combat } = result;
        this.logger.info(
            "Side",
            client.sideId,
            "invaded",
            location.id,
            combat.outcome,
            combat.captured ? "(captured)" : ""
        );
        this._broadcastCombat(combat);
        this._refreshVisibility([axialKey(location.q, location.r)]);
        this._sendEconomyState(client.sideId!);
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
                economy: this._economy.stateFor(side.id),
                balance: this._economy.balance
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
