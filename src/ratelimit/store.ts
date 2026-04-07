/**
 * Rate limit state store.
 * Uses Redis when REDIS_URL is set, otherwise falls back to LRU in-memory cache.
 * All operations are async to keep the interface consistent.
 */

import { LRUCache } from "lru-cache";
import type { RateLimitState } from "../types/provider.js";

const REDIS_KEY_PREFIX = "llmux:rl:";
const TTL_SECONDS = 90000; // 25 hours — covers a full day window + buffer

export interface IRateLimitStore {
  get(providerId: string): Promise<RateLimitState | null>;
  set(providerId: string, state: RateLimitState): Promise<void>;
  delete(providerId: string): Promise<void>;
  close(): Promise<void>;
}

// ── In-memory store ───────────────────────────────────────────────────────────

class MemoryRateLimitStore implements IRateLimitStore {
  private cache: LRUCache<string, RateLimitState>;

  constructor() {
    this.cache = new LRUCache<string, RateLimitState>({
      max: 500,
      ttl: TTL_SECONDS * 1000,
    });
  }

  async get(providerId: string): Promise<RateLimitState | null> {
    return this.cache.get(providerId) ?? null;
  }

  async set(providerId: string, state: RateLimitState): Promise<void> {
    this.cache.set(providerId, state);
  }

  async delete(providerId: string): Promise<void> {
    this.cache.delete(providerId);
  }

  async close(): Promise<void> {
    this.cache.clear();
  }
}

// ── Redis store ───────────────────────────────────────────────────────────────

class RedisRateLimitStore implements IRateLimitStore {
  private client: import("ioredis").Redis;

  constructor(client: import("ioredis").Redis) {
    this.client = client;
  }

  async get(providerId: string): Promise<RateLimitState | null> {
    const raw = await this.client.get(`${REDIS_KEY_PREFIX}${providerId}`);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as RateLimitState;
    } catch {
      return null;
    }
  }

  async set(providerId: string, state: RateLimitState): Promise<void> {
    await this.client.setex(
      `${REDIS_KEY_PREFIX}${providerId}`,
      TTL_SECONDS,
      JSON.stringify(state)
    );
  }

  async delete(providerId: string): Promise<void> {
    await this.client.del(`${REDIS_KEY_PREFIX}${providerId}`);
  }

  async close(): Promise<void> {
    await this.client.quit();
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

let _store: IRateLimitStore | null = null;

export async function getRateLimitStore(): Promise<IRateLimitStore> {
  if (_store) return _store;

  const redisUrl = process.env["REDIS_URL"];
  if (redisUrl) {
    try {
      const { default: Redis } = await import("ioredis");
      const client = new Redis(redisUrl, {
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        connectTimeout: 3000,
      });
      await client.connect();
      _store = new RedisRateLimitStore(client);
      return _store;
    } catch (err) {
      console.warn(
        `[LLMux] Redis connection failed (${(err as Error).message}), using in-memory store.`
      );
    }
  }

  _store = new MemoryRateLimitStore();
  return _store;
}

export async function closeStore(): Promise<void> {
  if (_store) {
    await _store.close();
    _store = null;
  }
}
