import { z } from "zod";
import { EconomyState } from "./Economy.js";
import { GroundBattleInfo } from "./GroundUnitTypes.js";
import {
    AxialCoord,
    BattleId,
    BattleInfo,
    ClientSummary,
    EntityId,
    GameId,
    HexDirection,
    HexKey,
    SideId,
    SupplyShipEntity,
    TileView,
    TurnState
} from "./PrimitiveTypes.js";

export const ServerToClientMessage = z.discriminatedUnion("type", [
    z.object({
        type: z.literal("server:hello"),
        payload: z.object({ gameId: GameId })
    }),
    z.object({
        type: z.literal("server:pong"),
        payload: z.object({ nonce: z.number() })
    }),
    z.object({
        type: z.literal("server:client:connected"),
        payload: z.object({ client: ClientSummary })
    }),
    z.object({
        type: z.literal("server:client:disconnected"),
        payload: z.object({ client: ClientSummary })
    }),
    z.object({
        type: z.literal("server:error"),
        payload: z.object({ message: z.string() })
    }),
    z.object({
        type: z.literal("server:map:init"),
        payload: z.object({
            width: z.number().int().positive(),
            height: z.number().int().positive(),
            /** Center-to-vertex size; point-to-point = 2 * hexSize. */
            hexSize: z.number().positive(),
            sideId: SideId,
            tiles: z.array(TileView),
            visible: z.array(HexKey),
            turn: TurnState,
            /** Pending battles involving the receiving side. */
            battles: z.array(BattleInfo),
            /** Pending ground battles involving the receiving side. */
            groundBattles: z.array(GroundBattleInfo),
            economy: EconomyState
        })
    }),
    z.object({
        /** Sent only to the owning side. */
        type: z.literal("server:economy:state"),
        payload: EconomyState
    }),
    z.object({
        type: z.literal("server:turn:state"),
        payload: TurnState.extend({ yourSideId: SideId })
    }),
    z.object({
        type: z.literal("server:ship:moved"),
        payload: z.object({
            shipId: EntityId,
            from: AxialCoord,
            /** Final hex reached; may fall short of the requested target when MP ran out. */
            to: AxialCoord,
            /** Hexes stepped into, in order, ending at `to` (excludes `from`). */
            path: z.array(AxialCoord).min(1),
            /** Direction of the last step taken. */
            facing: HexDirection,
            movementPoints: z.number().int().min(0)
        })
    }),
    z.object({
        type: z.literal("server:tiles:update"),
        payload: z.object({
            tiles: z.array(TileView),
            visible: z.array(HexKey),
            /** Entity ids that should be scrubbed from any remembered tile. */
            forgetEntityIds: z.array(z.string()).optional()
        })
    }),
    z.object({
        /** Sent to both combatant sides. */
        type: z.literal("server:battle:start"),
        payload: BattleInfo.extend({ youAreAttacker: z.boolean() })
    }),
    z.object({
        /** Sent to every side that could see the hex, plus both combatants. */
        type: z.literal("server:battle:resolved"),
        payload: z.object({
            battleId: BattleId,
            q: z.number().int(),
            r: z.number().int(),
            winnerSideId: SideId,
            loserSideId: SideId,
            /** May include supply ships (cargo lost) and transports. */
            destroyedShipIds: z.array(EntityId),
            /** Ground units lost aboard destroyed transports. */
            destroyedUnitIds: z.array(EntityId)
        })
    }),
    z.object({
        /** Same visibility rules as `server:ship:moved`. */
        type: z.literal("server:supply:moved"),
        payload: z.object({
            supplyShipId: EntityId,
            from: AxialCoord,
            to: AxialCoord,
            /** Hexes stepped into, in order, ending at `to` (excludes `from`). */
            path: z.array(AxialCoord).min(1),
            facing: HexDirection,
            /**
             * The ship as the recipient may see it, present when it was launched this turn
             * so clients that have never seen it can fly it out from `from`.
             */
            supplyShip: SupplyShipEntity.optional()
        })
    }),
    z.object({
        /** Sent to both combatant sides. */
        type: z.literal("server:ground:start"),
        payload: GroundBattleInfo.extend({ youAreAttacker: z.boolean() })
    }),
    z.object({
        /** Sent to every side that could see the location, plus both combatants. */
        type: z.literal("server:ground:resolved"),
        payload: z.object({
            battleId: BattleId,
            locationId: EntityId,
            q: z.number().int(),
            r: z.number().int(),
            winnerSideId: SideId,
            loserSideId: SideId,
            destroyedUnitIds: z.array(EntityId),
            /** The attacker won and now owns the location. */
            captured: z.boolean()
        })
    })
]);
export type ServerToClientMessage = z.infer<typeof ServerToClientMessage>;
