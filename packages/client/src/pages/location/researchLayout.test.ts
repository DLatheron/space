import { TECHS, TechId } from "@space/shared-data";
import { describe, expect, it } from "vitest";
import {
    edgePath,
    layoutTechTree,
    TECH_NODE_HEIGHT,
    TECH_NODE_WIDTH,
    techDepths,
    techWithPrerequisites
} from "./researchLayout.js";

describe("research tree layout", () => {
    const layout = layoutTechTree();

    it("puts each tech one column right of its deepest prerequisite", () => {
        const depths = techDepths();
        expect(depths.get("supply_speed_1")).toBe(0);
        expect(depths.get("hyperdrive_range_1")).toBe(1);
        expect(depths.get("hyperdrive_range_2")).toBe(2);
        for (const techId of TechId.options) {
            const node = layout.nodes.get(techId)!;
            expect(node.column).toBe(depths.get(techId));
            for (const req of TECHS[techId].requires) {
                expect(layout.nodes.get(req)!.x).toBeLessThan(node.x);
            }
        }
    });

    it("lays out every tech once, without overlaps, inside the canvas", () => {
        expect(layout.nodes.size).toBe(TechId.options.length);
        const nodes = [...layout.nodes.values()];
        for (const a of nodes) {
            expect(a.x + TECH_NODE_WIDTH).toBeLessThanOrEqual(layout.width);
            expect(a.y + TECH_NODE_HEIGHT).toBeLessThanOrEqual(layout.height);
            for (const b of nodes) {
                if (a === b || a.column !== b.column) continue;
                expect(Math.abs(a.y - b.y)).toBeGreaterThanOrEqual(TECH_NODE_HEIGHT);
            }
        }
    });

    it("lines a single-prerequisite chain up level with its root", () => {
        const y = (t: TechId) => layout.nodes.get(t)!.y;
        expect(y("supply_speed_2")).toBe(y("supply_speed_1"));
        expect(y("enhancement_tier_3")).toBe(y("enhancement_tier_2"));
        expect(y("hyperdrive_calibration_2")).toBe(y("hyperdrive_calibration_1"));
    });

    it("lists one edge per prerequisite", () => {
        const expected = TechId.options.flatMap((to) =>
            TECHS[to].requires.map((from) => ({ from, to }))
        );
        expect(layout.edges).toEqual(expected);
        const from = layout.nodes.get("supply_speed_1")!;
        const to = layout.nodes.get("supply_speed_2")!;
        expect(edgePath(from, to)).toMatch(
            new RegExp(`^M ${from.x + TECH_NODE_WIDTH} [\\d.]+ C .* ${to.x} [\\d.]+$`)
        );
    });

    it("collects a tech with all its prerequisites", () => {
        expect(techWithPrerequisites("hyperdrive_range_2")).toEqual(
            new Set(["hyperdrive_range_2", "hyperdrive_range_1", "advanced_shipyard"])
        );
        expect(techWithPrerequisites("ground_forces")).toEqual(new Set(["ground_forces"]));
    });
});
