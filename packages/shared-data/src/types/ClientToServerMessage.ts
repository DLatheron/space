import { z } from "zod";
import { BuildItem } from "./Economy.js";
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
    }),
    z.object({
        /** Queue an item on an owned planet; the full cost is paid immediately. */
        type: z.literal("client:planet:build"),
        payload: z.object({ planetId: EntityId, item: BuildItem })
    }),
    z.object({
        /** Remove a queue entry by index; refunded in full. */
        type: z.literal("client:planet:cancel"),
        payload: z.object({ planetId: EntityId, index: z.number().int().min(0) })
    }),
    z.object({
        /** Consume a colony ship on the planet's hex to claim the unowned planet. */
        type: z.literal("client:planet:colonise"),
        payload: z.object({ planetId: EntityId, shipId: EntityId })
    })
]);
export type ClientToServerMessage = z.infer<typeof ClientToServerMessage>;
