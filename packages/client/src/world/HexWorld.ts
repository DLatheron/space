import {
    axialDirectionAngle,
    axialDirectionTowards,
    axialToOffset,
    axialToPixel,
    hexCorners,
    hexHorizSpacing,
    hexReachable,
    hexVertSpacing,
    planHexPath,
    type Axial,
    type HexPathOptions,
    type Pixel
} from "@space/maths";
import {
    hexHasObstacle,
    MOVE_COST_PER_HEX,
    PLANET_LEVEL_MAX,
    SHIP_TYPES,
    siteForEntity,
    sumResources,
    type AxialCoord,
    type BattleId,
    type BattleInfo,
    type BuildContext,
    type EconomyState,
    type EntityId,
    type EntityOfKind,
    type EntitySummary,
    type GroundBattleInfo,
    type GroundUnit,
    type HexKey,
    type LocationEconomy,
    type LocationEntity,
    type Resources,
    type SideId,
    type TechId,
    type TileView,
    type TurnState
} from "@space/shared-data";
import { Explosions } from "./Explosions.js";
import { ShipMotion, SUPPLY_SHIP_MOTION, type MotionSpeeds, type ShipPose } from "./ShipMotion.js";

export type Camera = {
    x: number;
    y: number;
    zoom: number;
};

type ClientTile = {
    q: number;
    r: number;
    fog: "explored" | "visible";
    entities: EntitySummary[];
};

type DrawCtx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

type ShipSighting = { q: number; r: number; facing: number; seen: boolean };

type DeferredShip = { entity: MobileEntity; pose: ShipPose; fullColour: boolean };

/**
 * Ship gone from the map (destroyed, unloaded at its destination or lost from view) still
 * finishing its move animation. It explodes at the end when `colour` is set.
 */
type DyingShip = { entity: MobileEntity; motion: ShipMotion; colour?: string };

export type BattleResolved = {
    battleId: BattleId;
    q: number;
    r: number;
    winnerSideId: SideId;
    loserSideId: SideId;
    destroyedShipIds: EntityId[];
    destroyedUnitIds: EntityId[];
};

export type GroundBattleResolved = {
    battleId: BattleId;
    locationId: EntityId;
    q: number;
    r: number;
    winnerSideId: SideId;
    loserSideId: SideId;
    destroyedUnitIds: EntityId[];
    captured: boolean;
};

export type ShipEntity = EntityOfKind<"ship">;
export type SupplyShipEntity = EntityOfKind<"supply_ship">;
export type PlanetEntity = EntityOfKind<"planet">;
export type { LocationEntity };

/** Entities that move between hexes and animate doing so. */
export type MobileEntity = ShipEntity | SupplyShipEntity;

function isMobile(entity: EntitySummary): entity is MobileEntity {
    return entity.kind === "ship" || entity.kind === "supply_ship";
}

function motionSpeeds(entity: MobileEntity): MotionSpeeds {
    return entity.kind === "ship" ? SHIP_TYPES[entity.shipType] : SUPPLY_SHIP_MOTION;
}

export function isLocationEntity(entity: EntitySummary): entity is LocationEntity {
    return entity.kind === "planet" || entity.kind === "moon" || entity.kind === "large_asteroid";
}

/** Planets, moons and mineable asteroids: the locations that can be owned and built on. */
export function isBuildSite(entity: EntitySummary): entity is LocationEntity {
    return isLocationEntity(entity) && siteForEntity(entity) !== undefined;
}

export function isTransport(ship: ShipEntity): boolean {
    return (SHIP_TYPES[ship.shipType].unitCapacity ?? 0) > 0;
}

export type HexClickAction =
    | { type: "none" }
    | { type: "select"; shipId: EntityId }
    | { type: "inspect"; entityId: EntityId }
    | { type: "deselect" }
    | { type: "open-location"; locationId: EntityId }
    | { type: "move"; shipId: EntityId; to: AxialCoord };

/** What the right-hand info pane should display. */
export type MapFocus =
    | {
          mode: "selection" | "hover";
          hex: Axial;
          fog: "explored" | "visible" | "unexplored";
          entities: EntitySummary[];
          /** Primary entity for the pane header; null for an empty known hex. */
          entity: EntitySummary | null;
      }
    | { mode: "none" };

/** Prefer interactive / distinctive entities when several share a hex. */
const ENTITY_FOCUS_PRIORITY: Record<EntitySummary["kind"], number> = {
    ship: 0,
    planet: 1,
    moon: 2,
    supply_ship: 3,
    sun: 4,
    large_asteroid: 5,
    asteroid_belt: 6,
    wormhole: 7,
    black_hole: 8,
    hyperspace_tunnel: 9
};

export function primaryEntity(entities: EntitySummary[]): EntitySummary | null {
    if (!entities.length) return null;
    return [...entities].sort(
        (a, b) => ENTITY_FOCUS_PRIORITY[a.kind] - ENTITY_FOCUS_PRIORITY[b.kind]
    )[0];
}

const SIDE_COLOURS: Record<string, string> = {
    alpha: "#5cffb0",
    beta: "#ff6b8a"
};

export function sideColour(sideId: SideId | null | undefined, fallback: string): string {
    if (!sideId) return fallback;
    return SIDE_COLOURS[sideId] ?? "#ffd166";
}

function hexKey(q: number, r: number): HexKey {
    return `${q},${r}`;
}

/** Pointy-top pixel → fractional axial, rounded to the containing hex. */
export function pixelToAxial(p: Pixel, size: number): Axial {
    const fq = ((Math.sqrt(3) / 3) * p.x - (1 / 3) * p.y) / size;
    const fr = ((2 / 3) * p.y) / size;
    return axialRound(fq, fr);
}

function axialRound(fq: number, fr: number): Axial {
    const fs = -fq - fr;
    let q = Math.round(fq);
    let r = Math.round(fr);
    const s = Math.round(fs);
    const dq = Math.abs(q - fq);
    const dr = Math.abs(r - fr);
    const ds = Math.abs(s - fs);
    if (dq > dr && dq > ds) {
        q = -r - s;
    } else if (dr > ds) {
        r = -q - s;
    }
    return { q: q + 0, r: r + 0 };
}

/**
 * Client-side hex map FOW over parallax.
 * Unexplored = parallax only; explored/visible hexes drawn translucent on top.
 */
export class HexWorld {
    width = 0;
    height = 0;
    hexSize = 50;
    sideId: SideId | null = null;
    turn: TurnState | null = null;
    selectedShipId: EntityId | null = null;
    /** Non-ship (or enemy) entity kept in the info pane until cleared. */
    inspectedEntityId: EntityId | null = null;
    /** Hex currently under the pointer, or `null` when the cursor left the map. */
    hoveredHex: Axial | null = null;
    /** Our side's private economy; `null` until the first map init. */
    economy: EconomyState | null = null;

    private readonly _tiles = new Map<HexKey, ClientTile>();
    private readonly _visible = new Set<HexKey>();
    private readonly _listeners = new Set<() => void>();
    private _version = 0;
    /** Draw-only animations; logical positions in `_tiles` update immediately. */
    private readonly _motions = new Map<EntityId, ShipMotion>();
    /** Animated poses for the frame being rendered. */
    private readonly _framePoses = new Map<EntityId, ShipPose>();
    private readonly _explosions = new Explosions();
    private _dying: DyingShip[] = [];
    /** Pending battles involving our side. */
    private readonly _battles = new Map<BattleId, BattleInfo>();
    private readonly _groundBattles = new Map<BattleId, GroundBattleInfo>();

    camera: Camera = { x: 0, y: 0, zoom: 0.35 };

    get ready(): boolean {
        return this.width > 0 && this.height > 0;
    }

    subscribe = (listener: () => void): (() => void) => {
        this._listeners.add(listener);
        return () => {
            this._listeners.delete(listener);
        };
    };

    /** Bumped on every state change React cares about (selection, MP, turn, tiles). */
    getVersion = (): number => this._version;

    private _notify() {
        this._version++;
        for (const listener of this._listeners) {
            listener();
        }
    }

    applyMapInit(payload: {
        width: number;
        height: number;
        hexSize: number;
        sideId: SideId;
        tiles: TileView[];
        visible: HexKey[];
        turn: TurnState;
        battles: BattleInfo[];
        groundBattles: GroundBattleInfo[];
        economy: EconomyState;
    }) {
        this.width = payload.width;
        this.height = payload.height;
        this.hexSize = payload.hexSize;
        this.sideId = payload.sideId;
        this.turn = payload.turn;
        this.economy = payload.economy;
        this.selectedShipId = null;
        this.inspectedEntityId = null;
        this.hoveredHex = null;
        this._tiles.clear();
        this._visible.clear();
        this._motions.clear();
        this._explosions.clear();
        this._dying = [];
        this._battles.clear();
        for (const battle of payload.battles) {
            this._battles.set(battle.battleId, battle);
        }
        this._groundBattles.clear();
        for (const battle of payload.groundBattles) {
            this._groundBattles.set(battle.battleId, battle);
        }

        for (const key of payload.visible) {
            this._visible.add(key);
        }
        for (const tile of payload.tiles) {
            this._tiles.set(hexKey(tile.q, tile.r), {
                q: tile.q,
                r: tile.r,
                fog: tile.fog,
                entities: tile.entities
            });
        }

        this._centerCameraOnContent();
        this._notify();
    }

    applyTilesUpdate(payload: {
        tiles: TileView[];
        visible: HexKey[];
        forgetEntityIds?: string[];
    }) {
        const before = this._snapshotShips();
        const moving = this._movingEntities();
        this._visible.clear();
        for (const key of payload.visible) {
            this._visible.add(key);
        }

        if (payload.forgetEntityIds?.length) {
            const forget = new Set(payload.forgetEntityIds);
            for (const tile of this._tiles.values()) {
                tile.entities = tile.entities.filter((e) => !forget.has(e.id));
            }
        }

        for (const tile of payload.tiles) {
            // A ship arriving in this view may still linger in a remembered tile elsewhere.
            const incomingShipIds = new Set(tile.entities.filter(isMobile).map((e) => e.id));
            if (incomingShipIds.size) {
                this._removeEntities(incomingShipIds, hexKey(tile.q, tile.r));
            }
            this._tiles.set(hexKey(tile.q, tile.r), {
                q: tile.q,
                r: tile.r,
                fog: tile.fog,
                entities: tile.entities
            });
        }

        for (const [key, tile] of this._tiles) {
            tile.fog = this._visible.has(key) ? "visible" : "explored";
        }

        // An arriving supply ship is removed by the same update that follows its move.
        for (const [id, { entity, motion }] of moving) {
            if (this.findEntityById(id)) continue;
            this._motions.delete(id);
            this._dying.push({ entity, motion });
        }
        this._animateMovedShips(before);
        this._validateSelection();
        this._notify();
    }

    applyShipMoved(payload: {
        shipId: EntityId;
        from: AxialCoord;
        to: AxialCoord;
        path: AxialCoord[];
        facing: number;
        movementPoints: number;
    }) {
        const ship = this.findEntity(payload.shipId, "ship");
        if (!ship) return;
        this._applyMoved(
            { ...ship, movementPoints: payload.movementPoints },
            payload.from,
            payload.to,
            payload.path,
            payload.facing
        );
    }

    applySupplyMoved(payload: {
        supplyShipId: EntityId;
        from: AxialCoord;
        to: AxialCoord;
        path: AxialCoord[];
        facing: number;
        supplyShip?: SupplyShipEntity;
    }) {
        let supplyShip = this.findEntity(payload.supplyShipId, "supply_ship");
        if (!supplyShip && payload.supplyShip) {
            // Launched this turn: place it at its source so it flies out from there.
            const { from } = payload;
            supplyShip = {
                ...payload.supplyShip,
                q: from.q,
                r: from.r,
                facing: axialDirectionTowards(from, payload.path[0])
            };
            const key = hexKey(from.q, from.r);
            let source = this._tiles.get(key);
            if (!source) {
                source = { q: from.q, r: from.r, fog: "visible", entities: [] };
                this._tiles.set(key, source);
            }
            source.entities = [...source.entities, supplyShip];
        }
        if (!supplyShip) return;
        this._applyMoved(supplyShip, payload.from, payload.to, payload.path, payload.facing);
    }

    private _applyMoved(
        entity: MobileEntity,
        from: AxialCoord,
        to: AxialCoord,
        path: AxialCoord[],
        facing: number
    ) {
        const before = this._snapshotShips();
        const moved: MobileEntity = { ...entity, q: to.q, r: to.r, facing };
        this._removeEntities(new Set([entity.id]));

        const key = hexKey(to.q, to.r);
        let dest = this._tiles.get(key);
        if (!dest) {
            dest = { q: to.q, r: to.r, fog: "visible", entities: [] };
            this._tiles.set(key, dest);
        }
        dest.entities = [...dest.entities, moved];

        this._animateMovedShips(before, new Map([[entity.id, [from, ...path]]]));
        this._validateSelection();
        this._notify();
    }

    applyBattleStart(battle: BattleInfo) {
        this._battles.set(battle.battleId, battle);
        if (battle.attackerSideId === this.sideId) {
            this.selectedShipId = null;
            this.inspectedEntityId = null;
        }
        this._notify();
    }

    /**
     * Remove destroyed ships and blow them up: immediately at their hex, or once a
     * still-running move animation reaches its end.
     */
    applyBattleResolved(payload: BattleResolved) {
        this._battles.delete(payload.battleId);
        const now = performance.now();
        const colour = sideColour(payload.loserSideId, "#ffd166");

        for (const id of payload.destroyedShipIds) {
            const found = this.findEntityById(id);
            const ship = found && isMobile(found) ? found : undefined;
            const motion = this._motions.get(id);
            this._motions.delete(id);
            if (ship && motion && !motion.isDone(now)) {
                this._dying.push({ entity: ship, motion, colour });
                continue;
            }
            const at = axialToPixel(ship?.q ?? payload.q, ship?.r ?? payload.r, this.hexSize);
            this._explosions.spawn(at, colour, this.hexSize, now);
        }
        if (!payload.destroyedShipIds.length) {
            const at = axialToPixel(payload.q, payload.r, this.hexSize);
            this._explosions.spawn(at, colour, this.hexSize, now);
        }

        this._removeEntities(new Set(payload.destroyedShipIds));
        this._validateSelection();
        this._notify();
    }

    get battles(): BattleInfo[] {
        return [...this._battles.values()];
    }

    /** Pending battle our side must resolve, if any. */
    get battleToResolve(): BattleInfo | undefined {
        return this.battles.find((battle) => battle.attackerSideId === this.sideId);
    }

    /** Pending battle we are defending and waiting on the attacker for, if any. */
    get battleAwaited(): BattleInfo | undefined {
        return this.battles.find((battle) => battle.defenderSideId === this.sideId);
    }

    applyGroundStart(battle: GroundBattleInfo) {
        this._groundBattles.set(battle.battleId, battle);
        if (battle.attackerSideId === this.sideId) {
            this.selectedShipId = null;
            this.inspectedEntityId = null;
        }
        this._notify();
    }

    /**
     * Drop the battle and scrub lost units from remembered garrisons. On capture the
     * location changes hands here too, ahead of the tiles update that confirms it.
     */
    applyGroundResolved(payload: GroundBattleResolved) {
        this._groundBattles.delete(payload.battleId);
        const destroyed = new Set(payload.destroyedUnitIds);
        for (const tile of this._tiles.values()) {
            tile.entities = tile.entities.map((e) => {
                if (!isLocationEntity(e)) return e;
                const garrison = e.garrison?.filter((id) => !destroyed.has(id));
                const sideId =
                    payload.captured && e.id === payload.locationId
                        ? payload.winnerSideId
                        : e.sideId;
                return garrison || sideId !== e.sideId ? { ...e, sideId, garrison } : e;
            });
        }
        const colour = sideColour(payload.loserSideId, "#ffd166");
        const at = axialToPixel(payload.q, payload.r, this.hexSize);
        this._explosions.spawn(at, colour, this.hexSize, performance.now());
        this._notify();
    }

    get groundBattles(): GroundBattleInfo[] {
        return [...this._groundBattles.values()];
    }

    /** Pending ground battle our side invaded and must resolve, if any. */
    get groundBattleToResolve(): GroundBattleInfo | undefined {
        return this.groundBattles.find((battle) => battle.attackerSideId === this.sideId);
    }

    get groundBattleAwaited(): GroundBattleInfo | undefined {
        return this.groundBattles.find((battle) => battle.defenderSideId === this.sideId);
    }

    groundBattleAt(locationId: EntityId): GroundBattleInfo | undefined {
        return this.groundBattles.find((battle) => battle.locationId === locationId);
    }

    applyTurnState(payload: TurnState & { yourSideId?: SideId }) {
        this.turn = { turn: payload.turn, sideReady: payload.sideReady };
        if (payload.yourSideId) {
            this.sideId = payload.yourSideId;
        }
        this._notify();
    }

    applyEconomyState(economy: EconomyState) {
        this.economy = economy;
        this._notify();
    }

    /** Private economy for one of our planets, moons or asteroids, if we own it. */
    locationEconomy(locationId: EntityId): LocationEconomy | undefined {
        return this.economy?.locations.find((l) => l.locationId === locationId);
    }

    /** Inputs for `canBuild`; `shipCount` already includes ships on order. */
    get buildContext(): BuildContext | null {
        if (!this.economy) return null;
        const { shipCount, shipCap, techs, locations } = this.economy;
        const researching: TechId[] = [];
        for (const location of locations) {
            for (const order of location.orders) {
                if (order.item.kind === "research") researching.push(order.item.techId);
            }
        }
        return { shipCount, shipCap, techs, researching };
    }

    /** Stock held across every location we own. */
    get sideStockpile(): Resources {
        return sumResources(this.economy?.locations.map((l) => l.stockpile) ?? []);
    }

    /** Cargo aboard our supply ships. */
    get cargoInTransit(): Resources {
        return sumResources(this.economy?.supplyShips.map((s) => s.cargo) ?? []);
    }

    groundUnit(unitId: EntityId): GroundUnit | undefined {
        return this.economy?.groundUnits.find((u) => u.id === unitId);
    }

    /** Our ground units stationed at `locationId`. */
    garrisonAt(locationId: EntityId): GroundUnit[] {
        return (
            this.economy?.groundUnits.filter(
                (u) => u.location.kind === "garrison" && u.location.locationId === locationId
            ) ?? []
        );
    }

    /** Our ground units aboard transport `shipId`. */
    unitsAboard(shipId: EntityId): GroundUnit[] {
        return (
            this.economy?.groundUnits.filter(
                (u) => u.location.kind === "transport" && u.location.shipId === shipId
            ) ?? []
        );
    }

    /** Planned route for one of our supply ships (hexes ahead, excluding its current hex). */
    supplyRoute(supplyShipId: EntityId): AxialCoord[] {
        const own = this.economy?.supplyShips.find((s) => s.id === supplyShipId);
        return own?.route ?? this.findEntity(supplyShipId, "supply_ship")?.route ?? [];
    }

    entitiesAt(q: number, r: number): EntitySummary[] {
        return this._tiles.get(hexKey(q, r))?.entities ?? [];
    }

    /** Our warships (not supply ships) on `hex`. */
    ownShipsAt(q: number, r: number): ShipEntity[] {
        return this.entitiesAt(q, r).filter(
            (e): e is ShipEntity => e.kind === "ship" && e.sideId === this.sideId
        );
    }

    /** Our ships on `hex` that can colonise. */
    colonyShipsAt(q: number, r: number): ShipEntity[] {
        return this.ownShipsAt(q, r).filter((s) => !!SHIP_TYPES[s.shipType].canColonise);
    }

    /** Our transports on `hex`. */
    transportsAt(q: number, r: number): ShipEntity[] {
        return this.ownShipsAt(q, r).filter(isTransport);
    }

    /** Units a transport carries, per its entity (falls back to our economy's unit list). */
    carriedUnitIds(ship: ShipEntity): EntityId[] {
        return ship.carriedUnitIds ?? this.unitsAboard(ship.id).map((u) => u.id);
    }

    /** Unowned build site the selected colony ship is sitting on, if it could colonise it. */
    get colonisableLocation(): { ship: ShipEntity; location: LocationEntity } | undefined {
        const ship = this.selectedShip;
        if (!ship || ship.sideId !== this.sideId || !SHIP_TYPES[ship.shipType].canColonise) {
            return undefined;
        }
        const location = this.entitiesAt(ship.q, ship.r).find(
            (e): e is LocationEntity => isBuildSite(e) && e.sideId === null
        );
        return location ? { ship, location } : undefined;
    }

    /** Enemy location on `hex` plus our transports there that have units aboard. */
    invasionAt(
        q: number,
        r: number
    ): { location: LocationEntity; ships: ShipEntity[] } | undefined {
        const location = this.entitiesAt(q, r).find(
            (e): e is LocationEntity =>
                isLocationEntity(e) && e.sideId !== null && e.sideId !== this.sideId
        );
        if (!location || this.groundBattleAt(location.id)) return undefined;
        const ships = this.transportsAt(q, r).filter((s) => this.carriedUnitIds(s).length > 0);
        return ships.length ? { location, ships } : undefined;
    }

    /** Invasion the selected transport could launch from its hex. */
    get invasionOption(): { location: LocationEntity; ships: ShipEntity[] } | undefined {
        const ship = this.selectedShip;
        if (!ship || ship.sideId !== this.sideId || !isTransport(ship)) return undefined;
        return this.invasionAt(ship.q, ship.r);
    }

    /** Optimistically mark our side ready until the server confirms via `server:turn:state`. */
    markOwnSideReady() {
        if (!this.turn || !this.sideId) return;
        this.turn = {
            ...this.turn,
            sideReady: { ...this.turn.sideReady, [this.sideId]: true }
        };
        this._notify();
    }

    get ownSideReady(): boolean {
        return !!(this.sideId && this.turn?.sideReady[this.sideId]);
    }

    get selectedShip(): ShipEntity | undefined {
        return this.selectedShipId ? this.findEntity(this.selectedShipId, "ship") : undefined;
    }

    selectShip(shipId: EntityId | null) {
        if (shipId === null) {
            if (!this.selectedShipId && !this.inspectedEntityId) return;
            this.selectedShipId = null;
            this.inspectedEntityId = null;
            this._notify();
            return;
        }
        if (this.selectedShipId === shipId) return;
        this.selectedShipId = shipId;
        this.inspectedEntityId = null;
        this._notify();
    }

    inspectEntity(entityId: EntityId | null) {
        if (entityId === null) {
            if (!this.inspectedEntityId) return;
            this.inspectedEntityId = null;
            this._notify();
            return;
        }
        if (this.inspectedEntityId === entityId) return;
        this.inspectedEntityId = entityId;
        this.selectedShipId = null;
        this._notify();
    }

    setHoveredHex(hex: Axial | null) {
        if (hex === null) {
            if (this.hoveredHex === null) return;
            this.hoveredHex = null;
            this._notify();
            return;
        }
        if (this.hoveredHex?.q === hex.q && this.hoveredHex?.r === hex.r) return;
        this.hoveredHex = hex;
        this._notify();
    }

    /**
     * Selection wins over hover. Own ships use `selectedShipId`; other map entities
     * use `inspectedEntityId`. With neither, the pane follows the cursor.
     */
    get mapFocus(): MapFocus {
        if (this.selectedShipId) {
            const ship = this.findEntity(this.selectedShipId, "ship");
            if (ship) return this._focusAt(ship.q, ship.r, ship, "selection");
        }
        if (this.inspectedEntityId) {
            const entity = this.findEntityById(this.inspectedEntityId);
            if (entity) return this._focusAt(entity.q, entity.r, entity, "selection");
        }
        if (this.hoveredHex) {
            return this._focusAt(this.hoveredHex.q, this.hoveredHex.r, null, "hover");
        }
        return { mode: "none" };
    }

    private _focusAt(
        q: number,
        r: number,
        preferred: EntitySummary | null,
        mode: "selection" | "hover"
    ): MapFocus {
        const tile = this._tiles.get(hexKey(q, r));
        if (!tile) {
            return {
                mode,
                hex: { q, r },
                fog: "unexplored",
                entities: preferred ? [preferred] : [],
                entity: preferred
            };
        }
        const entities = tile.entities;
        return {
            mode,
            hex: { q, r },
            fog: tile.fog,
            entities,
            entity: preferred ?? primaryEntity(entities)
        };
    }

    findEntityById(id: EntityId): EntitySummary | undefined {
        for (const tile of this._tiles.values()) {
            for (const entity of tile.entities) {
                if (entity.id === id) return entity;
            }
        }
        return undefined;
    }

    findEntity<K extends EntitySummary["kind"]>(
        id: EntityId,
        kind: K
    ): EntityOfKind<K> | undefined {
        const entity = this.findEntityById(id);
        return entity?.kind === kind ? (entity as EntityOfKind<K>) : undefined;
    }

    isOnMap(q: number, r: number): boolean {
        const { col, row } = axialToOffset(q, r);
        return col >= 0 && row >= 0 && col < this.width && row < this.height;
    }

    /** Whether our known contents of `hex` block pathing; unexplored hexes are open. */
    isKnownObstacle(hex: Axial): boolean {
        return hexHasObstacle(this._tiles.get(hexKey(hex.q, hex.r))?.entities ?? []);
    }

    private _pathOptions(): HexPathOptions {
        return {
            inBounds: (h) => this.isOnMap(h.q, h.r),
            passable: (h) => !this.isKnownObstacle(h)
        };
    }

    /**
     * Hexes the selected ship can reach this turn going around known obstacles
     * (excluding its own hex). Obstacles are included when they are the final step.
     */
    reachableHexes(): Axial[] {
        const ship = this.selectedShip;
        if (!ship) return [];
        const steps = Math.floor(ship.movementPoints / MOVE_COST_PER_HEX);
        if (steps <= 0) return [];
        return hexReachable(ship, steps, this._pathOptions());
    }

    pickHex(screen: Pixel, canvas: HTMLCanvasElement): Axial | null {
        if (!this.ready) return null;
        const hex = pixelToAxial(this.screenToWorld(screen, canvas), this.hexSize);
        return this.isOnMap(hex.q, hex.r) ? hex : null;
    }

    /** Decide what a click (not drag) at `screen` should do; selection changes are applied here. */
    handleClick(screen: Pixel, canvas: HTMLCanvasElement): HexClickAction {
        if (this.battleToResolve || this.groundBattleToResolve) return { type: "none" };
        const hex = this.pickHex(screen, canvas);
        if (!hex) {
            return this._deselect();
        }

        const tile = this._tiles.get(hexKey(hex.q, hex.r));
        const entities = tile?.entities ?? [];

        const ownShips = entities.filter(
            (e): e is ShipEntity => e.kind === "ship" && e.sideId === this.sideId
        );
        if (ownShips.length) {
            // Cycle through stacked ships; clicking the only selected ship deselects it.
            const index = ownShips.findIndex((s) => s.id === this.selectedShipId);
            if (index >= 0 && ownShips.length === 1) {
                return this._deselect();
            }
            const next = ownShips[(index + 1) % ownShips.length];
            this.selectShip(next.id);
            return { type: "select", shipId: next.id };
        }

        const location = primaryEntity(entities.filter(isBuildSite));
        const ship = this.selectedShip;
        if (ship && ship.movementPoints >= MOVE_COST_PER_HEX) {
            const inRange = this.reachableHexes().some((h) => h.q === hex.q && h.r === hex.r);
            // Beyond range the ship heads that way and stops when MP run out, except
            // that far locations still open their page.
            if (inRange || !location) {
                return { type: "move", shipId: ship.id, to: { q: hex.q, r: hex.r } };
            }
        }

        if (location) {
            this.inspectEntity(location.id);
            return { type: "open-location", locationId: location.id };
        }

        const inspectable = primaryEntity(entities);
        if (inspectable) {
            this.inspectEntity(inspectable.id);
            return { type: "inspect", entityId: inspectable.id };
        }

        return this._deselect();
    }

    private _deselect(): HexClickAction {
        if (!this.selectedShipId && !this.inspectedEntityId) return { type: "none" };
        this.selectedShipId = null;
        this.inspectedEntityId = null;
        this._notify();
        return { type: "deselect" };
    }

    private _removeEntities(ids: Set<EntityId>, exceptKey?: HexKey) {
        for (const [key, tile] of this._tiles) {
            if (key === exceptKey) continue;
            if (tile.entities.some((e) => ids.has(e.id))) {
                tile.entities = tile.entities.filter((e) => !ids.has(e.id));
            }
        }
    }

    /** Ships with a move animation still running. */
    private _movingEntities(): Map<EntityId, { entity: MobileEntity; motion: ShipMotion }> {
        const now = performance.now();
        const moving = new Map<EntityId, { entity: MobileEntity; motion: ShipMotion }>();
        for (const [id, motion] of this._motions) {
            if (motion.isDone(now)) continue;
            const entity = this.findEntityById(id);
            if (entity && isMobile(entity)) moving.set(id, { entity, motion });
        }
        return moving;
    }

    /** Where every known ship currently is, and whether that hex is visible to us. */
    private _snapshotShips(): Map<EntityId, ShipSighting> {
        const sightings = new Map<EntityId, ShipSighting>();
        for (const [key, tile] of this._tiles) {
            for (const entity of tile.entities) {
                if (!isMobile(entity)) continue;
                sightings.set(entity.id, {
                    q: tile.q,
                    r: tile.r,
                    facing: entity.facing,
                    seen: this._visible.has(key)
                });
            }
        }
        return sightings;
    }

    /**
     * Animate ships now in a visible hex that were last seen in a different visible
     * hex. Ships emerging from fog or from stale memory just appear. `knownPaths`
     * (start hex first) come from the server; otherwise the route is guessed from
     * our own map, which is cosmetic only.
     */
    private _animateMovedShips(
        before: Map<EntityId, ShipSighting>,
        knownPaths?: Map<EntityId, Axial[]>
    ) {
        const now = performance.now();
        for (const [key, tile] of this._tiles) {
            if (!this._visible.has(key)) continue;
            for (const entity of tile.entities) {
                if (!isMobile(entity)) continue;
                const prev = before.get(entity.id);
                if (!prev?.seen || (prev.q === tile.q && prev.r === tile.r)) continue;

                let motion = this._motions.get(entity.id);
                if (!motion || motion.isDone(now)) {
                    motion = new ShipMotion(
                        ShipMotion.poseAtHex(prev, prev.facing, this.hexSize),
                        now
                    );
                    this._motions.set(entity.id, motion);
                }
                const known = knownPaths?.get(entity.id);
                const startsAtPrev = known?.[0].q === prev.q && known[0].r === prev.r;
                const path =
                    known && startsAtPrev ? known : planHexPath(prev, tile, this._pathOptions());
                motion.enqueue(path, this.hexSize, motionSpeeds(entity), now);
            }
        }
    }

    private _validateSelection() {
        if (this.selectedShipId) {
            const ship = this.findEntity(this.selectedShipId, "ship");
            if (!ship || ship.sideId !== this.sideId) {
                this.selectedShipId = null;
            }
        }
        if (this.inspectedEntityId && !this.findEntityById(this.inspectedEntityId)) {
            this.inspectedEntityId = null;
        }
    }

    private _centerCameraOnContent() {
        // Prefer centering on a visible ship of our side, else map center.
        for (const tile of this._tiles.values()) {
            if (tile.fog !== "visible") continue;
            const ship = tile.entities.find((e) => e.kind === "ship" && e.sideId === this.sideId);
            if (ship) {
                const p = axialToPixel(tile.q, tile.r, this.hexSize);
                this.camera.x = p.x;
                this.camera.y = p.y;
                return;
            }
        }

        const midCol = Math.floor(this.width / 2);
        const midRow = Math.floor(this.height / 2);
        this.camera.x = midCol * hexHorizSpacing(this.hexSize);
        this.camera.y = midRow * hexVertSpacing(this.hexSize);
    }

    worldToScreen(world: Pixel, canvas: HTMLCanvasElement): Pixel {
        return {
            x: (world.x - this.camera.x) * this.camera.zoom + canvas.width / 2,
            y: (world.y - this.camera.y) * this.camera.zoom + canvas.height / 2
        };
    }

    screenToWorld(screen: Pixel, canvas: HTMLCanvasElement): Pixel {
        return {
            x: (screen.x - canvas.width / 2) / this.camera.zoom + this.camera.x,
            y: (screen.y - canvas.height / 2) / this.camera.zoom + this.camera.y
        };
    }

    panByScreenDelta(dx: number, dy: number) {
        this.camera.x -= dx / this.camera.zoom;
        this.camera.y -= dy / this.camera.zoom;
    }

    zoomAt(factor: number, screen: Pixel, canvas: HTMLCanvasElement) {
        const before = this.screenToWorld(screen, canvas);
        this.camera.zoom = Math.min(2.5, Math.max(0.12, this.camera.zoom * factor));
        const after = this.screenToWorld(screen, canvas);
        this.camera.x += before.x - after.x;
        this.camera.y += before.y - after.y;
    }

    render(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D) {
        context.setTransform(1, 0, 0, 1, 0, 0);
        // Parallax is already on `context`. Draw translucent FOW hexes directly
        // so stars/clouds show through (offscreen stencil was forcing opaque coverage).

        if (!this.ready) return;

        const now = performance.now();
        this._framePoses.clear();
        for (const [id, motion] of this._motions) {
            if (motion.isDone(now)) {
                this._motions.delete(id);
            } else {
                this._framePoses.set(id, motion.poseAt(now));
            }
        }
        const deferred: DeferredShip[] = [];

        // Explored-but-not-visible first (more faded)
        for (const [key, tile] of this._tiles) {
            if (this._visible.has(key)) continue;
            this._drawTileContents(context, canvas, tile, /*fullColour*/ false, deferred);
        }

        // Visible on top
        for (const [key, tile] of this._tiles) {
            if (!this._visible.has(key)) continue;
            this._drawTileContents(context, canvas, tile, /*fullColour*/ true, deferred);
        }

        // Animating ships last so they pass over neighbouring hexes.
        const size = this.hexSize * this.camera.zoom;
        const drawn = new Set<EntityId>();
        for (const { entity, pose, fullColour } of deferred) {
            const center = this.worldToScreen(pose, canvas);
            drawEntityPlaceholder(context, center, size, entity, fullColour, pose.heading);
            drawn.add(entity.id);
        }
        for (const id of this._framePoses.keys()) {
            if (!drawn.has(id)) {
                this._motions.delete(id);
                this._framePoses.delete(id);
            }
        }

        this._drawDying(context, canvas, now, size);
        this._explosions.render(
            context,
            now,
            (p) => this.worldToScreen(p, canvas),
            this.camera.zoom
        );

        this._drawSelection(context, canvas);
    }

    private _drawDying(ctx: DrawCtx, canvas: HTMLCanvasElement, now: number, size: number) {
        this._dying = this._dying.filter(({ entity, motion, colour }) => {
            const pose = motion.poseAt(now);
            if (motion.isDone(now)) {
                if (colour) this._explosions.spawn(pose, colour, this.hexSize, now);
                return false;
            }
            const center = this.worldToScreen(pose, canvas);
            drawEntityPlaceholder(ctx, center, size, entity, true, pose.heading);
            return true;
        });
    }

    private _hexPath(ctx: DrawCtx, center: Pixel, size: number) {
        const corners = hexCorners(center, size);
        ctx.beginPath();
        ctx.moveTo(corners[0].x, corners[0].y);
        for (let i = 1; i < 6; i++) {
            ctx.lineTo(corners[i].x, corners[i].y);
        }
        ctx.closePath();
    }

    private _drawTileContents(
        ctx: DrawCtx,
        canvas: HTMLCanvasElement,
        tile: ClientTile,
        fullColour: boolean,
        deferred: DeferredShip[]
    ) {
        const center = this.worldToScreen(axialToPixel(tile.q, tile.r, this.hexSize), canvas);
        const size = this.hexSize * this.camera.zoom;

        this._hexPath(ctx, center, size);
        // Keep fills clearly translucent so parallax reads through the cell.
        ctx.fillStyle = fullColour ? "rgba(20, 40, 80, 0.28)" : "rgba(12, 22, 44, 0.18)";
        ctx.fill();
        ctx.strokeStyle = fullColour ? "rgba(120, 160, 220, 0.4)" : "rgba(70, 100, 150, 0.22)";
        ctx.lineWidth = Math.max(0.5, 1 * this.camera.zoom);
        ctx.stroke();

        for (const entity of tile.entities) {
            const pose = isMobile(entity) ? this._framePoses.get(entity.id) : undefined;
            if (isMobile(entity) && pose) {
                deferred.push({ entity, pose, fullColour });
                continue;
            }
            drawEntityPlaceholder(ctx, center, size, entity, fullColour);
        }
    }

    /** Planned route of the inspected supply ship: solid for this turn's hexes, dashed after. */
    private _drawSupplyRoute(ctx: DrawCtx, canvas: HTMLCanvasElement) {
        const supplyShip = this.inspectedEntityId
            ? this.findEntity(this.inspectedEntityId, "supply_ship")
            : undefined;
        if (!supplyShip) return;
        const size = this.hexSize * this.camera.zoom;
        const toScreen = (hex: Axial) =>
            this.worldToScreen(axialToPixel(hex.q, hex.r, this.hexSize), canvas);
        const start = this.worldToScreen(
            this._framePoses.get(supplyShip.id) ??
                axialToPixel(supplyShip.q, supplyShip.r, this.hexSize),
            canvas
        );
        const route = this.supplyRoute(supplyShip.id).map(toScreen);
        const thisTurn = Math.min(route.length, supplyShip.speed);

        ctx.save();
        ctx.strokeStyle = "rgba(255, 209, 102, 0.85)";
        ctx.fillStyle = "rgba(255, 209, 102, 0.85)";
        ctx.lineWidth = Math.max(1, size * 0.05);
        const drawLeg = (points: Pixel[], dashed: boolean) => {
            if (points.length < 2) return;
            ctx.setLineDash(dashed ? [size * 0.18, size * 0.14] : []);
            ctx.beginPath();
            ctx.moveTo(points[0].x, points[0].y);
            for (const p of points.slice(1)) ctx.lineTo(p.x, p.y);
            ctx.stroke();
        };
        drawLeg([start, ...route.slice(0, thisTurn)], false);
        drawLeg(route.slice(Math.max(0, thisTurn - 1)), true);
        ctx.setLineDash([]);
        for (const p of route) {
            ctx.beginPath();
            ctx.arc(p.x, p.y, Math.max(1.5, size * 0.07), 0, Math.PI * 2);
            ctx.fill();
        }
        const end = route[route.length - 1];
        if (end) {
            this._hexPath(ctx, end, size * 0.92);
            ctx.stroke();
        }
        const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 250);
        ctx.strokeStyle = `rgba(255, 255, 255, ${0.6 + 0.4 * pulse})`;
        ctx.lineWidth = Math.max(1.5, size * 0.05);
        ctx.beginPath();
        ctx.arc(start.x, start.y, size * 0.55, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }

    private _drawSelection(ctx: DrawCtx, canvas: HTMLCanvasElement) {
        this._drawSupplyRoute(ctx, canvas);
        const ship = this.selectedShip;
        if (!ship) return;
        const size = this.hexSize * this.camera.zoom;

        ctx.save();
        ctx.fillStyle = "rgba(92, 255, 176, 0.1)";
        ctx.strokeStyle = "rgba(92, 255, 176, 0.45)";
        ctx.lineWidth = Math.max(0.75, 1.5 * this.camera.zoom);
        for (const hex of this.reachableHexes()) {
            const center = this.worldToScreen(axialToPixel(hex.q, hex.r, this.hexSize), canvas);
            this._hexPath(ctx, center, size * 0.92);
            ctx.fill();
            ctx.stroke();
        }

        const center = this.worldToScreen(
            this._framePoses.get(ship.id) ?? axialToPixel(ship.q, ship.r, this.hexSize),
            canvas
        );
        const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 250);
        ctx.strokeStyle = `rgba(255, 255, 255, ${0.6 + 0.4 * pulse})`;
        ctx.lineWidth = Math.max(1.5, size * 0.06);
        ctx.beginPath();
        ctx.arc(center.x, center.y, size * 0.8, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }
}

function drawEntityPlaceholder(
    ctx: DrawCtx,
    center: Pixel,
    hexSize: number,
    entity: EntitySummary,
    fullColour: boolean,
    /** Ship heading override (radians); defaults to the entity's facing. */
    heading?: number
) {
    const scale = (entity.scale ?? 0.5) * hexSize;
    const alpha = fullColour ? 1 : 0.55;
    const lineWidth = Math.max(1, hexSize * 0.04);
    ctx.save();
    ctx.globalAlpha = alpha;

    switch (entity.kind) {
        case "sun": {
            const g = ctx.createRadialGradient(
                center.x,
                center.y,
                scale * 0.1,
                center.x,
                center.y,
                scale
            );
            g.addColorStop(0, "#fff6c8");
            g.addColorStop(0.45, "#ffb020");
            g.addColorStop(1, "#ff6a00");
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(center.x, center.y, scale, 0, Math.PI * 2);
            ctx.fill();
            break;
        }
        case "planet": {
            const r = scale * (0.8 + (entity.level / PLANET_LEVEL_MAX) * 0.5);
            ctx.fillStyle = fullColour ? "#4a8fd4" : "#3a6fa8";
            ctx.beginPath();
            ctx.arc(center.x, center.y, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = sideColour(entity.sideId, "#9fd0ff");
            ctx.lineWidth = entity.sideId ? lineWidth * 1.8 : lineWidth;
            ctx.beginPath();
            ctx.ellipse(center.x, center.y, r * 1.35, r * 0.35, -0.4, 0, Math.PI * 2);
            ctx.stroke();
            if (entity.sideId) {
                ctx.beginPath();
                ctx.arc(center.x, center.y, r, 0, Math.PI * 2);
                ctx.stroke();
            }
            if (hexSize >= 28) {
                const fontSize = Math.round(Math.min(16, hexSize * 0.22));
                ctx.font = `600 ${fontSize}px "IBM Plex Sans", "Segoe UI", sans-serif`;
                ctx.textAlign = "center";
                ctx.textBaseline = "top";
                ctx.lineWidth = Math.max(2, fontSize * 0.25);
                ctx.strokeStyle = "rgba(4, 8, 18, 0.85)";
                ctx.fillStyle = "#e8eefc";
                const label = `L${entity.level}`;
                const y = center.y + hexSize * 0.62;
                ctx.strokeText(label, center.x, y);
                ctx.fillText(label, center.x, y);
            }
            break;
        }
        case "moon": {
            const r = scale * 0.55;
            ctx.fillStyle = fullColour ? "#b8b8c0" : "#808088";
            ctx.beginPath();
            ctx.arc(center.x, center.y, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "rgba(0, 0, 0, 0.25)";
            ctx.beginPath();
            ctx.arc(center.x + r * 0.3, center.y - r * 0.2, r * 0.25, 0, Math.PI * 2);
            ctx.fill();
            if (entity.sideId) {
                ctx.strokeStyle = sideColour(entity.sideId, "#ffffff");
                ctx.lineWidth = lineWidth;
                ctx.beginPath();
                ctx.arc(center.x, center.y, r * 1.2, 0, Math.PI * 2);
                ctx.stroke();
            }
            break;
        }
        case "large_asteroid": {
            ctx.fillStyle = fullColour ? "#8a7f72" : "#5c554c";
            ctx.beginPath();
            const bumps = 9;
            for (let i = 0; i < bumps; i++) {
                const a = (i / bumps) * Math.PI * 2;
                const r = scale * (0.55 + ((i * 37) % 11) / 22);
                const x = center.x + Math.cos(a) * r;
                const y = center.y + Math.sin(a) * r;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.closePath();
            ctx.fill();
            ctx.strokeStyle = entity.sideId ? sideColour(entity.sideId, "#3d3831") : "#3d3831";
            ctx.lineWidth = lineWidth;
            ctx.stroke();
            break;
        }
        case "asteroid_belt": {
            ctx.fillStyle = fullColour ? "#a09482" : "#6b6356";
            const dots = 18;
            const spread = hexSize * 0.75;
            for (let i = 0; i < dots; i++) {
                const a = ((i * 137.5) % 360) * (Math.PI / 180);
                const d = spread * Math.sqrt(((i * 53) % 17) / 17 + 0.05);
                const x = center.x + Math.cos(a) * d;
                const y = center.y + Math.sin(a) * d * 0.8;
                const r = Math.max(0.75, hexSize * (0.03 + ((i * 29) % 5) * 0.008));
                ctx.beginPath();
                ctx.arc(x, y, r, 0, Math.PI * 2);
                ctx.fill();
            }
            break;
        }
        case "wormhole": {
            const r = scale * 0.9;
            const g = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, r);
            g.addColorStop(0, "rgba(10, 0, 30, 0.9)");
            g.addColorStop(0.6, "rgba(120, 60, 220, 0.6)");
            g.addColorStop(1, "rgba(180, 120, 255, 0)");
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(center.x, center.y, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = "#c9a0ff";
            ctx.lineWidth = lineWidth;
            for (let arm = 0; arm < 3; arm++) {
                ctx.beginPath();
                const start = (arm / 3) * Math.PI * 2;
                ctx.arc(center.x, center.y, r * (0.45 + arm * 0.18), start, start + Math.PI * 1.1);
                ctx.stroke();
            }
            break;
        }
        case "black_hole": {
            const r = scale * 0.55;
            ctx.strokeStyle = "rgba(255, 170, 80, 0.85)";
            ctx.lineWidth = Math.max(1.5, r * 0.35);
            ctx.beginPath();
            ctx.ellipse(center.x, center.y, r * 1.8, r * 0.6, -0.3, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = "#000000";
            ctx.beginPath();
            ctx.arc(center.x, center.y, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = "rgba(255, 220, 160, 0.6)";
            ctx.lineWidth = lineWidth * 0.75;
            ctx.stroke();
            break;
        }
        case "hyperspace_tunnel": {
            const r = scale * 0.75;
            ctx.strokeStyle = entity.active
                ? sideColour(entity.sideId, "#7fe8ff")
                : "rgba(127, 232, 255, 0.55)";
            ctx.lineWidth = lineWidth * 1.2;
            ctx.setLineDash([Math.max(2, r * 0.3), Math.max(2, r * 0.2)]);
            ctx.beginPath();
            ctx.arc(center.x, center.y, r, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.moveTo(center.x - r * 0.5, center.y);
            ctx.lineTo(center.x + r * 0.5, center.y);
            ctx.moveTo(center.x + r * 0.2, center.y - r * 0.3);
            ctx.lineTo(center.x + r * 0.5, center.y);
            ctx.lineTo(center.x + r * 0.2, center.y + r * 0.3);
            ctx.stroke();
            break;
        }
        case "ship": {
            ctx.translate(center.x, center.y);
            ctx.rotate(heading ?? axialDirectionAngle(entity.facing));
            ctx.fillStyle = sideColour(entity.sideId, "#d0d0d0");
            if (SHIP_TYPES[entity.shipType].canColonise) {
                drawColonyPod(ctx, scale, hexSize);
                break;
            }
            // Arrowhead hull, nose along +x before rotation.
            ctx.beginPath();
            ctx.moveTo(scale, 0);
            ctx.lineTo(-scale * 0.7, scale * 0.7);
            ctx.lineTo(-scale * 0.25, 0);
            ctx.lineTo(-scale * 0.7, -scale * 0.7);
            ctx.closePath();
            ctx.fill();
            ctx.strokeStyle = "#ffffffaa";
            ctx.lineWidth = Math.max(1, hexSize * 0.03);
            ctx.stroke();
            ctx.fillStyle = "#ffffff";
            ctx.beginPath();
            ctx.arc(scale * 0.45, 0, Math.max(1, scale * 0.12), 0, Math.PI * 2);
            ctx.fill();
            if (isTransport(entity) && entity.carriedUnitIds?.length) {
                ctx.fillStyle = "#ffd166";
                ctx.fillRect(-scale * 0.4, -scale * 0.18, scale * 0.36, scale * 0.36);
            }
            break;
        }
        case "supply_ship": {
            drawSupplyShip(
                ctx,
                (entity.scale ?? 0.32) * hexSize,
                hexSize,
                sideColour(entity.sideId, "#d0d0d0"),
                center,
                heading ?? axialDirectionAngle(entity.facing)
            );
            break;
        }
        default: {
            const unknown: never = entity;
            void unknown;
        }
    }

    ctx.restore();
}

/** Boxy freighter: cab in the side colour towing two cargo pods; nose along `heading`. */
function drawSupplyShip(
    ctx: DrawCtx,
    scale: number,
    hexSize: number,
    colour: string,
    center: Pixel,
    heading: number
) {
    ctx.translate(center.x, center.y);
    ctx.rotate(heading);
    ctx.strokeStyle = "#ffffffaa";
    ctx.lineWidth = Math.max(1, hexSize * 0.025);
    ctx.fillStyle = "#c9b27a";
    for (const x of [-scale * 0.95, -scale * 0.35]) {
        ctx.fillRect(x, -scale * 0.32, scale * 0.5, scale * 0.64);
        ctx.strokeRect(x, -scale * 0.32, scale * 0.5, scale * 0.64);
    }
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.moveTo(scale * 0.9, 0);
    ctx.lineTo(scale * 0.2, scale * 0.42);
    ctx.lineTo(scale * 0.2, -scale * 0.42);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
}

/** Capsule hull with a habitat ring; nose along +x (context already rotated). */
function drawColonyPod(ctx: DrawCtx, scale: number, hexSize: number) {
    const halfLen = scale * 0.75;
    const radius = scale * 0.42;
    const body = halfLen - radius;
    ctx.beginPath();
    ctx.arc(body, 0, radius, -Math.PI / 2, Math.PI / 2);
    ctx.arc(-body, 0, radius, Math.PI / 2, (Math.PI * 3) / 2);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#ffffffaa";
    ctx.lineWidth = Math.max(1, hexSize * 0.03);
    ctx.stroke();

    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = Math.max(1, hexSize * 0.035);
    ctx.beginPath();
    ctx.ellipse(-scale * 0.1, 0, scale * 0.2, scale * 0.72, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.moveTo(halfLen + scale * 0.28, 0);
    ctx.lineTo(halfLen + scale * 0.04, scale * 0.16);
    ctx.lineTo(halfLen + scale * 0.04, -scale * 0.16);
    ctx.closePath();
    ctx.fill();
}
