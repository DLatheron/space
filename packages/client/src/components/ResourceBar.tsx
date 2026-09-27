import { useEffect, useRef, useState } from "react";
import { RESOURCE_KEYS, type Resources } from "@space/shared-data";
import { useHexWorldVersion } from "../hooks/index.js";
import { HexWorld } from "../world/HexWorld.js";
import { formatDelta, formatNumber } from "./format.js";
import "./ResourceBar.css";

const COUNT_DURATION_MS = 1500;

const RESOURCE_LABELS: Record<keyof Resources, string> = {
    food: "Food",
    gold: "Gold",
    resources: "Resources"
};

function easeOutCubic(t: number): number {
    return 1 - Math.pow(1 - t, 3);
}

type Badge = { id: number; amount: number };

/** Counts from the previously shown number to `value`; the first value appears as-is. */
function AnimatedNumber({ value }: { value: number }) {
    const [shown, setShown] = useState(value);
    const [target, setTarget] = useState(value);
    const [badges, setBadges] = useState<Badge[]>([]);
    const [badgeSeq, setBadgeSeq] = useState(0);
    const shownRef = useRef(value);

    if (value !== target) {
        setTarget(value);
        setBadges((prev) => [...prev, { id: badgeSeq, amount: value - target }]);
        setBadgeSeq(badgeSeq + 1);
    }

    useEffect(() => {
        const from = shownRef.current;
        if (from === value) return;
        const start = performance.now();
        let frame = requestAnimationFrame(function step(now) {
            const t = Math.min(1, (now - start) / COUNT_DURATION_MS);
            const next = Math.round(from + (value - from) * easeOutCubic(t));
            shownRef.current = next;
            setShown(next);
            if (t < 1) frame = requestAnimationFrame(step);
        });
        return () => cancelAnimationFrame(frame);
    }, [value]);

    const removeBadge = (id: number) => {
        setBadges((prev) => prev.filter((b) => b.id !== id));
    };

    return (
        <span className="resource-bar__value">
            {formatNumber(shown)}
            {badges.map((badge) => (
                <span
                    key={badge.id}
                    className={`resource-bar__delta resource-bar__delta--${badge.amount > 0 ? "up" : "down"}`}
                    onAnimationEnd={() => removeBadge(badge.id)}
                    aria-hidden="true"
                >
                    {formatDelta(badge.amount)}
                </span>
            ))}
        </span>
    );
}

type ResourceBarProps = {
    world: HexWorld;
};

export function ResourceBar({ world }: ResourceBarProps) {
    useHexWorldVersion(world);
    const economy = world.economy;
    if (!economy) return null;

    const atCap = economy.shipCount >= economy.shipCap;

    return (
        <div className="resource-bar" role="status" aria-label="Stockpile">
            <div className="resource-bar__inner">
                {RESOURCE_KEYS.map((key) => {
                    const income = economy.lastIncome[key];
                    return (
                        <div
                            key={key}
                            className={`resource-bar__item resource-bar__item--${key}`}
                            title={`${RESOURCE_LABELS[key]}: ${formatNumber(economy.stockpile[key])} (last income ${formatDelta(income)})`}
                        >
                            <span className="resource-bar__label">{RESOURCE_LABELS[key]}</span>
                            <AnimatedNumber value={economy.stockpile[key]} />
                        </div>
                    );
                })}
                <div
                    className={`resource-bar__item resource-bar__item--ships${atCap ? " resource-bar__item--capped" : ""}`}
                    title="Ships built or queued / ship cap"
                >
                    <span className="resource-bar__label">Ships</span>
                    <span className="resource-bar__ships">
                        <AnimatedNumber value={economy.shipCount} />/
                        <AnimatedNumber value={economy.shipCap} />
                    </span>
                </div>
            </div>
        </div>
    );
}
