import { z } from "zod";
import type { EconomyBalance } from "./Economy.js";
import { GroundUnitType } from "./GroundUnitTypes.js";
import { AxialCoord, EnhancementTier, EntityId, ShipType, SideId } from "./PrimitiveTypes.js";
import type { TechId } from "./Tech.js";

/** Movement points a ship spends boarding a carrier's hangar; unloading is free. */
export const HANGAR_LOAD_COST = 1;

/** Present on ship types that can carry other ships. */
export const HangarBalance = z.object({
    /** Ships it can carry at once. */
    capacity: z.number().int().min(0),
    /** Ship types it may carry. */
    carries: z.array(ShipType)
});
export type HangarBalance = z.infer<typeof HangarBalance>;

/** Damage formula settings shared by space and ground combat (see `combatDamage`). */
export const CombatBalance = z.object({
    /** Random spread (0-1): each hit is scaled by a roll in [1 - spread, 1 + spread). */
    spread: z.number().min(0).max(1),
    /** Least damage a hit with attack above 0 deals. */
    minDamage: z.number().int().min(0),
    /** Damage is scaled by `defenceScale / (defenceScale + target defence)`. */
    defenceScale: z.number().positive(),
    /** Ground combat rounds before an undecided invasion re-embarks. */
    groundMaxRounds: z.number().int().min(1)
});
export type CombatBalance = z.infer<typeof CombatBalance>;

export const SupplyShipTechBonus = z.object({
    hp: z.number().int().min(0),
    defence: z.number().int().min(0),
    evasion: z.number().min(0).max(1)
});
export type SupplyShipTechBonus = z.infer<typeof SupplyShipTechBonus>;

/** Supply ships never attack; they may evade each attack aimed at them. */
export const SupplyShipBalance = z.object({
    hp: z.number().int().positive(),
    defence: z.number().int().min(0),
    /** Chance (0-1) of evading each attack. */
    evasion: z.number().min(0).max(1),
    /** Evasion never goes above this, whatever the techs. */
    maxEvasion: z.number().min(0).max(1),
    /** Added per known tech. */
    techBonus: z.object({
        evasive_manoeuvres_1: SupplyShipTechBonus,
        evasive_manoeuvres_2: SupplyShipTechBonus,
        armoured_freighters: SupplyShipTechBonus
    })
});
export type SupplyShipBalance = z.infer<typeof SupplyShipBalance>;

export function hangarFor(balance: EconomyBalance, shipType: ShipType): HangarBalance | undefined {
    return balance.ships[shipType].hangar;
}

/** Whether a `carrierType` hangar takes `shipType`. */
export function canCarryShip(
    balance: EconomyBalance,
    carrierType: ShipType,
    shipType: ShipType
): boolean {
    const hangar = hangarFor(balance, carrierType);
    return !!hangar && hangar.capacity > 0 && hangar.carries.includes(shipType);
}

/** Supply ship hp, defence and evasion for a side knowing `techs`. */
export function supplyShipStats(
    balance: EconomyBalance,
    techs: readonly TechId[]
): { hp: number; defence: number; evasion: number; attack: number } {
    const base = balance.supplyShips;
    const bonuses = base.techBonus as Partial<Record<TechId, SupplyShipTechBonus>>;
    let { hp, defence, evasion } = base;
    for (const tech of techs) {
        const bonus = bonuses[tech];
        if (!bonus) continue;
        hp += bonus.hp;
        defence += bonus.defence;
        evasion += bonus.evasion;
    }
    return { hp, defence, evasion: Math.min(evasion, base.maxEvasion), attack: 0 };
}

/**
 * Damage one hit deals: `max(minDamage, round(attack * f * defenceScale / (defenceScale +
 * targetDefence)))` where `f = 1 - spread + 2 * spread * roll` for a `roll` in [0, 1).
 * Attack 0 deals nothing.
 */
export function combatDamage(
    attack: number,
    targetDefence: number,
    combat: CombatBalance,
    roll: number
): number {
    if (attack <= 0) return 0;
    const factor = 1 - combat.spread + 2 * combat.spread * roll;
    const scale = combat.defenceScale / (combat.defenceScale + Math.max(0, targetDefence));
    return Math.max(combat.minDamage, Math.round(attack * factor * scale));
}

export const CombatKind = z.enum(["space", "ground"]);
export type CombatKind = z.infer<typeof CombatKind>;

/**
 * `move`: a ship's manual move ran into enemies; `ambush`: a supply ship stepped towards
 * enemy warships it didn't know about and they attacked it; `hyperjump`: a ship landed among
 * enemies; `invasion`: ground units landed on a location.
 */
export const CombatCause = z.enum(["move", "ambush", "hyperjump", "invasion"]);
export type CombatCause = z.infer<typeof CombatCause>;

export const CombatOutcome = z.enum(["attacker_won", "attacker_destroyed", "inconclusive"]);
export type CombatOutcome = z.infer<typeof CombatOutcome>;

export const CombatParticipant = z.object({
    /** Entity id for ships and supply ships, unit id for ground units. */
    id: EntityId,
    kind: z.enum(["ship", "supply_ship", "ground_unit"]),
    sideId: SideId,
    role: z.enum(["attacker", "defender"]),
    shipType: ShipType.optional(),
    unitType: GroundUnitType.optional(),
    tier: EnhancementTier.optional(),
    maxHp: z.number().min(0),
    hpBefore: z.number().min(0),
    hpAfter: z.number().min(0),
    /** Hp actually removed from enemies by this participant. */
    damageDealt: z.number().min(0),
    damageTaken: z.number().min(0),
    /** Evaded every attack aimed at it (supply ships only). */
    evaded: z.boolean(),
    destroyed: z.boolean()
});
export type CombatParticipant = z.infer<typeof CombatParticipant>;

/** Outcome of one automatic combat (see `server:combat`). */
export const CombatResult = z.object({
    kind: CombatKind,
    cause: CombatCause,
    /** Hex attacked (where the defenders are). */
    hex: AxialCoord,
    /**
     * Where the attack came from: the aggressor's hex for moves and ambushes, the jump
     * origin for hyperjumps, the location hex for invasions.
     */
    from: AxialCoord,
    attackerSideId: SideId,
    defenderSideIds: z.array(SideId),
    participants: z.array(CombatParticipant),
    /** Ships and supply ships destroyed, including ships lost aboard destroyed carriers. */
    destroyedIds: z.array(EntityId),
    /** Ground units lost: killed in ground combat or aboard destroyed transports. */
    destroyedUnitIds: z.array(EntityId),
    outcome: CombatOutcome,
    /**
     * The aggressor holds `hex` afterwards: a mover advanced into it (a `server:ship:moved` for
     * that step follows), a jumper stayed, or invaders landed and captured the location. Always
     * false for ambushes.
     */
    attackerMovedIn: z.boolean(),
    /** Exchanges fought: 1 for space combat (one per aggressor in an ambush), up to `groundMaxRounds`. */
    rounds: z.number().int().min(0),
    /** Ground combat: the invaded location and whether the attacker captured it. */
    locationId: EntityId.optional(),
    captured: z.boolean().optional(),
    /** Hyperjump: where a jumper that didn't clear the hex was moved to. */
    displacedTo: AxialCoord.optional()
});
export type CombatResult = z.infer<typeof CombatResult>;
