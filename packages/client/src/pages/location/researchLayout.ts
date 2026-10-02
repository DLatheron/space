import { TECHS, TechId } from "@space/shared-data";

export const TECH_NODE_WIDTH = 248;
export const TECH_NODE_HEIGHT = 92;
const COLUMN_GAP = 104;
const ROW_GAP = 22;
const PADDING = 32;

export type TechNodeLayout = { techId: TechId; column: number; x: number; y: number };
export type TechEdge = { from: TechId; to: TechId };
export type TechTreeLayout = {
    nodes: Map<TechId, TechNodeLayout>;
    edges: TechEdge[];
    columns: number;
    width: number;
    height: number;
};

/** Longest prerequisite chain below each tech: 0 for techs that need nothing. */
export function techDepths(techs: readonly TechId[] = TechId.options): Map<TechId, number> {
    const depths = new Map<TechId, number>();
    const depth = (techId: TechId): number => {
        const known = depths.get(techId);
        if (known !== undefined) return known;
        const requires = TECHS[techId].requires;
        const value = requires.length ? 1 + Math.max(...requires.map(depth)) : 0;
        depths.set(techId, value);
        return value;
    };
    for (const techId of techs) depth(techId);
    return depths;
}

/**
 * Left-to-right tidy tree: one column per prerequisite depth. Each tech hangs off its
 * deepest prerequisite (other prerequisites just get an edge), takes a block of rows as tall
 * as its dependants need and sits centred on them, so chains run straight across. Roots
 * with dependants come first, in tech order.
 */
export function layoutTechTree(techs: readonly TechId[] = TechId.options): TechTreeLayout {
    const depths = techDepths(techs);
    const included = new Set(techs);
    const children = new Map<TechId, TechId[]>(techs.map((t) => [t, []]));
    const roots: TechId[] = [];
    for (const techId of techs) {
        const requires = TECHS[techId].requires.filter((r) => included.has(r));
        const parent = requires.reduce<TechId | undefined>(
            (best, r) => (best === undefined || depths.get(r)! > depths.get(best)! ? r : best),
            undefined
        );
        if (parent) children.get(parent)!.push(techId);
        else roots.push(techId);
    }
    roots.sort((a, b) => Number(children.get(b)!.length > 0) - Number(children.get(a)!.length > 0));

    const rowStep = TECH_NODE_HEIGHT + ROW_GAP;
    const nodes = new Map<TechId, TechNodeLayout>();
    /** Lays out `techId`'s block from `firstRow`; returns how many rows it used. */
    const place = (techId: TechId, firstRow: number): number => {
        let span = 0;
        for (const child of children.get(techId)!) span += place(child, firstRow + span);
        const rows = Math.max(1, span);
        const column = depths.get(techId)!;
        nodes.set(techId, {
            techId,
            column,
            x: PADDING + column * (TECH_NODE_WIDTH + COLUMN_GAP),
            y: PADDING + (firstRow + (rows - 1) / 2) * rowStep
        });
        return rows;
    };
    let row = 0;
    for (const root of roots) row += place(root, row);
    const columns = Math.max(0, ...depths.values()) + 1;

    const edges = techs.flatMap((to) =>
        TECHS[to].requires.filter((from) => nodes.has(from)).map((from) => ({ from, to }))
    );
    const bottom = Math.max(PADDING, ...[...nodes.values()].map((n) => n.y + TECH_NODE_HEIGHT));
    return {
        nodes,
        edges,
        columns,
        width: PADDING * 2 + columns * TECH_NODE_WIDTH + Math.max(0, columns - 1) * COLUMN_GAP,
        height: bottom + PADDING
    };
}

/** `techId` and everything it needs, directly or indirectly. */
export function techWithPrerequisites(techId: TechId): Set<TechId> {
    const result = new Set<TechId>();
    const visit = (t: TechId) => {
        if (result.has(t)) return;
        result.add(t);
        for (const p of TECHS[t].requires) visit(p);
    };
    visit(techId);
    return result;
}

/** Cubic curve from a prerequisite's right edge to a dependant's left edge. */
export function edgePath(from: TechNodeLayout, to: TechNodeLayout): string {
    const x1 = from.x + TECH_NODE_WIDTH;
    const y1 = from.y + TECH_NODE_HEIGHT / 2;
    const x2 = to.x;
    const y2 = to.y + TECH_NODE_HEIGHT / 2;
    const bend = (x2 - x1) / 2;
    return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
}
