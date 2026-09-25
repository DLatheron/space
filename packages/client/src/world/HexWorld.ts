import {
    axialToPixel,
    hexCorners,
    hexHorizSpacing,
    hexVertSpacing,
    type Pixel
} from "@space/maths";
import type { EntitySummary, HexKey, TileView } from "@space/shared-data";

export type Camera = {
    x: number;
    y: number;
    zoom: number;
};

type ClientTile = {
    q: number;
    r: number;
    fog: "explored" | "visible";
    entities: EntitySummary[];
};

type DrawCtx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * Client-side hex map FOW over parallax.
 * Unexplored = parallax only; explored/visible hexes drawn translucent on top.
 */
export class HexWorld {
    width = 0;
    height = 0;
    hexSize = 50;
    sideId: string | null = null;

    private readonly _tiles = new Map<HexKey, ClientTile>();
    private readonly _visible = new Set<HexKey>();

    camera: Camera = { x: 0, y: 0, zoom: 0.35 };

    get ready(): boolean {
        return this.width > 0 && this.height > 0;
    }

    applyMapInit(payload: {
        width: number;
        height: number;
        hexSize: number;
        sideId: string;
        tiles: TileView[];
        visible: HexKey[];
    }) {
        this.width = payload.width;
        this.height = payload.height;
        this.hexSize = payload.hexSize;
        this.sideId = payload.sideId;
        this._tiles.clear();
        this._visible.clear();

        for (const key of payload.visible) {
            this._visible.add(key);
        }
        for (const tile of payload.tiles) {
            this._tiles.set(`${tile.q},${tile.r}`, {
                q: tile.q,
                r: tile.r,
                fog: tile.fog,
                entities: tile.entities
            });
        }

        this._centerCameraOnContent();
    }

    applyTilesUpdate(payload: {
        tiles: TileView[];
        visible: HexKey[];
        forgetEntityIds?: string[];
    }) {
        this._visible.clear();
        for (const key of payload.visible) {
            this._visible.add(key);
        }

        if (payload.forgetEntityIds?.length) {
            const forget = new Set(payload.forgetEntityIds);
            for (const tile of this._tiles.values()) {
                tile.entities = tile.entities.filter((e) => !forget.has(e.id));
            }
        }

        for (const tile of payload.tiles) {
            const key = `${tile.q},${tile.r}` as HexKey;
            this._tiles.set(key, {
                q: tile.q,
                r: tile.r,
                fog: tile.fog,
                entities: tile.entities
            });
        }

        for (const [key, tile] of this._tiles) {
            tile.fog = this._visible.has(key) ? "visible" : "explored";
        }
    }

    private _centerCameraOnContent() {
        // Prefer centering on a visible ship of our side, else map center.
        for (const tile of this._tiles.values()) {
            if (tile.fog !== "visible") continue;
            const ship = tile.entities.find(
                (e) => e.kind === "ship" && e.sideId === this.sideId
            );
            if (ship) {
                const p = axialToPixel(tile.q, tile.r, this.hexSize);
                this.camera.x = p.x;
                this.camera.y = p.y;
                return;
            }
        }

        const midCol = Math.floor(this.width / 2);
        const midRow = Math.floor(this.height / 2);
        this.camera.x = midCol * hexHorizSpacing(this.hexSize);
        this.camera.y = midRow * hexVertSpacing(this.hexSize);
    }

    worldToScreen(world: Pixel, canvas: HTMLCanvasElement): Pixel {
        return {
            x: (world.x - this.camera.x) * this.camera.zoom + canvas.width / 2,
            y: (world.y - this.camera.y) * this.camera.zoom + canvas.height / 2
        };
    }

    screenToWorld(screen: Pixel, canvas: HTMLCanvasElement): Pixel {
        return {
            x: (screen.x - canvas.width / 2) / this.camera.zoom + this.camera.x,
            y: (screen.y - canvas.height / 2) / this.camera.zoom + this.camera.y
        };
    }

    panByScreenDelta(dx: number, dy: number) {
        this.camera.x -= dx / this.camera.zoom;
        this.camera.y -= dy / this.camera.zoom;
    }

    zoomAt(factor: number, screen: Pixel, canvas: HTMLCanvasElement) {
        const before = this.screenToWorld(screen, canvas);
        this.camera.zoom = Math.min(2.5, Math.max(0.12, this.camera.zoom * factor));
        const after = this.screenToWorld(screen, canvas);
        this.camera.x += before.x - after.x;
        this.camera.y += before.y - after.y;
    }

    render(
        canvas: HTMLCanvasElement,
        context: CanvasRenderingContext2D,
        _offscreenCanvases: OffscreenCanvas[],
        _offscreenContexts: OffscreenCanvasRenderingContext2D[]
    ) {
        context.setTransform(1, 0, 0, 1, 0, 0);
        // Parallax is already on `context`. Draw translucent FOW hexes directly
        // so stars/clouds show through (offscreen stencil was forcing opaque coverage).

        if (!this.ready) return;

        // Explored-but-not-visible first (more faded)
        for (const tile of this._tiles.values()) {
            const key = `${tile.q},${tile.r}` as HexKey;
            if (this._visible.has(key)) continue;
            this._drawTileContents(context, canvas, tile, /*fullColour*/ false);
        }

        // Visible on top
        for (const tile of this._tiles.values()) {
            const key = `${tile.q},${tile.r}` as HexKey;
            if (!this._visible.has(key)) continue;
            this._drawTileContents(context, canvas, tile, /*fullColour*/ true);
        }
    }

    private _drawTileContents(
        ctx: DrawCtx,
        canvas: HTMLCanvasElement,
        tile: ClientTile,
        fullColour: boolean
    ) {
        const center = this.worldToScreen(axialToPixel(tile.q, tile.r, this.hexSize), canvas);
        const size = this.hexSize * this.camera.zoom;

        const corners = hexCorners(center, size);
        ctx.beginPath();
        ctx.moveTo(corners[0].x, corners[0].y);
        for (let i = 1; i < 6; i++) {
            ctx.lineTo(corners[i].x, corners[i].y);
        }
        ctx.closePath();
        // Keep fills clearly translucent so parallax reads through the cell.
        ctx.fillStyle = fullColour ? "rgba(20, 40, 80, 0.28)" : "rgba(12, 22, 44, 0.18)";
        ctx.fill();
        ctx.strokeStyle = fullColour ? "rgba(120, 160, 220, 0.4)" : "rgba(70, 100, 150, 0.22)";
        ctx.lineWidth = Math.max(0.5, 1 * this.camera.zoom);
        ctx.stroke();

        for (const entity of tile.entities) {
            drawEntityPlaceholder(ctx, center, size, entity, fullColour);
        }
    }
}

function drawEntityPlaceholder(
    ctx: DrawCtx,
    center: Pixel,
    hexSize: number,
    entity: EntitySummary,
    fullColour: boolean
) {
    const scale = (entity.scale ?? 0.5) * hexSize;
    const alpha = fullColour ? 1 : 0.55;
    ctx.save();
    ctx.globalAlpha = alpha;

    switch (entity.kind) {
        case "sun": {
            const g = ctx.createRadialGradient(
                center.x,
                center.y,
                scale * 0.1,
                center.x,
                center.y,
                scale
            );
            g.addColorStop(0, "#fff6c8");
            g.addColorStop(0.45, "#ffb020");
            g.addColorStop(1, "#ff6a00");
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(center.x, center.y, scale, 0, Math.PI * 2);
            ctx.fill();
            break;
        }
        case "planet": {
            ctx.fillStyle = fullColour ? "#4a8fd4" : "#3a6fa8";
            ctx.beginPath();
            ctx.arc(center.x, center.y, scale, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = "#9fd0ff";
            ctx.lineWidth = Math.max(1, hexSize * 0.04);
            ctx.beginPath();
            ctx.ellipse(
                center.x,
                center.y,
                scale * 1.35,
                scale * 0.35,
                -0.4,
                0,
                Math.PI * 2
            );
            ctx.stroke();
            break;
        }
        case "asteroid": {
            ctx.fillStyle = fullColour ? "#8a7f72" : "#5c554c";
            ctx.beginPath();
            const bumps = 5;
            for (let i = 0; i < bumps; i++) {
                const a = (i / bumps) * Math.PI * 2;
                const r = scale * (0.7 + ((i * 37) % 10) / 30);
                const x = center.x + Math.cos(a) * r;
                const y = center.y + Math.sin(a) * r;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.closePath();
            ctx.fill();
            break;
        }
        case "ship": {
            ctx.fillStyle = entity.sideId
                ? entity.sideId === "alpha"
                    ? "#5cffb0"
                    : "#ff6b8a"
                : "#d0d0d0";
            ctx.beginPath();
            ctx.moveTo(center.x, center.y - scale);
            ctx.lineTo(center.x + scale * 0.7, center.y + scale * 0.7);
            ctx.lineTo(center.x, center.y + scale * 0.25);
            ctx.lineTo(center.x - scale * 0.7, center.y + scale * 0.7);
            ctx.closePath();
            ctx.fill();
            ctx.strokeStyle = "#ffffffaa";
            ctx.lineWidth = Math.max(1, hexSize * 0.03);
            ctx.stroke();
            break;
        }
    }

    ctx.restore();
}
