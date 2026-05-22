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

export const ratelimit = {
  limit: (id: string) => getRatelimit().limit(id),
};
