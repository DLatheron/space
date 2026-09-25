import eslint from "@eslint/js";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
    { ignores: ["**/dist/**", "**/coverage/**", "eslint.config.js", "vitest.config.ts"] },
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    prettier,
    {
        files: ["packages/client/**/*.{ts,tsx}"],
        languageOptions: {
            ecmaVersion: 2022,
            globals: globals.browser
        },
        plugins: {
            "react-hooks": reactHooks,
            "react-refresh": reactRefresh
        },
        rules: {
            ...reactHooks.configs.recommended.rules,
            "react-refresh/only-export-components": ["warn", { allowConstantExport: true }]
        }
    },
    {
        files: [
            "packages/server/**/*.ts",
            "packages/maths/**/*.ts",
            "packages/misc/**/*.ts",
            "packages/shared-data/**/*.ts"
        ],
        languageOptions: {
            ecmaVersion: 2022,
            globals: globals.node
        }
    },
    {
        files: ["**/*.test.ts"],
        languageOptions: {
            globals: {
                ...globals.node,
                ...globals.vitest
            }
        }
    }
);
