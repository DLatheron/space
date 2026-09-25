# Space

TypeScript monorepo with a React client, Express API, and shared workspace packages.

## Packages

| Package               | Description                  |
| --------------------- | ---------------------------- |
| `@space/client`       | React front-end (Vite)       |
| `@space/server`       | Express API + WebSocket host |
| `@space/maths`        | Shared maths utilities       |
| `@space/misc`         | Shared misc utilities        |
| `@space/shared-data`  | Shared Zod schemas and types |

## Prerequisites

- Node.js 24+ (see `.nvmrc`)
- [pnpm](https://pnpm.io/)

## Setup

```bash
pnpm install
pnpm build
```

## Development

```bash
pnpm dev
```

Open http://localhost:5173 with create/join query params:

- http://localhost:5173/?client-id=ea3f6731-d893-4cf8-9641-e588b184c4a7&game-id=USH6-8D25&mode=create
- http://localhost:5173/?game-id=USH6-8D25&client-id=f2aae33e-c5d1-4d54-aafc-709f7350feab&mode=join

With `highlanderGameMode` enabled (default), join resolves to the single live game regardless of `game-id`.

## Scripts

| Script        | Description        |
| ------------- | ------------------ |
| `pnpm build`  | Build all packages |
| `pnpm test`   | Run Vitest tests   |
| `pnpm lint`   | ESLint             |
| `pnpm format` | Prettier write     |
