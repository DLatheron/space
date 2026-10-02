import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { useLocation, useNavigate, useOutletContext, useParams } from "react-router-dom";
import {
    BUILD_CATEGORIES,
    buildCategory,
    buildSlots,
    DEFAULT_BUILD_PRIORITY,
    depositCapped,
    enhancementTargetId,
    fundLocationOrders,
    GROUND_UNIT_TYPE_INFO,
    isDefenceStructure,
    locationIncome,
    partitionOrders,
    queueCategory,
    SHIELD_UPKEEP_ID,
    shieldUpkeepOrder,
    shipDef,
    siteForEntity,
    slotsForEntity,
    slotsUsed,
    stockpileCap,
    structureDef,
    STRUCTURE_INFO,
    sumResources,
    suppliedFraction,
    TechId,
    zeroResources,
    type BuildCategory,
    type BuildContext,
    type BuildItem,
    type BuildPriority,
    type EnhancementTarget,
    type EntityId,
    type Installation,
    type LocationEconomy,
    type StructureSite
} from "@space/shared-data";
import { combatLosses, combatOutcome, combatTitle, sideName } from "../components/combatText.js";
import { ModalHostContext } from "../components/modalHost.js";
import type { GameActions } from "../gameActions.js";
import { useHexWorldVersion } from "../hooks/index.js";
import {
    HexWorld,
    isLocationEntity,
    isTransport,
    type LocationEntity,
    type ShipEntity
} from "../world/HexWorld.js";
import { BuildPopup } from "./location/BuildPopup.js";
import { BuildQueue } from "./location/BuildQueue.js";
import { DefenceTileStats, ShieldPanel } from "./location/DefenceDetails.js";
import { GarrisonList, OrbitList } from "./location/ForcesLists.js";
import { InstallationGrid } from "./location/InstallationGrid.js";
import {
    GROUND_UNIT_ITEMS,
    settleReadyOrders,
    SHIP_ITEMS,
    STRUCTURE_ITEMS,
    upgradeItem
} from "./location/locationItems.js";
import { ResearchTree } from "./location/ResearchTree.js";
import { StockpileStrip } from "./location/StockpileStrip.js";
import { UpgradePopup } from "./location/UpgradePopup.js";
import "./PlanetPage.css";

export type GameOutletContext = {
    world: HexWorld;
    actions: GameActions;
};

const SITE_LABELS: Record<StructureSite, string> = {
    planet: "Planet",
    moon: "Moon",
    asteroid: "Asteroid"
};

function locationKindLabel(location: LocationEntity): string {
    const site = siteForEntity(location);
    return site ? SITE_LABELS[site] : "Asteroid";
}

/** A titled panel of the location screen; only its body scrolls. */
function Card({
    area,
    title,
    detail,
    action,
    children
}: {
    area: string;
    title: string;
    detail?: ReactNode;
    action?: ReactNode;
    children: ReactNode;
}) {
    return (
        <section className={`planet-page__card planet-page__card--${area}`}>
            <header className="planet-page__card-head">
                <h3>
                    {title}
                    {detail !== undefined && <span className="planet-page__muted"> {detail}</span>}
                </h3>
                {action}
            </header>
            <div className="planet-page__card-body">{children}</div>
        </section>
    );
}

function OpenButton({ label, onClick }: { label: string; onClick: () => void }) {
    return (
        <button type="button" className="planet-page__open" onClick={onClick}>
            <span aria-hidden="true">+</span> {label}
        </button>
    );
}

type Popup =
    | { kind: "build"; category: BuildCategory; defences?: boolean }
    | { kind: "upgrade"; target: EnhancementTarget };

type OwnLocationProps = {
    world: HexWorld;
    location: LocationEntity;
    economy: LocationEconomy;
    context: BuildContext;
    actions: GameActions;
};

function OwnLocationPanel({ world, location, economy, context, actions }: OwnLocationProps) {
    const [popup, setPopup] = useState<Popup>();
    const [newPriority, setNewPriority] = useState<BuildPriority>(DEFAULT_BUILD_PRIORITY);
    const locationId = location.id;
    const onBuild = (item: BuildItem) => actions.build(locationId, item, newPriority);
    const closePopup = useCallback(() => setPopup(undefined), []);

    const balance = context.balance;
    const used = slotsUsed(economy, balance);
    const income = locationIncome(economy, balance);
    const cap = stockpileCap(economy, balance);
    const supplyShips = world.economy?.supplyShips ?? [];
    const inbound = supplyShips.filter((s) => s.destinationId === locationId);
    const waitingShips = inbound.filter((s) => s.waiting);
    const inboundCargo = sumResources(inbound.map((s) => s.cargo));
    const arrivingCargo = sumResources(
        inbound
            .filter(
                (s) => s.waiting || (s.route && s.route.length > 0 && s.route.length <= s.speed)
            )
            .map((s) => s.cargo)
    );
    // End of turn completes ready orders, adds production (excess lost) then arrivals (up to
    // the cap) before funding.
    const settled = settleReadyOrders(economy);
    const settledCap = stockpileCap(settled, balance);
    const produced = depositCapped(
        economy.stockpile,
        locationIncome(settled, balance),
        settledCap
    ).stockpile;
    const { active, waiting, ready } = partitionOrders(economy, balance);
    const waitingIds = new Set(waiting.map((o) => o.id));
    const readyIds = new Set(ready.map((o) => o.id));
    const shield = economy.shield;
    const shieldUpkeep = shield ? shieldUpkeepOrder(shield, balance) : undefined;
    const preview = fundLocationOrders(
        depositCapped(produced, arrivingCargo, settledCap).stockpile,
        settled,
        balance,
        shieldUpkeep ? [shieldUpkeep] : []
    );
    const generator = economy.installations.find((i) => i.type === "shield_generator");
    const previewById = new Map(preview.orders.map((o) => [o.id, o]));
    const slots = buildSlots(economy, balance);
    const running = Object.fromEntries(
        BUILD_CATEGORIES.map((c) => [c, active.filter((o) => buildCategory(o.item) === c).length])
    ) as Record<BuildCategory, number>;
    const queue = (category: BuildCategory) => {
        const orders = economy.orders.filter((o) => queueCategory(o.item) === category);
        if (!orders.length && slots[category] <= 0) return null;
        return (
            <div className="planet-page__queue">
                <BuildQueue
                    category={category}
                    orders={orders}
                    slots={slots[category]}
                    running={running[category]}
                    waitingIds={waitingIds}
                    readyIds={readyIds}
                    next={previewById}
                    drawn={preview.drawn}
                    onPriorityChange={(orderId, priority) =>
                        actions.setPriority(locationId, orderId, priority)
                    }
                    onCancel={(orderId) => actions.cancel(locationId, orderId)}
                    onMove={(orderId, direction) =>
                        actions.moveOrder(locationId, orderId, direction)
                    }
                />
            </div>
        );
    };
    const upgradingIds = new Set(
        economy.orders.flatMap((o) =>
            o.item.kind === "enhancement" ? [enhancementTargetId(o.item.target)] : []
        )
    );

    const garrison = world.garrisonAt(locationId);
    const shipsHere = world.ownShipsAt(location.q, location.r);
    const transports = shipsHere.filter((s) => isTransport(s, balance));
    const hasAcademy = economy.installations.some((i) => STRUCTURE_INFO[i.type].enablesResearch);
    const showResearch = hasAcademy || economy.orders.some((o) => o.item.kind === "research");
    const trainsUnits = economy.installations.some(
        (i) => structureDef(i.type, balance).unlocksGroundUnits?.length
    );
    const buildsShips = economy.installations.some(
        (i) => structureDef(i.type, balance).unlocksShips?.length
    );
    const techs = world.economy?.techs ?? [];

    const roomOn = (ship: ShipEntity) =>
        balance.ships[ship.shipType].unitCapacity - world.carriedUnitIds(ship).length;
    const openBuild = (category: BuildCategory) => setPopup({ kind: "build", category });
    const openDefences = () =>
        setPopup({ kind: "build", category: "installations", defences: true });
    const onUpgradeInstallation = (inst: Installation) =>
        setPopup({
            kind: "upgrade",
            target: { kind: "installation", installationId: inst.id, structureType: inst.type }
        });
    const sitedStructures = STRUCTURE_ITEMS.filter(
        (item) =>
            item.kind === "structure" &&
            structureDef(item.structureType, balance).sites.includes(economy.site)
    );
    const isDefenceItem = (item: BuildItem) =>
        item.kind === "structure" && isDefenceStructure(item.structureType);

    const buildPopupProps = {
        context,
        economy,
        priority: newPriority,
        onPriorityChange: setNewPriority,
        onBuild,
        onClose: closePopup
    };

    // Resolved on every render so the popup tracks the target's current tier and location.
    const upgrade = (() => {
        if (popup?.kind !== "upgrade") return undefined;
        const target = popup.target;
        switch (target.kind) {
            case "installation": {
                const inst = economy.installations.find((i) => i.id === target.installationId);
                return inst && { tier: inst.tier, name: structureDef(inst.type, balance).name };
            }
            case "ship": {
                const ship = shipsHere.find((s) => s.id === target.shipId);
                return (
                    ship && {
                        tier: ship.tier ?? 1,
                        name: ship.name ?? shipDef(ship.shipType, balance).name
                    }
                );
            }
            case "groundUnit": {
                const unit = garrison.find((u) => u.id === target.unitId);
                return unit && { tier: unit.tier, name: GROUND_UNIT_TYPE_INFO[unit.unitType].name };
            }
        }
    })();

    return (
        <div className={`planet-page__grid${showResearch ? " planet-page__grid--research" : ""}`}>
            <section className="planet-page__card planet-page__card--stock">
                <StockpileStrip
                    stockpile={economy.stockpile}
                    cap={cap}
                    income={income}
                    home={!!economy.home}
                    inboundCargo={inboundCargo}
                    arrivingCargo={arrivingCargo}
                    inboundShips={inbound.length}
                    waitingShips={waitingShips.length}
                    slots={slots}
                    running={running}
                />
            </section>

            <Card
                area="installations"
                title="Installations"
                detail={`${used}/${economy.slots} slots used`}
                action={
                    <OpenButton
                        label="Add installation"
                        onClick={() => openBuild("installations")}
                    />
                }
            >
                {queue("installations")}
                <InstallationGrid
                    economy={economy}
                    balance={balance}
                    freeSlots={Math.max(0, economy.slots - used)}
                    waitingIds={waitingIds}
                    onAdd={() => openBuild("installations")}
                    onUpgrade={onUpgradeInstallation}
                    show={(type) => !isDefenceStructure(type)}
                />
                <section className="planet-page__defences" aria-label="Defensive structures">
                    <header className="planet-page__card-head">
                        <h4>Defensive structures</h4>
                        <OpenButton label="Add defensive structure" onClick={openDefences} />
                    </header>
                    {economy.installations.some((i) => isDefenceStructure(i.type)) ||
                    economy.orders.some((o) => isDefenceItem(o.item)) ? (
                        <InstallationGrid
                            economy={economy}
                            balance={balance}
                            freeSlots={0}
                            waitingIds={waitingIds}
                            onAdd={openDefences}
                            onUpgrade={onUpgradeInstallation}
                            show={isDefenceStructure}
                            detail={(inst) => (
                                <DefenceTileStats
                                    installation={inst}
                                    balance={balance}
                                    shield={shield}
                                />
                            )}
                        />
                    ) : (
                        <p className="planet-page__muted">
                            No defences. Batteries, shields and orbital platforms share the
                            installation slots.
                        </p>
                    )}
                    {shield && generator && shieldUpkeep && (
                        <ShieldPanel
                            shield={shield}
                            generator={generator}
                            balance={balance}
                            nextSupplied={suppliedFraction(
                                shieldUpkeep.cost,
                                preview.drawn[SHIELD_UPKEEP_ID] ?? zeroResources()
                            )}
                            onPriorityChange={(priority) =>
                                actions.setShieldPriority(locationId, priority)
                            }
                        />
                    )}
                </section>
            </Card>

            {showResearch && (
                <Card
                    area="research"
                    title="Research"
                    detail={`${techs.length}/${TechId.options.length} techs known`}
                    action={
                        hasAcademy && (
                            <OpenButton label="Research" onClick={() => openBuild("research")} />
                        )
                    }
                >
                    {queue("research")}
                    {!economy.orders.some((o) => o.item.kind === "research") && (
                        <p className="planet-page__muted">Nothing being researched.</p>
                    )}
                </Card>
            )}

            <Card
                area="garrison"
                title="Garrison"
                detail={`${garrison.length} unit${garrison.length === 1 ? "" : "s"}`}
                action={
                    trainsUnits && (
                        <OpenButton
                            label="Build ground unit"
                            onClick={() => openBuild("groundUnits")}
                        />
                    )
                }
            >
                {queue("groundUnits")}
                {garrison.length ? (
                    <GarrisonList
                        garrison={garrison}
                        balance={balance}
                        transports={transports}
                        roomOn={roomOn}
                        upgradingIds={upgradingIds}
                        onLoad={(shipId, unitId) => actions.load(shipId, [unitId])}
                        onUpgrade={(unit) =>
                            setPopup({
                                kind: "upgrade",
                                target: {
                                    kind: "groundUnit",
                                    unitId: unit.id,
                                    unitType: unit.unitType
                                }
                            })
                        }
                    />
                ) : (
                    <p className="planet-page__muted">No ground units stationed here.</p>
                )}
            </Card>

            <Card
                area="orbit"
                title="Ships in orbit"
                detail={`${shipsHere.length} · ${context.shipCount}/${context.shipCap} ship cap`}
                action={
                    buildsShips && (
                        <OpenButton label="Build ship" onClick={() => openBuild("ships")} />
                    )
                }
            >
                {queue("ships")}
                {shipsHere.length ? (
                    <OrbitList
                        ships={shipsHere}
                        balance={balance}
                        hpOf={(ship) => world.hpOf(ship)}
                        hangar={(ship) =>
                            world.hangarOf(ship) ? world.carriedShips(ship) : undefined
                        }
                        onUnloadShips={actions.unloadShips}
                        aboard={(ship) =>
                            isTransport(ship, balance)
                                ? world.carriedUnitIds(ship).map((id) => ({
                                      id,
                                      unit: world.groundUnit(id)
                                  }))
                                : undefined
                        }
                        upgradingIds={upgradingIds}
                        onUnload={(shipId, unitIds) => actions.unload(shipId, locationId, unitIds)}
                        onUpgrade={(ship) =>
                            setPopup({
                                kind: "upgrade",
                                target: { kind: "ship", shipId: ship.id, shipType: ship.shipType }
                            })
                        }
                    />
                ) : (
                    <p className="planet-page__muted">No ships in orbit.</p>
                )}
            </Card>

            {popup?.kind === "build" && popup.category === "installations" && (
                <BuildPopup
                    {...buildPopupProps}
                    title={popup.defences ? "Add defensive structure" : "Add installation"}
                    detail={`${used}/${economy.slots} slots used`}
                    items={sitedStructures.filter((item) =>
                        popup.defences ? isDefenceItem(item) : !isDefenceItem(item)
                    )}
                    actionLabel="Build"
                />
            )}
            {popup?.kind === "build" && popup.category === "groundUnits" && (
                <BuildPopup
                    {...buildPopupProps}
                    title="Build ground unit"
                    detail={`${garrison.length} in garrison`}
                    items={GROUND_UNIT_ITEMS}
                    actionLabel="Train"
                />
            )}
            {popup?.kind === "build" && popup.category === "ships" && (
                <BuildPopup
                    {...buildPopupProps}
                    title="Build ship"
                    detail={`${context.shipCount}/${context.shipCap} ships`}
                    items={SHIP_ITEMS}
                    actionLabel="Build"
                />
            )}
            {popup?.kind === "build" && popup.category === "research" && (
                <ResearchTree {...buildPopupProps} />
            )}
            {popup?.kind === "upgrade" && upgrade && (
                <UpgradePopup
                    {...buildPopupProps}
                    item={upgradeItem(popup.target, upgrade.tier)}
                    name={upgrade.name}
                    context={
                        popup.target.kind === "installation"
                            ? context
                            : { ...context, targetTier: upgrade.tier }
                    }
                />
            )}
        </div>
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
        <Card area="colonise" title="Colonise">
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
        </Card>
    );
}

function EnemyLocationPanel({
    world,
    location,
    onInvade,
    onBombard
}: {
    world: HexWorld;
    location: LocationEntity;
    onInvade: (shipIds: EntityId[]) => void;
    onBombard: (shipIds: EntityId[]) => void;
}) {
    const invasion = world.invasionAt(location.q, location.r);
    const bombardment = world.bombardmentAt(location.q, location.r);
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
            <Card area="invade" title="Invade">
                {invasion ? (
                    <div className="planet-page__colonise">
                        <span>
                            {invasion.ships.length} ship
                            {invasion.ships.length === 1 ? "" : "s"} in orbit carrying {landing}{" "}
                            unit
                            {landing === 1 ? "" : "s"}. Defensive Batteries fire on the ships first;
                            the rest land and fight the garrison.
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
                        Bring ships carrying ground units onto this hex to invade.
                    </p>
                )}
            </Card>
            <Card area="bombard" title="Orbital bombardment">
                {bombardment ? (
                    <div className="planet-page__colonise">
                        <span>
                            {bombardment.ships.length} capital ship
                            {bombardment.ships.length === 1 ? "" : "s"} ready to fire (1 MP each).
                            Any shield absorbs shots first, the rest hit the garrison and Defensive
                            Batteries fire back; each ship that gets through may destroy an
                            installation. Does not capture the world.
                        </span>
                        <button
                            type="button"
                            className="planet-page__primary planet-page__primary--danger"
                            onClick={() => onBombard(bombardment.ships.map((s) => s.id))}
                        >
                            Bombard
                        </button>
                    </div>
                ) : (
                    <p className="planet-page__muted">
                        Bring a Star Destroyer or Super Star Destroyer with movement left onto this
                        hex to bombard.
                    </p>
                )}
            </Card>
        </>
    );
}

export function PlanetPage() {
    const { locationId } = useParams<{ locationId: string }>();
    const { world, actions } = useOutletContext<GameOutletContext>();
    const navigate = useNavigate();
    const routerLocation = useLocation();
    const [modalHost, setModalHost] = useState<HTMLDivElement | null>(null);
    useHexWorldVersion(world);

    const found = locationId ? world.findEntityById(locationId) : undefined;
    const location = found && isLocationEntity(found) ? found : undefined;
    const economy = locationId ? world.locationEconomy(locationId) : undefined;
    const context = world.buildContext;
    const own = !!location?.sideId && location.sideId === world.sideId;
    const kindLabel = location ? locationKindLabel(location) : "Location";
    const full = !!(location && own && economy && context);
    // Ground combats resolve at once; the latest one this turn stays flagged in the header.
    const lastGround = locationId ? world.groundCombatsAt(locationId)[0] : undefined;
    const recentGround =
        lastGround && lastGround.turn === world.turn?.turn ? lastGround : undefined;

    const back = useCallback(() => {
        navigate({ pathname: "/", search: routerLocation.search });
    }, [navigate, routerLocation.search]);

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            // Popups handle (and prevent) their own Escape first.
            if (e.key === "Escape" && !e.defaultPrevented) back();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [back]);

    // Only a press that starts and ends on the backdrop closes, so a drag out of the panel doesn't.
    const pressedBackdrop = useRef(false);
    const onBackdropMouseDown = (e: MouseEvent) => {
        pressedBackdrop.current = e.target === e.currentTarget;
    };
    const onBackdropClick = (e: MouseEvent) => {
        if (pressedBackdrop.current && e.target === e.currentTarget) back();
        pressedBackdrop.current = false;
    };

    return (
        <div
            ref={setModalHost}
            className="planet-page"
            onMouseDown={onBackdropMouseDown}
            onClick={onBackdropClick}
        >
            <ModalHostContext.Provider value={modalHost}>
                <section
                    className={`planet-page__panel${full ? "" : " planet-page__panel--compact"}`}
                >
                    <header className="planet-page__header">
                        <div className="planet-page__title">
                            <h2>
                                {location?.name ?? `Unknown ${kindLabel.toLowerCase()}`}
                                {location && (
                                    <span className="planet-page__level">
                                        {location.kind === "planet"
                                            ? `Level ${location.level}`
                                            : kindLabel}
                                    </span>
                                )}
                                {economy?.home && own && (
                                    <span className="planet-page__level">Home</span>
                                )}
                            </h2>
                            <dl className="planet-page__facts">
                                <div>
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
                                </div>
                                <div>
                                    <dt>System</dt>
                                    <dd>{location?.systemId ?? "—"}</dd>
                                </div>
                                <div>
                                    <dt>Hex</dt>
                                    <dd>{location ? `${location.q}, ${location.r}` : "—"}</dd>
                                </div>
                                <div>
                                    <dt>Slots</dt>
                                    <dd>{location ? slotsForEntity(location) : "—"}</dd>
                                </div>
                                <div>
                                    <dt>Id</dt>
                                    <dd>
                                        <code>{locationId}</code>
                                    </dd>
                                </div>
                            </dl>
                        </div>
                        {recentGround && (
                            <p
                                className="planet-page__alert"
                                title={combatLosses(recentGround.result)}
                            >
                                {combatTitle(world, recentGround.result)}:{" "}
                                {combatOutcome(recentGround.result)} ·{" "}
                                {combatLosses(recentGround.result)}
                            </p>
                        )}
                        <button type="button" className="planet-page__back" onClick={back}>
                            Back to map
                        </button>
                    </header>
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
                            onBombard={(shipIds) => actions.bombard(location.id, shipIds)}
                        />
                    )}
                </section>
            </ModalHostContext.Provider>
        </div>
    );
}
