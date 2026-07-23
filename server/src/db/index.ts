import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { env } from "../env.js";
import * as schema from "./schema.js";

const sqlite = new Database(env.dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

// Idempotent bootstrap creates the LATEST schema; the numbered migrations
// below (keyed off the user_version pragma) upgrade databases created by
// older versions. Bump SCHEMA_VERSION whenever either changes.
const SCHEMA_VERSION = 1;

sqlite.exec(`
CREATE TABLE IF NOT EXISTS user (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  email_verified INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  is_ghost INTEGER NOT NULL DEFAULT 0,
  claim_email TEXT,
  ghost_account_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL,
  token TEXT NOT NULL UNIQUE,
  ip_address TEXT,
  user_agent TEXT,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS account (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  access_token TEXT,
  refresh_token TEXT,
  id_token TEXT,
  access_token_expires_at INTEGER,
  refresh_token_expires_at INTEGER,
  scope TEXT,
  password TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS verification (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS tab_account (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  slug TEXT NOT NULL UNIQUE,
  currency TEXT NOT NULL DEFAULT 'USD',
  owner_id TEXT NOT NULL REFERENCES user(id),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS account_manager (
  account_id TEXT NOT NULL REFERENCES tab_account(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, user_id)
);

CREATE TABLE IF NOT EXISTS option (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES tab_account(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_cents INTEGER,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS option_account_idx ON option(account_id);

CREATE TABLE IF NOT EXISTS entry (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES tab_account(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id),
  actor_id TEXT NOT NULL REFERENCES user(id),
  kind TEXT NOT NULL CHECK (kind IN ('consume','undo','payment','charge')),
  option_id TEXT REFERENCES option(id),
  amount_cents INTEGER,
  note TEXT,
  reverses_entry_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS entry_account_idx ON entry(account_id);
CREATE INDEX IF NOT EXISTS entry_account_user_idx ON entry(account_id, user_id);
`);

// ---------------------------------------------------------------------------
// Migrations for databases created before the current schema version.
// Fresh databases already have the latest shape from the bootstrap above.
// ---------------------------------------------------------------------------

const version = sqlite.pragma("user_version", { simple: true }) as number;

if (version < 1) {
  const userCols = (
    sqlite.prepare("SELECT name FROM pragma_table_info('user')").all() as { name: string }[]
  ).map((r) => r.name);
  if (!userCols.includes("is_ghost")) {
    sqlite.exec(`
      ALTER TABLE user ADD COLUMN is_ghost INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE user ADD COLUMN claim_email TEXT;
      ALTER TABLE user ADD COLUMN ghost_account_id TEXT;
    `);
  }

  // Rebuild entry to widen the kind CHECK constraint to include 'charge'.
  const entrySql =
    (
      sqlite
        .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'entry'")
        .get() as { sql: string } | undefined
    )?.sql ?? "";
  if (!entrySql.includes("'charge'")) {
    sqlite.pragma("foreign_keys = OFF");
    sqlite.exec(`
      BEGIN;
      CREATE TABLE entry_new (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES tab_account(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES user(id),
        actor_id TEXT NOT NULL REFERENCES user(id),
        kind TEXT NOT NULL CHECK (kind IN ('consume','undo','payment','charge')),
        option_id TEXT REFERENCES option(id),
        amount_cents INTEGER,
        note TEXT,
        reverses_entry_id TEXT,
        created_at INTEGER NOT NULL
      );
      INSERT INTO entry_new SELECT * FROM entry;
      DROP TABLE entry;
      ALTER TABLE entry_new RENAME TO entry;
      CREATE INDEX entry_account_idx ON entry(account_id);
      CREATE INDEX entry_account_user_idx ON entry(account_id, user_id);
      COMMIT;
    `);
    sqlite.pragma("foreign_keys = ON");
  }
}

sqlite.pragma(`user_version = ${SCHEMA_VERSION}`);

export const db = drizzle(sqlite, { schema });
export { schema, sqlite };
