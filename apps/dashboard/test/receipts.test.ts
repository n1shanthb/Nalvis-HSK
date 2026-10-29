import { expect, test, vi } from 'vitest';
import { localReceiptFiles } from '../src/lib/receipts.js';
import { loadDeployment, explorerLink } from '../src/lib/clients.js';
import trade from '../../../packages/verifier/test/fixtures/receipts/0-0x7b0c0e534f5f1143aa6be5b1fc80e826fc620453d80b9e517cd9dcdddd352a2d.json';
const response = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' },
  });
test('one unverified local file does not suppress genuine receipts', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const path = String(input);
    return response(
      path.endsWith('index.json')
        ? ['/receipts/trade.json', '/receipts/invalid.json']
        : path.endsWith('trade.json')
          ? trade
          : { version: 1 },
    );
  });
  const result = await localReceiptFiles();
  expect(result.receipts).toHaveLength(1);
  expect(result.receipts[0].receiptHash).toBe(trade.receiptHash);
  expect(result.warnings).toEqual([
    '/receipts/invalid.json: invalid or unverified receipt; excluded',
  ]);
});
test('rejects remote and traversal paths in a receipt index', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    response(['/receipts/../../outside.json']),
  );
  await expect(localReceiptFiles()).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(1);
});
test('unlisted deployment contracts are UNVERIFIED and refused', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    response({
      vault: '0x' + '1'.repeat(40),
      router: '0x' + '2'.repeat(40),
      owner: '0x' + '3'.repeat(40),
      agent: '0x' + '4'.repeat(40),
      deployer: '0x' + '5'.repeat(40),
      block: '1',
      commit: 'a'.repeat(40),
    }),
  );
  await expect(loadDeployment(133)).rejects.toThrow('UNVERIFIED');
});
test('testnet links use documented explorer; Anvil never links to a remote explorer', () => {
  expect(explorerLink(133, 'tx', 'hash')).toBe(
    'https://testnet-explorer.hskchain.net/tx/hash',
  );
  expect(explorerLink(31337, 'tx', 'hash')).toBeUndefined();
});
