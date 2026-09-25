import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    test: {
        environment: "node",
        globals: true,
        include: ["packages/**/*.test.ts"],
        coverage: {
            provider: "v8",
            include: ["packages/**/src/**/*.ts"],
            exclude: ["**/*.d.ts", "**/*.test.ts"]
        }
    },
    resolve: {
        alias: {
            "@space/maths": path.resolve(rootDir, "packages/maths/src/index.ts"),
            "@space/misc": path.resolve(rootDir, "packages/misc/src/index.ts"),
            "@space/shared-data": path.resolve(rootDir, "packages/shared-data/src/index.ts")
        }
    }
});
