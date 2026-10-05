import { axialKey, axialRange, parseAxialKey } from "@space/maths";
import {
    hexHasObstacle,
    type AxialCoord,
    type ClientId,
    type EntityId,
    type EntitySummary,
    type HexKey,
    type SideId,
    type TileView
} from "@space/shared-data";
import type { EntityManager } from "./EntityManager.js";
import { findTileByAxial, forEachTile, tileKey } from "./map/SpaceMap.js";
import { entityToSummary, type Entity, type EntityOf } from "./map/types.js";

/** Supply ships see only their own and neighbouring hexes. */
export const DEFAULT_SUPPLY_VISION_RANGE = 1;

/** Space structures under construction (and any without a configured range) see their neighbours. */
export const DEFAULT_SITE_VISION_RANGE = 1;

export type VisibilityDiff = {
    /** Hexes that became visible. */
    revealed: HexKey[];
    /** Hexes that dropped from visible to explored. */
    hidden: HexKey[];
    /** Entities scrubbed from remembered (explored, not visible) hexes. */
    forgetEntityIds: EntityId[];
};

export type TilesUpdatePayload = {
    tiles: TileView[];
    visible: HexKey[];
    forgetEntityIds?: EntityId[];
};

export type SideOptions = {
    /** Every hex on the map is visible to this side at all times. */
    fullVisibility?: boolean;
};

export class Side {
    readonly id: SideId;
    readonly fullVisibility: boolean;
    private readonly _clientIds = new Set<ClientId>();
    private readonly _explored = new Set<HexKey>();
    private readonly _visible = new Set<HexKey>();
    /** Last-known entities per hex (explored memory). */
    private readonly _memory = new Map<HexKey, EntitySummary[]>();

    constructor(id: SideId, options: SideOptions = {}) {
        this.id = id;
        this.fullVisibility = options.fullVisibility ?? false;
    }

    get clientIds(): ReadonlySet<ClientId> {
        return this._clientIds;
    }

    get explored(): ReadonlySet<HexKey> {
        return this._explored;
    }

    get visible(): ReadonlySet<HexKey> {
        return this._visible;
    }

    addClient(clientId: ClientId) {
        this._clientIds.add(clientId);
    }

    removeClient(clientId: ClientId) {
        this._clientIds.delete(clientId);
    }

    /**
     * Mark every hex explored and remember its current contents. Hexes that are
     * not visible will show these remembered contents until seen again.
     */
    exploreAll(entities: EntityManager) {
        forEachTile(entities.map, (tile) => {
            const key = tileKey(tile);
            this._explored.add(key);
            if (!this._visible.has(key)) {
                this._memory.set(key, this._viewAt(entities, tile.q, tile.r));
            }
        });
    }

    /**
     * Recompute visibility from this side's ships, supply ships and owned locations, refresh
     * memory of visible hexes and scrub stale sightings of entities whose position is now known.
     */
    recomputeVisibility(
        entities: EntityManager,
        visionRange: number,
        supplyVisionRange = DEFAULT_SUPPLY_VISION_RANGE,
        structureVision: (structure: EntityOf<"space_structure">) => number = () =>
            DEFAULT_SITE_VISION_RANGE
    ): VisibilityDiff {
        const { map } = entities;
        const nextVisible = new Set<HexKey>();
        const ownShips = entities.ofKind("ship").filter((ship) => ship.sideId === this.id);
        const ownSupply = entities.ofKind("supply_ship").filter((s) => s.sideId === this.id);
        const ownStructures = entities
            .ofKind("space_structure")
            .filter((s) => s.sideId === this.id);

        if (this.fullVisibility) {
            forEachTile(map, (tile) => nextVisible.add(tileKey(tile)));
        } else {
            const ownLocations = [
                ...entities.ofKind("planet"),
                ...entities.ofKind("moon"),
                ...entities.ofKind("large_asteroid")
            ].filter((l) => l.sideId === this.id);
            const sources: [AxialCoord, number][] = [
                ...[...ownShips, ...ownLocations].map((s): [AxialCoord, number] => [
                    s,
                    visionRange
                ]),
                ...ownSupply.map((s): [AxialCoord, number] => [s, supplyVisionRange]),
                ...ownStructures.map((s): [AxialCoord, number] => [s, structureVision(s)])
            ];
            for (const [source, range] of sources) {
                for (const hex of axialRange(source, range)) {
                    if (findTileByAxial(map, hex.q, hex.r)) {
                        nextVisible.add(axialKey(hex.q, hex.r));
                    }
                }
            }
        }

        const revealed = [...nextVisible].filter((key) => !this._visible.has(key));
        const hidden = [...this._visible].filter((key) => !nextVisible.has(key));

        this._visible.clear();
        const knownPositions = new Map<EntityId, HexKey>();
        for (const key of nextVisible) {
            this._visible.add(key);
            this._explored.add(key);
            const { q, r } = parseAxialKey(key);
            const summaries = this._viewAt(entities, q, r);
            this._memory.set(key, summaries);
            for (const summary of summaries) knownPositions.set(summary.id, key);
        }
        for (const ship of [...ownShips, ...ownSupply]) {
            knownPositions.set(ship.id, axialKey(ship.q, ship.r));
        }

        const forgotten = new Set<EntityId>();
        for (const [key, remembered] of this._memory) {
            if (this._visible.has(key)) continue;
            const filtered = remembered.filter((summary) => {
                const knownAt = knownPositions.get(summary.id);
                const stale = knownAt !== undefined && knownAt !== key;
                if (stale) forgotten.add(summary.id);
                return !stale;
            });
            if (filtered.length !== remembered.length) {
                this._memory.set(key, filtered);
            }
        }

        return { revealed, hidden, forgetEntityIds: [...forgotten] };
    }

    /** Scrub `ids` from remembered hexes; returns the ids that were remembered. */
    forgetEntities(ids: Iterable<EntityId>): EntityId[] {
        const forget = new Set(ids);
        const forgotten = new Set<EntityId>();
        for (const [key, remembered] of this._memory) {
            if (!remembered.some((summary) => forget.has(summary.id))) continue;
            this._memory.set(
                key,
                remembered.filter((summary) => {
                    if (!forget.has(summary.id)) return true;
                    forgotten.add(summary.id);
                    return false;
                })
            );
        }
        return [...forgotten];
    }

    /** Current view of an explored hex, or null if unexplored. */
    buildTileView(entities: EntityManager, key: HexKey): TileView | null {
        if (!this._explored.has(key)) return null;
        const { q, r } = parseAxialKey(key);
        if (this._visible.has(key)) {
            return {
                q,
                r,
                fog: "visible",
                entities: this._viewAt(entities, q, r)
            };
        }
        return { q, r, fog: "explored", entities: this._memory.get(key) ?? [] };
    }

    buildTileViews(entities: EntityManager): TileView[] {
        const views: TileView[] = [];
        for (const key of this._explored) {
            const view = this.buildTileView(entities, key);
            if (view) views.push(view);
        }
        return views;
    }

    /**
     * Build a `server:tiles:update` payload from a visibility diff plus hexes whose
     * contents changed (`touched`). Touched hexes are only included while visible.
     * Returns null when there is nothing to tell this side.
     */
    buildTilesUpdate(
        entities: EntityManager,
        diff: VisibilityDiff,
        touched: Iterable<HexKey> = []
    ): TilesUpdatePayload | null {
        const keys = new Set<HexKey>([...diff.revealed, ...diff.hidden]);
        for (const key of touched) {
            if (this._visible.has(key)) keys.add(key);
        }
        if (keys.size === 0 && diff.forgetEntityIds.length === 0) return null;

        const tiles: TileView[] = [];
        for (const key of keys) {
            const view = this.buildTileView(entities, key);
            if (view) tiles.push(view);
        }

        const payload: TilesUpdatePayload = { tiles, visible: this.visibleKeys() };
        if (diff.forgetEntityIds.length > 0) {
            payload.forgetEntityIds = diff.forgetEntityIds;
        }
        return payload;
    }

    /**
     * Whether this side believes `hex` holds an obstacle: live contents when visible,
     * remembered contents when explored, and passable when unexplored.
     */
    knowsObstacleAt(entities: EntityManager, hex: AxialCoord): boolean {
        const key = axialKey(hex.q, hex.r);
        if (this._visible.has(key)) return hexHasObstacle(entities.entitiesAt(hex.q, hex.r));
        return hexHasObstacle(this._memory.get(key) ?? []);
    }

    /**
     * Whether this side believes `hex` holds enemy ships or armed space structures (supply
     * ships don't count): live contents when visible, remembered contents when explored, and
     * none when unexplored.
     */
    knowsEnemyAt(entities: EntityManager, hex: AxialCoord): boolean {
        const key = axialKey(hex.q, hex.r);
        const known = this._visible.has(key)
            ? entities.entitiesAt(hex.q, hex.r)
            : (this._memory.get(key) ?? []);
        return known.some((e) => {
            if (e.kind === "ship") return e.sideId !== this.id;
            if (e.kind !== "space_structure" || e.sideId === this.id) return false;
            return e.structureType === "space_station" || e.structureType === "missile_battery";
        });
    }

    /** Whether every hex in `hexes` is currently visible to this side. */
    seesAll(hexes: Iterable<AxialCoord>): boolean {
        for (const hex of hexes) {
            if (!this._visible.has(axialKey(hex.q, hex.r))) return false;
        }
        return true;
    }

    visibleKeys(): HexKey[] {
        return Array.from(this._visible);
    }

    /**
     * A hex's contents as this side sees them live: the tile's stack plus this side's own ships
     * stowed aboard carriers there (listed after their carrier, with `carriedBy` set). Other
     * sides' carried ships are never shown.
     */
    private _viewAt(entities: EntityManager, q: number, r: number): EntitySummary[] {
        const result: EntitySummary[] = [];
        const add = (entity: Entity) => {
            result.push(this.summarize(entity));
            if (entity.kind !== "ship" || entity.sideId !== this.id) return;
            for (const id of entity.carriedShipIds ?? []) {
                const carried = entities.getOfKind(id, "ship");
                if (carried) add(carried);
            }
        };
        for (const entity of entities.entitiesAt(q, r)) add(entity);
        return result;
    }

    /**
     * Wire snapshot as this side may see it: other sides' supply routes and reservations, ship
     * move orders, jump targets, hyperdrive cooldowns, carried ship ids and last combat turns
     * are hidden (charging and the carried ship count stay visible).
     */
    summarize(entity: Entity): EntitySummary {
        const summary = entityToSummary(entity);
        if (summary.kind === "ship") {
            if (summary.carriedShipIds) summary.carriedShipCount = summary.carriedShipIds.length;
            if (summary.sideId === this.id) return summary;
            delete summary.moveOrder;
            delete summary.hyperjump;
            delete summary.hyperdriveCooldown;
            delete summary.carriedShipIds;
            delete summary.lastCombatTurn;
            return summary;
        }
        if (summary.kind === "space_structure") {
            if (summary.sideId !== this.id) delete summary.lastCombatTurn;
            return summary;
        }
        if (summary.kind !== "supply_ship" || summary.sideId === this.id) return summary;
        const redacted = { ...summary, reservedFor: [] };
        delete redacted.route;
        delete redacted.lastCombatTurn;
        return redacted;
    }
}
