import {
    DEFAULT_SUPPLY_CAPACITY,
    DEFAULT_SUPPLY_SPEED,
    supplyCapacityFor,
    supplySpeedFor,
    type SideId,
    type TechId
} from "@space/shared-data";

export type ResearchOptions = {
    /** Supply ship speed before techs (hexes per turn). */
    baseSupplySpeed?: number;
    /** Supply ship capacity before techs (units). */
    baseSupplyCapacity?: number;
};

/** Side-wide techs. Research orders themselves are build orders in the EconomyManager. */
export class ResearchManager {
    private readonly _techs = new Map<SideId, TechId[]>();
    private readonly _baseSpeed: number;
    private readonly _baseCapacity: number;

    constructor(options: ResearchOptions = {}) {
        this._baseSpeed = options.baseSupplySpeed ?? DEFAULT_SUPPLY_SPEED;
        this._baseCapacity = options.baseSupplyCapacity ?? DEFAULT_SUPPLY_CAPACITY;
    }

    techs(sideId: SideId): TechId[] {
        return [...(this._techs.get(sideId) ?? [])];
    }

    has(sideId: SideId, techId: TechId): boolean {
        return this._techs.get(sideId)?.includes(techId) ?? false;
    }

    /** Returns false if the side already knew the tech. */
    add(sideId: SideId, techId: TechId): boolean {
        const techs = this._techs.get(sideId) ?? [];
        if (techs.includes(techId)) return false;
        techs.push(techId);
        this._techs.set(sideId, techs);
        return true;
    }

    supplySpeed(sideId: SideId): number {
        return supplySpeedFor(this.techs(sideId), this._baseSpeed);
    }

    supplyCapacity(sideId: SideId): number {
        return supplyCapacityFor(this.techs(sideId), this._baseCapacity);
    }
}
