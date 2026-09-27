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
