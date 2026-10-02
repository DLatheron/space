import {
    axialDirectionAngle,
    axialDirectionTowards,
    axialToOffset,
    axialToPixel,
    findHexPath,
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
    canBombardShip,
    canCarryShip,
    canRepairIn,
    hangarFor,
    hexHasObstacle,
    hyperdriveFor,
    hyperjumpAccuracy,
    hyperjumpRange,
    inHyperjumpRange,
    MAX_SCATTER_RING,
    MOVE_COST_PER_HEX,
    PLANET_LEVEL_MAX,
    REPAIR_YARD_STRUCTURES,
    repairsAtEndOf,
    RESOURCE_KEYS,
    ringHexes,
    SHIP_TYPE_INFO,
    shipRepairPerTurn,
    shipStats,
    siteForEntity,
    stockpileCap,
    sumResources,
    supplyShipStats,
    zeroResources,
    type AxialCoord,
    type BuildContext,
    type CombatParticipant,
    type CombatResult,
    type EconomyBalance,
    type EconomyState,
    type ResourceKey,
    type EntityId,
    type EntityOfKind,
    type EntitySummary,
    type GroundUnit,
    type HangarBalance,
    type HexKey,
    type HyperdriveAccuracy,
    type HyperdriveBalance,
    type LocationEconomy,
    type LocationEntity,
    type Resources,
    type ServerToClientMessage,
    type ShipMoveOrder,
    type SideId,
    type TechId,
    type TileView,
    type TurnState
} from "@space/shared-data";
import { BEAM_MS, CombatEffects } from "./CombatEffects.js";
import { Explosions, JUMP_ARRIVE_MS, JUMP_DEPART_MS, JumpFlashes } from "./Explosions.js";
import { ShipMotion, SUPPLY_SHIP_MOTION, type MotionSpeeds, type ShipPose } from "./ShipMotion.js";
import { SHIP_SPRITE_MIN_HEX_SIZE, shipSprite, type ShipSprite } from "./ShipSprites.js";

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

/** Ship collapsing into hyperspace at its origin; its entity has already left the map. */
type DepartingShip = { entity: MobileEntity; pose: ShipPose; departAt: number; arriveAt: number };

/** Gap between consecutive jumps in one end of turn, so they read in resolution order. */
const JUMP_STAGGER_MS = 450;
/** Arriving ships grow to full size over this part of the arrival flash. */
const JUMP_SCALE_IN_MS = JUMP_ARRIVE_MS * 0.5;

/** The attacker darts towards the defenders as a combat opens. */
const COMBAT_LUNGE_MS = 450;
/** From the start of a combat: beams fire, hits land, then losses explode. */
const COMBAT_FIRE_MS = 120;
const COMBAT_HIT_MS = COMBAT_FIRE_MS + BEAM_MS * 0.45;
const COMBAT_EXPLODE_MS = 650;
/** Survivors hold position this long before an attacker moves in or a jumper is displaced. */
const COMBAT_MS = 1100;
const MAX_COMBAT_REPORTS = 30;

/** A `server:combat` kept for the combat log; `turn` is when it arrived. */
export type CombatReport = { id: number; turn: number | null; result: CombatResult };

export type ShipJumped = Extract<ServerToClientMessage, { type: "server:ship:jumped" }>["payload"];

export type ShipEntity = EntityOfKind<"ship">;
export type SupplyShipEntity = EntityOfKind<"supply_ship">;
export type PlanetEntity = EntityOfKind<"planet">;
export type { LocationEntity };

/** Entities that move between hexes and animate doing so. */
export type MobileEntity = ShipEntity | SupplyShipEntity;

function isMobile(entity: EntitySummary): entity is MobileEntity {
    return entity.kind === "ship" || entity.kind === "supply_ship";
}

/** Aboard a carrier: kept in our data but not drawn, picked or listed on the map. */
export function isCarried(entity: EntitySummary): boolean {
    return entity.kind === "ship" && !!entity.carriedBy;
}

function motionSpeeds(entity: MobileEntity): MotionSpeeds {
    return entity.kind === "ship" ? SHIP_TYPE_INFO[entity.shipType] : SUPPLY_SHIP_MOTION;
}

/** A move order after its ship reached `at`: the walked part of the route is dropped. */
function advanceMoveOrder(
    order: ShipMoveOrder | undefined,
    at: AxialCoord
): ShipMoveOrder | undefined {
    if (!order) return undefined;
    if (order.destination.q === at.q && order.destination.r === at.r) return undefined;
    const index = order.route?.findIndex((h) => h.q === at.q && h.r === at.r) ?? -1;
    return index >= 0 ? { ...order, route: order.route?.slice(index + 1) } : order;
}

export function isLocationEntity(entity: EntitySummary): entity is LocationEntity {
    return entity.kind === "planet" || entity.kind === "moon" || entity.kind === "large_asteroid";
}

/** Planets, moons and mineable asteroids: the locations that can be owned and built on. */
export function isBuildSite(entity: EntitySummary): entity is LocationEntity {
    return isLocationEntity(entity) && siteForEntity(entity) !== undefined;
}

export function isTransport(ship: ShipEntity, balance: EconomyBalance | null): boolean {
    return (balance?.ships[ship.shipType].unitCapacity ?? 0) > 0;
}

export function canBombard(ship: ShipEntity, balance: EconomyBalance | null): boolean {
    return !!balance && canBombardShip(balance, ship.shipType);
}

export function canColonise(ship: ShipEntity, balance: EconomyBalance | null): boolean {
    return balance?.ships[ship.shipType].canColonise ?? false;
}

export type HexClickAction =
    | { type: "none" }
    | { type: "select"; shipId: EntityId }
    | { type: "inspect"; entityId: EntityId }
    | { type: "deselect" }
    | { type: "open-location"; locationId: EntityId }
    | { type: "move"; shipId: EntityId; to: AxialCoord }
    | { type: "hyperjump"; shipId: EntityId; target: AxialCoord }
    /** Nothing was sent; `reason` is shown to the player. */
    | { type: "rejected"; reason: string };

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
    /** Selected ship whose next map click picks a hyperspace jump target. */
    hyperjumpTargetingId: EntityId | null = null;
    /** Short message over the map (rejected orders, server errors); `id` changes per message. */
    notice: { text: string; id: number } | null = null;
    /** Combats seen since the map init, newest first. */
    combatReports: CombatReport[] = [];
    /** Our side's private economy; `null` until the first map init. */
    economy: EconomyState | null = null;
    /** Server-configured caps and build limits; `null` until the first map init. */
    balance: EconomyBalance | null = null;

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
    private readonly _jumpFlashes = new JumpFlashes();
    private _departing: DepartingShip[] = [];
    /** Ships that jumped in: hidden until their arrival time, then scaled in. */
    private readonly _arrivals = new Map<EntityId, number>();
    private _lastJumpAt = -Infinity;
    private _previewCache: { key: string; route: Axial[] | null } | null = null;
    /** `performance.now()` of the frame being rendered. */
    private _frameNow = 0;
    private readonly _combatEffects = new CombatEffects();
    /** Hp bars show the pre-combat `hp` until `until`, so they drop as the hits land. */
    private readonly _hpShown = new Map<EntityId, { hp: number; until: number }>();
    private _combatSeq = 0;

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
        economy: EconomyState;
        balance: EconomyBalance;
    }) {
        this.width = payload.width;
        this.height = payload.height;
        this.hexSize = payload.hexSize;
        this.sideId = payload.sideId;
        this.turn = payload.turn;
        this.economy = payload.economy;
        this.balance = payload.balance;
        this.selectedShipId = null;
        this.inspectedEntityId = null;
        this.hoveredHex = null;
        this.hyperjumpTargetingId = null;
        this._tiles.clear();
        this._visible.clear();
        this._motions.clear();
        this._explosions.clear();
        this._dying = [];
        this._jumpFlashes.clear();
        this._departing = [];
        this._arrivals.clear();
        this._combatEffects.clear();
        this._hpShown.clear();
        this.combatReports = [];

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
            {
                ...ship,
                movementPoints: payload.movementPoints,
                moveOrder: advanceMoveOrder(ship.moveOrder, payload.to)
            },
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
        const dest = this._tileAt(to);
        dest.entities = [...dest.entities, moved];
        this._moveCarried(entity.id, from, to);

        this._animateMovedShips(before, new Map([[entity.id, [from, ...path]]]));
        this._validateSelection();
        this._notify();
    }

    /** Get or create the tile at `hex` (a ship arriving somewhere we have no tile for yet). */
    private _tileAt(hex: AxialCoord): ClientTile {
        const key = hexKey(hex.q, hex.r);
        let tile = this._tiles.get(key);
        if (!tile) {
            tile = { q: hex.q, r: hex.r, fog: "visible", entities: [] };
            this._tiles.set(key, tile);
        }
        return tile;
    }

    /** Ships aboard `carrierId` ride along to `to`; only their owner knows about them. */
    private _moveCarried(carrierId: EntityId, from: AxialCoord, to: AxialCoord) {
        const carried = this.entitiesAt(from.q, from.r).filter(
            (e): e is ShipEntity => e.kind === "ship" && e.carriedBy === carrierId
        );
        if (!carried.length) return;
        this._removeEntities(new Set(carried.map((s) => s.id)));
        const dest = this._tileAt(to);
        dest.entities = [...dest.entities, ...carried.map((s) => ({ ...s, q: to.q, r: to.r }))];
    }

    /**
     * Play a resolved hyperspace jump. The ship collapses at its origin, then flashes in at
     * its landing hex; ships it destroyed keep drawing until then and explode on arrival.
     * Positions update now so the tiles update that follows doesn't animate a normal move.
     * A jumper displaced by its landing combat waits out the combat, then slides aside.
     */
    applyShipJumped(payload: ShipJumped) {
        const now = performance.now();
        const departAt = Math.max(now, this._lastJumpAt + JUMP_STAGGER_MS);
        this._lastJumpAt = departAt;
        const arriveAt = departAt + JUMP_DEPART_MS;
        const landing = axialToPixel(payload.to.q, payload.to.r, this.hexSize);

        const jumper = this.findEntity(payload.shipId, "ship");
        if (jumper) {
            const pose =
                this._motions.get(jumper.id)?.poseAt(now) ??
                ShipMotion.poseAtHex(jumper, jumper.facing, this.hexSize);
            this._motions.delete(jumper.id);
            this._departing.push({ entity: jumper, pose, departAt, arriveAt });
        }
        const jumperDestroyed = payload.destroyedIds.includes(payload.shipId);
        this._jumpFlashes.spawn({
            from: jumper ? axialToPixel(payload.from.q, payload.from.r, this.hexSize) : null,
            to: landing,
            departAt,
            arriveAt,
            damaged: payload.outcome === "damaged",
            scale: this.hexSize
        });

        for (const id of payload.destroyedIds) {
            const found = this.findEntityById(id);
            const colour = sideColour(
                found && "sideId" in found ? found.sideId : jumper?.sideId,
                "#ffd166"
            );
            if (found && isCarried(found)) continue;
            if (id === payload.shipId || !found || !isMobile(found)) {
                this._explosions.spawn(landing, colour, this.hexSize, arriveAt);
                continue;
            }
            const motion =
                this._motions.get(id) ??
                new ShipMotion(ShipMotion.poseAtHex(found, found.facing, this.hexSize), now);
            this._motions.delete(id);
            motion.holdUntil(arriveAt);
            this._dying.push({ entity: found, motion, colour });
        }

        this._removeEntities(new Set([payload.shipId, ...payload.destroyedIds]));
        if (jumper && !jumperDestroyed) {
            const end = payload.displacedTo ?? payload.to;
            const arrived: ShipEntity = {
                ...jumper,
                q: end.q,
                r: end.r,
                moveOrder: undefined,
                hyperjump: undefined,
                hyperdriveCharging: undefined
            };
            const dest = this._tileAt(end);
            dest.entities = [...dest.entities, arrived];
            this._moveCarried(jumper.id, payload.from, end);
            if (payload.displacedTo) {
                const motion = new ShipMotion(
                    ShipMotion.poseAtHex(payload.to, jumper.facing, this.hexSize),
                    now
                );
                motion.holdUntil(arriveAt + JUMP_SCALE_IN_MS + COMBAT_MS);
                const path = planHexPath(payload.to, payload.displacedTo, this._pathOptions());
                motion.enqueue(path, this.hexSize, motionSpeeds(jumper), now);
                this._motions.set(jumper.id, motion);
            }
        }
        if (!jumperDestroyed) this._arrivals.set(payload.shipId, arriveAt);
        if (this.hyperjumpTargetingId === payload.shipId) this.hyperjumpTargetingId = null;
        this._validateSelection();
        this._notify();
    }

    /**
     * Play an automatic combat and keep it for the combat log. Losses are removed now but
     * keep drawing until they explode, so the tiles update that follows can't snap them away.
     */
    applyCombat(result: CombatResult) {
        this.combatReports = [
            { id: ++this._combatSeq, turn: this.turn?.turn ?? null, result },
            ...this.combatReports
        ].slice(0, MAX_COMBAT_REPORTS);
        const now = performance.now();
        if (result.kind === "ground") {
            this._applyGroundCombat(result, now);
        } else {
            this._applySpaceCombat(result, now);
        }
        this._validateSelection();
        this._notify();
    }

    /**
     * Once everyone involved has finished moving or jumping in, the attacker lunges (when it
     * attacked from a neighbouring hex), beams fly, damage floats up and losses explode.
     * Survivors hold still until the end, so a follow-up move into the hex plays afterwards.
     */
    private _applySpaceCombat(result: CombatResult, now: number) {
        const fighters: { p: CombatParticipant; entity: MobileEntity }[] = [];
        for (const p of result.participants) {
            const entity = this.findEntityById(p.id);
            if (entity && isMobile(entity) && !isCarried(entity)) fighters.push({ p, entity });
        }

        let startAt = now;
        for (const { entity } of fighters) {
            const arriveAt = this._arrivals.get(entity.id);
            const motion = this._motions.get(entity.id);
            if (arriveAt !== undefined) {
                startAt = Math.max(startAt, arriveAt + JUMP_SCALE_IN_MS);
            } else if (motion) {
                startAt = Math.max(startAt, motion.endsAt);
            }
        }
        const hitAt = startAt + COMBAT_HIT_MS;
        const explodeAt = startAt + COMBAT_EXPLODE_MS;
        const target = axialToPixel(result.hex.q, result.hex.r, this.hexSize);
        const lunges =
            result.cause === "move" &&
            (result.from.q !== result.hex.q || result.from.r !== result.hex.r);

        for (const { p, entity } of fighters) {
            if (p.role !== "attacker" || entity.kind !== "ship") continue;
            const motion = this._motionFor(entity, now);
            motion.holdUntil(startAt);
            if (lunges) motion.lunge(target, this.hexSize * 0.3, COMBAT_LUNGE_MS);
            motion.holdUntil(startAt + COMBAT_MS);
        }

        const poseOf = (entity: MobileEntity): Pixel =>
            this._motions.get(entity.id)?.poseAt(hitAt) ??
            axialToPixel(entity.q, entity.r, this.hexSize);
        this._spawnBeams(fighters, poseOf, startAt + COMBAT_FIRE_MS);

        const labelsAt = new Map<HexKey, number>();
        for (const { p, entity } of fighters) {
            const text = p.evaded
                ? "Evaded"
                : p.damageTaken > 0
                  ? `−${Math.round(p.damageTaken)}`
                  : undefined;
            if (!text) continue;
            const key = hexKey(entity.q, entity.r);
            const stack = labelsAt.get(key) ?? 0;
            labelsAt.set(key, stack + 1);
            const pose = poseOf(entity);
            this._combatEffects.label({
                at: { x: pose.x, y: pose.y - stack * this.hexSize * 0.3 },
                text,
                colour: p.evaded ? "#7fe8ff" : "#ff8a8a",
                startAt: hitAt + stack * 80,
                scale: this.hexSize
            });
        }

        // Hp drops as the hits land; losses keep their pre-combat hp until they blow up.
        const byId = new Map(result.participants.map((p) => [p.id, p]));
        for (const tile of this._tiles.values()) {
            if (!tile.entities.some((e) => byId.has(e.id))) continue;
            tile.entities = tile.entities.map((e) => {
                const p = byId.get(e.id);
                if (!p || !isMobile(e)) return e;
                this._hpShown.set(e.id, { hp: p.hpBefore, until: hitAt });
                return { ...e, hp: p.hpAfter };
            });
        }

        const destroyed = new Set(result.destroyedIds);
        for (const id of destroyed) {
            const found = this.findEntityById(id);
            if (found && isCarried(found)) continue;
            if (!found || !isMobile(found)) {
                if (byId.has(id) && this._visible.has(hexKey(result.hex.q, result.hex.r))) {
                    const colour = sideColour(byId.get(id)?.sideId, "#ffd166");
                    this._explosions.spawn(target, colour, this.hexSize, explodeAt);
                }
                continue;
            }
            const motion =
                this._motions.get(id) ??
                new ShipMotion(ShipMotion.poseAtHex(found, found.facing, this.hexSize), now);
            this._motions.delete(id);
            motion.holdUntil(explodeAt);
            this._dying.push({
                entity: found,
                motion,
                colour: sideColour(found.sideId, "#ffd166")
            });
        }
        this._removeEntities(destroyed);
    }

    /**
     * Each attacking warship fires at a defender (hit ones first) and defenders that did
     * damage fire back. Beams at a target that evaded go wide.
     */
    private _spawnBeams(
        fighters: { p: CombatParticipant; entity: MobileEntity }[],
        poseOf: (entity: MobileEntity) => Pixel,
        fireAt: number
    ) {
        const side = (role: CombatParticipant["role"]) =>
            fighters
                .filter(({ p }) => p.role === role)
                .sort((a, b) => Number(b.p.damageTaken > 0) - Number(a.p.damageTaken > 0));
        const attackers = side("attacker");
        const defenders = side("defender");
        const volley = (shooters: typeof fighters, targets: typeof fighters, startAt: number) => {
            if (!targets.length) return;
            shooters
                .filter(
                    ({ p }) => p.kind === "ship" && (p.role === "attacker" || p.damageDealt > 0)
                )
                .forEach(({ entity }, i) => {
                    const { p, entity: hit } = targets[i % targets.length];
                    const from = poseOf(entity);
                    const to = poseOf(hit);
                    const wide = p.evaded ? this.hexSize * 0.45 : 0;
                    this._combatEffects.beam({
                        from,
                        to: { x: to.x + wide, y: to.y - wide },
                        startAt: startAt + i * 70,
                        colour: sideColour(entity.sideId, "#ffd166"),
                        scale: this.hexSize
                    });
                });
        };
        volley(attackers, defenders, fireAt);
        volley(defenders, attackers, fireAt + 160);
    }

    /**
     * Small blasts over the location and a floating verdict. Lost units leave remembered
     * garrisons and our unit list, survivors take their new hp, and a captured location
     * changes hands here, ahead of the tiles and economy updates that confirm it.
     */
    private _applyGroundCombat(result: CombatResult, now: number) {
        const destroyed = new Set(result.destroyedUnitIds);
        for (const tile of this._tiles.values()) {
            tile.entities = tile.entities.map((e) => {
                if (!isLocationEntity(e)) return e;
                const garrison = e.garrison?.filter((id) => !destroyed.has(id));
                const sideId =
                    result.captured && e.id === result.locationId
                        ? result.attackerSideId
                        : e.sideId;
                return garrison || sideId !== e.sideId ? { ...e, sideId, garrison } : e;
            });
        }
        if (this.economy?.groundUnits) {
            const byId = new Map(result.participants.map((p) => [p.id, p]));
            this.economy = {
                ...this.economy,
                groundUnits: this.economy.groundUnits
                    .filter((u) => !destroyed.has(u.id))
                    .map((u) => {
                        const p = byId.get(u.id);
                        return p ? { ...u, hp: p.hpAfter } : u;
                    })
            };
        }

        if (!this._visible.has(hexKey(result.hex.q, result.hex.r))) return;
        const at = axialToPixel(result.hex.q, result.hex.r, this.hexSize);
        const hits = result.participants.filter((p) => p.damageTaken > 0).slice(0, 6);
        hits.forEach((p, i) => {
            const angle = i * 2.4;
            const spread = this.hexSize * 0.35;
            this._explosions.spawn(
                { x: at.x + Math.cos(angle) * spread, y: at.y + Math.sin(angle) * spread },
                sideColour(p.sideId, "#ffd166"),
                this.hexSize * 0.35,
                now + i * 140
            );
        });
        this._combatEffects.label({
            at,
            text: result.captured
                ? "Captured"
                : result.outcome === "attacker_destroyed"
                  ? "Invasion repelled"
                  : "Invasion stalled",
            colour: sideColour(
                result.captured ? result.attackerSideId : result.defenderSideIds[0],
                "#ffd166"
            ),
            startAt: now + COMBAT_HIT_MS,
            scale: this.hexSize
        });
    }

    /** Running motion for `entity`, or a new one starting at its hex. */
    private _motionFor(entity: MobileEntity, now: number): ShipMotion {
        let motion = this._motions.get(entity.id);
        if (!motion || motion.isDone(now)) {
            motion = new ShipMotion(ShipMotion.poseAtHex(entity, entity.facing, this.hexSize), now);
            this._motions.set(entity.id, motion);
        }
        return motion;
    }

    /** Centre the map on a combat and show one of its survivors (or the location) in the pane. */
    focusCombat(result: CombatResult) {
        const p = axialToPixel(result.hex.q, result.hex.r, this.hexSize);
        this.camera.x = p.x;
        this.camera.y = p.y;
        const candidates = [
            ...(result.locationId ? [result.locationId] : []),
            ...result.participants.map((participant) => participant.id)
        ]
            .map((id) => this.findEntityById(id))
            .filter((e): e is EntitySummary => !!e && !isCarried(e));
        const own = candidates.find((e) => e.kind === "ship" && e.sideId === this.sideId);
        const pick = result.locationId ? candidates[0] : (own ?? candidates[0]);
        if (pick?.kind === "ship" && pick.sideId === this.sideId) {
            this.selectShip(pick.id);
        } else if (pick) {
            this.inspectEntity(pick.id);
        }
        this._notify();
    }

    /** Ground combats fought over `locationId`, newest first. */
    groundCombatsAt(locationId: EntityId): CombatReport[] {
        return this.combatReports.filter(
            (r) => r.result.kind === "ground" && r.result.locationId === locationId
        );
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
        if (!this.economy || !this.balance) return null;
        const { shipCount, shipCap, techs, locations } = this.economy;
        const researching: TechId[] = [];
        for (const location of locations) {
            for (const order of location.orders) {
                if (order.item.kind === "research") researching.push(order.item.techId);
            }
        }
        return { shipCount, shipCap, techs, researching, balance: this.balance };
    }

    /** Stock held across every location we own. */
    get sideStockpile(): Resources {
        return sumResources(this.economy?.locations.map((l) => l.stockpile) ?? []);
    }

    /** Stockpile caps of every location we own, added together. */
    get sideStockpileCap(): Resources {
        const balance = this.balance;
        if (!balance) return zeroResources();
        return sumResources(this.economy?.locations.map((l) => stockpileCap(l, balance)) ?? []);
    }

    /** How many of our locations are at or over their cap, per resource. */
    get fullLocations(): Record<ResourceKey, number> {
        const counts = { money: 0, materials: 0, population: 0, science: 0 };
        const balance = this.balance;
        if (!balance) return counts;
        for (const location of this.economy?.locations ?? []) {
            const cap = stockpileCap(location, balance);
            for (const key of RESOURCE_KEYS) {
                if (location.stockpile[key] >= cap[key]) counts[key]++;
            }
        }
        return counts;
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

    /** Our warships (not supply ships) on `hex`, excluding ships aboard carriers. */
    ownShipsAt(q: number, r: number): ShipEntity[] {
        return this.entitiesAt(q, r).filter(
            (e): e is ShipEntity => e.kind === "ship" && e.sideId === this.sideId && !e.carriedBy
        );
    }

    /** Ships aboard one of our carriers (only we know about them). */
    carriedShips(carrier: ShipEntity): ShipEntity[] {
        return this.entitiesAt(carrier.q, carrier.r).filter(
            (e): e is ShipEntity => e.kind === "ship" && e.carriedBy === carrier.id
        );
    }

    hangarOf(ship: ShipEntity): HangarBalance | undefined {
        return this.balance ? hangarFor(this.balance, ship.shipType) : undefined;
    }

    /** Our ships on the carrier's hex of a type its hangar takes (MP and room not checked). */
    boardableShips(carrier: ShipEntity): ShipEntity[] {
        const balance = this.balance;
        if (!balance) return [];
        return this.ownShipsAt(carrier.q, carrier.r).filter(
            (s) => s.id !== carrier.id && canCarryShip(balance, carrier.shipType, s.shipType)
        );
    }

    /** Our carriers on `ship`'s hex that take its type and have room. */
    carriersFor(ship: ShipEntity): ShipEntity[] {
        const balance = this.balance;
        if (!balance || ship.carriedBy) return [];
        return this.ownShipsAt(ship.q, ship.r).filter((c) => {
            const hangar = hangarFor(balance, c.shipType);
            return (
                c.id !== ship.id &&
                !!hangar &&
                canCarryShip(balance, c.shipType, ship.shipType) &&
                this.carriedShips(c).length < hangar.capacity
            );
        });
    }

    /** Current and full hp of a ship or supply ship; missing hp means full. */
    hpOf(entity: MobileEntity): { hp: number; max: number } | undefined {
        const balance = this.balance;
        if (!balance) return undefined;
        const max =
            entity.kind === "ship"
                ? shipStats(entity.shipType, entity.tier ?? 1, balance).hp
                : this.supplyStatsOf(entity).hp;
        const hp = entity.hp ?? max;
        return { hp, max: Math.max(max, hp) };
    }

    /**
     * Repair outlook for one of our damaged ships or supply ships: hp regained at the coming
     * end of turn, `blocked` when it fought this turn (see `repairsAtEndOf`), or `needsDock`
     * for ships that only repair aboard a carrier or at an owned shipyard (see `canRepairIn`).
     */
    repairOf(
        entity: MobileEntity
    ):
        | { status: "repairing"; perTurn: number }
        | { status: "blocked" }
        | { status: "needsDock" }
        | undefined {
        const balance = this.balance;
        const hp = this.hpOf(entity);
        if (!balance || !hp || !this.turn || entity.sideId !== this.sideId) return undefined;
        if (hp.hp <= 0 || hp.hp >= hp.max) return undefined;
        if (!repairsAtEndOf(entity.lastCombatTurn, this.turn.turn)) return { status: "blocked" };
        const yards: readonly string[] = REPAIR_YARD_STRUCTURES;
        const atOwnedShipyard = this.entitiesAt(entity.q, entity.r).some(
            (e) =>
                isLocationEntity(e) &&
                !!this.locationEconomy(e.id)?.installations.some((i) => yards.includes(i.type))
        );
        const context = {
            atOwnedShipyard,
            carried: entity.kind === "ship" && !!entity.carriedBy,
            needsDock: entity.kind === "ship" && !balance.ships[entity.shipType].repairsInSpace
        };
        if (!canRepairIn(context)) return { status: "needsDock" };
        const perTurn = shipRepairPerTurn(
            balance,
            hp.hp,
            hp.max,
            this.economy?.techs ?? [],
            context
        );
        return { status: "repairing", perTurn };
    }

    /** Supply ship stats: with our techs for our own, base stats for anyone else's. */
    supplyStatsOf(supplyShip: SupplyShipEntity): ReturnType<typeof supplyShipStats> {
        const techs = supplyShip.sideId === this.sideId ? (this.economy?.techs ?? []) : [];
        return this.balance
            ? supplyShipStats(this.balance, techs)
            : { hp: 0, defence: 0, evasion: 0, attack: 0 };
    }

    /** Our ships on `hex` that can colonise. */
    colonyShipsAt(q: number, r: number): ShipEntity[] {
        return this.ownShipsAt(q, r).filter((s) => canColonise(s, this.balance));
    }

    /** Our transports on `hex`. */
    transportsAt(q: number, r: number): ShipEntity[] {
        return this.ownShipsAt(q, r).filter((s) => isTransport(s, this.balance));
    }

    /** Units a transport carries, per its entity (falls back to our economy's unit list). */
    carriedUnitIds(ship: ShipEntity): EntityId[] {
        return ship.carriedUnitIds ?? this.unitsAboard(ship.id).map((u) => u.id);
    }

    /** Unowned build site the selected colony ship is sitting on, if it could colonise it. */
    get colonisableLocation(): { ship: ShipEntity; location: LocationEntity } | undefined {
        const ship = this.selectedShip;
        if (!ship || ship.sideId !== this.sideId || !canColonise(ship, this.balance)) {
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
        if (!location) return undefined;
        const ships = this.transportsAt(q, r).filter((s) => this.carriedUnitIds(s).length > 0);
        return ships.length ? { location, ships } : undefined;
    }

    /** Invasion the selected transport could launch from its hex. */
    get invasionOption(): { location: LocationEntity; ships: ShipEntity[] } | undefined {
        const ship = this.selectedShip;
        if (!ship || ship.sideId !== this.sideId || !isTransport(ship, this.balance)) {
            return undefined;
        }
        return this.invasionAt(ship.q, ship.r);
    }

    /** Enemy location on `hex` plus our ships there that can orbital-bombard. */
    bombardmentAt(
        q: number,
        r: number
    ): { location: LocationEntity; ships: ShipEntity[] } | undefined {
        const location = this.entitiesAt(q, r).find(
            (e): e is LocationEntity =>
                isLocationEntity(e) && e.sideId !== null && e.sideId !== this.sideId
        );
        if (!location) return undefined;
        const ships = this.ownShipsAt(q, r).filter(
            (s) => canBombard(s, this.balance) && s.movementPoints > 0
        );
        return ships.length ? { location, ships } : undefined;
    }

    /** Bombardment the selected capable ship could launch from its hex. */
    get bombardmentOption(): { location: LocationEntity; ships: ShipEntity[] } | undefined {
        const ship = this.selectedShip;
        if (!ship || ship.sideId !== this.sideId || !canBombard(ship, this.balance)) {
            return undefined;
        }
        return this.bombardmentAt(ship.q, ship.r);
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

    hyperdriveOf(ship: ShipEntity): HyperdriveBalance | undefined {
        return this.balance ? hyperdriveFor(this.balance, ship.shipType) : undefined;
    }

    /** Landing chances for a jump by `ship` with our current techs. */
    jumpAccuracy(ship: ShipEntity): HyperdriveAccuracy | undefined {
        if (!this.balance) return undefined;
        return hyperjumpAccuracy(
            this.balance,
            ship.shipType,
            ship.tier ?? 1,
            this.economy?.techs ?? []
        );
    }

    /** Our hyperjump range in hexes with our current techs; undefined before the map loads. */
    jumpRange(): number | undefined {
        if (!this.balance || !this.ready) return undefined;
        return hyperjumpRange(this.balance, this.economy?.techs ?? [], this.width, this.height);
    }

    /** Whether `hex` is within jump range of `ship` (always true while the range is unknown). */
    inJumpRange(ship: ShipEntity, hex: Axial): boolean {
        const range = this.jumpRange();
        return range === undefined || inHyperjumpRange(ship, hex, range);
    }

    /** Selected ship waiting for a hyperspace jump target click. */
    get hyperjumpTargeting(): ShipEntity | undefined {
        const ship = this.selectedShip;
        return ship && ship.id === this.hyperjumpTargetingId ? ship : undefined;
    }

    /** Select `shipId` and make the next map click pick its jump target. */
    startHyperjumpTargeting(shipId: EntityId) {
        this.selectShip(shipId);
        if (this.hyperjumpTargetingId === shipId) return;
        this.hyperjumpTargetingId = shipId;
        this._notify();
    }

    cancelHyperjumpTargeting() {
        if (!this.hyperjumpTargetingId) return;
        this.hyperjumpTargetingId = null;
        this._notify();
    }

    showNotice(text: string) {
        this.notice = { text, id: (this.notice?.id ?? 0) + 1 };
        this._notify();
    }

    clearNotice(id: number) {
        if (this.notice?.id !== id) return;
        this.notice = null;
        this._notify();
    }

    selectShip(shipId: EntityId | null) {
        if (shipId === null) {
            if (!this.selectedShipId && !this.inspectedEntityId) return;
            this.selectedShipId = null;
            this.inspectedEntityId = null;
            this.hyperjumpTargetingId = null;
            this._notify();
            return;
        }
        if (this.selectedShipId === shipId) return;
        this.selectedShipId = shipId;
        this.inspectedEntityId = null;
        this.hyperjumpTargetingId = null;
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
        this.hyperjumpTargetingId = null;
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
        const entities = tile.entities.filter((e) => !isCarried(e));
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

    /** Ship routes, like the server's: explored hexes only, around known obstacles. */
    private _routeOptions(): HexPathOptions {
        return {
            inBounds: (h) => this.isOnMap(h.q, h.r) && this._tiles.has(hexKey(h.q, h.r)),
            passable: (h) => !this.isKnownObstacle(h)
        };
    }

    isExplored(hex: Axial): boolean {
        return this._tiles.has(hexKey(hex.q, hex.r));
    }

    /**
     * Hexes the selected ship can reach this turn going around known obstacles
     * (excluding its own hex). Obstacles are included when they are the final step.
     */
    reachableHexes(): Axial[] {
        const ship = this.selectedShip;
        if (!ship || ship.hyperdriveCharging) return [];
        const steps = Math.floor(ship.movementPoints / MOVE_COST_PER_HEX);
        if (steps <= 0) return [];
        return hexReachable(ship, steps, this._routeOptions());
    }

    /**
     * Route the selected ship would take to `hex` (its own hex excluded) through explored
     * space, or null when there is none. Cosmetic: the server plans the real one.
     */
    previewRoute(hex: Axial): Axial[] | null {
        const ship = this.selectedShip;
        if (!ship || (ship.q === hex.q && ship.r === hex.r) || !this.isExplored(hex)) return null;
        const key = `${ship.q},${ship.r}>${hex.q},${hex.r}@${this._version}`;
        if (this._previewCache?.key !== key) {
            const path = findHexPath(ship, hex, this._routeOptions());
            this._previewCache = { key, route: path ? path.slice(1) : null };
        }
        return this._previewCache.route;
    }

    pickHex(screen: Pixel, canvas: HTMLCanvasElement): Axial | null {
        if (!this.ready) return null;
        const hex = pixelToAxial(this.screenToWorld(screen, canvas), this.hexSize);
        return this.isOnMap(hex.q, hex.r) ? hex : null;
    }

    /** Decide what a click (not drag) at `screen` should do; selection changes are applied here. */
    handleClick(screen: Pixel, canvas: HTMLCanvasElement): HexClickAction {
        const hex = this.pickHex(screen, canvas);
        if (this.hyperjumpTargetingId) {
            return this._targetingClick(hex);
        }
        if (!hex) {
            return this._deselect();
        }

        const tile = this._tiles.get(hexKey(hex.q, hex.r));
        const entities = tile?.entities.filter((e) => !isCarried(e)) ?? [];

        // Clicking the hex of the current selection cycles through everything on it
        // (never a move order); a lone selected ship stays selected (Escape deselects).
        const cycle = this.clickCycle(entities);
        const index = cycle.findIndex(
            (e) => e.id === (this.selectedShipId ?? this.inspectedEntityId)
        );
        if (index >= 0 && cycle.length > 1) {
            return this._pick(cycle[(index + 1) % cycle.length], false);
        }
        if (index >= 0 && this.selectedShipId) {
            return { type: "none" };
        }

        // With a ship selected, any other hex is a destination, even one holding our own
        // ships or locations: the ship goes as far as its MP allow now and the server keeps
        // the rest as a move order.
        const ship = this.selectedShip;
        if (ship) {
            if (!tile) {
                return { type: "rejected", reason: "Ships can only be sent to explored hexes" };
            }
            if (ship.hyperdriveCharging) {
                return {
                    type: "rejected",
                    reason: "Hyperdrive engaged: cancel the jump to move normally"
                };
            }
            const move: HexClickAction = {
                type: "move",
                shipId: ship.id,
                to: { q: hex.q, r: hex.r }
            };
            // A destination beyond this turn's reach leaves a standing order; deselect so
            // the destination picker doesn't look like it still needs dismissing.
            const route = this.previewRoute(hex);
            const steps = Math.floor(ship.movementPoints / MOVE_COST_PER_HEX);
            if (!route || route.length > steps) this._deselect();
            return move;
        }

        const ownShip = cycle[0];
        if (ownShip?.kind === "ship" && ownShip.sideId === this.sideId) {
            return this._pick(ownShip, false);
        }

        const location = primaryEntity(entities.filter(isBuildSite));
        const first = location ?? primaryEntity(entities);
        return first ? this._pick(first, true) : this._deselect();
    }

    /** While targeting, a click on an explored hex picks the jump target; nothing else changes. */
    private _targetingClick(hex: Axial | null): HexClickAction {
        const ship = this.hyperjumpTargeting;
        if (!ship) {
            this.cancelHyperjumpTargeting();
            return { type: "none" };
        }
        if (!hex) return { type: "none" };
        if (!this.isExplored(hex)) {
            return { type: "rejected", reason: "Jump targets must be explored hexes" };
        }
        if (hex.q === ship.q && hex.r === ship.r) {
            return { type: "rejected", reason: "Pick a hex other than the ship's own" };
        }
        if (!this.inJumpRange(ship, hex)) {
            return {
                type: "rejected",
                reason: `Beyond hyperdrive range (${(this.jumpRange() ?? 0).toFixed(1)} hexes)`
            };
        }
        this.hyperjumpTargetingId = null;
        this._notify();
        return { type: "hyperjump", shipId: ship.id, target: { q: hex.q, r: hex.r } };
    }

    /**
     * Entities on a hex in click-cycle order: our ships, then locations, then the rest.
     * Ships aboard carriers are left out.
     */
    clickCycle(entities: EntitySummary[]): EntitySummary[] {
        const rank = (e: EntitySummary) =>
            e.kind === "ship" && e.sideId === this.sideId ? 0 : isBuildSite(e) ? 1 : 2;
        return entities
            .filter((e) => !isCarried(e))
            .sort(
                (a, b) =>
                    rank(a) - rank(b) ||
                    ENTITY_FOCUS_PRIORITY[a.kind] - ENTITY_FOCUS_PRIORITY[b.kind]
            );
    }

    /**
     * Select our ships, inspect anything else. Our own locations open their page only
     * when `openLocation` is set, so cycling onto one doesn't cover the map.
     */
    private _pick(entity: EntitySummary, openLocation: boolean): HexClickAction {
        if (entity.kind === "ship" && entity.sideId === this.sideId) {
            this.selectShip(entity.id);
            return { type: "select", shipId: entity.id };
        }
        this.inspectEntity(entity.id);
        if (openLocation && isBuildSite(entity) && entity.sideId === this.sideId) {
            return { type: "open-location", locationId: entity.id };
        }
        return { type: "inspect", entityId: entity.id };
    }

    private _deselect(): HexClickAction {
        if (!this.selectedShipId && !this.inspectedEntityId) return { type: "none" };
        this.selectedShipId = null;
        this.inspectedEntityId = null;
        this.hyperjumpTargetingId = null;
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
                if (!isMobile(entity) || isCarried(entity)) continue;
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
            if (!ship || ship.sideId !== this.sideId || ship.carriedBy) {
                this.selectedShipId = null;
            }
        }
        if (this.hyperjumpTargetingId && this.hyperjumpTargetingId !== this.selectedShipId) {
            this.hyperjumpTargetingId = null;
        }
        if (this.inspectedEntityId) {
            const entity = this.findEntityById(this.inspectedEntityId);
            if (!entity || isCarried(entity)) this.inspectedEntityId = null;
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
        this._frameNow = now;
        this._framePoses.clear();
        for (const [id, motion] of this._motions) {
            if (motion.isDone(now)) {
                this._motions.delete(id);
            } else {
                this._framePoses.set(id, motion.poseAt(now));
            }
        }
        for (const [id, arriveAt] of this._arrivals) {
            if (now >= arriveAt + JUMP_SCALE_IN_MS) this._arrivals.delete(id);
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
            this._drawShip(context, center, size, entity, fullColour, pose.heading);
            drawn.add(entity.id);
        }
        for (const id of this._framePoses.keys()) {
            if (!drawn.has(id)) {
                this._motions.delete(id);
                this._framePoses.delete(id);
            }
        }

        this._drawDying(context, canvas, now, size);
        this._drawDeparting(context, canvas, now, size);
        const toScreen = (p: Pixel) => this.worldToScreen(p, canvas);
        this._jumpFlashes.render(context, now, toScreen, this.camera.zoom);
        this._explosions.render(context, now, toScreen, this.camera.zoom);
        this._combatEffects.render(context, now, toScreen, this.camera.zoom);

        this._drawSelection(context, canvas);
    }

    /** 0 while a jumping ship is still in hyperspace, growing to 1 as it arrives. */
    private _arrivalScale(id: EntityId): number {
        const arriveAt = this._arrivals.get(id);
        if (arriveAt === undefined) return 1;
        const t = (this._frameNow - arriveAt) / JUMP_SCALE_IN_MS;
        if (t <= 0) return 0;
        return t >= 1 ? 1 : t * t * (3 - 2 * t);
    }

    /** Mobile entity with its hyperdrive glow and any jump-arrival scaling. */
    private _drawShip(
        ctx: DrawCtx,
        center: Pixel,
        size: number,
        entity: MobileEntity,
        fullColour: boolean,
        heading?: number
    ) {
        const scale = this._arrivalScale(entity.id);
        if (scale <= 0) return;
        if (entity.kind === "ship" && entity.hyperdriveCharging) {
            this._drawChargeGlow(ctx, center, size, fullColour);
        }
        drawEntityPlaceholder(
            ctx,
            center,
            size * scale,
            entity,
            this.balance,
            fullColour,
            heading,
            size
        );
        if (scale < 1 || !fullColour) return;
        this._drawHpBar(ctx, center, size, entity);
        const carried =
            entity.kind === "ship" ? (entity.carriedShipCount ?? entity.carriedShipIds?.length) : 0;
        if (carried) this._drawHangarBadge(ctx, center, size, carried, entity.sideId);
    }

    /** Thin hull bar under a damaged ship, or under the selected / inspected one. */
    private _drawHpBar(ctx: DrawCtx, center: Pixel, size: number, entity: MobileEntity) {
        if (size < 14) return;
        const hp = this.hpOf(entity);
        if (!hp) return;
        const shown = this._hpShown.get(entity.id);
        let current = hp.hp;
        if (shown && this._frameNow < shown.until) {
            current = shown.hp;
        } else if (shown) {
            this._hpShown.delete(entity.id);
        }
        const picked = entity.id === this.selectedShipId || entity.id === this.inspectedEntityId;
        if (current >= hp.max && !picked) return;
        const ratio = Math.max(0, Math.min(1, current / hp.max));
        const width = size * 0.62;
        const height = Math.max(2, size * 0.07);
        const x = center.x - width / 2;
        const y = center.y + size * 0.5;
        ctx.save();
        ctx.fillStyle = "rgba(4, 8, 18, 0.85)";
        ctx.fillRect(x - 1, y - 1, width + 2, height + 2);
        ctx.fillStyle = ratio > 0.6 ? "#5cffb0" : ratio > 0.3 ? "#ffd166" : "#ff6b8a";
        ctx.fillRect(x, y, width * ratio, height);
        ctx.restore();
    }

    /** Count of ships aboard a carrier, in a small disc at its upper right. */
    private _drawHangarBadge(
        ctx: DrawCtx,
        center: Pixel,
        size: number,
        count: number,
        sideId: SideId | null
    ) {
        if (size < 18) return;
        const radius = Math.max(6, size * 0.14);
        const x = center.x + size * 0.42;
        const y = center.y - size * 0.42;
        ctx.save();
        ctx.fillStyle = "rgba(8, 12, 24, 0.92)";
        ctx.strokeStyle = sideColour(sideId, "#d0d0d0");
        ctx.lineWidth = Math.max(1, size * 0.03);
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#e8eefc";
        ctx.font = `700 ${Math.round(radius * 1.25)}px "IBM Plex Sans", "Segoe UI", sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(count), x, y + radius * 0.05);
        ctx.restore();
    }

    /** Pulsing cyan glow around a ship whose hyperdrive is engaged. */
    private _drawChargeGlow(ctx: DrawCtx, center: Pixel, size: number, fullColour: boolean) {
        const pulse = 0.5 + 0.5 * Math.sin(this._frameNow / 180);
        const radius = size * (0.62 + 0.14 * pulse);
        const alpha = fullColour ? 1 : 0.5;
        ctx.save();
        const g = ctx.createRadialGradient(
            center.x,
            center.y,
            size * 0.1,
            center.x,
            center.y,
            radius
        );
        g.addColorStop(0, `rgba(127, 232, 255, ${(0.25 + 0.25 * pulse) * alpha})`);
        g.addColorStop(1, "rgba(127, 232, 255, 0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = `rgba(160, 240, 255, ${(0.35 + 0.45 * pulse) * alpha})`;
        ctx.lineWidth = Math.max(1, size * 0.035);
        ctx.beginPath();
        ctx.arc(center.x, center.y, radius * 0.85, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }

    /** Jumping ships shrink away at their origin while the implosion plays. */
    private _drawDeparting(ctx: DrawCtx, canvas: HTMLCanvasElement, now: number, size: number) {
        this._departing = this._departing.filter(({ entity, pose, departAt, arriveAt }) => {
            if (now >= arriveAt) return false;
            const t = Math.max(0, (now - departAt) / (arriveAt - departAt));
            const center = this.worldToScreen(pose, canvas);
            if (entity.kind === "ship" && t === 0) {
                this._drawChargeGlow(ctx, center, size, true);
            }
            ctx.save();
            ctx.globalAlpha = 1 - t * t;
            drawEntityPlaceholder(
                ctx,
                center,
                size * (1 - t),
                entity,
                this.balance,
                true,
                pose.heading + t * t * Math.PI,
                size
            );
            ctx.restore();
            return true;
        });
    }

    private _drawDying(ctx: DrawCtx, canvas: HTMLCanvasElement, now: number, size: number) {
        this._dying = this._dying.filter(({ entity, motion, colour }) => {
            const pose = motion.poseAt(now);
            if (motion.isDone(now)) {
                if (colour) this._explosions.spawn(pose, colour, this.hexSize, now);
                return false;
            }
            const center = this.worldToScreen(pose, canvas);
            this._drawShip(ctx, center, size, entity, true, pose.heading);
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
            if (!isMobile(entity)) {
                drawEntityPlaceholder(ctx, center, size, entity, this.balance, fullColour);
                continue;
            }
            if (isCarried(entity)) continue;
            const pose = this._framePoses.get(entity.id);
            if (pose) {
                deferred.push({ entity, pose, fullColour });
                continue;
            }
            this._drawShip(ctx, center, size, entity, fullColour);
        }
    }

    /** Line from `start` through `route` in the current stroke style: solid for `solid` hexes, dashed after. */
    private _strokeRoute(ctx: DrawCtx, start: Pixel, route: Pixel[], solid: number, size: number) {
        const drawLeg = (points: Pixel[], dashed: boolean) => {
            if (points.length < 2) return;
            ctx.setLineDash(dashed ? [size * 0.18, size * 0.14] : []);
            ctx.beginPath();
            ctx.moveTo(points[0].x, points[0].y);
            for (const p of points.slice(1)) ctx.lineTo(p.x, p.y);
            ctx.stroke();
        };
        drawLeg([start, ...route.slice(0, solid)], false);
        drawLeg(solid > 0 ? route.slice(solid - 1) : [start, ...route], true);
        ctx.setLineDash([]);
    }

    private _hexToScreen(hex: Axial, canvas: HTMLCanvasElement): Pixel {
        return this.worldToScreen(axialToPixel(hex.q, hex.r, this.hexSize), canvas);
    }

    /** Where a ship is drawn this frame, mid-animation or at its hex. */
    private _shipScreenPos(ship: MobileEntity, canvas: HTMLCanvasElement): Pixel {
        return this.worldToScreen(
            this._framePoses.get(ship.id) ?? axialToPixel(ship.q, ship.r, this.hexSize),
            canvas
        );
    }

    /** Our ships carrying a move order or a pending jump. */
    private _ownShipsWithOrders(): ShipEntity[] {
        const ships: ShipEntity[] = [];
        for (const tile of this._tiles.values()) {
            for (const e of tile.entities) {
                if (e.kind !== "ship" || e.sideId !== this.sideId) continue;
                if (e.moveOrder || e.hyperjump) ships.push(e);
            }
        }
        return ships;
    }

    /**
     * Move order destinations and jump targets of our ships. The selected ship gets its
     * whole route (next end of turn solid, later turns dashed) and a prominent flag.
     */
    private _drawOrders(ctx: DrawCtx, canvas: HTMLCanvasElement) {
        const size = this.hexSize * this.camera.zoom;
        for (const ship of this._ownShipsWithOrders()) {
            const selected = ship.id === this.selectedShipId;
            if (ship.hyperjump) {
                this._drawScatter(ctx, canvas, ship.hyperjump.target, selected ? 0.9 : 0.4);
                if (selected) {
                    ctx.save();
                    ctx.strokeStyle = "rgba(127, 232, 255, 0.6)";
                    ctx.lineWidth = Math.max(1, size * 0.035);
                    ctx.setLineDash([size * 0.1, size * 0.14]);
                    const from = this._shipScreenPos(ship, canvas);
                    const to = this._hexToScreen(ship.hyperjump.target, canvas);
                    ctx.beginPath();
                    ctx.moveTo(from.x, from.y);
                    ctx.lineTo(to.x, to.y);
                    ctx.stroke();
                    ctx.restore();
                }
            }
            if (!ship.moveOrder) continue;
            const dest = this._hexToScreen(ship.moveOrder.destination, canvas);
            if (!selected) {
                this._drawFlag(ctx, dest, size, false);
                continue;
            }
            const route = (ship.moveOrder.route ?? [ship.moveOrder.destination]).map((h) =>
                this._hexToScreen(h, canvas)
            );
            const nextTurn = Math.floor(ship.maxMovementPoints / MOVE_COST_PER_HEX);
            ctx.save();
            ctx.strokeStyle = "rgba(92, 255, 176, 0.85)";
            ctx.fillStyle = "rgba(92, 255, 176, 0.85)";
            ctx.lineWidth = Math.max(1, size * 0.05);
            this._strokeRoute(ctx, this._shipScreenPos(ship, canvas), route, nextTurn, size);
            for (const p of route.slice(0, -1)) {
                ctx.beginPath();
                ctx.arc(p.x, p.y, Math.max(1.5, size * 0.06), 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
            this._drawFlag(ctx, dest, size, true);
        }
    }

    /** Move order destination: a pulsing ring and flag, or a small faint flag. */
    private _drawFlag(ctx: DrawCtx, at: Pixel, size: number, prominent: boolean) {
        const k = prominent ? 1 : 0.45;
        ctx.save();
        if (prominent) {
            const pulse = 0.5 + 0.5 * Math.sin(this._frameNow / 250);
            ctx.strokeStyle = `rgba(92, 255, 176, ${0.55 + 0.45 * pulse})`;
            ctx.lineWidth = Math.max(1.5, size * 0.05);
            ctx.beginPath();
            ctx.arc(at.x, at.y, size * (0.55 + 0.05 * pulse), 0, Math.PI * 2);
            ctx.stroke();
        } else {
            ctx.globalAlpha = 0.6;
        }
        const pole = size * 0.7 * k;
        const baseX = at.x - size * 0.12 * k;
        const baseY = at.y + pole * 0.45;
        ctx.strokeStyle = "#e8eefc";
        ctx.lineWidth = Math.max(1, size * 0.035 * k);
        ctx.beginPath();
        ctx.moveTo(baseX, baseY);
        ctx.lineTo(baseX, baseY - pole);
        ctx.stroke();
        ctx.fillStyle = "#5cffb0";
        ctx.beginPath();
        ctx.moveTo(baseX, baseY - pole);
        ctx.lineTo(baseX + pole * 0.6, baseY - pole * 0.78);
        ctx.lineTo(baseX, baseY - pole * 0.56);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    /** Dashed circle around a targeting ship marking how far its jump can reach. */
    private _drawJumpRange(ctx: DrawCtx, canvas: HTMLCanvasElement, ship: ShipEntity) {
        const range = this.jumpRange();
        if (range === undefined) return;
        const size = this.hexSize * this.camera.zoom;
        const center = this._shipScreenPos(ship, canvas);
        // Neighbouring pointy-top hex centres are sqrt(3) * size apart.
        const radius = range * Math.sqrt(3) * size;
        ctx.save();
        ctx.fillStyle = "rgba(127, 232, 255, 0.05)";
        ctx.strokeStyle = "rgba(127, 232, 255, 0.6)";
        ctx.lineWidth = Math.max(1, size * 0.04);
        ctx.setLineDash([size * 0.25, size * 0.15]);
        ctx.beginPath();
        ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
    }

    /** Jump target hex and the rings a jump can scatter onto, faded by `strength` (0-1). */
    private _drawScatter(ctx: DrawCtx, canvas: HTMLCanvasElement, target: Axial, strength: number) {
        const size = this.hexSize * this.camera.zoom;
        const inBounds = (h: Axial) => this.isOnMap(h.q, h.r);
        ctx.save();
        ctx.lineWidth = Math.max(0.75, size * 0.025);
        for (let ring = MAX_SCATTER_RING; ring >= 1; ring--) {
            const fade = strength / (ring + 1);
            ctx.fillStyle = `rgba(127, 232, 255, ${0.22 * fade})`;
            ctx.strokeStyle = `rgba(127, 232, 255, ${0.35 * fade})`;
            for (const hex of ringHexes(target, ring, inBounds)) {
                this._hexPath(ctx, this._hexToScreen(hex, canvas), size * 0.92);
                ctx.fill();
                ctx.stroke();
            }
        }
        const center = this._hexToScreen(target, canvas);
        ctx.fillStyle = `rgba(127, 232, 255, ${0.3 * strength})`;
        ctx.strokeStyle = `rgba(160, 240, 255, ${strength})`;
        ctx.lineWidth = Math.max(1.5, size * 0.05);
        this._hexPath(ctx, center, size * 0.92);
        ctx.fill();
        ctx.stroke();
        const r = size * 0.3;
        ctx.beginPath();
        ctx.moveTo(center.x - r, center.y);
        ctx.lineTo(center.x + r, center.y);
        ctx.moveTo(center.x, center.y - r);
        ctx.lineTo(center.x, center.y + r);
        ctx.stroke();
        ctx.restore();
    }

    /**
     * Under the cursor with a ship selected: the scatter area while targeting a jump,
     * otherwise the route a move would take (this turn's MP solid, the rest dashed).
     */
    private _drawHoverPreview(ctx: DrawCtx, canvas: HTMLCanvasElement, ship: ShipEntity) {
        const hex = this.hoveredHex;
        if (!hex) return;
        const size = this.hexSize * this.camera.zoom;
        const onShip = hex.q === ship.q && hex.r === ship.r;
        if (onShip) return;
        const outOfRange = !!this.hyperjumpTargeting && !this.inJumpRange(ship, hex);
        if (!this.isExplored(hex) || outOfRange) {
            ctx.save();
            ctx.strokeStyle = "rgba(255, 107, 138, 0.6)";
            ctx.lineWidth = Math.max(1, size * 0.04);
            ctx.setLineDash([size * 0.1, size * 0.08]);
            this._hexPath(ctx, this._hexToScreen(hex, canvas), size * 0.85);
            ctx.stroke();
            ctx.restore();
            return;
        }
        if (this.hyperjumpTargeting) {
            this._drawScatter(ctx, canvas, hex, 1);
            return;
        }
        if (ship.hyperdriveCharging) return;
        const route = this.previewRoute(hex)?.map((h) => this._hexToScreen(h, canvas));
        if (!route?.length) return;
        ctx.save();
        ctx.strokeStyle = "rgba(232, 238, 252, 0.7)";
        ctx.lineWidth = Math.max(1, size * 0.035);
        const thisTurn = Math.floor(ship.movementPoints / MOVE_COST_PER_HEX);
        this._strokeRoute(ctx, this._shipScreenPos(ship, canvas), route, thisTurn, size);
        this._hexPath(ctx, route[route.length - 1], size * 0.85);
        ctx.stroke();
        ctx.restore();
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
        this._strokeRoute(ctx, start, route, thisTurn, size);
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

    /** Amber ring around the inspected entity so stacked hexes show which one is picked. */
    private _drawInspected(ctx: DrawCtx, canvas: HTMLCanvasElement) {
        const entity = this.inspectedEntityId
            ? this.findEntityById(this.inspectedEntityId)
            : undefined;
        if (!entity || entity.kind === "supply_ship") return;
        const size = this.hexSize * this.camera.zoom;
        const center = this.worldToScreen(
            this._framePoses.get(entity.id) ?? axialToPixel(entity.q, entity.r, this.hexSize),
            canvas
        );
        const radius = Math.min(0.85, Math.max(0.4, (entity.scale ?? 0.5) * 1.4)) * size;
        const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 250);
        ctx.save();
        ctx.strokeStyle = `rgba(255, 209, 102, ${0.55 + 0.45 * pulse})`;
        ctx.lineWidth = Math.max(1.5, size * 0.05);
        ctx.setLineDash([size * 0.12, size * 0.08]);
        ctx.beginPath();
        ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }

    private _drawSelection(ctx: DrawCtx, canvas: HTMLCanvasElement) {
        this._drawSupplyRoute(ctx, canvas);
        this._drawInspected(ctx, canvas);
        const ship = this.selectedShip;
        if (ship && !this.hyperjumpTargeting) {
            const size = this.hexSize * this.camera.zoom;
            ctx.save();
            ctx.fillStyle = "rgba(92, 255, 176, 0.1)";
            ctx.strokeStyle = "rgba(92, 255, 176, 0.45)";
            ctx.lineWidth = Math.max(0.75, 1.5 * this.camera.zoom);
            for (const hex of this.reachableHexes()) {
                this._hexPath(ctx, this._hexToScreen(hex, canvas), size * 0.92);
                ctx.fill();
                ctx.stroke();
            }
            ctx.restore();
        }
        if (this.hyperjumpTargeting) this._drawJumpRange(ctx, canvas, this.hyperjumpTargeting);
        this._drawOrders(ctx, canvas);
        if (!ship || this._arrivalScale(ship.id) <= 0) return;
        this._drawHoverPreview(ctx, canvas, ship);
        const size = this.hexSize * this.camera.zoom;

        ctx.save();
        const center = this._shipScreenPos(ship, canvas);
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
    balance: EconomyBalance | null,
    fullColour: boolean,
    /** Ship heading override (radians); defaults to the entity's facing. */
    heading?: number,
    /** On-screen hex size that picks ship sprites over triangles; `hexSize` when absent. */
    zoomedHexSize = hexSize
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
            const sprite = zoomedHexSize >= SHIP_SPRITE_MIN_HEX_SIZE && shipSprite(entity.shipType);
            if (sprite) {
                drawShipSprite(ctx, sprite, scale, hexSize, sideColour(entity.sideId, "#d0d0d0"));
                break;
            }
            if (canColonise(entity, balance)) {
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
            if (isTransport(entity, balance) && entity.carriedUnitIds?.length) {
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

/**
 * Top-down picture with a glow in the side colour; nose along +x (context already rotated,
 * the picture's nose points up). Its longer side spans about the triangle hull's length.
 */
function drawShipSprite(
    ctx: DrawCtx,
    sprite: ShipSprite,
    scale: number,
    hexSize: number,
    colour: string
) {
    const length = scale * 1.9;
    const w = sprite.aspect >= 1 ? length : length * sprite.aspect;
    const h = sprite.aspect >= 1 ? length / sprite.aspect : length;
    ctx.rotate(Math.PI / 2);
    ctx.shadowColor = colour;
    ctx.shadowBlur = Math.max(3, hexSize * 0.12);
    ctx.drawImage(sprite.image, -w / 2, -h / 2, w, h);
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
