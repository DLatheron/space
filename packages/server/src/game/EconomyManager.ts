import { axialDirectionTowards, axialDistance } from "@space/maths";
import {
    addResources,
    borrowedPopulation,
    canBuild,
    countQueuedShips,
    createBuildOrder,
    DEFAULT_BUILD_PRIORITY,
    depositCapped,
    enhancementTargetId,
    fundOrders,
    isFullyFunded,
    locationIncome,
    minResources,
    partitionOrders,
    remainingNeed,
    SHIP_TYPE_INFO,
    shipCapFor,
    shipDef,
    shipStats,
    siteForEntity,
    slotsForEntity,
    stockpileCap,
    structureDef,
    subtractResources,
    sumResources,
    zeroResources,
    type AxialCoord,
    type BuildItem,
    type BuildOrder,
    type BuildPriority,
    type EconomyBalance,
    type EconomyState,
    type EnhancementTarget,
    type EntityId,
    type GroundUnit,
    type Installation,
    type LocationEconomy,
    type LocationEntity,
    type OrderId,
    type Resources,
    type ShipType,
    type SideId,
    type TechId
} from "@space/shared-data";
import { defaultEconomyBalance } from "../config/config.schema.js";
import { hasEnemyWarships } from "./Battle.js";
import type { EntityManager } from "./EntityManager.js";
import { GroundUnitRegistry, isLocationEntity } from "./GroundUnits.js";
import type { EntityOf } from "./map/types.js";
import { ResearchManager } from "./ResearchManager.js";

export type EconomyResult = { ok: true } | { ok: false; error: string };

export type BuildResult =
    | {
          ok: true;
          order: BuildOrder;
          /** Only with `instantBuild`: the order was funded and completed immediately. */
          completed: boolean;
          spawnedShip?: EntityOf<"ship">;
          spawnedUnit?: GroundUnit;
      }
    | { ok: false; error: string };

export type EconomyOptions = {
    /** Orders are funded from any of the side's stockpiles as soon as they are placed. */
    instantBuild?: boolean;
    research?: ResearchManager;
    units?: GroundUnitRegistry;
    /** Home planet per side, given the starting stockpile; defaults to each side's first owned planet. */
    homes?: Partial<Record<SideId, EntityId>>;
    /** Costs, stats, stockpile caps and concurrency limits; defaults to the config schema's defaults. */
    balance?: EconomyBalance;
};

export type ColoniseResult =
    { ok: true; location: LocationEntity; consumedShipId: EntityId } | { ok: false; error: string };

export type CompletedBuild = {
    sideId: SideId;
    locationId: EntityId;
    orderId: OrderId;
    item: BuildItem;
};

export type EconomyAdvance = {
    completed: CompletedBuild[];
    spawnedShips: EntityOf<"ship">[];
    spawnedUnits: GroundUnit[];
};

/** Borrowed population waiting to be shipped home (see `SupplyManager.returnPopulation`). */
export type ReleasedPopulation = {
    sideId: SideId;
    amount: number;
    /** Where it was borrowed from; undefined or lost means the nearest owned location. */
    homeId?: EntityId;
    /** Where it was released. */
    from: AxialCoord;
};

type LocationRecord = {
    /** A side's starting planet (home stockpile caps), whoever owns it now. */
    home: boolean;
    stockpile: Resources;
    installations: Installation[];
    orders: BuildOrder[];
};

type Completion = { done: boolean; ship?: EntityOf<"ship">; unit?: GroundUnit };

/**
 * Per-location stockpiles, installations and concurrently funded build orders. Ownership,
 * planet level and slots live on the location entity; this holds the private state.
 */
export class EconomyManager {
    private readonly _entities: EntityManager;
    private readonly _sideIds: SideId[];
    private readonly _lastIncome = new Map<SideId, Resources>();
    private readonly _locations = new Map<EntityId, LocationRecord>();
    /** Where each ship's crew population was borrowed from. */
    private readonly _crewFrom = new Map<EntityId, EntityId>();
    private readonly _instantBuild: boolean;
    private readonly _balance: EconomyBalance;
    private readonly _research: ResearchManager;
    private readonly _units: GroundUnitRegistry;
    private _released: ReleasedPopulation[] = [];
    private _nextShipSeq = 1;
    private _nextOrderSeq = 1;
    private _nextInstallationSeq = 1;

    constructor(entities: EntityManager, sideIds: Iterable<SideId>, options: EconomyOptions = {}) {
        this._entities = entities;
        this._sideIds = [...sideIds];
        this._instantBuild = options.instantBuild ?? false;
        this._balance = options.balance ?? defaultEconomyBalance();
        this._research = options.research ?? new ResearchManager();
        this._units = options.units ?? new GroundUnitRegistry(entities);
        for (const sideId of this._sideIds) {
            this._lastIncome.set(sideId, zeroResources());
            const owned = this.ownedLocations(sideId);
            for (const location of owned) this._record(location.id);
            const homeId = options.homes?.[sideId] ?? owned.find((l) => l.kind === "planet")?.id;
            const home = homeId ? this.locationEntity(homeId) : undefined;
            if (home?.sideId === sideId) {
                const record = this._record(home.id);
                record.home = true;
                record.stockpile = minResources(this._balance.startingStockpile, this._cap(record));
                for (const ship of entities.ofKind("ship")) {
                    if (ship.sideId === sideId) this._crewFrom.set(ship.id, home.id);
                }
            }
        }
    }

    get research(): ResearchManager {
        return this._research;
    }

    get units(): GroundUnitRegistry {
        return this._units;
    }

    get instantBuild(): boolean {
        return this._instantBuild;
    }

    get balance(): EconomyBalance {
        return this._balance;
    }

    get sideIds(): readonly SideId[] {
        return this._sideIds;
    }

    /** Planet, moon or large asteroid entity. */
    locationEntity(locationId: EntityId): LocationEntity | undefined {
        const entity = this._entities.get(locationId);
        return isLocationEntity(entity) ? entity : undefined;
    }

    ownedLocations(sideId: SideId): LocationEntity[] {
        const result: LocationEntity[] = [];
        for (const entity of this._entities.all()) {
            if (isLocationEntity(entity) && entity.sideId === sideId) result.push(entity);
        }
        return result;
    }

    /** Detached snapshot of an owned location's economy. */
    locationEconomy(locationId: EntityId): LocationEconomy | undefined {
        const location = this.locationEntity(locationId);
        if (!location?.sideId) return undefined;
        return this._view(location);
    }

    stockpile(locationId: EntityId): Resources {
        return { ...(this._locations.get(locationId)?.stockpile ?? zeroResources()) };
    }

    /** Most of each resource the location's stockpile holds (see `stockpileCap`). */
    stockpileCap(locationId: EntityId): Resources {
        return this._cap(this._record(locationId));
    }

    /** Orders funded and generating supply demand; the rest wait for a concurrency slot. */
    activeOrders(locationId: EntityId): BuildOrder[] {
        return partitionOrders(this._record(locationId), this._balance).active;
    }

    /** Every owned location's stockpile added together. */
    totalStockpile(sideId: SideId): Resources {
        return sumResources(this.ownedLocations(sideId).map((l) => this.stockpile(l.id)));
    }

    /** Built ships plus ships on order at any owned location. */
    shipCount(sideId: SideId): number {
        const built = this._entities.ofKind("ship").filter((s) => s.sideId === sideId).length;
        return built + countQueuedShips(this._economies(sideId));
    }

    shipCap(sideId: SideId): number {
        return shipCapFor(this._economies(sideId), this._balance);
    }

    shipCrewOrigin(shipId: EntityId): EntityId | undefined {
        return this._crewFrom.get(shipId);
    }

    stateFor(sideId: SideId): EconomyState {
        const locations = this._economies(sideId);
        return {
            lastIncome: { ...(this._lastIncome.get(sideId) ?? zeroResources()) },
            shipCount: this.shipCount(sideId),
            shipCap: shipCapFor(locations, this._balance),
            locations,
            techs: this._research.techs(sideId),
            supplyShips: this._entities
                .ofKind("supply_ship")
                .filter((ship) => ship.sideId === sideId)
                .map((ship) => ({
                    ...ship,
                    cargo: { ...ship.cargo },
                    reservedFor: ship.reservedFor.map((r) => ({ ...r, amount: { ...r.amount } })),
                    route: ship.route?.map((hex) => ({ ...hex }))
                })),
            groundUnits: this._units
                .ofSide(sideId)
                .map((unit) => ({ ...unit, location: { ...unit.location } })),
            supplySpeed: this._research.supplySpeed(sideId),
            supplyCapacity: this._research.supplyCapacity(sideId)
        };
    }

    /**
     * Validate and place an order at an owned location. Nothing is paid up front; it is
     * funded over the following turns. With `instantBuild` it is funded straight away from
     * any of the side's stockpiles and completes if that covers it (a ship still waits
     * while enemy warships hold the location's hex).
     */
    build(
        sideId: SideId | null,
        locationId: EntityId,
        item: BuildItem,
        priority: BuildPriority = DEFAULT_BUILD_PRIORITY
    ): BuildResult {
        const owned = this._owned(sideId, locationId);
        if (!owned.ok) return owned;
        const { location } = owned;
        const side = location.sideId!;

        const target = this._checkEnhancementTarget(side, location, item);
        if (!target.ok) return target;
        const check = canBuild(
            {
                shipCount: this.shipCount(side),
                shipCap: this.shipCap(side),
                techs: this._research.techs(side),
                researching: this._researching(side),
                targetTier: target.tier,
                balance: this._balance
            },
            this._view(location),
            item
        );
        if (!check.ok) return { ok: false, error: check.reason };

        const record = this._record(location.id);
        const order = createBuildOrder(
            `order-${this._nextOrderSeq++}`,
            item,
            this._balance,
            priority
        );
        record.orders.push(order);

        const active = this.activeOrders(location.id).some((o) => o.id === order.id);
        if (!this._instantBuild || !active) {
            return { ok: true, order: { ...order }, completed: false };
        }

        this._fundFromAnywhere(side, location, order);
        if (!isFullyFunded(order)) return { ok: true, order: { ...order }, completed: false };
        const completion = this._complete(side, location, order);
        if (completion.done) {
            record.orders = record.orders.filter((o) => o.id !== order.id);
        }
        return {
            ok: true,
            order: { ...order },
            completed: completion.done,
            spawnedShip: completion.ship,
            spawnedUnit: completion.unit
        };
    }

    /** Remove an order; whatever it had drawn goes back into the local stockpile. */
    cancel(sideId: SideId | null, locationId: EntityId, orderId: OrderId): EconomyResult {
        const owned = this._owned(sideId, locationId);
        if (!owned.ok) return owned;
        const record = this._record(locationId);
        if (!record.orders.some((o) => o.id === orderId)) {
            return { ok: false, error: `No order ${orderId} at ${locationId}` };
        }
        this._cancelOrders(locationId, (o) => o.id === orderId);
        return { ok: true };
    }

    setPriority(
        sideId: SideId | null,
        locationId: EntityId,
        orderId: OrderId,
        priority: BuildPriority
    ): EconomyResult {
        const owned = this._owned(sideId, locationId);
        if (!owned.ok) return owned;
        const order = this._record(locationId).orders.find((o) => o.id === orderId);
        if (!order) return { ok: false, error: `No order ${orderId} at ${locationId}` };
        order.priority = priority;
        return { ok: true };
    }

    /**
     * Consume a colonising ship on an unowned planet, moon or mineable asteroid's hex to
     * claim it. The ship's crew settle there and start its stockpile.
     */
    colonise(sideId: SideId | null, locationId: EntityId, shipId: EntityId): ColoniseResult {
        if (!sideId || !this._sideIds.includes(sideId)) {
            return { ok: false, error: "You are not assigned to a side" };
        }
        const location = this.locationEntity(locationId);
        if (!location) return { ok: false, error: `Unknown location ${locationId}` };
        if (!siteForEntity(location)) {
            return { ok: false, error: "Only mineable asteroids can be colonised" };
        }
        const ship = this._entities.getOfKind(shipId, "ship");
        if (!ship) return { ok: false, error: `Unknown ship ${shipId}` };
        if (ship.sideId !== sideId) return { ok: false, error: `Ship ${shipId} is not yours` };
        const def = shipDef(ship.shipType, this._balance);
        if (!def.canColonise) return { ok: false, error: `${def.name} cannot colonise` };
        if (ship.q !== location.q || ship.r !== location.r) {
            return { ok: false, error: "Ship is not at the location" };
        }
        if (location.sideId !== null) return { ok: false, error: "Location is already owned" };
        if (hasEnemyWarships(this._entities, location, sideId)) {
            return { ok: false, error: "Enemy ships are at the location" };
        }

        this._cancelEnhancementsFor("ship", ship.id);
        this._entities.remove(ship.id);
        this._crewFrom.delete(ship.id);
        location.sideId = sideId;
        const record: LocationRecord = {
            home: this._locations.get(location.id)?.home ?? false,
            stockpile: zeroResources(),
            installations: [],
            orders: []
        };
        record.stockpile = minResources(
            { ...zeroResources(), population: def.cost.population },
            this._cap(record)
        );
        this._locations.set(location.id, record);
        return { ok: true, location, consumedShipId: ship.id };
    }

    /**
     * Step 1: planet base income and installation output go into each local stockpile;
     * whatever doesn't fit under its cap is lost.
     */
    produce(): void {
        for (const sideId of this._sideIds) {
            let total = zeroResources();
            for (const location of this.ownedLocations(sideId)) {
                const income = locationIncome(this._view(location), this._balance);
                const record = this._record(location.id);
                record.stockpile = depositCapped(
                    record.stockpile,
                    income,
                    this._cap(record)
                ).stockpile;
                total = addResources(total, income);
            }
            this._lastIncome.set(sideId, total);
        }
    }

    /**
     * Steps 4 and 5: every active order draws from its local stockpile (see `fundOrders`),
     * then fully funded orders complete. A finished ship waits while enemy warships hold its hex.
     */
    fundAndComplete(): EconomyAdvance {
        const result: EconomyAdvance = { completed: [], spawnedShips: [], spawnedUnits: [] };
        for (const sideId of this._sideIds) {
            for (const location of this.ownedLocations(sideId)) {
                const record = this._record(location.id);
                const funded = fundOrders(record.stockpile, this.activeOrders(location.id));
                record.stockpile = funded.stockpile;
                const applied = new Map(funded.orders.map((o) => [o.id, o.applied]));
                for (const order of record.orders) {
                    order.applied = applied.get(order.id) ?? order.applied;
                }

                for (const order of [...record.orders]) {
                    if (!isFullyFunded(order)) continue;
                    const completion = this._complete(sideId, location, order);
                    if (!completion.done) continue;
                    record.orders = record.orders.filter((o) => o.id !== order.id);
                    result.completed.push({
                        sideId,
                        locationId: location.id,
                        orderId: order.id,
                        item: order.item
                    });
                    if (completion.ship) result.spawnedShips.push(completion.ship);
                    if (completion.unit) result.spawnedUnits.push(completion.unit);
                }
            }
        }
        return result;
    }

    /** Steps 1, 4 and 5 without supply movement (for callers with no SupplyManager). */
    advanceTurn(): EconomyAdvance {
        this.produce();
        return this.fundAndComplete();
    }

    /** Add delivered cargo to a location's stockpile, up to its cap; returns what was taken in. */
    deposit(locationId: EntityId, resources: Resources): Resources {
        const record = this._record(locationId);
        const deposit = depositCapped(record.stockpile, resources, this._cap(record));
        record.stockpile = deposit.stockpile;
        return deposit.accepted;
    }

    /** Add to a location's stockpile ignoring its cap (population returning home, refunds). */
    depositUncapped(locationId: EntityId, resources: Resources): void {
        const record = this._record(locationId);
        record.stockpile = addResources(record.stockpile, resources);
    }

    /** Take up to `resources` from a location's stockpile; returns what was taken. */
    withdraw(locationId: EntityId, resources: Resources): Resources {
        const record = this._record(locationId);
        const taken = minResources(record.stockpile, resources);
        record.stockpile = subtractResources(record.stockpile, taken);
        return taken;
    }

    releasePopulation(release: ReleasedPopulation): void {
        if (release.amount > 0) this._released.push({ ...release, from: { ...release.from } });
    }

    /** Released population queued since the last call. */
    takeReleased(): ReleasedPopulation[] {
        const released = this._released;
        this._released = [];
        return released;
    }

    /** Put back releases that couldn't be shipped this turn. */
    requeueReleased(released: ReleasedPopulation[]): void {
        this._released.push(...released);
    }

    /**
     * Bookkeeping for ships about to be removed after a lost battle: upgrades are
     * cancelled, crews are released to go home and units aboard transports are destroyed
     * (their population is lost). Returns the destroyed unit ids.
     */
    onShipsDestroyed(ships: EntityOf<"ship">[]): EntityId[] {
        const destroyedUnitIds: EntityId[] = [];
        for (const ship of ships) {
            this._cancelEnhancementsFor("ship", ship.id);
            for (const unitId of ship.carriedUnitIds ?? []) {
                this._cancelEnhancementsFor("groundUnit", unitId);
                if (this._units.remove(unitId)) destroyedUnitIds.push(unitId);
            }
            this.releasePopulation({
                sideId: ship.sideId,
                amount: this._balance.ships[ship.shipType].cost.population,
                homeId: this._crewFrom.get(ship.id),
                from: { q: ship.q, r: ship.r }
            });
            this._crewFrom.delete(ship.id);
        }
        return destroyedUnitIds;
    }

    /** Ground units destroyed in a ground battle; their population goes home. */
    onUnitsDestroyed(unitIds: EntityId[], from: AxialCoord): void {
        for (const unitId of unitIds) {
            this._cancelEnhancementsFor("groundUnit", unitId);
            const unit = this._units.remove(unitId);
            if (!unit) continue;
            this.releasePopulation({
                sideId: unit.sideId,
                amount: this._balance.groundUnits[unit.unitType].cost.population,
                homeId: unit.populationFrom,
                from
            });
        }
    }

    /**
     * An upgrade needs its ship to stay at the location; moving away cancels it and what
     * was delivered stays in that location's stockpile. Returns whether anything was cancelled.
     */
    onShipMoved(ship: EntityOf<"ship">): boolean {
        return this._cancelEnhancementsFor("ship", ship.id, (location) => {
            return location.q !== ship.q || location.r !== ship.r;
        });
    }

    /** A unit leaving its garrison (e.g. boarding a transport) cancels its upgrade. */
    onUnitMoved(unitId: EntityId): boolean {
        return this._cancelEnhancementsFor("groundUnit", unitId);
    }

    /**
     * Hand a location to its captor: orders there are cancelled (refunds stay in the
     * stockpile), and the stockpile and installations pass to the new owner.
     */
    captureLocation(locationId: EntityId, captorSideId: SideId): void {
        const location = this.locationEntity(locationId);
        if (!location) return;
        this._cancelOrders(locationId, () => true);
        const record = this._record(locationId);
        for (const installation of record.installations) installation.populationFrom = locationId;
        location.sideId = captorSideId;
    }

    /** Remove an installation; its borrowed population goes home. */
    demolish(sideId: SideId | null, locationId: EntityId, installationId: EntityId): EconomyResult {
        const owned = this._owned(sideId, locationId);
        if (!owned.ok) return owned;
        const record = this._record(locationId);
        const installation = record.installations.find((i) => i.id === installationId);
        if (!installation) return { ok: false, error: `No installation ${installationId}` };
        this._cancelEnhancementsFor("installation", installationId);
        record.installations = record.installations.filter((i) => i.id !== installationId);
        this.releasePopulation({
            sideId: owned.location.sideId!,
            amount: structureDef(installation.type, this._balance).cost.population,
            homeId: installation.populationFrom,
            from: { q: owned.location.q, r: owned.location.r }
        });
        return { ok: true };
    }

    private _checkEnhancementTarget(
        sideId: SideId,
        location: LocationEntity,
        item: BuildItem
    ): { ok: true; tier?: number } | { ok: false; error: string } {
        if (item.kind !== "enhancement") return { ok: true };
        const target = item.target;
        switch (target.kind) {
            case "installation":
                return { ok: true };
            case "ship": {
                const ship = this._entities.getOfKind(target.shipId, "ship");
                if (!ship || ship.sideId !== sideId || ship.shipType !== target.shipType) {
                    return { ok: false, error: `Unknown ship ${target.shipId}` };
                }
                if (ship.q !== location.q || ship.r !== location.r) {
                    return { ok: true };
                }
                return { ok: true, tier: ship.tier ?? 1 };
            }
            case "groundUnit": {
                const unit = this._units.get(target.unitId);
                if (!unit || unit.sideId !== sideId || unit.unitType !== target.unitType) {
                    return { ok: false, error: `Unknown unit ${target.unitId}` };
                }
                const garrisoned = (location.garrison ?? []).includes(unit.id);
                return garrisoned ? { ok: true, tier: unit.tier } : { ok: true };
            }
        }
    }

    private _researching(sideId: SideId): TechId[] {
        const techs: TechId[] = [];
        for (const location of this.ownedLocations(sideId)) {
            for (const order of this._record(location.id).orders) {
                if (order.item.kind === "research") techs.push(order.item.techId);
            }
        }
        return techs;
    }

    /** `instantBuild`: fund the order from its own stockpile, then the nearest others. */
    private _fundFromAnywhere(sideId: SideId, location: LocationEntity, order: BuildOrder) {
        const sources = this.ownedLocations(sideId).sort(
            (a, b) => axialDistance(a, location) - axialDistance(b, location)
        );
        for (const source of sources) {
            const need = remainingNeed(order);
            const taken = this.withdraw(source.id, need);
            order.applied = addResources(order.applied, taken);
        }
    }

    private _complete(sideId: SideId, location: LocationEntity, order: BuildOrder): Completion {
        const item = order.item;
        const record = this._record(location.id);
        switch (item.kind) {
            case "structure":
                record.installations.push({
                    id: this._newInstallationId(),
                    type: item.structureType,
                    tier: 1,
                    populationFrom: location.id
                });
                return { done: true };
            case "ship": {
                if (hasEnemyWarships(this._entities, location, sideId)) return { done: false };
                const ship = this._spawnShip(location, sideId, item.shipType);
                if (borrowedPopulation(item, this._balance) > 0) {
                    this._crewFrom.set(ship.id, location.id);
                }
                return { done: true, ship };
            }
            case "groundUnit": {
                const unit = this._units.create(sideId, item.unitType, location.id, location.id);
                return { done: true, unit };
            }
            case "research":
                this._research.add(sideId, item.techId);
                return { done: true };
            case "enhancement":
                this._applyEnhancement(record, item.target, item.tier);
                return { done: true };
        }
    }

    private _applyEnhancement(record: LocationRecord, target: EnhancementTarget, tier: number) {
        switch (target.kind) {
            case "installation": {
                const installation = record.installations.find(
                    (i) => i.id === target.installationId
                );
                if (installation) installation.tier = tier;
                return;
            }
            case "ship": {
                const ship = this._entities.getOfKind(target.shipId, "ship");
                if (!ship) return;
                const before = shipStats(ship.shipType, ship.tier ?? 1, this._balance);
                const after = shipStats(ship.shipType, tier, this._balance);
                ship.tier = tier;
                ship.hp = (ship.hp ?? before.hp) + (after.hp - before.hp);
                ship.movementPoints += after.maxMovementPoints - ship.maxMovementPoints;
                ship.maxMovementPoints = after.maxMovementPoints;
                return;
            }
            case "groundUnit": {
                const unit = this._units.get(target.unitId);
                if (unit) unit.tier = tier;
                return;
            }
        }
    }

    /**
     * Cancel enhancement orders aimed at one target (optionally only at locations matching
     * `where`), refunding into each order's location. Returns whether any were cancelled.
     */
    private _cancelEnhancementsFor(
        kind: EnhancementTarget["kind"],
        targetId: EntityId,
        where: (location: LocationEntity) => boolean = () => true
    ): boolean {
        let cancelled = false;
        for (const [locationId, record] of this._locations) {
            const matches = (o: BuildOrder) =>
                o.item.kind === "enhancement" &&
                o.item.target.kind === kind &&
                enhancementTargetId(o.item.target) === targetId;
            if (!record.orders.some(matches)) continue;
            const location = this.locationEntity(locationId);
            if (location && !where(location)) continue;
            this._cancelOrders(locationId, matches);
            cancelled = true;
        }
        return cancelled;
    }

    /** Remove matching orders at a location, refunding into its stockpile and dropping cargo reservations. */
    private _cancelOrders(locationId: EntityId, matches: (order: BuildOrder) => boolean) {
        const record = this._record(locationId);
        const cancelled = record.orders.filter(matches);
        if (cancelled.length === 0) return;
        record.orders = record.orders.filter((o) => !matches(o));
        for (const order of cancelled) {
            record.stockpile = addResources(record.stockpile, order.applied);
        }
        const ids = new Set(cancelled.map((o) => o.id));
        for (const ship of this._entities.ofKind("supply_ship")) {
            if (ship.reservedFor.some((r) => ids.has(r.orderId))) {
                ship.reservedFor = ship.reservedFor.filter((r) => !ids.has(r.orderId));
            }
        }
    }

    private _newInstallationId(): EntityId {
        let id: EntityId;
        do {
            id = `installation-${this._nextInstallationSeq++}`;
        } while (this._entities.get(id));
        return id;
    }

    private _spawnShip(
        location: LocationEntity,
        sideId: SideId,
        shipType: ShipType
    ): EntityOf<"ship"> {
        const info = SHIP_TYPE_INFO[shipType];
        const stats = shipStats(shipType, 1, this._balance);
        let id: EntityId;
        do {
            id = `ship-built-${this._nextShipSeq++}`;
        } while (this._entities.get(id));

        const number =
            this._entities
                .ofKind("ship")
                .filter((s) => s.sideId === sideId && s.shipType === shipType).length + 1;
        const sun = this._entities
            .ofKind("sun")
            .find(
                (s) =>
                    s.systemId === location.systemId && (s.q !== location.q || s.r !== location.r)
            );

        return this._entities.add<EntityOf<"ship">>({
            id,
            kind: "ship",
            shipType,
            name: `${info.name} ${number}`,
            q: location.q,
            r: location.r,
            facing: sun ? axialDirectionTowards(sun, location) : 0,
            sideId,
            movementPoints: stats.maxMovementPoints,
            maxMovementPoints: stats.maxMovementPoints,
            hp: stats.hp,
            scale: info.scale,
            ...(this._balance.ships[shipType].unitCapacity ? { carriedUnitIds: [] } : {})
        });
    }

    private _owned(
        sideId: SideId | null,
        locationId: EntityId
    ): { ok: true; location: LocationEntity } | { ok: false; error: string } {
        if (!sideId || !this._sideIds.includes(sideId)) {
            return { ok: false, error: "You are not assigned to a side" };
        }
        const location = this.locationEntity(locationId);
        if (!location) return { ok: false, error: `Unknown location ${locationId}` };
        if (location.sideId !== sideId) {
            return { ok: false, error: `Location ${locationId} is not yours` };
        }
        return { ok: true, location };
    }

    private _record(locationId: EntityId): LocationRecord {
        let record = this._locations.get(locationId);
        if (!record) {
            record = { home: false, stockpile: zeroResources(), installations: [], orders: [] };
            this._locations.set(locationId, record);
        }
        return record;
    }

    private _cap(record: LocationRecord): Resources {
        return stockpileCap(record, this._balance);
    }

    private _view(location: LocationEntity): LocationEconomy {
        const record = this._record(location.id);
        return {
            locationId: location.id,
            site: siteForEntity(location) ?? "asteroid",
            level: location.kind === "planet" ? location.level : 0,
            slots: slotsForEntity(location),
            ...(record.home ? { home: true } : {}),
            stockpile: { ...record.stockpile },
            installations: record.installations.map((i) => ({ ...i })),
            orders: record.orders.map((o) => ({
                ...o,
                item: structuredClone(o.item),
                cost: { ...o.cost },
                applied: { ...o.applied },
                ratePerTurn: { ...o.ratePerTurn }
            }))
        };
    }

    private _economies(sideId: SideId): LocationEconomy[] {
        return this.ownedLocations(sideId).map((location) => this._view(location));
    }
}
