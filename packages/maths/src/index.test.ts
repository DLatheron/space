import {
    axialDirectionAngle,
    axialDirectionTowards,
    axialDistance,
    axialLine,
    axialNeighbor,
    shortestAngleDelta
} from "./index.js";

describe("axialLine", () => {
    it("returns just the start hex for a zero-length line", () => {
        expect(axialLine({ q: 2, r: 3 }, { q: 2, r: 3 })).toEqual([{ q: 2, r: 3 }]);
    });

    it("walks neighbour-by-neighbour from start to end", () => {
        const a = { q: 0, r: 0 };
        const b = { q: 4, r: -1 };
        const line = axialLine(a, b);
        expect(line).toHaveLength(axialDistance(a, b) + 1);
        expect(line[0]).toEqual(a);
        expect(line.at(-1)).toEqual(b);
        for (let i = 1; i < line.length; i++) {
            expect(axialDistance(line[i - 1], line[i])).toBe(1);
        }
    });

    it("follows a straight axis exactly", () => {
        expect(axialLine({ q: 0, r: 0 }, { q: 3, r: 0 })).toEqual([
            { q: 0, r: 0 },
            { q: 1, r: 0 },
            { q: 2, r: 0 },
            { q: 3, r: 0 }
        ]);
    });
});

describe("axial directions", () => {
    it("maps each neighbour back to its direction index", () => {
        const origin = { q: 3, r: -2 };
        for (let i = 0; i < 6; i++) {
            expect(axialDirectionTowards(origin, axialNeighbor(origin, i))).toBe(i);
        }
    });

    it("gives east = 0 and counter-clockwise (screen) steps of 60°", () => {
        expect(axialDirectionAngle(0)).toBeCloseTo(0);
        expect(axialDirectionAngle(1)).toBeCloseTo(-Math.PI / 3);
        expect(axialDirectionAngle(3)).toBeCloseTo(-Math.PI);
        expect(axialDirectionAngle(7)).toBeCloseTo(axialDirectionAngle(1));
    });
});

describe("shortestAngleDelta", () => {
    it("takes the short way round", () => {
        expect(shortestAngleDelta(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2);
        expect(shortestAngleDelta(0, -Math.PI / 2)).toBeCloseTo(-Math.PI / 2);
        expect(shortestAngleDelta(Math.PI * 0.9, -Math.PI * 0.9)).toBeCloseTo(Math.PI * 0.2);
        expect(shortestAngleDelta(-Math.PI * 0.9, Math.PI * 0.9)).toBeCloseTo(-Math.PI * 0.2);
        expect(shortestAngleDelta(0, Math.PI * 4)).toBeCloseTo(0);
    });

    it("returns +π for an exact reversal", () => {
        expect(shortestAngleDelta(0, Math.PI)).toBeCloseTo(Math.PI);
        expect(shortestAngleDelta(0, -Math.PI)).toBeCloseTo(Math.PI);
    });
});
