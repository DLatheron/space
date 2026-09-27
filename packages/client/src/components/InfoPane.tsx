import {
    SHIP_TYPES,
    type EntityId,
    type EntityKind,
    type EntitySummary
} from "@space/shared-data";
import { useHexWorldVersion } from "../hooks/index.js";
import { HexWorld, sideColour, type MapFocus } from "../world/HexWorld.js";
import { formatNumber } from "./format.js";
import "./InfoPane.css";

const KIND_LABELS: Record<EntityKind, string> = {
    ship: "Ship",
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
    onColonise: (planetId: EntityId, shipId: EntityId) => void;
};

export function InfoPane({ world, onEndTurn, onColonise }: InfoPaneProps) {
    useHexWorldVersion(world);

    const turn = world.turn;
    const ownReady = world.ownSideReady;
    const colonisable = world.colonisablePlanet;
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
                        onClick={() => onColonise(colonisable.planet.id, colonisable.ship.id)}
                    >
                        Colonise {colonisable.planet.name ?? "planet"}
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
                                    <span className="info-pane__kind">{KIND_LABELS[e.kind]}</span>
                                    {" · "}
                                    {entityTitle(e)}
                                </li>
                            ))}
                    </ul>
                </div>
            )}
        </div>
    );
}

function EntityDetails({ world, entity }: { world: HexWorld; entity: EntitySummary }) {
    const economy = entity.kind === "planet" ? world.planetEconomy(entity.id) : undefined;

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
                        {economy && (
                            <>
                                <div>
                                    <dt>Structures</dt>
                                    <dd>
                                        {economy.structures.length}/{entity.level}
                                    </dd>
                                </div>
                                <div>
                                    <dt>Build queue</dt>
                                    <dd>{economy.queue.length}</dd>
                                </div>
                            </>
                        )}
                    </>
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
