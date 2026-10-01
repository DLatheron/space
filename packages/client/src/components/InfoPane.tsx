import type { ReactNode } from "react";
import {
    GROUND_UNIT_TYPE_INFO,
    HANGAR_LOAD_COST,
    isFullyFunded,
    MAX_SCATTER_RING,
    MOVE_COST_PER_HEX,
    resourceUnits,
    SHIP_TYPE_INFO,
    shipStats,
    slotsForEntity,
    type EntityKind,
    type EntitySummary
} from "@space/shared-data";
import { imageUrl } from "../assets/images.js";
import type { GameActions } from "../gameActions.js";
import { useHexWorldVersion } from "../hooks/index.js";
import {
    HexWorld,
    isBuildSite,
    isLocationEntity,
    isTransport,
    sideColour,
    type MapFocus,
    type ShipEntity
} from "../world/HexWorld.js";
import { formatNumber, formatResources } from "./format.js";
import { Thumbnail } from "./Thumbnail.js";
import "./InfoPane.css";

const KIND_LABELS: Record<EntityKind, string> = {
    ship: "Ship",
    supply_ship: "Supply ship",
    planet: "Planet",
    moon: "Moon",
    large_asteroid: "Large asteroid",
    sun: "Star",
    asteroid_belt: "Asteroid belt",
    wormhole: "Wormhole",
    black_hole: "Black hole",
    hyperspace_tunnel: "Hyperspace tunnel"
};

type InfoPaneProps = {
    world: HexWorld;
    onEndTurn: () => void;
    actions: Pick<
        GameActions,
        "colonise" | "invade" | "cancelMoveOrder" | "cancelHyperjump" | "loadShips" | "unloadShips"
    >;
    onOpenLocation: (locationId: string) => void;
};

export function InfoPane({ world, onEndTurn, actions, onOpenLocation }: InfoPaneProps) {
    useHexWorldVersion(world);

    const turn = world.turn;
    const ownReady = world.ownSideReady;
    const colonisable = world.colonisableLocation;
    const invasion = world.invasionOption;
    const focus = world.mapFocus;
    const sides = Object.entries(turn?.sideReady ?? {}).sort(([a], [b]) => a.localeCompare(b));

    return (
        <aside className="info-pane" aria-label="Selection and map info">
            <section className="info-pane__section">
                <div className="info-pane__row">
                    <strong>Turn {turn?.turn ?? "—"}</strong>
                    {world.sideId && (
                        <span className={`info-pane__side info-pane__side--${world.sideId}`}>
                            You: {world.sideId}
                        </span>
                    )}
                </div>
                <ul className="info-pane__sides">
                    {sides.map(([sideId, ready]) => (
                        <li key={sideId}>
                            <span className={`info-pane__side info-pane__side--${sideId}`}>
                                {sideId}
                            </span>{" "}
                            {ready ? "ready" : "planning…"}
                        </li>
                    ))}
                </ul>
                {colonisable && (
                    <button
                        type="button"
                        className="info-pane__colonise"
                        onClick={() =>
                            actions.colonise(colonisable.location.id, colonisable.ship.id)
                        }
                    >
                        Colonise{" "}
                        {colonisable.location.name ?? KIND_LABELS[colonisable.location.kind]}
                    </button>
                )}
                {invasion && (
                    <button
                        type="button"
                        className="info-pane__invade"
                        title={`Land every unit aboard ${invasion.ships.length} transport${invasion.ships.length === 1 ? "" : "s"} here`}
                        onClick={() =>
                            actions.invade(
                                invasion.location.id,
                                invasion.ships.map((s) => s.id)
                            )
                        }
                    >
                        Invade {invasion.location.name ?? KIND_LABELS[invasion.location.kind]}
                    </button>
                )}
                <button type="button" onClick={onEndTurn} disabled={ownReady || !turn}>
                    {ownReady ? "Waiting…" : "End turn"}
                </button>
            </section>

            <section className="info-pane__section info-pane__focus">
                <header className="info-pane__focus-header">
                    <h2>{focusTitle(focus)}</h2>
                    {focus.mode !== "none" && (
                        <span className="info-pane__badge">
                            {focus.mode === "selection" ? "Selected" : "Under cursor"}
                        </span>
                    )}
                </header>
                <FocusBody
                    world={world}
                    focus={focus}
                    actions={actions}
                    onOpenLocation={onOpenLocation}
                />
            </section>
        </aside>
    );
}

function focusTitle(focus: MapFocus): string {
    if (focus.mode === "none") return "Map info";
    if (focus.entity) return entityTitle(focus.entity);
    return focus.fog === "unexplored" ? "Unexplored space" : "Empty hex";
}

function entityTitle(entity: EntitySummary): string {
    if (entity.kind === "ship") {
        return entity.name ?? SHIP_TYPE_INFO[entity.shipType].name;
    }
    return entity.name ?? KIND_LABELS[entity.kind];
}

function entityName(world: HexWorld, id: string): string {
    const entity = world.findEntityById(id);
    return entity ? entityTitle(entity) : id;
}

function FocusBody({
    world,
    focus,
    actions,
    onOpenLocation
}: {
    world: HexWorld;
    focus: MapFocus;
    actions: InfoPaneProps["actions"];
    onOpenLocation: (locationId: string) => void;
}) {
    if (focus.mode === "none") {
        return (
            <p className="info-pane__muted">
                Select a unit, or move the cursor over the map to inspect stars, planets, and other
                entities.
            </p>
        );
    }

    const { hex, fog, entities, entity } = focus;

    return (
        <div className="info-pane__body">
            <dl className="info-pane__facts">
                <div>
                    <dt>Hex</dt>
                    <dd>
                        {hex.q}, {hex.r}
                    </dd>
                </div>
                <div>
                    <dt>Fog</dt>
                    <dd className="info-pane__capitalize">{fog}</dd>
                </div>
            </dl>

            {entity &&
                focus.mode === "selection" &&
                isBuildSite(entity) &&
                entity.sideId === world.sideId && (
                    <button
                        type="button"
                        className="info-pane__open"
                        onClick={() => onOpenLocation(entity.id)}
                    >
                        Open {entityTitle(entity)}
                    </button>
                )}

            {entity?.kind === "ship" && entity.id === world.selectedShipId && (
                <>
                    <ShipOrders world={world} ship={entity} actions={actions} />
                    <HangarControls world={world} ship={entity} actions={actions} />
                </>
            )}

            {entity ? (
                <EntityDetails world={world} entity={entity} />
            ) : (
                <p className="info-pane__muted">
                    {fog === "unexplored"
                        ? "No sensor data for this hex yet."
                        : "Nothing of note in this hex."}
                </p>
            )}

            {entities.length > 1 && (
                <div className="info-pane__stack">
                    <h3>Also here</h3>
                    <ul>
                        {world
                            .clickCycle(entities)
                            .filter((e) => e.id !== entity?.id)
                            .map((e) => (
                                <li key={e.id}>
                                    <button
                                        type="button"
                                        className="info-pane__stack-item"
                                        title={`Select ${entityTitle(e)}`}
                                        onClick={() =>
                                            e.kind === "ship" && e.sideId === world.sideId
                                                ? world.selectShip(e.id)
                                                : world.inspectEntity(e.id)
                                        }
                                    >
                                        <span className="info-pane__kind">
                                            {KIND_LABELS[e.kind]}
                                        </span>
                                        <span>{entityTitle(e)}</span>
                                    </button>
                                </li>
                            ))}
                    </ul>
                    {focus.mode === "selection" && (
                        <p className="info-pane__hint">Click the hex again to cycle.</p>
                    )}
                </div>
            )}
        </div>
    );
}

/** "80/120" with a small bar, red when low. */
function HpValue({ hp }: { hp: { hp: number; max: number } }) {
    const ratio = hp.max > 0 ? Math.max(0, Math.min(1, hp.hp / hp.max)) : 1;
    const tone = ratio > 0.6 ? "ok" : ratio > 0.3 ? "low" : "critical";
    return (
        <span className="info-pane__hp">
            {formatNumber(hp.hp)}/{formatNumber(hp.max)}
            <span className="info-pane__hp-bar" aria-hidden="true">
                <span
                    className={`info-pane__hp-fill info-pane__hp-fill--${tone}`}
                    style={{ width: `${ratio * 100}%` }}
                />
            </span>
        </span>
    );
}

function plural(count: number, word: string): string {
    return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** Move order and hyperdrive status and controls for one of our selected ships. */
function ShipOrders({
    world,
    ship,
    actions
}: {
    world: HexWorld;
    ship: ShipEntity;
    actions: InfoPaneProps["actions"];
}) {
    const order = ship.moveOrder;
    const hyperdrive = world.hyperdriveOf(ship);
    if (!order && !hyperdrive) return null;

    const accuracy = world.jumpAccuracy(ship);
    const jump = ship.hyperjump;
    const targeting = world.hyperjumpTargeting?.id === ship.id;
    const cooldown = ship.hyperdriveCooldown ?? 0;
    const blocked =
        cooldown > 0 ? `Hyperdrive cooling down for ${plural(cooldown, "more turn")}` : undefined;
    const routeLength = order?.route?.length ?? 0;
    const perTurn = Math.max(1, Math.floor(ship.maxMovementPoints / MOVE_COST_PER_HEX));
    const percent = (value: number) => `${Math.round(value)}%`;

    return (
        <div className="info-pane__orders">
            <dl className="info-pane__facts">
                {order && (
                    <div>
                        <dt>Move order</dt>
                        <dd>
                            To {order.destination.q}, {order.destination.r}
                            {routeLength > 0 && (
                                <span className="info-pane__muted-inline">
                                    {" "}
                                    · {plural(routeLength, "hex")} · ~
                                    {plural(Math.ceil(routeLength / perTurn), "turn")}
                                </span>
                            )}
                        </dd>
                    </div>
                )}
                {hyperdrive && (
                    <div>
                        <dt>Hyperdrive</dt>
                        <dd>
                            {jump
                                ? `Charging · jumps to ${jump.target.q}, ${jump.target.r} at end of turn`
                                : cooldown > 0
                                  ? `Cooling down · ${plural(cooldown, "turn")}`
                                  : `Ready · ${plural(hyperdrive.cooldownTurns, "turn")} cooldown`}
                        </dd>
                    </div>
                )}
                {accuracy && (
                    <div>
                        <dt>Accuracy</dt>
                        <dd>
                            {percent(accuracy.onTarget)} on target · {percent(accuracy.oneOff)} 1
                            hex off · {percent(accuracy.twoOff)} 2 hexes off
                        </dd>
                    </div>
                )}
            </dl>
            {order && (
                <button
                    type="button"
                    className="info-pane__cancel-order"
                    onClick={() => actions.cancelMoveOrder(ship.id)}
                >
                    Cancel move order
                </button>
            )}
            {hyperdrive &&
                (targeting ? (
                    <button
                        type="button"
                        className="info-pane__hyperdrive"
                        onClick={() => world.cancelHyperjumpTargeting()}
                    >
                        Cancel targeting
                    </button>
                ) : (
                    <button
                        type="button"
                        className="info-pane__hyperdrive"
                        disabled={!!blocked}
                        title={blocked ?? "Pick an explored hex to jump to at end of turn"}
                        onClick={() => world.startHyperjumpTargeting(ship.id)}
                    >
                        {jump ? "Change jump target" : "Engage hyperdrive"}
                    </button>
                ))}
            {jump && (
                <button
                    type="button"
                    className="info-pane__cancel-order"
                    onClick={() => actions.cancelHyperjump(ship.id)}
                >
                    Cancel jump
                </button>
            )}
            {hyperdrive && blocked && <p className="info-pane__hint">{blocked}</p>}
            {targeting && (
                <p className="info-pane__hint">
                    Click an explored hex on the map. The jump may scatter up to{" "}
                    {plural(MAX_SCATTER_RING, "hex")} from the target.
                </p>
            )}
        </div>
    );
}

/** Thumbnail, name, tier and hull of a ship in a hangar list. */
function HangarShip({
    world,
    ship,
    children
}: {
    world: HexWorld;
    ship: ShipEntity;
    children: ReactNode;
}) {
    const hp = world.hpOf(ship);
    return (
        <li className="info-pane__hangar-row">
            <Thumbnail
                src={imageUrl({ kind: "ship", shipType: ship.shipType })}
                label={entityTitle(ship)}
                size="sm"
            />
            <span className="info-pane__hangar-name">
                {entityTitle(ship)} <span className="info-pane__tier">T{ship.tier ?? 1}</span>
                {hp && (
                    <span className="info-pane__muted-inline">
                        {" "}
                        {formatNumber(hp.hp)}/{formatNumber(hp.max)} HP
                    </span>
                )}
            </span>
            {children}
        </li>
    );
}

/**
 * Hangar of one of our selected carriers (ships aboard, ships on the hex that could board),
 * or Board buttons when the selected ship could fly into a carrier sharing its hex.
 */
function HangarControls({
    world,
    ship,
    actions
}: {
    world: HexWorld;
    ship: ShipEntity;
    actions: InfoPaneProps["actions"];
}) {
    const hangar = world.hangarOf(ship);
    const carriers = world.carriersFor(ship);
    if (!hangar && !carriers.length) return null;
    const lowMp = ship.movementPoints < HANGAR_LOAD_COST;

    if (!hangar) {
        return (
            <div className="info-pane__hangar">
                {carriers.map((carrier) => (
                    <button
                        key={carrier.id}
                        type="button"
                        className="info-pane__board"
                        disabled={lowMp}
                        title={
                            lowMp
                                ? `Boarding needs ${HANGAR_LOAD_COST} MP`
                                : `Fly into ${entityTitle(carrier)}'s hangar`
                        }
                        onClick={() => {
                            actions.loadShips(carrier.id, [ship.id]);
                            world.selectShip(carrier.id);
                        }}
                    >
                        Board {entityTitle(carrier)}
                    </button>
                ))}
                <p className="info-pane__hint">Boarding costs {HANGAR_LOAD_COST} MP.</p>
            </div>
        );
    }

    const carried = world.carriedShips(ship);
    const room = hangar.capacity - carried.length;
    const boardable = world.boardableShips(ship);
    return (
        <div className="info-pane__hangar">
            <h3>
                Hangar{" "}
                <span className="info-pane__muted-inline">
                    {carried.length}/{hangar.capacity}
                </span>
            </h3>
            {carried.length ? (
                <ul>
                    {carried.map((s) => (
                        <HangarShip key={s.id} world={world} ship={s}>
                            <button
                                type="button"
                                title="Launch onto this hex"
                                onClick={() => actions.unloadShips(ship.id, [s.id])}
                            >
                                Unload
                            </button>
                        </HangarShip>
                    ))}
                </ul>
            ) : (
                <p className="info-pane__muted">Empty.</p>
            )}
            {carried.length > 1 && (
                <button
                    type="button"
                    onClick={() =>
                        actions.unloadShips(
                            ship.id,
                            carried.map((s) => s.id)
                        )
                    }
                >
                    Unload all
                </button>
            )}
            {boardable.length > 0 && (
                <>
                    <h3>Can board</h3>
                    <ul>
                        {boardable.map((s) => {
                            const reason =
                                room <= 0
                                    ? "Hangar is full"
                                    : s.movementPoints < HANGAR_LOAD_COST
                                      ? `Needs ${HANGAR_LOAD_COST} MP`
                                      : undefined;
                            return (
                                <HangarShip key={s.id} world={world} ship={s}>
                                    <button
                                        type="button"
                                        disabled={!!reason}
                                        title={reason ?? `Load ${entityTitle(s)}`}
                                        onClick={() => actions.loadShips(ship.id, [s.id])}
                                    >
                                        Load
                                    </button>
                                </HangarShip>
                            );
                        })}
                    </ul>
                </>
            )}
            <p className="info-pane__hint">
                Loading costs each ship {HANGAR_LOAD_COST} MP and drops its orders; unloading is
                free. Ships aboard move with the carrier and can&apos;t fight.
            </p>
        </div>
    );
}

function EntityDetails({ world, entity }: { world: HexWorld; entity: EntitySummary }) {
    const economy = isLocationEntity(entity) ? world.locationEconomy(entity.id) : undefined;
    const garrison = isLocationEntity(entity)
        ? economy
            ? world.garrisonAt(entity.id).length
            : entity.garrison?.length
        : undefined;
    const carried =
        entity.kind === "ship" && isTransport(entity, world.balance)
            ? world.carriedUnitIds(entity).map((id) => world.groundUnit(id))
            : undefined;
    const hp =
        entity.kind === "ship" || entity.kind === "supply_ship" ? world.hpOf(entity) : undefined;
    const stats =
        entity.kind === "ship" && world.balance
            ? shipStats(entity.shipType, entity.tier ?? 1, world.balance)
            : undefined;
    const supplyStats = entity.kind === "supply_ship" ? world.supplyStatsOf(entity) : undefined;
    const hangar = entity.kind === "ship" ? world.hangarOf(entity) : undefined;
    const aboard =
        entity.kind === "ship"
            ? entity.sideId === world.sideId
                ? world.carriedShips(entity).length
                : (entity.carriedShipCount ?? 0)
            : 0;
    const route = entity.kind === "supply_ship" ? world.supplyRoute(entity.id) : [];
    const routeTurns =
        entity.kind === "supply_ship" ? Math.ceil(route.length / Math.max(1, entity.speed)) : 0;

    const picture =
        entity.kind === "ship"
            ? imageUrl({ kind: "ship", shipType: entity.shipType })
            : entity.kind === "supply_ship"
              ? imageUrl({ kind: "supplyShip" })
              : undefined;

    return (
        <div className="info-pane__entity">
            {picture && (
                <Thumbnail
                    src={picture}
                    label={entityTitle(entity)}
                    size="banner"
                    className="info-pane__picture"
                />
            )}
            <dl className="info-pane__facts">
                <div>
                    <dt>Type</dt>
                    <dd>{KIND_LABELS[entity.kind]}</dd>
                </div>
                {"sideId" in entity && entity.sideId !== undefined && (
                    <div>
                        <dt>Owner</dt>
                        <dd
                            style={{
                                color: sideColour(
                                    entity.sideId ?? null,
                                    entity.sideId === null ? "#9ab3d4" : "#ffd166"
                                )
                            }}
                        >
                            {entity.sideId ?? "Unclaimed"}
                        </dd>
                    </div>
                )}
                {entity.kind === "ship" && (
                    <>
                        <div>
                            <dt>Class</dt>
                            <dd>{SHIP_TYPE_INFO[entity.shipType].name}</dd>
                        </div>
                        <div>
                            <dt>Movement</dt>
                            <dd>
                                {entity.movementPoints}/{entity.maxMovementPoints}
                            </dd>
                        </div>
                        {hp && (
                            <div>
                                <dt>Hull</dt>
                                <dd>
                                    <HpValue hp={hp} />
                                </dd>
                            </div>
                        )}
                        {stats && (
                            <div>
                                <dt>Attack / def.</dt>
                                <dd>
                                    {stats.attack} / {stats.defence}
                                </dd>
                            </div>
                        )}
                        <div>
                            <dt>Tier</dt>
                            <dd>{entity.tier ?? 1}</dd>
                        </div>
                        {(hangar || aboard > 0) && (
                            <div>
                                <dt>Hangar</dt>
                                <dd>
                                    {hangar && entity.sideId === world.sideId
                                        ? `${aboard}/${hangar.capacity} ships aboard`
                                        : `${plural(aboard, "ship")} aboard`}
                                </dd>
                            </div>
                        )}
                        {entity.hyperdriveCharging && entity.sideId !== world.sideId && (
                            <div>
                                <dt>Hyperdrive</dt>
                                <dd>Charging · jumps at end of turn</dd>
                            </div>
                        )}
                        {carried && (
                            <div>
                                <dt>Aboard</dt>
                                <dd>
                                    {carried.length}/
                                    {world.balance?.ships[entity.shipType].unitCapacity}
                                    {carried.length > 0 &&
                                        ` · ${carried
                                            .map((u) =>
                                                u ? GROUND_UNIT_TYPE_INFO[u.unitType].name : "Unit"
                                            )
                                            .join(", ")}`}
                                </dd>
                            </div>
                        )}
                    </>
                )}
                {entity.kind === "supply_ship" && (
                    <>
                        <div>
                            <dt>From</dt>
                            <dd>{entityName(world, entity.originId)}</dd>
                        </div>
                        <div>
                            <dt>To</dt>
                            <dd>{entityName(world, entity.destinationId)}</dd>
                        </div>
                        <div>
                            <dt>Cargo</dt>
                            <dd>
                                {formatResources(entity.cargo, "Empty")}
                                <span className="info-pane__muted-inline">
                                    {" "}
                                    ({formatNumber(resourceUnits(entity.cargo))}/
                                    {formatNumber(entity.capacity)})
                                </span>
                            </dd>
                        </div>
                        <div>
                            <dt>Speed</dt>
                            <dd>{entity.speed} hexes/turn</dd>
                        </div>
                        {hp && (
                            <div>
                                <dt>Hull</dt>
                                <dd>
                                    <HpValue hp={hp} />
                                </dd>
                            </div>
                        )}
                        {supplyStats && (
                            <div>
                                <dt>Evasion</dt>
                                <dd>
                                    {Math.round(supplyStats.evasion * 100)}%
                                    <span className="info-pane__muted-inline">
                                        {" "}
                                        · defence {supplyStats.defence}
                                        {entity.sideId !== world.sideId && " (base)"}
                                    </span>
                                </dd>
                            </div>
                        )}
                        {entity.sideId === world.sideId && (
                            <div>
                                <dt>Route</dt>
                                <dd>
                                    {route.length
                                        ? `${route.length} hex${route.length === 1 ? "" : "es"} · ~${routeTurns} turn${routeTurns === 1 ? "" : "s"}`
                                        : "Waiting for a clear route"}
                                </dd>
                            </div>
                        )}
                    </>
                )}
                {entity.kind === "planet" && (
                    <>
                        <div>
                            <dt>Level</dt>
                            <dd>{entity.level}</dd>
                        </div>
                        <div>
                            <dt>System</dt>
                            <dd className="info-pane__mono">{entity.systemId}</dd>
                        </div>
                    </>
                )}
                {economy && isBuildSite(entity) && (
                    <>
                        <div>
                            <dt>Installations</dt>
                            <dd>
                                {economy.installations.length}/{slotsForEntity(entity)}
                            </dd>
                        </div>
                        <div>
                            <dt>Orders</dt>
                            <dd>
                                {economy.orders.length}
                                {economy.orders.some(isFullyFunded) &&
                                    ` (${economy.orders.filter(isFullyFunded).length} ready next turn)`}
                            </dd>
                        </div>
                        <div>
                            <dt>Stockpile</dt>
                            <dd>{formatResources(economy.stockpile, "Empty")}</dd>
                        </div>
                    </>
                )}
                {garrison !== undefined && garrison > 0 && (
                    <div>
                        <dt>Garrison</dt>
                        <dd>
                            {garrison} unit{garrison === 1 ? "" : "s"}
                        </dd>
                    </div>
                )}
                {(entity.kind === "moon" || entity.kind === "large_asteroid") && (
                    <div>
                        <dt>System</dt>
                        <dd className="info-pane__mono">{entity.systemId}</dd>
                    </div>
                )}
                {entity.kind === "moon" && entity.parentPlanetId && (
                    <div>
                        <dt>Parent</dt>
                        <dd className="info-pane__mono">{entity.parentPlanetId}</dd>
                    </div>
                )}
                {entity.kind === "large_asteroid" && entity.mineable !== undefined && (
                    <div>
                        <dt>Mineable</dt>
                        <dd>{entity.mineable ? "Yes" : "No"}</dd>
                    </div>
                )}
                {entity.kind === "sun" && (
                    <>
                        <div>
                            <dt>System</dt>
                            <dd className="info-pane__mono">{entity.systemId}</dd>
                        </div>
                        <div>
                            <dt>Hazard</dt>
                            <dd>{formatNumber(entity.hazardLevel)}</dd>
                        </div>
                    </>
                )}
                {(entity.kind === "asteroid_belt" ||
                    entity.kind === "wormhole" ||
                    entity.kind === "black_hole") && (
                    <div>
                        <dt>Hazard</dt>
                        <dd>{formatNumber(entity.hazardLevel)}</dd>
                    </div>
                )}
                {entity.kind === "asteroid_belt" && entity.systemId && (
                    <div>
                        <dt>System</dt>
                        <dd className="info-pane__mono">{entity.systemId}</dd>
                    </div>
                )}
                {entity.kind === "wormhole" && entity.pairId && (
                    <div>
                        <dt>Paired exit</dt>
                        <dd className="info-pane__mono">{entity.pairId}</dd>
                    </div>
                )}
                {entity.kind === "hyperspace_tunnel" && (
                    <>
                        <div>
                            <dt>From</dt>
                            <dd className="info-pane__mono">{entity.fromSystemId}</dd>
                        </div>
                        <div>
                            <dt>To</dt>
                            <dd className="info-pane__mono">{entity.toSystemId}</dd>
                        </div>
                        <div>
                            <dt>Status</dt>
                            <dd>{entity.active ? "Active" : "Inactive"}</dd>
                        </div>
                    </>
                )}
                {entity.scale !== undefined && (
                    <div>
                        <dt>Scale</dt>
                        <dd>{entity.scale.toFixed(2)}</dd>
                    </div>
                )}
            </dl>
        </div>
    );
}
