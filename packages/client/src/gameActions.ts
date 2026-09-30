import type {
    BattleId,
    BuildItem,
    BuildPriority,
    EntityId,
    OrderId,
    SideId
} from "@space/shared-data";

/** Intents the game UI sends to the server; built once in `App`. */
export type GameActions = {
    build: (locationId: EntityId, item: BuildItem, priority: BuildPriority) => void;
    cancel: (locationId: EntityId, orderId: OrderId) => void;
    setPriority: (locationId: EntityId, orderId: OrderId, priority: BuildPriority) => void;
    colonise: (locationId: EntityId, shipId: EntityId) => void;
    load: (shipId: EntityId, unitIds: EntityId[]) => void;
    unload: (shipId: EntityId, locationId: EntityId, unitIds: EntityId[]) => void;
    invade: (locationId: EntityId, shipIds: EntityId[]) => void;
    resolveBattle: (battleId: BattleId, winnerSideId: SideId) => void;
    resolveGroundBattle: (battleId: BattleId, winnerSideId: SideId) => void;
};
