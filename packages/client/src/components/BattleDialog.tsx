import { SHIP_TYPES, type BattleInfo, type EntityId, type SideId } from "@space/shared-data";
import { useHexWorldVersion } from "../hooks/index.js";
import { HexWorld } from "../world/HexWorld.js";
import "./BattleDialog.css";

type BattleDialogProps = {
    world: HexWorld;
    onResolve: (battleId: BattleInfo["battleId"], winnerSideId: SideId) => void;
};

function sideName(sideId: SideId): string {
    return sideId.charAt(0).toUpperCase() + sideId.slice(1);
}

function ShipList({ world, shipIds }: { world: HexWorld; shipIds: EntityId[] }) {
    return (
        <ul className="battle-dialog__ships">
            {shipIds.map((id) => {
                const ship = world.findEntity(id, "ship");
                return (
                    <li key={id}>
                        {ship?.name ?? id}
                        {ship && (
                            <span className="battle-dialog__muted">
                                {" "}
                                · {SHIP_TYPES[ship.shipType].name}
                            </span>
                        )}
                    </li>
                );
            })}
        </ul>
    );
}

/**
 * Attacker: modal asking who won the pending battle. Defender: non-interactive
 * notice while waiting for the attacker to decide.
 */
export function BattleDialog({ world, onResolve }: BattleDialogProps) {
    useHexWorldVersion(world);

    const battle = world.battleToResolve;
    if (!battle) {
        const awaited = world.battleAwaited;
        if (!awaited) return null;
        return (
            <div className="battle-notice" role="status">
                Battle in progress at {awaited.q},{awaited.r}… awaiting{" "}
                <span
                    className={`battle-dialog__side battle-dialog__side--${awaited.attackerSideId}`}
                >
                    {sideName(awaited.attackerSideId)}
                </span>
            </div>
        );
    }

    const sides = [
        { sideId: battle.attackerSideId, role: "Attacker", shipIds: battle.attackerShipIds },
        { sideId: battle.defenderSideId, role: "Defender", shipIds: battle.defenderShipIds }
    ];

    return (
        <div className="battle-dialog" role="dialog" aria-modal="true">
            <section className="battle-dialog__panel">
                <h2>
                    Battle at {battle.q},{battle.r}
                </h2>
                <div className="battle-dialog__sides">
                    {sides.map(({ sideId, role, shipIds }) => (
                        <div key={sideId}>
                            <h3>
                                <span
                                    className={`battle-dialog__side battle-dialog__side--${sideId}`}
                                >
                                    {sideName(sideId)}
                                </span>{" "}
                                <span className="battle-dialog__muted">{role}</span>
                            </h3>
                            <ShipList world={world} shipIds={shipIds} />
                        </div>
                    ))}
                </div>
                <p className="battle-dialog__muted">
                    Choose the victor. All of the losing side&apos;s ships here are destroyed.
                </p>
                <div className="battle-dialog__actions">
                    {sides.map(({ sideId }) => (
                        <button
                            key={sideId}
                            type="button"
                            className={`battle-dialog__button battle-dialog__button--${sideId}`}
                            onClick={() => onResolve(battle.battleId, sideId)}
                        >
                            {sideName(sideId)} wins
                        </button>
                    ))}
                </div>
            </section>
        </div>
    );
}
