import { z } from "zod";
import type { EconomyBalance, StructureType } from "./Economy.js";
import { GroundUnitType } from "./GroundUnitTypes.js";
import {
    AxialCoord,
    EnhancementTier,
    EntityId,
    ShipType,
    SideId,
    SpaceStructureType
} from "./PrimitiveTypes.js";
import { Resources } from "./Resources.js";
import type { TechId } from "./Tech.js";

/** Role of a ship type in combat (see `ShipBalance.attackMultipliers`). */
export const ShipClass = z.enum(["strike_craft", "capital", "support"]);
export type ShipClass = z.infer<typeof ShipClass>;

/** What an attack multiplier can single out: a ship class or an Orbital Platform. */
export const TargetClass = z.enum([...ShipClass.options, "orbital_platform"]);
export type TargetClass = z.infer<typeof TargetClass>;

/** Installations that defend their location; their combat stats come from `EconomyBalance.defences`. */
export const DefenceStructureType = z.enum([
    "defensive_battery",
    "shield_generator",
    "orbital_platform"
]);
export type DefenceStructureType = z.infer<typeof DefenceStructureType>;

export function isDefenceStructure(type: StructureType): type is DefenceStructureType {
    return (DefenceStructureType.options as readonly StructureType[]).includes(type);
}

/** Combat stats of defensive installations at tier 1, scaled up by `structureTierOutput`. */
export const DefencesBalance = z.object({
    /** Fires on bombarding ships and invading transports; never takes damage. */
    defensive_battery: z.object({
        attack: z.number().int().min(0),
        defence: z.number().int().min(0)
    }),
    /** A pool of hp that absorbs bombarding ships' shots (see `shieldRecharge`). */
    shield_generator: z.object({
        capacity: z.number().int().min(0),
        rechargePerTurn: z.number().int().min(0),
        /** Drawn each end of turn alongside the location's orders; not tier scaled. */
        upkeep: Resources
    }),
    /** Defends its hex like an enemy warship; damage persists and it repairs out of combat. */
    orbital_platform: z.object({
        attack: z.number().int().min(0),
        defence: z.number().int().min(0),
        hp: z.number().int().positive()
    })
});
export type DefencesBalance = z.infer<typeof DefencesBalance>;

/** Movement points a ship spends boarding a carrier's hangar; unloading is free. */
export const HANGAR_LOAD_COST = 1;

/** Movement points a ship spends for one orbital bombardment action. */
export const BOMBARD_COST = 1;

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
    groundMaxRounds: z.number().int().min(1),
    /**
     * Chance (0-1) each bombarding ship destroys one random installation after firing on the
     * garrison (independent rolls; see `GroundManager.bombard`).
     */
    bombardmentInstallationChance: z.number().min(0).max(1)
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

/**
 * Out-of-combat repair of ships and supply ships (see `shipRepairPerTurn`). Fractions are of
 * the vessel's max hp per end of turn and add together.
 */
export const RepairBalance = z.object({
    baseFraction: z.number().min(0).max(1),
    /** Least hp regained per turn by a damaged vessel that is repairing. */
    minPerTurn: z.number().int().min(0),
    /** Added per known tech. */
    techBonus: z.object({
        damage_control_1: z.number().min(0).max(1),
        damage_control_2: z.number().min(0).max(1)
    }),
    /** Added on the hex of a location its side owns with a Shipyard or Advanced Shipyard. */
    atOwnedShipyardBonus: z.number().min(0).max(1),
    /** Added while aboard a carrier's hangar. */
    carriedBonus: z.number().min(0).max(1)
});
export type RepairBalance = z.infer<typeof RepairBalance>;

/** Installations that give `RepairBalance.atOwnedShipyardBonus` at their location. */
export const REPAIR_YARD_STRUCTURES = [
    "shipyard",
    "advanced_shipyard"
] as const satisfies readonly StructureType[];

export type RepairContext = {
    /** On the hex of an owned location with a Shipyard or Advanced Shipyard. */
    atOwnedShipyard?: boolean;
    /** Aboard a carrier. */
    carried?: boolean;
    /** On the hex of an own completed space structure that docks ships (a Space Dock). */
    atSpaceDock?: boolean;
    /** Repair fraction added by own completed space structures on the hex (see `repairBonus`). */
    structureBonus?: number;
    /**
     * Repairs only aboard a carrier, at an owned shipyard or at a Space Dock (see
     * `ShipBalance.repairsInSpace`).
     */
    needsDock?: boolean;
};

/** Whether a vessel repairing in `context` regains hp at all (see `RepairContext.needsDock`). */
export function canRepairIn(context: RepairContext): boolean {
    return (
        !context.needsDock ||
        !!context.carried ||
        !!context.atOwnedShipyard ||
        !!context.atSpaceDock
    );
}

/**
 * Whether a vessel last in combat on `lastCombatTurn` repairs at the end of `endingTurn`: it
 * must have had no combat during that whole turn (combat during an end of turn counts against
 * the turn that is ending).
 */
export function repairsAtEndOf(lastCombatTurn: number | undefined, endingTurn: number): boolean {
    return lastCombatTurn === undefined || lastCombatTurn < endingTurn;
}

/**
 * Hp a vessel at `hp` of `maxHp` regains at an end of turn it is eligible to repair (see
 * `repairsAtEndOf`): `round(maxHp * fraction)`, at least `minPerTurn`, capped at the missing hp,
 * where `fraction` is `baseFraction` plus the known techs' and the context's bonuses. 0 when
 * undamaged, destroyed, or unable to repair where it is (see `canRepairIn`).
 */
export function shipRepairPerTurn(
    balance: EconomyBalance,
    hp: number,
    maxHp: number,
    techs: readonly TechId[],
    context: RepairContext = {}
): number {
    if (hp <= 0 || hp >= maxHp || !canRepairIn(context)) return 0;
    const repair = balance.repair;
    const bonuses = repair.techBonus as Partial<Record<TechId, number>>;
    let fraction = repair.baseFraction;
    for (const tech of techs) fraction += bonuses[tech] ?? 0;
    if (context.atOwnedShipyard) fraction += repair.atOwnedShipyardBonus;
    if (context.carried) fraction += repair.carriedBonus;
    fraction += context.structureBonus ?? 0;
    const amount = Math.max(repair.minPerTurn, Math.round(maxHp * fraction));
    return Math.min(amount, maxHp - hp);
}

/**
 * Hp an Orbital Platform at `hp` of `maxHp` regains at an end of turn it is eligible to repair
 * (see `repairsAtEndOf`): `round(maxHp * baseFraction)`, at least `minPerTurn`, capped at the
 * missing hp. 0 when undamaged or destroyed.
 */
export function installationRepairPerTurn(
    balance: EconomyBalance,
    hp: number,
    maxHp: number
): number {
    if (hp <= 0 || hp >= maxHp) return 0;
    const repair = balance.repair;
    const amount = Math.max(repair.minPerTurn, Math.round(maxHp * repair.baseFraction));
    return Math.min(amount, maxHp - hp);
}

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

/** Whether `shipType` can orbital-bombard enemy locations. */
export function canBombardShip(balance: EconomyBalance, shipType: ShipType): boolean {
    return balance.ships[shipType].canBombard;
}

/**
 * Damage multiplier of `shipType`'s attacks against a `target` class: its
 * `attackMultipliers` entry, else 1. Targets without a class (batteries, supply ships, ground
 * units) and attackers that aren't ships always get 1.
 */
export function attackMultiplier(
    balance: EconomyBalance,
    shipType: ShipType | undefined,
    target: TargetClass | undefined
): number {
    if (!shipType || !target) return 1;
    return balance.ships[shipType].attackMultipliers[target] ?? 1;
}

/** `value` scaled by the structure tier multiplier (see `structureTierOutput`), rounded up. */
function tierScaled(value: number, tier: number, balance: EconomyBalance): number {
    return Math.ceil(value * (balance.structureTierOutput[tier - 1] ?? 1));
}

/** Tier-scaled Defensive Battery attack and defence. */
export function batteryStats(
    tier: number,
    balance: EconomyBalance
): { attack: number; defence: number } {
    const base = balance.defences.defensive_battery;
    return {
        attack: tierScaled(base.attack, tier, balance),
        defence: tierScaled(base.defence, tier, balance)
    };
}

/** Tier-scaled Orbital Platform attack, defence and full hp. */
export function platformStats(
    tier: number,
    balance: EconomyBalance
): { attack: number; defence: number; hp: number } {
    const base = balance.defences.orbital_platform;
    return {
        attack: tierScaled(base.attack, tier, balance),
        defence: tierScaled(base.defence, tier, balance),
        hp: tierScaled(base.hp, tier, balance)
    };
}

/** Tier-scaled Shield Generator capacity and recharge, and its (unscaled) upkeep. */
export function shieldStats(
    tier: number,
    balance: EconomyBalance
): { capacity: number; rechargePerTurn: number; upkeep: Resources } {
    const base = balance.defences.shield_generator;
    return {
        capacity: tierScaled(base.capacity, tier, balance),
        rechargePerTurn: tierScaled(base.rechargePerTurn, tier, balance),
        upkeep: { ...base.upkeep }
    };
}

/**
 * Shield hp after an end of turn whose upkeep was `supplied` (0-1): the cap is
 * `capacity * supplied`; below it the shield gains `rechargePerTurn * supplied` up to the cap,
 * otherwise it drops to the cap (so an unsupplied shield falls to 0). Both are rounded down.
 */
export function shieldRecharge(
    hp: number,
    capacity: number,
    rechargePerTurn: number,
    supplied: number
): number {
    const cap = Math.floor(capacity * supplied);
    return hp < cap ? Math.min(cap, hp + Math.floor(rechargePerTurn * supplied)) : cap;
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
 * enemies; `invasion`: ground units landed on a location; `bombardment`: ships in orbit fired
 * on a location's garrison and installations; `ranged`: an armed space structure fired at
 * enemy ships within range at end of turn.
 */
export const CombatCause = z.enum([
    "move",
    "ambush",
    "hyperjump",
    "invasion",
    "bombardment",
    "ranged"
]);
export type CombatCause = z.infer<typeof CombatCause>;

export const CombatOutcome = z.enum(["attacker_won", "attacker_destroyed", "inconclusive"]);
export type CombatOutcome = z.infer<typeof CombatOutcome>;

export const CombatParticipant = z.object({
    /**
     * Entity id for ships, supply ships and space structures, unit id for ground units,
     * installation id for defensive installations.
     */
    id: EntityId,
    kind: z.enum(["ship", "supply_ship", "ground_unit", "installation", "space_structure"]),
    sideId: SideId,
    role: z.enum(["attacker", "defender"]),
    shipType: ShipType.optional(),
    unitType: GroundUnitType.optional(),
    structureType: DefenceStructureType.optional(),
    spaceStructureType: SpaceStructureType.optional(),
    tier: EnhancementTier.optional(),
    /** 0 for Defensive Batteries, which can't be damaged. */
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
    /**
     * Installations destroyed: by bombardment on the target location, or Orbital Platforms
     * destroyed in space combat.
     */
    destroyedInstallationIds: z.array(EntityId).optional(),
    /** Space structures destroyed in space combat. */
    destroyedStructureIds: z.array(EntityId).optional(),
    /** Bombardment of a location with a Shield Generator: shield hp before and after. */
    shieldBefore: z.number().min(0).optional(),
    shieldAfter: z.number().min(0).optional(),
    /** Hyperjump: where a jumper that didn't clear the hex was moved to. */
    displacedTo: AxialCoord.optional()
});
export type CombatResult = z.infer<typeof CombatResult>;
