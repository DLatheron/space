import {
    BUILD_CATEGORIES,
    RESOURCE_KEYS,
    type BuildCategory,
    type BuildSlots,
    type Resources
} from "@space/shared-data";
import { formatNumber, formatResources, RESOURCE_LABELS } from "../../components/format.js";
import { CATEGORY_LABELS } from "./locationItems.js";
import "./StockpileStrip.css";

type StockpileStripProps = {
    stockpile: Resources;
    cap: Resources;
    income: Resources;
    home: boolean;
    /** Cargo on every supply ship heading here, and the share due next turn. */
    inboundCargo: Resources;
    arrivingCargo: Resources;
    inboundShips: number;
    waitingShips: number;
    slots: BuildSlots;
    /** Active orders per category. */
    running: Record<BuildCategory, number>;
};

/** Local stockpile against its caps, plus how many orders of each kind can build at once. */
export function StockpileStrip({
    stockpile,
    cap,
    income,
    home,
    inboundCargo,
    arrivingCargo,
    inboundShips,
    waitingShips,
    slots,
    running
}: StockpileStripProps) {
    const categories = BUILD_CATEGORIES.filter((c) => slots[c] > 0);
    return (
        <div className="stockpile">
            <ul
                className="stockpile__resources"
                aria-label={`Stockpile held here / cap${home ? " (home planet)" : ""}`}
            >
                {RESOURCE_KEYS.map((key) => {
                    const full = stockpile[key] >= cap[key];
                    return (
                        <li
                            key={key}
                            className={`stockpile__stock${full ? " stockpile__stock--full" : ""}`}
                            title={
                                full
                                    ? "Full: production over the cap is lost and supply ships wait to unload"
                                    : undefined
                            }
                        >
                            <span className={`stockpile__label resource-text--${key}`}>
                                {RESOURCE_LABELS[key]}
                                {full && <span className="stockpile__full"> Full</span>}
                            </span>
                            <span>
                                <strong>{formatNumber(stockpile[key])}</strong>
                                <span className="stockpile__cap">/{formatNumber(cap[key])}</span>
                            </span>
                            <span className="stockpile__muted">
                                {income[key] > 0 && `+${formatNumber(income[key])}/turn`}
                                {inboundCargo[key] > 0 &&
                                    ` · ${formatNumber(inboundCargo[key])} inbound`}
                            </span>
                        </li>
                    );
                })}
            </ul>
            <div className="stockpile__slots">
                <span className="stockpile__label">Building at once</span>
                {categories.length ? (
                    <ul>
                        {categories.map((c) => (
                            <li
                                key={c}
                                className={
                                    running[c] >= slots[c] ? "stockpile__slot--busy" : undefined
                                }
                            >
                                {CATEGORY_LABELS[c]}{" "}
                                <strong>
                                    {running[c]}/{slots[c]}
                                </strong>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <span className="stockpile__muted">No build slots here</span>
                )}
                <span className="stockpile__muted">
                    Extra orders wait, unfunded, by priority then queue position.
                </span>
            </div>
            {inboundShips > 0 && (
                <p className="stockpile__note">
                    {inboundShips} supply ship{inboundShips === 1 ? "" : "s"} on the way;{" "}
                    {formatResources(arrivingCargo, "none")} arriving next turn.
                    {waitingShips > 0 && ` ${waitingShips} waiting here for room to unload.`}
                </p>
            )}
        </div>
    );
}
