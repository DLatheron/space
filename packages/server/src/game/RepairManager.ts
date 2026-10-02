import {
    REPAIR_YARD_STRUCTURES,
    repairsAtEndOf,
    shipRepairPerTurn,
    shipStats,
    supplyShipStats,
    type EconomyBalance,
    type EntityId,
    type RepairContext,
    type SideId,
    type StructureType,
    type TechId
} from "@space/shared-data";
import { defaultEconomyBalance } from "../config/config.schema.js";
import type { EconomyManager } from "./EconomyManager.js";
import type { EntityManager } from "./EntityManager.js";
import { isLocationEntity } from "./GroundUnits.js";
import type { EntityOf } from "./map/types.js";

export type RepairEvent = {
    id: EntityId;
    kind: "ship" | "supply_ship";
    sideId: SideId;
    hpBefore: number;
    hpAfter: number;
};

export type RepairOptions = {
    /** Defaults to the economy's balance, else the config defaults. */
    balance?: EconomyBalance;
};

const YARDS: readonly StructureType[] = REPAIR_YARD_STRUCTURES;

/**
 * Out-of-combat repair, run once every end of turn after anything that can fight: each
 * damaged ship and supply ship with no combat during the turn that is ending regains
 * `shipRepairPerTurn` hp. Hyperspace hazard and collision damage doesn't stop repairs.
 */
export class RepairManager {
    private readonly _entities: EntityManager;
    private readonly _economy: EconomyManager | undefined;
    private readonly _balance: EconomyBalance;

    constructor(entities: EntityManager, economy?: EconomyManager, options: RepairOptions = {}) {
        this._entities = entities;
        this._economy = economy;
        this._balance = options.balance ?? economy?.balance ?? defaultEconomyBalance();
    }

    repair(endingTurn: number): RepairEvent[] {
        const events: RepairEvent[] = [];
        const vessels = [...this._entities.ofKind("ship"), ...this._entities.ofKind("supply_ship")];
        for (const vessel of vessels) {
            if (vessel.hp === undefined) continue;
            if (!repairsAtEndOf(vessel.lastCombatTurn, endingTurn)) continue;
            const techs = this._techs(vessel.sideId);
            const maxHp = this._maxHp(vessel, techs);
            const amount = shipRepairPerTurn(
                this._balance,
                vessel.hp,
                maxHp,
                techs,
                this._context(vessel)
            );
            if (amount <= 0) continue;
            const hpBefore = vessel.hp;
            const hpAfter = hpBefore + amount;
            if (hpAfter >= maxHp) delete vessel.hp;
            else vessel.hp = hpAfter;
            events.push({
                id: vessel.id,
                kind: vessel.kind,
                sideId: vessel.sideId,
                hpBefore,
                hpAfter
            });
        }
        return events;
    }

    private _techs(sideId: SideId): TechId[] {
        return this._economy?.research.techs(sideId) ?? [];
    }

    private _maxHp(
        vessel: EntityOf<"ship"> | EntityOf<"supply_ship">,
        techs: readonly TechId[]
    ): number {
        return vessel.kind === "ship"
            ? shipStats(vessel.shipType, vessel.tier ?? 1, this._balance).hp
            : supplyShipStats(this._balance, techs).hp;
    }

    private _context(vessel: EntityOf<"ship"> | EntityOf<"supply_ship">): RepairContext {
        const atOwnedShipyard = this._entities
            .entitiesAt(vessel.q, vessel.r)
            .some(
                (entity) =>
                    isLocationEntity(entity) &&
                    entity.sideId === vessel.sideId &&
                    !!this._economy
                        ?.locationEconomy(entity.id)
                        ?.installations.some((i) => YARDS.includes(i.type))
            );
        return { atOwnedShipyard, carried: vessel.kind === "ship" && !!vessel.carriedBy };
    }
}
