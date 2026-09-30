import type { BuildPriority } from "@space/shared-data";
import { PRIORITY_LABELS, PRIORITY_OPTIONS } from "./locationItems.js";
import "./PriorityPicker.css";

export function PriorityPicker({
    value,
    onChange,
    label
}: {
    value: BuildPriority;
    onChange: (priority: BuildPriority) => void;
    label: string;
}) {
    return (
        <span className="priority-picker" role="group" aria-label={label}>
            {PRIORITY_OPTIONS.map((priority) => (
                <button
                    key={priority}
                    type="button"
                    aria-pressed={value === priority}
                    className={`priority-picker__option priority-picker__option--${priority}${
                        value === priority ? " priority-picker__option--active" : ""
                    }`}
                    onClick={() => value !== priority && onChange(priority)}
                >
                    {PRIORITY_LABELS[priority]}
                </button>
            ))}
        </span>
    );
}
