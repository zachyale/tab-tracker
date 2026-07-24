import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { env } from "../env.js";
import * as schema from "./schema.js";

const sqlite = new Database(env.dbPath);
sqlite.pragma("journal_mode = WAL");

export const db = drizzle(sqlite, { schema });

// Apply pending migrations on startup. Migrations are generated from
// src/db/schema.ts — edit the schema, run `npm run db:generate -w server`,
// and commit the emitted SQL in server/drizzle/.
// Foreign keys must be OFF at the connection level while migrating
// (better-sqlite3 defaults them ON, and the PRAGMA statements inside a
// migration are no-ops within the migrator's transaction) — table rebuilds
// would otherwise trip FK constraints from the ledger.
const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../drizzle"
);
sqlite.pragma("foreign_keys = OFF");
migrate(db, { migrationsFolder });
sqlite.pragma("foreign_keys = ON");

export { schema, sqlite };
