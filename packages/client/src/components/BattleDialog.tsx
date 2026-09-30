import type { ReactNode } from "react";
import {
    GROUND_UNIT_TYPES,
    groundUnitStats,
    SHIP_TYPES,
    type BattleId,
    type EntityId,
    type GroundUnitSummary,
    type SideId
} from "@space/shared-data";
import { useHexWorldVersion } from "../hooks/index.js";
import { HexWorld } from "../world/HexWorld.js";
import "./BattleDialog.css";

type BattleDialogProps = {
    world: HexWorld;
    onResolve: (battleId: BattleId, winnerSideId: SideId) => void;
    onResolveGround: (battleId: BattleId, winnerSideId: SideId) => void;
};

function sideName(sideId: SideId): string {
    return sideId.charAt(0).toUpperCase() + sideId.slice(1);
}

function ShipList({ world, shipIds }: { world: HexWorld; shipIds: EntityId[] }) {
    return (
        <ul className="battle-dialog__ships">
            {shipIds.map((id) => {
                const entity = world.findEntityById(id);
                const kind =
                    entity?.kind === "ship"
                        ? SHIP_TYPES[entity.shipType].name
                        : entity?.kind === "supply_ship"
                          ? "Supply ship"
                          : undefined;
                return (
                    <li key={id}>
                        {entity?.name ?? id}
                        {kind && <span className="battle-dialog__muted"> · {kind}</span>}
                    </li>
                );
            })}
        </ul>
    );
}

function UnitList({ units }: { units: GroundUnitSummary[] }) {
    let attack = 0;
    let defence = 0;
    for (const unit of units) {
        const stats = groundUnitStats(unit.unitType, unit.tier);
        attack += stats.attack;
        defence += stats.defence;
    }
    return (
        <>
            <p className="battle-dialog__muted battle-dialog__strength">
                Attack {attack} · Defence {defence}
            </p>
            <ul className="battle-dialog__ships">
                {units.map((unit) => {
                    const stats = groundUnitStats(unit.unitType, unit.tier);
                    return (
                        <li key={unit.id}>
                            {GROUND_UNIT_TYPES[unit.unitType].name}
                            <span className="battle-dialog__muted">
                                {" "}
                                · T{unit.tier} · {stats.attack}/{stats.defence}
                            </span>
                        </li>
                    );
                })}
                {!units.length && <li className="battle-dialog__muted">No units</li>}
            </ul>
        </>
    );
}

type BattleSide = { sideId: SideId; role: string; content: ReactNode };

function BattlePanel({
    title,
    sides,
    note,
    onPick
}: {
    title: string;
    sides: BattleSide[];
    note: string;
    onPick: (winnerSideId: SideId) => void;
}) {
    return (
        <div className="battle-dialog" role="dialog" aria-modal="true">
            <section className="battle-dialog__panel">
                <h2>{title}</h2>
                <div className="battle-dialog__sides">
                    {sides.map(({ sideId, role, content }) => (
                        <div key={sideId}>
                            <h3>
                                <span
                                    className={`battle-dialog__side battle-dialog__side--${sideId}`}
                                >
                                    {sideName(sideId)}
                                </span>{" "}
                                <span className="battle-dialog__muted">{role}</span>
                            </h3>
                            {content}
                        </div>
                    ))}
                </div>
                <p className="battle-dialog__muted">{note}</p>
                <div className="battle-dialog__actions">
                    {sides.map(({ sideId }) => (
                        <button
                            key={sideId}
                            type="button"
                            className={`battle-dialog__button battle-dialog__button--${sideId}`}
                            onClick={() => onPick(sideId)}
                        >
                            {sideName(sideId)} wins
                        </button>
                    ))}
                </div>
            </section>
        </div>
    );
}

/**
 * Attacker: modal asking who won the pending space or ground battle (space first).
 * Defender: non-interactive notice while waiting for the attacker to decide.
 */
export function BattleDialog({ world, onResolve, onResolveGround }: BattleDialogProps) {
    useHexWorldVersion(world);

    const battle = world.battleToResolve;
    if (battle) {
        return (
            <BattlePanel
                title={`Battle at ${battle.q},${battle.r}`}
                sides={[
                    {
                        sideId: battle.attackerSideId,
                        role: "Attacker",
                        content: <ShipList world={world} shipIds={battle.attackerShipIds} />
                    },
                    {
                        sideId: battle.defenderSideId,
                        role: "Defender",
                        content: <ShipList world={world} shipIds={battle.defenderShipIds} />
                    }
                ]}
                note="Choose the victor. All of the losing side's ships here are destroyed, including supply ships (with their cargo) and transports (with the units aboard)."
                onPick={(winner) => onResolve(battle.battleId, winner)}
            />
        );
    }

    const ground = world.groundBattleToResolve;
    if (ground) {
        const locationName = world.findEntityById(ground.locationId)?.name ?? "the location";
        return (
            <BattlePanel
                title={`Invasion of ${locationName}`}
                sides={[
                    {
                        sideId: ground.attackerSideId,
                        role: "Invader",
                        content: <UnitList units={ground.attackerUnits} />
                    },
                    {
                        sideId: ground.defenderSideId,
                        role: "Garrison",
                        content: <UnitList units={ground.defenderUnits} />
                    }
                ]}
                note={`Choose the victor. The losing side's units are destroyed; if the invaders win they capture ${locationName}.`}
                onPick={(winner) => onResolveGround(ground.battleId, winner)}
            />
        );
    }

    const awaited = world.battleAwaited ?? world.groundBattleAwaited;
    if (!awaited) return null;
    const what = "locationId" in awaited ? "Invasion" : "Battle";
    return (
        <div className="battle-notice" role="status">
            {what} in progress at {awaited.q},{awaited.r}… awaiting{" "}
            <span className={`battle-dialog__side battle-dialog__side--${awaited.attackerSideId}`}>
                {sideName(awaited.attackerSideId)}
            </span>
        </div>
    );
}
