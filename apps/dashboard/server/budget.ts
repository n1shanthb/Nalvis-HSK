import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import { z } from 'zod';
export type Env = Record<string, string | undefined>;
export const creditsSchema = z
  .object({
    remaining: z.number().int().nonnegative(),
    globalRemaining: z.number().int().nonnegative(),
    resetAt: z.number().int().positive(),
    retryAfter: z.number().int().nonnegative(),
  })
  .strict();
export type Credits = z.infer<typeof creditsSchema>;
export type BudgetResult = { allowed: boolean; credits: Credits };
export interface BudgetStore {
  check(identity: string, consume: boolean): Promise<BudgetResult>;
}
// One EVAL atomically checks all four windows and reserves a provider call.
// Redis TIME, not function clocks, defines the windows across every instance.
export const budgetScript = `
local now = tonumber(redis.call('TIME')[1])
local windows = {60,60,86400,86400}
local counts = {}
local buckets = {}
local allowed = 1
local retry = 0
for i=1,4 do
  buckets[i] = math.floor(now/windows[i])
  local old = redis.call('HMGET',KEYS[i],'bucket','count')
  counts[i] = 0
  if tonumber(old[1]) == buckets[i] then counts[i] = tonumber(old[2]) or 0 end
  if counts[i] >= tonumber(ARGV[i]) then
    allowed = 0
    retry = math.max(retry,(buckets[i]+1)*windows[i]-now)
  end
end
if allowed == 1 and ARGV[5] == '1' then
  for i=1,4 do
    counts[i] = counts[i]+1
    redis.call('HSET',KEYS[i],'bucket',buckets[i],'count',counts[i])
    redis.call('EXPIRE',KEYS[i],windows[i]*2)
  end
end
return {allowed,math.max(0,tonumber(ARGV[3])-counts[3]),math.max(0,tonumber(ARGV[4])-counts[4]),(buckets[3]+1)*86400,retry}
`;
export function clientIdentity(
  request: Request,
  env: Env,
  peerIp?: string,
): string | undefined {
  // Only trust Vercel's overwritten header on Vercel. Local Vite passes the
  // transport peer separately; arbitrary forwarded headers are never a fallback.
  let ip =
    env.VERCEL === '1' ? request.headers.get('x-vercel-forwarded-for') : peerIp;
  if (typeof ip !== 'string') return;
  if (ip.startsWith('::ffff:') && isIP(ip.slice(7)) === 4) ip = ip.slice(7);
  if (
    !ip ||
    !isIP(ip) ||
    !env.DESK_IP_HASH_SECRET ||
    env.DESK_IP_HASH_SECRET.length < 32
  )
    return;
  return createHmac('sha256', env.DESK_IP_HASH_SECRET)
    .update(ip.toLowerCase())
    .digest('hex');
}
export function createBudgetStore(
  env: Env,
  send: typeof fetch = fetch,
): BudgetStore | undefined {
  const endpoint = env.UPSTASH_REDIS_REST_URL ?? env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN ?? env.KV_REST_API_TOKEN;
  if (
    !endpoint ||
    !token ||
    !env.DESK_IP_HASH_SECRET ||
    env.DESK_IP_HASH_SECRET.length < 32
  )
    return;
  let url: URL;
  try {
    url = new URL(endpoint);
    if (
      url.protocol !== 'https:' ||
      !url.hostname.endsWith('.upstash.io') ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      return;
  } catch {
    return;
  }
  const names = [
    'DESK_AI_IP_PER_MINUTE',
    'DESK_AI_GLOBAL_PER_MINUTE',
    'DESK_AI_IP_DAILY_CREDITS',
    'DESK_AI_GLOBAL_DAILY_CAP',
  ];
  const defaults = [5, 30, 20, 200];
  const limits = names.map((name, i) =>
    env[name] === undefined ? defaults[i] : Number(env[name]),
  );
  if (limits.some((n) => !Number.isSafeInteger(n) || n < 1 || n > 100000))
    return;
  return {
    async check(identity, consume) {
      if (!/^[a-f0-9]{64}$/.test(identity))
        throw Error('Invalid budget identity');
      const prefix = '{nalvis-desk-v1}';
      const response = await send(url.href, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([
          'EVAL',
          budgetScript,
          4,
          `${prefix}:ip:${identity}:minute`,
          `${prefix}:global:minute`,
          `${prefix}:ip:${identity}:day`,
          `${prefix}:global:day`,
          ...limits.map(String),
          consume ? '1' : '0',
        ]),
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) throw Error('Shared budget unavailable');
      const result = z
        .object({
          result: z.tuple([
            z.union([z.literal(0), z.literal(1)]),
            z.number().int().nonnegative(),
            z.number().int().nonnegative(),
            z.number().int().positive(),
            z.number().int().nonnegative(),
          ]),
        })
        .strict()
        .parse(await response.json()).result;
      return {
        allowed: result[0] === 1,
        credits: {
          remaining: result[1],
          globalRemaining: result[2],
          resetAt: result[3],
          retryAfter: result[4],
        },
      };
    },
  };
}
