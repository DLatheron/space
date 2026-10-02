import {
    zeroResources,
    type Resources,
    type ShipType,
    type StructureType
} from "@space/shared-data";
import { defaultEconomyBalance } from "../config/config.schema.js";
import { destroyVessels } from "./destroyShips.js";
import { EconomyManager } from "./EconomyManager.js";
import { EntityManager } from "./EntityManager.js";
import { GroundManager } from "./GroundManager.js";
import { createEmptyMap } from "./map/SpaceMap.js";
import type { EntityOf } from "./map/types.js";
import { SupplyManager } from "./SupplyManager.js";

const DEFAULTS = defaultEconomyBalance();
const res = (partial: Partial<Resources>): Resources => ({ ...zeroResources(), ...partial });

function makeShip(
    entities: EntityManager,
    id: string,
    sideId: string,
    q: number,
    r: number,
    shipType: ShipType = "transport"
): EntityOf<"ship"> {
    return entities.add<EntityOf<"ship">>({
        id,
        kind: "ship",
        shipType,
        sideId,
        q,
        r,
        facing: 0,
        movementPoints: DEFAULTS.ships[shipType].maxMovementPoints,
        maxMovementPoints: DEFAULTS.ships[shipType].maxMovementPoints,
        ...(shipType === "transport" ? { carriedUnitIds: [] } : {})
    });
}

function groundWorld(rng: () => number = () => 0.5) {
    const map = createEmptyMap({ width: 20, height: 20, hexSize: 50, seed: 1 });
    const entities = new EntityManager(map);
    const planet = (id: string, sideId: string, q: number, r: number) =>
        entities.add<EntityOf<"planet">>({
            id,
            kind: "planet",
            sideId,
            systemId: "sys-1",
            q,
            r,
            level: 5
        });
    const home = planet("home-a", "alpha", 5, 5);
    const target = planet("target-b", "beta", 10, 5);
    const betaHome = planet("home-b", "beta", 8, 14);
    const economy = new EconomyManager(entities, ["alpha", "beta"]);
    const ground = new GroundManager(entities, economy, { rng });
    const supply = new SupplyManager(entities, economy);
    const transport = makeShip(entities, "transport-a", "alpha", home.q, home.r);
    const infantry = (sideId: string, locationId: string) =>
        economy.units.create(sideId, "infantry", locationId, locationId);
    const unitsAt = (sideId: string) =>
        economy.stateFor(sideId).groundUnits.map((u) => [u.id, u.location]);
    return {
        entities,
        economy,
        ground,
        supply,
        home,
        target,
        betaHome,
        transport,
        infantry,
        unitsAt
    };
}

/** Build `count` of a structure for beta at the target, one after another. */
function install(world: ReturnType<typeof groundWorld>, structureType: StructureType, count = 1) {
    const { economy, target } = world;
    economy.research.add("beta", "planetary_shields");
    for (let i = 0; i < count; i++) {
        economy.depositUncapped(
            target.id,
            res({ money: 1000, materials: 1000, population: 100, science: 100 })
        );
        expect(economy.build("beta", target.id, { kind: "structure", structureType }).ok).toBe(
            true
        );
        for (let turn = 0; turn < DEFAULTS.structures[structureType].buildTurns; turn++) {
            economy.fund();
        }
        economy.completeReady();
    }
    return economy.installationsAt(target.id).filter((i) => i.type === structureType);
}

/** Load `count` alpha infantry at home onto the transport and fly it to the target. */
function embark(world: ReturnType<typeof groundWorld>, count: number) {
    const { entities, ground, home, target, transport, infantry } = world;
    const ids = Array.from({ length: count }, () => infantry("alpha", home.id).id);
    expect(ground.load("alpha", transport.id, ids)).toEqual({ ok: true });
    entities.move(transport.id, target);
    return ids;
}

describe("GroundManager transports", () => {
    it("loads garrisoned units up to the transport's capacity and unloads them", () => {
        const { ground, home, transport, infantry, unitsAt } = groundWorld();
        const ids = Array.from({ length: 5 }, () => infantry("alpha", home.id).id);
        expect(DEFAULTS.ships.transport.unitCapacity).toBe(4);
        expect(ground.load("alpha", transport.id, ids)).toEqual({
            ok: false,
            error: "Not enough room aboard"
        });

        expect(ground.load("alpha", transport.id, ids.slice(0, 4))).toEqual({ ok: true });
        expect(transport.carriedUnitIds).toEqual(ids.slice(0, 4));
        expect(home.garrison).toEqual([ids[4]]);
        expect(unitsAt("alpha")).toEqual([
            ...ids.slice(0, 4).map((id) => [id, { kind: "transport", shipId: transport.id }]),
            [ids[4], { kind: "garrison", locationId: home.id }]
        ]);
        expect(ground.load("alpha", transport.id, [ids[4]])).toEqual({
            ok: false,
            error: "Not enough room aboard"
        });

        expect(ground.unload("alpha", transport.id, home.id, ids.slice(0, 2))).toEqual({
            ok: true
        });
        expect(transport.carriedUnitIds).toEqual(ids.slice(2, 4));
        expect(home.garrison).toEqual([ids[4], ids[0], ids[1]]);
        expect(ground.unload("alpha", transport.id, home.id, [ids[4]])).toEqual({
            ok: false,
            error: `Unit ${ids[4]} is not aboard`
        });
    });

    it("rejects loads and unloads away from the transport, at foreign locations or on warships", () => {
        const { entities, ground, home, target, transport, infantry } = groundWorld();
        const unit = infantry("alpha", home.id);
        const enemy = infantry("beta", target.id);
        const frigate = makeShip(entities, "frigate-a", "alpha", home.q, home.r, "frigate");

        expect(ground.load("alpha", frigate.id, [unit.id])).toEqual({
            ok: false,
            error: "Frigate cannot carry units"
        });
        expect(ground.load("beta", transport.id, [enemy.id]).ok).toBe(false);
        expect(ground.load("alpha", transport.id, [enemy.id]).ok).toBe(false);
        entities.move(transport.id, { q: 7, r: 5 });
        expect(ground.load("alpha", transport.id, [unit.id])).toEqual({
            ok: false,
            error: `Unit ${unit.id} is not at the transport`
        });
        entities.move(transport.id, home);
        ground.load("alpha", transport.id, [unit.id]);
        entities.move(transport.id, target);
        expect(ground.unload("alpha", transport.id, target.id, [unit.id])).toEqual({
            ok: false,
            error: `Location ${target.id} is not yours`
        });
        expect(ground.unload("alpha", transport.id, home.id, [unit.id])).toEqual({
            ok: false,
            error: "Transport is not at the location"
        });
    });

    it("cancels a unit's upgrade when it boards a transport", () => {
        const { economy, ground, home, transport, infantry } = groundWorld();
        economy.research.add("alpha", "enhancement_tier_2");
        economy.deposit(home.id, res({ money: 100, materials: 100 }));
        const unit = infantry("alpha", home.id);
        const upgrade = economy.build("alpha", home.id, {
            kind: "enhancement",
            target: { kind: "groundUnit", unitId: unit.id, unitType: "infantry" },
            tier: 2
        });
        expect(upgrade.ok).toBe(true);
        economy.fund();
        const applied = economy.locationEconomy(home.id)!.orders[0].applied;
        expect(applied).toEqual(res({ money: 13, materials: 8 }));
        const stock = economy.stockpile(home.id);

        expect(ground.load("alpha", transport.id, [unit.id])).toEqual({ ok: true });
        expect(economy.locationEconomy(home.id)!.orders).toEqual([]);
        expect(economy.stockpile(home.id)).toEqual({
            ...stock,
            money: stock.money + 13,
            materials: stock.materials + 8
        });
        expect(unit.tier).toBe(1);
    });

    it("destroys the units aboard a transport that is destroyed, returning only its crew", () => {
        const { entities, economy, ground, home, transport, infantry, unitsAt } = groundWorld();
        const ids = [infantry("alpha", home.id).id, infantry("alpha", home.id).id];
        ground.load("alpha", transport.id, ids);
        entities.move(transport.id, { q: 7, r: 5 });

        expect(destroyVessels(entities, economy, [transport])).toMatchObject({
            destroyedShipIds: [transport.id],
            destroyedUnitIds: ids
        });
        expect(ids.map((id) => economy.units.get(id))).toEqual([undefined, undefined]);
        expect(unitsAt("alpha")).toEqual([]);
        expect(economy.takeReleased()).toEqual([
            {
                sideId: "alpha",
                amount: DEFAULTS.ships.transport.cost.population,
                // Added after the economy was set up, so no recorded crew origin.
                homeId: undefined,
                from: { q: 7, r: 5 }
            }
        ]);
    });
});

describe("GroundManager invasion", () => {
    it("captures an undefended location at once, handing over its stockpile", () => {
        const world = groundWorld();
        const { entities, economy, ground, target, transport } = world;
        economy.deposit(target.id, res({ money: 500, materials: 500, population: 50 }));
        economy.build("beta", target.id, { kind: "structure", structureType: "mine" });
        economy.fund();
        economy.fund();
        economy.completeReady();
        const habitat = economy.build("beta", target.id, {
            kind: "structure",
            structureType: "habitat"
        });
        economy.fund();
        const inbound = entities.add<EntityOf<"supply_ship">>({
            id: "supply-b",
            kind: "supply_ship",
            name: "Supply B",
            sideId: "beta",
            q: 12,
            r: 5,
            facing: 0,
            originId: "home-b",
            destinationId: target.id,
            cargo: res({ money: 30 }),
            reservedFor: [
                { orderId: habitat.ok ? habitat.order.id : "", amount: res({ money: 30 }) }
            ],
            speed: 6,
            capacity: 100
        });
        const stockBefore = economy.stockpile(target.id);
        const ids = embark(world, 2);

        const result = ground.invade("alpha", target.id, [transport.id]);
        expect(result).toMatchObject({
            ok: true,
            defenderSideId: "beta",
            combat: {
                kind: "ground",
                cause: "invasion",
                hex: { q: target.q, r: target.r },
                from: { q: target.q, r: target.r },
                attackerSideId: "alpha",
                defenderSideIds: ["beta"],
                destroyedIds: [],
                destroyedUnitIds: [],
                outcome: "attacker_won",
                attackerMovedIn: true,
                rounds: 0,
                locationId: target.id,
                captured: true
            },
            landedUnitIds: ids
        });
        expect(target.sideId).toBe("alpha");
        expect(target.garrison).toEqual(ids);
        expect(transport.carriedUnitIds).toEqual([]);
        // The half-funded habitat is cancelled and refunded into the stockpile, which passes over.
        const captured = economy.locationEconomy(target.id)!;
        expect(captured.orders).toEqual([]);
        expect(captured.stockpile).toEqual({
            ...stockBefore,
            money: stockBefore.money + 25,
            materials: stockBefore.materials + 50
        });
        expect(captured.installations).toMatchObject([{ type: "mine", populationFrom: target.id }]);
        expect(inbound.reservedFor).toEqual([]);
        expect(economy.stateFor("alpha").locations.map((l) => l.locationId)).toContain(target.id);
        expect(economy.stateFor("beta").locations.map((l) => l.locationId)).toEqual(["home-b"]);
    });

    it("rejects invasions that aren't possible", () => {
        const world = groundWorld();
        const { entities, ground, home, target, transport } = world;
        expect(ground.invade("alpha", target.id, [transport.id])).toEqual({
            ok: false,
            error: "Transport transport-a is not at the location"
        });
        entities.move(transport.id, target);
        expect(ground.invade("alpha", target.id, [transport.id])).toEqual({
            ok: false,
            error: "No units aboard"
        });
        expect(ground.invade("alpha", home.id, [transport.id])).toEqual({
            ok: false,
            error: "Location is already yours"
        });
        entities.move(transport.id, home);
        embark(world, 1);
        const guard = makeShip(entities, "guard", "beta", target.q, target.r, "frigate");
        expect(ground.invade("alpha", target.id, [transport.id])).toEqual({
            ok: false,
            error: "Enemy ships are defending the location"
        });
        entities.remove(guard.id);
        target.sideId = null;
        expect(ground.invade("alpha", target.id, [transport.id])).toEqual({
            ok: false,
            error: "Unowned locations are colonised"
        });
    });

    it("fights a garrison at once; wiping it out captures the location", () => {
        const world = groundWorld();
        const { economy, ground, supply, target, betaHome, transport, infantry } = world;
        const defender = infantry("beta", target.id);
        const ids = embark(world, 2);

        // Infantry deal round(2 * 10 / 13) = 2: the defender falls in round 3, having hit the
        // first invader three times.
        const result = ground.invade("alpha", target.id, [transport.id]);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.combat).toMatchObject({
            kind: "ground",
            outcome: "attacker_won",
            attackerMovedIn: true,
            captured: true,
            rounds: 3,
            destroyedUnitIds: [defender.id]
        });
        expect(result.combat.participants).toEqual([
            expect.objectContaining({
                id: ids[0],
                kind: "ground_unit",
                role: "attacker",
                maxHp: 10,
                hpBefore: 10,
                hpAfter: 4,
                damageDealt: 6,
                damageTaken: 6
            }),
            expect.objectContaining({ id: ids[1], role: "attacker", hpAfter: 10, damageDealt: 4 }),
            expect.objectContaining({
                id: defender.id,
                role: "defender",
                unitType: "infantry",
                tier: 1,
                hpAfter: 0,
                destroyed: true
            })
        ]);
        expect(result.landedUnitIds).toEqual(ids);
        expect(target.sideId).toBe("alpha");
        expect(target.garrison).toEqual(ids);
        expect(transport.carriedUnitIds).toEqual([]);
        expect(economy.units.get(ids[0])?.hp).toBe(4);
        expect(economy.units.get(ids[1])?.hp).toBeUndefined();
        expect(economy.units.get(defender.id)).toBeUndefined();

        // The defender's home was lost, so its population goes to beta's nearest location.
        const before = economy.stockpile(betaHome.id).population;
        expect(supply.returnPopulation()).toEqual([]);
        expect(economy.stockpile(betaHome.id).population).toBe(
            before + DEFAULTS.groundUnits.infantry.cost.population
        );
    });

    it("destroys invaders that are wiped out, leaving the garrison damaged", () => {
        const world = groundWorld();
        const { economy, ground, supply, home, target, transport } = world;
        const defender = economy.units.create("beta", "armour", target.id, target.id);
        const ids = embark(world, 1);

        // Armour deals round(5 * 10 / 13) = 4 and takes round(2 * 10 / 14) = 1 a round.
        const result = ground.invade("alpha", target.id, [transport.id]);
        expect(result.ok && result.combat).toMatchObject({
            outcome: "attacker_destroyed",
            attackerMovedIn: false,
            captured: false,
            rounds: 3,
            destroyedUnitIds: ids
        });
        expect(target.sideId).toBe("beta");
        expect(target.garrison).toEqual([defender.id]);
        expect(defender.hp).toBe(13);
        expect(transport.carriedUnitIds).toEqual([]);
        expect(economy.stateFor("alpha").groundUnits).toEqual([]);

        const before = economy.stockpile(home.id).population;
        supply.returnPopulation();
        expect(economy.stockpile(home.id).population).toBe(
            before + DEFAULTS.groundUnits.infantry.cost.population
        );
    });

    it("re-embarks undecided invaders after the last round, keeping their damage", () => {
        // Low rolls: infantry deal round(2 * 0.75 * 10 / 13) = 1 a round, so six rounds decide nothing.
        const world = groundWorld(() => 0);
        const { economy, ground, target, transport, infantry } = world;
        const defender = infantry("beta", target.id);
        const ids = embark(world, 1);

        const first = ground.invade("alpha", target.id, [transport.id]);
        expect(first.ok && first.combat).toMatchObject({
            outcome: "inconclusive",
            attackerMovedIn: false,
            captured: false,
            rounds: DEFAULTS.combat.groundMaxRounds,
            destroyedUnitIds: []
        });
        expect(first.ok && first.landedUnitIds).toEqual([]);
        expect(target.sideId).toBe("beta");
        expect(transport.carriedUnitIds).toEqual(ids);
        expect(economy.units.get(ids[0])).toMatchObject({
            hp: 4,
            location: { kind: "transport", shipId: transport.id }
        });
        expect(defender.hp).toBe(4);

        const second = ground.invade("alpha", target.id, [transport.id]);
        expect(second.ok && second.combat.participants.map((p) => p.hpBefore)).toEqual([4, 4]);
    });

    it("has Defensive Batteries fire on the transports first; units aboard sunk ones never land", () => {
        const world = groundWorld();
        const { entities, economy, ground, home, target, transport, infantry } = world;
        const [battery] = install(world, "defensive_battery");
        const ids = embark(world, 2);
        const damaged = makeShip(entities, "transport-b", "alpha", home.q, home.r);
        damaged.hp = 2;
        const doomed = infantry("alpha", home.id).id;
        ground.load("alpha", damaged.id, [doomed]);
        entities.move(damaged.id, target);

        // 5 attack split 3 + 2 (remainder to the healthier transport): round(3 * 10 / 12) = 3
        // and round(2 * 10 / 12) = 2, sinking the damaged one.
        const result = ground.invade("alpha", target.id, [transport.id, damaged.id]);
        expect(result.ok && result.combat).toMatchObject({
            outcome: "attacker_won",
            captured: true,
            destroyedIds: [damaged.id],
            destroyedUnitIds: [doomed]
        });
        expect(result.ok && result.landedUnitIds).toEqual(ids);
        expect(result.ok && result.combat.participants).toEqual([
            expect.objectContaining({ id: transport.id, kind: "ship", hpAfter: 5 }),
            expect.objectContaining({ id: damaged.id, hpAfter: 0, destroyed: true }),
            expect.objectContaining({
                id: battery!.id,
                kind: "installation",
                structureType: "defensive_battery",
                role: "defender",
                maxHp: 0,
                damageDealt: 5,
                destroyed: false
            }),
            ...ids.map((id) => expect.objectContaining({ id, kind: "ground_unit" }))
        ]);
        expect(transport).toMatchObject({ hp: 5, lastCombatTurn: 1 });
        expect(entities.get(damaged.id)).toBeUndefined();
        expect(economy.units.get(doomed)).toBeUndefined();
        expect(target.garrison).toEqual(ids);
    });

    it("fails an invasion whose every transport is sunk by the batteries", () => {
        const world = groundWorld();
        const { economy, ground, target, transport } = world;
        install(world, "defensive_battery");
        const ids = embark(world, 2);
        transport.hp = 4;

        const result = ground.invade("alpha", target.id, [transport.id]);
        expect(result.ok && result.combat).toMatchObject({
            outcome: "attacker_destroyed",
            captured: false,
            rounds: 0,
            destroyedIds: [transport.id],
            destroyedUnitIds: ids
        });
        expect(target.sideId).toBe("beta");
        expect(economy.stateFor("alpha").groundUnits).toEqual([]);
    });
});

describe("GroundManager star destroyer cargo", () => {
    it("loads and unloads ground units aboard a star destroyer like a transport", () => {
        const { entities, ground, home, infantry } = groundWorld();
        const destroyer = makeShip(entities, "sd-a", "alpha", home.q, home.r, "star_destroyer");
        expect(DEFAULTS.ships.star_destroyer.unitCapacity).toBe(4);
        const ids = Array.from({ length: 4 }, () => infantry("alpha", home.id).id);

        expect(ground.load("alpha", destroyer.id, ids)).toEqual({ ok: true });
        expect(destroyer.carriedUnitIds).toEqual(ids);
        expect(ground.unload("alpha", destroyer.id, home.id, ids.slice(0, 2))).toEqual({
            ok: true
        });
        expect(destroyer.carriedUnitIds).toEqual(ids.slice(2));
        expect(home.garrison).toEqual(expect.arrayContaining(ids.slice(0, 2)));
    });
});

describe("GroundManager bombardment", () => {
    it("fires one-way at a garrison, spends movement, and may destroy installations", () => {
        const world = groundWorld(() => 0.1);
        const { entities, economy, ground, target, infantry } = world;
        const destroyer = makeShip(
            entities,
            "sd-bombard",
            "alpha",
            target.q,
            target.r,
            "star_destroyer"
        );
        const defender = infantry("beta", target.id);
        economy.deposit(target.id, { money: 500, materials: 500, population: 50, science: 0 });
        economy.build("beta", target.id, { kind: "structure", structureType: "mine" });
        economy.fund();
        economy.fund();
        economy.completeReady();
        const mineId = economy.locationEconomy(target.id)!.installations[0]!.id;
        const mpBefore = destroyer.movementPoints;

        const result = ground.bombard("alpha", target.id, [destroyer.id]);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.combat).toMatchObject({
            kind: "ground",
            cause: "bombardment",
            attackerSideId: "alpha",
            defenderSideIds: ["beta"],
            rounds: 1,
            captured: false,
            attackerMovedIn: false,
            locationId: target.id
        });
        expect(destroyer.movementPoints).toBe(mpBefore - 1);
        expect(destroyer.lastCombatTurn).toBe(1);
        expect(target.sideId).toBe("beta");
        // Attack 8 vs infantry defence 3, roll 0.1 (factor 0.8): round(8 * 0.8 * 10/13) = 5;
        // infantry hp 10 → damaged, not killed.
        expect(economy.units.get(defender.id)?.hp).toBe(5);
        expect(result.combat.destroyedUnitIds).toEqual([]);
        // Chance 0.4 with rng 0.1 → hit; second rng pick also 0.1 → index 0.
        expect(result.combat.destroyedInstallationIds).toEqual([mineId]);
        expect(economy.locationEconomy(target.id)!.installations).toEqual([]);
        expect(result.combat.participants).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    id: destroyer.id,
                    kind: "ship",
                    role: "attacker",
                    shipType: "star_destroyer",
                    damageDealt: 5
                }),
                expect.objectContaining({
                    id: defender.id,
                    kind: "ground_unit",
                    role: "defender",
                    hpAfter: 5,
                    destroyed: false
                })
            ])
        );
    });

    it("rejects bombardments that are not possible", () => {
        const { entities, ground, home, target } = groundWorld();
        const destroyer = makeShip(entities, "sd-b", "alpha", home.q, home.r, "star_destroyer");
        const frigate = makeShip(entities, "frigate-b", "alpha", target.q, target.r, "frigate");

        expect(ground.bombard("alpha", target.id, [destroyer.id])).toEqual({
            ok: false,
            error: "Ship sd-b is not at the location"
        });
        entities.move(destroyer.id, target);
        expect(ground.bombard("alpha", target.id, [frigate.id])).toEqual({
            ok: false,
            error: "Frigate cannot bombard"
        });
        expect(ground.bombard("alpha", home.id, [destroyer.id])).toEqual({
            ok: false,
            error: "Location is already yours"
        });
        destroyer.movementPoints = 0;
        expect(ground.bombard("alpha", target.id, [destroyer.id])).toEqual({
            ok: false,
            error: "Ship sd-b has no movement left to bombard"
        });
        destroyer.movementPoints = 2;
        expect(ground.bombard("alpha", target.id, [destroyer.id])).toEqual({
            ok: false,
            error: "Nothing to bombard"
        });
    });

    it("wipes an undefended installation-only target without capturing", () => {
        const world = groundWorld(() => 0);
        const { entities, economy, ground, target } = world;
        const destroyer = makeShip(entities, "sd-c", "alpha", target.q, target.r, "star_destroyer");
        economy.deposit(target.id, { money: 200, materials: 200, population: 20, science: 0 });
        economy.build("beta", target.id, { kind: "structure", structureType: "mine" });
        economy.fund();
        economy.fund();
        economy.completeReady();
        const mineId = economy.locationEconomy(target.id)!.installations[0]!.id;

        const result = ground.bombard("alpha", target.id, [destroyer.id]);
        expect(result.ok && result.combat).toMatchObject({
            cause: "bombardment",
            outcome: "attacker_won",
            captured: false,
            destroyedUnitIds: [],
            destroyedInstallationIds: [mineId]
        });
        expect(target.sideId).toBe("beta");
        expect(economy.locationEconomy(target.id)!.installations).toEqual([]);
    });

    it("draws fire from every Defensive Battery onto the bombarding ships", () => {
        const world = groundWorld();
        const { entities, economy, ground, target, infantry } = world;
        const batteries = install(world, "defensive_battery", 2);
        const defender = infantry("beta", target.id);
        const sd = makeShip(entities, "sd-d", "alpha", target.q, target.r, "star_destroyer");
        sd.hp = DEFAULTS.ships.star_destroyer.hp;

        const result = ground.bombard("alpha", target.id, [sd.id]);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        // round(8 * 10 / 13) = 6 to the infantry; each battery round(5 * 10 / 18) = 3 back.
        expect(defender.hp).toBe(4);
        expect(sd.hp).toBe(24);
        expect(result.combat).toMatchObject({ outcome: "inconclusive", destroyedIds: [] });
        expect(result.combat.destroyedInstallationIds).toEqual([]);
        expect(result.combat.shieldBefore).toBeUndefined();
        expect(result.combat.participants.map((p) => [p.id, p.damageDealt])).toEqual([
            [sd.id, 6],
            [batteries[0]!.id, 3],
            [batteries[1]!.id, 3],
            [defender.id, 0]
        ]);

        sd.hp = 5;
        sd.movementPoints = 2;
        const sunk = ground.bombard("alpha", target.id, [sd.id]);
        expect(sunk.ok && sunk.combat).toMatchObject({
            outcome: "attacker_destroyed",
            destroyedIds: [sd.id],
            destroyedInstallationIds: []
        });
        expect(entities.get(sd.id)).toBeUndefined();
        expect(economy.installationsAt(target.id)).toHaveLength(2);
    });

    it("has a shield absorb whole shots until it is down, then lets the rest hit the garrison", () => {
        const world = groundWorld();
        const { entities, economy, ground, target, infantry } = world;
        install(world, "shield_generator");
        economy.setShieldHp(target.id, 10);
        const defender = infantry("beta", target.id);
        const ships = ["sd-1", "sd-2", "sd-3"].map((id) =>
            makeShip(entities, id, "alpha", target.q, target.r, "star_destroyer")
        );

        // Each absorbed shot takes combatDamage(8, 0) = 8: 10 -> 2 -> 0, overflow wasted.
        const result = ground.bombard(
            "alpha",
            target.id,
            ships.map((s) => s.id)
        );
        expect(result.ok && result.combat).toMatchObject({
            shieldBefore: 10,
            shieldAfter: 0,
            destroyedInstallationIds: []
        });
        expect(economy.shieldHp(target.id)).toBe(0);
        expect(defender.hp).toBe(4);
        expect(result.ok && result.combat.participants.map((p) => p.damageDealt)).toEqual([
            0, 0, 6, 0
        ]);
        expect(ships.every((s) => s.movementPoints === s.maxMovementPoints - 1)).toBe(true);
    });

    it("leaves the garrison untouched when the shield absorbs every shot", () => {
        const world = groundWorld();
        const { entities, economy, ground, target, infantry } = world;
        install(world, "shield_generator");
        economy.setShieldHp(target.id, 30);
        const defender = infantry("beta", target.id);
        const sd = makeShip(entities, "sd-e", "alpha", target.q, target.r, "star_destroyer");

        const result = ground.bombard("alpha", target.id, [sd.id]);
        expect(result.ok && result.combat).toMatchObject({
            outcome: "inconclusive",
            shieldBefore: 30,
            shieldAfter: 22
        });
        expect(defender.hp).toBeUndefined();
        expect(economy.installationsAt(target.id).map((i) => i.type)).toEqual(["shield_generator"]);
    });
});
