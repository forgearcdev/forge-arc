/**
 * RPC rate limiter — concurrent-safe via slot reservation.
 *
 * **Why we need this.** Arc's public RPC is capped at ~100 req/sec.
 * viem's internal retry (default `retryCount: 2`, configured higher
 * in some chains) can multiply our outbound calls under flaky
 * conditions. On a cold backfill of ~270k blocks we'd issue tens of
 * thousands of getLogs + getBlock calls; without a self-imposed
 * ceiling we trip 429 throttling fast.
 *
 * **Design.** Each `acquire()` call atomically reserves the NEXT
 * timeslot, advancing a shared `nextAvailableAt` cursor. Concurrent
 * `Promise.all([acquire, acquire, acquire])` get distinct slots
 * spaced `minDelayMs` apart — no two RPC calls fire within the same
 * minimum-interval window. A naive "sleep before each call" approach
 * fails here because Node's event loop interleaves the `Date.now()`
 * reads, and concurrent acquires would all observe the same
 * lastCallAt.
 *
 * **Disabling.** Set `MAX_RPC_REQS_PER_SEC` very high (e.g. 10000)
 * for effectively-no-throttling — minDelayMs becomes 0.1ms which
 * the event loop swallows. Useful when running against a private
 * RPC with no rate cap.
 */

import { log } from "./log.js";

export class RateLimiter {
  /** Minimum delay between successive RPC calls, in milliseconds. */
  private readonly minDelayMs: number;
  /** Monotonic timestamp of the next available slot. */
  private nextAvailableAt = 0;

  constructor(reqsPerSec: number) {
    if (!isFinite(reqsPerSec) || reqsPerSec <= 0) {
      throw new Error(
        `RateLimiter: reqsPerSec must be positive finite, got ${reqsPerSec}`,
      );
    }
    this.minDelayMs = 1000 / reqsPerSec;
  }

  /**
   * Reserve the next slot. Resolves either immediately (if no
   * recent call) or after sleeping until the reserved slot.
   *
   * The slot reservation (`nextAvailableAt = scheduledAt + minDelayMs`)
   * happens SYNCHRONOUSLY before any `await`, which is what makes
   * this safe under `Promise.all` — each call gets its own slot
   * atomically.
   */
  async acquire(): Promise<void> {
    const now = Date.now();
    const scheduledAt = Math.max(now, this.nextAvailableAt);
    this.nextAvailableAt = scheduledAt + this.minDelayMs;
    const waitMs = scheduledAt - now;
    if (waitMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
    }
  }
}

/* ─── Singleton ───────────────────────────────────────────────────── */

function resolveReqsPerSec(): number {
  const raw = process.env.MAX_RPC_REQS_PER_SEC;
  if (!raw) return 30;
  const n = Number(raw);
  if (!isFinite(n) || n <= 0) {
    log("warn", `invalid MAX_RPC_REQS_PER_SEC=${raw}, falling back to 30`);
    return 30;
  }
  return n;
}

/**
 * Module-scoped singleton. All RPC call sites in the indexer call
 * `await rpcRateLimit.acquire()` before issuing a request. Created
 * lazily on first import so the env var is read after dotenv loads.
 */
let _rpcRateLimit: RateLimiter | null = null;
export function rpcRateLimit(): RateLimiter {
  if (!_rpcRateLimit) {
    const reqsPerSec = resolveReqsPerSec();
    _rpcRateLimit = new RateLimiter(reqsPerSec);
    log("info", `RPC rate limiter active at ${reqsPerSec} req/sec`);
  }
  return _rpcRateLimit;
}
