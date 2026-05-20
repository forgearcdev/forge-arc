/**
 * Indexer error taxonomy.
 *
 * The main loop classifies errors into two buckets:
 *
 *   IndexerDatabaseError       → FATAL, process.exit(1). Indicates a
 *                                real DB problem (syntax, constraint
 *                                violation, missing table). Re-running
 *                                without operator intervention will
 *                                produce the same failure.
 *
 *   TransientConnectionError   → RETRIABLE, backoff + retry. Indicates
 *                                a transient network issue (Neon
 *                                auto-pause, DNS hiccup, brief packet
 *                                loss). The next attempt typically
 *                                succeeds.
 *
 * All DB call sites wrap their try/catch in `classifyDbError(err, ctx)`
 * which inspects the error chain and returns the appropriate class.
 * Recursive walk of `err.cause` is required because postgres.js often
 * wraps the underlying socket error in a generic Error.
 */

const TRANSIENT_CODES: ReadonlySet<string> = new Set([
  "ECONNRESET", // Neon auto-pause, TCP RST, peer closed connection
  "ETIMEDOUT", // Socket idle timeout
  "ENOTFOUND", // Transient DNS lookup failure
  "EAI_AGAIN", // Transient DNS resolver failure (most common)
  "ECONNREFUSED", // Postgres restarting, port not yet bound
  "EPIPE", // Write to a half-closed socket
  "ENETUNREACH", // Transient routing issue
]);

const TRANSIENT_MESSAGE_FRAGMENTS: readonly string[] = [
  "connection terminated",
  "connection ended",
  "connection closed",
  "connection reset",
  "socket hang up",
  "connect timeout",
  "server has gone away", // Neon may emit this when compute auto-pauses
  "too many connections", // burst during scale events / pooler saturation
];

/**
 * Walks `err.cause` recursively to find any layer matching a transient
 * connection signature. Returns true on first match.
 *
 * postgres.js wraps the underlying socket error in its own Error class
 * with the original at `.cause` — without recursive walking we'd miss
 * the ECONNRESET that triggered the wrapper.
 */
export function isTransientConnectionError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; message?: unknown; cause?: unknown };

  if (typeof e.code === "string" && TRANSIENT_CODES.has(e.code)) {
    return true;
  }

  if (typeof e.message === "string") {
    const lower = e.message.toLowerCase();
    for (const frag of TRANSIENT_MESSAGE_FRAGMENTS) {
      if (lower.includes(frag)) return true;
    }
  }

  if (e.cause) {
    return isTransientConnectionError(e.cause);
  }
  return false;
}

/* ─── Error classes ───────────────────────────────────────────────── */

/**
 * Fatal DB error. Main loop catches this specifically and exits with
 * code 1 — operator intervention required (likely a schema mismatch,
 * constraint violation, or genuine Postgres outage).
 */
export class IndexerDatabaseError extends Error {
  override name = "IndexerDatabaseError";
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

/**
 * Retriable connection error. Main loop catches this and applies
 * exponential backoff — same retry path as RPC errors.
 *
 * Common cause on Neon: the compute auto-pauses after ~5 minutes of
 * idle. The first query after wake-up fails with ECONNRESET as the
 * stale socket gets torn down. The driver opens a new connection on
 * the next attempt, which succeeds.
 */
export class TransientConnectionError extends Error {
  override name = "TransientConnectionError";
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

/* ─── Classifier ──────────────────────────────────────────────────── */

/**
 * Wrap a raw DB error into the appropriate indexer-side class.
 * Call sites use:
 *
 *   try { await tx.insert(...).values(...) }
 *   catch (err) { throw classifyDbError(err, "INSERT jobs (jobId=N)"); }
 *
 * Returns the wrapped error; caller decides to throw.
 */
export function classifyDbError(
  err: unknown,
  context: string,
): IndexerDatabaseError | TransientConnectionError {
  if (isTransientConnectionError(err)) {
    return new TransientConnectionError(`${context}: transient connection error`, {
      cause: err,
    });
  }
  return new IndexerDatabaseError(`${context}: ${describeError(err)}`, {
    cause: err,
  });
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/* ─── Neon detection (advisory) ───────────────────────────────────── */

/**
 * Heuristic: DATABASE_URL host contains "neon.tech" → likely a Neon
 * project. Used purely for a startup info log; behavior is identical
 * for any Postgres provider.
 */
export function isNeonDatabaseUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname;
    return host.includes("neon.tech");
  } catch {
    // Not a valid URL — caller probably has bigger problems.
    return false;
  }
}
