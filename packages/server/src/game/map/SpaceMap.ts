import { axialKey, axialToOffset, offsetToAxial } from "@space/maths";
import type { HexKey } from "@space/shared-data";
import type { MapTile } from "./types.js";

export type SpaceMap = {
    width: number;
    height: number;
    hexSize: number;
    seed: number;
    /** tiles[col][row] */
    tiles: MapTile[][];
};

export function createEmptyMap(options: {
    width: number;
    height: number;
    hexSize: number;
    seed: number;
}): SpaceMap {
    const { width, height, hexSize, seed } = options;
    const tiles: MapTile[][] = [];
    for (let col = 0; col < width; col++) {
        tiles[col] = [];
        for (let row = 0; row < height; row++) {
            const { q, r } = offsetToAxial(col, row);
            tiles[col][row] = { col, row, q, r, entityIds: [] };
        }
    }
    return { width, height, hexSize, seed, tiles };
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

export function tileKey(tile: Pick<MapTile, "q" | "r">): HexKey {
    return axialKey(tile.q, tile.r);
}
