import { axialDistance, axialKey, createSeededRng } from "@space/maths";
import {
    HyperspaceHazardKind,
    type AxialCoord,
    type EconomyBalance,
    type EntityKind,
    type ShipType
} from "@space/shared-data";
import { defaultEconomyBalance } from "../config/config.schema.js";
import { BattleManager } from "./Battle.js";
import { EconomyManager } from "./EconomyManager.js";
import { EntityManager } from "./EntityManager.js";
import { GroundManager } from "./GroundManager.js";
import { HyperspaceManager } from "./HyperspaceManager.js";
import { createEmptyMap, findTileByAxial } from "./map/SpaceMap.js";
import type { Entity, EntityOf } from "./map/types.js";
import { MoveOrderManager } from "./MoveOrderManager.js";
import { Side } from "./Side.js";
import { TurnManager } from "./TurnManager.js";

const DEFAULTS = defaultEconomyBalance();

function makeShip(
    id: string,
    sideId: string,
    at: AxialCoord,
    shipType: ShipType = "frigate",
    hp?: number
): EntityOf<"ship"> {
    const mp = DEFAULTS.ships[shipType].maxMovementPoints;
    return {
        id,
        kind: "ship",
        shipType,
        sideId,
        q: at.q,
        r: at.r,
        facing: 0,
        movementPoints: mp,
        maxMovementPoints: mp,
        hp: hp ?? DEFAULTS.ships[shipType].hp
    };
}

/** Returns the scripted values in order, then 0. */
function scripted(values: number[]): () => number {
    const queue = [...values];
    return () => queue.shift() ?? 0;
}

function jumpWorld(rng: () => number = () => 0, balance?: EconomyBalance) {
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
    const economy = new EconomyManager(entities, ["alpha", "beta"], { balance });
    const battles = new BattleManager(entities, economy, { rng: () => 0.5 });
    const explored = new Set<string>();
    forEachHex(map.width, map.height, (hex) => explored.add(axialKey(hex.q, hex.r)));
    const hyperspace = new HyperspaceManager(entities, {
        battles,
        economy,
        rng,
        isExplored: (_sideId, hex) => explored.has(axialKey(hex.q, hex.r))
    });
    const ship = entities.add(makeShip("ship-a", "alpha", { q: 5, r: 5 }));
    return { map, entities, economy, battles, hyperspace, explored, ship, home };
}

function forEachHex(width: number, height: number, fn: (hex: AxialCoord) => void) {
    for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) fn({ q: col - (row - (row & 1)) / 2, r: row });
    }
}

function addHazard(entities: EntityManager, kind: EntityKind, at: AxialCoord): Entity {
    const base = { id: `${kind}-${at.q}-${at.r}`, q: at.q, r: at.r };
    switch (kind) {
        case "sun":
            return entities.add({ ...base, kind, systemId: "sys-1", hazardLevel: 1 });
        case "black_hole":
            return entities.add({ ...base, kind, hazardLevel: 1 });
        case "planet":
            return entities.add({ ...base, kind, sideId: null, systemId: "sys-1", level: 3 });
        case "moon":
        case "large_asteroid":
            return entities.add({ ...base, kind, sideId: null, systemId: "sys-1" });
        case "asteroid_belt":
            return entities.add({ ...base, kind, hazardLevel: 1 });
        default:
            throw new Error(`No hazard helper for ${kind}`);
    }
}

const TARGET = { q: 10, r: 10 };

describe("HyperspaceManager activation", () => {
    it("engages the hyperdrive, clearing any move order, and can be cancelled", () => {
        const { hyperspace, ship } = jumpWorld();
        ship.moveOrder = { destination: { q: 8, r: 5 } };
        expect(hyperspace.activate("alpha", ship.id, TARGET)).toEqual({ ok: true });
        expect(ship).toMatchObject({ hyperjump: { target: TARGET }, hyperdriveCharging: true });
        expect(ship.moveOrder).toBeUndefined();

        expect(hyperspace.cancel("beta", ship.id).ok).toBe(false);
        expect(hyperspace.cancel("alpha", ship.id)).toEqual({ ok: true });
        expect(ship.hyperjump).toBeUndefined();
        expect(ship.hyperdriveCharging).toBeUndefined();
        expect(hyperspace.cancel("alpha", ship.id).ok).toBe(false);
    });

    it("rejects ships without a hyperdrive, cooling down, foreign or aboard a carrier", () => {
        const { entities, hyperspace, ship } = jumpWorld();
        const scout = entities.add(makeShip("scout-a", "alpha", { q: 6, r: 6 }, "scout"));
        expect(hyperspace.activate("alpha", scout.id, TARGET)).toEqual({
            ok: false,
            error: `Ship ${scout.id} has no hyperdrive`
        });
        expect(hyperspace.activate("beta", ship.id, TARGET).ok).toBe(false);
        expect(hyperspace.activate(null, ship.id, TARGET).ok).toBe(false);
        expect(hyperspace.activate("alpha", ship.id, ship).ok).toBe(false);
        expect(hyperspace.activate("alpha", ship.id, { q: -40, r: 0 }).ok).toBe(false);

        ship.hyperdriveCooldown = 2;
        expect(hyperspace.activate("alpha", ship.id, TARGET).ok).toBe(false);
        delete ship.hyperdriveCooldown;

        ship.carriedBy = "carrier-a";
        expect(hyperspace.activate("alpha", ship.id, TARGET)).toEqual({
            ok: false,
            error: `Ship ${ship.id} is aboard a carrier`
        });
    });

    it("only targets explored hexes", () => {
        const { hyperspace, explored, ship } = jumpWorld();
        explored.delete(axialKey(TARGET.q, TARGET.r));
        expect(hyperspace.activate("alpha", ship.id, TARGET)).toEqual({
            ok: false,
            error: `Target ${TARGET.q},${TARGET.r} is unexplored`
        });
    });
});

describe("HyperspaceManager jumps", () => {
    it("lands on target, sets the cooldown and clears the jump", () => {
        const { entities, hyperspace, ship } = jumpWorld(scripted([0, 0]));
        hyperspace.activate("alpha", ship.id, TARGET);
        const [event] = hyperspace.resolve();
        expect(event).toMatchObject({
            shipId: ship.id,
            from: { q: 5, r: 5 },
            to: TARGET,
            outcome: "arrived",
            destroyedIds: [],
            combat: null
        });
        expect(event!.collidedWithId).toBeUndefined();
        expect(ship).toMatchObject({ ...TARGET, hyperdriveCooldown: 3 });
        expect(ship.hyperjump).toBeUndefined();
        expect(ship.hyperdriveCharging).toBeUndefined();
        expect(entities.entitiesAt(TARGET.q, TARGET.r)).toContain(ship);
        expect(hyperspace.resolve()).toEqual([]);
    });

    it("scatters onto the ring picked by the accuracy roll", () => {
        const { hyperspace, ship } = jumpWorld(scripted([0.5, 0, 0.9, 0.99]));
        hyperspace.activate("alpha", ship.id, TARGET);
        const [oneOff] = hyperspace.resolve();
        expect(axialDistance(oneOff!.to, TARGET)).toBe(1);

        delete ship.hyperdriveCooldown;
        hyperspace.activate("alpha", ship.id, TARGET);
        const [twoOff] = hyperspace.resolve();
        expect(axialDistance(twoOff!.to, TARGET)).toBe(2);
    });

    it("keeps scatter within the map with a seeded random number generator", () => {
        const { map, hyperspace, ship } = jumpWorld(createSeededRng(1234));
        const corners = [
            { q: 0, r: 0 },
            { q: 19, r: 0 },
            { q: -9, r: 19 },
            { q: 10, r: 19 }
        ];
        const rings = new Set<number>();
        for (let i = 0; i < 200; i++) {
            const target = corners[i % corners.length]!;
            delete ship.hyperdriveCooldown;
            expect(hyperspace.activate("alpha", ship.id, target).ok).toBe(true);
            const [event] = hyperspace.resolve();
            expect(findTileByAxial(map, event!.to.q, event!.to.r)).toBeDefined();
            const ring = axialDistance(event!.to, target);
            expect(ring).toBeLessThanOrEqual(2);
            rings.add(ring);
        }
        expect([...rings].sort()).toEqual([0, 1, 2]);
    });

    it("improves accuracy with ship tier and calibration techs", () => {
        const { economy, hyperspace, ship } = jumpWorld(scripted([0.35, 0]));
        // Untrained frigate: 20 / 50 / 30, so a 0.35 roll lands one hex off.
        ship.tier = 3;
        economy.research.add("alpha", "hyperdrive_calibration_1");
        // Tier 3 (+20) and Calibration I (+10): 50 / 50 / 0, so 0.35 is on target.
        hyperspace.activate("alpha", ship.id, TARGET);
        expect(hyperspace.resolve()[0]!.to).toEqual(TARGET);
    });

    it("destroys a ship landing in a sun on a low roll, releasing its crew", () => {
        const { entities, economy, hyperspace, ship } = jumpWorld(scripted([0, 0, 0.49]));
        addHazard(entities, "sun", TARGET);
        hyperspace.activate("alpha", ship.id, TARGET);
        const [event] = hyperspace.resolve();
        expect(event).toMatchObject({
            outcome: "destroyed",
            destroyedIds: [ship.id],
            lossSideIds: ["alpha"]
        });
        expect(entities.get(ship.id)).toBeUndefined();
        expect(economy.takeReleased()).toEqual([
            {
                sideId: "alpha",
                amount: DEFAULTS.ships.frigate.cost.population,
                homeId: undefined,
                from: TARGET
            }
        ]);
    });

    it("damages a ship that survives a hazard, never below 1 hp", () => {
        const { entities, hyperspace, ship } = jumpWorld(scripted([0, 0, 0.5, 0, 0, 0.95]));
        addHazard(entities, "planet", TARGET);
        hyperspace.activate("alpha", ship.id, TARGET);
        expect(hyperspace.resolve()[0]!.outcome).toBe("damaged");
        // 40% of 12 hp, rounded up.
        expect(ship.hp).toBe(12 - 5);

        const hole = { q: 3, r: 12 };
        addHazard(entities, "black_hole", hole);
        delete ship.hyperdriveCooldown;
        hyperspace.activate("alpha", ship.id, hole);
        expect(hyperspace.resolve()[0]!.outcome).toBe("damaged");
        expect(ship.hp).toBe(1);
    });

    it("destroys both ships on a low collision roll", () => {
        const { entities, hyperspace, ship } = jumpWorld(scripted([0, 0, 0, 0.1]));
        const other = entities.add(makeShip("ship-b", "beta", TARGET));
        hyperspace.activate("alpha", ship.id, TARGET);
        const [event] = hyperspace.resolve();
        expect(event).toMatchObject({
            outcome: "destroyed",
            collidedWithId: other.id,
            destroyedIds: [ship.id, other.id],
            lossSideIds: ["alpha", "beta"]
        });
        expect(entities.get(other.id)).toBeUndefined();
    });

    it("otherwise destroys one ship, the jumper weighted by the other ship's hp", () => {
        // Other hp 30 vs jumper 12: the jumper is lost below 30 / 42.
        const lost = jumpWorld(scripted([0, 0, 0, 0.5, 0.7]));
        const big = lost.entities.add(makeShip("sd-b", "beta", TARGET, "star_destroyer"));
        lost.hyperspace.activate("alpha", lost.ship.id, TARGET);
        expect(lost.hyperspace.resolve()[0]).toMatchObject({
            outcome: "destroyed",
            collidedWithId: big.id,
            destroyedIds: [lost.ship.id]
        });
        expect(lost.entities.get(big.id)).toBeDefined();

        const won = jumpWorld(scripted([0, 0, 0, 0.5, 0.72]));
        const target = won.entities.add(makeShip("sd-b", "beta", TARGET, "star_destroyer"));
        won.hyperspace.activate("alpha", won.ship.id, TARGET);
        expect(won.hyperspace.resolve()[0]).toMatchObject({
            outcome: "arrived",
            collidedWithId: target.id,
            destroyedIds: [target.id],
            combat: null
        });
        expect(won.ship).toMatchObject(TARGET);
    });

    it("collides later jumpers with earlier arrivals in the same end of turn", () => {
        // First: on target, no ships. Second: on target, hits the first, the first is lost.
        const { entities, hyperspace, ship } = jumpWorld(scripted([0, 0, 0, 0, 0, 0.5, 0.99]));
        const second = entities.add(makeShip("ship-a2", "alpha", { q: 7, r: 7 }));
        hyperspace.activate("alpha", ship.id, TARGET);
        hyperspace.activate("alpha", second.id, TARGET);
        const events = hyperspace.resolve();
        expect(events.map((e) => [e.shipId, e.outcome])).toEqual([
            [ship.id, "arrived"],
            [second.id, "arrived"]
        ]);
        expect(events[1]).toMatchObject({ collidedWithId: ship.id, destroyedIds: [ship.id] });
        expect(entities.get(ship.id)).toBeUndefined();
    });

    it("fights enemies left after the collision, displacing a jumper that doesn't clear the hex", () => {
        // Collision with the first enemy, which is destroyed; the second remains.
        const { entities, hyperspace, ship } = jumpWorld(scripted([0, 0, 0, 0.5, 0.99]));
        const first = entities.add(makeShip("ship-b1", "beta", TARGET));
        const second = entities.add(makeShip("ship-b2", "beta", TARGET));
        hyperspace.activate("alpha", ship.id, TARGET);
        const [event] = hyperspace.resolve();
        expect(event!.destroyedIds).toEqual([first.id]);
        expect(event!.combat).toMatchObject({
            kind: "space",
            cause: "hyperjump",
            hex: TARGET,
            from: { q: 5, r: 5 },
            attackerSideId: "alpha",
            defenderSideIds: ["beta"],
            outcome: "inconclusive",
            attackerMovedIn: false
        });
        // Frigates trade round(4 * 10 / 13) = 3 damage.
        expect([ship.hp, second.hp]).toEqual([9, 9]);
        expect(event!.displacedTo).toEqual(event!.combat!.displacedTo);
        expect(axialDistance(event!.displacedTo!, TARGET)).toBe(1);
        expect(ship).toMatchObject(event!.displacedTo!);
        expect(event!.to).toEqual(TARGET);
    });

    it("keeps a jumper that destroys the enemies on the hex where it landed", () => {
        // Collision with the first scout, which is destroyed; the second is fought.
        const { entities, hyperspace } = jumpWorld(scripted([0, 0, 0, 0.5, 0.99]));
        const sd = entities.add(makeShip("sd-a", "alpha", { q: 5, r: 8 }, "star_destroyer"));
        entities.add(makeShip("scout-b1", "beta", TARGET, "scout"));
        const second = entities.add(makeShip("scout-b2", "beta", TARGET, "scout"));
        hyperspace.activate("alpha", sd.id, TARGET);
        const [event] = hyperspace.resolve();
        expect(event!.combat).toMatchObject({
            outcome: "attacker_won",
            attackerMovedIn: true,
            destroyedIds: [second.id]
        });
        expect(event!.displacedTo).toBeUndefined();
        expect(sd).toMatchObject({ ...TARGET, hp: 29 });
    });

    it("loses a jumper destroyed in the fight after landing", () => {
        // Collision with the first star destroyer, which is destroyed; the second fights.
        const { entities, hyperspace, ship } = jumpWorld(scripted([0, 0, 0, 0.5, 0.99]));
        ship.hp = 2;
        entities.add(makeShip("sd-b1", "beta", TARGET, "star_destroyer"));
        const second = entities.add(makeShip("sd-b2", "beta", TARGET, "star_destroyer"));
        hyperspace.activate("alpha", ship.id, TARGET);
        const [event] = hyperspace.resolve();
        expect(event!.combat).toMatchObject({
            outcome: "attacker_destroyed",
            destroyedIds: [ship.id]
        });
        expect(entities.get(ship.id)).toBeUndefined();
        expect(second.hp).toBeLessThan(30);
    });
});

describe("HyperspaceManager accuracy and scatter", () => {
    it.each([
        // Untrained frigate: 20 / 50 / 30.
        { tier: 1, techs: [], roll: 0.25, ring: 1 },
        // Tier 2 (+10): 30 / 50 / 20.
        { tier: 2, techs: [], roll: 0.25, ring: 0 },
        { tier: 1, techs: [], roll: 0.9, ring: 2 },
        // Calibration I and II (+25): 45 / 50 / 5.
        {
            tier: 1,
            techs: ["hyperdrive_calibration_1", "hyperdrive_calibration_2"],
            roll: 0.9,
            ring: 1
        },
        {
            tier: 1,
            techs: ["hyperdrive_calibration_1", "hyperdrive_calibration_2"],
            roll: 0.44,
            ring: 0
        }
    ] as const)(
        "lands on ring $ring for roll $roll at tier $tier with $techs",
        ({ tier, techs, roll, ring }) => {
            const { economy, hyperspace, ship } = jumpWorld(scripted([roll, 0]));
            ship.tier = tier;
            for (const tech of techs) economy.research.add("alpha", tech);
            hyperspace.activate("alpha", ship.id, TARGET);
            expect(axialDistance(hyperspace.resolve()[0]!.to, TARGET)).toBe(ring);
        }
    );

    it("picks only in-bounds hexes on the scatter ring at the map's corner", () => {
        const corner = { q: 0, r: 0 };
        for (const pick of [0, 0.2, 0.4, 0.6, 0.8, 0.999]) {
            const { map, hyperspace, ship } = jumpWorld(scripted([0.99, pick]));
            hyperspace.activate("alpha", ship.id, corner);
            const [event] = hyperspace.resolve();
            expect(findTileByAxial(map, event!.to.q, event!.to.r)).toBeDefined();
            expect(axialDistance(event!.to, corner)).toBe(2);
        }
    });
});

describe("HyperspaceManager hazards", () => {
    it.each(HyperspaceHazardKind.options)(
        "destroys a ship landing on a %s below its chance, otherwise damages it",
        (kind) => {
            const { destroyChance, damageFraction } = DEFAULTS.hyperspace.hazards[kind];
            const lost = jumpWorld(scripted([0, 0, destroyChance - 0.001]));
            addHazard(lost.entities, kind, TARGET);
            lost.hyperspace.activate("alpha", lost.ship.id, TARGET);
            expect(lost.hyperspace.resolve()[0]).toMatchObject({
                outcome: "destroyed",
                destroyedIds: [lost.ship.id],
                lossSideIds: ["alpha"]
            });
            expect(lost.entities.get(lost.ship.id)).toBeUndefined();

            const hurt = jumpWorld(scripted([0, 0, destroyChance]));
            addHazard(hurt.entities, kind, TARGET);
            hurt.hyperspace.activate("alpha", hurt.ship.id, TARGET);
            expect(hurt.hyperspace.resolve()[0]).toMatchObject({
                outcome: "damaged",
                destroyedIds: [],
                lossSideIds: []
            });
            const hp = DEFAULTS.ships.frigate.hp;
            expect(hurt.ship).toMatchObject({
                ...TARGET,
                hp: Math.max(1, hp - Math.ceil(hp * damageFraction))
            });
        }
    );

    it("rolls each hazard on the hex, stopping at the first that destroys the ship", () => {
        const damaged = jumpWorld(scripted([0, 0, 0.99, 0.99]));
        addHazard(damaged.entities, "planet", TARGET);
        addHazard(damaged.entities, "moon", TARGET);
        damaged.hyperspace.activate("alpha", damaged.ship.id, TARGET);
        expect(damaged.hyperspace.resolve()[0]!.outcome).toBe("damaged");
        // Planet 40% and moon 35% of 12 hp, each rounded up.
        expect(damaged.ship.hp).toBe(12 - 5 - 5);

        const lost = jumpWorld(scripted([0, 0, 0.99, 0]));
        addHazard(lost.entities, "planet", TARGET);
        addHazard(lost.entities, "moon", TARGET);
        lost.hyperspace.activate("alpha", lost.ship.id, TARGET);
        expect(lost.hyperspace.resolve()[0]!.outcome).toBe("destroyed");
    });

    it("rolls a collision after surviving a hazard", () => {
        const { entities, hyperspace, ship } = jumpWorld(scripted([0, 0, 0.99, 0, 0.5, 0.99]));
        addHazard(entities, "planet", TARGET);
        const other = entities.add(makeShip("ship-b", "beta", TARGET, "scout"));
        hyperspace.activate("alpha", ship.id, TARGET);
        expect(hyperspace.resolve()[0]).toMatchObject({
            outcome: "damaged",
            collidedWithId: other.id,
            destroyedIds: [other.id],
            combat: null
        });
        expect(ship.hp).toBe(12 - 5);
    });
});

describe("HyperspaceManager collisions", () => {
    it("collides with the side's own ships too, without fighting them", () => {
        const { entities, hyperspace, ship } = jumpWorld(scripted([0, 0, 0, 0.5, 0.99]));
        const own = entities.add(makeShip("ship-a2", "alpha", TARGET));
        hyperspace.activate("alpha", ship.id, TARGET);
        expect(hyperspace.resolve()[0]).toMatchObject({
            outcome: "arrived",
            collidedWithId: own.id,
            destroyedIds: [own.id],
            lossSideIds: ["alpha"],
            combat: null
        });
    });

    it("picks the ship hit at random among those on the hex", () => {
        const { entities, hyperspace, ship } = jumpWorld(scripted([0, 0, 0.99, 0.5, 0.99]));
        entities.add(makeShip("ship-a2", "alpha", TARGET));
        entities.add(makeShip("ship-a3", "alpha", TARGET));
        const last = entities.add(makeShip("ship-a4", "alpha", TARGET));
        hyperspace.activate("alpha", ship.id, TARGET);
        expect(hyperspace.resolve()[0]!.collidedWithId).toBe(last.id);
    });

    it("lets later jumpers land safely where earlier ones were all destroyed", () => {
        const { entities, hyperspace, ship } = jumpWorld(
            // First on target; second on target, both destroyed; third on target, hex empty.
            scripted([0, 0, 0, 0, 0, 0.1, 0, 0])
        );
        const second = entities.add(makeShip("ship-b1", "beta", { q: 12, r: 12 }));
        const third = entities.add(makeShip("ship-b2", "beta", { q: 8, r: 14 }));
        for (const jumper of [ship, second, third]) {
            expect(hyperspace.activate(jumper.sideId, jumper.id, TARGET).ok).toBe(true);
        }
        const events = hyperspace.resolve();
        expect(events.map((e) => [e.shipId, e.outcome, e.collidedWithId])).toEqual([
            [ship.id, "arrived", undefined],
            [second.id, "destroyed", ship.id],
            [third.id, "arrived", undefined]
        ]);
        expect(events[1]!.destroyedIds).toEqual([second.id, ship.id]);
        expect(entities.entitiesAt(TARGET.q, TARGET.r)).toEqual([third]);
        expect(events[2]!.combat).toBeNull();
    });

    it("skips the jump of a ship destroyed by an earlier arrival", () => {
        const { entities, hyperspace, ship } = jumpWorld(scripted([0, 0, 0, 0.5, 0.99]));
        const victim = entities.add(makeShip("ship-b", "beta", TARGET));
        hyperspace.activate("alpha", ship.id, TARGET);
        hyperspace.activate("beta", victim.id, { q: 3, r: 15 });
        const events = hyperspace.resolve();
        expect(events).toHaveLength(1);
        expect(events[0]!.destroyedIds).toEqual([victim.id]);
        expect(entities.get(victim.id)).toBeUndefined();
    });

    it("destroys the units aboard a transport lost in a jump, releasing only its crew", () => {
        const balance = defaultEconomyBalance();
        balance.ships.transport.hyperdrive = DEFAULTS.ships.frigate.hyperdrive;
        const { entities, economy, hyperspace, home } = jumpWorld(scripted([0, 0, 0]), balance);
        addHazard(entities, "sun", TARGET);
        const transport = entities.add({
            ...makeShip("transport-a", "alpha", home, "transport"),
            carriedUnitIds: []
        });
        const ground = new GroundManager(entities, economy);
        const ids = [0, 1].map(
            () => economy.units.create("alpha", "infantry", home.id, home.id).id
        );
        expect(ground.load("alpha", transport.id, ids)).toEqual({ ok: true });

        hyperspace.activate("alpha", transport.id, TARGET);
        expect(hyperspace.resolve()[0]).toMatchObject({
            outcome: "destroyed",
            destroyedIds: [transport.id],
            destroyedUnitIds: ids
        });
        expect(ids.map((id) => economy.units.get(id))).toEqual([undefined, undefined]);
        expect(economy.stateFor("alpha").groundUnits).toEqual([]);
        expect(economy.takeReleased()).toEqual([
            {
                sideId: "alpha",
                amount: DEFAULTS.ships.transport.cost.population,
                homeId: undefined,
                from: TARGET
            }
        ]);
    });

    it("cancels upgrades on ships lost in a jump or collision, and on a jumper leaving", () => {
        const upgrade = (shipId: string) => ({
            kind: "enhancement" as const,
            target: { kind: "ship" as const, shipId, shipType: "frigate" as const },
            tier: 2
        });
        const orders = (world: ReturnType<typeof jumpWorld>) =>
            world.economy.locationEconomy(world.home.id)!.orders;
        const atHome = (world: ReturnType<typeof jumpWorld>) => {
            world.economy.research.add("alpha", "enhancement_tier_2");
            world.entities.move(world.ship.id, world.home);
            expect(world.economy.build("alpha", world.home.id, upgrade(world.ship.id)).ok).toBe(
                true
            );
            expect(orders(world)).toHaveLength(1);
        };

        const lost = jumpWorld(scripted([0, 0, 0]));
        atHome(lost);
        addHazard(lost.entities, "sun", TARGET);
        lost.hyperspace.activate("alpha", lost.ship.id, TARGET);
        expect(lost.hyperspace.resolve()[0]!.outcome).toBe("destroyed");
        expect(orders(lost)).toEqual([]);

        const left = jumpWorld(scripted([0, 0]));
        atHome(left);
        left.hyperspace.activate("alpha", left.ship.id, TARGET);
        expect(left.hyperspace.resolve()[0]!.outcome).toBe("arrived");
        expect(orders(left)).toEqual([]);

        // The upgrading ship stays home and is hit by an enemy jumper surviving the planet.
        const hit = jumpWorld(scripted([0, 0, 0.99, 0, 0.5, 0.99]));
        atHome(hit);
        const raider = hit.entities.add(makeShip("raider-b", "beta", { q: 12, r: 12 }));
        hit.hyperspace.activate("beta", raider.id, hit.home);
        expect(hit.hyperspace.resolve()[0]!.destroyedIds).toEqual([hit.ship.id]);
        expect(orders(hit)).toEqual([]);
    });
});

describe("HyperspaceManager arrivals beside friendly ships", () => {
    it("lands among the side's own surviving ships without fighting", () => {
        // Hits ship-a2, which alone is destroyed; ship-a3 remains.
        const { entities, hyperspace, ship } = jumpWorld(scripted([0, 0, 0, 0.99, 0.99]));
        entities.add(makeShip("ship-a2", "alpha", TARGET));
        const a3 = entities.add(makeShip("ship-a3", "alpha", TARGET));
        hyperspace.activate("alpha", ship.id, TARGET);
        const [event] = hyperspace.resolve();
        expect(event).toMatchObject({ outcome: "arrived", combat: null });
        expect(event!.displacedTo).toBeUndefined();
        expect(entities.entitiesAt(TARGET.q, TARGET.r)).toEqual([a3, ship]);
    });
});

describe("HyperspaceManager cooldowns", () => {
    it("sets the ship type's cooldown and ticks it away one turn at a time", () => {
        const { entities, hyperspace, ship } = jumpWorld(scripted([0, 0, 0, 0]));
        const destroyer = entities.add(makeShip("sd-a", "alpha", { q: 6, r: 8 }, "star_destroyer"));
        hyperspace.activate("alpha", ship.id, TARGET);
        hyperspace.activate("alpha", destroyer.id, { q: 12, r: 12 });
        hyperspace.resolve();
        expect([ship.hyperdriveCooldown, destroyer.hyperdriveCooldown]).toEqual([3, 4]);

        const scout = entities.add(makeShip("scout-a", "alpha", { q: 1, r: 8 }, "scout"));
        const cooldowns = () => [ship.hyperdriveCooldown, destroyer.hyperdriveCooldown];
        hyperspace.tickCooldowns();
        expect(cooldowns()).toEqual([2, 3]);
        hyperspace.tickCooldowns();
        hyperspace.tickCooldowns();
        expect(cooldowns()).toEqual([undefined, 1]);
        expect(ship).not.toHaveProperty("hyperdriveCooldown");
        expect(hyperspace.activate("alpha", destroyer.id, TARGET)).toEqual({
            ok: false,
            error: "Hyperdrive is cooling down for 1 more turn(s)"
        });
        hyperspace.tickCooldowns();
        expect(destroyer).not.toHaveProperty("hyperdriveCooldown");
        expect(scout).not.toHaveProperty("hyperdriveCooldown");
        expect(hyperspace.activate("alpha", destroyer.id, TARGET).ok).toBe(true);
    });
});

describe("hyperspace at end of turn", () => {
    it("ticks cooldowns down and resolves jumps before move orders", () => {
        const { entities, economy, hyperspace, ship } = jumpWorld(scripted([0, 0]));
        const orders = new MoveOrderManager(entities, { economy });
        const turns = new TurnManager(["alpha", "beta"], entities, economy, undefined, {
            hyperspace,
            moveOrders: orders
        });
        const endTurn = () => {
            turns.endTurn("alpha");
            return turns.endTurn("beta");
        };
        const mover = entities.add(makeShip("ship-a2", "alpha", { q: 2, r: 8 }));
        mover.moveOrder = { destination: { q: 8, r: 8 } };
        hyperspace.activate("alpha", ship.id, TARGET);

        const result = endTurn();
        expect(result.jumps?.map((j) => j.shipId)).toEqual([ship.id]);
        expect(result.orders?.moves.map((m) => m.ship.id)).toEqual([mover.id]);
        expect(ship.hyperdriveCooldown).toBe(3);

        endTurn();
        expect(ship.hyperdriveCooldown).toBe(2);
        expect(hyperspace.activate("alpha", ship.id, { q: 3, r: 3 }).ok).toBe(false);
        endTurn();
        endTurn();
        expect(ship.hyperdriveCooldown).toBeUndefined();
        expect(hyperspace.activate("alpha", ship.id, { q: 3, r: 3 }).ok).toBe(true);
    });
});

describe("Side ship redaction", () => {
    it("hides move orders, jump targets and cooldowns from other sides but shows charging", () => {
        const { entities, ship } = jumpWorld();
        ship.moveOrder = { destination: { q: 8, r: 5 }, route: [{ q: 6, r: 5 }] };
        ship.hyperjump = { target: TARGET };
        ship.hyperdriveCharging = true;
        ship.hyperdriveCooldown = 2;

        const own = new Side("alpha").summarize(ship);
        expect(own).toMatchObject({
            moveOrder: ship.moveOrder,
            hyperjump: { target: TARGET },
            hyperdriveCharging: true,
            hyperdriveCooldown: 2
        });

        const other = new Side("beta").summarize(ship);
        expect(other).toMatchObject({ id: ship.id, hyperdriveCharging: true });
        expect(other).not.toHaveProperty("moveOrder");
        expect(other).not.toHaveProperty("hyperjump");
        expect(other).not.toHaveProperty("hyperdriveCooldown");
        expect(ship.hyperjump).toEqual({ target: TARGET });
        expect(entities.get(ship.id)).toBe(ship);
    });
});
