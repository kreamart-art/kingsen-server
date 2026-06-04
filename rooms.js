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
let tickCount = 0;
const REBROADCAST_EVERY = 3;      // ticks (~3s): re-push active-room state so a client
                                  // that missed a broadcast (esp. the LAST one = game-over)
                                  // self-heals instead of freezing forever.

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
    gate: false,                       // pre-start "read the rules + ready up" gate (host opens it; game starts only when all are ready)
    gateReady: {},                     // {id:true} players who tapped "I'm ready" on the rules screen
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
    spinPick: null,                    // Boer/neighbour: name the wheel landed on to DRINK (server-chosen, so every client lands the same)
    spinGiver: null,                   // Boer/neighbour: name the wheel chose to DEAL OUT (Boer B = "one deals, one drinks")
    pendingKingShot: false,            // Koning B: drawer must assign a king's shot (kings 1-3)
    kingShotTarget: null,              // Koning B: who the drawer sent the shot to
    race: null,                        // Hemel B: { kind:"heaven", openAt, taps:[{id,name,at}] } — tap race, last drinks
    chain: null,                       // Waterval B: { order:[id...from drawer], stopped:[id] } — tap-chain
    thumbRace: null,                   // Duimbaas A: { openAt, taps:[{id,name,at}] } — anytime thumb-master race
    juf: null,                         // JUF (Sevens) mini-game: { phase, order:[id], count, turnIndex, deadline, ready:{id:bool}, lastResult, overSince, readyAt }
    pendingRule: false,                // active player drew a "new rule" card -> must add one
    ruleEndsAt: 0,                      // deadline (ms) to invent the rule; 0 = none
    turnEndsAt: 0,                      // deadline (ms) to draw before the turn auto-skips; 0 = none
    lastTimeout: null,                  // {name, at} of the most recent auto-skipped (too-slow) player
    loser: null,
    timer: null,                       // {duration, endsAt} when running, else null
    hostAwaySince: 0,                  // ms timestamp when host disconnected (0 = present)
    hostGraceMs: 0,                    // how long to wait before closing (set per cause: leave vs drop)
    lastLeft: null,                    // {name, at} of the most recent guest who left
    closed: false,                     // host left and grace expired
    rev: 0,                            // monotonic state revision: lets clients drop
                                       // out-of-order (stale) responses so a late poll
                                       // can't clobber a freshly-drawn card.
    createdAt: Date.now(),
    touchedAt: Date.now(),
  };
}

const RULE_MS = 60000; // 60s to invent a mandatory house rule
// Auto-skip a stalled turn: the active player gets a 15s grace, then a 15s
// visible countdown; if they STILL haven't drawn, their turn is passed on and
// they must take a sip/shot. Server-authoritative so it fires even if their app
// is backgrounded (replaces the old manual host "skip turn").
const TURN_GRACE_MS = 15000;
const TURN_COUNTDOWN_MS = 15000;
const TURN_MS = TURN_GRACE_MS + TURN_COUNTDOWN_MS; // 30s total before auto-skip

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
    gate: !!room.gate,
    gateReady: room.gateReady || {},
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
    spinPick: room.spinPick || null,
    spinGiver: room.spinGiver || null,
    pendingKingShot: !!room.pendingKingShot,
    kingShotTarget: room.kingShotTarget || null,
    race: room.race || null,
    chain: room.chain || null,
    thumbRace: room.thumbRace || null,
    juf: room.juf || null,
    pendingRule: room.pendingRule,
    ruleEndsAt: room.ruleEndsAt || 0,
    turnEndsAt: room.turnEndsAt || 0,
    lastTimeout: room.lastTimeout || null,
    loser: room.loser,
    timer: room.timer,                 // {duration, endsAt(ms)} or null
    hostAwaySince: room.hostAwaySince || 0,
    lastLeft: room.lastLeft || null,
    closed: !!room.closed,
    rev: room.rev || 0,
    // Sticky: once the 4th king is drawn the game is over and STAYS over until a
    // restart (which resets kings to 0). loser is already persisted, so a client
    // that was mid-reconnect when the king landed still sees the end on rejoin —
    // instead of the old transient flag that was only true while the card showed.
    gameOver: room.kings >= 4,
  };
}

const HOST_GRACE_MS = 10000;            // deliberate host LEAVE -> close after this
// A host CONNECTION DROP gets a MUCH longer grace: a mobile blip kills the socket
// and the client needs ~10-20s+ to detect it and reconnect (longer on a throttled
// tab). A 10s window closed the room before recovery and kicked everyone — so a
// drop now waits this long before the room closes.
const HOST_DISCONNECT_GRACE_MS = 45000;
// HTTP-polling transport: each GET/POST "touches" the player (sets lastSeen). A
// poller not seen within this window is treated as disconnected. > a few missed
// ~1.5s polls. Polling has no fragile persistent socket, so it can't "miss the
// last broadcast" — every poll returns the current authoritative state.
const POLL_TIMEOUT_MS = 9000;

function currentPlayer(room) { return room.players[room.turn]; }

// Remove a player and keep room.turn valid. If the leaver was the active
// player (mid-card), clear the card so the next player gets a clean turn.
function removePlayerAt(room, idx) {
  if (idx < 0) return;
  const wasActive = idx === room.turn;
  room.players.splice(idx, 1);
  if (room.players.length === 0) { room.turn = 0; return; }
  if (idx < room.turn) room.turn -= 1;           // shift pointer for earlier removals
  if (room.turn >= room.players.length) room.turn = 0; // clamp (wrap if last left)
  if (wasActive) {                               // their turn ended with them
    room.flipped = false; room.card = null; room.timer = null;
    room.pendingBuddy = false; room.pendingRule = false; room.ruleEndsAt = 0;
    room.spinPick = null; room.spinGiver = null; room.pendingKingShot = false; room.kingShotTarget = null; room.race = null; room.chain = null; room.juf = null; room.thumbRace = null;
  }
}

// Advance to the next turn, skipping players who are currently disconnected
// (so the game never stalls on someone who closed their tab). Falls back to
// the next index if everyone else is offline.
function advanceTurn(room) {
  const n = room.players.length;
  if (n === 0) { room.turn = 0; return; }
  for (let step = 1; step <= n; step++) {
    const idx = (room.turn + step) % n;
    if (room.players[idx] && room.players[idx].connected) { room.turn = idx; return; }
  }
  room.turn = (room.turn + 1) % n; // everyone else offline -> just move on
}

// (Re)arm the draw-phase auto-skip timer for whoever is now on turn. Self-clears
// to 0 whenever we're NOT waiting for a draw (game not running, a card is already
// flipped, fewer than 2 players, or the game is over) so the watchdog stays idle.
function armTurn(room) {
  room.turnEndsAt = (room.started && !room.flipped && room.players.length >= 2 && room.kings < 4)
    ? Date.now() + TURN_MS
    : 0;
}

/* ---- Turn-relay mini-games (JUF / Categorie / Rijmen) — server-authoritative ----
   All three share one engine: ready -> playing -> over -> done, a fixed turn order,
   a shrinking per-turn deadline, and "first to fail/too-slow drinks". JUF also
   validates the answer (juf vs number); Categorie/Rijmen just need you to tap before
   the timer (the naming/rhyming itself is social). The prompt is server-picked so
   everyone sees the same category/word. */
const RELAY_CATEGORIES = {
  nl: ["Automerken", "Landen", "Dieren", "Voetbalclubs", "Cocktails", "Films", "Steden", "Beroepen", "Pizza-toppings", "Superhelden", "Fruit", "Biermerken", "Disney-films", "Lichaamsdelen", "Kleuren"],
  en: ["Car brands", "Countries", "Animals", "Football clubs", "Cocktails", "Movies", "Cities", "Jobs", "Pizza toppings", "Superheroes", "Fruits", "Beer brands", "Disney movies", "Body parts", "Colours"],
};
const RELAY_RHYMES = {
  nl: ["kat", "huis", "boom", "bier", "feest", "maan", "trein", "hand", "licht", "stoel", "zon", "kaas", "muur", "fiets", "hond"],
  en: ["cat", "house", "tree", "beer", "night", "moon", "train", "hand", "light", "chair", "sun", "wall", "bike", "game", "star"],
};
function relayPrompt(mode, lang) {
  const L = lang === "en" ? "en" : "nl";
  if (mode === "category") { const a = RELAY_CATEGORIES[L]; return a[Math.floor(Math.random() * a.length)]; }
  if (mode === "rhyme") { const a = RELAY_RHYMES[L]; return a[Math.floor(Math.random() * a.length)]; }
  return null;
}
function startRelay(room, mode) {
  const n = room.players.length, order = [];
  for (let s = 0; s < n; s++) { const p = room.players[(room.turn + s) % n]; if (p && p.connected) order.push(p.id); }
  room.juf = { mode, prompt: relayPrompt(mode, room.lang), phase: "ready", order, count: 1, turnIndex: 0, deadline: 0, ready: {}, lastResult: null, overSince: 0, readyAt: Date.now() };
}
const JUF_START_MS = 4000, JUF_STEP_MS = 130, JUF_MIN_MS = 1500, JUF_OVER_MS = 4000, JUF_READY_MAX_MS = 90000;
function jufDeadlineFor(count) { return Date.now() + Math.max(JUF_MIN_MS, JUF_START_MS - JUF_STEP_MS * (count - 1)); }
function jufIsJuf(n) { return (n % 7 === 0) || String(n).includes("7"); }
// reason CODE (client localizes): "multiple" | "contains" | "saidjuf" | "slow"
function jufReasonCode(n) { return n % 7 === 0 ? "multiple" : "contains"; }
function jufConnectedIds(room) {
  return (room.juf ? room.juf.order : []).filter((id) => { const p = room.players.find((x) => x.id === id); return p && p.connected; });
}
// Move JUF turn to the next CONNECTED player in the fixed order; (re)arm the timer.
function jufAdvance(room) {
  const J = room.juf, ord = J.order, n = ord.length;
  for (let step = 1; step <= n; step++) {
    const idx = (J.turnIndex + step) % n;
    const p = room.players.find((x) => x.id === ord[idx]);
    if (p && p.connected) { J.turnIndex = idx; break; }
  }
  J.deadline = jufDeadlineFor(J.count);
}
function jufLose(room, id, reason, number) {
  const p = room.players.find((x) => x.id === id);
  room.juf.phase = "over";
  room.juf.overSince = Date.now();
  room.juf.lastResult = { drinkerId: id, drinkerName: p ? p.name : "", reason, number };
}

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
    room.rev = (room.rev || 0) + 1; // every action advances the revision (atomic in Node)
    const cur = currentPlayer(room);
    const isHost = playerId === room.hostId;
    const isTurn = cur && cur.id === playerId;

    switch (type) {
      case "opengate": {
        // host opens the "read the rules + ready up" screen for everyone
        if (!isHost) return { error: "Alleen de host kan starten" };
        if (room.started) return { room };
        if (room.players.length < 2) return { error: "Minimaal 2 spelers" };
        room.gate = true; room.gateReady = {};
        return { room };
      }
      case "closegate": {
        // host backs out of the rules screen, returns everyone to the lobby
        if (!isHost) return { error: "Alleen de host" };
        room.gate = false; room.gateReady = {};
        return { room };
      }
      case "gateready": {
        // a player taps "I'm ready" (or un-readies) on the rules screen
        if (!room.gate || room.started) return { room };
        const on = !(payload && payload.on === false);
        if (on) room.gateReady[playerId] = true; else delete room.gateReady[playerId];
        return { room };
      }
      case "start": {
        if (!isHost) return { error: "Alleen de host kan starten" };
        if (room.players.length < 2) return { error: "Minimaal 2 spelers" };
        if (!room.gate) return { error: "Open eerst de regels" };
        // every connected guest must have read the rules + tapped ready (the host's start click = host ready)
        if (room.players.some((p) => p.connected && p.id !== room.hostId && !room.gateReady[p.id])) return { error: "Nog niet iedereen is klaar" };
        room.gate = false; room.gateReady = {};
        room.started = true; room.deck = makeDeck(); room.turn = 0;
        room.card = null; room.flipped = false; room.kings = 0;
        room.thumbMaster = null; room.questionMaster = null; room.pairs = [];
        room.houseRules = []; room.pendingBuddy = false; room.loser = null;
        room.pendingRule = false; room.ruleEndsAt = 0; room.timer = null;
        room.lastTimeout = null;
        room.spinPick = null; room.spinGiver = null; room.pendingKingShot = false; room.kingShotTarget = null; room.race = null; room.chain = null; room.juf = null; room.thumbRace = null;
        room.players.forEach((p) => { p.cards = 0; p.threes = 0; });
        armTurn(room);
        return { room };
      }
      case "draw": {
        if (!isTurn) return { error: "Niet jouw beurt" };
        if (room.flipped || room.deck.length === 0) return { room };
        const next = room.deck.pop();
        const eff = room.effects[next.rank];
        cur.cards += 1;
        if (next.rank === "3") cur.threes += 1;
        room.spinPick = null; room.spinGiver = null;   // clear any previous wheel result
        room.pendingKingShot = false; room.kingShotTarget = null;
        room.race = null; room.chain = null; room.juf = null;
        if (eff === "thumbmaster") room.thumbMaster = cur.name;
        if (eff === "race") {                          // Hemel B: 3-2-1 then a tap race (last drinks)
          room.race = { kind: "heaven", openAt: Date.now() + 3000, taps: [] };
        }
        if (eff === "waterfall") {                     // Waterval B: tap-chain in turn order from the drawer
          const n = room.players.length, order = [];
          for (let s = 0; s < n; s++) { const p = room.players[(room.turn + s) % n]; if (p && p.connected) order.push(p.id); }
          room.chain = { order, stopped: [] };
        }
        if (eff === "counting") startRelay(room, "juf");        // JUF (Sevens)
        if (eff === "category") startRelay(room, "category");    // Categorie
        if (eff === "rhyme") startRelay(room, "rhyme");          // Rijmen
        if (eff === "questionmaster") room.questionMaster = cur.name;
        if (eff === "buddy") room.pendingBuddy = true;
        if (eff === "neighbor") {
          // Boer B: the wheel picks TWO present players — one deals out, one drinks.
          // Server-chosen so every client's spin lands on the same people.
          const pool = room.players.filter((p) => p.connected);
          if (pool.length >= 2) {
            const di = Math.floor(Math.random() * pool.length);
            let gi = Math.floor(Math.random() * (pool.length - 1)); if (gi >= di) gi += 1; // distinct
            room.spinPick = pool[di].name;    // drinks
            room.spinGiver = pool[gi].name;   // deals out
          } else {
            const only = pool[0] || cur;
            room.spinPick = only.name; room.spinGiver = only.name;
          }
        }
        if (eff === "newrule") { room.pendingRule = true; room.ruleEndsAt = Date.now() + RULE_MS; }
        if (eff === "king") {
          room.kings += 1;
          if (room.kings >= 4) room.loser = cur.name;
          else { room.pendingKingShot = true; room.kingShotTarget = null; } // Koning B: kings 1-3 -> assign a shot
        }
        room.card = next; room.flipped = true;
        room.timer = null; // fresh card -> no timer yet
        armTurn(room);     // card is up -> draw-phase timer off
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
      case "kingshot": {
        // Koning B: the drawer assigns the king's shot to a player.
        if (!isTurn) return { error: "Niet jouw beurt" };
        const name = cleanName(payload && payload.name);
        if (name) { room.kingShotTarget = name; room.pendingKingShot = false; }
        return { room };
      }
      case "tap": {
        // Hemel B: anyone taps once the race window is open; arrival order is
        // authoritative (last to tap = loser). No turn check — everyone races.
        if (!room.race) return { room };
        const now = Date.now();
        if (now < room.race.openAt) return { room };          // before 3-2-1 ends: ignore (no false starts)
        const me = room.players.find((p) => p.id === playerId);
        if (me && !room.race.taps.some((t) => t.id === playerId)) room.race.taps.push({ id: playerId, name: me.name, at: now });
        return { room };
      }
      case "waterstop": {
        // Waterval B: you may only stop once the player before you in the chain has.
        if (!room.chain) return { room };
        if (room.chain.order[room.chain.stopped.length] === playerId) room.chain.stopped.push(playerId);
        return { room };
      }
      case "thumbstart": {
        // Duimbaas A: only the current thumb-master may trigger a screen-thumb race,
        // and only one at a time. They count as the first (safe) tap. Everyone else
        // races; the last to tap (or who never taps) drinks. Auto-expires in tick().
        const me = room.players.find((p) => p.id === playerId);
        if (!me || me.name !== room.thumbMaster) return { error: "Alleen de duim-baas" };
        if (room.thumbRace) return { room };           // one round at a time
        room.thumbRace = { openAt: Date.now(), taps: [{ id: me.id, name: me.name, at: Date.now() }] };
        return { room };
      }
      case "thumbtap": {
        if (!room.thumbRace) return { room };
        const me = room.players.find((p) => p.id === playerId);
        if (me && !room.thumbRace.taps.some((t) => t.id === playerId)) room.thumbRace.taps.push({ id: playerId, name: me.name, at: Date.now() });
        return { room };
      }
      case "jufready": {
        const J = room.juf;
        if (!J || J.phase !== "ready") return { room };
        J.ready[playerId] = (payload && typeof payload.on === "boolean") ? payload.on : !J.ready[playerId];
        return { room };
      }
      case "jufstart": {
        if (!isHost) return { error: "Alleen de host kan starten" };
        const J = room.juf;
        if (!J || J.phase !== "ready") return { room };
        const conn = jufConnectedIds(room);
        if (conn.length < 1 || !conn.every((id) => J.ready[id])) return { error: "Nog niet iedereen is klaar" };
        J.phase = "playing"; J.count = 1; J.turnIndex = -1;
        jufAdvance(room);                 // lands turnIndex on the first connected player + arms the timer
        J.deadline = Date.now() + JUF_START_MS; // first turn gets the full window
        return { room };
      }
      case "jufanswer": {
        const J = room.juf;
        if (!J || J.phase !== "playing") return { room };
        if (J.order[J.turnIndex] !== playerId) return { error: "Niet jouw beurt" };
        const n = J.count;
        if (J.mode === "category" || J.mode === "rhyme") {
          // Categorie/Rijmen: a tap means "I named/rhymed one" — just pass it on.
          J.count = n + 1;
          jufAdvance(room);
        } else {
          const expected = jufIsJuf(n) ? "juf" : "number";
          const ans = (payload && payload.answer === "juf") ? "juf" : "number";
          if (ans === expected) { J.count = n + 1; jufAdvance(room); }
          else { jufLose(room, playerId, jufIsJuf(n) ? jufReasonCode(n) : "saidjuf", n); }
        }
        return { room };
      }
      case "rule": {
        if (!isTurn) return { error: "Niet jouw beurt" };
        const txt = cleanText(payload && payload.text);
        if (txt) { room.houseRules.push({ text: txt, by: cur.name }); room.pendingRule = false; room.ruleEndsAt = 0; }
        return { room };
      }
      case "removerule": {
        // Only offered while the active player is on a "new rule" card: instead of
        // inventing a rule they may strike an existing one. That counts as their move,
        // so it also satisfies the mandatory-rule prompt.
        if (!isTurn) return { error: "Niet jouw beurt" };
        const i = Number(payload && payload.index);
        if (Number.isInteger(i) && i >= 0 && i < room.houseRules.length) room.houseRules.splice(i, 1);
        room.pendingRule = false; room.ruleEndsAt = 0;
        return { room };
      }
      case "clearrules": {
        // active player declares "from now on, no rules apply" -> wipe them all
        // (their move on the new-rule card; clears the mandatory-rule prompt).
        if (!isTurn) return { error: "Niet jouw beurt" };
        room.houseRules = [];
        room.pendingRule = false; room.ruleEndsAt = 0;
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
        if (room.pendingKingShot) return { error: "Kies eerst wie drinkt" };
        if (room.juf && room.juf.phase !== "done") return { error: "JUF is bezig" };
        if (room.pendingRule) return { error: "Verzin eerst een regel" };
        room.flipped = false; room.card = null;
        room.timer = null;
        room.spinPick = null; room.spinGiver = null;
        room.pendingKingShot = false; room.kingShotTarget = null;
        room.race = null; room.chain = null; room.juf = null;
        advanceTurn(room);
        armTurn(room);
        return { room };
      }
      case "skip": {
        // host can force the turn forward when the active player is gone/offline
        // (e.g. a guest disconnected on their turn) so the game never freezes.
        if (!isHost) return { error: "Alleen de host kan overslaan" };
        room.flipped = false; room.card = null; room.timer = null;
        room.pendingBuddy = false; room.pendingRule = false; room.ruleEndsAt = 0;
        room.spinPick = null; room.spinGiver = null; room.pendingKingShot = false; room.kingShotTarget = null; room.race = null; room.chain = null; room.juf = null; room.thumbRace = null;
        advanceTurn(room);
        armTurn(room);
        return { room };
      }
      case "leave": {
        const p = room.players.find((x) => x.id === playerId);
        if (playerId === room.hostId) {
          // Host leaving = pause the room; 10s grace, then tick() closes it and
          // everyone is kicked. Keep the host in the list so they can rejoin.
          if (p) p.connected = false;
          if (room.started && !room.closed) { room.hostAwaySince = Date.now(); room.hostGraceMs = HOST_GRACE_MS; }
        } else {
          // A guest (invited player) leaving does NOT affect the room: remove
          // them entirely and fix the turn pointer so play continues.
          if (p) {
            room.lastLeft = { name: p.name, at: Date.now() };
            const idx = room.players.findIndex((x) => x.id === playerId);
            removePlayerAt(room, idx);
            armTurn(room);
          }
        }
        return { room };
      }
      case "restart": {
        if (!isHost) return { error: "Alleen de host kan herstarten" };
        room.started = false; room.gate = false; room.gateReady = {}; room.card = null; room.flipped = false;
        room.kings = 0; room.thumbMaster = null; room.questionMaster = null;
        room.pairs = []; room.houseRules = []; room.pendingBuddy = false;
        room.pendingRule = false; room.ruleEndsAt = 0; room.timer = null;
        room.spinPick = null; room.spinGiver = null; room.pendingKingShot = false; room.kingShotTarget = null; room.race = null; room.chain = null; room.juf = null; room.thumbRace = null;
        room.loser = null; room.turn = 0;
        room.turnEndsAt = 0; room.lastTimeout = null;
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
    // If the host drops while a game is in progress, start the (long) grace clock
    // so a mobile blip doesn't kill the room before the client reconnects.
    if (playerId === room.hostId && room.started && !room.closed && !room.hostAwaySince) {
      room.hostAwaySince = Date.now();
      room.hostGraceMs = HOST_DISCONNECT_GRACE_MS;
    }
    room.touchedAt = Date.now();
    return room;
  },

  // HTTP-polling keepalive: a poll/action marks the player present (lastSeen).
  // Mirrors a WS message arriving. Cancels the host-away clock if the host is back.
  touch(code, playerId) {
    const room = rooms.get((code || "").toUpperCase());
    if (!room) return null;
    const p = room.players.find((x) => x.id === playerId);
    if (p) { p.connected = true; p.lastSeen = Date.now(); }
    if (playerId === room.hostId) room.hostAwaySince = 0;
    room.touchedAt = Date.now();
    return room;
  },

  // Returns the list of rooms whose state changed this tick (host-grace expiry),
  // so the WS layer can broadcast the "closed" state to remaining players.
  tick() {
    const now = Date.now();
    const changed = [];
    tickCount++;
    const rebroadcast = tickCount % REBROADCAST_EVERY === 0;
    for (const [, room] of rooms) {
      if (room.hostAwaySince && !room.closed && now - room.hostAwaySince >= (room.hostGraceMs || HOST_GRACE_MS)) {
        room.closed = true;
        room.hostAwaySince = 0;
        room.rev = (room.rev || 0) + 1;
        changed.push(room);
      }
      // Polling players: mark gone if not seen within POLL_TIMEOUT_MS (each poll/
      // action touches lastSeen). WS players never set lastSeen, so they're
      // unaffected here (their connected flag is driven by socket open/close).
      for (const p of room.players) {
        if (p.lastSeen && p.connected && now - p.lastSeen > POLL_TIMEOUT_MS) {
          p.connected = false;
          room.rev = (room.rev || 0) + 1;
          if (p.id === room.hostId && room.started && !room.closed && !room.hostAwaySince) {
            room.hostAwaySince = now; room.hostGraceMs = HOST_DISCONNECT_GRACE_MS;
          }
          if (!changed.includes(room)) changed.push(room);
        }
      }
      // Periodic state heartbeat: re-push every active room so clients converge
      // to the server's truth even if they dropped a message (the game-over
      // broadcast is the last one — a dropped one would otherwise freeze them).
      if (rebroadcast && room.started && !room.closed && !changed.includes(room)) changed.push(room);
      // Turn auto-skip: the active player didn't draw within TURN_MS -> pass the
      // turn on and flag that they must take a sip/shot (was the manual host skip).
      if (room.started && !room.closed && !room.flipped && room.kings < 4 &&
          room.players.length >= 2 && room.turnEndsAt && now >= room.turnEndsAt) {
        const cur = room.players[room.turn];
        if (cur) room.lastTimeout = { name: cur.name, at: now };
        advanceTurn(room);
        armTurn(room);
        room.rev = (room.rev || 0) + 1;
        if (!changed.includes(room)) changed.push(room);
      }
      // Duimbaas A: a thumb-master race auto-clears ~14s after it opened (enough
      // to tap + read the reveal), so the role can trigger another one later.
      if (room.thumbRace && now > room.thumbRace.openAt + 14000) {
        room.thumbRace = null;
        room.rev = (room.rev || 0) + 1;
        if (!changed.includes(room)) changed.push(room);
      }
      // JUF: server-authoritative timer/lifecycle.
      if (room.juf) {
        const J = room.juf;
        if (J.phase === "playing" && J.deadline && now >= J.deadline) {
          jufLose(room, J.order[J.turnIndex], "slow", J.count);
          room.rev = (room.rev || 0) + 1;
          if (!changed.includes(room)) changed.push(room);
        } else if (J.phase === "over" && now >= J.overSince + JUF_OVER_MS) {
          J.phase = "done";
          room.rev = (room.rev || 0) + 1;
          if (!changed.includes(room)) changed.push(room);
        } else if (J.phase === "ready" && J.readyAt && now >= J.readyAt + JUF_READY_MAX_MS) {
          J.phase = "done";                 // safety: host never started -> don't freeze the card
          room.rev = (room.rev || 0) + 1;
          if (!changed.includes(room)) changed.push(room);
        }
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

function cleanName(n) { return String(n == null ? "" : n).replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, 18); }
function cleanText(n) { return String(n == null ? "" : n).replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, 80); }
// Avatar: only accept a small data:image URL (downscaled client-side); cap size.
function cleanAvatar(a) {
  if (typeof a !== "string") return "";
  if (!/^data:image\/(png|jpeg|webp);base64,/.test(a)) return "";
  return a.length <= 60000 ? a : "";
}

setInterval(() => roomEngine.reap(), 1000 * 60 * 10).unref?.();
