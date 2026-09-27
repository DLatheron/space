import type { EntityId, EntityKind, EntityOfKind, EntitySummary } from "@space/shared-data";

/** Server-side ground-truth entity. Same shape as the wire summary for now. */
export type Entity = EntitySummary;
export type EntityOf<K extends EntityKind> = EntityOfKind<K>;

export type MapTile = {
    col: number;
    row: number;
    q: number;
    r: number;
    /** Stack of entity ids on this hex; ground truth lives in the EntityManager. */
    entityIds: EntityId[];
};

/** Snapshot an entity for the wire / side memory (detached from the live object). */
export function entityToSummary(entity: Entity): EntitySummary {
    return { ...entity };
}
