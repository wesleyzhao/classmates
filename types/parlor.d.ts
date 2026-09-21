// Parlor's shared contracts. Plain JavaScript files reference these with JSDoc
// (`/** @type {import('../../types/parlor').Kit} */`) and `npm run check` verifies them.
// Nothing here is compiled; the file exists so kits, the server, and the client agree on shapes.

export type PlayerId = string;
export type Theme = 'editorial' | 'playful';

/** A seat at the table. `connected` is best-effort presence, not a socket. */
export interface PlayerInfo {
  id: PlayerId;
  name: string;
  /** One emoji. */
  avatar: string;
  seat: number;
  connected: boolean;
  isHost: boolean;
  joinedAt: number;
  lastSeen: number;
}

// ---------------------------------------------------------------------------
// Schema DSL (public/shared/schema.js)
// One definition drives server validation, the creator's forms, and the printed docs.

export type FieldType =
  | 'text' | 'longtext' | 'number' | 'bool' | 'choice' | 'multi' | 'color' | 'emoji' | 'image'
  | 'list' | 'object' | 'ref' | 'decks';

export interface Field {
  type: FieldType;
  label?: string;
  help?: string;
  default?: unknown;
  /** Defaults to true for scalars without a default; lists default to []. */
  required?: boolean;
  /** number: numeric bounds. text: length bounds. list/decks: item count bounds. */
  min?: number;
  max?: number;
  maxLength?: number;
  /** choice/multi: the allowed values, optionally with labels. */
  options?: Array<string | { value: string; label: string }>;
  /** list: the item field. */
  of?: Field;
  /** object: the named fields. */
  fields?: Record<string, Field>;
  /** ref: which collection the id points into ('deck' | 'card'). */
  to?: string;
  /** decks: card fields the kit needs every card to have. */
  cardFields?: string[];
  /** Only show and validate when another field has a value. `$config.x` reaches config from content. */
  when?: { field: string; eq: unknown };
}

export type Schema = Record<string, Field>;

export interface ValidationIssue { path: string; message: string }

// ---------------------------------------------------------------------------
// Decks and games (content)

export interface Card {
  id: string;
  prompt: string;
  answer: string;
  aliases?: string[];
  choices?: string[];
  reject?: string[];
  image?: string;
  emoji?: string;
  category?: string;
  note?: string;
}

export interface Deck {
  id: string;
  title: string;
  description?: string;
  language?: string;
  version: number;
  /** Optional category definitions for decks that group cards. */
  categories?: Array<{ id: string; name: string; color?: string; emoji?: string }>;
  cards: Card[];
}

export interface GameDefinition {
  id: string;
  slug: string;
  title: string;
  description: string;
  emoji: string;
  kitId: string;
  config: Record<string, unknown>;
  content: Record<string, unknown>;
  theme: Theme;
  accent?: string;
  /** The kit's own one-line description of these settings, from `kit.blurb()`. */
  blurb?: string;
  /** Present on built-ins; user games carry an owner instead. */
  builtin?: boolean;
  /** Hidden games never appear in the catalog (the template game is one). */
  hidden?: boolean;
  createdAt?: number;
  updatedAt?: number;
  version?: number;
}

// ---------------------------------------------------------------------------
// Kits (public/kits/<id>/kit.js). See docs/KIT-CONTRACT.md for the rules.

export interface Rng {
  /** Uniform in [0, 1). */
  (): number;
  /** Integer in [0, n). */
  int(n: number): number;
  pick<T>(items: readonly T[]): T;
  shuffle<T>(items: readonly T[]): T[];
  /** How many numbers have been drawn; the platform persists this in `state.$rng`. */
  count(): number;
}

export interface KitContext {
  /** Optional private target sequence supplied at setup by an application policy. */
  targets?: string[];
  config: Record<string, any>;
  content: Record<string, any>;
  /** Every deck referenced by `content`, by id, with cards. Server side only. */
  decks: Record<string, Deck>;
  players: PlayerInfo[];
  rng: Rng;
  now: number;
  /** Append a public event; the platform stamps `n` and `t` and caps the log. */
  log: (type: string, data?: Record<string, unknown>) => void;
  /** The player an action or view is for; null for spectators and system actions. */
  me: PlayerId | null;
  isHost: boolean;
  /** Ids of cards devices at the table have seen recently; `draw.js` avoids them. */
  recent?: string[];
}

export interface Action {
  /** Client-generated; the platform drops repeats. */
  id: string;
  type: string;
  payload?: any;
  playerId: PlayerId | null;
}

/** Something a player may do right now. The platform renders these; the kit decides them. */
export interface ViewAction {
  type: string;
  payload?: any;
  label: string;
  disabled?: boolean;
  /** Ask before sending. */
  confirm?: string;
  /** Only the host sees it. */
  host?: boolean;
  /** `canvas` marks an action the kit's own screen draws (a card, a board space); the action bar skips it. */
  kind?: 'primary' | 'secondary' | 'danger' | 'canvas';
}

export interface KitView {
  phase: string;
  actions: ViewAction[];
  /** Mirror of state.wakeAt so the client can count down and poke on time. */
  wakeAt?: number | null;
  /** Players the game is waiting on; the platform uses it for "gone quiet" handling. */
  waitingOn?: PlayerId[];
  [key: string]: unknown;
}

export interface Summary {
  phase: 'playing' | 'over';
  scores: Array<{ playerId: PlayerId; score: number; label?: string; finish?: string }>;
  winnerIds: PlayerId[];
  /** One line for the lobby list or the results screen, e.g. "Round 4 of 10". */
  label?: string;
  /**
   * How the scores read. `points` (the default) shows the numbers and says "1,240 points";
   * `labels` says each row's `label` is the whole story ("2 cards left", "3 wedges"), so the
   * results hide the numbers and the line under the winner reads "Nina finished with 3 wedges."
   * A row may add `finish` to say it in its own words ("finished on space 24 of 30").
   */
  unit?: 'points' | 'labels';
  teams?: Array<{ id: string; name: string; playerIds: PlayerId[]; score: number }>;
}

/** Kit state is kit-defined; these keys are reserved and managed by the platform. */
export interface KitStateBase {
  $seed: string;
  $rng: number;
  /** Epoch ms when `tick` must run next, or null. */
  wakeAt: number | null;
  [key: string]: unknown;
}

export type ScriptStep =
  | [player: PlayerId, type: string, payload?: any]
  | ['@wait', ms: number]
  | ['@join', player: PlayerId]
  | ['@leave', player: PlayerId]
  | ['@return', player: PlayerId]
  | ['@remove', player: PlayerId]
  | ['@check', (sim: any) => void];

export interface Kit<S extends KitStateBase = KitStateBase> {
  id: string;
  name: string;
  tagline: string;
  /** Bump on incompatible state changes; rooms on an older version freeze to results. */
  version: number;
  minPlayers: number;
  maxPlayers: number;
  /** Hidden kits do not appear in the catalog or the creator (the template kit is one). */
  hidden?: boolean;
  /** How a late joiner is handled; copy hint for the platform, the rules live in reduce(). */
  joinMidGame: 'seat' | 'next-round' | 'spectate';
  config: Schema;
  content: Schema;
  setup(ctx: KitContext): S;
  reduce(state: S, action: Action, ctx: KitContext): S;
  tick(state: S, ctx: KitContext): S;
  view(state: S, ctx: KitContext): KitView;
  summary(state: S): Summary;
  /**
   * One plain sentence describing these settings for the lobby and the game page, e.g.
   * "Ten cards, fifteen seconds each. Tap one of four answers." At most 120 characters.
   */
  blurb?(config: Record<string, any>, content: Record<string, any>): string;
  /** A short scripted game used by the conformance suite and the docs. */
  demoScript?: ScriptStep[];
  /** Config for the demo script (defaults otherwise). */
  demoConfig?: Record<string, unknown>;
  /** Content for the demo script. */
  demoContent?: Record<string, unknown>;
  /** Decks the demo needs (built-in ids). */
  demoDecks?: string[];
}

// ---------------------------------------------------------------------------
// Rooms (server/rooms.js). One JSON document per room.

export interface ChatMessage {
  id: string;
  t: number;
  playerId: PlayerId;
  text: string;
}

export interface LogEntry {
  n: number;
  t: number;
  type: string;
  [key: string]: unknown;
}

export interface RoomGameSnapshot {
  id: string;
  slug: string;
  title: string;
  emoji: string;
  kitId: string;
  kitVersion: number;
  config: Record<string, unknown>;
  content: Record<string, unknown>;
  theme: Theme;
  accent?: string;
  /** The kit's own one-line description of these settings, from `kit.blurb()`. */
  blurb?: string;
  /** Deck ids referenced by content, and the deck versions the room started with. */
  deckIds: string[];
  deckVersions: Record<string, number>;
}

export interface RoomDoc {
  code: string;
  v: number;
  createdAt: number;
  updatedAt: number;
  game: RoomGameSnapshot;
  hostId: PlayerId;
  players: PlayerInfo[];
  /** Player secrets; stripped from every response. */
  secrets: Record<PlayerId, string>;
  phase: 'lobby' | 'playing' | 'over';
  /** Kit state while playing or over; null in the lobby. */
  s: KitStateBase | null;
  chat: ChatMessage[];
  log: LogEntry[];
  logN: number;
  undo: Array<{ savedAt: number; s: KitStateBase }>;
  /** Recent action ids, for dedupe. */
  seen: string[];
  /** Per-player action windows, for rate limiting without extra queries. */
  limits: Record<PlayerId, { w: number; c: number }>;
  /** Card ids devices at this table have seen recently. */
  recent: string[];
  /** How many games have been played in this room. */
  games: number;
  /** Epoch ms of the host's last action, for the takeover rule. */
  hostSeenAt: number;
}

/** What a player receives: the room without secrets, plus their redacted kit view. */
export interface RoomSnapshot {
  v: number;
  now: number;
  room: {
    code: string;
    phase: RoomDoc['phase'];
    hostId: PlayerId;
    players: PlayerInfo[];
    game: RoomGameSnapshot;
    chat: ChatMessage[];
    log: LogEntry[];
    logN: number;
    games: number;
    canUndo: boolean;
    canTakeOver: boolean;
  };
  view: KitView | null;
  summary: Summary | null;
}

// ---------------------------------------------------------------------------
// Store (server/store/*.js). Neon in production, memory in dev and tests.

export interface RoomRow { doc: RoomDoc; v: number }
export interface GameRow { id: string; slug: string; owner: string; editKeyHash: string; v: number; doc: GameDefinition; createdAt: number; updatedAt: number }
export interface DeckRow { id: string; owner: string; editKeyHash: string; v: number; doc: Deck; createdAt: number; updatedAt: number }

export interface Store {
  name: 'neon' | 'memory';
  /** Create tables if needed. Safe to call many times. */
  init(): Promise<void>;
  getRoom(code: string): Promise<RoomRow | null>;
  getVersion(code: string): Promise<number | null>;
  /** False when the code is taken. */
  createRoom(code: string, doc: RoomDoc): Promise<boolean>;
  /** The new version, or null when `expectedV` no longer matches. */
  casRoom(code: string, expectedV: number, doc: RoomDoc): Promise<number | null>;
  deleteStaleRooms(olderThanMs: number): Promise<number>;
  deleteRoom(code: string): Promise<boolean>;
  getGame(idOrSlug: string): Promise<GameRow | null>;
  putGame(row: GameRow): Promise<void>;
  getDeck(id: string): Promise<DeckRow | null>;
  putDeck(row: DeckRow): Promise<void>;
  /** Fixed-window counter. */
  bumpLimit(key: string, windowMs: number, max: number): Promise<{ allowed: boolean; count: number }>;
}
