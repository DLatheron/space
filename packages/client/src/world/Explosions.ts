import type { Pixel } from "@space/maths";

type Particle = {
    x: number;
    y: number;
    vx: number;
    vy: number;
    /** Radius in world pixels. */
    size: number;
    colour: string;
    lifeMs: number;
};

type Explosion = {
    x: number;
    y: number;
    startAt: number;
    colour: string;
    /** Hex size in world pixels, used to scale radii and speeds. */
    scale: number;
    particles: Particle[];
    /** Time particles were last integrated. */
    lastAt: number;
};

const DURATION_MS = 1400;
const RING_MS = 700;
const FLASH_MS = 220;
/** Fraction of velocity kept per second. */
const DAMPING_PER_SECOND = 0.08;
const HOT_COLOURS = ["#ffffff", "#fff3b0", "#ffd166"];

function spawnParticles(colour: string, scale: number): Particle[] {
    const particles: Particle[] = [];
    const add = (count: number, colours: string[], speed: number, life: number, size: number) => {
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const v = speed * scale * (0.3 + Math.random() * 0.9);
            particles.push({
                x: 0,
                y: 0,
                vx: Math.cos(angle) * v,
                vy: Math.sin(angle) * v,
                size: size * scale * (0.5 + Math.random()),
                colour: colours[i % colours.length],
                lifeMs: life * (0.6 + Math.random() * 0.4)
            });
        }
    };
    add(70, [colour], 2.6, DURATION_MS, 0.06);
    add(30, HOT_COLOURS, 1.6, DURATION_MS * 0.55, 0.05);
    return particles;
}

/**
 * World-space particle explosions, drawn on top of the map each frame so they
 * pan and zoom with it. An explosion may be scheduled to start in the future.
 */
export class Explosions {
    private _explosions: Explosion[] = [];

    spawn(at: Pixel, colour: string, scale: number, startAt = performance.now()) {
        this._explosions.push({
            x: at.x,
            y: at.y,
            startAt,
            colour,
            scale,
            particles: spawnParticles(colour, scale),
            lastAt: startAt
        });
    }

    clear() {
        this._explosions = [];
    }

    render(
        ctx: CanvasRenderingContext2D,
        now: number,
        toScreen: (world: Pixel) => Pixel,
        zoom: number
    ) {
        this._explosions = this._explosions.filter((e) => now - e.startAt < DURATION_MS);
        if (!this._explosions.length) return;

        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        for (const explosion of this._explosions) {
            if (now < explosion.startAt) continue;
            this._step(explosion, now);
            this._draw(ctx, explosion, now - explosion.startAt, toScreen, zoom);
        }
        ctx.restore();
    }

    private _step(explosion: Explosion, now: number) {
        const dt = Math.min(0.05, (now - explosion.lastAt) / 1000);
        explosion.lastAt = now;
        const keep = Math.pow(DAMPING_PER_SECOND, dt);
        for (const p of explosion.particles) {
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.vx *= keep;
            p.vy *= keep;
        }
    }

    private _draw(
        ctx: CanvasRenderingContext2D,
        explosion: Explosion,
        age: number,
        toScreen: (world: Pixel) => Pixel,
        zoom: number
    ) {
        const center = toScreen(explosion);
        const scale = explosion.scale * zoom;

        if (age < FLASH_MS) {
            const k = 1 - age / FLASH_MS;
            const radius = scale * (0.4 + 0.6 * (1 - k));
            const g = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, radius);
            g.addColorStop(0, `rgba(255, 255, 255, ${k})`);
            g.addColorStop(0.4, `rgba(255, 220, 140, ${0.7 * k})`);
            g.addColorStop(1, "rgba(255, 160, 60, 0)");
            ctx.globalAlpha = 1;
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
            ctx.fill();
        }

        if (age < RING_MS) {
            const t = age / RING_MS;
            ctx.globalAlpha = (1 - t) * 0.8;
            ctx.strokeStyle = explosion.colour;
            ctx.lineWidth = Math.max(1, scale * 0.08 * (1 - t));
            ctx.beginPath();
            ctx.arc(center.x, center.y, scale * (0.2 + 1.6 * Math.sqrt(t)), 0, Math.PI * 2);
            ctx.stroke();
        }

        for (const p of explosion.particles) {
            if (age >= p.lifeMs) continue;
            const life = 1 - age / p.lifeMs;
            ctx.globalAlpha = life;
            ctx.fillStyle = p.colour;
            ctx.beginPath();
            ctx.arc(
                center.x + p.x * zoom,
                center.y + p.y * zoom,
                Math.max(0.5, p.size * zoom * (0.4 + 0.6 * life)),
                0,
                Math.PI * 2
            );
            ctx.fill();
        }
    }
}

/** Time a jumping ship spends collapsing into hyperspace at its origin. */
export const JUMP_DEPART_MS = 700;
/** Arrival flash length; the ship scales in over its first part. */
export const JUMP_ARRIVE_MS = 650;
const JUMP_DAMAGE_MS = 1600;
const JUMP_STREAKS = 14;
const JUMP_COLOUR = "127, 232, 255";

type JumpFlash = {
    from: Pixel | null;
    to: Pixel;
    departAt: number;
    arriveAt: number;
    damaged: boolean;
    /** Hex size in world pixels. */
    scale: number;
    /** Angles of the inward streaks at the origin. */
    streaks: number[];
};

/**
 * Hyperspace jump effects in world space: an implosion with inward streaks at the origin,
 * then a flash and shockwave at the landing hex, plus a red flicker when the ship was damaged.
 */
export class JumpFlashes {
    private _flashes: JumpFlash[] = [];

    spawn(flash: Omit<JumpFlash, "streaks">) {
        const streaks = Array.from({ length: JUMP_STREAKS }, () => Math.random() * Math.PI * 2);
        this._flashes.push({ ...flash, streaks });
    }

    clear() {
        this._flashes = [];
    }

    render(
        ctx: CanvasRenderingContext2D,
        now: number,
        toScreen: (world: Pixel) => Pixel,
        zoom: number
    ) {
        this._flashes = this._flashes.filter(
            (f) => now - f.arriveAt < Math.max(JUMP_ARRIVE_MS, f.damaged ? JUMP_DAMAGE_MS : 0)
        );
        if (!this._flashes.length) return;

        ctx.save();
        for (const flash of this._flashes) {
            if (now < flash.departAt) continue;
            const scale = flash.scale * zoom;
            ctx.globalCompositeOperation = "lighter";
            if (flash.from && now < flash.arriveAt + 160) {
                this._drawImplosion(ctx, flash, toScreen(flash.from), scale, now);
            }
            if (now >= flash.arriveAt) {
                this._drawArrival(ctx, toScreen(flash.to), scale, now - flash.arriveAt);
                ctx.globalCompositeOperation = "source-over";
                if (flash.damaged) {
                    this._drawDamage(ctx, toScreen(flash.to), scale, now - flash.arriveAt);
                }
            }
        }
        ctx.restore();
    }

    private _drawImplosion(
        ctx: CanvasRenderingContext2D,
        flash: JumpFlash,
        center: Pixel,
        scale: number,
        now: number
    ) {
        const span = flash.arriveAt - flash.departAt;
        const t = Math.min(1, (now - flash.departAt) / span);
        if (t < 1) {
            const radius = scale * (1.3 * (1 - t) + 0.05);
            ctx.globalAlpha = 0.35 + 0.6 * t;
            ctx.strokeStyle = `rgb(${JUMP_COLOUR})`;
            ctx.lineWidth = Math.max(1, scale * 0.06);
            ctx.beginPath();
            ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
            ctx.stroke();

            ctx.lineWidth = Math.max(0.75, scale * 0.025);
            for (const angle of flash.streaks) {
                const outer = scale * (0.4 + 1.1 * (1 - t));
                const inner = outer * 0.45;
                ctx.beginPath();
                ctx.moveTo(center.x + Math.cos(angle) * outer, center.y + Math.sin(angle) * outer);
                ctx.lineTo(center.x + Math.cos(angle) * inner, center.y + Math.sin(angle) * inner);
                ctx.stroke();
            }
        }
        // Brief white pinch as the ship vanishes.
        const pinch = (now - flash.arriveAt + 160) / 320;
        if (pinch > 0 && pinch < 1) {
            const k = 1 - Math.abs(pinch * 2 - 1);
            const radius = scale * 0.45 * k + 1;
            const g = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, radius);
            g.addColorStop(0, `rgba(255, 255, 255, ${k})`);
            g.addColorStop(1, `rgba(${JUMP_COLOUR}, 0)`);
            ctx.globalAlpha = 1;
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    private _drawArrival(ctx: CanvasRenderingContext2D, center: Pixel, scale: number, age: number) {
        if (age >= JUMP_ARRIVE_MS) return;
        const t = age / JUMP_ARRIVE_MS;
        const k = 1 - t;
        const radius = scale * (0.3 + 0.9 * Math.sqrt(t));
        const g = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, radius);
        g.addColorStop(0, `rgba(255, 255, 255, ${k})`);
        g.addColorStop(0.35, `rgba(${JUMP_COLOUR}, ${0.7 * k})`);
        g.addColorStop(1, `rgba(${JUMP_COLOUR}, 0)`);
        ctx.globalAlpha = 1;
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalAlpha = k * 0.85;
        ctx.strokeStyle = `rgb(${JUMP_COLOUR})`;
        ctx.lineWidth = Math.max(1, scale * 0.07 * k);
        ctx.beginPath();
        ctx.arc(center.x, center.y, scale * (0.25 + 1.5 * Math.sqrt(t)), 0, Math.PI * 2);
        ctx.stroke();
    }

    private _drawDamage(ctx: CanvasRenderingContext2D, center: Pixel, scale: number, age: number) {
        if (age >= JUMP_DAMAGE_MS) return;
        const t = age / JUMP_DAMAGE_MS;
        const flicker = 0.6 + 0.4 * Math.sin(age / 40);
        ctx.globalAlpha = (1 - t) * flicker;
        ctx.strokeStyle = "#ff5a5a";
        ctx.lineWidth = Math.max(1, scale * 0.06);
        ctx.setLineDash([scale * 0.14, scale * 0.1]);
        ctx.beginPath();
        ctx.arc(center.x, center.y, scale * 0.7, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        if (scale >= 20) {
            const fontSize = Math.round(Math.min(18, scale * 0.26));
            const y = center.y - scale * (0.85 + 0.5 * t);
            ctx.globalAlpha = 1 - t;
            ctx.font = `700 ${fontSize}px "IBM Plex Sans", "Segoe UI", sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "bottom";
            ctx.lineWidth = Math.max(2, fontSize * 0.25);
            ctx.strokeStyle = "rgba(4, 8, 18, 0.85)";
            ctx.fillStyle = "#ff8a8a";
            ctx.strokeText("Damaged", center.x, y);
            ctx.fillText("Damaged", center.x, y);
        }
    }
}

/** Time a ship takes to fall into the departure gate's event horizon. */
export const STARGATE_DEPART_MS = 800;
/** Exit ripple length at the arrival gate; the ship scales in over its first part. */
export const STARGATE_ARRIVE_MS = 900;
const STARGATE_OPEN_MS = 250;
const STARGATE_COLOUR = "90, 170, 255";
const STARGATE_ARMS = 5;

type StargateFlash = {
    from: Pixel | null;
    to: Pixel;
    departAt: number;
    arriveAt: number;
    /** Hex size in world pixels. */
    scale: number;
    /** Starting angle of the swirl, so simultaneous gates don't spin in lockstep. */
    phase: number;
};

/**
 * Stargate transits in world space: a swirling blue event horizon opens at the departure gate
 * and swallows the ship, then a matching horizon bursts open at the exit gate with ripples.
 */
export class StargateEffects {
    private _flashes: StargateFlash[] = [];

    spawn(flash: Omit<StargateFlash, "phase">) {
        this._flashes.push({ ...flash, phase: Math.random() * Math.PI * 2 });
    }

    clear() {
        this._flashes = [];
    }

    render(
        ctx: CanvasRenderingContext2D,
        now: number,
        toScreen: (world: Pixel) => Pixel,
        zoom: number
    ) {
        this._flashes = this._flashes.filter((f) => now - f.arriveAt < STARGATE_ARRIVE_MS);
        if (!this._flashes.length) return;

        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        for (const flash of this._flashes) {
            if (now < flash.departAt) continue;
            const scale = flash.scale * zoom;
            if (flash.from && now < flash.arriveAt + STARGATE_OPEN_MS) {
                const span = flash.arriveAt - flash.departAt + STARGATE_OPEN_MS;
                const t = (now - flash.departAt) / span;
                this._drawHorizon(ctx, toScreen(flash.from), scale, t, flash.phase, now);
            }
            if (now >= flash.arriveAt) {
                const age = now - flash.arriveAt;
                this._drawHorizon(
                    ctx,
                    toScreen(flash.to),
                    scale,
                    age / STARGATE_ARRIVE_MS,
                    flash.phase + Math.PI,
                    now
                );
                this._drawRipples(ctx, toScreen(flash.to), scale, age);
            }
        }
        ctx.restore();
    }

    /** Event horizon over its life `t` (0-1): opens, swirls, then closes. */
    private _drawHorizon(
        ctx: CanvasRenderingContext2D,
        center: Pixel,
        scale: number,
        t: number,
        phase: number,
        now: number
    ) {
        if (t < 0 || t >= 1) return;
        const open = Math.min(1, t / 0.2) * Math.min(1, (1 - t) / 0.25);
        const radius = scale * 0.62 * open;
        if (radius <= 0.5) return;

        const g = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, radius);
        g.addColorStop(0, `rgba(220, 240, 255, ${0.75 * open})`);
        g.addColorStop(0.45, `rgba(${STARGATE_COLOUR}, ${0.55 * open})`);
        g.addColorStop(1, `rgba(${STARGATE_COLOUR}, 0)`);
        ctx.globalAlpha = 1;
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
        ctx.fill();

        const spin = phase + now / 160;
        ctx.strokeStyle = `rgba(170, 215, 255, ${0.8 * open})`;
        ctx.lineWidth = Math.max(0.75, scale * 0.035);
        for (let arm = 0; arm < STARGATE_ARMS; arm++) {
            const start = spin + (arm / STARGATE_ARMS) * Math.PI * 2;
            ctx.beginPath();
            for (let i = 0; i <= 12; i++) {
                const k = i / 12;
                const a = start + k * Math.PI * 0.9;
                const r = radius * (0.15 + 0.85 * k);
                const x = center.x + Math.cos(a) * r;
                const y = center.y + Math.sin(a) * r;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();
        }

        ctx.strokeStyle = `rgba(${STARGATE_COLOUR}, ${open})`;
        ctx.lineWidth = Math.max(1, scale * 0.06);
        ctx.beginPath();
        ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
        ctx.stroke();
    }

    private _drawRipples(ctx: CanvasRenderingContext2D, center: Pixel, scale: number, age: number) {
        for (let i = 0; i < 3; i++) {
            const t = (age - i * 140) / (STARGATE_ARRIVE_MS * 0.7);
            if (t <= 0 || t >= 1) continue;
            ctx.globalAlpha = (1 - t) * 0.8;
            ctx.strokeStyle = `rgb(${STARGATE_COLOUR})`;
            ctx.lineWidth = Math.max(1, scale * 0.06 * (1 - t));
            ctx.beginPath();
            ctx.arc(center.x, center.y, scale * (0.3 + 1.4 * Math.sqrt(t)), 0, Math.PI * 2);
            ctx.stroke();
        }
        if (age < 220) {
            const k = 1 - age / 220;
            const radius = scale * (0.3 + 0.5 * (1 - k));
            const g = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, radius);
            g.addColorStop(0, `rgba(255, 255, 255, ${k})`);
            g.addColorStop(1, `rgba(${STARGATE_COLOUR}, 0)`);
            ctx.globalAlpha = 1;
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}
