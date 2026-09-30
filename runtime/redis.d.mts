import type Redis from 'ioredis';
export function getRedis(): Redis;
export function GAME_KEY(id: string): string;
export const USERS_KEY: string;
export function SPECTATOR_KEY(auth: 'anonymous' | 'authenticated'): string;
export const SPECTATOR_LEASE_MS: number;
