import type { ReactNode } from "react";
import type { Resources } from "@space/shared-data";
import { CostList } from "./CostList.js";
import "./OptionRow.css";

type OptionRowProps = {
    thumbnail: ReactNode;
    name: string;
    /** Small tag beside the name, e.g. "Known". */
    badge?: string;
    description?: string;
    /** Short facts such as output, stats or slots used, shown as chips. */
    stats?: string[];
    cost?: Resources;
    turns?: number;
    /** Why it can't be chosen; greys the row out and disables the action. */
    reason?: string;
    actionLabel?: string;
    onAction?: () => void;
};

/** One choice in a build popup: picture on the left, details and action on the right. */
export function OptionRow({
    thumbnail,
    name,
    badge,
    description,
    stats = [],
    cost,
    turns,
    reason,
    actionLabel,
    onAction
}: OptionRowProps) {
    return (
        <li className={`option-row${reason ? " option-row--unavailable" : ""}`}>
            {thumbnail}
            <div className="option-row__main">
                <span className="option-row__head">
                    <strong>{name}</strong>
                    {badge && <span className="option-row__badge">{badge}</span>}
                </span>
                {description && <span className="option-row__description">{description}</span>}
                {stats.length > 0 && (
                    <span className="option-row__stats">
                        {stats.map((stat) => (
                            <span key={stat} className="option-row__stat">
                                {stat}
                            </span>
                        ))}
                    </span>
                )}
                {(cost || turns !== undefined) && (
                    <span className="option-row__meta">
                        {cost && <CostList cost={cost} />}
                        {turns !== undefined && (
                            <span className="option-row__turns">
                                {turns} turn{turns === 1 ? "" : "s"} min
                            </span>
                        )}
                    </span>
                )}
                {reason && <span className="option-row__reason">{reason}</span>}
            </div>
            {actionLabel && onAction && (
                <button
                    type="button"
                    className="option-row__action"
                    disabled={!!reason}
                    title={reason ?? `${actionLabel} ${name}`}
                    onClick={onAction}
                >
                    {actionLabel}
                </button>
            )}
        </li>
    );
}
