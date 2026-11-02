import { z } from 'zod';
import {
  signedSellOrderSchema,
  sellOrderId,
  type SignedSellOrder,
} from './copilot.js';
const prefix = '{nalvis-copilot}';
const idSchema = z.string().regex(/^0x[\da-f]{64}$/i);
export function copilotQueue(
  env: Record<string, string | undefined>,
  send: typeof fetch = fetch,
) {
  const endpoint = env.UPSTASH_REDIS_REST_URL ?? env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN ?? env.KV_REST_API_TOKEN;
  if (!endpoint || !token) return undefined;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return undefined;
  }
  if (
    url.protocol !== 'https:' ||
    !url.hostname.endsWith('.upstash.io') ||
    url.pathname !== '/' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    return undefined;
  const command = async (args: (string | number)[]) => {
    const response = await send(url.href, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw Error('Order queue unavailable');
    const body = z
      .object({ result: z.unknown(), error: z.string().optional() })
      .parse(await response.json());
    if (body.error) throw Error('Order queue unavailable');
    return body.result;
  };
  return {
    async enqueue(input: SignedSellOrder) {
      const signed = signedSellOrderSchema.parse(input),
        id = sellOrderId(signed);
      const result = await command([
        'EVAL',
        `if redis.call('EXISTS',KEYS[1])==1 then return 0 end
if redis.call('EXISTS',KEYS[2])==1 then return -1 end
redis.call('SET',KEYS[1],ARGV[1],'EX',3600)
redis.call('SET',KEYS[2],ARGV[2],'EX',180)
redis.call('RPUSH',KEYS[3],ARGV[2]) return 1`,
        3,
        `${prefix}:order:${id}`,
        `${prefix}:pending`,
        `${prefix}:queue`,
        JSON.stringify({ signed, status: 'queued' }),
        id,
      ]);
      if (result !== 1)
        throw Error(
          result === 0
            ? 'This confirmation was already submitted'
            : 'Another owner order is in progress',
        );
      return id;
    },
    async claim() {
      const raw = await command([
        'EVAL',
        `for i=1,10 do
local id=redis.call('LPOP',KEYS[1]); if not id then return nil end
local k=ARGV[1]..id; local raw=redis.call('GET',k)
if raw then local r=cjson.decode(raw); if r.status=='queued' then r.status='processing'; redis.call('SET',k,cjson.encode(r),'EX',3600); return cjson.encode({id=id,signed=r.signed}) end end
end return nil`,
        1,
        `${prefix}:queue`,
        `${prefix}:order:`,
      ]);
      if (raw == null) return null;
      return z
        .object({ id: idSchema, signed: signedSellOrderSchema })
        .parse(JSON.parse(z.string().parse(raw)));
    },
    async status(id: string) {
      idSchema.parse(id);
      const raw = await command(['GET', `${prefix}:order:${id}`]);
      if (raw == null) return null;
      const value = z
        .object({
          status: z.string(),
          transactionHash: idSchema.optional(),
          reason: z.string().optional(),
        })
        .parse(JSON.parse(z.string().parse(raw)));
      return value;
    },
    async finish(
      id: string,
      result: {
        status: 'mined' | 'rejected' | 'needs_review';
        transactionHash?: string;
        reason?: string;
      },
    ) {
      idSchema.parse(id);
      await command([
        'EVAL',
        `local raw=redis.call('GET',KEYS[1]); if raw then local r=cjson.decode(raw); local v=cjson.decode(ARGV[1]); r.status=v.status; r.transactionHash=v.transactionHash; r.reason=v.reason; redis.call('SET',KEYS[1],cjson.encode(r),'EX',3600) end
if redis.call('GET',KEYS[2])==ARGV[2] then redis.call('DEL',KEYS[2]) end return 1`,
        2,
        `${prefix}:order:${id}`,
        `${prefix}:pending`,
        JSON.stringify(result),
        id,
      ]);
    },
  };
}
