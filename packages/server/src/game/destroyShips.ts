import type { EntityId } from "@space/shared-data";
import type { EconomyManager } from "./EconomyManager.js";
import type { EntityManager } from "./EntityManager.js";
import type { EntityOf } from "./map/types.js";

export type Vessel = EntityOf<"ship"> | EntityOf<"supply_ship">;

export type DestroyedVessels = {
    /** Ships and supply ships removed. */
    destroyedShipIds: EntityId[];
    /** Ground units lost aboard destroyed transports. */
    destroyedUnitIds: EntityId[];
};

/**
 * Removes ships and supply ships however they were lost (battles, hyperspace). Upgrades are
 * cancelled, crews are released to go home, units aboard transports are destroyed and supply
 * ship cargo is lost with the ship.
 */
export function destroyVessels(
    entities: EntityManager,
    economy: EconomyManager | undefined,
    vessels: readonly Vessel[]
): DestroyedVessels {
    const ships = vessels.filter((v): v is EntityOf<"ship"> => v.kind === "ship");
    const destroyedUnitIds = economy?.onShipsDestroyed(ships) ?? [];
    const destroyedShipIds = vessels.map((v) => v.id);
    for (const id of destroyedShipIds) entities.remove(id);
    return { destroyedShipIds, destroyedUnitIds };
}
