import { axialKey, axialRange } from "@space/maths";
import type { ClientId, EntitySummary, HexKey, SideId, TileView } from "@space/shared-data";
import { findTileByAxial, forEachTile, type SpaceMap } from "./map/generateSpaceMap.js";
import { entityToSummary } from "./map/types.js";

export class Side {
    readonly id: SideId;
    private readonly _clientIds = new Set<ClientId>();
    private readonly _explored = new Set<HexKey>();
    private readonly _visible = new Set<HexKey>();
    /** Last-known entities per hex (explored memory). */
    private readonly _memory = new Map<HexKey, EntitySummary[]>();

    constructor(id: SideId) {
        this.id = id;
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
     * Recompute visibility from this side's ships. Updates explored + memory.
     * Returns whether the visible set changed.
     */
    recomputeVisibility(map: SpaceMap, visionRange: number): boolean {
        const nextVisible = new Set<HexKey>();

        forEachTile(map, (tile) => {
            for (const entity of tile.entities) {
                if (entity.kind !== "ship" || entity.sideId !== this.id) continue;
                for (const hex of axialRange({ q: tile.q, r: tile.r }, visionRange)) {
                    const target = findTileByAxial(map, hex.q, hex.r);
                    if (!target) continue;
                    nextVisible.add(axialKey(hex.q, hex.r));
                }
            }
        });

        let changed = nextVisible.size !== this._visible.size;
        if (!changed) {
            for (const key of nextVisible) {
                if (!this._visible.has(key)) {
                    changed = true;
                    break;
                }
            }
        }

        this._visible.clear();
        for (const key of nextVisible) {
            this._visible.add(key);
            this._explored.add(key);
            const [q, r] = key.split(",").map(Number);
            const tile = findTileByAxial(map, q, r);
            if (tile) {
                this._memory.set(key, tile.entities.map(entityToSummary));
            }
        }

        return changed;
    }

    /**
     * If an entity was observed at another location, scrub it from memory of other tiles.
     */
    forgetEntityEverywhereExcept(entityId: string, keepKey: HexKey | null) {
        for (const [key, entities] of this._memory) {
            if (key === keepKey) continue;
            const filtered = entities.filter((e) => e.id !== entityId);
            if (filtered.length !== entities.length) {
                this._memory.set(key, filtered);
            }
        }
    }

    buildTileViews(map: SpaceMap): TileView[] {
        const views: TileView[] = [];
        for (const key of this._explored) {
            const [q, r] = key.split(",").map(Number);
            const visible = this._visible.has(key);
            if (visible) {
                const tile = findTileByAxial(map, q, r);
                views.push({
                    q,
                    r,
                    fog: "visible",
                    entities: tile ? tile.entities.map(entityToSummary) : []
                });
            } else {
                views.push({
                    q,
                    r,
                    fog: "explored",
                    entities: this._memory.get(key) ?? []
                });
            }
        }
        return views;
    }

    visibleKeys(): HexKey[] {
        return Array.from(this._visible);
    }
}
