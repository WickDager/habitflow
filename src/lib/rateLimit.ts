import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

let ratelimitInstance: Ratelimit | null = null;

function getRatelimit() {
  if (!ratelimitInstance) {
    ratelimitInstance = new Ratelimit({
      redis: Redis.fromEnv(),
      limiter: Ratelimit.slidingWindow(30, "1 m"),
    });
  }
  return ratelimitInstance;
}

/**
 * Fail-open by design.
 *
 * This used to be called straight from withAuth's try block, so any Redis
 * problem -- a deleted database, exhausted free-tier quota, a bad token --
 * threw, got swallowed by the outer catch, and turned into a 500 on *every*
 * authenticated request. Rate limiting is abuse protection, not a core
 * dependency; losing it must never take the app down with it.
 *
 * `degraded: true` means the check did not run, so callers can log it.
 */
export const ratelimit = {
  async limit(id: string): Promise<{ success: boolean; degraded: boolean }> {
    try {
      const { success } = await getRatelimit().limit(id);
      return { success, degraded: false };
    } catch (err) {
      console.error("rateLimit unavailable, allowing request:", err);
      return { success: true, degraded: true };
    }
  },
};
