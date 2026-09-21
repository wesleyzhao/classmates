# Architecture

How a request flows, how a room lives, and where the data sits. Read `AGENTS.md` first for the map; this is the level below it.

## The pieces

```mermaid
flowchart LR
  subgraph Browser
    UI[Screens and kit UI<br/>Preact via app/h.js]
    NET[app/net.js<br/>poll loop, actions, clock offset]
  end
  subgraph Vercel
    CDN[CDN<br/>static public/ and cached /v]
    FN[api/index.js<br/>server/router.js]
    ROOMS[server/rooms.js<br/>platform reducer]
    KIT[public/kits/x/kit.js<br/>pure rules]
    STORE[server/store/neon.js]
  end
  DB[(Neon Postgres<br/>rooms, games, decks, limits)]
  UI --> NET --> CDN --> FN --> ROOMS --> KIT
  ROOMS --> STORE --> DB
```

Everything under `public/` is served as static files. One function answers every `/api/*` path. Kits are plain modules that both the function and the browser can import, but only the function runs their rules.

## A room's life

```mermaid
stateDiagram-v2
  [*] --> lobby: POST /api/rooms
  lobby --> lobby: join, rename, settings, chat
  lobby --> playing: room/start (host)
  playing --> playing: kit actions, ticks, chat, undo, join, leave
  playing --> over: kit.summary().phase == 'over'
  over --> playing: room/restart (host)
  over --> [*]: 30 days without a write
```

The room document (`RoomDoc` in `types/parlor.d.ts`) holds the game snapshot (kit id and version, settings, content, deck ids), the players and their secrets, the phase, the kit state `s`, the chat tail, the activity log, undo snapshots, seen action ids, per-player rate windows, and the recently seen card ids. It is written whole, with compare-and-set on its version.

## One action, end to end

```mermaid
sequenceDiagram
  participant P as Phone
  participant F as Function
  participant K as Kit
  participant D as Database
  P->>F: POST /api/rooms/MKRT/act {id, type, payload} + player headers
  F->>D: SELECT doc, v FROM rooms WHERE code = 'MKRT'
  F->>F: authenticate, dedupe by id, rate window
  F->>K: tick(state) while now >= wakeAt (clock clamped to wakeAt)
  F->>K: reduce(state, action, ctx)
  F->>D: UPDATE rooms SET doc, v = v + 1 WHERE code AND v = old
  alt version conflict
    F->>D: re-read and apply again (up to 3 times)
  end
  F->>K: view(state, ctx for this player)
  F->>P: {v, now, room, view, summary}
```

Every action carries a client-made id; a retry after a lost response is applied once. Illegal actions throw `KitError` and change nothing. Views are redacted per player: any key starting with an underscore is stripped before the response leaves, and the conformance suite fails a kit that leaks one.

## Polling and time

```mermaid
sequenceDiagram
  participant P as Phone
  participant C as CDN
  participant F as Function
  loop every 0.8 to 2.5 s while visible
    P->>C: GET /api/rooms/MKRT/v
    C-->>P: {v, now} (cached 1 s, shared by every player)
    opt v changed or a deadline passed
      P->>F: GET /api/rooms/MKRT (player headers)
      F-->>P: {v, now, room, view, summary}
    end
  end
```

Nothing runs on the server between requests. A kit that needs something to happen at a time sets `state.wakeAt`; the next request after that time runs `tick` with `ctx.now` clamped to the deadline, in a loop, until nothing is due. The client knows `wakeAt` from its view and asks for the state right after it (the host a little earlier than the rest), so reveals land on time. Every response carries the server's `now`; the client keeps a median offset and renders countdowns from server time.

## Data model

```mermaid
erDiagram
  ROOMS { text code PK  int v  jsonb doc  timestamptz updated_at }
  GAMES { text id PK  text slug UK  text owner  text edit_key_hash  int v  jsonb doc  timestamptz created_at  timestamptz updated_at }
  DECKS { text id PK  text owner  text edit_key_hash  int v  jsonb doc  timestamptz created_at  timestamptz updated_at }
  LIMITS { text key PK  int count  timestamptz window_start }
  GAMES ||--o{ ROOMS : "snapshot of"
  DECKS }o--o{ GAMES : "referenced by id"
```

Built-in games and decks are modules under `public/games/` and `public/decks/`, listed in `public/shared/registry.js`; user-made ones are rows with the same document shape. A room stores deck ids and the versions it started with; cards are copied into kit state only when drawn.

## Locally

`server/dev.js` serves `public/` and mounts the same router in one process with the memory store, so several tabs share rooms. `npm test` runs the pure logic (kits through `tests/lib/sim.js`), the store contract against memory and a mocked Neon, the router with fake requests, and the room core; `npm run test:e2e` drives real browsers against the dev server.
