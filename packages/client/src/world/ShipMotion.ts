import {
    axialDirectionAngle,
    axialDirectionTowards,
    axialToPixel,
    shortestAngleDelta,
    type Axial,
    type Pixel
} from "@space/maths";
import type { ShipTypeInfo } from "@space/shared-data";

/** Drawn ship placement: world pixels plus heading in radians (screen space, 0 = east). */
export type ShipPose = { x: number; y: number; heading: number };

export type MotionSpeeds = Pick<ShipTypeInfo, "rotationSpeed" | "moveSpeed">;

/**
 * Supply ships cover 6–10 hexes a turn, so they animate faster than warships:
 * 180° turn 0.375s + 1 hex 0.25s.
 */
export const SUPPLY_SHIP_MOTION: MotionSpeeds = { rotationSpeed: 480, moveSpeed: 4 };

type Segment =
    | { kind: "rotate"; at: Pixel; from: number; delta: number; duration: number }
    | { kind: "move"; from: Pixel; to: Pixel; heading: number; duration: number };

/** Queued animation beyond this is skipped when another move arrives. */
const MAX_BACKLOG_MS = 1500;

function smoothstep(t: number): number {
    return t * t * (3 - 2 * t);
}

/**
 * Time-based rotate-then-translate animation for one ship. Each hex step on a
 * path turns (shortest way) to face the next hex, then travels to its centre.
 */
export class ShipMotion {
    private _segments: Segment[] = [];
    private _startedAt: number;
    private _totalMs = 0;
    private _end: ShipPose;

    constructor(start: ShipPose, now: number) {
        this._end = { ...start };
        this._startedAt = now;
    }

    static poseAtHex(hex: Axial, facing: number, hexSize: number): ShipPose {
        const p = axialToPixel(hex.q, hex.r, hexSize);
        return { x: p.x, y: p.y, heading: axialDirectionAngle(facing) };
    }

    isDone(now: number): boolean {
        return now - this._startedAt >= this._totalMs;
    }

    /**
     * Append steps along `path` (neighbouring hexes, `path[0]` = current hex). Chains
     * onto any running animation; a long backlog or a path that doesn't start where
     * the animation ends snaps to the end pose first.
     */
    enqueue(path: Axial[], hexSize: number, speeds: MotionSpeeds, now: number) {
        if (path.length < 2) return;
        const start = axialToPixel(path[0].q, path[0].r, hexSize);
        const remaining = this._startedAt + this._totalMs - now;
        const offPath = Math.hypot(start.x - this._end.x, start.y - this._end.y) > 1;
        if (remaining <= 0 || remaining > MAX_BACKLOG_MS || offPath) {
            this._segments = [];
            this._totalMs = 0;
            this._startedAt = now;
            this._end = { x: start.x, y: start.y, heading: this._end.heading };
        }

        const moveMs = 1000 / Math.max(speeds.moveSpeed, 1e-3);
        const degPerMs = Math.max(speeds.rotationSpeed, 1e-3) / 1000;
        let at: Pixel = start;
        let heading = this._end.heading;
        for (let i = 1; i < path.length; i++) {
            const to = axialToPixel(path[i].q, path[i].r, hexSize);
            const target = axialDirectionAngle(axialDirectionTowards(path[i - 1], path[i]));
            const delta = shortestAngleDelta(heading, target);
            if (Math.abs(delta) > 1e-4) {
                const duration = Math.abs(delta * (180 / Math.PI)) / degPerMs;
                this._push({ kind: "rotate", at, from: heading, delta, duration });
                heading += delta;
            }
            this._push({ kind: "move", from: at, to, heading, duration: moveMs });
            at = to;
        }
        this._end = { x: at.x, y: at.y, heading };
    }

    poseAt(now: number): ShipPose {
        let t = now - this._startedAt;
        for (const segment of this._segments) {
            if (t < segment.duration) {
                const k = smoothstep(Math.max(0, t) / segment.duration);
                if (segment.kind === "rotate") {
                    return {
                        x: segment.at.x,
                        y: segment.at.y,
                        heading: segment.from + segment.delta * k
                    };
                }
                return {
                    x: segment.from.x + (segment.to.x - segment.from.x) * k,
                    y: segment.from.y + (segment.to.y - segment.from.y) * k,
                    heading: segment.heading
                };
            }
            t -= segment.duration;
        }
        return { ...this._end };
    }

    private _push(segment: Segment) {
        this._segments.push(segment);
        this._totalMs += segment.duration;
    }
}
