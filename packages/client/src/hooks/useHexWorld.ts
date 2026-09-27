import { useSyncExternalStore } from "react";
import { HexWorld } from "../world/HexWorld.js";

/** Re-render when the world's selection, turn, or tile state changes; returns the version. */
export function useHexWorldVersion(world: HexWorld): number {
    return useSyncExternalStore(world.subscribe, world.getVersion);
}
