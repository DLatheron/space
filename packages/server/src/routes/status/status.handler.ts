import { StatusResponseBody } from "@space/shared-data";
import type { RequestHandler } from "express";

export const getStatus: RequestHandler = (_req, res) => {
    const payload = StatusResponseBody.parse({
        status: "ok",
        message: "Server is running!"
    });

    res.json(payload);
};
