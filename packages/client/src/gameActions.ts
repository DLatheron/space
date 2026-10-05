import type {
    AxialCoord,
    BuildItem,
    BuildPriority,
    EntityId,
    OrderId,
    QueueDirection,
    SpaceStructureType
} from "@space/shared-data";

/** Intents the game UI sends to the server; built once in `App`. */
export type GameActions = {
    build: (locationId: EntityId, item: BuildItem, priority: BuildPriority) => void;
    cancel: (locationId: EntityId, orderId: OrderId) => void;
    setPriority: (locationId: EntityId, orderId: OrderId, priority: BuildPriority) => void;
    /** Funding priority of a Shield Generator's upkeep. */
    setShieldPriority: (locationId: EntityId, priority: BuildPriority) => void;
    moveOrder: (locationId: EntityId, orderId: OrderId, direction: QueueDirection) => void;
    colonise: (locationId: EntityId, shipId: EntityId) => void;
    load: (shipId: EntityId, unitIds: EntityId[]) => void;
    unload: (shipId: EntityId, locationId: EntityId, unitIds: EntityId[]) => void;
    invade: (locationId: EntityId, shipIds: EntityId[]) => void;
    bombard: (locationId: EntityId, shipIds: EntityId[]) => void;
    cancelMoveOrder: (shipId: EntityId) => void;
    hyperjump: (shipId: EntityId, target: AxialCoord) => void;
    cancelHyperjump: (shipId: EntityId) => void;
    /** Board own ships on the carrier's hex into its hangar. */
    loadShips: (carrierId: EntityId, shipIds: EntityId[]) => void;
    /** Launch carried ships onto the carrier's hex. */
    unloadShips: (carrierId: EntityId, shipIds: EntityId[]) => void;
    /** Start a space structure construction site on the Builder's hex. */
    construct: (shipId: EntityId, structureType: SpaceStructureType) => void;
    /** Travel from the friendly Stargate on the ship's hex to `gateId`. */
    enterStargate: (shipId: EntityId, gateId: EntityId) => void;
};
