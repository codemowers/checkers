import Redis from "ioredis";

const globalRedis = globalThis as unknown as { redis?: Redis };

function createRedis() {
  const client = new Redis(process.env.REDIS_URL ?? "redis://checkers-redis:6379/0", {
    connectTimeout: 5_000,
    lazyConnect: true,
    maxRetriesPerRequest: 10,
    enableReadyCheck: true,
    retryStrategy(attempt) { return Math.min(200 * attempt, 2_000); },
  });
  client.on("error", (error: NodeJS.ErrnoException) => {
    // Docker's embedded DNS can briefly return EAI_AGAIN while Compose is
    // attaching containers. ioredis retries it; it is not an application error.
    if (error.code !== "EAI_AGAIN") console.error("Redis connection error:", error.message);
  });
  return client;
}

export const redis = globalRedis.redis ?? createRedis();

if (process.env.NODE_ENV !== "production") globalRedis.redis = redis;

export const GAME_KEY = (id: string) => `checkers:game:${id}`;
export const PRESENCE_KEY = "checkers:presence";
export const USERS_KEY = "checkers:users";
export const WAITING_KEY = "checkers:waiting";
