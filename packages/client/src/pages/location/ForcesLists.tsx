import {
    GROUND_UNIT_TYPE_INFO,
    groundUnitStats,
    shipDef,
    type EconomyBalance,
    type EntityId,
    type GroundUnit
} from "@space/shared-data";
import { imageUrl } from "../../assets/images.js";
import { formatNumber } from "../../components/format.js";
import { Thumbnail } from "../../components/Thumbnail.js";
import type { ShipEntity } from "../../world/HexWorld.js";
import { unitStatsLabel } from "./locationItems.js";
import "./ForcesLists.css";

function UpgradeAction({
    tier,
    maxTier,
    upgrading,
    name,
    onUpgrade
}: {
    tier: number;
    maxTier: number;
    upgrading: boolean;
    name: string;
    onUpgrade: () => void;
}) {
    if (tier >= maxTier) return null;
    return (
        <button
            type="button"
            disabled={upgrading}
            title={upgrading ? "Already being upgraded" : `Upgrade ${name}`}
            onClick={onUpgrade}
        >
            {upgrading ? "Upgrading" : `Upgrade to T${tier + 1}`}
        </button>
    );
}

/** "80/120 HP", flagged when damaged. */
function HpLabel({ hp, max }: { hp: number; max: number }) {
    return (
        <span className={`forces__hp${hp < max ? " forces__hp--damaged" : ""}`} title="Hull">
            {" "}
            {formatNumber(hp)}/{formatNumber(max)} HP
        </span>
    );
}

function UnitSummary({ unit, balance }: { unit: GroundUnit; balance: EconomyBalance }) {
    const name = GROUND_UNIT_TYPE_INFO[unit.unitType].name;
    const maxHp = groundUnitStats(unit.unitType, unit.tier, balance).hp;
    return (
        <span className="forces__who">
            <Thumbnail
                src={imageUrl({ kind: "groundUnit", unitType: unit.unitType })}
                label={name}
                size="sm"
            />
            <span className="forces__name">
                <strong>{name}</strong> <span className="forces__tier">T{unit.tier}</span>
                <span className="forces__muted" title="Attack / defence">
                    {" "}
                    {unitStatsLabel(unit, balance)}
                </span>
                <HpLabel hp={unit.hp ?? maxHp} max={Math.max(maxHp, unit.hp ?? 0)} />
            </span>
        </span>
    );
}

type GarrisonListProps = {
    garrison: GroundUnit[];
    balance: EconomyBalance;
    transports: ShipEntity[];
    /** Free unit capacity on a transport. */
    roomOn: (ship: ShipEntity) => number;
    upgradingIds: ReadonlySet<EntityId>;
    onLoad: (shipId: EntityId, unitId: EntityId) => void;
    onUpgrade: (unit: GroundUnit) => void;
};

export function GarrisonList({
    garrison,
    balance,
    transports,
    roomOn,
    upgradingIds,
    onLoad,
    onUpgrade
}: GarrisonListProps) {
    return (
        <ul className="forces">
            {garrison.map((unit) => (
                <li key={unit.id} className="forces__row">
                    <UnitSummary unit={unit} balance={balance} />
                    <span className="forces__actions">
                        {transports.map((ship) => (
                            <button
                                key={ship.id}
                                type="button"
                                disabled={roomOn(ship) <= 0}
                                title={
                                    roomOn(ship) > 0
                                        ? `Board ${ship.name ?? "transport"}`
                                        : `${ship.name ?? "Transport"} is full`
                                }
                                onClick={() => onLoad(ship.id, unit.id)}
                            >
                                Load
                                {transports.length > 1 && ` → ${ship.name ?? ship.id}`}
                            </button>
                        ))}
                        <UpgradeAction
                            tier={unit.tier}
                            maxTier={balance.groundUnits[unit.unitType].maxTier}
                            upgrading={upgradingIds.has(unit.id)}
                            name={GROUND_UNIT_TYPE_INFO[unit.unitType].name}
                            onUpgrade={() => onUpgrade(unit)}
                        />
                    </span>
                </li>
            ))}
        </ul>
    );
}

type OrbitListProps = {
    ships: ShipEntity[];
    balance: EconomyBalance;
    /** Units aboard a transport (undefined when not a transport); `unit` is missing if unknown. */
    aboard: (ship: ShipEntity) => { id: EntityId; unit?: GroundUnit }[] | undefined;
    /** Ships aboard a carrier (undefined when it has no hangar). */
    hangar: (ship: ShipEntity) => ShipEntity[] | undefined;
    hpOf: (ship: ShipEntity) => { hp: number; max: number } | undefined;
    upgradingIds: ReadonlySet<EntityId>;
    onUnload: (shipId: EntityId, unitIds: EntityId[]) => void;
    onUnloadShips: (carrierId: EntityId, shipIds: EntityId[]) => void;
    /** Absent where ships can't be refitted (a Space Dock). */
    onUpgrade?: (ship: ShipEntity) => void;
};

/** Thumbnail, name, tier, class and hull of a ship. */
function ShipSummary({
    ship,
    balance,
    hp
}: {
    ship: ShipEntity;
    balance: EconomyBalance;
    hp: { hp: number; max: number } | undefined;
}) {
    const def = shipDef(ship.shipType, balance);
    return (
        <span className="forces__who">
            <Thumbnail
                src={imageUrl({ kind: "ship", shipType: ship.shipType })}
                label={def.name}
                size="sm"
            />
            <span className="forces__name">
                <strong>{ship.name ?? def.name}</strong>{" "}
                <span className="forces__tier">T{ship.tier ?? 1}</span>
                <span className="forces__muted"> {def.name}</span>
                {hp && <HpLabel hp={hp.hp} max={hp.max} />}
            </span>
        </span>
    );
}

export function OrbitList({
    ships,
    balance,
    aboard,
    hangar,
    hpOf,
    upgradingIds,
    onUnload,
    onUnloadShips,
    onUpgrade
}: OrbitListProps) {
    return (
        <ul className="forces">
            {ships.map((ship) => {
                const tier = ship.tier ?? 1;
                const def = shipDef(ship.shipType, balance);
                const carried = aboard(ship);
                const hangared = hangar(ship);
                return (
                    <li key={ship.id} className="forces__ship">
                        <div className="forces__row">
                            <ShipSummary ship={ship} balance={balance} hp={hpOf(ship)} />
                            <span className="forces__actions">
                                {carried && carried.length > 1 && (
                                    <button
                                        type="button"
                                        onClick={() =>
                                            onUnload(
                                                ship.id,
                                                carried.map((a) => a.id)
                                            )
                                        }
                                    >
                                        Unload all
                                    </button>
                                )}
                                {hangared && hangared.length > 1 && (
                                    <button
                                        type="button"
                                        title="Launch every ship aboard"
                                        onClick={() =>
                                            onUnloadShips(
                                                ship.id,
                                                hangared.map((s) => s.id)
                                            )
                                        }
                                    >
                                        Launch all
                                    </button>
                                )}
                                {onUpgrade && (
                                    <UpgradeAction
                                        tier={tier}
                                        maxTier={def.maxTier}
                                        upgrading={upgradingIds.has(ship.id)}
                                        name={ship.name ?? def.name}
                                        onUpgrade={() => onUpgrade(ship)}
                                    />
                                )}
                            </span>
                        </div>
                        {carried && (
                            <ul className="forces__aboard">
                                {carried.map(({ id, unit }) => (
                                    <li key={id} className="forces__row">
                                        {unit ? (
                                            <UnitSummary unit={unit} balance={balance} />
                                        ) : (
                                            <span className="forces__muted">{id}</span>
                                        )}
                                        <button
                                            type="button"
                                            title="Land into this garrison"
                                            onClick={() => onUnload(ship.id, [id])}
                                        >
                                            Unload
                                        </button>
                                    </li>
                                ))}
                                <li className="forces__muted">
                                    {carried.length}/{def.unitCapacity} aboard
                                </li>
                            </ul>
                        )}
                        {hangared && (
                            <ul className="forces__aboard">
                                {hangared.map((s) => (
                                    <li key={s.id} className="forces__row">
                                        <ShipSummary ship={s} balance={balance} hp={hpOf(s)} />
                                        <button
                                            type="button"
                                            title="Launch into orbit"
                                            onClick={() => onUnloadShips(ship.id, [s.id])}
                                        >
                                            Unload
                                        </button>
                                    </li>
                                ))}
                                <li className="forces__muted">
                                    {hangared.length}/{def.hangar?.capacity ?? 0} ships in hangar
                                </li>
                            </ul>
                        )}
                    </li>
                );
            })}
        </ul>
    );
}
