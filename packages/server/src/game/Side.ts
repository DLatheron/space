import { axialKey, axialRange, parseAxialKey } from "@space/maths";
import type {
    ClientId,
    EntityId,
    EntitySummary,
    HexKey,
    SideId,
    TileView
} from "@space/shared-data";
import type { EntityManager } from "./EntityManager.js";
import { findTileByAxial, forEachTile, tileKey } from "./map/SpaceMap.js";
import { entityToSummary } from "./map/types.js";

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
                this._memory.set(key, entities.entitiesAt(tile.q, tile.r).map(entityToSummary));
            }
        });
    }

    /**
     * Recompute visibility from this side's ships, refresh memory of visible
     * hexes and scrub stale sightings of entities whose position is now known.
     */
    recomputeVisibility(entities: EntityManager, visionRange: number): VisibilityDiff {
        const { map } = entities;
        const nextVisible = new Set<HexKey>();
        const ownShips = entities.ofKind("ship").filter((ship) => ship.sideId === this.id);

        if (this.fullVisibility) {
            forEachTile(map, (tile) => nextVisible.add(tileKey(tile)));
        } else {
            for (const ship of ownShips) {
                for (const hex of axialRange(ship, visionRange)) {
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
            const summaries = entities.entitiesAt(q, r).map(entityToSummary);
            this._memory.set(key, summaries);
            for (const summary of summaries) knownPositions.set(summary.id, key);
        }
        for (const ship of ownShips) {
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

    /** Current view of an explored hex, or null if unexplored. */
    buildTileView(entities: EntityManager, key: HexKey): TileView | null {
        if (!this._explored.has(key)) return null;
        const { q, r } = parseAxialKey(key);
        if (this._visible.has(key)) {
            return {
                q,
                r,
                fog: "visible",
                entities: entities.entitiesAt(q, r).map(entityToSummary)
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

    visibleKeys(): HexKey[] {
        return Array.from(this._visible);
    }
}
