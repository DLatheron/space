import {
    GROUND_UNIT_TYPE_INFO,
    shipDef,
    type EconomyBalance,
    type EntityId,
    type GroundUnit
} from "@space/shared-data";
import { imageUrl } from "../../assets/images.js";
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

function UnitSummary({ unit, balance }: { unit: GroundUnit; balance: EconomyBalance }) {
    const name = GROUND_UNIT_TYPE_INFO[unit.unitType].name;
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
    upgradingIds: ReadonlySet<EntityId>;
    onUnload: (shipId: EntityId, unitIds: EntityId[]) => void;
    onUpgrade: (ship: ShipEntity) => void;
};

export function OrbitList({
    ships,
    balance,
    aboard,
    upgradingIds,
    onUnload,
    onUpgrade
}: OrbitListProps) {
    return (
        <ul className="forces">
            {ships.map((ship) => {
                const tier = ship.tier ?? 1;
                const def = shipDef(ship.shipType, balance);
                const carried = aboard(ship);
                return (
                    <li key={ship.id} className="forces__ship">
                        <div className="forces__row">
                            <span className="forces__who">
                                <Thumbnail
                                    src={imageUrl({ kind: "ship", shipType: ship.shipType })}
                                    label={def.name}
                                    size="sm"
                                />
                                <span className="forces__name">
                                    <strong>{ship.name ?? def.name}</strong>{" "}
                                    <span className="forces__tier">T{tier}</span>
                                    <span className="forces__muted"> {def.name}</span>
                                </span>
                            </span>
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
                                <UpgradeAction
                                    tier={tier}
                                    maxTier={def.maxTier}
                                    upgrading={upgradingIds.has(ship.id)}
                                    name={ship.name ?? def.name}
                                    onUpgrade={() => onUpgrade(ship)}
                                />
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
                    </li>
                );
            })}
        </ul>
    );
}
