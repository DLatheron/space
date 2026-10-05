import { describe, expect, it } from "vitest";
import {
    canConstruct,
    canEnterStargate,
    friendlyGates,
    spaceStructureMaxTier,
    spaceStructureSiteBlocked,
    spaceStructureStats,
    spaceStructureTier,
    type EconomyBalance,
    type EntitySummary,
    type ShipEntity,
    type SpaceStructureEntity
} from "../index.js";

const tier = (tech: "sensor_arrays_2" | "sensor_arrays_3") => ({
    cost: { money: 10, materials: 10, population: 0, science: 10 },
    buildTurns: 2,
    requiresTech: tech
});

/** Only the parts of the balance the helpers read. */
const balance = {
    structureTierOutput: [1, 1.5, 2],
    ships: { builder: { canConstruct: true }, frigate: { canConstruct: false } },
    spaceStructures: {
        sensor_array: {
            cost: { money: 100, materials: 100, population: 0, science: 0 },
            buildTurns: 3,
            requiresTech: "space_construction",
            hp: 10,
            attack: 0,
            defence: 2,
            fireRadius: 0,
            visionRange: [8, 10, 12],
            repairBonus: 0,
            docksShips: false,
            shipSlots: 0,
            tiers: [tier("sensor_arrays_2"), tier("sensor_arrays_3")]
        },
        stargate: {
            cost: { money: 100, materials: 100, population: 0, science: 0 },
            buildTurns: 3,
            requiresTech: "stargates",
            hp: 30,
            attack: 0,
            defence: 4,
            fireRadius: 0,
            visionRange: [2, 2, 2],
            repairBonus: 0,
            docksShips: false,
            shipSlots: 0,
            tiers: []
        }
    }
} as unknown as EconomyBalance;

function ship(overrides: Partial<ShipEntity> = {}): ShipEntity {
    return {
        id: "b1",
        kind: "ship",
        shipType: "builder",
        sideId: "alpha",
        q: 0,
        r: 0,
        facing: 0,
        movementPoints: 3,
        maxMovementPoints: 3,
        ...overrides
    };
}

function gate(overrides: Partial<SpaceStructureEntity> = {}): SpaceStructureEntity {
    return {
        id: "g1",
        kind: "space_structure",
        structureType: "stargate",
        sideId: "alpha",
        q: 0,
        r: 0,
        ...overrides
    };
}

describe("space structure helpers", () => {
    it("scales stats by tier and picks the tier's vision range", () => {
        expect(spaceStructureStats("sensor_array", 1, balance)).toEqual({
            hp: 10,
            attack: 0,
            defence: 2,
            fireRadius: 0,
            visionRange: 8
        });
        expect(spaceStructureStats("sensor_array", 3, balance)).toMatchObject({
            hp: 20,
            defence: 4,
            visionRange: 12
        });
        expect(spaceStructureMaxTier("sensor_array", balance)).toBe(3);
        expect(spaceStructureMaxTier("stargate", balance)).toBe(1);
        expect(spaceStructureTier("sensor_array", 3, balance)?.requiresTech).toBe(
            "sensor_arrays_3"
        );
        expect(spaceStructureTier("sensor_array", 1, balance)).toBeUndefined();
    });

    it("only allows one structure per hex, in open space", () => {
        const builder = ship();
        expect(spaceStructureSiteBlocked([builder])).toBeUndefined();
        expect(spaceStructureSiteBlocked([builder, gate()])).toMatch(/already/);
        const moon: EntitySummary = {
            id: "m1",
            kind: "moon",
            sideId: null,
            systemId: "s",
            q: 0,
            r: 0
        };
        expect(spaceStructureSiteBlocked([builder, moon])).toMatch(/open space/);
    });

    it("checks the Builder, tech, carrier and enemies before construction", () => {
        const builder = ship();
        const techs = ["space_construction" as const];
        expect(canConstruct(builder, "sensor_array", [builder], techs, balance)).toEqual({
            ok: true
        });
        expect(canConstruct(builder, "stargate", [builder], techs, balance).ok).toBe(false);
        const frigate = ship({ shipType: "frigate" });
        expect(canConstruct(frigate, "sensor_array", [frigate], techs, balance).ok).toBe(false);
        const carried = ship({ carriedBy: "c1" });
        expect(canConstruct(carried, "sensor_array", [], techs, balance).ok).toBe(false);
        const enemy = ship({ id: "e1", sideId: "beta", shipType: "frigate" });
        expect(canConstruct(builder, "sensor_array", [builder, enemy], techs, balance).ok).toBe(
            false
        );
    });

    it("lets ships with movement left enter completed friendly gates on their hex", () => {
        expect(canEnterStargate(ship(), gate())).toEqual({ ok: true });
        expect(canEnterStargate(ship(), undefined).ok).toBe(false);
        expect(canEnterStargate(ship(), gate({ sideId: "beta" })).ok).toBe(false);
        expect(canEnterStargate(ship(), gate({ constructing: true })).ok).toBe(false);
        expect(canEnterStargate(ship(), gate({ q: 1 })).ok).toBe(false);
        expect(canEnterStargate(ship({ movementPoints: 0 }), gate()).ok).toBe(false);
        expect(
            friendlyGates(
                [
                    gate(),
                    gate({ id: "g2", sideId: "beta" }),
                    gate({ id: "g3", constructing: true })
                ],
                "alpha"
            ).map((g) => g.id)
        ).toEqual(["g1"]);
    });
});
