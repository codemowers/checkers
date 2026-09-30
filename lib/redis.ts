import { getRedis } from "../runtime/redis.mjs";
export { GAME_KEY, USERS_KEY, SPECTATOR_KEY } from "../runtime/redis.mjs";

export const redis = getRedis();
export const PRESENCE_KEY = "checkers:presence";
export const LOBBY_KEY = (ruleset: string) => `checkers:waiting:tables:${ruleset}`;
