import z from "zod";

const logLevel = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3
} as const;
export const LogLevel = z.enum(logLevel);
export type LogLevel = z.infer<typeof LogLevel>;

export class Logger {
    private level: LogLevel;
    private system: string;

    constructor(system: string, level: LogLevel = LogLevel.enum.info) {
        this.level = level;
        this.system = system;
    }

    private _log(level: LogLevel, ...args: unknown[]) {
        if (level >= this.level) {
            console.log(`[${this.system}] ${level}:`, ...args);
        }
    }

    private _dir(level: LogLevel, ...args: unknown[]) {
        if (level >= this.level) {
            console.log(`[${this.system}] ${level}:`, ...args);
        }
    }

    error(...args: unknown[]) {
        this._log(LogLevel.enum.error, args);
    }

    warn(...args: unknown[]) {
        this._log(LogLevel.enum.warn, args);
    }

    info(...args: unknown[]) {
        this._log(LogLevel.enum.info, args);
    }

    debug(...args: unknown[]) {
        this._log(LogLevel.enum.debug, args);
    }

    dir(...args: unknown[]) {
        this._dir(LogLevel.enum.debug, args);
    }

    clear() {
        console.clear();
    }

    group() {
        console.group();
    }

    groupEnd() {
        console.groupEnd();
    }

    private static readonly _singleton = new Logger("global", LogLevel.enum.info);
    static GetSingleton(): Logger {
        return Logger._singleton;
    }
}
