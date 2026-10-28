import { expect, test } from 'vitest';
import { isAddress } from 'viem';
import { addresses, assertWritableChain } from '../src/addresses.js';
import { hskMainnet, hskTestnet } from '../src/chains.js';

test('every configured address has a valid checksum', () => {
  for (const chain of Object.values(addresses)) {
    for (const entry of Object.values(chain))
      expect(isAddress(entry.address, { strict: true })).toBe(true);
  }
});
test('USDT precision differs by chain', () => {
  expect(addresses[177].usdt.decimals).toBe(6);
  expect(addresses[133].usdt.decimals).toBe(18);
});
test('only testnet and local forks allow writes', () => {
  for (const id of [133, 31337])
    expect(() => assertWritableChain(id)).not.toThrow();
  for (const id of [177, 1, 0, -1, NaN])
    expect(() => assertWritableChain(id)).toThrow();
});
test('chain definitions identify mainnet and testnet', () => {
  expect(hskMainnet.id).toBe(177);
  expect(hskTestnet.id).toBe(133);
});
