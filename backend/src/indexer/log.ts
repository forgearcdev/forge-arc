/**
 * Tiny shared logger. Same surface used by `main.ts`, `logs.ts`, and
 * (transitively) any other indexer module that wants a tagged line.
 *
 * Format: `[indexer] [<ISO timestamp>] [<level>] <msg>` plus an
 * optional structured extra. Trivial enough that swapping to pino
 * later is a 5-line change at the call sites.
 */

type LogLevel = "info" | "warn" | "error";

export function log(level: LogLevel, msg: string, extra?: unknown): void {
  const ts = new Date().toISOString();
  const line = `[indexer] [${ts}] [${level}] ${msg}`;
  if (extra !== undefined) {
    console.log(line, extra);
  } else {
    console.log(line);
  }
}
