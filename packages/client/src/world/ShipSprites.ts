import type { ShipType } from "@space/shared-data";

/** Top-down pictures in `packages/server/public/on-map`, nose pointing up. */
const SHIP_SPRITE_PATHS: Partial<Record<ShipType, string>> = {
    scout: "/public/on-map/scout.png",
    frigate: "/public/on-map/frigate.png",
    star_destroyer: "/public/on-map/star-destroyer.png",
    super_star_destroyer: "/public/on-map/super-star-destroyer.png",
    fighter_squadron: "/public/on-map/tie-fighter.png",
    advanced_fighter_squadron: "/public/on-map/tie-defender.png",
    bomber_squadron: "/public/on-map/tie-bomber.png"
};

/** Below this on-screen hex size ships keep their triangle so they stay legible. */
export const SHIP_SPRITE_MIN_HEX_SIZE = 28;

/** Longest side of the cached, pre-shrunk sprite in pixels. */
const SPRITE_RESOLUTION = 256;

export type ShipSprite = {
    image: CanvasImageSource;
    /** Trimmed width / height. */
    aspect: number;
};

const sprites = new Map<ShipType, ShipSprite | "loading" | "failed">();

/**
 * Share of a row's or column's length that must be opaque for it to count as part of the
 * ship, so stray specks left around a cut-out don't widen the crop.
 */
const TRIM_MIN_SHARE = 0.004;

/** First and last index whose count reaches `min`; the whole range when none does. */
function opaqueSpan(counts: Uint32Array, min: number): [number, number] {
    const first = counts.findIndex((n) => n >= min);
    if (first < 0) return [0, counts.length - 1];
    let last = counts.length - 1;
    while (counts[last]! < min) last--;
    return [first, last];
}

/** Copy of `img` cropped to its opaque pixels and shrunk to `SPRITE_RESOLUTION`. */
function prepare(img: HTMLImageElement): ShipSprite {
    const source = document.createElement("canvas");
    source.width = img.naturalWidth;
    source.height = img.naturalHeight;
    const sctx = source.getContext("2d", { willReadFrequently: true })!;
    sctx.drawImage(img, 0, 0);
    const { data, width, height } = sctx.getImageData(0, 0, source.width, source.height);
    const rows = new Uint32Array(height);
    const cols = new Uint32Array(width);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (data[(y * width + x) * 4 + 3]! < 16) continue;
            rows[y]! += 1;
            cols[x]! += 1;
        }
    }
    const [minY, maxY] = opaqueSpan(rows, Math.max(2, Math.ceil(width * TRIM_MIN_SHARE)));
    const [minX, maxX] = opaqueSpan(cols, Math.max(2, Math.ceil(height * TRIM_MIN_SHARE)));
    const cropW = maxX - minX + 1;
    const cropH = maxY - minY + 1;
    const shrink = Math.min(1, SPRITE_RESOLUTION / Math.max(cropW, cropH));
    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(cropW * shrink));
    out.height = Math.max(1, Math.round(cropH * shrink));
    const octx = out.getContext("2d")!;
    octx.imageSmoothingQuality = "high";
    octx.drawImage(source, minX, minY, cropW, cropH, 0, 0, out.width, out.height);
    return { image: out, aspect: cropW / cropH };
}

/**
 * The map sprite for `shipType`, or undefined while it loads, when it failed, when there is
 * none, or outside a browser. The first call starts loading it.
 */
export function shipSprite(shipType: ShipType): ShipSprite | undefined {
    const cached = sprites.get(shipType);
    if (cached) return typeof cached === "string" ? undefined : cached;
    const path = SHIP_SPRITE_PATHS[shipType];
    if (!path || typeof Image === "undefined" || typeof document === "undefined") return undefined;
    sprites.set(shipType, "loading");
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
        try {
            sprites.set(shipType, prepare(img));
        } catch {
            sprites.set(shipType, "failed");
        }
    };
    img.onerror = () => sprites.set(shipType, "failed");
    img.src = path;
    return undefined;
}
