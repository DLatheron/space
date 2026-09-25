# Space — Agent Guide

Minimal multiplayer space-game framework. **Authoritative server** owns simulation; **thin React client** connects and exchanges intents. Wire contracts live in Zod schemas in `@space/shared-data`.

## Packages

| Package | Role |
| ------- | ---- |
| `@space/client` | React UI + WebSocket client |
| `@space/server` | Express HTTP + WebSocket game host |
| `@space/shared-data` | Shared Zod schemas / message types |
| `@space/maths` | Shared maths utilities (placeholder) |
| `@space/misc` | Logger, MessageManager, CastToArray |

## Client ↔ server communication

```
Browser
  POST /api/game/create|join  →  GameManager registers Client
  WS   /ws/game?clientId&gameId
       ClientToServerMessage  →  Game → MessageManager
       ServerToClientMessage  ←  Client.sendMessage
```

- Messages are `{ type, payload }` discriminated unions. Prefixes: `client:…` / `server:…`.
- Parse with Zod at boundaries; extend schemas in `@space/shared-data` first.

## Architecture rules

1. Simulation stays on the server. Client only presents and sends intents.
2. Never add parallel message/types in client or server — extend `@space/shared-data`, rebuild, then implement handlers.
3. Shared packages emit `dist/`; keep them built or watching before importing from client/server.
4. Compiled packages use `.js` extensions in relative imports (NodeNext).
