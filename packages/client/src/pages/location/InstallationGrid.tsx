import type { ReactNode } from "react";
import {
    enhancementTargetId,
    isFullyFunded,
    structureCapBonus,
    structureDef,
    structureOutput,
    type BuildOrder,
    type EconomyBalance,
    type Installation,
    type LocationEconomy,
    type OrderId,
    type StructureType
} from "@space/shared-data";
import { imageUrl } from "../../assets/images.js";
import { Thumbnail } from "../../components/Thumbnail.js";
import { capSummary, orderProgress, outputSummary, READY_LABEL } from "./locationItems.js";
import "./InstallationGrid.css";

type InstallationGridProps = {
    economy: LocationEconomy;
    balance: EconomyBalance;
    /** Free structure slots, each shown as an `addLabel` tile. */
    freeSlots: number;
    /** Orders over their category's limit (see `partitionOrders`). */
    waitingIds: ReadonlySet<OrderId>;
    onAdd: () => void;
    onUpgrade: (installation: Installation) => void;
    /** Structure types listed here, built or on order; defaults to all. */
    show?: (type: StructureType) => boolean;
    addLabel?: string;
    /** Extra content under a built installation's picture. */
    detail?: (installation: Installation) => ReactNode;
};

function ProgressOverlay({
    order,
    waiting,
    label
}: {
    order: BuildOrder;
    waiting: boolean;
    label: string;
}) {
    const progress = orderProgress(order);
    return (
        <span className="installation-tile__progress">
            <span className="installation-tile__progress-label">
                {isFullyFunded(order)
                    ? `${label} · ${READY_LABEL}`
                    : waiting
                      ? `${label} · waiting for a slot`
                      : `${label} · ${Math.floor(progress * 100)}%`}
            </span>
            <span className="installation-tile__progress-track">
                <span
                    className="installation-tile__progress-fill"
                    style={{ width: `${progress * 100}%` }}
                />
            </span>
        </span>
    );
}

/** One tile per structure slot: built installations, those on order, then free slots. */
export function InstallationGrid({
    economy,
    balance,
    freeSlots,
    waitingIds,
    onAdd,
    onUpgrade,
    show = () => true,
    addLabel = "Add installation",
    detail
}: InstallationGridProps) {
    const upgrades = new Map<string, BuildOrder>();
    for (const order of economy.orders) {
        if (order.item.kind === "enhancement" && order.item.target.kind === "installation") {
            upgrades.set(enhancementTargetId(order.item.target), order);
        }
    }
    const construction = economy.orders.filter(
        (o) => o.item.kind === "structure" && show(o.item.structureType)
    );

    return (
        <ul className="installation-grid">
            {economy.installations
                .filter((inst) => show(inst.type))
                .map((inst) => {
                    const def = structureDef(inst.type, balance);
                    const upgrade = upgrades.get(inst.id);
                    const output = [
                        ...outputSummary(structureOutput(inst.type, inst.tier, balance)),
                        ...capSummary(structureCapBonus(inst.type, inst.tier, balance))
                    ];
                    const slots = def.slots ?? 1;
                    return (
                        <li
                            key={inst.id}
                            className="installation-tile"
                            title={[`${def.name} T${inst.tier}`, def.description, ...output].join(
                                "\n"
                            )}
                        >
                            <div className="installation-tile__picture">
                                <Thumbnail
                                    src={imageUrl({ kind: "structure", structureType: inst.type })}
                                    label={def.name}
                                    size="fill"
                                />
                                <span className="installation-tile__caption">
                                    <span className="installation-tile__name">
                                        <strong>{def.name}</strong>
                                        <span className="installation-tile__tier">
                                            T{inst.tier}
                                        </span>
                                    </span>
                                    {output.length > 0 && (
                                        <span className="installation-tile__output">
                                            {output.join(" · ")}
                                        </span>
                                    )}
                                </span>
                                {slots !== 1 && (
                                    <span className="installation-tile__slots">{slots} slots</span>
                                )}
                                {upgrade && (
                                    <ProgressOverlay
                                        order={upgrade}
                                        waiting={waitingIds.has(upgrade.id)}
                                        label={`Upgrading to T${inst.tier + 1}`}
                                    />
                                )}
                            </div>
                            {detail?.(inst)}
                            {inst.tier < def.maxTier ? (
                                <button
                                    type="button"
                                    className="installation-tile__action"
                                    disabled={!!upgrade}
                                    title={
                                        upgrade ? "Already being upgraded" : `Upgrade ${def.name}`
                                    }
                                    onClick={() => onUpgrade(inst)}
                                >
                                    {upgrade ? "Upgrading" : `Upgrade to T${inst.tier + 1}`}
                                </button>
                            ) : (
                                <span className="installation-tile__max">Max tier</span>
                            )}
                        </li>
                    );
                })}
            {construction.map((order) => {
                if (order.item.kind !== "structure") return null;
                const def = structureDef(order.item.structureType, balance);
                return (
                    <li
                        key={order.id}
                        className="installation-tile installation-tile--building"
                        title={`${def.name}\n${def.description}`}
                    >
                        <div className="installation-tile__picture">
                            <Thumbnail src={imageUrl(order.item)} label={def.name} size="fill" />
                            <span className="installation-tile__caption">
                                <span className="installation-tile__name">
                                    <strong>{def.name}</strong>
                                </span>
                            </span>
                            <ProgressOverlay
                                order={order}
                                waiting={waitingIds.has(order.id)}
                                label="Building"
                            />
                        </div>
                        <span className="installation-tile__max">
                            {isFullyFunded(order) ? "Ready next turn" : "Under construction"}
                        </span>
                    </li>
                );
            })}
            {Array.from({ length: freeSlots }, (_, i) => (
                <li key={`free-${i}`} className="installation-tile installation-tile--free">
                    <button type="button" className="installation-tile__add" onClick={onAdd}>
                        <span className="installation-tile__plus" aria-hidden="true">
                            +
                        </span>
                        {addLabel}
                    </button>
                </li>
            ))}
        </ul>
    );
}
