import { GameId } from "@space/shared-data";
import { Logger } from "@space/misc";
import { Game } from "./Game.js";
import { config } from "../config/config.schema.js";

export class GameManager {
    static readonly Logger: Logger = new Logger("GameManager", config.logLevels?.gameManager);

    private readonly _games = new Map<GameId, Game>();

    addGame(game: Game): void {
        this._games.set(game.gameId, game);
    }

    removeGame(gameId: string): boolean {
        return this._games.delete(gameId);
    }

    getGame(gameId: string): Game {
        const game = this.findGame(gameId);
        if (!game) {
            throw new Error(`Game not found: ${gameId}`);
        }
        return game;
    }

    findGame(gameId: string): Game | undefined {
        return this._games.get(gameId);
    }

    killAllGames() {
        for (const game of this._games.values()) {
            game.destroyGame();
        }

        this._games.clear();

        GameManager.Logger.info("All games killed", this._games);
    }

    findOnlyGame(): GameId | undefined {
        return this._games.values().next().value?.gameId;
    }
}

export const gameManager = new GameManager();
