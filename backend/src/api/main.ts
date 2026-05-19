/**
 * Hono REST API entry point — Phase 6.3-A scaffold.
 *
 * Real endpoints (jobs, agents, payments) land in Phase D. For now
 * we expose only /health, so the deploy in Phase E can verify
 * "the process is up" without depending on indexer state.
 *
 * Run via `pnpm api:dev` (tsx watch) or `pnpm api:start` (one-shot).
 */

import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";

const app = new Hono();

app.get("/", (c) =>
  c.json({
    ok: true,
    service: "forge-indexer-api",
    phase: "6.3-A scaffold",
  }),
);

app.get("/health", (c) => c.json({ status: "ok" }));

const port = Number(process.env.PORT ?? 3001);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[api] listening on http://localhost:${info.port}`);
});

// Default export keeps the module testable (we can import `app` directly
// in tests once we add Vitest in a later phase).
export default app;
