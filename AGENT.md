# Space — Agent Guide

Minimal multiplayer space-game framework. **Authoritative server** owns simulation and FOW; **thin React + canvas client** renders and sends intents. Wire contracts live in Zod schemas in `@space/shared-data`.

## Packages

| Package | Role |
| ------- | ---- |
| `@space/client` | React UI + canvas hex map |
| `@space/server` | Express HTTP + WebSocket game host |
| `@space/shared-data` | Shared Zod schemas / message types |
| `@space/maths` | Pointy-top axial hex maths |
| `@space/misc` | Logger, MessageManager, CastToArray |

## Map & visibility

- Pointy-top hexes, axial coords, odd-r rectangular `tiles[col][row]`
- Per-**side** shared fog: `unexplored` (black) / `explored` (faded memory) / `visible` (full)
- Server only sends tile contents for explored/visible hexes (`server:map:init`, `server:tiles:update`)
- Client stencil: black → faded explored layer → full visible layer (dual offscreen canvases)

## Client ↔ server communication

```
Browser
  POST /api/game/create|join  →  GameManager registers Client
  WS   /ws/game?clientId&gameId
       ClientToServerMessage  →  Game → MessageManager
       ServerToClientMessage  ←  Client.sendMessage
```

## Architecture rules

1. Simulation and FOW stay on the server. Client only presents and sends intents.
2. Never add parallel message/types in client or server — extend `@space/shared-data` first.
3. Shared packages emit `dist/`; keep them built or watching.
4. Compiled packages use `.js` extensions in relative imports (NodeNext).
