import type { EntityId } from "@space/shared-data";
import type { EconomyManager } from "./EconomyManager.js";
import type { EntityManager } from "./EntityManager.js";
import type { EntityOf } from "./map/types.js";

export type Vessel = EntityOf<"ship"> | EntityOf<"supply_ship">;

export type DestroyedVessels = {
    /** Ships and supply ships removed, including ships aboard destroyed carriers. */
    destroyedShipIds: EntityId[];
    /** Ground units lost aboard destroyed transports. */
    destroyedUnitIds: EntityId[];
};

/** `vessels` plus every ship carried aboard them (recursively), each once. */
export function withCarriedShips(entities: EntityManager, vessels: readonly Vessel[]): Vessel[] {
    const result: Vessel[] = [];
    const seen = new Set<EntityId>();
    const visit = (vessel: Vessel) => {
        if (seen.has(vessel.id)) return;
        seen.add(vessel.id);
        result.push(vessel);
        if (vessel.kind !== "ship") return;
        for (const id of vessel.carriedShipIds ?? []) {
            const carried = entities.getOfKind(id, "ship");
            if (carried) visit(carried);
        }
    };
    for (const vessel of vessels) visit(vessel);
    return result;
}

/**
 * Removes ships and supply ships however they were lost (combat, hyperspace). Ships aboard a
 * destroyed carrier are lost with it. Upgrades are cancelled, crews are released to go home,
 * units aboard transports are destroyed and supply ship cargo is lost with the ship.
 */
export function destroyVessels(
    entities: EntityManager,
    economy: EconomyManager | undefined,
    vessels: readonly Vessel[]
): DestroyedVessels {
    const all = withCarriedShips(entities, vessels);
    const ships = all.filter((v): v is EntityOf<"ship"> => v.kind === "ship");
    const destroyedUnitIds = economy?.onShipsDestroyed(ships) ?? [];
    const destroyedShipIds = all.map((v) => v.id);
    for (const ship of ships) {
        const carrier = ship.carriedBy ? entities.getOfKind(ship.carriedBy, "ship") : undefined;
        if (carrier?.carriedShipIds) {
            const rest = carrier.carriedShipIds.filter((id) => id !== ship.id);
            if (rest.length > 0) carrier.carriedShipIds = rest;
            else delete carrier.carriedShipIds;
        }
    }
    for (const id of destroyedShipIds) entities.remove(id);
    return { destroyedShipIds, destroyedUnitIds };
}

/**
 * Remove destroyed space structures and close their economy entries (orders and stockpile
 * are lost; supply ships heading there are redirected).
 */
export function destroySpaceStructures(
    entities: EntityManager,
    economy: EconomyManager | undefined,
    ids: readonly EntityId[]
): void {
    for (const id of ids) {
        economy?.removeSite(id);
        entities.remove(id);
    }
}
