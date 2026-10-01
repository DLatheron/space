import type { EconomyBalance } from "./Economy.js";
import {
    hyperjumpAccuracy,
    hyperjumpAccuracyBonus,
    isHyperspaceHazardKind,
    normaliseAccuracy,
    ringHexes,
    scatterRing,
    shiftAccuracy
} from "./Hyperspace.js";

/** Only the parts the accuracy helpers read. */
const balance = {
    ships: {
        frigate: {
            hyperdrive: { cooldownTurns: 3, accuracy: { onTarget: 20, oneOff: 50, twoOff: 30 } }
        },
        scout: {}
    },
    shipTiers: { hyperdriveAccuracyBonus: [0, 10, 20] },
    hyperspace: {
        techAccuracyBonus: { hyperdrive_calibration_1: 10, hyperdrive_calibration_2: 15 }
    }
} as unknown as EconomyBalance;

const distance = (a: { q: number; r: number }, b: { q: number; r: number }) =>
    Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(a.q + a.r - b.q - b.r));

describe("hyperjump accuracy", () => {
    it("normalises chances to percentages", () => {
        expect(normaliseAccuracy({ onTarget: 1, oneOff: 2, twoOff: 1 })).toEqual({
            onTarget: 25,
            oneOff: 50,
            twoOff: 25
        });
        expect(normaliseAccuracy({ onTarget: 0, oneOff: 0, twoOff: 0 }).onTarget).toBe(100);
    });

    it("shifts each band one step closer by the bonus, never below zero", () => {
        const base = { onTarget: 20, oneOff: 50, twoOff: 30 };
        expect(shiftAccuracy(base, 0)).toEqual(base);
        expect(shiftAccuracy(base, 10)).toEqual({ onTarget: 30, oneOff: 50, twoOff: 20 });
        expect(shiftAccuracy(base, 40)).toEqual({ onTarget: 60, oneOff: 40, twoOff: 0 });
        expect(shiftAccuracy(base, 500)).toEqual({ onTarget: 100, oneOff: 0, twoOff: 0 });
    });

    it("adds tier and calibration tech bonuses", () => {
        expect(hyperjumpAccuracyBonus(balance, 1, [])).toBe(0);
        expect(hyperjumpAccuracyBonus(balance, 3, ["hyperdrive_calibration_1"])).toBe(30);
        expect(
            hyperjumpAccuracyBonus(balance, 2, [
                "hyperdrive_calibration_1",
                "hyperdrive_calibration_2",
                "transports"
            ])
        ).toBe(35);
        expect(hyperjumpAccuracy(balance, "frigate", 1, [])).toEqual({
            onTarget: 20,
            oneOff: 50,
            twoOff: 30
        });
        expect(hyperjumpAccuracy(balance, "frigate", 2, ["hyperdrive_calibration_1"])).toEqual({
            onTarget: 40,
            oneOff: 50,
            twoOff: 10
        });
        expect(hyperjumpAccuracy(balance, "scout", 3, [])).toBeUndefined();
    });

    it("picks the scatter ring from a roll", () => {
        const accuracy = { onTarget: 20, oneOff: 50, twoOff: 30 };
        expect(scatterRing(accuracy, 0)).toBe(0);
        expect(scatterRing(accuracy, 0.19)).toBe(0);
        expect(scatterRing(accuracy, 0.2)).toBe(1);
        expect(scatterRing(accuracy, 0.69)).toBe(1);
        expect(scatterRing(accuracy, 0.7)).toBe(2);
        expect(scatterRing(accuracy, 0.999)).toBe(2);
    });

    it("picks rings from unnormalised or all-zero chances", () => {
        const accuracy = { onTarget: 1, oneOff: 1, twoOff: 2 };
        expect(scatterRing(accuracy, 0.24)).toBe(0);
        expect(scatterRing(accuracy, 0.25)).toBe(1);
        expect(scatterRing(accuracy, 0.5)).toBe(2);
        expect(scatterRing({ onTarget: 0, oneOff: 0, twoOff: 0 }, 0.99)).toBe(0);
    });

    it("clamps the tier to 1-3 and ignores unrelated techs", () => {
        expect(hyperjumpAccuracyBonus(balance, 0, [])).toBe(0);
        expect(hyperjumpAccuracyBonus(balance, 9, [])).toBe(20);
        expect(hyperjumpAccuracyBonus(balance, 1, ["transports", "ground_forces"])).toBe(0);
    });
});

describe("hyperspace hazard kinds", () => {
    it("recognises the hazardous entity kinds only", () => {
        for (const kind of [
            "sun",
            "planet",
            "moon",
            "large_asteroid",
            "asteroid_belt",
            "black_hole"
        ] as const) {
            expect(isHyperspaceHazardKind(kind)).toBe(true);
        }
        for (const kind of ["ship", "supply_ship", "wormhole", "hyperspace_tunnel"] as const) {
            expect(isHyperspaceHazardKind(kind)).toBe(false);
        }
    });
});

describe("ringHexes", () => {
    it("lists the hexes exactly `radius` away", () => {
        const center = { q: 5, r: 5 };
        expect(ringHexes(center, 0)).toEqual([center]);
        for (const radius of [1, 2, 3]) {
            const ring = ringHexes(center, radius);
            expect(ring).toHaveLength(6 * radius);
            expect(new Set(ring.map((h) => `${h.q},${h.r}`)).size).toBe(6 * radius);
            for (const hex of ring) expect(distance(hex, center)).toBe(radius);
        }
    });

    it("keeps only in-bounds hexes", () => {
        const inBounds = (h: { q: number; r: number }) => h.q >= 0 && h.r >= 0;
        const ring = ringHexes({ q: 0, r: 0 }, 1, inBounds);
        expect(ring.sort((a, b) => a.q - b.q || a.r - b.r)).toEqual([
            { q: 0, r: 1 },
            { q: 1, r: 0 }
        ]);
        expect(ringHexes({ q: -5, r: 0 }, 0, inBounds)).toEqual([]);
        const outer = ringHexes({ q: 0, r: 0 }, 2, inBounds);
        expect(outer).toHaveLength(3);
        for (const hex of outer) {
            expect(inBounds(hex)).toBe(true);
            expect(distance(hex, { q: 0, r: 0 })).toBe(2);
        }
    });
});
