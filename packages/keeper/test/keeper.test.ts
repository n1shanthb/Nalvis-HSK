import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zeroAddress, zeroHash, type Hex } from 'viem';
import { decide, policyHash, receiptHash } from '../../core/src/index.js';
import {
  loadPolicy,
  optionsSchema,
  parseOptions,
  assertLocalAnvil,
  assertTestnetHuman,
  deploymentSchema,
} from '../src/config.js';
import { fixtureScenario } from '../src/demo.js';
import { guardSigning } from '../src/execution.js';
import { tick, withLock, type Execution } from '../src/runner.js';
import { meanTick, sqrtAtTick, twapOutput } from '../src/twap.js';
const policy = loadPolicy();
const contract = zeroAddress;
function execution(scenario: 'trade' | 'resize' | 'wait' | 'reject' = 'trade') {
  const f = fixtureScenario(policy, scenario);
  let seq = 0n,
    head: Hex = zeroHash,
    nonce = 0n,
    revoked = false;
  const send = vi.fn<Execution['send']>();
  const e: Execution = {
    chainId: 31337,
    contract,
    async reconcile() {
      return 0;
    },
    async snapshot() {
      return {
        seq,
        head,
        nonce,
        now: f.evidence.now,
        mandate: f.mandate,
        state: f.state,
        executionDecimalsA: 18,
        executionDecimalsB: 6,
      };
    },
    async check() {
      if (revoked) throw new Error('revoked');
    },
    async collect() {
      return structuredClone(f.evidence);
    },
    async quote(direction, amountIn) {
      const q = f.evidence.quotes.find(
        (q) => q.direction === direction && q.amountIn === amountIn,
      )!;
      return { quote: q.quotedOut, floor: 0n };
    },
    calldata() {
      return '0x1234';
    },
    send,
  };
  return {
    f,
    e,
    send,
    revoke() {
      revoked = true;
    },
    advance() {
      seq++;
      nonce++;
      head = ('0x' + '1'.repeat(64)) as Hex;
    },
  };
}
async function temporary(fn: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'keeper-'));
  try {
    await fn(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
describe('keeper safety and deterministic scenarios', () => {
  it('rejects chain 177 before any signing hook', async () => {
    const signing = vi.fn();
    await expect(
      (async () => {
        await guardSigning({ getChainId: async () => 177 }, 31337);
        signing();
      })(),
    ).rejects.toThrow('Writes forbidden');
    expect(signing).not.toHaveBeenCalled();
  });
  it('guards testnet, expected chain and loopback', async () => {
    await expect(
      guardSigning({ getChainId: async () => 31337 }, 133, {}),
    ).rejects.toThrow('differs');
    for (const env of [{ NODE_ENV: 'test' }, { CI: 'true' }])
      expect(() => assertTestnetHuman(env)).toThrow('human-run');
    expect(() => assertLocalAnvil('https://mainnet.hsk.xyz')).toThrow(
      'loopback',
    );
    expect(() => assertLocalAnvil('http://127.0.0.1:8545')).not.toThrow();
    expect(() => deploymentSchema.parse({ vault: zeroAddress })).toThrow();
  });
  it('parses CLI strictly', () => {
    expect(parseOptions(['run', '--once', '--exec', 'dry']).once).toBe(true);
    for (const argv of [
      ['run', '--interval', '0'],
      ['run', '--exec', 'mainnet'],
      ['run', '--exec'],
      ['run', '--oops'],
    ])
      expect(() => parseOptions(argv)).toThrow();
  });
  it.each([
    ['trade', 'TRADE'],
    ['resize', 'RESIZE'],
    ['wait', 'WAIT'],
    ['reject', 'REJECT'],
  ] as const)(
    'DEMO %s uses the unchanged policy and writes %s offline',
    async (scenario, kind) =>
      temporary(async (directory) => {
        const { e, send } = execution(scenario);
        const result = await tick(
          optionsSchema.parse({
            exec: 'dry',
            once: true,
            demo: scenario,
            receipts: directory,
          }),
          policy,
          e,
        );
        const raw = JSON.parse(await readFile(result.path, 'utf8'));
        expect(raw.decision.kind).toBe(kind);
        expect(raw.llm.explanation).toContain('DEMO');
        expect(raw.policyHash).toBe(policyHash(policy));
        expect(receiptHash(raw)).toBe(raw.receiptHash);
        expect(raw.marketDataChainId).toBe(177);
        expect(raw.executionChainId).toBe(31337);
        expect(raw.settlement).toBeUndefined();
        expect(send).not.toHaveBeenCalled();
      }),
  );
  it('daily loss stop creates a REJECT receipt', async () =>
    temporary(async (directory) => {
      const { e } = execution();
      e.reconcile = async () => policy.dailyLossStopB;
      const { receipt } = await tick(
        optionsSchema.parse({ exec: 'dry', receipts: directory }),
        policy,
        e,
      );
      expect(receipt.decision.kind).toBe('REJECT');
      expect(receipt.ruleTrace.some((t) => t.rule === 'daily_stop')).toBe(true);
    }));
  it('rejects missing execution quote and unfillable TWAP', async () =>
    temporary(async (directory) => {
      for (const quote of [
        async () => {
          throw new Error('bad quote');
        },
        async () => ({ quote: 100n, floor: 101n }),
      ]) {
        const { e } = execution();
        e.quote = quote;
        const { receipt } = await tick(
          optionsSchema.parse({ exec: 'dry', receipts: directory }),
          policy,
          e,
        );
        expect(receipt.decision.kind).toBe('REJECT');
        expect(receipt.tx.minOut).toBe(0n);
      }
    }));
  it('uses execution decimals and the stricter TWAP floor', async () =>
    temporary(async (directory) => {
      const { e } = execution();
      const original = e.snapshot;
      e.snapshot = async () => ({
        ...(await original()),
        executionDecimalsB: 18,
      });
      e.quote = vi.fn(async () => ({ quote: 1000n, floor: 995n }));
      const { receipt } = await tick(
        optionsSchema.parse({ exec: 'dry', receipts: directory }),
        policy,
        e,
      );
      expect(e.quote).toHaveBeenCalledWith(
        'BUY_A',
        100n * 10n ** 18n,
        expect.anything(),
      );
      expect(receipt.tx.minOut).toBe(995n);
      expect(receipt.decision.amountIn).toBe(100000000n); // market USD units remain replayable
    }));
  it('refuses revoked agents before a receipt or send', async () =>
    temporary(async (directory) => {
      const x = execution();
      x.revoke();
      await expect(
        tick(
          optionsSchema.parse({ exec: 'anvil', receipts: directory }),
          policy,
          x.e,
        ),
      ).rejects.toThrow('revoked');
      expect(x.send).not.toHaveBeenCalled();
      expect(await readdir(join(directory, '31337'))).toHaveLength(0);
    }));
  it('persists intent before send and never retries an uncertain nonce', async () =>
    temporary(async (directory) => {
      const { e, send } = execution();
      send.mockImplementation(async () => {
        await access(join(directory, '31337', '.pending.json'));
        throw new Error('uncertain');
      });
      await expect(
        tick(
          optionsSchema.parse({ exec: 'anvil', receipts: directory }),
          policy,
          e,
        ),
      ).rejects.toThrow('uncertain');
      expect(send).toHaveBeenCalledTimes(1);
      // Production reconcile refuses unresolved intent; the runner propagates it without sending.
      e.reconcile = async () => {
        throw new Error('Unresolved transaction intent');
      };
      await expect(
        tick(
          optionsSchema.parse({ exec: 'anvil', receipts: directory }),
          policy,
          e,
        ),
      ).rejects.toThrow('Unresolved');
      expect(send).toHaveBeenCalledTimes(1);
    }));
  it('appends confirmed settlement outside the commitment and resyncs on the next tick', async () =>
    temporary(async (directory) => {
      const x = execution('wait');
      x.send.mockImplementation(async (_data, onHash) => {
        const files = await readdir(join(directory, '31337'));
        const pending = JSON.parse(
          await readFile(join(directory, '31337', '.pending.json'), 'utf8'),
        );
        const r = JSON.parse(
          await readFile(
            join(
              directory,
              '31337',
              files.find((f) => f.includes(pending.receiptHash))!,
            ),
            'utf8',
          ),
        );
        await onHash(zeroHash);
        x.advance();
        return {
          transactionHash: zeroHash,
          blockNumber: 1n,
          status: 'success',
          gasUsed: 21000n,
          effectiveGasPrice: 1n,
          log: {
            seq: BigInt(r.seq),
            receiptHash: r.receiptHash,
            prevHead: r.prevHead,
            policyHash: r.policyHash,
            kind: 2,
            tokenIn: zeroAddress,
            amountIn: 0n,
            amountOut: 0n,
            minOut: 0n,
            refOut: 0n,
          },
        };
      });
      const opts = optionsSchema.parse({ exec: 'anvil', receipts: directory });
      const first = await tick(opts, policy, x.e);
      const second = await tick(opts, policy, x.e);
      const r = JSON.parse(await readFile(first.path, 'utf8'));
      expect(r.settlement.transactionHash).toBe(zeroHash);
      expect(receiptHash(r)).toBe(r.receiptHash);
      expect(second.receipt.seq).toBe(1n);
      expect(second.receipt.tx.nonce).toBe(1n);
      expect(x.send).toHaveBeenCalledTimes(2);
      expect(await readdir(join(directory, '31337'))).not.toContain(
        '.pending.json',
      );
    }));
  it('locks concurrent ticks', async () =>
    temporary(async (directory) => {
      await withLock(directory, async () => {
        await expect(withLock(directory, async () => {})).rejects.toThrow(
          'lock exists',
        );
      });
    }));
  it('loss stop is part of the deterministic engine replay', () => {
    const { evidence, mandate, state } = fixtureScenario(policy, 'trade');
    expect(
      decide(evidence, policy, mandate, {
        ...state,
        dailyLossB: policy.dailyLossStopB,
      }).kind,
    ).toBe('REJECT');
  });
  it('matches Solidity TickMath extrema, negative TWAP rounding and unit price', () => {
    expect(sqrtAtTick(-887272)).toBe(4295128739n);
    expect(sqrtAtTick(887272)).toBe(
      1461446703485210103287273052203988822378723970342n,
    );
    expect(meanTick(0n, -11n, 10)).toBe(-2);
    expect(meanTick(0n, 11n, 10)).toBe(1);
    expect(twapOutput(0, 123n, true)).toBe(123n);
    expect(twapOutput(0, 123n, false)).toBe(123n);
    expect(() => sqrtAtTick(887273)).toThrow();
  });
});
