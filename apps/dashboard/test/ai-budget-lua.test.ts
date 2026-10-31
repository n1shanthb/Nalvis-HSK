// @vitest-environment node
import { createRequire } from 'node:module';
import { it, expect } from 'vitest';
import { budgetScript, createBudgetStore } from '../server/budget.js';
const require = createRequire(import.meta.url);
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require('fengari');
// Execute the production Lua, with only Redis primitive commands emulated.
// This verifies the actual limiter, rather than a second JS implementation.
function redisHarness() {
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);
  const exec = (source: string) => {
    const code = lauxlib.luaL_dostring(L, to_luastring(source));
    if (code !== 0) throw Error(to_jsstring(lua.lua_tostring(L, -1)));
  };
  exec(`clock=1793452801; data={}; ttl={}; redis={}; redis.call=function(cmd,key,...)
 local args={...}
 if cmd=='TIME' then return {tostring(clock),'0'} end
 if cmd=='HMGET' then local row=data[key] or {};return {row[args[1]] or false,row[args[2]] or false} end
 if cmd=='HSET' then data[key]=data[key] or {};for i=1,#args,2 do data[key][args[i]]=args[i+1] end;return 1 end
 if cmd=='EXPIRE' then ttl[key]=args[1];return 1 end
 error('Unexpected Redis command '..cmd)
 end`);
  const send: typeof fetch = async (_url, options) => {
    const command = JSON.parse(String(options?.body));
    expect(command[0]).toBe('EVAL');
    expect(command[2]).toBe(4);
    const table = (values: string[]) =>
      '{' + values.map((v) => JSON.stringify(v)).join(',') + '}';
    exec(
      `KEYS=${table(command.slice(3, 7))};ARGV=${table(command.slice(7))};result=(function() ${command[1]} end)()`,
    );
    lua.lua_getglobal(L, to_luastring('result'));
    const result: number[] = [];
    for (let i = 1; i <= 5; i++) {
      lua.lua_rawgeti(L, -1, i);
      result.push(lua.lua_tonumber(L, -1));
      lua.lua_pop(L, 1);
    }
    lua.lua_pop(L, 1);
    return Response.json({ result });
  };
  return { send, advance: (seconds: number) => exec(`clock=clock+${seconds}`) };
}
const env = {
  UPSTASH_REDIS_REST_URL: 'https://test.upstash.io',
  UPSTASH_REDIS_REST_TOKEN: 'test-placeholder',
  DESK_IP_HASH_SECRET: 'x'.repeat(32),
  DESK_AI_IP_PER_MINUTE: '2',
  DESK_AI_GLOBAL_PER_MINUTE: '3',
  DESK_AI_IP_DAILY_CREDITS: '2',
  DESK_AI_GLOBAL_DAILY_CAP: '3',
};
it('the production Lua prevents concurrent instances from overspending per-IP/global caps', async () => {
  expect(budgetScript).toContain("redis.call('TIME')");
  const h = redisHarness();
  const stores = [
    createBudgetStore(env, h.send)!,
    createBudgetStore(env, h.send)!,
  ];
  const results = await Promise.all(
    Array.from({ length: 40 }, (_, i) =>
      stores[i % 2].check((i % 2 ? 'a' : 'b').repeat(64), true),
    ),
  );
  expect(results.filter((r) => r.allowed)).toHaveLength(3);
  expect(results.at(-1)?.credits.globalRemaining).toBe(0);
  const peek = await stores[0].check('a'.repeat(64), false);
  expect(peek.allowed).toBe(false);
  expect(peek.credits.globalRemaining).toBe(0);
  expect(peek.credits.retryAfter).toBeGreaterThan(60);
  // A minute rollover never replenishes a daily spend cap.
  h.advance(61);
  expect((await stores[1].check('c'.repeat(64), true)).allowed).toBe(false);
  h.advance(86400);
  const next = await stores[1].check('a'.repeat(64), true);
  expect(next.allowed).toBe(true);
  expect(next.credits.remaining).toBe(1);
  expect(next.credits.globalRemaining).toBe(2);
});
it('inspection is free, per-IP daily credits persist and minute throttles reset', async () => {
  const h = redisHarness(),
    store = createBudgetStore(
      {
        ...env,
        DESK_AI_IP_PER_MINUTE: '1',
        DESK_AI_GLOBAL_PER_MINUTE: '30',
        DESK_AI_GLOBAL_DAILY_CAP: '200',
      },
      h.send,
    )!;
  const id = 'a'.repeat(64);
  for (let i = 0; i < 4; i++)
    expect((await store.check(id, false)).credits.remaining).toBe(2);
  expect((await store.check(id, true)).allowed).toBe(true);
  expect((await store.check(id, true)).allowed).toBe(false);
  h.advance(61);
  expect((await store.check(id, true)).credits.remaining).toBe(0);
  h.advance(61);
  expect((await store.check(id, true)).allowed).toBe(false);
  expect((await store.check('b'.repeat(64), true)).allowed).toBe(true);
});
