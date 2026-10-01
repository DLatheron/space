import { axialKey } from "@space/maths";
import { SHIP_TYPE_INFO, type AxialCoord, type ShipType } from "@space/shared-data";
import { defaultEconomyBalance } from "../config/config.schema.js";
import { BattleManager } from "./Battle.js";
import { CarrierManager } from "./CarrierManager.js";
import { destroyVessels } from "./destroyShips.js";
import { EconomyManager } from "./EconomyManager.js";
import { EntityManager } from "./EntityManager.js";
import { HyperspaceManager } from "./HyperspaceManager.js";
import { createEmptyMap } from "./map/SpaceMap.js";
import type { EntityOf } from "./map/types.js";
import { Side } from "./Side.js";

const DEFAULTS = defaultEconomyBalance();
const HOME = { q: 5, r: 5 };

function carrierWorld() {
    const map = createEmptyMap({ width: 20, height: 20, hexSize: 50, seed: 1 });
    const entities = new EntityManager(map);
    const economy = new EconomyManager(entities, ["alpha", "beta"]);
    const carriers = new CarrierManager(entities, economy.balance);
    const battles = new BattleManager(entities, economy, { rng: () => 0.5 });
    const ship = (id: string, shipType: ShipType, at: AxialCoord = HOME, sideId = "alpha") => {
        const mp = DEFAULTS.ships[shipType].maxMovementPoints;
        return entities.add<EntityOf<"ship">>({
            id,
            kind: "ship",
            shipType,
            sideId,
            q: at.q,
            r: at.r,
            facing: 0,
            movementPoints: mp,
            maxMovementPoints: mp
        });
    };
    const carrier = ship("sd-a", "star_destroyer");
    const fighters = [
        ship("fighter-1", "fighter_squadron"),
        ship("fighter-2", "advanced_fighter_squadron")
    ];
    return { map, entities, economy, carriers, battles, ship, carrier, fighters };
}

const ids = (entities: { id: string }[]) => entities.map((e) => e.id);

describe("CarrierManager loading", () => {
    it("boards ships on the carrier's hex for one movement point, stowing them", () => {
        const { entities, carriers, carrier, fighters } = carrierWorld();
        const [fighter, advanced] = fighters;
        fighter!.moveOrder = { destination: { q: 9, r: 5 } };
        const mp = fighter!.movementPoints;

        expect(carriers.load("alpha", carrier.id, ids(fighters))).toEqual({ ok: true, carrier });
        expect(carrier.carriedShipIds).toEqual(ids(fighters));
        expect(fighter).toMatchObject({ carriedBy: carrier.id, movementPoints: mp - 1, ...HOME });
        expect(advanced!.carriedBy).toBe(carrier.id);
        expect(fighter!.moveOrder).toBeUndefined();
        expect(entities.entitiesAt(HOME.q, HOME.r)).toEqual([carrier]);
        expect(entities.isStowed(fighter!.id)).toBe(true);
        expect(entities.get(fighter!.id)).toBe(fighter);
    });

    it("rejects boarding that breaks the hangar rules", () => {
        const { entities, carriers, ship, carrier, fighters } = carrierWorld();
        const [fighter] = fighters;
        const sd = SHIP_TYPE_INFO.star_destroyer.name;
        const frigate = ship("frigate-a", "frigate");
        const reject = (shipIds: string[], error: string, carrierId = carrier.id, side = "alpha") =>
            expect(carriers.load(side, carrierId, shipIds)).toEqual({ ok: false, error });

        reject([fighter!.id], `${SHIP_TYPE_INFO.frigate.name} has no hangar`, frigate.id);
        reject([frigate.id], `${sd} cannot carry a ${SHIP_TYPE_INFO.frigate.name}`);
        reject([fighter!.id], `Unknown ship ${carrier.id}`, carrier.id, "beta");
        expect(carriers.load(null, carrier.id, [fighter!.id]).ok).toBe(false);
        reject([fighter!.id, fighter!.id], "A ship is listed more than once");
        reject([carrier.id], "A carrier can't board itself");

        const enemy = ship("fighter-b", "fighter_squadron", HOME, "beta");
        reject([enemy.id], `Unknown ship ${enemy.id}`);
        const away = ship("fighter-away", "fighter_squadron", { q: 6, r: 5 });
        reject([away.id], `Ship ${away.id} is not at the carrier`);
        fighter!.movementPoints = 0;
        reject([fighter!.id], `Ship ${fighter!.id} has no movement left to board`);

        const extra = [0, 1, 2, 3, 4].map((i) => ship(`extra-${i}`, "fighter_squadron"));
        expect(DEFAULTS.ships.star_destroyer.hangar?.capacity).toBe(4);
        reject(ids(extra), "Not enough room in the hangar");
        expect(carriers.load("alpha", carrier.id, ids(extra.slice(0, 4))).ok).toBe(true);
        reject([extra[4]!.id], "Not enough room in the hangar");

        const other = ship("sd-a2", "star_destroyer");
        reject([extra[0]!.id], `Ship ${extra[0]!.id} is already aboard a carrier`, other.id);
        const onHex = ids(entities.entitiesAt(HOME.q, HOME.r));
        expect(onHex).toContain(extra[4]!.id);
        expect(onHex.filter((id) => ids(extra.slice(0, 4)).includes(id))).toEqual([]);
    });

    it("launches carried ships onto the carrier's hex for free", () => {
        const { entities, carriers, carrier, fighters } = carrierWorld();
        const [fighter, advanced] = fighters;
        carriers.load("alpha", carrier.id, ids(fighters));
        const mp = fighter!.movementPoints;

        expect(carriers.unload("alpha", carrier.id, ["nope"])).toEqual({
            ok: false,
            error: "Ship nope is not aboard"
        });
        expect(carriers.unload("alpha", carrier.id, [fighter!.id]).ok).toBe(true);
        expect(fighter!.carriedBy).toBeUndefined();
        expect(fighter!.movementPoints).toBe(mp);
        expect(carrier.carriedShipIds).toEqual([advanced!.id]);
        expect(entities.entitiesAt(HOME.q, HOME.r)).toEqual([carrier, fighter]);

        expect(carriers.unload("alpha", carrier.id, [advanced!.id]).ok).toBe(true);
        expect(carrier).not.toHaveProperty("carriedShipIds");
        expect(entities.isStowed(advanced!.id)).toBe(false);
    });
});

describe("carried ships", () => {
    it("move with the carrier and can't move by themselves", () => {
        const { entities, carriers, battles, carrier, fighters } = carrierWorld();
        carriers.load("alpha", carrier.id, ids(fighters));
        expect(battles.moveShip("alpha", fighters[0]!.id, { q: 6, r: 5 })).toEqual({
            ok: false,
            error: `Ship ${fighters[0]!.id} is aboard a carrier`
        });

        const moved = battles.moveShip("alpha", carrier.id, { q: 7, r: 5 });
        expect(moved.ok).toBe(true);
        for (const fighter of fighters) expect(fighter).toMatchObject({ q: 7, r: 5 });
        expect(entities.entitiesAt(7, 5)).toEqual([carrier]);
        expect(entities.entitiesAt(HOME.q, HOME.r)).toEqual([]);
    });

    it("jump with the carrier, losing their own pending jump on boarding", () => {
        const { entities, economy, carriers, battles, carrier, fighters } = carrierWorld();
        const hyperspace = new HyperspaceManager(entities, { battles, economy, rng: () => 0 });
        carrier.movementPoints = 0;
        fighters[0]!.hyperjump = { target: { q: 3, r: 3 } };
        carriers.load("alpha", carrier.id, ids(fighters));
        expect(fighters[0]!.hyperjump).toBeUndefined();
        expect(hyperspace.activate("alpha", fighters[1]!.id, { q: 12, r: 12 }).ok).toBe(false);

        expect(hyperspace.activate("alpha", carrier.id, { q: 12, r: 12 })).toEqual({ ok: true });
        const events = hyperspace.resolve();
        expect(events.map((e) => [e.shipId, e.outcome])).toEqual([[carrier.id, "arrived"]]);
        for (const fighter of fighters) expect(fighter).toMatchObject({ q: 12, r: 12 });
        expect(entities.entitiesAt(12, 12)).toEqual([carrier]);
    });

    it("are destroyed with the carrier, releasing their crews", () => {
        const { entities, economy, carriers, carrier, fighters } = carrierWorld();
        carriers.load("alpha", carrier.id, ids(fighters));
        const result = destroyVessels(entities, economy, [carrier]);
        expect(result.destroyedShipIds).toEqual([carrier.id, ...ids(fighters)]);
        for (const id of result.destroyedShipIds) expect(entities.get(id)).toBeUndefined();
        expect(economy.takeReleased().map((r) => r.amount)).toEqual([
            DEFAULTS.ships.star_destroyer.cost.population,
            DEFAULTS.ships.fighter_squadron.cost.population,
            DEFAULTS.ships.advanced_fighter_squadron.cost.population
        ]);
    });

    it("leave the carrier's list when destroyed on their own", () => {
        const { entities, economy, carriers, carrier, fighters } = carrierWorld();
        carriers.load("alpha", carrier.id, ids(fighters));
        destroyVessels(entities, economy, [fighters[0]!]);
        expect(carrier.carriedShipIds).toEqual([fighters[1]!.id]);
        destroyVessels(entities, economy, [fighters[1]!]);
        expect(carrier).not.toHaveProperty("carriedShipIds");
    });

    it("don't fight: only the carrier defends its hex", () => {
        const { carriers, battles, ship, carrier, fighters } = carrierWorld();
        carriers.load("alpha", carrier.id, ids(fighters));
        const raider = ship("raider-b", "frigate", { q: 7, r: 5 }, "beta");
        const moved = battles.moveShip("beta", raider.id, HOME);
        expect(moved.ok && moved.combat?.participants.map((p) => p.id)).toEqual([
            raider.id,
            carrier.id
        ]);
    });

    it("still count towards the ship cap", () => {
        const { economy, carriers, carrier, fighters } = carrierWorld();
        const before = economy.shipCount("alpha");
        carriers.load("alpha", carrier.id, ids(fighters));
        expect(economy.shipCount("alpha")).toBe(before);
        expect(before).toBe(3);
    });

    it("show only as a count to other sides; the owner sees them after their carrier", () => {
        const { entities, carriers, ship, carrier, fighters } = carrierWorld();
        ship("watcher-b", "scout", { q: 6, r: 5 }, "beta");
        carriers.load("alpha", carrier.id, ids(fighters));
        const alpha = new Side("alpha");
        const beta = new Side("beta");
        alpha.recomputeVisibility(entities, 2);
        beta.recomputeVisibility(entities, 2);
        const key = axialKey(HOME.q, HOME.r);

        const own = alpha.buildTileView(entities, key)!.entities;
        expect(ids(own)).toEqual([carrier.id, ...ids(fighters)]);
        expect(own[0]).toMatchObject({ carriedShipIds: ids(fighters), carriedShipCount: 2 });
        expect(own[1]).toMatchObject({ carriedBy: carrier.id });

        const seen = beta.buildTileView(entities, key)!.entities;
        expect(ids(seen)).toEqual([carrier.id]);
        expect(seen[0]).toMatchObject({ carriedShipCount: 2 });
        expect(seen[0]).not.toHaveProperty("carriedShipIds");
    });
});
