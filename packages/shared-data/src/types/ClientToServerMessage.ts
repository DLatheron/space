import { z } from "zod";
import { AxialCoord, BattleId, EntityId, SideId } from "./PrimitiveTypes.js";

export const ClientToServerMessage = z.discriminatedUnion("type", [
    z.object({
        type: z.literal("client:ping"),
        payload: z.object({ nonce: z.number() })
    }),
    z.object({
        type: z.literal("client:rename"),
        payload: z.object({ name: z.string().nonempty().max(64) })
    }),
    z.object({
        type: z.literal("client:ship:move"),
        payload: z.object({ shipId: EntityId, to: AxialCoord })
    }),
    z.object({
        type: z.literal("client:turn:end"),
        payload: z.object({})
    }),
    z.object({
        /** Only accepted from the attacker's side. */
        type: z.literal("client:battle:resolve"),
        payload: z.object({ battleId: BattleId, winnerSideId: SideId })
    })
]);
export type ClientToServerMessage = z.infer<typeof ClientToServerMessage>;
