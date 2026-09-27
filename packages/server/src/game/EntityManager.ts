import type { AxialCoord, EntityId, EntityKind } from "@space/shared-data";
import { findTileByAxial, type SpaceMap } from "./map/SpaceMap.js";
import type { Entity, EntityOf, MapTile } from "./map/types.js";

/**
 * Id-indexed registry of every entity in a game. Keeps each tile's `entityIds`
 * stack in sync with entity positions.
 */
export class EntityManager {
    readonly map: SpaceMap;
    private readonly _entities = new Map<EntityId, Entity>();

    constructor(map: SpaceMap) {
        this.map = map;
    }

    get size(): number {
        return this._entities.size;
    }

    get(id: EntityId): Entity | undefined {
        return this._entities.get(id);
    }

    getOfKind<K extends EntityKind>(id: EntityId, kind: K): EntityOf<K> | undefined {
        const entity = this._entities.get(id);
        return entity?.kind === kind ? (entity as EntityOf<K>) : undefined;
    }

    all(): IterableIterator<Entity> {
        return this._entities.values();
    }

    ofKind<K extends EntityKind>(kind: K): EntityOf<K>[] {
        const result: EntityOf<K>[] = [];
        for (const entity of this._entities.values()) {
            if (entity.kind === kind) result.push(entity as EntityOf<K>);
        }
        return result;
    }

    tileOf(entity: Pick<Entity, "q" | "r">): MapTile | undefined {
        return findTileByAxial(this.map, entity.q, entity.r);
    }

    entitiesAt(q: number, r: number): Entity[] {
        const tile = findTileByAxial(this.map, q, r);
        if (!tile) return [];
        return tile.entityIds.map((id) => this._entities.get(id)!);
    }

    /** Register an entity and place it on the tile at its `q,r`. */
    add<E extends Entity>(entity: E): E {
        if (this._entities.has(entity.id)) {
            throw new Error(`Duplicate entity id ${entity.id}`);
        }
        const tile = this.tileOf(entity);
        if (!tile) {
            throw new Error(`Entity ${entity.id} placed off-map at ${entity.q},${entity.r}`);
        }
        this._entities.set(entity.id, entity);
        tile.entityIds.push(entity.id);
        return entity;
    }

    remove(id: EntityId): Entity | undefined {
        const entity = this._entities.get(id);
        if (!entity) return undefined;
        const tile = this.tileOf(entity);
        if (tile) {
            tile.entityIds = tile.entityIds.filter((entityId) => entityId !== id);
        }
        this._entities.delete(id);
        return entity;
    }

    /** Relocate an entity to `to`. Returns false if the entity or destination is missing. */
    move(id: EntityId, to: AxialCoord): boolean {
        const entity = this._entities.get(id);
        const target = findTileByAxial(this.map, to.q, to.r);
        if (!entity || !target) return false;

        const source = this.tileOf(entity);
        if (source) {
            source.entityIds = source.entityIds.filter((entityId) => entityId !== id);
        }
        entity.q = target.q;
        entity.r = target.r;
        target.entityIds.push(id);
        return true;
    }

    /**
     * Whether `entity` may end a move on `tile`. Hazards (suns, belts, black holes,
     * wormholes) are enterable with no effect yet; tunnels are not traversable
     * but their hex can still be occupied.
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub until hazard rules land.
    canEnter(_entity: Entity, _tile: MapTile): boolean {
        return true;
    }
}
