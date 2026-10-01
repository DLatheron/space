import { z } from "zod";
import type { EconomyBalance } from "./Economy.js";
import type { AxialCoord, EntityKind, ShipType } from "./PrimitiveTypes.js";
import type { TechId } from "./Tech.js";

/** Entity kinds that endanger a ship landing on their hex after a hyperspace jump. */
export const HyperspaceHazardKind = z.enum([
    "sun",
    "planet",
    "moon",
    "large_asteroid",
    "asteroid_belt",
    "black_hole"
]);
export type HyperspaceHazardKind = z.infer<typeof HyperspaceHazardKind>;

export function isHyperspaceHazardKind(kind: EntityKind): kind is HyperspaceHazardKind {
    return (HyperspaceHazardKind.options as readonly string[]).includes(kind);
}

/**
 * Relative chances (percentages, normally summing to 100) of a jump landing on its target,
 * on the ring 1 hex away or on the ring 2 hexes away.
 */
export const HyperdriveAccuracy = z.object({
    onTarget: z.number().min(0),
    oneOff: z.number().min(0),
    twoOff: z.number().min(0)
});
export type HyperdriveAccuracy = z.infer<typeof HyperdriveAccuracy>;

/** Present on ship types that carry a hyperdrive. */
export const HyperdriveBalance = z.object({
    /** Turns after a jump before the hyperdrive can be engaged again. */
    cooldownTurns: z.number().int().min(0),
    accuracy: HyperdriveAccuracy
});
export type HyperdriveBalance = z.infer<typeof HyperdriveBalance>;

export const HyperspaceHazardBalance = z.object({
    /** Chance (0-1) the ship is destroyed on landing. */
    destroyChance: z.number().min(0).max(1),
    /** Share (0-1) of the ship's full hp lost when it survives; never below 1 hp. */
    damageFraction: z.number().min(0).max(1)
});
export type HyperspaceHazardBalance = z.infer<typeof HyperspaceHazardBalance>;

export const HyperspaceBalance = z.object({
    hazards: z.record(HyperspaceHazardKind, HyperspaceHazardBalance),
    collision: z.object({
        /**
         * Chance (0-1) that both ships are destroyed when a jump lands on another ship.
         * Otherwise exactly one is, the jumper with chance `otherHp / (otherHp + jumperHp)`.
         */
        bothDestroyedChance: z.number().min(0).max(1)
    }),
    /** Accuracy bonus in percentage points per calibration tech known (see `hyperjumpAccuracy`). */
    techAccuracyBonus: z.object({
        hyperdrive_calibration_1: z.number().min(0),
        hyperdrive_calibration_2: z.number().min(0)
    })
});
export type HyperspaceBalance = z.infer<typeof HyperspaceBalance>;

export const HyperjumpOutcome = z.enum(["arrived", "damaged", "destroyed"]);
export type HyperjumpOutcome = z.infer<typeof HyperjumpOutcome>;

/** Largest scatter ring, in hexes from the target. */
export const MAX_SCATTER_RING = 2;
export type ScatterRing = 0 | 1 | 2;

export function hyperdriveFor(
    balance: EconomyBalance,
    shipType: ShipType
): HyperdriveBalance | undefined {
    return balance.ships[shipType].hyperdrive;
}

/** Percentage points of accuracy bonus from the ship's tier plus known calibration techs. */
export function hyperjumpAccuracyBonus(
    balance: EconomyBalance,
    tier: number,
    techs: readonly TechId[]
): number {
    const index = Math.min(Math.max(tier, 1), 3) - 1;
    let bonus = balance.shipTiers.hyperdriveAccuracyBonus[index] ?? 0;
    const techBonus = balance.hyperspace.techAccuracyBonus as Partial<Record<TechId, number>>;
    for (const tech of techs) bonus += techBonus[tech] ?? 0;
    return bonus;
}

/** Scales the chances to percentages summing to 100 (all on target when they're all zero). */
export function normaliseAccuracy(accuracy: HyperdriveAccuracy): HyperdriveAccuracy {
    const total = accuracy.onTarget + accuracy.oneOff + accuracy.twoOff;
    if (total <= 0) return { onTarget: 100, oneOff: 0, twoOff: 0 };
    return {
        onTarget: (accuracy.onTarget * 100) / total,
        oneOff: (accuracy.oneOff * 100) / total,
        twoOff: (accuracy.twoOff * 100) / total
    };
}

/**
 * Moves up to `bonus` percentage points from 2 hexes off to 1 hex off, and up to `bonus`
 * from 1 hex off to on target, so each band shifts one step closer.
 */
export function shiftAccuracy(accuracy: HyperdriveAccuracy, bonus: number): HyperdriveAccuracy {
    const base = normaliseAccuracy(accuracy);
    const shift = Math.max(0, bonus);
    const fromTwo = Math.min(shift, base.twoOff);
    const fromOne = Math.min(shift, base.oneOff + fromTwo);
    return {
        onTarget: base.onTarget + fromOne,
        oneOff: base.oneOff + fromTwo - fromOne,
        twoOff: base.twoOff - fromTwo
    };
}

/**
 * Landing chances (percentages summing to 100) for a ship of `shipType` at `tier` on a side
 * knowing `techs`; undefined when the ship type has no hyperdrive.
 */
export function hyperjumpAccuracy(
    balance: EconomyBalance,
    shipType: ShipType,
    tier: number,
    techs: readonly TechId[]
): HyperdriveAccuracy | undefined {
    const hyperdrive = hyperdriveFor(balance, shipType);
    if (!hyperdrive) return undefined;
    return shiftAccuracy(hyperdrive.accuracy, hyperjumpAccuracyBonus(balance, tier, techs));
}

/** Scatter ring picked by a random `roll` in [0, 1) against the landing chances. */
export function scatterRing(accuracy: HyperdriveAccuracy, roll: number): ScatterRing {
    const { onTarget, oneOff } = normaliseAccuracy(accuracy);
    const point = roll * 100;
    if (point < onTarget) return 0;
    if (point < onTarget + oneOff) return 1;
    return 2;
}

const RING_DIRECTIONS: AxialCoord[] = [
    { q: 1, r: 0 },
    { q: 1, r: -1 },
    { q: 0, r: -1 },
    { q: -1, r: 0 },
    { q: -1, r: 1 },
    { q: 0, r: 1 }
];

/**
 * Hexes exactly `radius` steps from `center` (just the center for radius 0), in a fixed
 * walk order, keeping only those for which `inBounds` holds.
 */
export function ringHexes(
    center: AxialCoord,
    radius: number,
    inBounds: (hex: AxialCoord) => boolean = () => true
): AxialCoord[] {
    if (radius <= 0) return inBounds(center) ? [{ q: center.q, r: center.r }] : [];
    const result: AxialCoord[] = [];
    const start = RING_DIRECTIONS[4]!;
    let hex = { q: center.q + start.q * radius, r: center.r + start.r * radius };
    for (let side = 0; side < 6; side++) {
        const step = RING_DIRECTIONS[side]!;
        for (let i = 0; i < radius; i++) {
            if (inBounds(hex)) result.push(hex);
            hex = { q: hex.q + step.q, r: hex.r + step.r };
        }
    }
    return result;
}
