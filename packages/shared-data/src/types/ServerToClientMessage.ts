import { z } from "zod";
import { ClientSummary, GameId } from "./PrimitiveTypes.js";

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
    })
]);
export type ServerToClientMessage = z.infer<typeof ServerToClientMessage>;
