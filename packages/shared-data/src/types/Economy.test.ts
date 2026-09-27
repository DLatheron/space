import {
    canAfford,
    canBuild,
    countQueuedShips,
    HOME_PLANET_LEVEL,
    incomeFor,
    shipCapFor,
    slotsUsed,
    STARTING_STOCKPILE,
    type BuildContext,
    type BuildItem,
    type PlanetEconomy
} from "../index.js";

function planet(overrides: Partial<PlanetEconomy> = {}): PlanetEconomy {
    return { planetId: "p1", level: HOME_PLANET_LEVEL, structures: [], queue: [], ...overrides };
}

function ctx(overrides: Partial<BuildContext> = {}): BuildContext {
    return { stockpile: { ...STARTING_STOCKPILE }, shipCount: 2, shipCap: 3, ...overrides };
}

const farm: BuildItem = { kind: "structure", structureType: "farm" };
const scout: BuildItem = { kind: "ship", shipType: "scout" };

describe("shipCapFor", () => {
    it("gives a level-10 home planet a cap of 3", () => {
        expect(shipCapFor([planet()])).toBe(3);
    });

    it("adds 1 per Docks and sums across planets", () => {
        expect(shipCapFor([planet({ structures: ["shipyard", "docks"] })])).toBe(4);
        expect(shipCapFor([planet(), planet({ level: 4 }), planet({ level: 20 })])).toBe(3 + 1 + 5);
    });
});

describe("incomeFor", () => {
    it("scales base income by level and adds structure output", () => {
        expect(incomeFor([planet()])).toEqual({ food: 50, gold: 50, resources: 50 });
        expect(
            incomeFor([
                planet({ structures: ["farm", "farm", "mine", "shipyard"] }),
                planet({ level: 1 })
            ])
        ).toEqual({ food: 50 + 80 + 5, gold: 55, resources: 50 + 40 + 5 });
    });
});

describe("slotsUsed / countQueuedShips", () => {
    it("counts built and queued structures, and queued ships", () => {
        const p = planet({
            structures: ["farm"],
            queue: [
                { item: farm, turnsRemaining: 2, totalTurns: 2 },
                { item: scout, turnsRemaining: 2, totalTurns: 2 }
            ]
        });
        expect(slotsUsed(p)).toBe(2);
        expect(
            countQueuedShips([
                p,
                planet({ queue: [{ item: scout, turnsRemaining: 1, totalTurns: 2 }] })
            ])
        ).toBe(2);
    });
});

describe("canAfford", () => {
    it("requires every resource to be covered", () => {
        expect(
            canAfford({ food: 10, gold: 10, resources: 10 }, { food: 10, gold: 10, resources: 10 })
        ).toBe(true);
        expect(
            canAfford({ food: 10, gold: 9, resources: 10 }, { food: 10, gold: 10, resources: 10 })
        ).toBe(false);
    });
});

describe("canBuild", () => {
    it("allows a farm on an empty home planet", () => {
        expect(canBuild(ctx(), planet(), farm)).toEqual({ ok: true });
    });

    it("rejects when unaffordable", () => {
        const poor = ctx({ stockpile: { food: 0, gold: 0, resources: 0 } });
        expect(canBuild(poor, planet(), farm)).toEqual({
            ok: false,
            reason: "Not enough resources"
        });
    });

    it("rejects when slots are full, counting queued structures", () => {
        const p = planet({
            level: 2,
            structures: ["farm"],
            queue: [{ item: farm, turnsRemaining: 1, totalTurns: 2 }]
        });
        expect(canBuild(ctx(), p, farm)).toEqual({ ok: false, reason: "No free structure slots" });
    });

    it("requires prerequisites to be built, not queued", () => {
        const docks: BuildItem = { kind: "structure", structureType: "docks" };
        expect(canBuild(ctx(), planet(), docks)).toEqual({
            ok: false,
            reason: "Requires Shipyard"
        });
        const queued = planet({
            queue: [
                {
                    item: { kind: "structure", structureType: "shipyard" },
                    turnsRemaining: 3,
                    totalTurns: 3
                }
            ]
        });
        expect(canBuild(ctx(), queued, docks)).toEqual({ ok: false, reason: "Requires Shipyard" });
        expect(canBuild(ctx(), planet({ structures: ["shipyard"] }), docks)).toEqual({ ok: true });
    });

    it("allows only one shipyard per planet", () => {
        const shipyard: BuildItem = { kind: "structure", structureType: "shipyard" };
        expect(canBuild(ctx(), planet({ structures: ["shipyard"] }), shipyard)).toEqual({
            ok: false,
            reason: "Only one Shipyard per planet"
        });
    });

    it("requires the right shipyard for ships", () => {
        const frigate: BuildItem = { kind: "ship", shipType: "frigate" };
        expect(canBuild(ctx(), planet(), scout)).toEqual({
            ok: false,
            reason: "Requires Shipyard"
        });
        expect(canBuild(ctx(), planet({ structures: ["shipyard"] }), frigate)).toEqual({
            ok: false,
            reason: "Requires Advanced Shipyard"
        });
        expect(canBuild(ctx(), planet({ structures: ["shipyard"] }), scout)).toEqual({ ok: true });
        expect(
            canBuild(ctx(), planet({ structures: ["shipyard"] }), {
                kind: "ship",
                shipType: "colony_ship"
            })
        ).toEqual({ ok: true });
    });

    it("rejects ships at the ship cap", () => {
        expect(
            canBuild(ctx({ shipCount: 3 }), planet({ structures: ["shipyard"] }), scout)
        ).toEqual({
            ok: false,
            reason: "Ship cap reached"
        });
    });
});
