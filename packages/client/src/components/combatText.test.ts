import type { CombatParticipant, CombatResult } from "@space/shared-data";
import { describe, expect, it } from "vitest";
import { HexWorld } from "../world/HexWorld.js";
import { combatLosses, participantName } from "./combatText.js";

const participant = (overrides: Partial<CombatParticipant>): CombatParticipant => ({
    id: "p",
    kind: "ship",
    sideId: "alpha",
    role: "attacker",
    shipType: "bomber_squadron",
    maxHp: 5,
    hpBefore: 5,
    hpAfter: 0,
    damageDealt: 0,
    damageTaken: 5,
    evaded: false,
    destroyed: true,
    ...overrides
});

describe("combat text", () => {
    it("names defensive structures by their structure type", () => {
        const world = new HexWorld();
        const platform = participant({
            id: "installation-1",
            kind: "installation",
            structureType: "orbital_platform",
            shipType: undefined
        });
        expect(participantName(world, platform)).toBe("Orbital Platform");
        expect(participantName(world, participant({}))).toBe("Bomber Squadron");
    });

    it("counts destroyed installations apart from each side's ship losses", () => {
        const result = {
            participants: [
                participant({ id: "s1" }),
                participant({
                    id: "installation-1",
                    kind: "installation",
                    sideId: "beta",
                    role: "defender",
                    structureType: "orbital_platform",
                    shipType: undefined
                }),
                participant({
                    id: "installation-2",
                    kind: "installation",
                    sideId: "beta",
                    role: "defender",
                    structureType: "defensive_battery",
                    shipType: undefined,
                    maxHp: 0,
                    destroyed: false
                })
            ],
            destroyedInstallationIds: ["installation-1"]
        } as CombatResult;
        expect(combatLosses(result)).toBe("Alpha lost 1 · 1 installation destroyed");
    });

    it("names space structures and counts them apart from ship losses", () => {
        const world = new HexWorld();
        const station = participant({
            id: "station-1",
            kind: "space_structure",
            sideId: "beta",
            role: "defender",
            spaceStructureType: "space_station",
            shipType: undefined
        });
        expect(participantName(world, station)).toBe("Space Station");
        const result = {
            participants: [participant({ id: "s1" }), station],
            destroyedStructureIds: ["station-1"]
        } as CombatResult;
        expect(combatLosses(result)).toBe("Alpha lost 1 · 1 structure destroyed");
    });
});
