import {
    installationRepairPerTurn,
    platformStats,
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
    /** Entity id for ships and supply ships, installation id for Orbital Platforms. */
    id: EntityId;
    kind: "ship" | "supply_ship" | "installation";
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
 * damaged ship, supply ship and Orbital Platform with no combat during the turn that is ending
 * regains `shipRepairPerTurn` (platforms `installationRepairPerTurn`) hp. Ships that don't
 * repair in space only do so aboard a carrier or at an owned shipyard. Hyperspace hazard and
 * collision damage doesn't stop repairs.
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
        events.push(...this._repairPlatforms(endingTurn));
        return events;
    }

    private _repairPlatforms(endingTurn: number): RepairEvent[] {
        const events: RepairEvent[] = [];
        if (!this._economy) return events;
        for (const sideId of this._economy.sideIds) {
            for (const location of this._economy.ownedLocations(sideId)) {
                for (const installation of this._economy.installationsAt(location.id)) {
                    if (installation.type !== "orbital_platform") continue;
                    if (installation.hp === undefined) continue;
                    if (!repairsAtEndOf(installation.lastCombatTurn, endingTurn)) continue;
                    const maxHp = platformStats(installation.tier, this._balance).hp;
                    const hpBefore = installation.hp;
                    const amount = installationRepairPerTurn(this._balance, hpBefore, maxHp);
                    if (amount <= 0) continue;
                    const hpAfter = hpBefore + amount;
                    if (hpAfter >= maxHp) delete installation.hp;
                    else installation.hp = hpAfter;
                    events.push({
                        id: installation.id,
                        kind: "installation",
                        sideId,
                        hpBefore,
                        hpAfter
                    });
                }
            }
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
        if (vessel.kind !== "ship") return { atOwnedShipyard };
        return {
            atOwnedShipyard,
            carried: !!vessel.carriedBy,
            needsDock: !this._balance.ships[vessel.shipType].repairsInSpace
        };
    }
}
