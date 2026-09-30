import { RESOURCE_KEYS, type BuildOrder, type Resources } from "@space/shared-data";
import { formatNumber, RESOURCE_SHORT_LABELS } from "../../components/format.js";
import "./FundingBars.css";

/** Applied vs cost per resource, with next turn's estimated draw as a lighter segment. */
export function FundingBars({
    order,
    draw,
    ready = false
}: {
    order: BuildOrder;
    draw: Resources;
    /** Fully funded and waiting to complete: full bars in the ready colour. */
    ready?: boolean;
}) {
    return (
        <div className={`funding-bars${ready ? " funding-bars--ready" : ""}`}>
            {RESOURCE_KEYS.filter((key) => order.cost[key] > 0).map((key) => {
                const cost = order.cost[key];
                const applied = Math.min(cost, order.applied[key]);
                return (
                    <div key={key} className="funding-bars__row">
                        <span className={`resource-text--${key}`}>
                            {RESOURCE_SHORT_LABELS[key]}
                        </span>
                        <div className="funding-bars__track">
                            <div
                                className="funding-bars__fill"
                                style={{ width: `${(applied / cost) * 100}%` }}
                            />
                            <div
                                className="funding-bars__next"
                                style={{
                                    width: `${(Math.min(draw[key], cost - applied) / cost) * 100}%`
                                }}
                            />
                        </div>
                        <span className="funding-bars__amount">
                            {formatNumber(applied)}/{formatNumber(cost)}
                            {draw[key] > 0 && (
                                <span className="funding-bars__draw">
                                    {" "}
                                    +{formatNumber(draw[key])}
                                </span>
                            )}
                        </span>
                    </div>
                );
            })}
        </div>
    );
}
