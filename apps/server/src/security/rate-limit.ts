export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

interface CounterState {
  hits: number;
  resetAt: number;
}

export class MemoryRateLimiter {
  private counters = new Map<string, CounterState>();

  consume(key: string, limit: number, windowMs: number): RateLimitResult {
    const now = Date.now();
    const current = this.counters.get(key);

    if (!current || current.resetAt <= now) {
      this.counters.set(key, {
        hits: 1,
        resetAt: now + windowMs
      });

      this.gc(now);

      return {
        allowed: true,
        remaining: limit - 1,
        retryAfterMs: 0
      };
    }

    current.hits += 1;
    this.counters.set(key, current);
    this.gc(now);

    return {
      allowed: current.hits <= limit,
      remaining: Math.max(0, limit - current.hits),
      retryAfterMs: current.hits <= limit ? 0 : current.resetAt - now
    };
  }

  private gc(now: number): void {
    if (this.counters.size < 500) {
      return;
    }

    for (const [key, value] of this.counters.entries()) {
      if (value.resetAt <= now) {
        this.counters.delete(key);
      }
    }
  }
}
