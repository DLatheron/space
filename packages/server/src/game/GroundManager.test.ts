import {
    GROUND_UNIT_TYPES,
    SHIP_TYPES,
    zeroResources,
    type Resources,
    type ShipType
} from "@space/shared-data";
import { BattleManager } from "./Battle.js";
import { EconomyManager } from "./EconomyManager.js";
import { EntityManager } from "./EntityManager.js";
import { GroundManager } from "./GroundManager.js";
import { createEmptyMap } from "./map/SpaceMap.js";
import type { EntityOf } from "./map/types.js";
import { SupplyManager } from "./SupplyManager.js";

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
        movementPoints: SHIP_TYPES[shipType].maxMovementPoints,
        maxMovementPoints: SHIP_TYPES[shipType].maxMovementPoints,
        ...(shipType === "transport" ? { carriedUnitIds: [] } : {})
    });
}

function groundWorld() {
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
    const battles = new BattleManager(entities, economy);
    const ground = new GroundManager(entities, economy, battles);
    const supply = new SupplyManager(entities, economy, { battles });
    const transport = makeShip(entities, "transport-a", "alpha", home.q, home.r);
    const infantry = (sideId: string, locationId: string) =>
        economy.units.create(sideId, "infantry", locationId, locationId);
    const unitsAt = (sideId: string) =>
        economy.stateFor(sideId).groundUnits.map((u) => [u.id, u.location]);
    return {
        entities,
        economy,
        battles,
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
        expect(SHIP_TYPES.transport.unitCapacity).toBe(4);
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
        economy.fundAndComplete();
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

    it("destroys the units aboard a transport lost in battle, returning only its crew", () => {
        const { entities, economy, battles, ground, home, transport, infantry, unitsAt } =
            groundWorld();
        const ids = [infantry("alpha", home.id).id, infantry("alpha", home.id).id];
        ground.load("alpha", transport.id, ids);
        entities.move(transport.id, { q: 7, r: 5 });
        const raider = makeShip(entities, "raider", "beta", 8, 5, "frigate");
        const moved = battles.moveShip("beta", raider.id, { q: 7, r: 5 });
        expect(moved.ok && moved.battle?.defenderShipIds).toEqual([transport.id]);
        expect(ground.load("alpha", transport.id, [])).toEqual({
            ok: false,
            error: `Ship ${transport.id} is locked in battle`
        });

        const resolved = battles.resolve(moved.ok ? moved.battle!.battleId : "", "beta", "beta");
        expect(resolved).toMatchObject({
            ok: true,
            destroyedShipIds: [transport.id],
            destroyedUnitIds: ids
        });
        expect(ids.map((id) => economy.units.get(id))).toEqual([undefined, undefined]);
        expect(unitsAt("alpha")).toEqual([]);
        expect(economy.takeReleased()).toEqual([
            {
                sideId: "alpha",
                amount: SHIP_TYPES.transport.cost.population,
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
        economy.fundAndComplete();
        economy.fundAndComplete();
        const habitat = economy.build("beta", target.id, {
            kind: "structure",
            structureType: "habitat"
        });
        economy.fundAndComplete();
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
            battle: null,
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

    it("starts a ground battle against a garrison that the attacker wins and captures", () => {
        const world = groundWorld();
        const { entities, economy, ground, supply, target, betaHome, transport, infantry } = world;
        const defender = infantry("beta", target.id);
        const ids = embark(world, 2);

        const result = ground.invade("alpha", target.id, [transport.id]);
        expect(result.ok && result.battle).toEqual({
            battleId: "ground-1",
            locationId: target.id,
            q: target.q,
            r: target.r,
            attackerSideId: "alpha",
            defenderSideId: "beta",
            attackerUnits: ids.map((id) => ({ id, unitType: "infantry", tier: 1 })),
            defenderUnits: [{ id: defender.id, unitType: "infantry", tier: 1 }]
        });
        // Landed but not yet part of the garrison; still beta's location.
        expect(target.sideId).toBe("beta");
        expect(target.garrison).toEqual([defender.id]);
        expect(economy.units.get(ids[0])?.location).toEqual({
            kind: "garrison",
            locationId: target.id
        });
        expect(transport.carriedUnitIds).toEqual([]);
        expect(ground.involving("beta")).toHaveLength(1);

        // Locked while pending.
        expect(ground.invade("alpha", target.id, [transport.id]).ok).toBe(false);
        const relief = makeShip(entities, "relief", "beta", target.q, target.r);
        expect(ground.load("beta", relief.id, [defender.id])).toEqual({
            ok: false,
            error: "A ground battle is in progress there"
        });
        const reserve = infantry("beta", betaHome.id);
        economy.units.relocate(reserve.id, { kind: "transport", shipId: relief.id });
        expect(ground.unload("beta", relief.id, target.id, [reserve.id])).toEqual({
            ok: false,
            error: "A ground battle is in progress there"
        });

        expect(ground.resolve("ground-1", "beta", "beta")).toEqual({
            ok: false,
            error: "Only the invading side can resolve this battle"
        });
        expect(ground.resolve("ground-1", "alpha", "gamma").ok).toBe(false);
        const resolved = ground.resolve("ground-1", "alpha", "alpha");
        expect(resolved).toMatchObject({
            ok: true,
            loserSideId: "beta",
            destroyedUnitIds: [defender.id],
            captured: true
        });
        expect(target.sideId).toBe("alpha");
        expect(target.garrison).toEqual(ids);
        expect(economy.units.get(defender.id)).toBeUndefined();
        expect(ground.pending()).toEqual([]);

        // The defender's home was lost, so its population goes to beta's nearest location.
        const before = economy.stockpile(betaHome.id).population;
        expect(supply.returnPopulation()).toEqual([]);
        expect(economy.stockpile(betaHome.id).population).toBe(
            before + GROUND_UNIT_TYPES.infantry.cost.population
        );
    });

    it("destroys the invaders when the defender is named winner", () => {
        const world = groundWorld();
        const { economy, ground, supply, home, target, transport, infantry } = world;
        const defender = infantry("beta", target.id);
        const ids = embark(world, 2);
        ground.invade("alpha", target.id, [transport.id]);

        const resolved = ground.resolve("ground-1", "alpha", "beta");
        expect(resolved).toMatchObject({
            ok: true,
            loserSideId: "alpha",
            destroyedUnitIds: ids,
            captured: false
        });
        expect(target.sideId).toBe("beta");
        expect(target.garrison).toEqual([defender.id]);
        expect(economy.stateFor("alpha").groundUnits).toEqual([]);

        const before = economy.stockpile(home.id).population;
        supply.returnPopulation();
        expect(economy.stockpile(home.id).population).toBe(
            before + 2 * GROUND_UNIT_TYPES.infantry.cost.population
        );
    });
});
