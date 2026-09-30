import {
    buildItemCost,
    buildItemTurns,
    canBuild,
    type BuildContext,
    type BuildItem,
    type BuildPriority,
    type LocationEconomy
} from "@space/shared-data";
import { buildItemImage } from "../../assets/images.js";
import { CostList } from "../../components/CostList.js";
import { formatNumber } from "../../components/format.js";
import { Modal } from "../../components/Modal.js";
import { Thumbnail } from "../../components/Thumbnail.js";
import { targetTypeName, tierStats, type TierStat, type UpgradeItem } from "./locationItems.js";
import { PriorityPicker } from "./PriorityPicker.js";
import "./UpgradePopup.css";

type UpgradePopupProps = {
    item: UpgradeItem;
    /** Name of the particular installation, ship or unit. */
    name: string;
    /** Must carry `targetTier` for ships and ground units (see `BuildContext`). */
    context: BuildContext;
    economy: LocationEconomy;
    priority: BuildPriority;
    onPriorityChange: (priority: BuildPriority) => void;
    onBuild: (item: BuildItem) => void;
    onClose: () => void;
};

function TierColumn({
    heading,
    stats,
    previous
}: {
    heading: string;
    stats: TierStat[];
    previous?: TierStat[];
}) {
    return (
        <div className={`upgrade-popup__tier${previous ? " upgrade-popup__tier--next" : ""}`}>
            <h3>{heading}</h3>
            {stats.length ? (
                <dl>
                    {stats.map((stat, i) => {
                        const delta = previous ? stat.value - (previous[i]?.value ?? 0) : 0;
                        return (
                            <div key={stat.label}>
                                <dt>{stat.label}</dt>
                                <dd>
                                    {stat.text}
                                    {delta !== 0 && (
                                        <span
                                            className={`upgrade-popup__delta${delta < 0 ? " upgrade-popup__delta--down" : ""}`}
                                        >
                                            {" "}
                                            ({delta > 0 ? "+" : "−"}
                                            {formatNumber(Math.abs(delta))})
                                        </span>
                                    )}
                                </dd>
                            </div>
                        );
                    })}
                </dl>
            ) : (
                <p className="upgrade-popup__muted">No output or stats to improve.</p>
            )}
        </div>
    );
}

/** Current and next tier side by side, with what the upgrade costs. */
export function UpgradePopup({
    item,
    name,
    context,
    economy,
    priority,
    onPriorityChange,
    onBuild,
    onClose
}: UpgradePopupProps) {
    const balance = context.balance;
    const typeName = targetTypeName(item.target);
    const current = item.tier - 1;
    const check = canBuild(context, economy, item);
    const turns = buildItemTurns(item, balance);
    return (
        <Modal
            className="upgrade-popup"
            title={`Upgrade ${name}`}
            onClose={onClose}
            toolbar={
                <span className="upgrade-popup__priority">
                    Priority{" "}
                    <PriorityPicker
                        label="Priority for the upgrade"
                        value={priority}
                        onChange={onPriorityChange}
                    />
                </span>
            }
        >
            <div className="upgrade-popup__summary">
                <Thumbnail src={buildItemImage(item)} label={typeName} size="lg" />
                <div>
                    <strong>{typeName}</strong>
                    {name !== typeName && <span className="upgrade-popup__muted"> {name}</span>}
                    {item.target.kind === "ship" && (
                        <p className="upgrade-popup__muted">
                            The upgrade is lost if the ship leaves before it completes.
                        </p>
                    )}
                </div>
            </div>
            <div className="upgrade-popup__tiers">
                <TierColumn
                    heading={`Current · Tier ${current}`}
                    stats={tierStats(item.target, current, balance)}
                />
                <span className="upgrade-popup__arrow" aria-hidden="true">
                    →
                </span>
                <TierColumn
                    heading={`Tier ${item.tier}`}
                    stats={tierStats(item.target, item.tier, balance)}
                    previous={tierStats(item.target, current, balance)}
                />
            </div>
            <div className="upgrade-popup__footer">
                <span className="upgrade-popup__cost">
                    Cost <CostList cost={buildItemCost(item, balance)} />
                    <span className="upgrade-popup__muted">
                        {turns} turn{turns === 1 ? "" : "s"} min
                    </span>
                </span>
                {!check.ok && <span className="upgrade-popup__reason">{check.reason}</span>}
                <button
                    type="button"
                    className="upgrade-popup__action"
                    disabled={!check.ok}
                    title={check.ok ? undefined : check.reason}
                    onClick={() => {
                        onBuild(item);
                        onClose();
                    }}
                >
                    Upgrade to T{item.tier}
                </button>
            </div>
        </Modal>
    );
}
