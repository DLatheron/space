import type { Pixel } from "@space/maths";

/** Time a weapon beam takes to fire and fade. */
export const BEAM_MS = 420;
const LABEL_MS = 1500;

type Beam = {
    from: Pixel;
    to: Pixel;
    startAt: number;
    colour: string;
    /** Hex size in world pixels. */
    scale: number;
};

type Label = {
    at: Pixel;
    text: string;
    colour: string;
    startAt: number;
    scale: number;
};

/**
 * World-space combat effects: weapon beams between combatants and floating damage /
 * "Evaded" labels. Like explosions, each may be scheduled to start in the future.
 */
export class CombatEffects {
    private _beams: Beam[] = [];
    private _labels: Label[] = [];

    beam(beam: Beam) {
        this._beams.push(beam);
    }

    label(label: Label) {
        this._labels.push(label);
    }

    clear() {
        this._beams = [];
        this._labels = [];
    }

    render(
        ctx: CanvasRenderingContext2D,
        now: number,
        toScreen: (world: Pixel) => Pixel,
        zoom: number
    ) {
        this._beams = this._beams.filter((b) => now - b.startAt < BEAM_MS);
        this._labels = this._labels.filter((l) => now - l.startAt < LABEL_MS);
        if (!this._beams.length && !this._labels.length) return;

        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.lineCap = "round";
        for (const beam of this._beams) {
            if (now < beam.startAt) continue;
            this._drawBeam(ctx, beam, (now - beam.startAt) / BEAM_MS, toScreen, zoom);
        }
        ctx.globalCompositeOperation = "source-over";
        for (const label of this._labels) {
            if (now < label.startAt) continue;
            this._drawLabel(ctx, label, (now - label.startAt) / LABEL_MS, toScreen, zoom);
        }
        ctx.restore();
    }

    /** Bolt that streaks from shooter to target, leaving a fading trail. */
    private _drawBeam(
        ctx: CanvasRenderingContext2D,
        beam: Beam,
        t: number,
        toScreen: (world: Pixel) => Pixel,
        zoom: number
    ) {
        const from = toScreen(beam.from);
        const to = toScreen(beam.to);
        const head = Math.min(1, t * 2.2);
        const tail = Math.max(0, t * 2.2 - 0.6);
        const lerp = (k: number) => ({
            x: from.x + (to.x - from.x) * k,
            y: from.y + (to.y - from.y) * k
        });
        const a = lerp(tail);
        const b = lerp(head);
        const width = Math.max(1, beam.scale * zoom * 0.06);
        ctx.globalAlpha = 1 - t * 0.6;
        ctx.strokeStyle = beam.colour;
        ctx.lineWidth = width * 2.2;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = width * 0.8;
        ctx.stroke();
        if (head >= 1) {
            const k = 1 - t;
            const radius = beam.scale * zoom * 0.22 * k + 1;
            const g = ctx.createRadialGradient(to.x, to.y, 0, to.x, to.y, radius);
            g.addColorStop(0, `rgba(255, 255, 255, ${k})`);
            g.addColorStop(1, "rgba(255, 200, 120, 0)");
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(to.x, to.y, radius, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    private _drawLabel(
        ctx: CanvasRenderingContext2D,
        label: Label,
        t: number,
        toScreen: (world: Pixel) => Pixel,
        zoom: number
    ) {
        const scale = label.scale * zoom;
        if (scale < 16) return;
        const at = toScreen(label.at);
        const fontSize = Math.round(Math.min(18, Math.max(11, scale * 0.26)));
        const y = at.y - scale * (0.55 + 0.45 * t);
        ctx.globalAlpha = t < 0.7 ? 1 : (1 - t) / 0.3;
        ctx.font = `700 ${fontSize}px "IBM Plex Sans", "Segoe UI", sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.lineWidth = Math.max(2, fontSize * 0.25);
        ctx.strokeStyle = "rgba(4, 8, 18, 0.85)";
        ctx.fillStyle = label.colour;
        ctx.strokeText(label.text, at.x, y);
        ctx.fillText(label.text, at.x, y);
    }
}
