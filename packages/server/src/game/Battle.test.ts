import { axialKey } from "@space/maths";
import { shipStats, type ShipType, type SideId, type TechId } from "@space/shared-data";
import { defaultEconomyBalance } from "../config/config.schema.js";
import { BattleManager } from "./Battle.js";
import { splitAttack, shipFighter } from "./combat.js";
import { EconomyManager } from "./EconomyManager.js";
import { EntityManager } from "./EntityManager.js";
import { createEmptyMap } from "./map/SpaceMap.js";
import type { EntityOf } from "./map/types.js";
import { Side } from "./Side.js";

const BALANCE = defaultEconomyBalance();

/** Rolls of 0.5 scale damage by exactly 1 (see `combatDamage`). */
const even = () => 0.5;

/** Replays `rolls` in order, then 0.5 forever. */
function rolls(...values: number[]): () => number {
    let i = 0;
    return () => (i < values.length ? values[i++]! : 0.5);
}

function ship(
    id: string,
    sideId: SideId,
    q: number,
    r: number,
    shipType: ShipType = "frigate",
    hp?: number
): EntityOf<"ship"> {
    const stats = shipStats(shipType, 1, BALANCE);
    return {
        id,
        kind: "ship",
        shipType,
        sideId,
        q,
        r,
        facing: 0,
        movementPoints: stats.maxMovementPoints,
        maxMovementPoints: stats.maxMovementPoints,
        hp: hp ?? stats.hp
    };
}

function supplyShip(id: string, sideId: SideId, q: number, r: number): EntityOf<"supply_ship"> {
    return {
        id,
        kind: "supply_ship",
        sideId,
        q,
        r,
        facing: 0,
        originId: "p1",
        destinationId: "p2",
        cargo: { money: 50, materials: 0, population: 0, science: 0 },
        reservedFor: [],
        speed: 6,
        capacity: 100
    };
}

function world(rng: () => number = even, techs: Partial<Record<SideId, TechId[]>> = {}) {
    const map = createEmptyMap({ width: 20, height: 20, hexSize: 50, seed: 1 });
    const entities = new EntityManager(map);
    const economy = new EconomyManager(entities, ["alpha", "beta"], { balance: BALANCE });
    for (const [sideId, known] of Object.entries(techs)) {
        for (const tech of known ?? []) economy.research.add(sideId, tech);
    }
    const battles = new BattleManager(entities, economy, { rng });
    return { entities, economy, battles };
}

function moved(result: ReturnType<BattleManager["moveShip"]>) {
    if (!result.ok) throw new Error(result.error);
    return result;
}

describe("BattleManager space combat", () => {
    it("lets an attacker that destroys every defender move into the hex, ending its movement", () => {
        const { entities, battles } = world();
        const attacker = entities.add(ship("sd", "alpha", 5, 5, "star_destroyer"));
        attacker.movementPoints = 3;
        const scout = entities.add(ship("scout", "beta", 7, 5, "scout"));

        const result = moved(battles.moveShip("alpha", attacker.id, { q: 9, r: 5 }));
        expect(result.move?.path).toEqual([{ q: 6, r: 5 }]);
        expect(result.moveOrder).toBeNull();
        expect(result.combat).toMatchObject({
            kind: "space",
            cause: "move",
            hex: { q: 7, r: 5 },
            from: { q: 6, r: 5 },
            attackerSideId: "alpha",
            defenderSideIds: ["beta"],
            outcome: "attacker_won",
            attackerMovedIn: true,
            destroyedIds: [scout.id],
            rounds: 1
        });
        // 8 attack vs defence 1: round(8 * 10 / 11) = 7 >= 6 hp; the scout hits back for 1.
        expect(result.combat?.participants).toEqual([
            expect.objectContaining({
                id: attacker.id,
                role: "attacker",
                hpBefore: 30,
                hpAfter: 29,
                damageDealt: 6,
                damageTaken: 1,
                destroyed: false
            }),
            expect.objectContaining({
                id: scout.id,
                role: "defender",
                shipType: "scout",
                hpBefore: 6,
                hpAfter: 0,
                damageTaken: 6,
                damageDealt: 1,
                evaded: false,
                destroyed: true
            })
        ]);
        expect(entities.get(scout.id)).toBeUndefined();
        expect(attacker).toMatchObject({ q: 7, r: 5, hp: 29, movementPoints: 0, facing: 0 });
        expect(attacker.moveOrder).toBeUndefined();
    });

    it("removes an attacker that is destroyed, leaving the defender damaged", () => {
        const { entities, battles } = world();
        const scout = entities.add(ship("scout", "alpha", 6, 5, "scout"));
        const sd = entities.add(ship("sd", "beta", 7, 5, "star_destroyer"));

        const result = moved(battles.moveShip("alpha", scout.id, { q: 7, r: 5 }));
        expect(result.move).toBeNull();
        expect(result.combat).toMatchObject({
            outcome: "attacker_destroyed",
            attackerMovedIn: false,
            destroyedIds: [scout.id],
            from: { q: 6, r: 5 }
        });
        expect(entities.get(scout.id)).toBeUndefined();
        expect(sd.hp).toBe(29);
    });

    it("keeps an inconclusive attacker in the hex it attacked from, with no movement left", () => {
        const { entities, battles } = world();
        const attacker = entities.add(ship("a", "alpha", 5, 5));
        const defender = entities.add(ship("b", "beta", 7, 5));

        const result = moved(battles.moveShip("alpha", attacker.id, { q: 10, r: 5 }));
        expect(result.combat).toMatchObject({ outcome: "inconclusive", attackerMovedIn: false });
        // Frigates: round(4 * 10 / 13) = 3 each way.
        expect(attacker).toMatchObject({ q: 6, r: 5, hp: 9, movementPoints: 0 });
        expect(defender).toMatchObject({ q: 7, r: 5, hp: 9 });
        expect(attacker.moveOrder).toBeUndefined();
        expect(entities.entitiesAt(7, 5).map((e) => e.id)).toEqual([defender.id]);
        expect(moved(battles.moveShip("alpha", attacker.id, { q: 7, r: 5 })).combat).toBeNull();
    });

    it("keeps damage between attacks, so a star destroyer falls to repeated attacks", () => {
        const { entities, battles } = world();
        const sd = entities.add(ship("sd", "beta", 7, 5, "star_destroyer", 8));
        const first = entities.add(ship("a1", "alpha", 6, 5, "star_destroyer"));
        const second = entities.add(ship("a2", "alpha", 8, 4, "star_destroyer"));

        // Star destroyers: round(8 * 10 / 18) = 4 each way.
        const one = moved(battles.moveShip("alpha", first.id, { q: 7, r: 5 }));
        expect(one.combat?.outcome).toBe("inconclusive");
        expect(sd.hp).toBe(4);
        expect(first).toMatchObject({ q: 6, r: 5, hp: 26 });

        const two = moved(battles.moveShip("alpha", second.id, { q: 7, r: 5 }));
        expect(two.combat).toMatchObject({ outcome: "attacker_won", destroyedIds: [sd.id] });
        expect(second).toMatchObject({ q: 7, r: 5, hp: 26 });
        expect(entities.get(sd.id)).toBeUndefined();
    });

    it("splits the attack across defenders, remainder to the strongest, and every defender fires back", () => {
        const { entities, battles } = world();
        const sd = entities.add(ship("sd", "alpha", 6, 5, "star_destroyer"));
        const frigate = entities.add(ship("f", "beta", 7, 5));
        const scout = entities.add(ship("s", "beta", 7, 5, "scout"));

        const result = moved(battles.moveShip("alpha", sd.id, { q: 7, r: 5 }));
        // 8 attack split 4 + 4: frigate round(4 * 10 / 13) = 3, scout round(4 * 10 / 11) = 4.
        expect(frigate.hp).toBe(9);
        expect(scout.hp).toBe(2);
        // Return fire: frigate round(4 * 10 / 18) = 2, scout round(1 * 10 / 18) = 1.
        expect(sd.hp).toBe(27);
        expect(result.combat?.outcome).toBe("inconclusive");

        const a = shipFighter(frigate, "defender", BALANCE);
        const b = shipFighter(scout, "defender", BALANCE);
        expect(splitAttack(5, [b, a])).toEqual([2, 3]);
        expect(splitAttack(1, [b, a])).toEqual([0, 1]);
        expect(splitAttack(0, [b, a])).toEqual([0, 0]);
    });

    it("never fights friendly ships", () => {
        const { entities, battles } = world();
        const a = entities.add(ship("a", "alpha", 5, 5));
        entities.add(ship("a2", "alpha", 6, 5));
        const result = moved(battles.moveShip("alpha", a.id, { q: 6, r: 5 }));
        expect(result.combat).toBeNull();
        expect(a).toMatchObject({ q: 6, r: 5 });
    });

    it("lets supply ships evade attacks, staying put; a hit one takes damage", () => {
        const evade = world(rolls(0.2));
        const a = evade.entities.add(ship("a", "alpha", 6, 5));
        const convoy = evade.entities.add(supplyShip("supply", "beta", 7, 5));
        const dodged = moved(evade.battles.moveShip("alpha", a.id, { q: 7, r: 5 }));
        expect(dodged.combat).toMatchObject({ outcome: "attacker_won", attackerMovedIn: true });
        expect(dodged.combat?.participants[1]).toMatchObject({
            id: convoy.id,
            kind: "supply_ship",
            evaded: true,
            damageTaken: 0,
            destroyed: false
        });
        expect(convoy.hp).toBeUndefined();
        expect(evade.entities.entitiesAt(7, 5).map((e) => e.id)).toEqual([convoy.id, a.id]);

        const hit = world(rolls(0.4));
        const b = hit.entities.add(ship("b", "alpha", 6, 5));
        const target = hit.entities.add(supplyShip("supply", "beta", 7, 5));
        const struck = moved(hit.battles.moveShip("alpha", b.id, { q: 7, r: 5 }));
        // round(4 * 10 / 11) = 4 of 6 hp.
        expect(struck.combat?.outcome).toBe("inconclusive");
        expect(target.hp).toBe(2);
        expect(b).toMatchObject({ q: 6, r: 5, hp: 12 });
    });

    it("raises supply ship evasion and armour with techs", () => {
        const evasive = world(rolls(0.4), { beta: ["evasive_manoeuvres_1"] });
        const a = evasive.entities.add(ship("a", "alpha", 6, 5));
        evasive.entities.add(supplyShip("supply", "beta", 7, 5));
        const result = moved(evasive.battles.moveShip("alpha", a.id, { q: 7, r: 5 }));
        expect(result.combat?.participants[1]).toMatchObject({ evaded: true, damageTaken: 0 });

        const armoured = world(rolls(0.9, 0.9), { beta: ["armoured_freighters"] });
        const b = armoured.entities.add(ship("b", "alpha", 6, 5));
        const target = armoured.entities.add(supplyShip("supply", "beta", 7, 5));
        moved(armoured.battles.moveShip("alpha", b.id, { q: 7, r: 5 }));
        // 12 hp, defence 3: round(4 * 1.2 * 10 / 13) = 4.
        expect(target.hp).toBe(8);
    });

    it("destroys ships carried aboard a destroyed carrier and reports them", () => {
        const { entities, battles } = world();
        const carrier = entities.add(ship("carrier", "beta", 7, 5, "star_destroyer", 3));
        const fighter = entities.add(ship("fighter", "beta", 7, 5, "fighter_squadron"));
        entities.stow(fighter.id);
        fighter.carriedBy = carrier.id;
        carrier.carriedShipIds = [fighter.id];
        const attacker = entities.add(ship("a", "alpha", 6, 5, "star_destroyer"));

        const result = moved(battles.moveShip("alpha", attacker.id, { q: 7, r: 5 }));
        expect(result.combat?.participants.map((p) => p.id)).toEqual([attacker.id, carrier.id]);
        expect(result.combat).toMatchObject({ outcome: "attacker_won" });
        expect(result.combat?.destroyedIds).toEqual([carrier.id, fighter.id]);
        expect(entities.get(fighter.id)).toBeUndefined();
    });

    it("lets the losing side forget the attacker's ships once out of sight", () => {
        const { entities, battles } = world();
        const scout = entities.add(ship("scout", "alpha", 6, 5, "scout"));
        const sd = entities.add(ship("sd", "beta", 7, 5, "star_destroyer"));
        const alpha = new Side("alpha");
        alpha.recomputeVisibility(entities, 1);
        const result = moved(battles.moveShip("alpha", scout.id, { q: 7, r: 5 }));
        const diff = alpha.recomputeVisibility(entities, 1);
        expect(diff.hidden).toContain(axialKey(7, 5));
        expect(alpha.forgetEntities(result.combat!.destroyedIds)).toEqual([scout.id]);
        expect(alpha.buildTileView(entities, axialKey(7, 5))?.entities.map((e) => e.id)).toEqual([
            sd.id
        ]);
    });
});

describe("BattleManager ambushes and arrivals", () => {
    it("has each armed enemy warship attack an ambushed supply ship, which may evade each attack", () => {
        const { entities, battles } = world(rolls(0.9, 0.5, 0.1));
        const convoy = entities.add(supplyShip("supply", "beta", 6, 5));
        const first = entities.add(ship("a1", "alpha", 7, 5));
        const second = entities.add(ship("a2", "alpha", 7, 5));
        entities.add(ship("t", "alpha", 7, 5, "transport"));

        const combat = battles.ambush(convoy, { q: 7, r: 5 });
        expect(combat).toMatchObject({
            cause: "ambush",
            hex: { q: 6, r: 5 },
            from: { q: 7, r: 5 },
            attackerSideId: "alpha",
            outcome: "inconclusive",
            attackerMovedIn: false,
            rounds: 2
        });
        expect(combat?.participants.map((p) => p.id)).toEqual([first.id, second.id, convoy.id]);
        expect(combat?.participants[2]).toMatchObject({ evaded: false, damageTaken: 4 });
        expect(convoy.hp).toBe(2);
    });

    it("displaces a jumper that doesn't clear the hex to the nearest safe hex", () => {
        const { entities, battles } = world();
        entities.add(ship("e1", "beta", 7, 5));
        entities.add(ship("e2", "beta", 8, 4));
        const jumper = entities.add(ship("j", "alpha", 7, 5));

        const combat = battles.arrival(jumper, { q: 2, r: 2 });
        expect(combat).toMatchObject({
            cause: "hyperjump",
            from: { q: 2, r: 2 },
            hex: { q: 7, r: 5 },
            outcome: "inconclusive",
            attackerMovedIn: false
        });
        expect(combat?.displacedTo).toBeDefined();
        expect(jumper).toMatchObject(combat!.displacedTo!);
        expect(jumper.q === 8 && jumper.r === 4).toBe(false);
        const there = entities.entitiesAt(jumper.q, jumper.r);
        expect(there.every((e) => e.kind !== "ship" || e.sideId === "alpha")).toBe(true);
    });

    it("leaves quiet arrivals alone and keeps a winning jumper on its hex", () => {
        const { entities, battles } = world();
        const quiet = entities.add(ship("q", "alpha", 3, 3));
        expect(battles.arrival(quiet, { q: 1, r: 1 })).toBeNull();
        entities.add(ship("e", "beta", 7, 5, "scout"));
        const jumper = entities.add(ship("j", "alpha", 7, 5, "star_destroyer"));
        expect(battles.arrival(jumper, { q: 1, r: 1 })).toMatchObject({
            outcome: "attacker_won",
            attackerMovedIn: true
        });
        expect(jumper).toMatchObject({ q: 7, r: 5 });
    });
});
