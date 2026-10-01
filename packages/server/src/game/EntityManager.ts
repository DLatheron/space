import type { AxialCoord, EntityId, EntityKind } from "@space/shared-data";
import { findTileByAxial, type SpaceMap } from "./map/SpaceMap.js";
import type { Entity, EntityOf, MapTile } from "./map/types.js";

/**
 * Id-indexed registry of every entity in a game. Keeps each tile's `entityIds`
 * stack in sync with entity positions. Stowed entities (ships aboard a carrier) keep a
 * position but are left off their tile's stack, so they never count as occupying a hex.
 */
export class EntityManager {
    readonly map: SpaceMap;
    private readonly _entities = new Map<EntityId, Entity>();
    private readonly _stowed = new Set<EntityId>();

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
        this._stowed.delete(id);
        return entity;
    }

    /**
     * Relocate an entity to `to`, taking any ships aboard it along. Returns false if the
     * entity or destination is missing.
     */
    move(id: EntityId, to: AxialCoord): boolean {
        const entity = this._entities.get(id);
        const target = findTileByAxial(this.map, to.q, to.r);
        if (!entity || !target) return false;

        if (!this._stowed.has(id)) {
            const source = this.tileOf(entity);
            if (source) {
                source.entityIds = source.entityIds.filter((entityId) => entityId !== id);
            }
            target.entityIds.push(id);
        }
        entity.q = target.q;
        entity.r = target.r;
        if (entity.kind === "ship") {
            for (const passengerId of entity.carriedShipIds ?? []) this.move(passengerId, to);
        }
        return true;
    }

    /** Take an entity off its tile's stack, keeping it registered at the same position. */
    stow(id: EntityId): void {
        const entity = this._entities.get(id);
        if (!entity || this._stowed.has(id)) return;
        const tile = this.tileOf(entity);
        if (tile) tile.entityIds = tile.entityIds.filter((entityId) => entityId !== id);
        this._stowed.add(id);
    }

    /** Put a stowed entity back on its tile's stack. */
    unstow(id: EntityId): void {
        const entity = this._entities.get(id);
        if (!entity || !this._stowed.delete(id)) return;
        this.tileOf(entity)?.entityIds.push(id);
    }

    isStowed(id: EntityId): boolean {
        return this._stowed.has(id);
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
