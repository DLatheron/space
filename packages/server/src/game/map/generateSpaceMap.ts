import {
    axialKey,
    axialRange,
    axialToOffset,
    createSeededRng,
    offsetToAxial
} from "@space/maths";
import type { EntityId, SideId } from "@space/shared-data";
import type { MapEntity, MapTile } from "./types.js";

export type SpaceMap = {
    width: number;
    height: number;
    hexSize: number;
    seed: number;
    /** tiles[col][row] */
    tiles: MapTile[][];
    entityIndex: Map<EntityId, { q: number; r: number }>;
};

function emptyTile(col: number, row: number): MapTile {
    const { q, r } = offsetToAxial(col, row);
    return { col, row, q, r, entities: [] };
}

function pickEmpty(
    rng: () => number,
    map: SpaceMap,
    predicate: (tile: MapTile) => boolean = () => true
): MapTile | null {
    for (let attempt = 0; attempt < 400; attempt++) {
        const col = Math.floor(rng() * map.width);
        const row = Math.floor(rng() * map.height);
        const tile = map.tiles[col][row];
        if (tile.entities.length === 0 && predicate(tile)) {
            return tile;
        }
    }
    return null;
}

function addEntity(map: SpaceMap, tile: MapTile, entity: MapEntity) {
    tile.entities.push(entity);
    map.entityIndex.set(entity.id, { q: tile.q, r: tile.r });
}

let nextEntitySeq = 1;
function newEntityId(kind: string): EntityId {
    return `${kind}-${nextEntitySeq++}`;
}

/**
 * Seeded procedural 2D hex map (odd-r axial). Stacked entities per tile.
 */
export function generateSpaceMap(options: {
    width: number;
    height: number;
    hexSize: number;
    seed: number;
    sideIds: SideId[];
}): SpaceMap {
    const { width, height, hexSize, seed, sideIds } = options;
    const rng = createSeededRng(seed);

    const tiles: MapTile[][] = [];
    for (let col = 0; col < width; col++) {
        tiles[col] = [];
        for (let row = 0; row < height; row++) {
            tiles[col][row] = emptyTile(col, row);
        }
    }

    const map: SpaceMap = {
        width,
        height,
        hexSize,
        seed,
        tiles,
        entityIndex: new Map()
    };

    const sunCount = 2 + Math.floor(rng() * 3);
    const sunTiles: MapTile[] = [];
    for (let i = 0; i < sunCount; i++) {
        const tile = pickEmpty(rng, map);
        if (!tile) break;
        addEntity(map, tile, {
            id: newEntityId("sun"),
            kind: "sun",
            name: `Sol-${i + 1}`,
            scale: 0.85 + rng() * 0.3
        });
        sunTiles.push(tile);
    }

    for (const sunTile of sunTiles) {
        const sunEntity = sunTile.entities.find((e) => e.kind === "sun");
        const planetCount = 1 + Math.floor(rng() * 3);
        const ring = axialRange({ q: sunTile.q, r: sunTile.r }, 2 + Math.floor(rng() * 3));
        for (let p = 0; p < planetCount; p++) {
            const candidate = ring[Math.floor(rng() * ring.length)];
            const offsetTile = findTileByAxial(map, candidate.q, candidate.r);
            if (!offsetTile || offsetTile.entities.some((e) => e.kind === "sun")) continue;
            addEntity(map, offsetTile, {
                id: newEntityId("planet"),
                kind: "planet",
                name: `P-${sunEntity?.name ?? "star"}-${p + 1}`,
                scale: 0.45 + rng() * 0.35
            });
        }
    }

    const asteroidCount = 40 + Math.floor(rng() * 40);
    for (let i = 0; i < asteroidCount; i++) {
        const tile = pickEmpty(rng, map);
        if (!tile) break;
        addEntity(map, tile, {
            id: newEntityId("asteroid"),
            kind: "asteroid",
            scale: 0.25 + rng() * 0.35
        });
    }

    for (const sideId of sideIds) {
        const shipCount = 1 + Math.floor(rng() * 2);
        for (let i = 0; i < shipCount; i++) {
            const tile = pickEmpty(rng, map);
            if (!tile) break;
            addEntity(map, tile, {
                id: newEntityId("ship"),
                kind: "ship",
                name: `${sideId}-ship-${i + 1}`,
                sideId,
                scale: 0.55
            });
        }
    }

    return map;
}

export function findTileByAxial(map: SpaceMap, q: number, r: number): MapTile | undefined {
    const { col, row } = axialToOffset(q, r);
    if (col < 0 || row < 0 || col >= map.width || row >= map.height) {
        return undefined;
    }
    const tile = map.tiles[col][row];
    if (tile.q !== q || tile.r !== r) {
        return undefined;
    }
    return tile;
}

export function forEachTile(map: SpaceMap, fn: (tile: MapTile) => void) {
    for (let col = 0; col < map.width; col++) {
        for (let row = 0; row < map.height; row++) {
            fn(map.tiles[col][row]);
        }
    }
}

export function tileKey(tile: Pick<MapTile, "q" | "r">): string {
    return axialKey(tile.q, tile.r);
}
