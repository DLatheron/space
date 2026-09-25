import type { EntityId, EntityKind, EntitySummary, SideId } from "@space/shared-data";

export type MapEntity = EntitySummary & {
    id: EntityId;
    kind: EntityKind;
};

export type MapTile = {
    col: number;
    row: number;
    q: number;
    r: number;
    entities: MapEntity[];
};

export function entityToSummary(entity: MapEntity): EntitySummary {
    return {
        id: entity.id,
        kind: entity.kind,
        name: entity.name,
        sideId: entity.sideId as SideId | undefined,
        scale: entity.scale
    };
}
