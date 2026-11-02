// @vitest-environment node
import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
import { zeroHash, type Hex } from 'viem';
import manifest from '../../../contracts/deployments/177.json';
import { copilotQueue } from '../../../packages/core/src/copilot-queue.js';
import { hash } from '../../../packages/core/src/canonical.js';
import type {
  SignedSellOrder,
  SellSession,
} from '../../../packages/core/src/copilot.js';
const require = createRequire(import.meta.url);
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require('fengari');
/** Execute the actual production Lua; emulate only Redis primitives and cjson conversion. */
function harness() {
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);
  const exec = (source: string) => {
    if (lauxlib.luaL_dostring(L, to_luastring(source)) !== 0)
      throw Error(to_jsstring(lua.lua_tostring(L, -1)));
  };
  function push(value: unknown) {
    if (value == null) lua.lua_pushnil(L);
    else if (typeof value === 'string')
      lua.lua_pushstring(L, to_luastring(value));
    else if (typeof value === 'number') lua.lua_pushnumber(L, value);
    else if (typeof value === 'boolean') lua.lua_pushboolean(L, value);
    else {
      lua.lua_newtable(L);
      for (const [key, child] of Object.entries(value)) {
        push(child);
        lua.lua_setfield(L, -2, to_luastring(key));
      }
    }
  }
  function read(index: number): unknown {
    const type = lua.lua_type(L, index);
    if (type === lua.LUA_TNIL) return null;
    if (type === lua.LUA_TBOOLEAN) return !!lua.lua_toboolean(L, index);
    if (type === lua.LUA_TNUMBER) return lua.lua_tonumber(L, index);
    if (type === lua.LUA_TSTRING)
      return to_jsstring(lua.lua_tostring(L, index));
    const result: Record<string, unknown> = {},
      at = lua.lua_absindex(L, index);
    lua.lua_pushnil(L);
    while (lua.lua_next(L, at)) {
      result[String(read(-2))] = read(-1);
      lua.lua_pop(L, 1);
    }
    return result;
  }
  lua.lua_newtable(L);
  lua.lua_pushjsfunction(L, () => {
    push(JSON.parse(String(read(1))));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring('decode'));
  lua.lua_pushjsfunction(L, () => {
    push(JSON.stringify(read(1)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring('encode'));
  lua.lua_setglobal(L, to_luastring('cjson'));
  exec(`data={};lists={};redis={};redis.call=function(cmd,key,...)
local a={...}
if cmd=='GET' then return data[key] or false end
if cmd=='EXISTS' then return data[key] and 1 or 0 end
if cmd=='SET' then data[key]=a[1];return 'OK' end
if cmd=='DEL' then data[key]=nil;return 1 end
if cmd=='RPUSH' then lists[key]=lists[key] or {};table.insert(lists[key],a[1]);return #lists[key] end
if cmd=='LPOP' then if not lists[key] or #lists[key]==0 then return nil end;return table.remove(lists[key],1) end
error('Unexpected Redis primitive '..cmd) end`);
  const send: typeof fetch = async (_url, options) => {
    const c = JSON.parse(String(options?.body));
    if (c[0] === 'GET') {
      exec(`result=redis.call('GET',${JSON.stringify(c[1])})`);
    } else {
      const count = Number(c[2]);
      const table = (values: unknown[]) =>
        '{' + values.map((v) => JSON.stringify(String(v))).join(',') + '}';
      exec(
        `KEYS=${table(c.slice(3, 3 + count))};ARGV=${table(c.slice(3 + count))};result=(function() ${c[1]} end)()`,
      );
    }
    lua.lua_getglobal(L, to_luastring('result'));
    const result = read(-1);
    lua.lua_pop(L, 1);
    return Response.json({ result: result === false ? null : result });
  };
  return send;
}
function order(): SignedSellOrder {
  const delegation: SellSession = {
    version: 1,
    scope: 'SELL_WITHIN_MANDATE',
    chainId: 177,
    owner: manifest.owner as Hex,
    vault: manifest.vault as Hex,
    sessionKey: manifest.agent as Hex,
    policyHash: zeroHash,
    issuedAt: 1000,
    expiresAt: 1900,
    nonce: zeroHash,
  };
  return {
    delegation,
    ownerSignature: ('0x' + '1'.repeat(130)) as Hex,
    orderSignature: ('0x' + '2'.repeat(130)) as Hex,
    order: {
      version: 1,
      delegationHash: hash(delegation),
      chainId: 177,
      vault: manifest.vault as Hex,
      policyHash: zeroHash,
      tokenIn: manifest.agent as Hex,
      notionalB: '1',
      amountIn: '100',
      minOut: '90',
      expectedOut: '100',
      nonce: '0',
      seq: '0',
      prevHead: zeroHash,
      stateHash: zeroHash,
      createdAt: 1000,
      validUntil: 1090,
    },
  };
}
it('atomically rejects duplicate confirmations and lets only one consumer claim an order', async () => {
  const send = harness(),
    env = {
      KV_REST_API_URL: 'https://fixture.upstash.io',
      KV_REST_API_TOKEN: 'test-token',
    };
  const a = copilotQueue(env, send)!,
    b = copilotQueue(env, send)!,
    signed = order();
  const results = await Promise.allSettled(
    Array.from({ length: 20 }, (_, i) => (i % 2 ? a : b).enqueue(signed)),
  );
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const [first, second] = await Promise.all([a.claim(), b.claim()]);
  expect([first, second].filter(Boolean)).toHaveLength(1);
  const claimed = first ?? second!;
  expect((await a.status(claimed.id))?.status).toBe('processing');
  await expect(
    b.enqueue({ ...signed, order: { ...signed.order, nonce: '1' } }),
  ).rejects.toThrow('in progress');
  await a.finish(claimed.id, { status: 'mined', transactionHash: zeroHash });
  expect(await b.status(claimed.id)).toEqual({
    status: 'mined',
    transactionHash: zeroHash,
  });
  await expect(a.enqueue(signed)).rejects.toThrow('already submitted');
  await expect(
    b.enqueue({ ...signed, order: { ...signed.order, nonce: '1' } }),
  ).resolves.toMatch(/^0x/);
});
