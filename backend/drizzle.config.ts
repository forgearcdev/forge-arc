import "dotenv/config";
import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit config — used by `pnpm db:generate` (schema → SQL),
 * `pnpm db:migrate` (apply SQL to live DB), `pnpm db:studio` (UI).
 *
 * The DATABASE_URL fallback exists only so `db:generate` works in CI
 * or fresh checkouts before `.env` is set up — generation doesn't
 * actually need a live connection. `db:migrate` and `db:studio` will
 * fail loudly without a real connection string, which is the right
 * behavior.
 */
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgresql://localhost:5432/forge_indexer",
  },
  // Verbose output so the generated SQL is easy to spot-check in CI logs.
  verbose: true,
  // Strict mode catches schema-vs-snapshot drifts before they ship.
  strict: true,
});
