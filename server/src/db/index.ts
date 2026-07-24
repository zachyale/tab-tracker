import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { env } from "../env.js";
import * as schema from "./schema.js";

const sqlite = new Database(env.dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });

// Apply pending migrations on startup. Migrations are generated from
// src/db/schema.ts — edit the schema, run `npm run db:generate -w server`,
// and commit the emitted SQL in server/drizzle/.
const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../drizzle"
);
migrate(db, { migrationsFolder });

export { schema, sqlite };
