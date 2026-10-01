import {
    combatDamage,
    groundUnitStats,
    shipStats,
    supplyShipStats,
    type CombatBalance,
    type CombatParticipant,
    type EconomyBalance,
    type GroundUnit,
    type TechId
} from "@space/shared-data";
import type { EntityOf } from "./map/types.js";

/** Mutable combat state of one ship, supply ship or ground unit. */
export type Fighter = {
    id: string;
    kind: CombatParticipant["kind"];
    sideId: string;
    role: CombatParticipant["role"];
    shipType?: CombatParticipant["shipType"];
    unitType?: CombatParticipant["unitType"];
    tier?: number;
    attack: number;
    defence: number;
    /** Chance (0-1) of evading each attack. */
    evasion: number;
    maxHp: number;
    hpBefore: number;
    hp: number;
    dealt: number;
    taken: number;
    /** Attacks aimed at it, and how many of those it evaded. */
    attacked: number;
    evadedCount: number;
};

type FighterBase = Omit<
    Fighter,
    "hp" | "hpBefore" | "dealt" | "taken" | "attacked" | "evadedCount"
>;

function fighter(base: FighterBase, hp: number): Fighter {
    const current = Math.min(Math.max(0, hp), base.maxHp);
    return {
        ...base,
        hp: current,
        hpBefore: current,
        dealt: 0,
        taken: 0,
        attacked: 0,
        evadedCount: 0
    };
}

export function shipFighter(
    ship: EntityOf<"ship">,
    role: Fighter["role"],
    balance: EconomyBalance
): Fighter {
    const tier = ship.tier ?? 1;
    const stats = shipStats(ship.shipType, tier, balance);
    return fighter(
        {
            id: ship.id,
            kind: "ship",
            sideId: ship.sideId,
            role,
            shipType: ship.shipType,
            tier,
            attack: stats.attack,
            defence: stats.defence,
            evasion: 0,
            maxHp: stats.hp
        },
        ship.hp ?? stats.hp
    );
}

export function supplyFighter(
    ship: EntityOf<"supply_ship">,
    role: Fighter["role"],
    balance: EconomyBalance,
    techs: readonly TechId[]
): Fighter {
    const stats = supplyShipStats(balance, techs);
    return fighter(
        {
            id: ship.id,
            kind: "supply_ship",
            sideId: ship.sideId,
            role,
            attack: stats.attack,
            defence: stats.defence,
            evasion: stats.evasion,
            maxHp: stats.hp
        },
        ship.hp ?? stats.hp
    );
}

export function unitFighter(
    unit: GroundUnit,
    role: Fighter["role"],
    balance: EconomyBalance
): Fighter {
    const stats = groundUnitStats(unit.unitType, unit.tier, balance);
    return fighter(
        {
            id: unit.id,
            kind: "ground_unit",
            sideId: unit.sideId,
            role,
            unitType: unit.unitType,
            tier: unit.tier,
            attack: stats.attack,
            defence: stats.defence,
            evasion: 0,
            maxHp: stats.hp
        },
        unit.hp ?? stats.hp
    );
}

export function toParticipant(f: Fighter): CombatParticipant {
    return {
        id: f.id,
        kind: f.kind,
        sideId: f.sideId,
        role: f.role,
        ...(f.shipType ? { shipType: f.shipType } : {}),
        ...(f.unitType ? { unitType: f.unitType } : {}),
        ...(f.tier !== undefined ? { tier: f.tier } : {}),
        maxHp: f.maxHp,
        hpBefore: f.hpBefore,
        hpAfter: f.hp,
        damageDealt: f.dealt,
        damageTaken: f.taken,
        evaded: f.attacked > 0 && f.evadedCount === f.attacked,
        destroyed: f.hp <= 0
    };
}

export const isAlive = (f: Fighter) => f.hp > 0;

/** Strongest first: highest attack, then most hp; ties keep their order. */
function byStrength(fighters: readonly Fighter[]): Fighter[] {
    return [...fighters].sort((a, b) => b.attack - a.attack || b.hp - a.hp);
}

/**
 * Splits `attack` evenly across `targets` (in their order); the indivisible remainder goes one
 * point each to the strongest targets.
 */
export function splitAttack(attack: number, targets: readonly Fighter[]): number[] {
    if (targets.length === 0) return [];
    const base = Math.floor(attack / targets.length);
    const shares = targets.map(() => base);
    const remainder = attack - base * targets.length;
    for (const strong of byStrength(targets).slice(0, remainder)) {
        shares[targets.indexOf(strong)]! += 1;
    }
    return shares;
}

function hit(source: Fighter, target: Fighter, damage: number) {
    const actual = Math.min(damage, target.hp);
    target.hp -= actual;
    target.taken += actual;
    source.dealt += actual;
}

/**
 * One space exchange, applied simultaneously. Random numbers are drawn in this order: one
 * evasion roll per defender with evasion above 0 (in defender order); one damage roll per
 * defender that didn't evade and gets a share of the attacker's attack above 0 (see
 * `splitAttack`); then one return-fire roll per defender with attack above 0.
 */
export function spaceExchange(
    attacker: Fighter,
    defenders: readonly Fighter[],
    combat: CombatBalance,
    rng: () => number
): void {
    const evaded = defenders.map((d) => d.evasion > 0 && rng() < d.evasion);
    defenders.forEach((d, i) => {
        d.attacked += 1;
        if (evaded[i]) d.evadedCount += 1;
    });
    const targets = defenders.filter((_, i) => !evaded[i]);
    const shares = splitAttack(attacker.attack, targets);
    const outgoing = targets.map((t, i) =>
        shares[i]! > 0 ? combatDamage(shares[i]!, t.defence, combat, rng()) : 0
    );
    const incoming = defenders.map((d) =>
        d.attack > 0 ? combatDamage(d.attack, attacker.defence, combat, rng()) : 0
    );
    targets.forEach((t, i) => hit(attacker, t, outgoing[i]!));
    defenders.forEach((d, i) => hit(d, attacker, incoming[i]!));
}

/**
 * Ground rounds until one side is wiped out or `combat.groundMaxRounds` is reached. In each
 * round every surviving unit with attack above 0 hits one enemy, spreading round-robin over the
 * enemies alive at the start of the round (attackers roll first, then defenders, in order);
 * damage applies at the end of the round. Returns the rounds fought.
 */
export function groundRounds(
    attackers: readonly Fighter[],
    defenders: readonly Fighter[],
    combat: CombatBalance,
    rng: () => number
): number {
    let rounds = 0;
    while (rounds < combat.groundMaxRounds) {
        const a = attackers.filter(isAlive);
        const d = defenders.filter(isAlive);
        if (a.length === 0 || d.length === 0) break;
        const hits: [Fighter, Fighter, number][] = [];
        const volley = (from: Fighter[], to: Fighter[]) => {
            from.forEach((unit, i) => {
                if (unit.attack <= 0) return;
                const target = to[i % to.length]!;
                hits.push([unit, target, combatDamage(unit.attack, target.defence, combat, rng())]);
            });
        };
        volley(a, d);
        volley(d, a);
        for (const [source, target, damage] of hits) hit(source, target, damage);
        rounds += 1;
    }
    return rounds;
}
