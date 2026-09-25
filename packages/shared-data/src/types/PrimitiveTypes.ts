import { z } from "zod";

export const ClientId = z.uuid();
export type ClientId = z.infer<typeof ClientId>;

export const GameId = z.string().regex(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
export type GameId = z.infer<typeof GameId>;

export const SideId = z.string().min(1);
export type SideId = z.infer<typeof SideId>;

export const EntityId = z.string().min(1);
export type EntityId = z.infer<typeof EntityId>;

export const ClientSummary = z.object({
    id: ClientId,
    name: z.string()
});
export type ClientSummary = z.infer<typeof ClientSummary>;

export const AxialCoord = z.object({
    q: z.number().int(),
    r: z.number().int()
});
export type AxialCoord = z.infer<typeof AxialCoord>;

export const HexKey = z.string().regex(/^-?\d+,-?\d+$/);
export type HexKey = z.infer<typeof HexKey>;

export const EntityKind = z.enum(["sun", "planet", "asteroid", "ship"]);
export type EntityKind = z.infer<typeof EntityKind>;

export const EntitySummary = z.object({
    id: EntityId,
    kind: EntityKind,
    name: z.string().optional(),
    sideId: SideId.optional(),
    /** Visual variant / size hint for placeholders (0–1). */
    scale: z.number().positive().max(2).optional()
});
export type EntitySummary = z.infer<typeof EntitySummary>;

export const FogState = z.enum(["unexplored", "explored", "visible"]);
export type FogState = z.infer<typeof FogState>;

/** Client-facing view of a single hex (never sent for unexplored). */
export const TileView = z.object({
    q: z.number().int(),
    r: z.number().int(),
    fog: z.enum(["explored", "visible"]),
    entities: z.array(EntitySummary)
});
export type TileView = z.infer<typeof TileView>;
