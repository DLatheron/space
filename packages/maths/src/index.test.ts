import {
    axialDirectionAngle,
    axialDirectionTowards,
    axialDistance,
    axialLine,
    axialKey,
    axialNeighbor,
    findHexPath,
    hexReachable,
    planHexPath,
    shortestAngleDelta,
    type Axial,
    type HexPathOptions
} from "./index.js";

function gridOptions(blocked: Axial[], radius = 10): HexPathOptions {
    const blockedKeys = new Set(blocked.map((h) => axialKey(h.q, h.r)));
    return {
        inBounds: (h) => axialDistance(h, { q: 0, r: 0 }) <= radius,
        passable: (h) => !blockedKeys.has(axialKey(h.q, h.r))
    };
}

function expectContiguous(path: Axial[], from: Axial, to: Axial) {
    expect(path[0]).toEqual(from);
    expect(path.at(-1)).toEqual(to);
    for (let i = 1; i < path.length; i++) {
        expect(axialDistance(path[i - 1], path[i])).toBe(1);
    }
}

describe("findHexPath", () => {
    const from = { q: 0, r: 0 };
    const to = { q: 4, r: 0 };

    it("uses the straight line when nothing is in the way", () => {
        expect(findHexPath(from, to, gridOptions([]))).toEqual(axialLine(from, to));
    });

    it("routes around obstacles with a shortest detour", () => {
        const blocked = [{ q: 2, r: 0 }];
        const path = findHexPath(from, to, gridOptions(blocked))!;
        expectContiguous(path, from, to);
        expect(path).toHaveLength(6);
        expect(path).not.toContainEqual(blocked[0]);
    });

    it("always allows an obstacle destination", () => {
        const blocked = [to, { q: 2, r: 0 }];
        const path = findHexPath(from, to, gridOptions(blocked))!;
        expectContiguous(path, from, to);
        expect(path.slice(1, -1)).not.toContainEqual(blocked[1]);
    });

    it("returns null when walled in, and planHexPath falls back to the line", () => {
        const wall = [0, 1, 2, 3, 4, 5].map((d) => axialNeighbor(from, d));
        expect(findHexPath(from, to, gridOptions(wall))).toBeNull();
        expect(planHexPath(from, to, gridOptions(wall))).toEqual(axialLine(from, to));
    });

    it("gives up on detours longer than maxSteps", () => {
        const blocked = [{ q: 2, r: 0 }];
        expect(findHexPath(from, to, { ...gridOptions(blocked), maxSteps: 4 })).toBeNull();
    });

    it("rejects off-map destinations", () => {
        expect(findHexPath(from, { q: 20, r: 0 }, gridOptions([]))).toBeNull();
    });
});

describe("hexReachable", () => {
    it("counts steps around obstacles and includes obstacles as a final step", () => {
        const blocked = [{ q: 1, r: 0 }];
        const reached = hexReachable({ q: 0, r: 0 }, 2, gridOptions(blocked));
        const keys = new Set(reached.map((h) => axialKey(h.q, h.r)));
        expect(keys.has("1,0")).toBe(true);
        expect(keys.has("0,0")).toBe(false);
        // Directly behind the obstacle needs a 3-step detour.
        expect(keys.has("2,0")).toBe(false);
        expect(keys.has("2,-1")).toBe(true);
        expect(reached).toHaveLength(18 - 1);
    });
});

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
