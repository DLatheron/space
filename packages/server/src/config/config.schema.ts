import { LogLevel } from "@space/misc";
import { readFileSync } from "fs";
import z from "zod";

const Config = z
    .object({
        port: z.int().min(1024).max(65534).optional().default(3000),
        highlanderGameMode: z.boolean().optional().default(true),
        logLevels: z
            .object({
                gameManager: LogLevel.optional(),
                game: LogLevel.optional(),
                server: LogLevel.optional()
            })
            .optional()
            .default({
                gameManager: LogLevel.enum.info,
                game: LogLevel.enum.info,
                server: LogLevel.enum.info
            })
    })
    .strict();
type Config = z.infer<typeof Config>;

function loadConfig(configFile = `${import.meta.dirname}/../../config/config.json`) {
    const fileContents = readFileSync(configFile, "utf-8");
    const rawConfig = JSON.parse(fileContents);
    return Config.parse(rawConfig);
}

export const config = loadConfig();
