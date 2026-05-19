/**
 * Drizzle DB client. Used by every handler in src/indexer/handlers/
 * and every route in src/api/routes/.
 *
 * Single connection (postgres.js handles internal pooling). Importing
 * this module fails-fast if DATABASE_URL is missing — better than
 * lazily blowing up on the first query.
 */

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Copy backend/.env.example to backend/.env and fill it in.",
  );
}

/**
 * Underlying postgres.js client. Exposed for cases where you need
 * raw SQL (e.g. notify/listen channels) — prefer `db` for everything
 * else.
 */
export const sql = postgres(connectionString);

/**
 * Drizzle wrapper with full schema awareness — supports `db.query.jobs.findMany`
 * style queries thanks to the `schema` arg.
 */
export const db = drizzle(sql, { schema });
