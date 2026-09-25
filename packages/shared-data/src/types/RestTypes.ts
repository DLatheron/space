import { z } from "zod";
import { URLSearchParams } from "url";

import { ClientId, GameId } from "./PrimitiveTypes.js";

export function parseURLSearchParams<T extends z.ZodTypeAny>(
    schema: T,
    params: URLSearchParams
): z.infer<T> {
    const data: Record<string, string[] | string | undefined> = {};

    for (const key of params.keys()) {
        const value = params.getAll(key).filter((v) => v !== String(undefined));
        if (value.length > 1) {
            data[key] = value;
        } else {
            data[key] = value.at(0);
        }
    }

    const parsed = schema.safeParse(data);

    if (parsed.success) {
        return parsed.data as z.infer<T>;
    } else {
        throw new Error("Invalid query parameters");
    }
}

export const CreateOrJoin = z.union([z.literal("create"), z.literal("join")]);
export type CreateOrJoin = z.infer<typeof CreateOrJoin>;

export const ErrorResponseBody = z.object({
    error: z.string().nonempty()
});
export type ErrorResponseBody = z.infer<typeof ErrorResponseBody>;

export const StatusResponseBody = z.object({
    status: z.literal("ok"),
    message: z.string()
});
export type StatusResponseBody = z.infer<typeof StatusResponseBody>;

export const ClientQueryParams = z.object({
    "client-id": ClientId.optional(),
    "game-id": GameId.optional(),
    mode: CreateOrJoin.optional(),
    name: z.string().optional()
});
export type ClientQueryParams = z.infer<typeof ClientQueryParams>;

export const CreateGameRequestBody = z.object({
    clientId: ClientId,
    name: z.string().nonempty().max(64).default("Default Client Name")
});
export type CreateGameRequestBody = z.infer<typeof CreateGameRequestBody>;

export const CreateGameResponseBody = z.object({
    gameId: GameId
});
export type CreateGameResponseBody = z.infer<typeof CreateGameResponseBody>;

export const JoinGameRequestBody = z.object({
    gameId: GameId,
    clientId: ClientId,
    name: z.string().nonempty().max(64).default("Default Client Name")
});
export type JoinGameRequestBody = z.infer<typeof JoinGameRequestBody>;

export const JoinGameResponseBody = z.object({
    gameId: GameId
});
export type JoinGameResponseBody = z.infer<typeof JoinGameResponseBody>;

export const ConnectSocketQueryParams = z.object({
    clientId: ClientId,
    gameId: GameId
});
export type ConnectSocketQueryParams = z.infer<typeof ConnectSocketQueryParams>;
