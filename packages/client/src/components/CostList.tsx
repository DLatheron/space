import { RESOURCE_KEYS, type Resources } from "@space/shared-data";
import { formatNumber, RESOURCE_SHORT_LABELS } from "./format.js";
import "./CostList.css";

/** Non-zero amounts, each in its resource colour; `empty` when nothing is needed. */
export function CostList({ cost, empty = "Free" }: { cost: Resources; empty?: string }) {
    const keys = RESOURCE_KEYS.filter((key) => cost[key] > 0);
    if (!keys.length) return <span className="cost-list cost-list--empty">{empty}</span>;
    return (
        <span className="cost-list">
            {keys.map((key) => (
                <span key={key} className={`resource-text--${key}`}>
                    {formatNumber(cost[key])} {RESOURCE_SHORT_LABELS[key]}
                </span>
            ))}
        </span>
    );
}
