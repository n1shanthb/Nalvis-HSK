import { it, expect, vi } from 'vitest';
import { mnemonicToAccount } from 'viem/accounts';
import { readDeskMandate } from '../src/desk/live.js';
import { desk } from '../src/desk/index.js';
import { scenario } from './helpers.js';
const agent = mnemonicToAccount(
  'test test test test test test test test test test test junk',
  { addressIndex: 1 },
).address;
it('current tightened mandate replaces historic caps and paused is not revoked', async () => {
  const s = scenario();
  const client = {
    getChainId: async () => 133,
    getBlockNumber: vi.fn(async () => 9n),
    readContract: vi.fn(async ({ functionName }: { functionName: string }) =>
      functionName === 'paused'
        ? true
        : functionName === 'decimals'
          ? 18
          : [
              agent,
              BigInt(s.mandate.expiry),
              s.mandate.maxTradeInA,
              10n * 10n ** 18n,
              100n * 10n ** 18n,
              8000,
              40,
              1234,
              300n,
              s.mandate.policyHash,
            ],
    ),
  };
  const live = await readDeskMandate(client as never, agent, 133, s.policy);
  expect(client.getBlockNumber).toHaveBeenCalledWith({ cacheTime: 0 });
  expect(live.paused).toBe(true);
  expect(live.mandate.revoked).toBe(false);
  expect(
    desk('set cap to 25', { ...live, policy: s.policy }).diff,
  ).toBeUndefined();
  expect(
    client.readContract.mock.calls.every((c) =>
      Object.hasOwn(c[0], 'blockNumber'),
    ),
  ).toBe(true);
  client.readContract.mockRejectedValue(Error('RPC offline'));
  await expect(
    readDeskMandate(client as never, agent, 133, s.policy),
  ).rejects.toThrow('RPC offline');
});
it('policy mismatch fails closed', async () => {
  const s = scenario();
  const client = {
    getChainId: async () => 133,
    getBlockNumber: async () => 1n,
    readContract: async ({ functionName }: { functionName: string }) =>
      functionName === 'paused'
        ? false
        : functionName === 'decimals'
          ? 18
          : [
              agent,
              BigInt(s.mandate.expiry),
              1n,
              1n,
              1n,
              8000,
              40,
              1234,
              300n,
              '0x' + '0'.repeat(64),
            ],
  };
  await expect(
    readDeskMandate(client as never, agent, 133, s.policy),
  ).rejects.toThrow('Policy hash');
});
