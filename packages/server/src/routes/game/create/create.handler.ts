import {
    CreateGameRequestBody,
    CreateGameResponseBody,
    ErrorResponseBody
} from "@space/shared-data";
import type { Request, RequestHandler, Response } from "express";
import { Game } from "../../../game/Game.js";
import { gameManager } from "../../../game/GameManager.js";
import { config } from "../../../config/config.schema.js";

export type CreateGameRequest = Request<unknown, CreateGameRequestBody>;
export type CreateGameResponse = Response<CreateGameResponseBody | ErrorResponseBody>;

export const createGame: RequestHandler = async (
    req: CreateGameRequest,
    res: CreateGameResponse
) => {
    const parsedBody = CreateGameRequestBody.safeParse(req.body);
    if (!parsedBody.success) {
        res.status(400).json({ error: `invalid payload: ${parsedBody.error.toString()}` });
        return;
    }
    const { clientId, name } = parsedBody.data;

    if (config.highlanderGameMode) {
        gameManager.killAllGames();
    }

    const game = new Game(clientId);
    const existingGame = gameManager.findGame(game.id);
    if (existingGame) {
        gameManager.removeGame(existingGame.id);
        existingGame.destroyGame();
    }

    gameManager.addGame(game);

    const client = game.addClient(clientId, name);
    if (!client) {
        res.status(501).json({ error: "Failed to add client to created game " });
        return;
    }

    res.json({ gameId: game.gameId });
};
