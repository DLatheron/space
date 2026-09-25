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
