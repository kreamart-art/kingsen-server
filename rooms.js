/* ------------------------------------------------------------------ */
/*  Kingsen — authoritative multiplayer game engine + room registry.   */
/*                                                                      */
/*  The server owns the deck, turn order, kings counter, roles and      */
/*  house rules. Clients send actions; the server validates (turn       */
/*  enforcement) and broadcasts the full game state. Rule TEXT stays    */
/*  client-side — the room only carries the KGS1 set code + lang so      */
/*  every client renders the same titles/text locally.                  */
/*                                                                      */
/*  In-memory only (rooms are ephemeral, like a table that exists while  */
/*  people are sitting at it). Empty rooms are reaped after a TTL.       */
/* ------------------------------------------------------------------ */

const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUITS = [
  { sym: "♠", letter: "S", color: "ink" },
  { sym: "♥", letter: "H", color: "ember" },
  { sym: "♦", letter: "D", color: "ember" },
  { sym: "♣", letter: "C", color: "ink" },
];
// effect per rank for the DEFAULT set; custom sets override via the code's `e`.
const DEFAULT_EFFECT = {
  A: "waterfall", "2": "give", "3": "drink", "4": "category", "5": "thumbmaster",
  "6": "buddy", "7": "counting", "8": "newrule", "9": "rhyme", "10": "cheers",
  J: "neighbor", Q: "questionmaster", K: "king",
};

function makeDeck() {
  const deck = [];
  for (const s of SUITS) for (const rank of RANKS) deck.push({ rank, sym: s.sym, color: s.color });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = deck[i]; deck[i] = deck[j]; deck[j] = t;
  }
  return deck;
}

// Parse the effect map out of a KGS1 share code (so server knows which rank
// triggers buddy/thumbmaster/king/etc for THIS room's set). Falls back to default.
function effectsFromCode(code) {
  const eff = { ...DEFAULT_EFFECT };
  try {
    if (typeof code === "string" && code.startsWith("KGS1.")) {
      const obj = JSON.parse(decodeURIComponent(Buffer.from(code.slice(5), "base64").toString("utf8")));
      const d = obj && obj.d;
      if (d) for (const rank of RANKS) if (d[rank] && d[rank].e) eff[rank] = d[rank].e;
    }
  } catch { /* default */ }
  return eff;
}

const CODE_CHARS = "ACDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
function makeCode() {
  let s = "";
  for (let i = 0; i < 4; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

const rooms = new Map();          // code -> room
const ROOM_TTL_MS = 1000 * 60 * 60 * 3; // reap empty rooms after 3h idle

function newRoom(code, hostId, opts) {
  return {
    code,
    hostId,
    setCode: opts.setCode || "",      // KGS1 code (or "" = default)
    setName: opts.setName || "Klassiek",
    lang: opts.lang === "en" ? "en" : "nl",
    alcoholFree: !!opts.alcoholFree,
    effects: effectsFromCode(opts.setCode),
    players: [],                       // {id,name,connected,cards,threes}
    started: false,
    deck: [],
    card: null,                        // last drawn {rank,sym,color}
    flipped: false,
    turn: 0,
    kings: 0,
    thumbMaster: null,
    questionMaster: null,
    pairs: [],                         // [[a,b],...]
    houseRules: [],
    pendingBuddy: false,
    pendingRule: false,                // active player drew a "new rule" card -> must add one
    ruleEndsAt: 0,                      // deadline (ms) to invent the rule; 0 = none
    loser: null,
    timer: null,                       // {duration, endsAt} when running, else null
    hostAwaySince: 0,                  // ms timestamp when host disconnected (0 = present)
    closed: false,                     // host left and grace expired
    createdAt: Date.now(),
    touchedAt: Date.now(),
  };
}

const RULE_MS = 60000; // 60s to invent a mandatory house rule

function publicState(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    setCode: room.setCode,
    setName: room.setName,
    lang: room.lang,
    alcoholFree: room.alcoholFree,
    players: room.players.map((p) => ({ id: p.id, name: p.name, avatar: p.avatar || "", connected: p.connected, cards: p.cards, threes: p.threes })),
    started: room.started,
    card: room.card,
    flipped: room.flipped,
    turn: room.turn,
    deckCount: room.deck.length,
    kings: room.kings,
    thumbMaster: room.thumbMaster,
    questionMaster: room.questionMaster,
    pairs: room.pairs,
    houseRules: room.houseRules,
    pendingBuddy: room.pendingBuddy,
    pendingRule: room.pendingRule,
    ruleEndsAt: room.ruleEndsAt || 0,
    loser: room.loser,
    timer: room.timer,                 // {duration, endsAt(ms)} or null
    hostAwaySince: room.hostAwaySince || 0,
    closed: !!room.closed,
    gameOver: room.kings >= 4 && room.card && room.effects[room.card.rank] === "king",
  };
}

const HOST_GRACE_MS = 10000; // host can rejoin within 10s before the room closes

function currentPlayer(room) { return room.players[room.turn]; }

/* ---- the registry / engine API used by the WS layer ---- */
export const roomEngine = {
  create({ hostId, name, setCode, setName, lang, alcoholFree, avatar }) {
    let code;
    do { code = makeCode(); } while (rooms.has(code));
    const room = newRoom(code, hostId, { setCode, setName, lang, alcoholFree });
    room.players.push({ id: hostId, name: cleanName(name), avatar: cleanAvatar(avatar), connected: true, cards: 0, threes: 0 });
    rooms.set(code, room);
    return room;
  },

  join({ code, playerId, name, avatar }) {
    const room = rooms.get((code || "").toUpperCase());
    if (!room) return { error: "Room niet gevonden" };
    if (room.closed) return { error: "Room gesloten" };
    let p = room.players.find((x) => x.id === playerId);
    if (p) { p.connected = true; p.name = cleanName(name) || p.name; if (avatar !== undefined) p.avatar = cleanAvatar(avatar) || p.avatar; } // reconnect
    else {
      // a started game still allows REJOIN of a known player (handled above);
      // brand-new players can't join mid-game.
      if (room.started) return { error: "Spel al begonnen" };
      if (room.players.length >= 12) return { error: "Room vol" };
      room.players.push({ id: playerId, name: cleanName(name), avatar: cleanAvatar(avatar), connected: true, cards: 0, threes: 0 });
    }
    if (playerId === room.hostId) room.hostAwaySince = 0; // host is back -> cancel grace
    room.touchedAt = Date.now();
    return { room };
  },

  get(code) { return rooms.get((code || "").toUpperCase()) || null; },

  action(code, playerId, type, payload) {
    const room = rooms.get((code || "").toUpperCase());
    if (!room) return { error: "Room niet gevonden" };
    room.touchedAt = Date.now();
    const cur = currentPlayer(room);
    const isHost = playerId === room.hostId;
    const isTurn = cur && cur.id === playerId;

    switch (type) {
      case "start": {
        if (!isHost) return { error: "Alleen de host kan starten" };
        if (room.players.length < 2) return { error: "Minimaal 2 spelers" };
        room.started = true; room.deck = makeDeck(); room.turn = 0;
        room.card = null; room.flipped = false; room.kings = 0;
        room.thumbMaster = null; room.questionMaster = null; room.pairs = [];
        room.houseRules = []; room.pendingBuddy = false; room.loser = null;
        room.pendingRule = false; room.ruleEndsAt = 0; room.timer = null;
        room.players.forEach((p) => { p.cards = 0; p.threes = 0; });
        return { room };
      }
      case "draw": {
        if (!isTurn) return { error: "Niet jouw beurt" };
        if (room.flipped || room.deck.length === 0) return { room };
        const next = room.deck.pop();
        const eff = room.effects[next.rank];
        cur.cards += 1;
        if (next.rank === "3") cur.threes += 1;
        if (eff === "thumbmaster") room.thumbMaster = cur.name;
        if (eff === "questionmaster") room.questionMaster = cur.name;
        if (eff === "buddy") room.pendingBuddy = true;
        if (eff === "newrule") { room.pendingRule = true; room.ruleEndsAt = Date.now() + RULE_MS; }
        if (eff === "king") {
          room.kings += 1;
          if (room.kings >= 4) room.loser = cur.name;
        }
        room.card = next; room.flipped = true;
        room.timer = null; // fresh card -> no timer yet
        return { room };
      }
      case "timer": {
        if (!isTurn) return { error: "Niet jouw beurt" };
        const dur = Math.max(5, Math.min(120, Number(payload && payload.duration) || 0));
        if (!dur) { room.timer = null; return { room }; }
        room.timer = { duration: dur, endsAt: Date.now() + dur * 1000 };
        return { room };
      }
      case "buddy": {
        if (!isTurn) return { error: "Niet jouw beurt" };
        const name = cleanName(payload && payload.name);
        if (name) { room.pairs.push([cur.name, name]); room.pendingBuddy = false; }
        return { room };
      }
      case "rule": {
        if (!isTurn) return { error: "Niet jouw beurt" };
        const txt = cleanText(payload && payload.text);
        if (txt) { room.houseRules.push(txt); room.pendingRule = false; room.ruleEndsAt = 0; }
        return { room };
      }
      case "ruletimeout": {
        // 60s elapsed without a rule -> the active player drinks; rule no longer required.
        if (!isTurn) return { room };
        if (room.pendingRule && room.ruleEndsAt && Date.now() >= room.ruleEndsAt) {
          room.pendingRule = false; room.ruleEndsAt = 0;
        }
        return { room };
      }
      case "next": {
        if (!isTurn) return { error: "Niet jouw beurt" };
        if (room.pendingBuddy) return { error: "Kies eerst een drinkmaatje" };
        if (room.pendingRule) return { error: "Verzin eerst een regel" };
        room.flipped = false; room.card = null;
        room.timer = null;
        room.turn = (room.turn + 1) % room.players.length;
        return { room };
      }
      case "leave": {
        // Explicit leave = mark offline but KEEP the player so they can rejoin
        // to finish the game (fail-safe). Host leaving starts the grace window.
        const p = room.players.find((x) => x.id === playerId);
        if (p) p.connected = false;
        if (playerId === room.hostId && room.started && !room.closed) {
          room.hostAwaySince = Date.now();
        }
        return { room };
      }
      case "restart": {
        if (!isHost) return { error: "Alleen de host kan herstarten" };
        room.started = false; room.card = null; room.flipped = false;
        room.kings = 0; room.thumbMaster = null; room.questionMaster = null;
        room.pairs = []; room.houseRules = []; room.pendingBuddy = false;
        room.pendingRule = false; room.ruleEndsAt = 0; room.timer = null;
        room.loser = null; room.turn = 0;
        room.players.forEach((p) => { p.cards = 0; p.threes = 0; });
        return { room };
      }
      default:
        return { error: "Onbekende actie" };
    }
  },

  disconnect(code, playerId) {
    const room = rooms.get((code || "").toUpperCase());
    if (!room) return null;
    const p = room.players.find((x) => x.id === playerId);
    if (p) p.connected = false;
    // If the host drops while a game is in progress, start the 10s grace clock.
    if (playerId === room.hostId && room.started && !room.closed && !room.hostAwaySince) {
      room.hostAwaySince = Date.now();
    }
    room.touchedAt = Date.now();
    return room;
  },

  // Returns the list of rooms whose state changed this tick (host-grace expiry),
  // so the WS layer can broadcast the "closed" state to remaining players.
  tick() {
    const now = Date.now();
    const changed = [];
    for (const [, room] of rooms) {
      if (room.hostAwaySince && !room.closed && now - room.hostAwaySince >= HOST_GRACE_MS) {
        room.closed = true;
        room.hostAwaySince = 0;
        changed.push(room);
      }
    }
    return changed;
  },

  reap() {
    const now = Date.now();
    for (const [code, room] of rooms) {
      const anyConnected = room.players.some((p) => p.connected);
      const old = now - room.touchedAt > ROOM_TTL_MS;
      // closed rooms linger briefly so clients can receive the closed state.
      const closedStale = room.closed && now - room.touchedAt > 30000;
      if ((!anyConnected && old) || closedStale) rooms.delete(code);
    }
  },

  stats() { return { rooms: rooms.size }; },
  publicState,
};

function cleanName(n) { return String(n == null ? "" : n).replace(/[ -]/g, "").trim().slice(0, 18); }
function cleanText(n) { return String(n == null ? "" : n).replace(/[ -]/g, "").trim().slice(0, 80); }
// Avatar: only accept a small data:image URL (downscaled client-side); cap size.
function cleanAvatar(a) {
  if (typeof a !== "string") return "";
  if (!/^data:image\/(png|jpeg|webp);base64,/.test(a)) return "";
  return a.length <= 60000 ? a : "";
}

setInterval(() => roomEngine.reap(), 1000 * 60 * 10).unref?.();
