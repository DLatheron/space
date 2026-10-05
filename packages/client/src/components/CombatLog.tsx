import { useState } from "react";
import type { CombatResult } from "@space/shared-data";
import { useHexWorldVersion } from "../hooks/index.js";
import { HexWorld, sideColour } from "../world/HexWorld.js";
import {
    combatLosses,
    combatOutcome,
    combatTitle,
    combatTone,
    participantName
} from "./combatText.js";
import { formatNumber } from "./format.js";
import "./CombatLog.css";

/** Non-blocking list of recent combats over the map; clicking one centres the map on it. */
export function CombatLog({ world }: { world: HexWorld }) {
    useHexWorldVersion(world);
    const [open, setOpen] = useState(true);
    const [expandedId, setExpandedId] = useState<number | null>(null);
    /** Reports up to this id were cleared. */
    const [clearedId, setClearedId] = useState(0);

    const reports = world.combatReports.filter((r) => r.id > clearedId);
    if (!reports.length) return null;
    const newestId = reports[0]!.id;

    return (
        <section className="combat-log" aria-label="Combat log">
            <header className="combat-log__head">
                <button
                    type="button"
                    className="combat-log__toggle"
                    aria-expanded={open}
                    onClick={() => setOpen(!open)}
                >
                    Combat log <span className="combat-log__count">{reports.length}</span>
                </button>
                <button type="button" onClick={() => setClearedId(newestId)}>
                    Clear
                </button>
            </header>
            {open && (
                <ol className="combat-log__entries">
                    {reports.map(({ id, turn, result }) => {
                        const expanded = expandedId === id;
                        return (
                            <li
                                key={id}
                                className={`combat-log__entry combat-log__entry--${combatTone(result, world.sideId)}${id === newestId ? " combat-log__entry--new" : ""}`}
                            >
                                <button
                                    type="button"
                                    className="combat-log__summary"
                                    title="Show on the map"
                                    onClick={() => world.focusCombat(result)}
                                >
                                    <strong>{combatTitle(world, result)}</strong>
                                    <span>{combatOutcome(result)}</span>
                                    <span className="combat-log__muted">
                                        {turn !== null && `Turn ${turn} · `}
                                        {combatLosses(result)}
                                    </span>
                                </button>
                                <button
                                    type="button"
                                    className="combat-log__details-toggle"
                                    aria-expanded={expanded}
                                    onClick={() => setExpandedId(expanded ? null : id)}
                                >
                                    {expanded ? "Hide details" : "Details"}
                                </button>
                                {expanded && <CombatDetails world={world} result={result} />}
                            </li>
                        );
                    })}
                </ol>
            )}
        </section>
    );
}

/** Every participant with hp before → after, damage dealt and taken. */
export function CombatDetails({ world, result }: { world: HexWorld; result: CombatResult }) {
    const listed = new Set([
        ...result.participants.filter((p) => p.destroyed).map((p) => p.id),
        ...(result.destroyedStructureIds ?? [])
    ]);
    const alsoLost = result.destroyedIds.filter((id) => !listed.has(id)).length;
    return (
        <div className="combat-log__details">
            <table className="combat-log__table">
                <thead>
                    <tr>
                        <th>Unit</th>
                        <th title="Hull before → after / full">HP</th>
                        <th title="Damage dealt">Dealt</th>
                        <th title="Damage taken">Taken</th>
                    </tr>
                </thead>
                <tbody>
                    {result.participants.map((p) => (
                        <tr key={p.id} className={p.destroyed ? "combat-log__lost" : undefined}>
                            <td>
                                <span
                                    className="combat-log__side"
                                    style={{ background: sideColour(p.sideId, "#ffd166") }}
                                    title={`${p.sideId} · ${p.role}`}
                                />
                                {participantName(world, p)}
                                {p.tier !== undefined && (
                                    <span className="combat-log__tier">T{p.tier}</span>
                                )}
                                {p.evaded && <span className="combat-log__tag">Evaded</span>}
                                {p.destroyed && (
                                    <span className="combat-log__tag combat-log__tag--lost">
                                        Destroyed
                                    </span>
                                )}
                            </td>
                            <td>
                                {p.maxHp > 0 ? (
                                    <>
                                        {formatNumber(p.hpBefore)}→{formatNumber(p.hpAfter)}
                                        <span className="combat-log__muted">
                                            /{formatNumber(p.maxHp)}
                                        </span>
                                    </>
                                ) : (
                                    <span className="combat-log__muted">—</span>
                                )}
                            </td>
                            <td>{formatNumber(p.damageDealt)}</td>
                            <td>{formatNumber(p.damageTaken)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
            <p className="combat-log__muted">
                {result.rounds} round{result.rounds === 1 ? "" : "s"}
                {result.kind === "space" && result.attackerMovedIn && " · attacker moved in"}
                {result.cause === "ranged" && ` · fired from ${result.from.q}, ${result.from.r}`}
                {result.displacedTo &&
                    ` · jumper pushed to ${result.displacedTo.q}, ${result.displacedTo.r}`}
                {result.shieldBefore !== undefined &&
                    ` · shield ${formatNumber(result.shieldBefore)}→${formatNumber(result.shieldAfter ?? 0)}`}
                {alsoLost > 0 && ` · ${alsoLost} more lost aboard carriers`}
                {result.destroyedUnitIds.length > 0 &&
                    result.kind === "space" &&
                    ` · ${result.destroyedUnitIds.length} ground unit${result.destroyedUnitIds.length === 1 ? "" : "s"} lost aboard`}
            </p>
        </div>
    );
}
