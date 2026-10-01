import { z } from "zod";
import { BuildItem, BuildPriority, QueueDirection } from "./Economy.js";
import { AxialCoord, EntityId, OrderId } from "./PrimitiveTypes.js";

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
        /**
         * Move towards any explored hex: the ship goes as far as its movement allows now and
         * the rest becomes a move order (`ShipEntity.moveOrder`) run at each end of turn.
         */
        type: z.literal("client:ship:move"),
        payload: z.object({ shipId: EntityId, to: AxialCoord })
    }),
    z.object({
        type: z.literal("client:ship:order:cancel"),
        payload: z.object({ shipId: EntityId })
    }),
    z.object({
        /** Engage the hyperdrive to jump to an explored hex at end of turn; clears any move order. */
        type: z.literal("client:ship:hyperjump"),
        payload: z.object({ shipId: EntityId, target: AxialCoord })
    }),
    z.object({
        type: z.literal("client:ship:hyperjump:cancel"),
        payload: z.object({ shipId: EntityId })
    }),
    z.object({
        type: z.literal("client:turn:end"),
        payload: z.object({})
    }),
    z.object({
        /**
         * Board own ships on the carrier's hex into its hangar (see `ShipBalance.hangar`). Each
         * loaded ship spends `HANGAR_LOAD_COST` movement and loses its move order and pending jump.
         */
        type: z.literal("client:ship:load"),
        payload: z.object({ carrierId: EntityId, shipIds: z.array(EntityId).min(1) })
    }),
    z.object({
        /** Launch carried ships onto the carrier's hex; they keep their movement points. */
        type: z.literal("client:ship:unload"),
        payload: z.object({ carrierId: EntityId, shipIds: z.array(EntityId).min(1) })
    }),
    z.object({
        /**
         * Place an order at an owned planet, moon or mineable asteroid. Nothing is paid up
         * front; it is funded over the following turns.
         */
        type: z.literal("client:location:build"),
        payload: z.object({ locationId: EntityId, item: BuildItem, priority: BuildPriority })
    }),
    z.object({
        /** Cancel an order; resources already applied go into the local stockpile. */
        type: z.literal("client:location:cancel"),
        payload: z.object({ locationId: EntityId, orderId: OrderId })
    }),
    z.object({
        type: z.literal("client:order:priority"),
        payload: z.object({ locationId: EntityId, orderId: OrderId, priority: BuildPriority })
    }),
    z.object({
        /** Swap an order with its neighbour in the same build queue (see `moveOrderInQueue`). */
        type: z.literal("client:order:move"),
        payload: z.object({ locationId: EntityId, orderId: OrderId, direction: QueueDirection })
    }),
    z.object({
        /** Consume a colony ship on the location's hex to claim the unowned planet, moon or asteroid. */
        type: z.literal("client:location:colonise"),
        payload: z.object({ locationId: EntityId, shipId: EntityId })
    }),
    z.object({
        /** Board garrisoned units onto a transport on the same hex. */
        type: z.literal("client:unit:load"),
        payload: z.object({ shipId: EntityId, unitIds: z.array(EntityId).min(1) })
    }),
    z.object({
        /** Land carried units into the garrison of an owned location on the transport's hex. */
        type: z.literal("client:unit:unload"),
        payload: z.object({
            shipId: EntityId,
            locationId: EntityId,
            unitIds: z.array(EntityId).min(1)
        })
    }),
    z.object({
        /**
         * Land every unit carried by the transports on an enemy location on their hex. Ground
         * combat resolves at once (see `server:combat`).
         */
        type: z.literal("client:invade"),
        payload: z.object({ locationId: EntityId, shipIds: z.array(EntityId).min(1) })
    })
]);
export type ClientToServerMessage = z.infer<typeof ClientToServerMessage>;
