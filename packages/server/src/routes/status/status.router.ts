import { Router, type IRouter } from "express";
import { getStatus } from "./status.handler.js";

export const statusRouter: IRouter = Router();

statusRouter.get("/", getStatus);
