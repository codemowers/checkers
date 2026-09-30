import Redis from 'ioredis';

const key = Symbol.for('checkers.redis');
export function getRedis() {
  if (!globalThis[key]) {
    const client = new Redis(process.env.REDIS_URL ?? 'redis://checkers-redis:6379/0', {
      password: process.env.REDIS_PASSWORD,
      connectTimeout: 5000,
      commandTimeout: 5000,
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
      retryStrategy(attempt) { return Math.min(200 * attempt, 2000); },
    });
    client.on('error', error => console.error('Redis connection error:', error.message));
    globalThis[key] = client;
  }
  return globalThis[key];
}
export const GAME_KEY = id => `checkers:game:${id}`;
export const USERS_KEY = 'checkers:users';

export const SPECTATOR_KEY = auth => `checkers:spectators:${auth}`;
export const SPECTATOR_LEASE_MS = 45_000;
