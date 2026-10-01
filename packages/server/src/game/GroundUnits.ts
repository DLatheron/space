import type {
    EntityId,
    GroundUnit,
    GroundUnitLocation,
    GroundUnitType,
    LocationEntity,
    SideId
} from "@space/shared-data";
import type { EntityManager } from "./EntityManager.js";
import type { EntityOf } from "./map/types.js";

export function isLocationEntity(entity: { kind: string } | undefined): entity is LocationEntity {
    return (
        entity?.kind === "planet" || entity?.kind === "moon" || entity?.kind === "large_asteroid"
    );
}

/**
 * Every ground unit in the game. Keeps each location's `garrison` and each transport's
 * `carriedUnitIds` in sync with the units' `location`.
 */
export class GroundUnitRegistry {
    private readonly _entities: EntityManager;
    private readonly _units = new Map<EntityId, GroundUnit>();
    private _nextSeq = 1;

    constructor(entities: EntityManager) {
        this._entities = entities;
    }

    get(unitId: EntityId): GroundUnit | undefined {
        return this._units.get(unitId);
    }

    all(): GroundUnit[] {
        return [...this._units.values()];
    }

    ofSide(sideId: SideId): GroundUnit[] {
        return this.all().filter((unit) => unit.sideId === sideId);
    }

    /** Units listed in a location's garrison. */
    garrisonOf(locationId: EntityId): GroundUnit[] {
        const location = this._entities.get(locationId);
        if (!isLocationEntity(location)) return [];
        return (location.garrison ?? []).flatMap((id) => this._units.get(id) ?? []);
    }

    create(
        sideId: SideId,
        unitType: GroundUnitType,
        locationId: EntityId,
        populationFrom: EntityId
    ): GroundUnit {
        let id: EntityId;
        do {
            id = `unit-${this._nextSeq++}`;
        } while (this._units.has(id) || this._entities.get(id));
        const unit: GroundUnit = {
            id,
            sideId,
            unitType,
            tier: 1,
            populationFrom,
            location: { kind: "garrison", locationId }
        };
        this._units.set(id, unit);
        this._list(unit.location, id);
        return unit;
    }

    /** Detach a unit from wherever it is listed and place it at `to`. */
    relocate(unitId: EntityId, to: GroundUnitLocation, options: { listed?: boolean } = {}) {
        const unit = this._units.get(unitId);
        if (!unit) return;
        this._unlist(unit.location, unitId);
        unit.location = to;
        if (options.listed ?? true) this._list(to, unitId);
    }

    remove(unitId: EntityId): GroundUnit | undefined {
        const unit = this._units.get(unitId);
        if (!unit) return undefined;
        this._unlist(unit.location, unitId);
        this._units.delete(unitId);
        return unit;
    }

    private _list(at: GroundUnitLocation, unitId: EntityId) {
        if (at.kind === "garrison") {
            const location = this._entities.get(at.locationId);
            if (isLocationEntity(location)) {
                location.garrison = [...(location.garrison ?? []), unitId];
            }
        } else {
            const ship = this._entities.getOfKind(at.shipId, "ship");
            if (ship) ship.carriedUnitIds = [...(ship.carriedUnitIds ?? []), unitId];
        }
    }

    private _unlist(at: GroundUnitLocation, unitId: EntityId) {
        const holder: LocationEntity | EntityOf<"ship"> | undefined =
            at.kind === "garrison"
                ? (this._entities.get(at.locationId) as LocationEntity | undefined)
                : this._entities.getOfKind(at.shipId, "ship");
        if (!holder) return;
        if (holder.kind === "ship") {
            const rest = (holder.carriedUnitIds ?? []).filter((id) => id !== unitId);
            holder.carriedUnitIds = rest;
        } else if (isLocationEntity(holder)) {
            const rest = (holder.garrison ?? []).filter((id) => id !== unitId);
            if (rest.length > 0) holder.garrison = rest;
            else delete holder.garrison;
        }
    }
}
