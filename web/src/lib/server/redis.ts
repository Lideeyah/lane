import "server-only";
import { Redis } from "@upstash/redis";

/**
 * The only shared store in Lane. It holds short-lived pairing codes and rate
 * limit counters, never key material and never anything that can move money.
 * When it is not configured, features that need it say so and Lane carries on.
 */
let client: Redis | null | undefined;

export function redis(): Redis | null {
  if (client !== undefined) return client;
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  client = url && token ? new Redis({ url, token }) : null;
  return client;
}

/** Fixed-window counter. Returns false once `max` is reached inside the window. */
export async function allow(key: string, max: number, windowSeconds: number): Promise<boolean> {
  const r = redis();
  if (!r) return true;
  const n = await r.incr(`rl:${key}`);
  if (n === 1) await r.expire(`rl:${key}`, windowSeconds);
  return n <= max;
}

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}
