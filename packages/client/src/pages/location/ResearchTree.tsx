import {
    buildItemCost,
    buildItemTurns,
    canBuild,
    TECHS,
    TechId,
    type BuildContext,
    type BuildItem,
    type BuildPriority,
    type LocationEconomy
} from "@space/shared-data";
import { useMemo, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { buildItemImage } from "../../assets/images.js";
import { CostList } from "../../components/CostList.js";
import { Modal } from "../../components/Modal.js";
import { Thumbnail } from "../../components/Thumbnail.js";
import { PriorityPicker } from "./PriorityPicker.js";
import {
    edgePath,
    layoutTechTree,
    TECH_NODE_HEIGHT,
    TECH_NODE_WIDTH,
    techWithPrerequisites,
    type TechNodeLayout
} from "./researchLayout.js";
import "./ResearchTree.css";

type TechState = "known" | "researching" | "available" | "locked";

const STATE_LABELS: Record<TechState, string> = {
    known: "Known",
    researching: "Researching",
    available: "Available",
    locked: "Locked"
};

const ALREADY_RESEARCHING = "Already being researched";
/** Pointer travel (px) after which a press becomes a pan rather than a click. */
const DRAG_THRESHOLD = 4;

type ResearchTreeProps = {
    context: BuildContext;
    economy: LocationEconomy;
    priority: BuildPriority;
    onPriorityChange: (priority: BuildPriority) => void;
    /** Places the order; the modal closes itself afterwards. */
    onBuild: (item: BuildItem) => void;
    onClose: () => void;
};

type TechInfo = {
    item: BuildItem;
    state: TechState;
    /** Why it can't be ordered, unless known or already being researched. */
    reason?: string;
};

/** Full-screen, left-to-right graph of every tech and its prerequisites; click to research. */
export function ResearchTree({
    context,
    economy,
    priority,
    onPriorityChange,
    onBuild,
    onClose
}: ResearchTreeProps) {
    const layout = useMemo(() => layoutTechTree(), []);
    const [hovered, setHovered] = useState<TechId | null>(null);
    const highlighted = useMemo(
        () => (hovered ? techWithPrerequisites(hovered) : new Set<TechId>()),
        [hovered]
    );

    const info = (techId: TechId): TechInfo => {
        const item: BuildItem = { kind: "research", techId };
        if (context.techs.includes(techId)) return { item, state: "known" };
        const check = canBuild(context, economy, item);
        if (check.ok) return { item, state: "available" };
        if (check.reason === ALREADY_RESEARCHING) return { item, state: "researching" };
        return { item, state: "locked", reason: check.reason };
    };

    const pan = usePan();
    const order = (techId: TechId) => {
        const tech = info(techId);
        if (tech.state !== "available") return;
        onBuild(tech.item);
        onClose();
    };

    const hoveredNode = hovered ? layout.nodes.get(hovered) : undefined;

    return (
        <Modal
            className="research-tree-modal"
            title={
                <>
                    Research
                    <span className="research-tree__detail">
                        {context.techs.length}/{TechId.options.length} techs known
                    </span>
                </>
            }
            onClose={onClose}
            toolbar={
                <>
                    <span className="research-tree__priority">
                        Priority{" "}
                        <PriorityPicker
                            label="Priority for the new order"
                            value={priority}
                            onChange={onPriorityChange}
                        />
                    </span>
                    <span className="research-tree__legend">
                        {(Object.keys(STATE_LABELS) as TechState[]).map((state) => (
                            <span
                                key={state}
                                className={`research-tree__key research-tree__key--${state}`}
                            >
                                {STATE_LABELS[state]}
                            </span>
                        ))}
                    </span>
                    <span>Click an available tech to research it · Drag or scroll to pan</span>
                </>
            }
        >
            <div
                ref={pan.ref}
                className={`research-tree${pan.dragging ? " research-tree--dragging" : ""}`}
                {...pan.handlers}
            >
                <div
                    className="research-tree__canvas"
                    style={{ width: layout.width, height: layout.height }}
                >
                    <svg
                        className="research-tree__edges"
                        width={layout.width}
                        height={layout.height}
                        aria-hidden="true"
                    >
                        {layout.edges.map(({ from, to }) => {
                            const lit = highlighted.has(from) && highlighted.has(to);
                            const done = context.techs.includes(from);
                            return (
                                <path
                                    key={`${from}-${to}`}
                                    d={edgePath(layout.nodes.get(from)!, layout.nodes.get(to)!)}
                                    className={`research-tree__edge${done ? " research-tree__edge--met" : ""}${lit ? " research-tree__edge--lit" : ""}`}
                                />
                            );
                        })}
                    </svg>
                    {[...layout.nodes.values()].map((node) => (
                        <TechNode
                            key={node.techId}
                            node={node}
                            tech={info(node.techId)}
                            balance={context.balance}
                            lit={highlighted.has(node.techId)}
                            onHover={setHovered}
                            onOrder={order}
                        />
                    ))}
                    {hoveredNode && (
                        <TechTooltip
                            node={hoveredNode}
                            tech={info(hoveredNode.techId)}
                            techs={context.techs}
                            balance={context.balance}
                            flip={hoveredNode.column === layout.columns - 1}
                        />
                    )}
                </div>
            </div>
        </Modal>
    );
}

function TechNode({
    node,
    tech,
    balance,
    lit,
    onHover,
    onOrder
}: {
    node: TechNodeLayout;
    tech: TechInfo;
    balance: BuildContext["balance"];
    lit: boolean;
    onHover: (techId: TechId | null) => void;
    onOrder: (techId: TechId) => void;
}) {
    const name = TECHS[node.techId].name;
    const orderable = tech.state === "available";
    return (
        <button
            type="button"
            className={`research-tree__node research-tree__node--${tech.state}${lit ? " research-tree__node--lit" : ""}`}
            style={{ left: node.x, top: node.y, width: TECH_NODE_WIDTH, height: TECH_NODE_HEIGHT }}
            aria-disabled={!orderable}
            aria-label={`${name} (${STATE_LABELS[tech.state]})`}
            onPointerEnter={() => onHover(node.techId)}
            onPointerLeave={() => onHover(null)}
            onFocus={() => onHover(node.techId)}
            onBlur={() => onHover(null)}
            onClick={() => onOrder(node.techId)}
        >
            <Thumbnail
                src={buildItemImage(tech.item)}
                label={name}
                size="md"
                tone="research"
                className="research-tree__image"
            />
            <span className="research-tree__node-text">
                <strong>{name}</strong>
                {tech.state === "known" || tech.state === "researching" ? (
                    <span className="research-tree__status">{STATE_LABELS[tech.state]}</span>
                ) : (
                    <span className="research-tree__meta">
                        <CostList cost={buildItemCost(tech.item, balance)} />
                        <span className="research-tree__turns">
                            {buildItemTurns(tech.item, balance)}t
                        </span>
                    </span>
                )}
            </span>
        </button>
    );
}

function TechTooltip({
    node,
    tech,
    techs,
    balance,
    flip
}: {
    node: TechNodeLayout;
    tech: TechInfo;
    techs: readonly TechId[];
    balance: BuildContext["balance"];
    /** Show on the node's left (for the last column). */
    flip: boolean;
}) {
    const def = TECHS[node.techId];
    const turns = buildItemTurns(tech.item, balance);
    return (
        <div
            className={`research-tree__tooltip${flip ? " research-tree__tooltip--flip" : ""}`}
            style={{
                top: node.y,
                left: flip ? node.x - 12 : node.x + TECH_NODE_WIDTH + 12
            }}
            role="tooltip"
        >
            <span className="research-tree__tooltip-head">
                <strong>{def.name}</strong>
                <span className={`research-tree__key research-tree__key--${tech.state}`}>
                    {STATE_LABELS[tech.state]}
                </span>
            </span>
            <p>{def.description}</p>
            <span className="research-tree__meta">
                <CostList cost={buildItemCost(tech.item, balance)} />
                <span className="research-tree__turns">
                    {turns} turn{turns === 1 ? "" : "s"} min
                </span>
            </span>
            {def.requires.length > 0 && (
                <ul className="research-tree__requires">
                    {def.requires.map((t) => {
                        const met = techs.includes(t);
                        return (
                            <li key={t} className={met ? "research-tree__requires--met" : ""}>
                                {met ? "✓" : "✗"} {TECHS[t].name}
                            </li>
                        );
                    })}
                </ul>
            )}
            {tech.reason && <span className="research-tree__reason">{tech.reason}</span>}
        </div>
    );
}

/** Click-drag panning of a scroll container that doesn't swallow ordinary clicks. */
function usePan() {
    const ref = useRef<HTMLDivElement>(null);
    const drag = useRef<{ x: number; y: number; left: number; top: number; moved: boolean }>(null);
    const [dragging, setDragging] = useState(false);

    const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
        if (e.button !== 0 || !ref.current) return;
        drag.current = {
            x: e.clientX,
            y: e.clientY,
            left: ref.current.scrollLeft,
            top: ref.current.scrollTop,
            moved: false
        };
    };
    const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
        const start = drag.current;
        const el = ref.current;
        if (!start || !el) return;
        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        if (!start.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        if (!start.moved) {
            start.moved = true;
            setDragging(true);
            el.setPointerCapture(e.pointerId);
        }
        el.scrollLeft = start.left - dx;
        el.scrollTop = start.top - dy;
    };
    const end = (e: PointerEvent<HTMLDivElement>) => {
        if (ref.current?.hasPointerCapture(e.pointerId)) {
            ref.current.releasePointerCapture(e.pointerId);
        }
        setDragging(false);
        // Leave `moved` set until the click that follows a drag has been swallowed.
        if (!drag.current?.moved) drag.current = null;
    };
    const onClickCapture = (e: MouseEvent<HTMLDivElement>) => {
        if (drag.current?.moved) {
            e.preventDefault();
            e.stopPropagation();
        }
        drag.current = null;
    };

    return {
        ref,
        dragging,
        handlers: {
            onPointerDown,
            onPointerMove,
            onPointerUp: end,
            onPointerCancel: end,
            onClickCapture
        }
    };
}
