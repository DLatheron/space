import { z } from "zod";

export const ClientId = z.uuid();
export type ClientId = z.infer<typeof ClientId>;

export const GameId = z.string().regex(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
export type GameId = z.infer<typeof GameId>;

export const ClientSummary = z.object({
    id: ClientId,
    name: z.string()
});
export type ClientSummary = z.infer<typeof ClientSummary>;
