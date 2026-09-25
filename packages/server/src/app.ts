import express, { type Application } from "express";
import { join } from "node:path";
import { apiRouter } from "./routes/index.js";

const publicDir = join(import.meta.dirname, "../public");

export async function createApp(): Promise<Application> {
    const app = express();
    app.use(express.json());
    app.use("/api", apiRouter);
    app.use("/public", express.static(publicDir));
    return app;
}
