import { describe, expect, it, vi } from 'vitest';
import { mnemonicToAccount } from 'viem/accounts';
import { zeroHash } from 'viem';
import { hash } from '../../src/canonical.js';
import {
  assertSellAuthorization,
  sellSessionMessage,
  type SellSession,
} from '../../src/copilot.js';
import { sellActionFor, sellPreview } from '../../src/agent/owner-preview.js';
import { createAgent } from '../../src/agent/agent.js';
import { memoryStore } from '../../src/agent/store.js';
import {
  agentConfigSchema,
  createAgentPolicy,
  agentPolicyHash,
} from '../../src/agent/policy.js';
import { fixtureState, quote, mockProvider } from './fixtures.js';

const mnemonic = 'test test test test test test test test test test test junk';
const owner = mnemonicToAccount(mnemonic),
  sessionKey = mnemonicToAccount(mnemonic, { addressIndex: 9 });
async function fixture() {
  const s = fixtureState();
  const config = agentConfigSchema.parse({
    models: { strategist: 'mock', fitter: 'mock' },
    policyFile: '{}',
  });
  config.policyFile = createAgentPolicy(config);
  s.mandate.policyHash = agentPolicyHash(config.policyFile);
  const delegation: SellSession = {
    version: 1,
    scope: 'SELL_WITHIN_MANDATE',
    chainId: s.chainId,
    owner: owner.address,
    vault: s.vault,
    sessionKey: sessionKey.address,
    policyHash: s.mandate.policyHash,
    issuedAt: s.blockTime,
    expiresAt: s.blockTime + 900,
    nonce: zeroHash,
  };
  const preview = sellPreview(s, await quote(sellActionFor(s), s), delegation);
  const signed = {
    delegation,
    ownerSignature: await owner.signMessage({
      message: sellSessionMessage(delegation),
    }),
    order: preview.order,
    orderSignature: await sessionKey.signMessage({
      message: { raw: hash(preview.order) },
    }),
  };
  const context = {
    owner: owner.address,
    vault: s.vault,
    chainId: s.chainId,
    policyHash: s.mandate.policyHash,
    now: s.blockTime,
  };
  const store = memoryStore(),
    provider = mockProvider([]),
    send = vi.fn().mockResolvedValue({ transactionHash: zeroHash });
  const clients = {
    readState: async () => s,
    readOwner: async () => owner.address,
    collectEvidence: async () => ({
      marketDataChainId: 177,
      executionChainId: s.chainId,
      now: s.blockTime,
    }),
    evidenceLite: async () => ({ prices: {} }),
    quote,
    simulate: async () => ({ ok: true, block: s.block }),
    send,
  };
  const agent = await createAgent({ provider, store, config, clients });
  return { s, config, signed, context, store, provider, clients, send, agent };
}
it('uses both real signatures and binds the exact reviewed amount, floor, network, owner and expiry', async () => {
  const f = await fixture();
  await expect(
    assertSellAuthorization(f.signed, f.context),
  ).resolves.toBeTruthy();
  await expect(
    assertSellAuthorization(
      { ...f.signed, order: { ...f.signed.order, minOut: '1' } },
      f.context,
    ),
  ).rejects.toThrow();
  await expect(
    assertSellAuthorization(f.signed, {
      ...f.context,
      owner: sessionKey.address,
    }),
  ).rejects.toThrow();
  await expect(
    assertSellAuthorization(f.signed, { ...f.context, chainId: 177 }),
  ).rejects.toThrow();
  await expect(
    assertSellAuthorization(f.signed, { ...f.context, policyHash: zeroHash }),
  ).rejects.toThrow();
  await expect(
    assertSellAuthorization(f.signed, {
      ...f.context,
      now: f.signed.order.validUntil,
    }),
  ).rejects.toThrow();
});
it('executes a capped owner sell without calling an LLM, persists a v4 receipt and rejects replay', async () => {
  const f = await fixture();
  const receipt = await f.agent.executeOwnerSell(f.signed);
  expect(receipt.version).toBe(4);
  expect(receipt.strategy.mode).toBe('owner-command');
  expect(receipt.final.amountIn).toBeLessThanOrEqual(f.s.mandate.maxTradeInA);
  expect(f.provider.calls).toHaveLength(0);
  expect(f.send).toHaveBeenCalledTimes(1);
  expect(await f.store.read('pending.json')).toBeNull();
  await expect(f.agent.executeOwnerSell(f.signed)).rejects.toThrow(
    'already consumed',
  );
  expect(f.send).toHaveBeenCalledTimes(1);
});
describe.each([
  'paused',
  'revoked',
  'twapOk',
  'oracleOk',
  'head',
  'nextNonce',
  'policy',
  'underfill',
  'simulation',
  'pending',
] as const)('refuses a changed %s', (failure) => {
  it('never signs or sends', async () => {
    const f = await fixture();
    if (failure === 'paused' || failure === 'revoked') f.s[failure] = true;
    if (failure === 'twapOk' || failure === 'oracleOk') f.s[failure] = false;
    if (failure === 'head') f.s.head = ('0x' + 'a'.repeat(64)) as `0x${string}`;
    if (failure === 'nextNonce') f.s.nextNonce++;
    if (failure === 'policy') f.s.mandate.policyHash = zeroHash;
    if (failure === 'underfill')
      f.clients.quote = async (a, s) => ({
        ...(await quote(a, s)),
        amountOut: 1n,
      });
    if (failure === 'simulation')
      f.clients.simulate = async () => ({ ok: false, block: f.s.block });
    if (failure === 'pending')
      await f.store.write('pending.json', { unresolved: true });
    await expect(f.agent.executeOwnerSell(f.signed)).rejects.toThrow();
    expect(f.send).not.toHaveBeenCalled();
  });
});
it('does not sell an empty inventory and never sizes above inventory or remaining daily spend', async () => {
  const f = await fixture();
  f.s.balanceA = 0n;
  expect(() => sellActionFor(f.s)).toThrow('no WHSK');
  f.s.balanceA = 10n ** 18n;
  f.s.mandate.maxDailyInB = 5n * 10n ** 17n;
  const action = sellActionFor(f.s);
  expect(Number(action.notionalB)).toBe(0.5);
});
it('keeps an uncertain submission durable and will not resend it', async () => {
  const f = await fixture();
  f.send.mockRejectedValue(Error('Transport unknown'));
  await expect(f.agent.executeOwnerSell(f.signed)).rejects.toThrow();
  expect(await f.store.read('pending.json')).toBeTruthy();
  await expect(f.agent.executeOwnerSell(f.signed)).rejects.toThrow('pending');
  expect(f.send).toHaveBeenCalledTimes(1);
});
it('does not stall autonomous operation when the production transport proves a pre-broadcast rejection', async () => {
  const f = await fixture();
  Object.assign(f.clients, { durableBroadcastMarker: true });
  f.send.mockRejectedValue(Error('Authorization changed before signing'));
  await expect(f.agent.executeOwnerSell(f.signed)).rejects.toThrow();
  expect(await f.store.read('pending.json')).toBeNull();
  expect(await f.store.read('.pending.json')).toBeUndefined();
});
