import {
    GROUND_UNIT_TYPES,
    resourceUnits,
    SHIP_TYPES,
    slotsForEntity,
    type EntityKind,
    type EntitySummary
} from "@space/shared-data";
import type { GameActions } from "../gameActions.js";
import { useHexWorldVersion } from "../hooks/index.js";
import {
    HexWorld,
    isBuildSite,
    isLocationEntity,
    isTransport,
    sideColour,
    type MapFocus
} from "../world/HexWorld.js";
import { formatNumber, formatResources } from "./format.js";
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
    actions: Pick<GameActions, "colonise" | "invade">;
};

export function InfoPane({ world, onEndTurn, actions }: InfoPaneProps) {
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
                <FocusBody world={world} focus={focus} />
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
        return entity.name ?? SHIP_TYPES[entity.shipType].name;
    }
    return entity.name ?? KIND_LABELS[entity.kind];
}

function entityName(world: HexWorld, id: string): string {
    const entity = world.findEntityById(id);
    return entity ? entityTitle(entity) : id;
}

function FocusBody({ world, focus }: { world: HexWorld; focus: MapFocus }) {
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
                        {entities
                            .filter((e) => e.id !== entity?.id)
                            .map((e) => (
                                <li key={e.id}>
                                    <button
                                        type="button"
                                        className="info-pane__link"
                                        title="Inspect"
                                        onClick={() =>
                                            e.kind === "ship" && e.sideId === world.sideId
                                                ? world.selectShip(e.id)
                                                : world.inspectEntity(e.id)
                                        }
                                    >
                                        <span className="info-pane__kind">
                                            {KIND_LABELS[e.kind]}
                                        </span>
                                        {" · "}
                                        {entityTitle(e)}
                                    </button>
                                </li>
                            ))}
                    </ul>
                </div>
            )}
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
        entity.kind === "ship" && isTransport(entity)
            ? world.carriedUnitIds(entity).map((id) => world.groundUnit(id))
            : undefined;
    const route = entity.kind === "supply_ship" ? world.supplyRoute(entity.id) : [];
    const routeTurns =
        entity.kind === "supply_ship" ? Math.ceil(route.length / Math.max(1, entity.speed)) : 0;

    return (
        <div className="info-pane__entity">
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
                            <dd>{SHIP_TYPES[entity.shipType].name}</dd>
                        </div>
                        <div>
                            <dt>Movement</dt>
                            <dd>
                                {entity.movementPoints}/{entity.maxMovementPoints}
                            </dd>
                        </div>
                        {entity.hp !== undefined && (
                            <div>
                                <dt>Hull</dt>
                                <dd>{formatNumber(entity.hp)}</dd>
                            </div>
                        )}
                        <div>
                            <dt>Tier</dt>
                            <dd>{entity.tier ?? 1}</dd>
                        </div>
                        {carried && (
                            <div>
                                <dt>Aboard</dt>
                                <dd>
                                    {carried.length}/{SHIP_TYPES[entity.shipType].unitCapacity}
                                    {carried.length > 0 &&
                                        ` · ${carried
                                            .map((u) =>
                                                u ? GROUND_UNIT_TYPES[u.unitType].name : "Unit"
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
                            <dd>{economy.orders.length}</dd>
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
