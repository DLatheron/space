import { axialDirectionTowards, axialDistance, findHexPath } from "@space/maths";
import {
    addResources,
    BUILD_PRIORITIES,
    hexHasObstacle,
    orderDemands,
    RESOURCE_KEYS,
    resourceUnits,
    locationIncome,
    stockpileCap,
    storageRoom,
    subtractClamped,
    sumResources,
    surplusStock,
    zeroResources,
    type AxialCoord,
    type CargoReservation,
    type CombatResult,
    type BuildSiteEntity,
    type EntityId,
    type OrderDemand,
    type Resources,
    type SideId
} from "@space/shared-data";
import { hasAmbushers, type BattleManager } from "./Battle.js";
import type { EconomyManager } from "./EconomyManager.js";
import type { EntityManager } from "./EntityManager.js";
import { findTileByAxial } from "./map/SpaceMap.js";
import type { EntityOf } from "./map/types.js";
import { facingAfterPath } from "./moveShip.js";

/** What a side believes about a hex, used for supply routing so plans don't leak hidden state. */
export type SupplyKnowledge = {
    /** An obstacle to path around (the destination itself is always enterable). */
    isObstacle: (hex: AxialCoord) => boolean;
    /** Enemy warships; never entered, not even as the destination. */
    isHostile: (hex: AxialCoord) => boolean;
    /**
     * Whether the side currently sees `hex`. Hostiles it only remembers are risked when
     * there is no other route, so a stale sighting can't hold a ship forever. Absent means
     * every sighting is current.
     */
    isVisible?: (hex: AxialCoord) => boolean;
};

export type SupplyOptions = {
    battles?: BattleManager;
    /** Per-side knowledge; defaults to the true map state. */
    knowledge?: (sideId: SideId) => SupplyKnowledge;
};

export type SupplyMove = {
    ship: EntityOf<"supply_ship">;
    from: AxialCoord;
    to: AxialCoord;
    /** Hexes stepped into, in order, ending at `to`. */
    path: AxialCoord[];
};

export type SupplyArrival = {
    supplyShipId: EntityId;
    sideId: SideId;
    locationId: EntityId;
    /** What was unloaded this turn. */
    cargo: Resources;
    at: AxialCoord;
    /** The stockpile was full: the ship stays at the destination with the rest of its cargo. */
    waiting: boolean;
};

/** A supply ship travelled between friendly Stargates (ending its movement for the turn). */
export type SupplyStargate = {
    ship: EntityOf<"supply_ship">;
    from: AxialCoord;
    to: AxialCoord;
    fromGateId: EntityId;
    toGateId: EntityId;
};

export type SupplyMoveResult = {
    moves: SupplyMove[];
    arrivals: SupplyArrival[];
    /** Ambushes: enemy warships or platforms the side didn't know about attacking its supply ships. */
    combats: CombatResult[];
    stargates: SupplyStargate[];
};

type Load = { cargo: Resources; reservedFor: CargoReservation[] };

/** Splits reservations into loads of at most `capacity` units, filling one ship before the next. */
export function packReservations(reservations: CargoReservation[], capacity: number): Load[] {
    if (capacity <= 0) return [];
    const loads: Load[] = [];
    let current: Load = { cargo: zeroResources(), reservedFor: [] };
    let room = capacity;
    for (const reservation of reservations) {
        for (const k of RESOURCE_KEYS) {
            let amount = reservation.amount[k];
            while (amount > 0) {
                const take = Math.min(amount, room);
                current.cargo[k] += take;
                let entry = current.reservedFor.find((r) => r.orderId === reservation.orderId);
                if (!entry) {
                    entry = { orderId: reservation.orderId, amount: zeroResources() };
                    current.reservedFor.push(entry);
                }
                entry.amount[k] += take;
                amount -= take;
                room -= take;
                if (room <= 0) {
                    loads.push(current);
                    current = { cargo: zeroResources(), reservedFor: [] };
                    room = capacity;
                }
            }
        }
    }
    if (room < capacity) loads.push(current);
    return loads;
}

/** Reservations less `delivered`, taken from the first reservations first; empty ones are dropped. */
export function releaseReservations(
    reservations: CargoReservation[],
    delivered: Resources
): CargoReservation[] {
    const left = { ...delivered };
    const result: CargoReservation[] = [];
    for (const reservation of reservations) {
        const amount = { ...reservation.amount };
        for (const k of RESOURCE_KEYS) {
            const take = Math.min(amount[k], left[k]);
            amount[k] -= take;
            left[k] -= take;
        }
        if (resourceUnits(amount) > 0) result.push({ orderId: reservation.orderId, amount });
    }
    return result;
}

/**
 * Autonomous supply ships: dispatch planning with reservation, movement with per-turn
 * re-routing around known enemies, unloading at the destination, and population returns.
 */
export class SupplyManager {
    private readonly _entities: EntityManager;
    private readonly _economy: EconomyManager;
    private readonly _battles: BattleManager | undefined;
    private readonly _knowledge: (sideId: SideId) => SupplyKnowledge;
    private _nextSeq = 1;

    constructor(entities: EntityManager, economy: EconomyManager, options: SupplyOptions = {}) {
        this._entities = entities;
        this._economy = economy;
        this._battles = options.battles;
        this._knowledge = options.knowledge ?? ((sideId) => this._trueKnowledge(sideId));
    }

    shipsOf(sideId: SideId): EntityOf<"supply_ship">[] {
        return this._entities.ofKind("supply_ship").filter((s) => s.sideId === sideId);
    }

    /** Cargo already heading to a location (reserved for it). */
    inFlightTo(locationId: EntityId): Resources {
        return sumResources(
            this._entities
                .ofKind("supply_ship")
                .filter((s) => s.destinationId === locationId)
                .map((s) => s.cargo)
        );
    }

    /**
     * Route from `from` to `to` as the side believes the map to be, excluding `from`.
     * Avoids every hex believed hostile; failing that, only those currently seen.
     * Null when there is none or the destination itself is hostile. When it arrives in
     * fewer turns, the route goes through a pair of the side's completed Stargates: the hop
     * is a step between the two (non-adjacent) gate hexes.
     */
    planRoute(sideId: SideId, from: AxialCoord, to: AxialCoord): AxialCoord[] | null {
        const knowledge = this._knowledge(sideId);
        if (from.q === to.q && from.r === to.r) return [];
        const route = this._planWith(sideId, knowledge, from, to, knowledge.isHostile);
        const isVisible = knowledge.isVisible;
        if (route || !isVisible) return route;
        return this._planWith(sideId, knowledge, from, to, (hex) => {
            return isVisible(hex) && knowledge.isHostile(hex);
        });
    }

    private _planWith(
        sideId: SideId,
        knowledge: SupplyKnowledge,
        from: AxialCoord,
        to: AxialCoord,
        isHostile: (hex: AxialCoord) => boolean
    ): AxialCoord[] | null {
        const direct = this._findRoute(knowledge, from, to, isHostile);
        const gates = this._gates(sideId).filter((g) => !isHostile(g));
        if (gates.length < 2) return direct;
        const speed = Math.max(1, this._economy.research.supplySpeed(sideId));
        const turns = (route: AxialCoord[]) => Math.ceil(route.length / speed);
        let best = direct;
        let bestTurns = direct ? turns(direct) : Infinity;
        const toGate = new Map<EntityId, AxialCoord[] | null>();
        const fromGate = new Map<EntityId, AxialCoord[] | null>();
        for (const g of gates) {
            toGate.set(g.id, this._routeOrEmpty(knowledge, from, g, isHostile));
            fromGate.set(g.id, this._routeOrEmpty(knowledge, g, to, isHostile));
        }
        for (const entry of gates) {
            const approach = toGate.get(entry.id);
            if (!approach) continue;
            for (const exit of gates) {
                if (exit.id === entry.id) continue;
                const onward = fromGate.get(exit.id);
                if (!onward) continue;
                // The hop happens in the turn the ship reaches the entry gate with
                // movement left (or the next turn) and ends that turn's movement.
                const total = Math.floor(approach.length / speed) + 1 + turns(onward);
                if (total < bestTurns) {
                    bestTurns = total;
                    best = [...approach, { q: exit.q, r: exit.r }, ...onward];
                }
            }
        }
        return best;
    }

    private _gates(sideId: SideId): EntityOf<"space_structure">[] {
        return this._entities
            .ofKind("space_structure")
            .filter(
                (s) => s.structureType === "stargate" && s.sideId === sideId && !s.constructing
            );
    }

    private _routeOrEmpty(
        knowledge: SupplyKnowledge,
        from: AxialCoord,
        to: AxialCoord,
        isHostile: (hex: AxialCoord) => boolean
    ): AxialCoord[] | null {
        if (from.q === to.q && from.r === to.r) return [];
        return this._findRoute(knowledge, from, to, isHostile);
    }

    /**
     * Steps 2 and 3. Each supply ship re-plans its route and moves up to its speed. Stepping
     * towards a hex holding enemy warships or an armed enemy Orbital Platform it didn't know
     * about (see `hasAmbushers`), it is ambushed (see
     * `BattleManager.ambush`) and, if it survives, stops before that hex. A ship with no route
     * waits. A ship whose destination was lost heads for the nearest
     * owned location instead (its reservations are dropped). Ships reaching their
     * destination unload what fits under its stockpile cap and are removed once empty;
     * otherwise they wait there and try again each turn. `only` limits the pass to
     * those ships (used to give ships launched this turn their first move).
     */
    move(only?: Iterable<EntityId>): SupplyMoveResult {
        const result: SupplyMoveResult = { moves: [], arrivals: [], combats: [], stargates: [] };
        const filter = only ? new Set(only) : undefined;
        for (const ship of this._entities.ofKind("supply_ship")) {
            if (filter && !filter.has(ship.id)) continue;
            ship.speed = this._economy.research.supplySpeed(ship.sideId);

            const destination = this._ensureDestination(ship);
            if (!destination) {
                ship.route = [];
                continue;
            }

            let ambushed = false;
            if (!this._isAt(ship, destination)) {
                const route = this.planRoute(ship.sideId, ship, destination);
                if (!route) {
                    ship.route = [];
                    continue;
                }
                const path: AxialCoord[] = [];
                let ambushAt: AxialCoord | undefined;
                let hopTo: AxialCoord | undefined;
                let at: AxialCoord = { q: ship.q, r: ship.r };
                for (const hex of route) {
                    if (path.length >= ship.speed) break;
                    if (axialDistance(at, hex) > 1) {
                        hopTo = hex;
                        break;
                    }
                    if (hasAmbushers(this._entities, this._economy, hex, ship.sideId)) {
                        ambushAt = hex;
                        break;
                    }
                    path.push(hex);
                    at = hex;
                }
                ship.route = route.slice(path.length);
                if (path.length > 0) {
                    const from = { q: ship.q, r: ship.r };
                    const to = path[path.length - 1];
                    this._entities.move(ship.id, to);
                    ship.facing = facingAfterPath(from, path);
                    result.moves.push({ ship, from, to: { ...to }, path });
                }
                if (hopTo) {
                    const hop = this._stargateHop(ship, hopTo);
                    if (hop) {
                        ship.route = route.slice(path.length + 1);
                        result.stargates.push(hop);
                    }
                }
                if (ambushAt) {
                    ambushed = true;
                    const combat = this._battles?.ambush(ship, ambushAt);
                    if (combat) result.combats.push(combat);
                    if (!this._entities.get(ship.id)) continue;
                }
            }

            if (!ambushed && this._isAt(ship, destination)) {
                const accepted = this._economy.deposit(destination.id, ship.cargo);
                const remaining = subtractClamped(ship.cargo, accepted);
                const waiting = resourceUnits(remaining) > 0;
                if (waiting) {
                    ship.cargo = remaining;
                    ship.reservedFor = releaseReservations(ship.reservedFor, accepted);
                    ship.route = [];
                    ship.waiting = true;
                } else {
                    this._entities.remove(ship.id);
                }
                if (resourceUnits(accepted) > 0 || !waiting) {
                    result.arrivals.push({
                        supplyShipId: ship.id,
                        sideId: ship.sideId,
                        locationId: destination.id,
                        cargo: accepted,
                        at: { q: ship.q, r: ship.r },
                        waiting
                    });
                }
            } else if (ship.waiting) {
                ship.waiting = undefined;
            }
        }
        return result;
    }

    /**
     * Step 6. Released population leaves from the nearest owned location to where it was
     * released and goes home (or, if home was lost, to the nearest owned location). If it
     * is released nearest to home it is deposited there directly.
     */
    returnPopulation(): EntityOf<"supply_ship">[] {
        const launched: EntityOf<"supply_ship">[] = [];
        const waiting = [];
        for (const release of this._economy.takeReleased()) {
            const owned = this._economy.ownedLocations(release.sideId);
            if (owned.length === 0) continue;
            const byDistance = [...owned].sort(
                (a, b) => axialDistance(a, release.from) - axialDistance(b, release.from)
            );
            const recorded = release.homeId
                ? this._economy.locationEntity(release.homeId)
                : undefined;
            const home = recorded?.sideId === release.sideId ? recorded : byDistance[0];
            const knowledge = this._knowledge(release.sideId);
            const launch = byDistance.find((l) => l.id === home.id || !knowledge.isHostile(l));
            if (!launch) {
                waiting.push(release);
                continue;
            }
            const cargo = { ...zeroResources(), population: release.amount };
            if (launch.id === home.id) {
                this._economy.depositUncapped(home.id, cargo);
                continue;
            }
            const loads = packReservations(
                [{ orderId: "population", amount: cargo }],
                this._economy.research.supplyCapacity(release.sideId)
            );
            for (const load of loads) {
                launched.push(this._spawn(release.sideId, launch, home, load.cargo, []));
            }
        }
        this._economy.requeueReleased(waiting);
        return launched;
    }

    /**
     * Step 7. For each side, every active order's outstanding demand (remaining need less
     * the destination's stockpile and in-flight cargo) is served in priority order from the
     * nearest source by route length. A source only offers stock its own active orders won't
     * need. A destination is sent no more than fits under its cap after its stockpile,
     * in-flight cargo and one turn of its own production. Cargo is reserved for the order,
     * taken from the source and packed into ships.
     */
    dispatch(): EntityOf<"supply_ship">[] {
        const dispatched: EntityOf<"supply_ship">[] = [];
        for (const sideId of this._economy.sideIds) {
            // Techs completed this turn apply to ships already under way.
            const speed = this._economy.research.supplySpeed(sideId);
            for (const ship of this.shipsOf(sideId)) ship.speed = speed;
            dispatched.push(...this._dispatchSide(sideId));
        }
        return dispatched;
    }

    private _dispatchSide(sideId: SideId): EntityOf<"supply_ship">[] {
        const knowledge = this._knowledge(sideId);
        const locations = this._economy.ownedSites(sideId);
        const byId = new Map(locations.map((l) => [l.id, l]));
        const available = new Map<EntityId, Resources>();
        const room = new Map<EntityId, Resources>();
        const demands: (OrderDemand & { locationId: EntityId })[] = [];
        for (const location of locations) {
            const economy = this._economy.locationEconomy(location.id)!;
            const orders = this._economy.activeOrders(location.id);
            const inFlight = this.inFlightTo(location.id);
            if (!knowledge.isHostile(location)) {
                available.set(location.id, surplusStock(economy.stockpile, orders));
            }
            const balance = this._economy.balance;
            const expected = sumResources([
                economy.stockpile,
                inFlight,
                locationIncome(economy, balance)
            ]);
            room.set(location.id, storageRoom(expected, stockpileCap(economy, balance)));
            for (const demand of orderDemands(economy.stockpile, orders, inFlight)) {
                demands.push({ ...demand, locationId: location.id });
            }
        }
        const tier = (d: OrderDemand) => BUILD_PRIORITIES.indexOf(d.priority);
        demands.sort((a, b) => tier(a) - tier(b));

        const distances = new Map<string, number | null>();
        const distance = (from: BuildSiteEntity, to: BuildSiteEntity) => {
            const key = `${from.id}|${to.id}`;
            if (!distances.has(key)) {
                distances.set(key, this.planRoute(sideId, from, to)?.length ?? null);
            }
            return distances.get(key)!;
        };

        const shipments = new Map<
            string,
            { source: EntityId; dest: EntityId; reservations: CargoReservation[] }
        >();
        for (const demand of demands) {
            const dest = byId.get(demand.locationId)!;
            const destRoom = room.get(dest.id)!;
            for (const k of RESOURCE_KEYS) {
                let need = Math.min(demand.amount[k], destRoom[k]);
                if (need <= 0) continue;
                const sources = [...available.keys()]
                    .filter((id) => id !== dest.id && available.get(id)![k] > 0)
                    .map((id) => ({ id, d: distance(byId.get(id)!, dest) }))
                    .filter((s): s is { id: EntityId; d: number } => s.d !== null)
                    .sort((a, b) => a.d - b.d);
                for (const source of sources) {
                    const stock = available.get(source.id)!;
                    const take = Math.min(need, stock[k]);
                    stock[k] -= take;
                    destRoom[k] -= take;
                    need -= take;
                    const key = `${source.id}|${dest.id}`;
                    let shipment = shipments.get(key);
                    if (!shipment) {
                        shipment = { source: source.id, dest: dest.id, reservations: [] };
                        shipments.set(key, shipment);
                    }
                    let reservation = shipment.reservations.find(
                        (r) => r.orderId === demand.orderId
                    );
                    if (!reservation) {
                        reservation = { orderId: demand.orderId, amount: zeroResources() };
                        shipment.reservations.push(reservation);
                    }
                    reservation.amount = addResources(reservation.amount, { [k]: take });
                    if (need <= 0) break;
                }
            }
        }

        const capacity = this._economy.research.supplyCapacity(sideId);
        const dispatched: EntityOf<"supply_ship">[] = [];
        for (const shipment of shipments.values()) {
            const total = sumResources(shipment.reservations.map((r) => r.amount));
            if (resourceUnits(total) <= 0) continue;
            this._economy.withdraw(shipment.source, total);
            const source = byId.get(shipment.source)!;
            const dest = byId.get(shipment.dest)!;
            for (const load of packReservations(shipment.reservations, capacity)) {
                dispatched.push(this._spawn(sideId, source, dest, load.cargo, load.reservedFor));
            }
        }
        return dispatched;
    }

    private _spawn(
        sideId: SideId,
        origin: BuildSiteEntity,
        destination: BuildSiteEntity,
        cargo: Resources,
        reservedFor: CargoReservation[]
    ): EntityOf<"supply_ship"> {
        let id: EntityId;
        do {
            id = `supply-${this._nextSeq++}`;
        } while (this._entities.get(id));
        const route = this.planRoute(sideId, origin, destination) ?? [];
        return this._entities.add<EntityOf<"supply_ship">>({
            id,
            kind: "supply_ship",
            name: `Supply ${id.slice("supply-".length)}`,
            q: origin.q,
            r: origin.r,
            sideId,
            facing: route[0] ? axialDirectionTowards(origin, route[0]) : 0,
            originId: origin.id,
            destinationId: destination.id,
            cargo,
            reservedFor,
            speed: this._economy.research.supplySpeed(sideId),
            capacity: this._economy.research.supplyCapacity(sideId),
            route,
            scale: 0.35
        });
    }

    /**
     * Take the ship from the friendly Stargate on its hex to the one at `to`; undefined (and
     * nothing happens) unless both are completed friendly gates and the exit is safe.
     */
    private _stargateHop(
        ship: EntityOf<"supply_ship">,
        to: AxialCoord
    ): SupplyStargate | undefined {
        const gateAt = (hex: AxialCoord) =>
            this._entities
                .entitiesAt(hex.q, hex.r)
                .find(
                    (e): e is EntityOf<"space_structure"> =>
                        e.kind === "space_structure" &&
                        e.structureType === "stargate" &&
                        e.sideId === ship.sideId &&
                        !e.constructing
                );
        const entry = gateAt(ship);
        const exit = gateAt(to);
        if (!entry || !exit || entry.id === exit.id) return undefined;
        if (hasAmbushers(this._entities, this._economy, exit, ship.sideId)) return undefined;
        const from = { q: ship.q, r: ship.r };
        this._entities.move(ship.id, exit);
        return {
            ship,
            from,
            to: { q: exit.q, r: exit.r },
            fromGateId: entry.id,
            toGateId: exit.id
        };
    }

    /** The ship's destination, switched to the nearest owned location if it was lost. */
    private _ensureDestination(ship: EntityOf<"supply_ship">): BuildSiteEntity | undefined {
        const current = this._economy.siteEntity(ship.destinationId);
        if (current?.sideId === ship.sideId) return current;
        const nearest = this._economy
            .ownedLocations(ship.sideId)
            .sort((a, b) => axialDistance(a, ship) - axialDistance(b, ship))[0];
        if (!nearest) return undefined;
        ship.destinationId = nearest.id;
        ship.reservedFor = [];
        return nearest;
    }

    private _findRoute(
        knowledge: SupplyKnowledge,
        from: AxialCoord,
        to: AxialCoord,
        isHostile: (hex: AxialCoord) => boolean
    ): AxialCoord[] | null {
        if (isHostile(to)) return null;
        const path = findHexPath(from, to, {
            inBounds: (hex) => !!findTileByAxial(this._entities.map, hex.q, hex.r),
            passable: (hex) => !knowledge.isObstacle(hex) && !isHostile(hex)
        });
        return path ? path.slice(1).map((hex) => ({ q: hex.q, r: hex.r })) : null;
    }

    private _isAt(ship: AxialCoord, location: AxialCoord): boolean {
        return ship.q === location.q && ship.r === location.r;
    }

    private _trueKnowledge(sideId: SideId): SupplyKnowledge {
        return {
            isObstacle: (hex) => hexHasObstacle(this._entities.entitiesAt(hex.q, hex.r)),
            isHostile: (hex) => hasAmbushers(this._entities, this._economy, hex, sideId)
        };
    }
}
