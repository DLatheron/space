import { z } from "zod";
import { CombatResult } from "./Combat.js";
import { EconomyBalance, EconomyState } from "./Economy.js";
import { HyperjumpOutcome } from "./Hyperspace.js";
import {
    AxialCoord,
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
            economy: EconomyState,
            /** Server-configured caps, storage structures and concurrency limits. */
            balance: EconomyBalance
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
        /**
         * A hyperspace jump resolved at end of turn; sent before the tiles update to the owner,
         * sides that could see `from` or `to`, and sides that lost ships.
         */
        type: z.literal("server:ship:jumped"),
        payload: z.object({
            shipId: EntityId,
            from: AxialCoord,
            /** Landing hex after scatter. */
            to: AxialCoord,
            /** `damaged`: survived a hazard with hp lost; `destroyed`: the jumper was lost. */
            outcome: HyperjumpOutcome,
            /** Ship it collided with on landing, if any. */
            collidedWithId: EntityId.optional(),
            /**
             * Every ship destroyed by hazards or collision (the jumper and/or the ship hit, plus
             * ships aboard them). Combat on landing is reported separately by `server:combat`.
             */
            destroyedIds: z.array(EntityId),
            /** The survivor didn't clear the enemies at `to` and was moved here instead. */
            displacedTo: AxialCoord.optional()
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
        /**
         * An automatic space or ground combat was fought. Sent before the tiles update to sides
         * that could see `hex` or `from` and to the owners of every participant.
         */
        type: z.literal("server:combat"),
        payload: CombatResult
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
    })
]);
export type ServerToClientMessage = z.infer<typeof ServerToClientMessage>;
