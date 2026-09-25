import { Router, type IRouter } from "express";
import { joinGame } from "./join.handler.js";

export const joinGameRouter: IRouter = Router();

joinGameRouter.post("/", joinGame);
