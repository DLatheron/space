import { useCallback, useEffect } from "react";
import { useLocation, useNavigate, useOutletContext, useParams } from "react-router-dom";
import {
    buildItemCost,
    buildItemName,
    buildItemTurns,
    canBuild,
    RESOURCE_KEYS,
    SHIP_TYPES,
    ShipType,
    slotsUsed,
    STRUCTURE_TYPES,
    StructureType,
    type BuildContext,
    type BuildItem,
    type EntityId,
    type PlanetEconomy,
    type Resources
} from "@space/shared-data";
import { formatNumber } from "../components/format.js";
import { useHexWorldVersion } from "../hooks/index.js";
import { HexWorld, type PlanetEntity } from "../world/HexWorld.js";
import "./PlanetPage.css";

export type GameOutletContext = {
    world: HexWorld;
    sendBuild: (planetId: EntityId, item: BuildItem) => void;
    sendCancel: (planetId: EntityId, index: number) => void;
    sendColonise: (planetId: EntityId, shipId: EntityId) => void;
};

const RESOURCE_LABELS: Record<keyof Resources, string> = {
    food: "Food",
    gold: "Gold",
    resources: "Res"
};

const STRUCTURE_ITEMS: BuildItem[] = StructureType.options.map((structureType) => ({
    kind: "structure",
    structureType
}));

const SHIP_ITEMS: BuildItem[] = ShipType.options.map((shipType) => ({ kind: "ship", shipType }));

function itemKey(item: BuildItem): string {
    return item.kind === "structure" ? `structure:${item.structureType}` : `ship:${item.shipType}`;
}

function sideName(sideId: string): string {
    return sideId.charAt(0).toUpperCase() + sideId.slice(1);
}

function itemSummary(item: BuildItem): string {
    if (item.kind === "ship") {
        const def = SHIP_TYPES[item.shipType];
        const parts = [`MP ${def.maxMovementPoints}`, `HP ${def.hp}`];
        if (def.canColonise) parts.push("Can colonise");
        return parts.join(" · ");
    }
    const def = STRUCTURE_TYPES[item.structureType];
    const parts = [def.description];
    for (const key of RESOURCE_KEYS) {
        const amount = def.produces?.[key];
        if (amount) parts.push(`+${formatNumber(amount)} ${key}/turn`);
    }
    return parts.join(" ");
}

function CostList({ cost, stockpile }: { cost: Resources; stockpile?: Resources }) {
    return (
        <span className="planet-page__cost">
            {RESOURCE_KEYS.filter((key) => cost[key] > 0).map((key) => (
                <span
                    key={key}
                    className={`planet-page__cost-item planet-page__cost-item--${key}${
                        stockpile && stockpile[key] < cost[key]
                            ? " planet-page__cost-item--short"
                            : ""
                    }`}
                >
                    {formatNumber(cost[key])} {RESOURCE_LABELS[key]}
                </span>
            ))}
        </span>
    );
}

type OwnPlanetProps = {
    economy: PlanetEconomy;
    context: BuildContext;
    onBuild: (item: BuildItem) => void;
    onCancel: (index: number) => void;
};

function OwnPlanetPanel({ economy, context, onBuild, onCancel }: OwnPlanetProps) {
    const used = slotsUsed(economy);
    const counts = new Map<StructureType, number>();
    for (const s of economy.structures) {
        counts.set(s, (counts.get(s) ?? 0) + 1);
    }

    const renderOption = (item: BuildItem) => {
        const check = canBuild(context, economy, item);
        const reason = check.ok ? undefined : check.reason;
        return (
            <li key={itemKey(item)} className="planet-page__option">
                <div className="planet-page__option-main">
                    <strong>{buildItemName(item)}</strong>
                    <span className="planet-page__muted">{itemSummary(item)}</span>
                    <span className="planet-page__option-meta">
                        <CostList cost={buildItemCost(item)} stockpile={context.stockpile} />
                        <span className="planet-page__turns">
                            {buildItemTurns(item)} turn{buildItemTurns(item) === 1 ? "" : "s"}
                        </span>
                    </span>
                    {reason && <span className="planet-page__reason">{reason}</span>}
                </div>
                <button
                    type="button"
                    disabled={!check.ok}
                    title={reason ?? `Queue ${buildItemName(item)}`}
                    onClick={() => onBuild(item)}
                >
                    Build
                </button>
            </li>
        );
    };

    return (
        <>
            <section className="planet-page__section">
                <h3>
                    Structures{" "}
                    <span className="planet-page__muted">
                        {used}/{economy.level} slots used
                    </span>
                </h3>
                <div
                    className="planet-page__slots"
                    role="meter"
                    aria-valuemin={0}
                    aria-valuemax={economy.level}
                    aria-valuenow={used}
                >
                    <div
                        className="planet-page__slots-fill"
                        style={{ width: `${Math.min(100, (used / economy.level) * 100)}%` }}
                    />
                </div>
                {counts.size ? (
                    <ul className="planet-page__structures">
                        {[...counts].map(([type, count]) => (
                            <li key={type}>
                                {STRUCTURE_TYPES[type].name}
                                {count > 1 && <span className="planet-page__muted"> ×{count}</span>}
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="planet-page__muted">No structures built yet.</p>
                )}
            </section>

            <section className="planet-page__section">
                <h3>Build queue</h3>
                {economy.queue.length ? (
                    <ol className="planet-page__queue">
                        {economy.queue.map((entry, index) => {
                            const done = entry.totalTurns - entry.turnsRemaining;
                            const head = index === 0;
                            return (
                                <li
                                    key={`${index}-${itemKey(entry.item)}`}
                                    className="planet-page__queue-entry"
                                >
                                    <div className="planet-page__queue-main">
                                        <span>
                                            <strong>{buildItemName(entry.item)}</strong>{" "}
                                            <span className="planet-page__muted">
                                                {head ? "Building" : "Queued"} ·{" "}
                                                {entry.turnsRemaining} turn
                                                {entry.turnsRemaining === 1 ? "" : "s"} left
                                            </span>
                                        </span>
                                        {head && (
                                            <div className="planet-page__progress">
                                                <div
                                                    className="planet-page__progress-fill"
                                                    style={{
                                                        width: `${(done / entry.totalTurns) * 100}%`
                                                    }}
                                                />
                                            </div>
                                        )}
                                    </div>
                                    <button
                                        type="button"
                                        title="Cancel and refund in full"
                                        onClick={() => onCancel(index)}
                                    >
                                        Cancel
                                    </button>
                                </li>
                            );
                        })}
                    </ol>
                ) : (
                    <p className="planet-page__muted">Nothing queued.</p>
                )}
            </section>

            <section className="planet-page__section">
                <h3>Build structures</h3>
                <ul className="planet-page__options">{STRUCTURE_ITEMS.map(renderOption)}</ul>
            </section>

            <section className="planet-page__section">
                <h3>
                    Build ships{" "}
                    <span className="planet-page__muted">
                        {context.shipCount}/{context.shipCap} ships
                    </span>
                </h3>
                <ul className="planet-page__options">{SHIP_ITEMS.map(renderOption)}</ul>
            </section>
        </>
    );
}

function UnownedPlanetPanel({
    world,
    planet,
    onColonise
}: {
    world: HexWorld;
    planet: PlanetEntity;
    onColonise: (shipId: EntityId) => void;
}) {
    const colonyShip = world.colonyShipsAt(planet.q, planet.r)[0];
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
                    Move a colony ship onto this planet&apos;s hex to claim it.
                </p>
            )}
        </section>
    );
}

export function PlanetPage() {
    const { planetId } = useParams<{ planetId: string }>();
    const { world, sendBuild, sendCancel, sendColonise } = useOutletContext<GameOutletContext>();
    const navigate = useNavigate();
    const location = useLocation();
    useHexWorldVersion(world);

    const planet = planetId ? world.findEntity(planetId, "planet") : undefined;
    const economy = planetId ? world.planetEconomy(planetId) : undefined;
    const context = world.buildContext;
    const own = !!planet?.sideId && planet.sideId === world.sideId;

    const back = useCallback(() => {
        navigate({ pathname: "/", search: location.search });
    }, [navigate, location.search]);

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
                        {planet?.name ?? "Unknown planet"}
                        {planet && <span className="planet-page__level">Level {planet.level}</span>}
                    </h2>
                    <button type="button" onClick={back}>
                        Back to map
                    </button>
                </header>
                <dl className="planet-page__facts">
                    <dt>Id</dt>
                    <dd>
                        <code>{planetId}</code>
                    </dd>
                    <dt>Owner</dt>
                    <dd>
                        {planet ? (
                            planet.sideId ? (
                                <span
                                    className={`planet-page__side planet-page__side--${planet.sideId}`}
                                >
                                    {sideName(planet.sideId)}
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
                    <dd>{planet?.systemId ?? "—"}</dd>
                    <dt>Location</dt>
                    <dd>{planet ? `${planet.q}, ${planet.r}` : "—"}</dd>
                    <dt>Level</dt>
                    <dd>{planet ? `${planet.level} (up to ${planet.level} structures)` : "—"}</dd>
                </dl>
                {!planet && (
                    <p className="planet-page__muted">
                        This planet is not in your known map (it may be out of sight).
                    </p>
                )}
                {planet && own && economy && context && (
                    <OwnPlanetPanel
                        economy={economy}
                        context={context}
                        onBuild={(item) => sendBuild(planet.id, item)}
                        onCancel={(index) => sendCancel(planet.id, index)}
                    />
                )}
                {planet && own && !(economy && context) && (
                    <p className="planet-page__muted">Waiting for economy data…</p>
                )}
                {planet && !planet.sideId && (
                    <UnownedPlanetPanel
                        world={world}
                        planet={planet}
                        onColonise={(shipId) => sendColonise(planet.id, shipId)}
                    />
                )}
                {planet && planet.sideId && !own && (
                    <p className="planet-page__muted">
                        Controlled by {sideName(planet.sideId)}. Its structures are hidden.
                    </p>
                )}
            </section>
        </div>
    );
}
