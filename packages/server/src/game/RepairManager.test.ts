import {
    shipRepairPerTurn,
    shipStats,
    supplyShipStats,
    type AxialCoord,
    type ShipType,
    type SideId,
    type TechId
} from "@space/shared-data";
import { defaultEconomyBalance } from "../config/config.schema.js";
import { BattleManager } from "./Battle.js";
import { EconomyManager } from "./EconomyManager.js";
import { EntityManager } from "./EntityManager.js";
import { HyperspaceManager } from "./HyperspaceManager.js";
import { createEmptyMap } from "./map/SpaceMap.js";
import type { EntityOf } from "./map/types.js";
import { RepairManager } from "./RepairManager.js";
import { Side } from "./Side.js";
import { TurnManager } from "./TurnManager.js";

const DEFAULTS = defaultEconomyBalance();
const FRIGATE_HP = shipStats("frigate", 1, DEFAULTS).hp;
const TARGET = { q: 10, r: 10 };

function makeShip(
    id: string,
    sideId: SideId,
    at: AxialCoord,
    hp?: number,
    shipType: ShipType = "frigate"
): EntityOf<"ship"> {
    const stats = shipStats(shipType, 1, DEFAULTS);
    return {
        id,
        kind: "ship",
        shipType,
        sideId,
        q: at.q,
        r: at.r,
        facing: 0,
        movementPoints: stats.maxMovementPoints,
        maxMovementPoints: stats.maxMovementPoints,
        ...(hp !== undefined ? { hp } : {})
    };
}

function makeSupplyShip(id: string, sideId: SideId, at: AxialCoord, hp?: number) {
    const ship: EntityOf<"supply_ship"> = {
        id,
        kind: "supply_ship",
        sideId,
        q: at.q,
        r: at.r,
        facing: 0,
        originId: "home-a",
        destinationId: "home-a",
        cargo: { money: 10, materials: 0, population: 0, science: 0 },
        reservedFor: [],
        speed: 6,
        capacity: 100,
        ...(hp !== undefined ? { hp } : {})
    };
    return ship;
}

/** Returns the scripted values in order, then 0. */
function scripted(values: number[]): () => number {
    const queue = [...values];
    return () => queue.shift() ?? 0;
}

type WorldOptions = {
    jumpRng?: () => number;
    battleRng?: () => number;
    techs?: Partial<Record<SideId, TechId[]>>;
};

function world({ jumpRng = () => 0, battleRng = () => 0.5, techs = {} }: WorldOptions = {}) {
    const map = createEmptyMap({ width: 20, height: 20, hexSize: 50, seed: 1 });
    const entities = new EntityManager(map);
    const home = entities.add<EntityOf<"planet">>({
        id: "home-a",
        kind: "planet",
        sideId: "alpha",
        systemId: "sys-1",
        q: 2,
        r: 2,
        level: 10
    });
    const economy = new EconomyManager(entities, ["alpha", "beta"], { instantBuild: true });
    for (const [sideId, known] of Object.entries(techs)) {
        for (const tech of known ?? []) economy.research.add(sideId, tech);
    }
    const turns: { manager?: TurnManager } = {};
    const battles = new BattleManager(entities, economy, {
        rng: battleRng,
        turn: () => turns.manager!.combatTurn
    });
    const hyperspace = new HyperspaceManager(entities, { battles, economy, rng: jumpRng });
    const manager = new TurnManager(["alpha", "beta"], entities, economy, undefined, {
        hyperspace,
        repairs: new RepairManager(entities, economy)
    });
    turns.manager = manager;
    const endTurn = () => {
        manager.endTurn("alpha");
        return manager.endTurn("beta");
    };
    return { entities, economy, battles, hyperspace, turns: manager, endTurn, home };
}

const repaired = (hp: number, max: number, techs: TechId[] = [], context = {}) =>
    hp + shipRepairPerTurn(DEFAULTS, hp, max, techs, context);

describe("out-of-combat repair", () => {
    it("skips the end of the turn a ship fought, then repairs after a turn out of combat", () => {
        const { entities, battles, endTurn } = world();
        const attacker = entities.add(makeShip("ship-a", "alpha", { q: 5, r: 5 }));
        const defender = entities.add(makeShip("ship-b", "beta", { q: 6, r: 5 }));
        const result = battles.moveShip("alpha", attacker.id, { q: 6, r: 5 });
        expect(result.ok && result.combat?.outcome).toBe("inconclusive");
        expect(attacker.lastCombatTurn).toBe(1);
        expect(defender.lastCombatTurn).toBe(1);
        const attackerHp = attacker.hp!;
        const defenderHp = defender.hp!;
        expect(attackerHp).toBeLessThan(FRIGATE_HP);
        expect(defenderHp).toBeLessThan(FRIGATE_HP);

        expect(endTurn().repairs).toEqual([]);
        expect(attacker.hp).toBe(attackerHp);
        expect(defender.hp).toBe(defenderHp);

        const second = endTurn();
        expect(attacker.hp).toBe(repaired(attackerHp, FRIGATE_HP));
        expect(defender.hp).toBe(repaired(defenderHp, FRIGATE_HP));
        expect(second.repairs).toContainEqual({
            id: attacker.id,
            kind: "ship",
            sideId: "alpha",
            hpBefore: attackerHp,
            hpAfter: attacker.hp
        });
    });

    it("counts combat during an end of turn against the turn that is ending", () => {
        // Land on target, collide with ship-b1 (only it is destroyed), then attack ship-b2.
        const { entities, hyperspace, endTurn } = world({
            jumpRng: scripted([0, 0, 0, 0.99, 0.99])
        });
        const jumper = entities.add(makeShip("ship-a", "alpha", { q: 5, r: 5 }));
        entities.add(makeShip("ship-b1", "beta", TARGET));
        const defender = entities.add(makeShip("ship-b2", "beta", TARGET));
        expect(hyperspace.activate("alpha", jumper.id, TARGET).ok).toBe(true);

        const first = endTurn();
        expect(first.jumps?.[0]?.combat?.outcome).toBe("inconclusive");
        expect(jumper.lastCombatTurn).toBe(1);
        expect(defender.lastCombatTurn).toBe(1);
        const jumperHp = jumper.hp!;
        expect(jumperHp).toBeLessThan(FRIGATE_HP);
        expect(first.repairs).toEqual([]);

        endTurn();
        expect(jumper.hp).toBe(repaired(jumperHp, FRIGATE_HP));
    });

    it("caps repairs at max hp, clearing hp once full", () => {
        const { entities, endTurn } = world();
        const ship = entities.add(makeShip("ship-a", "alpha", { q: 5, r: 5 }, FRIGATE_HP - 1));
        const undamaged = entities.add(makeShip("ship-b", "beta", { q: 8, r: 8 }));
        const { repairs } = endTurn();
        expect(ship.hp).toBeUndefined();
        expect(undamaged.hp).toBeUndefined();
        expect(repairs).toEqual([
            {
                id: ship.id,
                kind: "ship",
                sideId: "alpha",
                hpBefore: FRIGATE_HP - 1,
                hpAfter: FRIGATE_HP
            }
        ]);
    });

    it("repairs faster with damage control techs", () => {
        const techs: TechId[] = ["damage_control_1", "damage_control_2"];
        const { entities, endTurn } = world({ techs: { alpha: techs } });
        const big = shipStats("star_destroyer", 1, DEFAULTS).hp;
        const fast = entities.add(makeShip("ship-a", "alpha", { q: 5, r: 5 }, 1, "star_destroyer"));
        const slow = entities.add(makeShip("ship-b", "beta", { q: 8, r: 8 }, 1, "star_destroyer"));
        endTurn();
        expect(fast.hp).toBe(repaired(1, big, techs));
        expect(slow.hp).toBe(repaired(1, big));
        expect(fast.hp! - 1).toBeGreaterThan(slow.hp! - 1);
    });

    it("adds the owned shipyard and carrier bonuses", () => {
        const { entities, economy, home, endTurn } = world();
        const build = economy.build("alpha", home.id, {
            kind: "structure",
            structureType: "shipyard"
        });
        expect(build.ok && build.completed).toBe(true);
        const big = shipStats("star_destroyer", 1, DEFAULTS).hp;
        const docked = entities.add(makeShip("ship-a", "alpha", home, 1, "star_destroyer"));
        const away = entities.add(
            makeShip("ship-a2", "alpha", { q: 8, r: 8 }, 1, "star_destroyer")
        );
        const carried = entities.add({
            ...makeShip("fighter-a", "alpha", { q: 8, r: 8 }, 1, "fighter_squadron"),
            carriedBy: away.id
        });
        endTurn();
        expect(docked.hp).toBe(repaired(1, big, [], { atOwnedShipyard: true }));
        expect(away.hp).toBe(repaired(1, big));
        expect(docked.hp).toBeGreaterThan(away.hp!);
        const fighterHp = shipStats("fighter_squadron", 1, DEFAULTS).hp;
        expect(carried.hp).toBe(repaired(1, fighterHp, [], { carried: true }));
    });

    it("repairs supply ships against their supply ship max hp", () => {
        const techs: TechId[] = ["armoured_freighters", "damage_control_2"];
        const { entities, endTurn } = world({ techs: { alpha: techs } });
        const max = supplyShipStats(DEFAULTS, techs).hp;
        const supply = entities.add(makeSupplyShip("supply-a", "alpha", { q: 5, r: 5 }, 1));
        endTurn();
        expect(supply.hp).toBe(repaired(1, max, techs));
        for (let i = 0; i < 20; i++) endTurn();
        expect(supply.hp).toBeUndefined();
    });

    it("blocks supply ship repairs for ambushes, even when evaded", () => {
        const { entities, battles, endTurn } = world({ battleRng: () => 0 });
        entities.add(makeShip("ship-b", "beta", { q: 6, r: 5 }));
        const supply = entities.add(makeSupplyShip("supply-a", "alpha", { q: 5, r: 5 }, 3));
        const combat = battles.ambush(supply, { q: 6, r: 5 });
        expect(combat?.participants.find((p) => p.id === supply.id)?.evaded).toBe(true);
        expect(supply).toMatchObject({ hp: 3, lastCombatTurn: 1 });
        endTurn();
        expect(supply.hp).toBe(3);
        endTurn();
        expect(supply.hp).toBe(repaired(3, supplyShipStats(DEFAULTS, []).hp));
    });

    it("doesn't let hyperspace hazard damage stop repairs", () => {
        const { entities, hyperspace, endTurn } = world({ jumpRng: scripted([0, 0, 0.99]) });
        entities.add({ id: "sun-1", kind: "sun", systemId: "sys-1", hazardLevel: 1, ...TARGET });
        const jumper = entities.add(makeShip("ship-a", "alpha", { q: 5, r: 5 }));
        hyperspace.activate("alpha", jumper.id, TARGET);
        const damaged = Math.max(
            1,
            FRIGATE_HP - Math.ceil(FRIGATE_HP * DEFAULTS.hyperspace.hazards.sun.damageFraction)
        );

        const result = endTurn();
        expect(result.jumps?.[0]?.outcome).toBe("damaged");
        expect(jumper.lastCombatTurn).toBeUndefined();
        expect(jumper.hp).toBe(repaired(damaged, FRIGATE_HP));
    });

    it("hides the last combat turn from other sides", () => {
        const ship = makeShip("ship-a", "alpha", { q: 5, r: 5 }, 3);
        ship.lastCombatTurn = 4;
        const supply = {
            ...makeSupplyShip("supply-a", "alpha", { q: 5, r: 5 }),
            lastCombatTurn: 4
        };
        expect(new Side("alpha").summarize(ship)).toMatchObject({ lastCombatTurn: 4 });
        expect(new Side("beta").summarize(ship)).not.toHaveProperty("lastCombatTurn");
        expect(new Side("alpha").summarize(supply)).toMatchObject({ lastCombatTurn: 4 });
        expect(new Side("beta").summarize(supply)).not.toHaveProperty("lastCombatTurn");
    });
});
