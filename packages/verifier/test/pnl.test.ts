import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { test, expect } from 'vitest';
import { verify } from '../src/verify.js';
import { recordedReader } from '../src/recorded.js';
import { pnl } from '../src/pnl.js';
const dir = fileURLToPath(new URL('./fixtures', import.meta.url));
const chain = JSON.parse(readFileSync(join(dir, 'chain.json'), 'utf8'));
const inputs = readdirSync(join(dir, 'receipts'))
  .sort()
  .map((n) => JSON.parse(readFileSync(join(dir, 'receipts', n), 'utf8')));
const results = () =>
  Promise.all(
    inputs.map((r) => verify(r, recordedReader(chain), { chain: 10 })),
  );
test('P&L tracks real fills and charges mined gas once; order is sequence order', async () => {
  const rows = await results();
  const report = pnl([...rows].reverse());
  const start = inputs[0].evidence.sources.replay.raw.state;
  const initialA = Number(start.balanceA) / 1e18,
    initialB = Number(start.balanceB) / 1e6;
  let a = initialA,
    b = initialB,
    gas = 0;
  for (const r of rows) {
    const log = chain.receipts
      .find(
        (c: { transactionHash: string }) =>
          c.transactionHash === r.receipt!.settlement!.transactionHash,
      )
      .logs.find(
        (l: { address: string }) =>
          l.address.toLowerCase() === r.receipt!.contract.toLowerCase(),
      );
    expect(log).toBeDefined();
    const m = r.metrics!;
    if (BigInt(m.amountIn)) {
      b -= Number(m.amountIn) / 1e6;
      a += Number(m.amountOut) / 1e18;
    }
    gas += m.gasHSK * (m.cexMid ?? report.mark);
  }
  expect(report.balanceA).toBeCloseTo(a, 10);
  expect(report.balanceB).toBeCloseTo(b, 10);
  expect(report.gasUSD).toBeCloseTo(gas, 10);
  expect(report.excessVsHoldUSD).toBeCloseTo(
    a * report.mark + b - (initialA * report.mark + initialB) - gas,
    10,
  );
});
test('P&L refuses unverified, mixed, duplicate, or missing sequence receipts', async () => {
  const rows = await results();
  expect(() => pnl([])).toThrow('pnl_verified');
  expect(() => pnl([{ ...rows[0], status: 'FAIL' }])).toThrow('pnl_verified');
  expect(() => pnl([rows[0], rows[2]])).toThrow('pnl_chain');
  expect(() => pnl([rows[0], rows[0]])).toThrow('pnl_chain');
  const mixed = structuredClone(rows);
  mixed[1].receipt!.executionChainId = 133;
  expect(() => pnl(mixed)).toThrow('pnl_chain');
});
