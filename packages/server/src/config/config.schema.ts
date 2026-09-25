import { LogLevel } from "@space/misc";
import { readFileSync } from "fs";
import z from "zod";

const Config = z
    .object({
        port: z.int().min(1024).max(65534).optional().default(3000),
        highlanderGameMode: z.boolean().optional().default(true),
        mapWidth: z.int().positive().optional().default(50),
        mapHeight: z.int().positive().optional().default(50),
        hexPointToPoint: z.number().positive().optional().default(100),
        visionRange: z.int().nonnegative().optional().default(6),
        mapSeed: z.int().optional(),
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
