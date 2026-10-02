type Star = {
    x: number;
    y: number;
    radius: number;
    brightness: number;
};

type StarLayer = {
    stars: Star[];
    /** 0 = screen-locked, 1 = full pan/zoom follow. */
    panFactor: number;
    tileSize: number;
};

type CloudLayer = {
    image: HTMLImageElement | null;
    panFactor: number;
    worldSize: number;
    opacity: number;
};

function mulberry32(seed: number) {
    let t = seed >>> 0;
    return () => {
        t += 0x6d2b79f5;
        let r = Math.imul(t ^ (t >>> 15), 1 | t);
        r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
}

function makeStars(seed: number, count: number, tileSize: number, maxRadius: number): Star[] {
    const rng = mulberry32(seed);
    const stars: Star[] = [];
    for (let i = 0; i < count; i++) {
        stars.push({
            x: rng() * tileSize,
            y: rng() * tileSize,
            radius: 0.4 + rng() * maxRadius,
            brightness: 0.25 + rng() * 0.75
        });
    }
    return stars;
}

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`Failed to load ${src}`));
        img.src = src;
    });
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

/**
 * Six-layer parallax under the hex FOW (2 cloud + 4 star).
 *
 * Screen-space pan + zoom-around-cursor (not map camera.x/y), so the hex
 * zoom-to-point camera rewrite does not fling the starfield — but zoom still
 * scales stars/clouds around the pointer.
 */
export class ParallaxBackground {
    private _ready = false;

    /**
     * Screen position of the panFactor=1 layer origin.
     * Initialized on first render to the canvas centre.
     */
    private _originX: number | null = null;
    private _originY: number | null = null;
    private _scale = 1;

    private readonly _clouds: CloudLayer[] = [
        {
            image: null,
            panFactor: 0.04,
            worldSize: 4200,
            opacity: 0.8
        },
        {
            image: null,
            panFactor: 0.1,
            worldSize: 2800,
            opacity: 0.7
        }
    ];
    /** Far → near: denser/dimmer → sparser/brighter, increasing pan. */
    private readonly _stars: StarLayer[] = [
        {
            stars: makeStars(7, 1400, 3200, 0.7),
            panFactor: 0.08,
            tileSize: 3200
        },
        {
            stars: makeStars(11, 900, 2400, 1.1),
            panFactor: 0.16,
            tileSize: 2400
        },
        {
            stars: makeStars(29, 500, 1600, 1.8),
            panFactor: 0.28,
            tileSize: 1600
        },
        {
            stars: makeStars(47, 220, 1100, 2.4),
            panFactor: 0.42,
            tileSize: 1100
        }
    ];

    async load(): Promise<void> {
        try {
            const [far, near] = await Promise.all([
                loadImage("/public/parallax/cloud-far.png"),
                loadImage("/public/parallax/cloud-near.png")
            ]);
            this._clouds[0].image = far;
            this._clouds[1].image = near;
            this._ready = true;
        } catch (error) {
            console.error(
                "Parallax cloud textures missing — run: pnpm --filter @space/server generate:clouds",
                error
            );
            this._ready = false;
        }
    }

    get ready(): boolean {
        return this._ready;
    }

    panByScreenDelta(dx: number, dy: number) {
        if (this._originX === null || this._originY === null) return;
        this._originX += dx;
        this._originY += dy;
    }

    /**
     * Zoom around a screen point. Soften the factor vs the hex map, but still
     * scale the field so zoom is visible — origin is rewritten so the focus
     * pixel stays put (no dramatic sideways slide).
     */
    zoomAt(factor: number, screenX: number, screenY: number) {
        if (this._originX === null || this._originY === null) return;

        // Softer than the hex map step; hex wheel is ±5% per tick.
        const softFactor = 1 + (factor - 1) * 0.55;
        const newScale = clamp(this._scale * softFactor, 0.45, 2.8);
        const ratio = newScale / this._scale;

        this._originX = screenX + (this._originX - screenX) * ratio;
        this._originY = screenY + (this._originY - screenY) * ratio;
        this._scale = newScale;
    }

    render(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
        if (this._originX === null || this._originY === null) {
            this._originX = canvas.width / 2;
            this._originY = canvas.height / 2;
        }

        ctx.fillStyle = "#03060f";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        for (const cloud of this._clouds) {
            if (cloud.image) {
                this._drawCloudLayer(ctx, canvas, cloud);
            }
        }

        for (const stars of this._stars) {
            this._drawStarLayer(ctx, canvas, stars);
        }
    }

    private _layerOrigin(
        canvas: HTMLCanvasElement,
        panFactor: number
    ): { x: number; y: number } {
        const cx = canvas.width / 2;
        const cy = canvas.height / 2;
        // Depth: far layers stay closer to screen centre; near layers follow origin more.
        return {
            x: cx + ((this._originX ?? cx) - cx) * panFactor,
            y: cy + ((this._originY ?? cy) - cy) * panFactor
        };
    }

    private _drawCloudLayer(
        ctx: CanvasRenderingContext2D,
        canvas: HTMLCanvasElement,
        layer: CloudLayer
    ) {
        const img = layer.image!;
        const scale = this._scale;
        const tileW = layer.worldSize * scale;
        const tileH = layer.worldSize * scale;

        const origin = this._layerOrigin(canvas, layer.panFactor);
        const baseX = origin.x - tileW / 2;
        const baseY = origin.y - tileH / 2;
        const startX = baseX - Math.ceil(baseX / tileW) * tileW - tileW;
        const startY = baseY - Math.ceil(baseY / tileH) * tileH - tileH;

        ctx.save();
        ctx.globalAlpha = layer.opacity;
        for (let y = startY; y < canvas.height + tileH; y += tileH) {
            for (let x = startX; x < canvas.width + tileW; x += tileW) {
                ctx.drawImage(img, x, y, tileW, tileH);
            }
        }
        ctx.restore();
    }

    private _drawStarLayer(
        ctx: CanvasRenderingContext2D,
        canvas: HTMLCanvasElement,
        layer: StarLayer
    ) {
        const scale = this._scale;
        const tile = layer.tileSize * scale;
        const origin = this._layerOrigin(canvas, layer.panFactor);

        const startCol = Math.floor(-origin.x / tile) - 1;
        const endCol = Math.ceil((canvas.width - origin.x) / tile) + 1;
        const startRow = Math.floor(-origin.y / tile) - 1;
        const endRow = Math.ceil((canvas.height - origin.y) / tile) + 1;

        ctx.save();
        for (let row = startRow; row <= endRow; row++) {
            for (let col = startCol; col <= endCol; col++) {
                const ox = origin.x + col * tile;
                const oy = origin.y + row * tile;
                for (const star of layer.stars) {
                    const x = ox + star.x * scale;
                    const y = oy + star.y * scale;
                    if (x < -2 || y < -2 || x > canvas.width + 2 || y > canvas.height + 2) {
                        continue;
                    }
                    const r = Math.max(0.35, star.radius * scale);
                    ctx.fillStyle = `rgba(230, 235, 255, ${star.brightness})`;
                    ctx.beginPath();
                    ctx.arc(x, y, r, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        }
        ctx.restore();
    }
}
