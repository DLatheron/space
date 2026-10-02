import {
    batteryStats,
    platformStats,
    shieldStats,
    type BuildPriority,
    type EconomyBalance,
    type Installation,
    type ShieldState
} from "@space/shared-data";
import { CostList } from "../../components/CostList.js";
import { formatNumber } from "../../components/format.js";
import { PriorityPicker } from "./PriorityPicker.js";
import "./DefenceDetails.css";

function HpBar({ hp, max, label }: { hp: number; max: number; label: string }) {
    const fraction = max > 0 ? Math.min(1, hp / max) : 0;
    return (
        <span className="defences__hp" title={label}>
            <span className="defences__hp-text">
                {label} {formatNumber(hp)}/{formatNumber(max)}
            </span>
            <span className="defences__hp-track">
                <span
                    className={`defences__hp-fill${hp < max ? " defences__hp-fill--damaged" : ""}`}
                    style={{ width: `${fraction * 100}%` }}
                />
            </span>
        </span>
    );
}

/** Combat stats or shield charge of a built defensive structure, under its tile. */
export function DefenceTileStats({
    installation,
    balance,
    shield
}: {
    installation: Installation;
    balance: EconomyBalance;
    shield?: ShieldState;
}) {
    switch (installation.type) {
        case "shield_generator": {
            const { capacity } = shieldStats(installation.tier, balance);
            return (
                <span className="defences__stats">
                    <HpBar hp={shield?.hp ?? 0} max={capacity} label="Shield" />
                </span>
            );
        }
        case "defensive_battery": {
            const { attack, defence } = batteryStats(installation.tier, balance);
            return (
                <span className="defences__stats">
                    Attack {attack} · Defence {defence}
                </span>
            );
        }
        case "orbital_platform": {
            const { attack, defence, hp } = platformStats(installation.tier, balance);
            return (
                <span className="defences__stats">
                    <HpBar hp={installation.hp ?? hp} max={hp} label="Hull" />
                    Attack {attack} · Defence {defence}
                </span>
            );
        }
        default:
            return null;
    }
}

/**
 * Charge, upkeep and upkeep priority of a location's shield. `nextSupplied` is the share of
 * upkeep next end of turn's funding is expected to cover.
 */
export function ShieldPanel({
    shield,
    generator,
    balance,
    nextSupplied,
    onPriorityChange
}: {
    shield: ShieldState;
    generator: Installation;
    balance: EconomyBalance;
    nextSupplied: number;
    onPriorityChange: (priority: BuildPriority) => void;
}) {
    const stats = shieldStats(generator.tier, balance);
    return (
        <div className="defences__shield">
            <HpBar hp={shield.hp} max={stats.capacity} label="Shield" />
            <span className="defences__shield-line">
                Recharges {formatNumber(stats.rechargePerTurn)}/turn · upkeep{" "}
                <CostList cost={stats.upkeep} />
                /turn
            </span>
            <span className="defences__shield-line">
                {Math.round(shield.supplied * 100)}% supplied last turn ·{" "}
                {Math.round(nextSupplied * 100)}% expected next turn
            </span>
            <PriorityPicker
                value={shield.priority}
                onChange={onPriorityChange}
                label="Shield upkeep priority"
            />
        </div>
    );
}
