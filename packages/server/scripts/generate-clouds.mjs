/**
 * Offline generator for seamless parallax cloud textures.
 *
 * Low-res tileable Perlin FBM → bicubic upsample to 2048 for smooth billows.
 *
 * Usage: pnpm --filter @space/server generate:clouds
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "../public/parallax");
const SIZE = 2048;
/** Noise is authored at this resolution, then upsampled (guarantees smoothness). */
const NOISE_SIZE = 256;
const INV_SQRT2 = Math.sqrt(0.5);

function fade(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a, b, t) {
    return a + t * (b - a);
}

const GRAD2 = [
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1]
];

function buildPermutation(seed, period) {
    const perm = new Uint32Array(period);
    for (let i = 0; i < period; i++) perm[i] = i;
    let s = seed >>> 0;
    const rand = () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 0x100000000;
    };
    for (let i = period - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [perm[i], perm[j]] = [perm[j], perm[i]];
    }
    const table = new Uint32Array(period * 2);
    for (let i = 0; i < period * 2; i++) table[i] = perm[i % period];
    return table;
}

function perlin2D(x, y, perm, period) {
    const x0 = ((Math.floor(x) % period) + period) % period;
    const y0 = ((Math.floor(y) % period) + period) % period;
    const x1 = (x0 + 1) % period;
    const y1 = (y0 + 1) % period;

    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = fade(xf);
    const v = fade(yf);

    const g00 = GRAD2[perm[x0 + perm[y0]] & 7];
    const g10 = GRAD2[perm[x1 + perm[y0]] & 7];
    const g01 = GRAD2[perm[x0 + perm[y1]] & 7];
    const g11 = GRAD2[perm[x1 + perm[y1]] & 7];

    const n00 = g00[0] * xf + g00[1] * yf;
    const n10 = g10[0] * (xf - 1) + g10[1] * yf;
    const n01 = g01[0] * xf + g01[1] * (yf - 1);
    const n11 = g11[0] * (xf - 1) + g11[1] * (yf - 1);

    return lerp(lerp(n00, n10, u), lerp(n01, n11, u), v) * INV_SQRT2;
}

function fbmUV(u, v, perm, basePeriod, octaves, persistence) {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let period = basePeriod;
    for (let i = 0; i < octaves; i++) {
        sum += amp * perlin2D(u * period, v * period, perm, period);
        norm += amp;
        amp *= persistence;
        period *= 2;
    }
    return sum / norm;
}

function fbmLattice(x, y, perm, basePeriod, octaves, persistence) {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let freq = 1;
    let period = basePeriod;
    for (let i = 0; i < octaves; i++) {
        sum += amp * perlin2D(x * freq, y * freq, perm, period);
        norm += amp;
        amp *= persistence;
        freq *= 2;
        period *= 2;
    }
    return sum / norm;
}

/** Catmull-Rom / cubic Hermite helper. */
function cubic(a, b, c, d, t) {
    const t2 = t * t;
    const t3 = t2 * t;
    return (
        0.5 *
        (2 * b +
            (-a + c) * t +
            (2 * a - 5 * b + 4 * c - d) * t2 +
            (-a + 3 * b - 3 * c + d) * t3)
    );
}

function sampleBicubic(field, size, x, y) {
    // x,y in [0, size)
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = x - x0;
    const ty = y - y0;

    const at = (ix, iy) => {
        const xx = ((ix % size) + size) % size;
        const yy = ((iy % size) + size) % size;
        return field[yy * size + xx];
    };

    const rows = [];
    for (let j = -1; j <= 2; j++) {
        const c0 = at(x0 - 1, y0 + j);
        const c1 = at(x0, y0 + j);
        const c2 = at(x0 + 1, y0 + j);
        const c3 = at(x0 + 2, y0 + j);
        rows.push(cubic(c0, c1, c2, c3, tx));
    }
    return cubic(rows[0], rows[1], rows[2], rows[3], ty);
}

function crcTable() {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
    }
    return table;
}

const CRC_TABLE = crcTable();

function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
    const typeBuf = Buffer.from(type, "ascii");
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePngRGBA(width, height, rgba) {
    const stride = width * 4;
    const raw = Buffer.alloc((stride + 1) * height);
    for (let y = 0; y < height; y++) {
        const dest = y * (stride + 1);
        raw[dest] = 0;
        rgba.copy(raw, dest + 1, y * stride, y * stride + stride);
    }
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    return Buffer.concat([
        signature,
        chunk("IHDR", ihdr),
        chunk("IDAT", deflateSync(raw, { level: 6 })),
        chunk("IEND", Buffer.alloc(0))
    ]);
}

function writeCloudPng(filename, options) {
    const { seed, basePeriod, octaves, warp, palette, maxAlpha, gamma } = options;

    const maxPeriod = basePeriod * 2 ** (octaves - 1);
    const permSize = Math.max(256, maxPeriod);
    const permWarpX = buildPermutation(seed, permSize);
    const permWarpY = buildPermutation(seed + 91, permSize);
    const permA = buildPermutation(seed + 173, permSize);
    const permB = buildPermutation(seed + 277, permSize);

    // --- 1) Author density at low resolution ---
    const field = new Float32Array(NOISE_SIZE * NOISE_SIZE);
    for (let y = 0; y < NOISE_SIZE; y++) {
        const v = y / NOISE_SIZE;
        for (let x = 0; x < NOISE_SIZE; x++) {
            const u = x / NOISE_SIZE;
            const wx = fbmUV(u, v, permWarpX, basePeriod, 3, 0.5);
            const wy = fbmUV(u, v, permWarpY, basePeriod, 3, 0.5);
            const lx = u * basePeriod + warp * wx;
            const ly = v * basePeriod + warp * wy;
            const n1 = fbmLattice(lx, ly, permA, basePeriod, octaves, 0.5);
            const n2 = fbmLattice(lx + 1.9, ly + 2.4, permB, basePeriod, octaves - 1, 0.45);
            let density = (n1 * 0.7 + n2 * 0.3) * 0.5 + 0.5;
            field[y * NOISE_SIZE + x] = Math.min(1, Math.max(0, density));
        }
    }

    // --- 2) Bicubic upsample to final size ---
    const rgba = Buffer.alloc(SIZE * SIZE * 4);
    const scale = NOISE_SIZE / SIZE;

    for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
            const density = sampleBicubic(field, NOISE_SIZE, x * scale, y * scale);
            const t = Math.pow(Math.min(1, Math.max(0, density)), gamma);

            const idx = (SIZE * y + x) << 2;
            rgba[idx] = Math.round(lerp(palette.a[0], palette.b[0], t));
            rgba[idx + 1] = Math.round(lerp(palette.a[1], palette.b[1], t));
            rgba[idx + 2] = Math.round(lerp(palette.a[2], palette.b[2], t));
            rgba[idx + 3] = Math.round(t * maxAlpha);
        }
    }

    const outPath = join(OUT_DIR, filename);
    writeFileSync(outPath, encodePngRGBA(SIZE, SIZE, rgba));
    console.log("Wrote", outPath);
}

mkdirSync(OUT_DIR, { recursive: true });

writeCloudPng("cloud-far.png", {
    seed: 42,
    basePeriod: 2,
    octaves: 4,
    warp: 0.5,
    gamma: 1.2,
    maxAlpha: 200,
    palette: {
        a: [2, 6, 18],
        b: [120, 175, 255]
    }
});

writeCloudPng("cloud-near.png", {
    seed: 9001,
    basePeriod: 3,
    octaves: 4,
    warp: 0.55,
    gamma: 1.25,
    maxAlpha: 180,
    palette: {
        a: [12, 2, 20],
        b: [230, 120, 255]
    }
});

console.log("Cloud textures ready.");
