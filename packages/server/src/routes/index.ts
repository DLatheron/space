import { Router, type IRouter } from "express";
import { gameRouter } from "./game/game.router.js";
import { statusRouter } from "./status/status.router.js";

export const apiRouter: IRouter = Router();

apiRouter.use("/status", statusRouter);
apiRouter.use("/game", gameRouter);
