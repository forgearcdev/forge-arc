/**
 * Indexer entry point — Phase 6.3-C.1 (loop scaffold).
 *
 * Responsibilities:
 *   - Set up structured logging.
 *   - Install SIGTERM/SIGINT handlers for graceful shutdown.
 *   - Drive `pollOnce` on a configurable interval.
 *   - Categorize errors: IndexerDatabaseError → fatal (process.exit);
 *     anything else → retriable with exponential backoff.
 *
 * Phase C.1 status: handlers + log fetch are TODO stubs inside
 * `poller.ts`. This file is otherwise production-shape — signal
 * handling, error categorization, backoff, and DB cleanup are all
 * real. Phase C.5 is the first runnable end-to-end target.
 *
 * Run via:
 *   pnpm dev   — tsx watch (auto-reload on save)
 *   pnpm start — node --import tsx/esm (one-shot)
 */

import "dotenv/config";
import { pollOnce, type PollResult } from "./poller.js";
import { IndexerDatabaseError } from "./cursor.js";
import { sql } from "../db/client.js";

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? "5000");

/** Cap on backoff between retries — at 2^6 × 5s = 320s, we'd be way past useful. */
const MAX_BACKOFF_MS = 60_000;

/** AbortController used to wake `sleep` early when a shutdown signal arrives. */
const ac = new AbortController();
let shuttingDown = false;

/* ─── Tiny tagged logger ──────────────────────────────────────────── */

type LogLevel = "info" | "warn" | "error";

function log(level: LogLevel, msg: string, extra?: unknown): void {
  const ts = new Date().toISOString();
  const line = `[indexer] [${ts}] [${level}] ${msg}`;
  if (extra !== undefined) {
    console.log(line, extra);
  } else {
    console.log(line);
  }
}

/* ─── Sleep that wakes on AbortSignal ─────────────────────────────── */

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/* ─── Signal handling ─────────────────────────────────────────────── */

function setupSignalHandlers(): void {
  const handler = (sig: NodeJS.Signals): void => {
    if (shuttingDown) {
      // Second Ctrl-C in a row — operator wants out NOW.
      log("warn", `received second ${sig}, forcing immediate exit`);
      process.exit(130);
    }
    log("info", `received ${sig}, draining current poll and shutting down`);
    shuttingDown = true;
    ac.abort();
  };
  process.on("SIGTERM", () => handler("SIGTERM"));
  process.on("SIGINT", () => handler("SIGINT"));
}

/* ─── Main polling loop ───────────────────────────────────────────── */

async function loop(): Promise<void> {
  let consecutiveErrors = 0;

  while (!shuttingDown) {
    try {
      const result: PollResult = await pollOnce();
      consecutiveErrors = 0;

      // Log only when we made progress; a steady-state caught-up indexer
      // would otherwise spam a "0 events" line every POLL_INTERVAL.
      if (result.toCursor > result.fromCursor) {
        log(
          "info",
          `processed blocks ${(result.fromCursor + 1n).toString()}..${result.toCursor.toString()} ` +
            `(${result.eventsProcessed} dispatched, ${result.eventsIgnored} ignored, ` +
            `${result.logsUndecoded} undecoded, ${result.durationMs}ms, ` +
            `head=${result.chainHead.toString()})`,
        );
      }
    } catch (err) {
      // DB errors are fatal per the project design ("fail loud, never
      // skip events"). Anything else (RPC, decode, network) is assumed
      // transient and retried with exponential backoff.
      if (err instanceof IndexerDatabaseError) {
        log("error", "DB error — fatal, exiting", err);
        process.exit(1);
      }

      consecutiveErrors++;
      const exponent = Math.min(consecutiveErrors, 6); // cap at 2^6 multiplier
      const backoff = Math.min(MAX_BACKOFF_MS, POLL_INTERVAL_MS * 2 ** exponent);
      log(
        "warn",
        `transient error (attempt ${consecutiveErrors}), retrying in ${backoff}ms`,
        err,
      );
      await sleep(backoff, ac.signal);
      continue;
    }

    // Normal inter-poll wait. Wakes early on shutdown.
    await sleep(POLL_INTERVAL_MS, ac.signal);
  }

  // Drained out of the loop. Close DB connection cleanly so postgres.js
  // doesn't leave dangling sockets.
  log("info", "loop exited, closing DB connection");
  try {
    await sql.end({ timeout: 5 });
  } catch (err) {
    log("warn", "DB close raised (ignoring during shutdown)", err);
  }
  log("info", "indexer stopped");
  process.exit(0);
}

/* ─── Entry ────────────────────────────────────────────────────────── */

async function main(): Promise<void> {
  log("info", "starting indexer (Phase 6.3-C complete)");
  log("info", `  POLL_INTERVAL_MS = ${POLL_INTERVAL_MS}`);
  log("info", `  ARC_RPC_URL      = ${process.env.ARC_RPC_URL ?? "(default)"}`);
  log("info", `  DATABASE_URL     = ${process.env.DATABASE_URL ? "set" : "MISSING"}`);
  setupSignalHandlers();
  await loop();
}

main().catch((err) => {
  log("error", "fatal in main", err);
  process.exit(1);
});
