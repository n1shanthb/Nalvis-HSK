import { zeroAddress, zeroHash } from 'viem';
import { addresses } from '../../../packages/core/src/addresses.js';
import type { VaultSnapshot } from '../src/lib/clients.js';
export const owner = addresses[133].whsk.address,
  vault = addresses[133].primaryPool.address;
export const snapshot: VaultSnapshot = {
  owner,
  pendingOwner: zeroAddress,
  paused: false,
  blockNumber: 1n,
  decimalsA: 18,
  decimalsB: 18,
  mandate: {
    agent: addresses[133].usdt.address,
    expiry: BigInt(Math.floor(Date.now() / 1000) + 86400),
    maxTradeInA: 10n ** 18n,
    maxTradeInB: 25n * 10n ** 18n,
    maxDailyInB: 100n * 10n ** 18n,
    maxExposureBps: 8000,
    maxSlippageBps: 50,
    maxDrawdownBps: 2000,
    minIntervalSec: 300n,
    policyHash: zeroHash,
  },
};
