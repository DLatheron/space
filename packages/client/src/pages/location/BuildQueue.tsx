import {
    buildCategory,
    buildItemName,
    isFullyFunded,
    RESOURCE_KEYS,
    zeroResources,
    type BuildCategory,
    type BuildOrder,
    type BuildPriority,
    type OrderId,
    type QueueDirection,
    type Resources
} from "@space/shared-data";
import { buildItemImage } from "../../assets/images.js";
import { Thumbnail } from "../../components/Thumbnail.js";
import { FundingBars } from "./FundingBars.js";
import { CATEGORY_LABELS, READY_LABEL } from "./locationItems.js";
import { PriorityPicker } from "./PriorityPicker.js";
import "./BuildQueue.css";

type BuildQueueProps = {
    category: BuildCategory;
    /** This queue's orders, in queue order (see `queueCategory`). */
    orders: BuildOrder[];
    /** Build slots for the category, and how many slot-using orders are active. */
    slots: number;
    running: number;
    /** Orders over their category's limit, and fully funded ones (see `partitionOrders`). */
    waitingIds: ReadonlySet<OrderId>;
    readyIds: ReadonlySet<OrderId>;
    /** Orders after next turn's estimated funding, and what each draws. */
    next: ReadonlyMap<OrderId, BuildOrder>;
    drawn: Record<OrderId, Resources>;
    onPriorityChange: (orderId: OrderId, priority: BuildPriority) => void;
    onCancel: (orderId: OrderId) => void;
    onMove: (orderId: OrderId, direction: QueueDirection) => void;
};

/** One category's orders: slot usage, then each order with its controls and funding. */
export function BuildQueue({
    category,
    orders,
    slots,
    running,
    waitingIds,
    readyIds,
    next,
    drawn,
    onPriorityChange,
    onCancel,
    onMove
}: BuildQueueProps) {
    const waiting = orders.filter((o) => waitingIds.has(o.id)).length;
    const ready = orders.filter((o) => readyIds.has(o.id)).length;
    const unlimited = orders.filter(
        (o) => buildCategory(o.item) === undefined && !readyIds.has(o.id)
    ).length;
    return (
        <div className="build-queue">
            <p
                className="build-queue__summary"
                title="Orders are funded from this stockpile by priority. Waiting orders get the next free slot by priority, then queue position. Fully funded orders free their slot and complete at the following end of turn. Lighter bar segments estimate next turn's draw, including production and cargo due to arrive."
            >
                <span className="build-queue__label">Queue</span>
                <span className={running >= slots ? "build-queue__slots--busy" : undefined}>
                    {CATEGORY_LABELS[category]}{" "}
                    <strong>
                        {running}/{slots}
                    </strong>
                </span>
                {waiting > 0 && <span>· {waiting} waiting</span>}
                {ready > 0 && (
                    <span title="Fully funded orders complete next end of turn and don't use a build slot">
                        · {ready} ready
                    </span>
                )}
                {unlimited > 0 && (
                    <span title="Upgrades don't use a build slot">
                        · {unlimited} upgrade{unlimited === 1 ? "" : "s"}
                    </span>
                )}
            </p>
            {orders.length > 0 && (
                <ol className="build-queue__list">
                    {orders.map((order, index) => (
                        <QueueEntry
                            key={order.id}
                            order={order}
                            queued={waitingIds.has(order.id)}
                            ready={readyIds.has(order.id)}
                            after={next.get(order.id) ?? order}
                            draw={drawn[order.id] ?? zeroResources()}
                            first={index === 0}
                            last={index === orders.length - 1}
                            onPriorityChange={(priority) => onPriorityChange(order.id, priority)}
                            onCancel={() => onCancel(order.id)}
                            onMove={(direction) => onMove(order.id, direction)}
                        />
                    ))}
                </ol>
            )}
        </div>
    );
}

function QueueEntry({
    order,
    queued,
    ready,
    after,
    draw,
    first,
    last,
    onPriorityChange,
    onCancel,
    onMove
}: {
    order: BuildOrder;
    queued: boolean;
    ready: boolean;
    after: BuildOrder;
    draw: Resources;
    first: boolean;
    last: boolean;
    onPriorityChange: (priority: BuildPriority) => void;
    onCancel: () => void;
    onMove: (direction: QueueDirection) => void;
}) {
    const name = buildItemName(order.item);
    const status = ready
        ? READY_LABEL
        : queued
          ? "Waiting for a build slot"
          : isFullyFunded(after)
            ? "Fully funded at end of turn · ready the turn after"
            : RESOURCE_KEYS.some((k) => draw[k] > 0)
              ? "Funding"
              : "Waiting for resources";
    const modifier = ready
        ? " build-queue__entry--ready"
        : queued
          ? " build-queue__entry--queued"
          : "";
    return (
        <li className={`build-queue__entry${modifier}`}>
            <Thumbnail
                src={buildItemImage(order.item)}
                label={name}
                size="sm"
                tone={order.item.kind === "research" ? "research" : "default"}
            />
            <div className="build-queue__main">
                <span className="build-queue__head">
                    <span className="build-queue__title">
                        <strong>{name}</strong>{" "}
                        <span className="build-queue__status">{status}</span>
                    </span>
                    <span className="build-queue__controls">
                        <span className="build-queue__move">
                            <button
                                type="button"
                                disabled={first}
                                aria-label={`Move ${name} up`}
                                title="Move up the queue"
                                onClick={() => onMove("up")}
                            >
                                ▲
                            </button>
                            <button
                                type="button"
                                disabled={last}
                                aria-label={`Move ${name} down`}
                                title="Move down the queue"
                                onClick={() => onMove("down")}
                            >
                                ▼
                            </button>
                        </span>
                        <PriorityPicker
                            label={`Priority for ${name}`}
                            value={order.priority}
                            onChange={onPriorityChange}
                        />
                        <button
                            type="button"
                            className="build-queue__cancel"
                            title="Cancel; resources already applied go into this stockpile"
                            onClick={onCancel}
                        >
                            Cancel
                        </button>
                    </span>
                </span>
                <FundingBars order={order} draw={draw} ready={ready} />
            </div>
        </li>
    );
}
