import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate, useOutletContext, useParams } from "react-router-dom";
import {
    addResources,
    buildItemCost,
    buildItemName,
    buildItemTurns,
    canBuild,
    DEFAULT_BUILD_PRIORITY,
    fundOrders,
    GROUND_UNIT_TYPES,
    groundUnitStats,
    GroundUnitType,
    isFullyFunded,
    locationIncome,
    RESOURCE_KEYS,
    SHIP_TYPES,
    ShipType,
    siteForEntity,
    slotsForEntity,
    slotsUsed,
    structureOutput,
    STRUCTURE_TYPES,
    StructureType,
    sumResources,
    TECHS,
    TechId,
    zeroResources,
    type BuildContext,
    type BuildItem,
    type BuildOrder,
    type BuildPriority,
    type EntityId,
    type GroundUnit,
    type LocationEconomy,
    type Resources,
    type StructureSite
} from "@space/shared-data";
import {
    formatNumber,
    formatResources,
    RESOURCE_LABELS,
    RESOURCE_SHORT_LABELS
} from "../components/format.js";
import type { GameActions } from "../gameActions.js";
import { useHexWorldVersion } from "../hooks/index.js";
import {
    HexWorld,
    isLocationEntity,
    isTransport,
    type LocationEntity,
    type ShipEntity
} from "../world/HexWorld.js";
import "./PlanetPage.css";

export type GameOutletContext = {
    world: HexWorld;
    actions: GameActions;
};

/** Low to high, as shown in the priority control. */
const PRIORITY_OPTIONS: BuildPriority[] = ["low", "medium", "high"];

const PRIORITY_LABELS: Record<BuildPriority, string> = {
    low: "Low",
    medium: "Medium",
    high: "High"
};

const SITE_LABELS: Record<StructureSite, string> = {
    planet: "Planet",
    moon: "Moon",
    asteroid: "Asteroid"
};

const STRUCTURE_ITEMS: BuildItem[] = StructureType.options.map((structureType) => ({
    kind: "structure",
    structureType
}));

const SHIP_ITEMS: BuildItem[] = ShipType.options.map((shipType) => ({ kind: "ship", shipType }));

const GROUND_UNIT_ITEMS: BuildItem[] = GroundUnitType.options.map((unitType) => ({
    kind: "groundUnit",
    unitType
}));

function itemKey(item: BuildItem): string {
    switch (item.kind) {
        case "structure":
            return `structure:${item.structureType}`;
        case "ship":
            return `ship:${item.shipType}`;
        case "groundUnit":
            return `groundUnit:${item.unitType}`;
        case "research":
            return `research:${item.techId}`;
        case "enhancement":
            return `enhancement:${item.target.kind}:${item.tier}`;
    }
}

function sideName(sideId: string): string {
    return sideId.charAt(0).toUpperCase() + sideId.slice(1);
}

function locationKindLabel(location: LocationEntity): string {
    const site = siteForEntity(location);
    return site ? SITE_LABELS[site] : "Asteroid";
}

function outputSummary(output: Partial<Resources>): string[] {
    return RESOURCE_KEYS.filter((key) => output[key]).map(
        (key) => `+${formatNumber(output[key] ?? 0)} ${RESOURCE_SHORT_LABELS[key]}/turn`
    );
}

function itemSummary(item: BuildItem): string {
    switch (item.kind) {
        case "ship": {
            const def = SHIP_TYPES[item.shipType];
            const parts = [`MP ${def.maxMovementPoints}`, `HP ${def.hp}`];
            if (def.canColonise) parts.push("Can colonise");
            if (def.unitCapacity) parts.push(`Carries ${def.unitCapacity} units`);
            return parts.join(" · ");
        }
        case "structure": {
            const def = STRUCTURE_TYPES[item.structureType];
            return [def.description, ...outputSummary(def.produces ?? {})].join(" ");
        }
        case "groundUnit": {
            const def = GROUND_UNIT_TYPES[item.unitType];
            return `${def.description} Attack ${def.attack} · Defence ${def.defence}`;
        }
        case "research":
            return TECHS[item.techId].description;
        case "enhancement":
            return "";
    }
}

function CostList({ cost }: { cost: Resources }) {
    return (
        <span className="planet-page__cost">
            {RESOURCE_KEYS.filter((key) => cost[key] > 0).map((key) => (
                <span key={key} className={`planet-page__cost-item planet-page__cost-item--${key}`}>
                    {formatNumber(cost[key])} {RESOURCE_SHORT_LABELS[key]}
                </span>
            ))}
        </span>
    );
}

function PriorityPicker({
    value,
    onChange,
    label
}: {
    value: BuildPriority;
    onChange: (priority: BuildPriority) => void;
    label: string;
}) {
    return (
        <span className="planet-page__priority" role="group" aria-label={label}>
            {PRIORITY_OPTIONS.map((priority) => (
                <button
                    key={priority}
                    type="button"
                    aria-pressed={value === priority}
                    className={`planet-page__priority-option planet-page__priority-option--${priority}${
                        value === priority ? " planet-page__priority-option--active" : ""
                    }`}
                    onClick={() => value !== priority && onChange(priority)}
                >
                    {PRIORITY_LABELS[priority]}
                </button>
            ))}
        </span>
    );
}

/** Applied vs cost per resource, with next turn's estimated draw as a lighter segment. */
function FundingBars({ order, draw }: { order: BuildOrder; draw: Resources }) {
    return (
        <div className="planet-page__funding">
            {RESOURCE_KEYS.filter((key) => order.cost[key] > 0).map((key) => {
                const cost = order.cost[key];
                const applied = Math.min(cost, order.applied[key]);
                return (
                    <div key={key} className="planet-page__funding-row">
                        <span className={`planet-page__cost-item--${key}`}>
                            {RESOURCE_SHORT_LABELS[key]}
                        </span>
                        <div className="planet-page__progress">
                            <div
                                className="planet-page__progress-fill"
                                style={{ width: `${(applied / cost) * 100}%` }}
                            />
                            <div
                                className="planet-page__progress-next"
                                style={{
                                    width: `${(Math.min(draw[key], cost - applied) / cost) * 100}%`
                                }}
                            />
                        </div>
                        <span className="planet-page__funding-amount">
                            {formatNumber(applied)}/{formatNumber(cost)}
                            {draw[key] > 0 && (
                                <span className="planet-page__next">
                                    {" "}
                                    +{formatNumber(draw[key])}
                                </span>
                            )}
                        </span>
                    </div>
                );
            })}
        </div>
    );
}

type OptionProps = {
    item: BuildItem;
    context: BuildContext;
    economy: LocationEconomy;
    onBuild: (item: BuildItem) => void;
    label?: string;
};

function BuildOption({ item, context, economy, onBuild, label = "Build" }: OptionProps) {
    const check = canBuild(context, economy, item);
    const reason = check.ok ? undefined : check.reason;
    const summary = itemSummary(item);
    const turns = buildItemTurns(item);
    return (
        <li className="planet-page__option">
            <div className="planet-page__option-main">
                <strong>{buildItemName(item)}</strong>
                {summary && <span className="planet-page__muted">{summary}</span>}
                <span className="planet-page__option-meta">
                    <CostList cost={buildItemCost(item)} />
                    <span className="planet-page__turns">
                        {turns} turn{turns === 1 ? "" : "s"} min
                    </span>
                </span>
                {reason && <span className="planet-page__reason">{reason}</span>}
            </div>
            <button
                type="button"
                disabled={!check.ok}
                title={reason ?? `Order ${buildItemName(item)}`}
                onClick={() => onBuild(item)}
            >
                {label}
            </button>
        </li>
    );
}

/** Compact "Upgrade to Tn" button for one installation, ship or ground unit. */
function UpgradeButton({
    item,
    context,
    economy,
    onBuild
}: {
    item: BuildItem;
    context: BuildContext;
    economy: LocationEconomy;
    onBuild: (item: BuildItem) => void;
}) {
    if (item.kind !== "enhancement") return null;
    const check = canBuild(context, economy, item);
    const cost = formatResources(buildItemCost(item), "free");
    return (
        <button
            type="button"
            className="planet-page__upgrade"
            disabled={!check.ok}
            title={check.ok ? `Upgrade to tier ${item.tier}: ${cost}` : check.reason}
            onClick={() => onBuild(item)}
        >
            Upgrade to T{item.tier}
        </button>
    );
}

function unitLabel(unit: GroundUnit): string {
    const stats = groundUnitStats(unit.unitType, unit.tier);
    return `${GROUND_UNIT_TYPES[unit.unitType].name} T${unit.tier} · ${stats.attack}/${stats.defence}`;
}

type OwnLocationProps = {
    world: HexWorld;
    location: LocationEntity;
    economy: LocationEconomy;
    context: BuildContext;
    actions: GameActions;
};

function OwnLocationPanel({ world, location, economy, context, actions }: OwnLocationProps) {
    const [newPriority, setNewPriority] = useState<BuildPriority>(DEFAULT_BUILD_PRIORITY);
    const locationId = location.id;
    const onBuild = (item: BuildItem) => actions.build(locationId, item, newPriority);

    const used = slotsUsed(economy);
    const income = locationIncome(economy);
    const supplyShips = world.economy?.supplyShips ?? [];
    const inbound = supplyShips.filter((s) => s.destinationId === locationId);
    const inboundCargo = sumResources(inbound.map((s) => s.cargo));
    const arrivingCargo = sumResources(
        inbound
            .filter((s) => s.route && s.route.length > 0 && s.route.length <= s.speed)
            .map((s) => s.cargo)
    );
    // End of turn adds production and arrivals to the stockpile before funding.
    const preview = fundOrders(
        addResources(addResources(economy.stockpile, income), arrivingCargo),
        economy.orders
    );

    const garrison = world.garrisonAt(locationId);
    const shipsHere = world.ownShipsAt(location.q, location.r);
    const transports = shipsHere.filter(isTransport);
    const hasAcademy = economy.installations.some((i) => STRUCTURE_TYPES[i.type].enablesResearch);
    const trainsUnits = economy.installations.some(
        (i) => STRUCTURE_TYPES[i.type].unlocksGroundUnits?.length
    );
    const techs = world.economy?.techs ?? [];
    const pendingGround = world.groundBattleAt(locationId);

    const roomOn = (ship: ShipEntity) =>
        (SHIP_TYPES[ship.shipType].unitCapacity ?? 0) - world.carriedUnitIds(ship).length;

    return (
        <>
            {pendingGround && (
                <p className="planet-page__alert">
                    Under invasion by {sideName(pendingGround.attackerSideId)}. Awaiting the outcome
                    of the ground battle.
                </p>
            )}

            <section className="planet-page__section">
                <h3>
                    Stockpile <span className="planet-page__muted">held here</span>
                </h3>
                <ul className="planet-page__stockpile">
                    {RESOURCE_KEYS.map((key) => (
                        <li key={key} className="planet-page__stock">
                            <span
                                className={`planet-page__stock-label planet-page__cost-item--${key}`}
                            >
                                {RESOURCE_LABELS[key]}
                            </span>
                            <strong>{formatNumber(economy.stockpile[key])}</strong>
                            <span className="planet-page__muted">
                                {income[key] > 0 && `+${formatNumber(income[key])}/turn`}
                                {inboundCargo[key] > 0 &&
                                    ` · ${formatNumber(inboundCargo[key])} inbound`}
                            </span>
                        </li>
                    ))}
                </ul>
                {inbound.length > 0 && (
                    <p className="planet-page__muted">
                        {inbound.length} supply ship{inbound.length === 1 ? "" : "s"} on the way;{" "}
                        {formatResources(arrivingCargo, "none")} arriving next turn.
                    </p>
                )}
            </section>

            <section className="planet-page__section">
                <h3>
                    Installations{" "}
                    <span className="planet-page__muted">
                        {used}/{economy.slots} slots used
                    </span>
                </h3>
                <div
                    className="planet-page__slots"
                    role="meter"
                    aria-valuemin={0}
                    aria-valuemax={economy.slots}
                    aria-valuenow={used}
                >
                    <div
                        className="planet-page__slots-fill"
                        style={{
                            width: `${economy.slots ? Math.min(100, (used / economy.slots) * 100) : 0}%`
                        }}
                    />
                </div>
                {economy.installations.length ? (
                    <ul className="planet-page__list">
                        {economy.installations.map((inst) => {
                            const def = STRUCTURE_TYPES[inst.type];
                            const output = outputSummary(structureOutput(inst.type, inst.tier));
                            return (
                                <li key={inst.id} className="planet-page__row">
                                    <span>
                                        <strong>{def.name}</strong>{" "}
                                        <span className="planet-page__tier">T{inst.tier}</span>
                                        {output.length > 0 && (
                                            <span className="planet-page__muted">
                                                {" "}
                                                {output.join(" ")}
                                            </span>
                                        )}
                                    </span>
                                    {inst.tier < def.maxTier && (
                                        <UpgradeButton
                                            item={{
                                                kind: "enhancement",
                                                target: {
                                                    kind: "installation",
                                                    installationId: inst.id,
                                                    structureType: inst.type
                                                },
                                                tier: inst.tier + 1
                                            }}
                                            context={context}
                                            economy={economy}
                                            onBuild={onBuild}
                                        />
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                ) : (
                    <p className="planet-page__muted">No installations built yet.</p>
                )}
            </section>

            <section className="planet-page__section">
                <h3>
                    Orders{" "}
                    <span className="planet-page__muted">
                        funded from the stockpile by priority
                    </span>
                </h3>
                {economy.orders.length ? (
                    <ol className="planet-page__queue">
                        {preview.orders.map((next, index) => {
                            const order = economy.orders[index];
                            const draw = preview.drawn[order.id] ?? zeroResources();
                            const status = isFullyFunded(order)
                                ? "Fully funded · completes at end of turn"
                                : isFullyFunded(next)
                                  ? "Completes at end of turn"
                                  : RESOURCE_KEYS.some((k) => draw[k] > 0)
                                    ? "Funding"
                                    : "Waiting for resources";
                            return (
                                <li key={order.id} className="planet-page__queue-entry">
                                    <div className="planet-page__queue-main">
                                        <span className="planet-page__order-head">
                                            <span>
                                                <strong>{buildItemName(order.item)}</strong>{" "}
                                                <span className="planet-page__muted">{status}</span>
                                            </span>
                                            <PriorityPicker
                                                label={`Priority for ${buildItemName(order.item)}`}
                                                value={order.priority}
                                                onChange={(priority) =>
                                                    actions.setPriority(
                                                        locationId,
                                                        order.id,
                                                        priority
                                                    )
                                                }
                                            />
                                        </span>
                                        <FundingBars order={order} draw={draw} />
                                    </div>
                                    <button
                                        type="button"
                                        title="Cancel; resources already applied go into this stockpile"
                                        onClick={() => actions.cancel(locationId, order.id)}
                                    >
                                        Cancel
                                    </button>
                                </li>
                            );
                        })}
                    </ol>
                ) : (
                    <p className="planet-page__muted">Nothing on order.</p>
                )}
                <p className="planet-page__muted planet-page__new-priority">
                    New orders{" "}
                    <PriorityPicker
                        label="Priority for new orders"
                        value={newPriority}
                        onChange={setNewPriority}
                    />
                </p>
                {economy.orders.length > 0 && (
                    <p className="planet-page__muted">
                        Lighter bar segments estimate next turn&apos;s draw, including this
                        location&apos;s production and cargo due to arrive.
                    </p>
                )}
            </section>

            <section className="planet-page__section">
                <h3>
                    Garrison{" "}
                    <span className="planet-page__muted">
                        {garrison.length} unit{garrison.length === 1 ? "" : "s"}
                    </span>
                </h3>
                {garrison.length ? (
                    <ul className="planet-page__list">
                        {garrison.map((unit) => (
                            <li key={unit.id} className="planet-page__row">
                                <span>{unitLabel(unit)}</span>
                                <span className="planet-page__row-actions">
                                    {transports.map((ship) => (
                                        <button
                                            key={ship.id}
                                            type="button"
                                            disabled={roomOn(ship) <= 0}
                                            title={
                                                roomOn(ship) > 0
                                                    ? `Board ${ship.name ?? "transport"}`
                                                    : `${ship.name ?? "Transport"} is full`
                                            }
                                            onClick={() => actions.load(ship.id, [unit.id])}
                                        >
                                            Load
                                            {transports.length > 1 && ` → ${ship.name ?? ship.id}`}
                                        </button>
                                    ))}
                                    {unit.tier < GROUND_UNIT_TYPES[unit.unitType].maxTier && (
                                        <UpgradeButton
                                            item={{
                                                kind: "enhancement",
                                                target: {
                                                    kind: "groundUnit",
                                                    unitId: unit.id,
                                                    unitType: unit.unitType
                                                },
                                                tier: unit.tier + 1
                                            }}
                                            context={{ ...context, targetTier: unit.tier }}
                                            economy={economy}
                                            onBuild={onBuild}
                                        />
                                    )}
                                </span>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="planet-page__muted">No ground units stationed here.</p>
                )}
            </section>

            {shipsHere.length > 0 && (
                <section className="planet-page__section">
                    <h3>
                        Ships in orbit{" "}
                        <span className="planet-page__muted">
                            upgrades are lost if the ship leaves first
                        </span>
                    </h3>
                    <ul className="planet-page__list">
                        {shipsHere.map((ship) => {
                            const tier = ship.tier ?? 1;
                            const def = SHIP_TYPES[ship.shipType];
                            const aboard = isTransport(ship)
                                ? world.carriedUnitIds(ship).map((id) => ({
                                      id,
                                      unit: world.groundUnit(id)
                                  }))
                                : [];
                            return (
                                <li key={ship.id} className="planet-page__ship">
                                    <div className="planet-page__row">
                                        <span>
                                            <strong>{ship.name ?? def.name}</strong>{" "}
                                            <span className="planet-page__tier">T{tier}</span>
                                            <span className="planet-page__muted"> {def.name}</span>
                                        </span>
                                        <span className="planet-page__row-actions">
                                            {aboard.length > 1 && (
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        actions.unload(
                                                            ship.id,
                                                            locationId,
                                                            aboard.map((a) => a.id)
                                                        )
                                                    }
                                                >
                                                    Unload all
                                                </button>
                                            )}
                                            {tier < def.maxTier && (
                                                <UpgradeButton
                                                    item={{
                                                        kind: "enhancement",
                                                        target: {
                                                            kind: "ship",
                                                            shipId: ship.id,
                                                            shipType: ship.shipType
                                                        },
                                                        tier: tier + 1
                                                    }}
                                                    context={{ ...context, targetTier: tier }}
                                                    economy={economy}
                                                    onBuild={onBuild}
                                                />
                                            )}
                                        </span>
                                    </div>
                                    {isTransport(ship) && (
                                        <ul className="planet-page__aboard">
                                            {aboard.map(({ id, unit }) => (
                                                <li key={id} className="planet-page__row">
                                                    <span>{unit ? unitLabel(unit) : id}</span>
                                                    <button
                                                        type="button"
                                                        title="Land into this garrison"
                                                        onClick={() =>
                                                            actions.unload(ship.id, locationId, [
                                                                id
                                                            ])
                                                        }
                                                    >
                                                        Unload
                                                    </button>
                                                </li>
                                            ))}
                                            <li className="planet-page__muted">
                                                {aboard.length}/{def.unitCapacity} aboard
                                            </li>
                                        </ul>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                </section>
            )}

            {hasAcademy && (
                <section className="planet-page__section">
                    <h3>
                        Research{" "}
                        <span className="planet-page__muted">
                            {techs.length}/{TechId.options.length} techs known
                        </span>
                    </h3>
                    <ul className="planet-page__options">
                        {TechId.options.map((techId) =>
                            techs.includes(techId) ? (
                                <li
                                    key={techId}
                                    className="planet-page__option planet-page__option--known"
                                >
                                    <div className="planet-page__option-main">
                                        <strong>{TECHS[techId].name}</strong>
                                        <span className="planet-page__muted">
                                            {TECHS[techId].description}
                                        </span>
                                    </div>
                                    <span className="planet-page__tier">Known</span>
                                </li>
                            ) : (
                                <BuildOption
                                    key={techId}
                                    item={{ kind: "research", techId }}
                                    context={context}
                                    economy={economy}
                                    onBuild={onBuild}
                                    label="Research"
                                />
                            )
                        )}
                    </ul>
                </section>
            )}

            <section className="planet-page__section">
                <h3>Build installations</h3>
                <ul className="planet-page__options">
                    {STRUCTURE_ITEMS.filter(
                        (item) =>
                            item.kind === "structure" &&
                            STRUCTURE_TYPES[item.structureType].sites.includes(economy.site)
                    ).map((item) => (
                        <BuildOption
                            key={itemKey(item)}
                            item={item}
                            context={context}
                            economy={economy}
                            onBuild={onBuild}
                        />
                    ))}
                </ul>
            </section>

            {STRUCTURE_TYPES.barracks.sites.includes(economy.site) && (
                <section className="planet-page__section">
                    <h3>Train ground units</h3>
                    {!trainsUnits && (
                        <p className="planet-page__muted">Build a Barracks here to train units.</p>
                    )}
                    <ul className="planet-page__options">
                        {GROUND_UNIT_ITEMS.map((item) => (
                            <BuildOption
                                key={itemKey(item)}
                                item={item}
                                context={context}
                                economy={economy}
                                onBuild={onBuild}
                            />
                        ))}
                    </ul>
                </section>
            )}

            {economy.site === "planet" && (
                <section className="planet-page__section">
                    <h3>
                        Build ships{" "}
                        <span className="planet-page__muted">
                            {context.shipCount}/{context.shipCap} ships
                        </span>
                    </h3>
                    <ul className="planet-page__options">
                        {SHIP_ITEMS.map((item) => (
                            <BuildOption
                                key={itemKey(item)}
                                item={item}
                                context={context}
                                economy={economy}
                                onBuild={onBuild}
                            />
                        ))}
                    </ul>
                </section>
            )}
        </>
    );
}

function UnownedLocationPanel({
    world,
    location,
    onColonise
}: {
    world: HexWorld;
    location: LocationEntity;
    onColonise: (shipId: EntityId) => void;
}) {
    if (!siteForEntity(location)) {
        return <p className="planet-page__muted">This asteroid can&apos;t be mined or settled.</p>;
    }
    const colonyShip = world.colonyShipsAt(location.q, location.r)[0];
    return (
        <section className="planet-page__section">
            <h3>Colonise</h3>
            {colonyShip ? (
                <div className="planet-page__colonise">
                    <span>
                        {colonyShip.name ?? "Colony ship"} is in orbit. Colonising uses up the ship.
                    </span>
                    <button
                        type="button"
                        className="planet-page__primary"
                        onClick={() => onColonise(colonyShip.id)}
                    >
                        Colonise
                    </button>
                </div>
            ) : (
                <p className="planet-page__muted">
                    Move a colony ship onto this {locationKindLabel(location).toLowerCase()}
                    &apos;s hex to claim it.
                </p>
            )}
        </section>
    );
}

function EnemyLocationPanel({
    world,
    location,
    onInvade
}: {
    world: HexWorld;
    location: LocationEntity;
    onInvade: (shipIds: EntityId[]) => void;
}) {
    const pending = world.groundBattleAt(location.id);
    const invasion = world.invasionAt(location.q, location.r);
    const landing = invasion
        ? invasion.ships.reduce((n, ship) => n + world.carriedUnitIds(ship).length, 0)
        : 0;
    return (
        <>
            <p className="planet-page__muted">
                Controlled by {location.sideId ? sideName(location.sideId) : "—"}. Its installations
                are hidden.
                {location.garrison &&
                    ` ${location.garrison.length} ground unit${location.garrison.length === 1 ? "" : "s"} seen in the garrison.`}
            </p>
            <section className="planet-page__section">
                <h3>Invade</h3>
                {pending ? (
                    <p className="planet-page__muted">A ground battle is already under way here.</p>
                ) : invasion ? (
                    <div className="planet-page__colonise">
                        <span>
                            {invasion.ships.length} transport
                            {invasion.ships.length === 1 ? "" : "s"} in orbit carrying {landing}{" "}
                            unit
                            {landing === 1 ? "" : "s"}. All of them land and fight the garrison.
                        </span>
                        <button
                            type="button"
                            className="planet-page__primary planet-page__primary--danger"
                            onClick={() => onInvade(invasion.ships.map((s) => s.id))}
                        >
                            Invade
                        </button>
                    </div>
                ) : (
                    <p className="planet-page__muted">
                        Bring transports carrying ground units onto this hex to invade.
                    </p>
                )}
            </section>
        </>
    );
}

export function PlanetPage() {
    const { locationId } = useParams<{ locationId: string }>();
    const { world, actions } = useOutletContext<GameOutletContext>();
    const navigate = useNavigate();
    const routerLocation = useLocation();
    useHexWorldVersion(world);

    const found = locationId ? world.findEntityById(locationId) : undefined;
    const location = found && isLocationEntity(found) ? found : undefined;
    const economy = locationId ? world.locationEconomy(locationId) : undefined;
    const context = world.buildContext;
    const own = !!location?.sideId && location.sideId === world.sideId;
    const kindLabel = location ? locationKindLabel(location) : "Location";

    const back = useCallback(() => {
        navigate({ pathname: "/", search: routerLocation.search });
    }, [navigate, routerLocation.search]);

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") back();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [back]);

    return (
        <div className="planet-page">
            <section className="planet-page__panel">
                <header className="planet-page__header">
                    <h2>
                        {location?.name ?? `Unknown ${kindLabel.toLowerCase()}`}
                        {location && (
                            <span className="planet-page__level">
                                {location.kind === "planet" ? `Level ${location.level}` : kindLabel}
                            </span>
                        )}
                    </h2>
                    <button type="button" onClick={back}>
                        Back to map
                    </button>
                </header>
                <dl className="planet-page__facts">
                    <dt>Id</dt>
                    <dd>
                        <code>{locationId}</code>
                    </dd>
                    <dt>Owner</dt>
                    <dd>
                        {location ? (
                            location.sideId ? (
                                <span
                                    className={`planet-page__side planet-page__side--${location.sideId}`}
                                >
                                    {sideName(location.sideId)}
                                    {own && " (you)"}
                                </span>
                            ) : (
                                "Unclaimed"
                            )
                        ) : (
                            "—"
                        )}
                    </dd>
                    <dt>System</dt>
                    <dd>{location?.systemId ?? "—"}</dd>
                    <dt>Location</dt>
                    <dd>{location ? `${location.q}, ${location.r}` : "—"}</dd>
                    <dt>Slots</dt>
                    <dd>
                        {location
                            ? `${slotsForEntity(location)} installation${slotsForEntity(location) === 1 ? "" : "s"}`
                            : "—"}
                    </dd>
                </dl>
                {!location && (
                    <p className="planet-page__muted">
                        This location is not in your known map (it may be out of sight).
                    </p>
                )}
                {location && own && economy && context && (
                    <OwnLocationPanel
                        world={world}
                        location={location}
                        economy={economy}
                        context={context}
                        actions={actions}
                    />
                )}
                {location && own && !(economy && context) && (
                    <p className="planet-page__muted">Waiting for economy data…</p>
                )}
                {location && !location.sideId && (
                    <UnownedLocationPanel
                        world={world}
                        location={location}
                        onColonise={(shipId) => actions.colonise(location.id, shipId)}
                    />
                )}
                {location && location.sideId && !own && (
                    <EnemyLocationPanel
                        world={world}
                        location={location}
                        onInvade={(shipIds) => actions.invade(location.id, shipIds)}
                    />
                )}
            </section>
        </div>
    );
}
