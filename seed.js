/* Manually seed the DB with the example sets.  node seed.js
   (The server also auto-seeds on first boot when the table is empty.) */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { openDatabase } from "./db.js";
import { seedInto } from "./seedData.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.KINGSEN_DB || join(__dirname, "kingsen.db");
const { db } = await openDatabase(DB_PATH);
db.exec(`CREATE TABLE IF NOT EXISTS sets (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, author TEXT NOT NULL,
  lang TEXT NOT NULL DEFAULT 'nl', code TEXT NOT NULL,
  uses INTEGER NOT NULL DEFAULT 0, likes INTEGER NOT NULL DEFAULT 0,
  reports INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, client_id TEXT
);`);

const n = seedInto(db);
console.log(`Seeded ${n} set(s) into ${DB_PATH}`);
