/** Distance from hex center to a vertex. Point-to-point height = 2 * size. */
export const DEFAULT_HEX_POINT_TO_POINT = 100;
export const DEFAULT_HEX_SIZE = DEFAULT_HEX_POINT_TO_POINT / 2;

export type Axial = { q: number; r: number };
export type Cube = { x: number; y: number; z: number };
export type Pixel = { x: number; y: number };

/** Pointy-top odd-r offset → axial. */
export function offsetToAxial(col: number, row: number): Axial {
    const q = col - (row - (row & 1)) / 2;
    return { q, r: row };
}

/** Axial → pointy-top odd-r offset. */
export function axialToOffset(q: number, r: number): { col: number; row: number } {
    const col = q + (r - (r & 1)) / 2;
    return { col, row: r };
}

export function axialToCube({ q, r }: Axial): Cube {
    return { x: q, y: -q - r, z: r };
}

export function cubeDistance(a: Cube, b: Cube): number {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z));
}

export function axialDistance(a: Axial, b: Axial): number {
    return cubeDistance(axialToCube(a), axialToCube(b));
}

export function axialKey(q: number, r: number): string {
    return `${q},${r}`;
}

export function parseAxialKey(key: string): Axial {
    const [q, r] = key.split(",").map(Number);
    return { q, r };
}

const SQRT3 = Math.sqrt(3);

/** Pixel center of a pointy-top axial hex. */
export function axialToPixel(q: number, r: number, size: number = DEFAULT_HEX_SIZE): Pixel {
    return {
        x: size * (SQRT3 * q + (SQRT3 / 2) * r),
        y: size * ((3 / 2) * r)
    };
}

/** Six vertices of a pointy-top hex around `center`. */
export function hexCorners(
    center: Pixel,
    size: number = DEFAULT_HEX_SIZE
): [Pixel, Pixel, Pixel, Pixel, Pixel, Pixel] {
    const corners: Pixel[] = [];
    for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 180) * (60 * i - 30);
        corners.push({
            x: center.x + size * Math.cos(angle),
            y: center.y + size * Math.sin(angle)
        });
    }
    return corners as [Pixel, Pixel, Pixel, Pixel, Pixel, Pixel];
}

export function hexWidth(size: number = DEFAULT_HEX_SIZE): number {
    return SQRT3 * size;
}

export function hexHeight(size: number = DEFAULT_HEX_SIZE): number {
    return 2 * size;
}

/** Horizontal / vertical spacing between neighboring hex centers (pointy-top). */
export function hexHorizSpacing(size: number = DEFAULT_HEX_SIZE): number {
    return hexWidth(size);
}

export function hexVertSpacing(size: number = DEFAULT_HEX_SIZE): number {
    return size * 1.5;
}

const AXIAL_DIRECTIONS: Axial[] = [
    { q: 1, r: 0 },
    { q: 1, r: -1 },
    { q: 0, r: -1 },
    { q: -1, r: 0 },
    { q: -1, r: 1 },
    { q: 0, r: 1 }
];

export function axialNeighbor(hex: Axial, directionIndex: number): Axial {
    const d = AXIAL_DIRECTIONS[((directionIndex % 6) + 6) % 6];
    return { q: hex.q + d.q, r: hex.r + d.r };
}

/** Fractional cube coords → nearest hex. */
export function cubeRound(x: number, y: number, z: number): Axial {
    let rx = Math.round(x);
    let ry = Math.round(y);
    let rz = Math.round(z);
    const dx = Math.abs(rx - x);
    const dy = Math.abs(ry - y);
    const dz = Math.abs(rz - z);
    if (dx > dy && dx > dz) {
        rx = -ry - rz;
    } else if (dy > dz) {
        ry = -rx - rz;
    } else {
        rz = -rx - ry;
    }
    return { q: rx + 0, r: rz + 0 };
}

/**
 * Hexes on the straight line from `a` to `b`, both ends included; each step is
 * to a neighbouring hex. A tiny nudge keeps ties on hex edges deterministic.
 */
export function axialLine(a: Axial, b: Axial): Axial[] {
    const n = axialDistance(a, b);
    const ca = axialToCube(a);
    const cb = axialToCube(b);
    const eps = 1e-6;
    const results: Axial[] = [];
    for (let i = 0; i <= n; i++) {
        const t = n === 0 ? 0 : i / n;
        results.push(
            cubeRound(
                ca.x + eps + (cb.x - ca.x) * t,
                ca.y + eps + (cb.y - ca.y) * t,
                ca.z - 2 * eps + (cb.z - ca.z) * t
            )
        );
    }
    return results;
}

/**
 * Screen-space angle (radians, y down, 0 = east) of pointy-top direction index
 * `i` as used by `axialNeighbor`.
 */
export function axialDirectionAngle(directionIndex: number): number {
    return -((((directionIndex % 6) + 6) % 6) * Math.PI) / 3;
}

/** Direction index (0–5) whose angle is closest to the bearing from `from` to `to`. */
export function axialDirectionTowards(from: Axial, to: Axial): number {
    const a = axialToPixel(from.q, from.r, 1);
    const b = axialToPixel(to.q, to.r, 1);
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const index = Math.round(-angle / (Math.PI / 3));
    return ((index % 6) + 6) % 6;
}

/** Signed smallest rotation (radians, in (-π, π]) taking angle `from` to angle `to`. */
export function shortestAngleDelta(from: number, to: number): number {
    const tau = Math.PI * 2;
    let delta = (to - from) % tau;
    if (delta <= -Math.PI) delta += tau;
    if (delta > Math.PI) delta -= tau;
    return delta;
}

/** All axial hexes within `range` of `center` (inclusive). */
export function axialRange(center: Axial, range: number): Axial[] {
    const results: Axial[] = [];
    for (let q = -range; q <= range; q++) {
        for (let r = Math.max(-range, -q - range); r <= Math.min(range, -q + range); r++) {
            results.push({ q: center.q + q, r: center.r + r });
        }
    }
    return results;
}

export type HexPathOptions = {
    /** Hexes outside the map; never entered. */
    inBounds: (hex: Axial) => boolean;
    /** Whether a hex may be passed through. The destination is always enterable. */
    passable: (hex: Axial) => boolean;
    /** Longest path considered, in steps. Defaults to twice the straight distance plus 8. */
    maxSteps?: number;
};

/** Hard cap on A* node expansions so a hopeless search can't stall the caller. */
const MAX_PATH_EXPANSIONS = 20_000;

type PathNode = { hex: Axial; key: string; g: number; h: number; deviation: number; seq: number };

function comparePathNodes(a: PathNode, b: PathNode): number {
    return a.g + a.h - (b.g + b.h) || a.h - b.h || a.deviation - b.deviation || a.seq - b.seq;
}

class PathHeap {
    private readonly _items: PathNode[] = [];

    get size(): number {
        return this._items.length;
    }

    push(node: PathNode) {
        const items = this._items;
        items.push(node);
        let i = items.length - 1;
        while (i > 0) {
            const parent = (i - 1) >> 1;
            if (comparePathNodes(items[i], items[parent]) >= 0) break;
            [items[i], items[parent]] = [items[parent], items[i]];
            i = parent;
        }
    }

    pop(): PathNode | undefined {
        const items = this._items;
        const top = items[0];
        const last = items.pop();
        if (items.length === 0 || !last) return top;
        items[0] = last;
        let i = 0;
        for (;;) {
            const left = i * 2 + 1;
            const right = left + 1;
            let smallest = i;
            if (left < items.length && comparePathNodes(items[left], items[smallest]) < 0) {
                smallest = left;
            }
            if (right < items.length && comparePathNodes(items[right], items[smallest]) < 0) {
                smallest = right;
            }
            if (smallest === i) break;
            [items[i], items[smallest]] = [items[smallest], items[i]];
            i = smallest;
        }
        return top;
    }
}

/**
 * Shortest path `from` → `to` (both included, neighbour steps) through passable,
 * in-bounds hexes; `to` itself may be impassable. Uses the straight `axialLine`
 * when it is clear, otherwise A* preferring hexes near the straight line.
 * Returns null when no path within `maxSteps` exists.
 */
export function findHexPath(from: Axial, to: Axial, options: HexPathOptions): Axial[] | null {
    const { inBounds, passable } = options;
    if (!inBounds(to)) return null;
    const distance = axialDistance(from, to);
    if (distance === 0) return [{ q: from.q, r: from.r }];

    const line = axialLine(from, to);
    const lineClear = line.every(
        (hex, i) => i === 0 || i === line.length - 1 || (inBounds(hex) && passable(hex))
    );
    if (lineClear) return line;

    const maxSteps = options.maxSteps ?? distance * 2 + 8;
    const a = axialToPixel(from.q, from.r, 1);
    const b = axialToPixel(to.q, to.r, 1);
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const deviationOf = (hex: Axial) => {
        const p = axialToPixel(hex.q, hex.r, 1);
        return Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / length;
    };

    const goalKey = axialKey(to.q, to.r);
    const startKey = axialKey(from.q, from.r);
    const cameFrom = new Map<string, Axial>();
    const bestCost = new Map<string, number>([[startKey, 0]]);
    const open = new PathHeap();
    let seq = 0;
    open.push({ hex: from, key: startKey, g: 0, h: distance, deviation: 0, seq: seq++ });

    let expansions = 0;
    while (open.size > 0) {
        const current = open.pop()!;
        if (current.g > (bestCost.get(current.key) ?? Infinity)) continue;
        if (current.key === goalKey) {
            const path: Axial[] = [to];
            let step = cameFrom.get(goalKey);
            while (step) {
                path.push(step);
                step = cameFrom.get(axialKey(step.q, step.r));
            }
            return path.reverse().map((hex) => ({ q: hex.q, r: hex.r }));
        }
        if (++expansions > MAX_PATH_EXPANSIONS) break;

        for (let direction = 0; direction < 6; direction++) {
            const next = axialNeighbor(current.hex, direction);
            const key = axialKey(next.q, next.r);
            if (!inBounds(next)) continue;
            if (key !== goalKey && !passable(next)) continue;
            const g = current.g + 1;
            const h = axialDistance(next, to);
            if (g + h > maxSteps) continue;
            if ((bestCost.get(key) ?? Infinity) <= g) continue;
            bestCost.set(key, g);
            cameFrom.set(key, current.hex);
            open.push({ hex: next, key, g, h, deviation: deviationOf(next), seq: seq++ });
        }
    }
    return null;
}

/** `findHexPath`, falling back to the straight `axialLine` when no clear path exists. */
export function planHexPath(from: Axial, to: Axial, options: HexPathOptions): Axial[] {
    return findHexPath(from, to, options) ?? axialLine(from, to);
}

/**
 * Hexes reachable from `from` within `maxSteps` steps (start excluded). Impassable
 * hexes are included when they can be the final step but are never passed through.
 */
export function hexReachable(
    from: Axial,
    maxSteps: number,
    options: Pick<HexPathOptions, "inBounds" | "passable">
): Axial[] {
    const { inBounds, passable } = options;
    const seen = new Set<string>([axialKey(from.q, from.r)]);
    const reached: Axial[] = [];
    let frontier: Axial[] = [from];
    for (let step = 1; step <= maxSteps && frontier.length > 0; step++) {
        const nextFrontier: Axial[] = [];
        for (const hex of frontier) {
            for (let direction = 0; direction < 6; direction++) {
                const next = axialNeighbor(hex, direction);
                const key = axialKey(next.q, next.r);
                if (seen.has(key) || !inBounds(next)) continue;
                seen.add(key);
                reached.push(next);
                if (passable(next)) nextFrontier.push(next);
            }
        }
        frontier = nextFrontier;
    }
    return reached;
}

/** Deterministic PRNG (mulberry32). */
export function createSeededRng(seed: number): () => number {
    let t = seed >>> 0;
    return () => {
        t += 0x6d2b79f5;
        let r = Math.imul(t ^ (t >>> 15), 1 | t);
        r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
}
