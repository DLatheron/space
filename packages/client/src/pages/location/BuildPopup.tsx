import {
    buildItemCost,
    buildItemName,
    buildItemTurns,
    canBuild,
    type BuildContext,
    type BuildItem,
    type BuildPriority,
    type LocationEconomy
} from "@space/shared-data";
import { buildItemImage } from "../../assets/images.js";
import { Modal } from "../../components/Modal.js";
import { OptionRow } from "../../components/OptionRow.js";
import { Thumbnail } from "../../components/Thumbnail.js";
import { itemDescription, itemKey, itemStats } from "./locationItems.js";
import { PriorityPicker } from "./PriorityPicker.js";
import "./BuildPopup.css";

type BuildPopupProps = {
    title: string;
    /** Muted text beside the title, e.g. the ship cap. */
    detail?: string;
    items: BuildItem[];
    actionLabel: string;
    context: BuildContext;
    economy: LocationEconomy;
    priority: BuildPriority;
    onPriorityChange: (priority: BuildPriority) => void;
    /** Places the order; the popup closes itself afterwards. */
    onBuild: (item: BuildItem) => void;
    onClose: () => void;
};

/** Orderable installations, ground units, ships or techs, with unavailable ones greyed out. */
export function BuildPopup({
    title,
    detail,
    items,
    actionLabel,
    context,
    economy,
    priority,
    onPriorityChange,
    onBuild,
    onClose
}: BuildPopupProps) {
    const balance = context.balance;
    return (
        <Modal
            title={
                <>
                    {title}
                    {detail && <span className="build-popup__detail">{detail}</span>}
                </>
            }
            onClose={onClose}
            toolbar={
                <>
                    <span className="build-popup__priority">
                        Priority{" "}
                        <PriorityPicker
                            label="Priority for the new order"
                            value={priority}
                            onChange={onPriorityChange}
                        />
                    </span>
                    <span>Orders are funded over time from this location&apos;s stockpile.</span>
                </>
            }
        >
            <ul className="build-popup__options">
                {items.map((item) => {
                    const name = buildItemName(item);
                    const known = item.kind === "research" && context.techs.includes(item.techId);
                    const check = canBuild(context, economy, item);
                    return (
                        <OptionRow
                            key={itemKey(item)}
                            thumbnail={
                                <Thumbnail
                                    src={buildItemImage(item)}
                                    label={name}
                                    size="lg"
                                    tone={item.kind === "research" ? "research" : "default"}
                                />
                            }
                            name={name}
                            badge={known ? "Known" : undefined}
                            description={itemDescription(item, balance)}
                            stats={itemStats(item, balance)}
                            cost={known ? undefined : buildItemCost(item, balance)}
                            turns={known ? undefined : buildItemTurns(item, balance)}
                            reason={known || check.ok ? undefined : check.reason}
                            actionLabel={known ? undefined : actionLabel}
                            onAction={() => {
                                onBuild(item);
                                onClose();
                            }}
                        />
                    );
                })}
            </ul>
        </Modal>
    );
}
