import type { EntityId } from "@space/shared-data";
import { useHexWorldVersion } from "../hooks/index.js";
import { HexWorld } from "../world/HexWorld.js";
import "./TurnHud.css";

type TurnHudProps = {
    world: HexWorld;
    onEndTurn: () => void;
    onColonise: (locationId: EntityId, shipId: EntityId) => void;
};

export function TurnHud({ world, onEndTurn, onColonise }: TurnHudProps) {
    useHexWorldVersion(world);

    const turn = world.turn;
    const ownReady = world.ownSideReady;
    const ship = world.selectedShip;
    const colonisable = world.colonisableLocation;
    const sides = Object.entries(turn?.sideReady ?? {}).sort(([a], [b]) => a.localeCompare(b));

    return (
        <aside className="turn-hud">
            <div className="turn-hud__row">
                <strong>Turn {turn?.turn ?? "—"}</strong>
                {world.sideId && (
                    <span className={`turn-hud__side turn-hud__side--${world.sideId}`}>
                        You: {world.sideId}
                    </span>
                )}
            </div>
            <ul className="turn-hud__sides">
                {sides.map(([sideId, ready]) => (
                    <li key={sideId}>
                        <span className={`turn-hud__side turn-hud__side--${sideId}`}>{sideId}</span>{" "}
                        {ready ? "ready" : "planning…"}
                    </li>
                ))}
            </ul>
            <div className="turn-hud__ship">
                {ship ? (
                    <>
                        {ship.name ?? "Ship"} · MP {ship.movementPoints}/{ship.maxMovementPoints}
                    </>
                ) : (
                    <span className="turn-hud__muted">No ship selected</span>
                )}
            </div>
            {colonisable && (
                <button
                    type="button"
                    className="turn-hud__colonise"
                    onClick={() => onColonise(colonisable.location.id, colonisable.ship.id)}
                >
                    Colonise {colonisable.location.name ?? "location"}
                </button>
            )}
            <button type="button" onClick={onEndTurn} disabled={ownReady || !turn}>
                {ownReady ? "Waiting…" : "End turn"}
            </button>
        </aside>
    );
}
