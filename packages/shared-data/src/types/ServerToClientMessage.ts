import { z } from "zod";
import {
    ClientSummary,
    GameId,
    HexKey,
    SideId,
    TileView
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
            visible: z.array(HexKey)
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
    })
]);
export type ServerToClientMessage = z.infer<typeof ServerToClientMessage>;
