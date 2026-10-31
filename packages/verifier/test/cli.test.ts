import { beforeAll, test, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  readFileSync,
  readdirSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { main } from '../src/cli.js';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const fixture = join(root, 'packages/verifier/test/fixtures');
const recorded = join(fixture, 'chain.json');
const receipts = join(fixture, 'receipts');
const path = join(receipts, readdirSync(receipts).sort()[0]);
const receipt = JSON.parse(readFileSync(path, 'utf8'));
const executable = join(root, 'packages/verifier/dist/verifier/src/cli.js');
beforeAll(() => {
  const core = spawnSync(
    process.execPath,
    [
      join(root, 'node_modules/typescript/bin/tsc'),
      '-p',
      join(root, 'packages/core/tsconfig.json'),
    ],
    { encoding: 'utf8' },
  );
  expect(core.status, core.stdout + core.stderr).toBe(0);
  const result = spawnSync(
    process.execPath,
    [
      join(root, 'node_modules/typescript/bin/tsc'),
      '-p',
      join(root, 'packages/verifier/tsconfig.json'),
    ],
    { encoding: 'utf8' },
  );
  expect(result.status, result.stdout + result.stderr).toBe(0);
}, 60000);
test('compiled CLI prints PASS table and exits 0 on genuine recorded fixture', () => {
  const result = spawnSync(
    process.execPath,
    [executable, path, '--recorded', recorded],
    { encoding: 'utf8' },
  );
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain('PASS — recorded RPC replay');
  expect(result.stdout).toContain('Gas ');
});
test('tx lookup, --receipt and --json produce machine-readable PASS', async () => {
  for (const args of [
    ['--receipt', path],
    ['--receipts', receipts],
  ]) {
    const output: string[] = [];
    const exit = await main(
      [
        receipt.settlement.transactionHash,
        ...args,
        '--recorded',
        recorded,
        '--json',
      ],
      (s) => output.push(s),
    );
    expect(exit).toBe(0);
    expect(JSON.parse(output[0]).status).toBe('PASS');
  }
});
test(
  'compiled CLI exits 1 and names check for all six required tampers',
  { timeout: 30000 },
  () => {
    const dir = mkdtempSync(join(tmpdir(), 'verifier-tampers-'));
    try {
      const cases: [
        string,
        (r: typeof receipt, c: ReturnType<typeof JSON.parse>) => void,
        string,
      ][] = [
        [
          'evidence',
          (r) => {
            r.evidence.sources.demo.raw += 'x';
          },
          'evidenceHash',
        ],
        [
          'kind',
          (r) => {
            r.decision.kind = 'WAIT';
          },
          'receiptHash',
        ],
        [
          'minOut',
          (r) => {
            r.tx.minOut = String(BigInt(r.tx.minOut) + 1n);
          },
          'receiptHash',
        ],
        [
          'prevHead',
          (r) => {
            r.prevHead = '0x' + '11'.repeat(32);
          },
          'receiptHash',
        ],
        [
          'contract',
          (_r, c) => {
            c.receipts[0].logs.forEach((l: { address: string }) => {
              l.address = '0x' + '00'.repeat(20);
            });
          },
          'receipt_event',
        ],
        [
          'policyHash',
          (r) => {
            r.policyHash = '0x' + '11'.repeat(32);
          },
          'receiptHash',
        ],
      ];
      for (const [name, mutate, check] of cases) {
        const r = structuredClone(receipt),
          c = JSON.parse(readFileSync(recorded, 'utf8'));
        mutate(r, c);
        const rp = join(dir, name + '.json'),
          cp = join(dir, name + '-chain.json');
        writeFileSync(rp, JSON.stringify(r));
        writeFileSync(cp, JSON.stringify(c));
        const result = spawnSync(
          process.execPath,
          [executable, rp, '--recorded', cp, '--json'],
          { encoding: 'utf8' },
        );
        expect(result.status, result.stderr).toBe(1);
        expect(
          JSON.parse(result.stdout).results[0].checks.find(
            (c: { pass: boolean }) => !c.pass,
          ).name,
        ).toBe(check);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
test('P&L CLI verifies all receipts first', async () => {
  const output: string[] = [];
  expect(
    await main(['--pnl', receipts, '--recorded', recorded, '--json'], (s) =>
      output.push(s),
    ),
  ).toBe(0);
  expect(JSON.parse(output[0]).pnl.count).toBe(4);
});
test.each(
  [[], ['--chain', '-1'], [path, '--no-such-option'], [path, '--rpc']].map(
    (args) => ({ args }),
  ),
)('bad arguments fail with JSON and exit 1: %s', async ({ args }) => {
  const output: string[] = [];
  expect(await main([...args, '--json'], (s) => output.push(s))).toBe(1);
  expect(JSON.parse(output[0]).status).toBe('FAIL');
});

test.each(["what's the spread now", 'why REJECT #3', 'set cap to 25'])(
  'desk CLI recorded example works: %s',
  (text) => {
    const result = spawnSync(
      process.execPath,
      [join(root, 'scripts/nalvis.mjs'), 'desk', text, '--demo'],
      { encoding: 'utf8' },
    );
    expect(result.status, result.stderr).toBe(0);
    const reply = JSON.parse(result.stdout);
    expect(reply.message).not.toContain('unavailable');
    if (text.includes('spread')) {
      expect(reply.message).toContain('not a live quote');
      expect(reply.message).toContain('DEX:');
    }
    if (text.includes('REJECT')) expect(reply.message).toContain('Receipt #3');
    if (text.includes('cap'))
      expect(reply.diff).toEqual({ maxTradeInB: '25000000' });
  },
);
