import {
    GROUND_UNIT_TYPE_INFO,
    SHIP_TYPE_INFO,
    STRUCTURE_INFO,
    type CombatParticipant,
    type CombatResult,
    type SideId
} from "@space/shared-data";
import type { HexWorld } from "../world/HexWorld.js";

const CAUSE_LABELS: Record<CombatResult["cause"], string> = {
    move: "Attack",
    ambush: "Ambush",
    hyperjump: "Jump-in attack",
    invasion: "Invasion",
    bombardment: "Orbital bombardment"
};

export function sideName(sideId: SideId): string {
    return sideId.charAt(0).toUpperCase() + sideId.slice(1);
}

/** "Invasion of Kepler" or "Ambush at 3, -2". */
export function combatTitle(world: HexWorld, result: CombatResult): string {
    if (result.kind === "ground") {
        const location = result.locationId ? world.findEntityById(result.locationId) : undefined;
        const place = location?.name ?? "a location";
        return result.cause === "bombardment"
            ? `Orbital bombardment of ${place}`
            : `Invasion of ${place}`;
    }
    return `${CAUSE_LABELS[result.cause]} at ${result.hex.q}, ${result.hex.r}`;
}

/** Outcome in a few words, naming the attacker. */
export function combatOutcome(result: CombatResult): string {
    const attacker = sideName(result.attackerSideId);
    if (result.kind === "ground") {
        if (result.cause === "bombardment") {
            const installations = result.destroyedInstallationIds?.length ?? 0;
            const units = result.destroyedUnitIds.length;
            const bits: string[] = [];
            if (units) bits.push(`${units} unit${units === 1 ? "" : "s"} destroyed`);
            if (installations) {
                bits.push(
                    `${installations} installation${installations === 1 ? "" : "s"} destroyed`
                );
            }
            if (result.outcome === "attacker_won") {
                return bits.length
                    ? `${attacker} wiped the target (${bits.join(", ")})`
                    : `${attacker} cleared the target`;
            }
            return bits.length
                ? `${attacker} struck (${bits.join(", ")})`
                : `${attacker}'s bombardment dealt no lasting damage`;
        }
        if (result.captured) return `${attacker} captured it`;
        return result.outcome === "attacker_destroyed"
            ? `${attacker}'s invasion repelled`
            : `${attacker}'s invasion stalled`;
    }
    switch (result.outcome) {
        case "attacker_won":
            return `${attacker} won`;
        case "attacker_destroyed":
            return `${attacker}'s attackers destroyed`;
        case "inconclusive":
            return "Inconclusive";
    }
}

/** How it went for `sideId`: won, lost, or neither (inconclusive or not involved). */
export function combatTone(result: CombatResult, sideId: SideId | null): "win" | "loss" | "even" {
    if (!sideId || result.outcome === "inconclusive") return "even";
    const attackerWon = result.outcome === "attacker_won";
    if (result.attackerSideId === sideId) return attackerWon ? "win" : "loss";
    if (result.defenderSideIds.includes(sideId)) return attackerWon ? "loss" : "win";
    return "even";
}

export function participantName(world: HexWorld, p: CombatParticipant): string {
    if (p.kind === "ground_unit") {
        return p.unitType ? GROUND_UNIT_TYPE_INFO[p.unitType].name : "Ground unit";
    }
    if (p.kind === "supply_ship") return "Supply ship";
    if (p.kind === "installation") {
        return p.structureType ? STRUCTURE_INFO[p.structureType].name : "Installation";
    }
    const entity = world.findEntityById(p.id);
    const typeName = p.shipType ? SHIP_TYPE_INFO[p.shipType].name : "Ship";
    return entity?.kind === "ship" && entity.name ? entity.name : typeName;
}

/** Losses per side, e.g. "Alpha lost 2 · Beta lost 1"; installations are counted separately. */
export function combatLosses(result: CombatResult): string {
    const lost = new Map<SideId, number>();
    for (const p of result.participants) {
        if (p.destroyed && p.kind !== "installation") {
            lost.set(p.sideId, (lost.get(p.sideId) ?? 0) + 1);
        }
    }
    const parts: string[] = [];
    if (lost.size) {
        parts.push([...lost].map(([side, n]) => `${sideName(side)} lost ${n}`).join(" · "));
    }
    const installations = result.destroyedInstallationIds?.length ?? 0;
    if (installations) {
        parts.push(`${installations} installation${installations === 1 ? "" : "s"} destroyed`);
    }
    return parts.length ? parts.join(" · ") : "No losses";
}
