import { z } from "zod";
import type { EconomyBalance } from "./Economy.js";
import {
    type AxialCoord,
    type EntitySummary,
    type ShipEntity,
    type SideId,
    type SpaceStructureEntity,
    SpaceStructureType
} from "./PrimitiveTypes.js";
import { Resources } from "./Resources.js";
import { TechId, TECHS } from "./Tech.js";

/** One upgrade of a space structure: research `requiresTech`, then fund an upgrade order. */
export const SpaceStructureTierBalance = z.object({
    cost: Resources,
    buildTurns: z.number().int().positive(),
    requiresTech: TechId.nullable()
});
export type SpaceStructureTierBalance = z.infer<typeof SpaceStructureTierBalance>;

/** Stats of a space structure at tier 1; upgrades scale hp, attack and defence by `structureTierOutput`. */
export const SpaceStructureBalance = z.object({
    cost: Resources,
    buildTurns: z.number().int().positive(),
    requiresTech: TechId.nullable(),
    hp: z.number().int().positive(),
    /** 0 for unarmed structures, which still defend their hex (and are destroyed by attackers). */
    attack: z.number().int().min(0),
    defence: z.number().int().min(0),
    /** Fires at every enemy ship within this many hexes at each end of turn; 0 never fires. */
    fireRadius: z.number().int().min(0),
    /** How far the side sees from it, per tier. */
    visionRange: z.tuple([
        z.number().int().min(0),
        z.number().int().min(0),
        z.number().int().min(0)
    ]),
    /** Repair fraction added for own ships on its hex (see `shipRepairPerTurn`). */
    repairBonus: z.number().min(0).max(1),
    /** Ships can repair here even if they only repair docked (see `ShipBalance.repairsInSpace`). */
    docksShips: z.boolean(),
    /** Ships it builds at once; 0 for none. */
    shipSlots: z.number().int().min(0),
    /** Upgrades to tier 2 and 3, in order; empty when it can't be upgraded. */
    tiers: z.array(SpaceStructureTierBalance).max(2)
});
export type SpaceStructureBalance = z.infer<typeof SpaceStructureBalance>;

export const SPACE_STRUCTURE_INFO: Record<
    SpaceStructureType,
    { name: string; description: string }
> = {
    sensor_array: {
        name: "Sensor Array",
        description: "Sees far across space. Upgrades extend its range."
    },
    space_station: {
        name: "Space Station",
        description:
            "Armed station that guards its hex, fires on enemy ships next to it and speeds up repairs."
    },
    missile_battery: {
        name: "Missile Battery",
        description: "Fires missiles at every enemy ship within range at the end of each turn."
    },
    space_dock: {
        name: "Space Dock",
        description: "Builds ships in open space and repairs ships on its hex quickly."
    },
    stargate: {
        name: "Stargate",
        description: "Ships on it can travel instantly to any other friendly Stargate."
    }
};

export function spaceStructureName(type: SpaceStructureType): string {
    return SPACE_STRUCTURE_INFO[type].name;
}

export function spaceStructureMaxTier(type: SpaceStructureType, balance: EconomyBalance): number {
    return 1 + balance.spaceStructures[type].tiers.length;
}

/** Balance of the upgrade reaching `tier` (2 or 3); undefined when there is none. */
export function spaceStructureTier(
    type: SpaceStructureType,
    tier: number,
    balance: EconomyBalance
): SpaceStructureTierBalance | undefined {
    return balance.spaceStructures[type].tiers[tier - 2];
}

export type SpaceStructureStats = {
    hp: number;
    attack: number;
    defence: number;
    fireRadius: number;
    visionRange: number;
};

/** Tier-scaled stats (hp, attack and defence rounded up by `structureTierOutput`). */
export function spaceStructureStats(
    type: SpaceStructureType,
    tier: number,
    balance: EconomyBalance
): SpaceStructureStats {
    const base = balance.spaceStructures[type];
    const index = Math.min(Math.max(tier, 1), 3) - 1;
    const scale = balance.structureTierOutput[index] ?? 1;
    return {
        hp: Math.ceil(base.hp * scale),
        attack: Math.ceil(base.attack * scale),
        defence: Math.ceil(base.defence * scale),
        fireRadius: base.fireRadius,
        visionRange: base.visionRange[index]!
    };
}

/** A completed structure (not a construction site). */
export function isActiveStructure(entity: SpaceStructureEntity): boolean {
    return !entity.constructing;
}

/** Entities that leave a hex open for a space structure: vessels only. */
function isVessel(entity: EntitySummary): boolean {
    return entity.kind === "ship" || entity.kind === "supply_ship";
}

/** Why a structure can't be placed on a hex holding `entities`; undefined when it can. */
export function spaceStructureSiteBlocked(entities: readonly EntitySummary[]): string | undefined {
    if (entities.some((e) => e.kind === "space_structure")) {
        return "There is already a structure here";
    }
    if (!entities.every(isVessel)) return "Structures can only be built in open space";
    return undefined;
}

export type CanConstructResult = { ok: true } | { ok: false; reason: string };

/** Whether `builder` may start a `type` construction site on its hex. */
export function canConstruct(
    builder: ShipEntity,
    type: SpaceStructureType,
    hexEntities: readonly EntitySummary[],
    techs: readonly TechId[],
    balance: EconomyBalance
): CanConstructResult {
    if (!balance.ships[builder.shipType].canConstruct) {
        return { ok: false, reason: "Only Builders can construct structures" };
    }
    if (builder.carriedBy) return { ok: false, reason: "Launch the Builder first" };
    const tech = balance.spaceStructures[type].requiresTech;
    if (tech && !techs.includes(tech)) {
        return { ok: false, reason: `Requires ${TECHS[tech].name}` };
    }
    const enemy = hexEntities.find(
        (e) => (e.kind === "ship" || e.kind === "supply_ship") && e.sideId !== builder.sideId
    );
    if (enemy) return { ok: false, reason: "Enemies are on this hex" };
    const blocked = spaceStructureSiteBlocked(hexEntities);
    return blocked ? { ok: false, reason: blocked } : { ok: true };
}

/** Completed friendly stargates among `entities`. */
export function friendlyGates(
    entities: readonly EntitySummary[],
    sideId: SideId
): SpaceStructureEntity[] {
    return entities.filter(
        (e): e is SpaceStructureEntity =>
            e.kind === "space_structure" &&
            e.structureType === "stargate" &&
            e.sideId === sideId &&
            !e.constructing
    );
}

/** Whether `ship` may enter the completed friendly `gate` on its hex. */
export function canEnterStargate(
    ship: ShipEntity,
    gate: SpaceStructureEntity | undefined
): CanConstructResult {
    if (!gate || gate.structureType !== "stargate" || gate.sideId !== ship.sideId) {
        return { ok: false, reason: "No friendly Stargate here" };
    }
    if (gate.constructing) return { ok: false, reason: "The Stargate isn't finished" };
    if (gate.q !== ship.q || gate.r !== ship.r) {
        return { ok: false, reason: "The ship must be on the Stargate's hex" };
    }
    if (ship.carriedBy) return { ok: false, reason: "Launch the ship first" };
    if (ship.hyperdriveCharging) {
        return { ok: false, reason: "Hyperdrive engaged: cancel the jump first" };
    }
    if (ship.movementPoints <= 0) return { ok: false, reason: "No movement points left" };
    return { ok: true };
}

/** Axial hex distance. */
export function hexDistance(a: AxialCoord, b: AxialCoord): number {
    return (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;
}
