import { z } from "zod";
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
            battles: z.array(BattleInfo)
        })
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
            destroyedShipIds: z.array(EntityId)
        })
    })
]);
export type ServerToClientMessage = z.infer<typeof ServerToClientMessage>;
