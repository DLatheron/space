import { Router, type IRouter } from "express";
import { createGame } from "./create.handler.js";

export const createGameRouter: IRouter = Router();

createGameRouter.post("/", createGame);
