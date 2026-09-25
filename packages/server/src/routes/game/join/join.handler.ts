import { ErrorResponseBody, JoinGameRequestBody, JoinGameResponseBody } from "@space/shared-data";
import type { Request, RequestHandler, Response } from "express";
import { gameManager } from "../../../game/GameManager.js";
import { config } from "../../../config/config.schema.js";

export type JoinGameRequest = Request<unknown, JoinGameRequestBody>;
export type JoinGameResponse = Response<JoinGameResponseBody | ErrorResponseBody>;

export const joinGame: RequestHandler = (req: JoinGameRequest, res: JoinGameResponse) => {
    const parsedBody = JoinGameRequestBody.safeParse(req.body);
    if (!parsedBody.success) {
        res.status(400).json({ error: `invalid payload: ${parsedBody.error.toString()}` });
        return;
    }
    const { clientId, name } = parsedBody.data;
    let { gameId } = parsedBody.data;

    if (config.highlanderGameMode) {
        const onlyGameId = gameManager.findOnlyGame();
        if (!onlyGameId) {
            res.status(500).json({ error: "Unable to find the one and only game" });
            return;
        }
        gameId = onlyGameId;
    }

    const game = gameManager.findGame(gameId);
    if (!game) {
        res.status(404).json({ error: `game ${gameId} not found` });
        return;
    }

    const client = game.addClient(clientId, name);
    if (!client) {
        res.status(500).json({ error: "Failed to add client to created game" });
        return;
    }

    res.json({ gameId: game.gameId });
};
