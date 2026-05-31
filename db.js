/* ------------------------------------------------------------------ */
/*  Pluggable SQLite layer.                                             */
/*                                                                      */
/*  Prefers better-sqlite3 (fast, battle-tested, prebuilt binary on    */
/*  Node 20 — what the Hetzner deploy uses). Falls back to the built-in */
/*  node:sqlite (Node 22.5+) so the server runs with ZERO native deps   */
/*  / no compile step anywhere modern.                                  */
/*                                                                      */
/*  Both are normalized to the same surface the server uses:            */
/*    db.exec(sql)                                                      */
/*    db.prepare(sql).run(...args | obj)  -> { changes }                */
/*    db.prepare(sql).get(...args)        -> row | undefined            */
/*    db.prepare(sql).all(...args)        -> row[]                      */
/*    db.transaction(fn) -> () => fn()                                  */
/* ------------------------------------------------------------------ */

export async function openDatabase(path) {
  // 1) better-sqlite3
  try {
    const mod = await importDefault("better-sqlite3");
    if (mod) {
      const db = new mod(path);
      db.pragma("journal_mode = WAL");
      return { db, engine: "better-sqlite3" };
    }
  } catch {
    /* fall through */
  }

  // 2) node:sqlite (built-in)
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const raw = new DatabaseSync(path);
    try { raw.exec("PRAGMA journal_mode = WAL;"); } catch { /* ignore */ }
    return { db: wrapNodeSqlite(raw), engine: "node:sqlite" };
  } catch (e) {
    throw new Error(
      "No SQLite engine available. Install 'better-sqlite3' (npm install) " +
      "or run on Node 22.5+ which includes node:sqlite. Original: " + e.message
    );
  }
}

// top-level await isn't allowed in a sync function, so do dynamic import eagerly
async function importDefault(name) {
  const m = await import(name);
  return m.default || m;
}

/* node:sqlite normalizer.
   node:sqlite's StatementSync.run/get/all accept positional args or a single
   object for named (@foo) params — same call shapes better-sqlite3 uses here,
   so we mostly pass through. run() returns { changes, lastInsertRowid }. */
function wrapNodeSqlite(raw) {
  return {
    exec(sql) { raw.exec(sql); },
    prepare(sql) {
      const stmt = raw.prepare(sql);
      // node:sqlite binds a lone plain object as NAMED params (@foo), and
      // spread values as POSITIONAL (?) params — same as better-sqlite3.
      // An array must be spread, NOT passed as one arg (that becomes {0:..}).
      const call = (fn, args) => {
        if (args.length === 1 && isPlainObject(args[0])) return fn(args[0]);
        return fn(...args);
      };
      return {
        run(...args) {
          const r = call((...a) => stmt.run(...a), args);
          return { changes: Number(r && r.changes != null ? r.changes : 0) };
        },
        get(...args) { return call((...a) => stmt.get(...a), args); },
        all(...args) { return call((...a) => stmt.all(...a), args); },
      };
    },
    transaction(fn) {
      // mirror better-sqlite3's db.transaction(fn) -> wrapped fn
      return (...args) => {
        raw.exec("BEGIN");
        try {
          const out = fn(...args);
          raw.exec("COMMIT");
          return out;
        } catch (e) {
          try { raw.exec("ROLLBACK"); } catch { /* ignore */ }
          throw e;
        }
      };
    },
  };
}

function isPlainObject(v) {
  return v != null && typeof v === "object" && !Array.isArray(v);
}
