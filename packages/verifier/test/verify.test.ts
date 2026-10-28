import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test, expect } from 'vitest';
import { encodeAbiParameters, keccak256, zeroAddress, zeroHash } from 'viem';
import { hash, receiptHash, type ReceiptBody } from '../../core/src/index.js';
import { verify, chainHead } from '../src/verify.js';
import { recordedReader } from '../src/recorded.js';
const dir = fileURLToPath(new URL('./fixtures/', import.meta.url));
const read = (path: string) =>
  JSON.parse(readFileSync(join(dir, path), 'utf8'));
const chain = read('chain.json');
const receipts = readdirSync(join(dir, 'receipts'))
  .sort()
  .map((name) => read('receipts/' + name));
const trade = receipts[0],
  wait = receipts[1];
const failures = (r: Awaited<ReturnType<typeof verify>>) =>
  r.checks.filter((c) => !c.pass).map((c) => c.name);
const rehash = (r: typeof trade) => {
  r.evidenceHash = hash(r.evidence);
  r.receiptHash = receiptHash(r as ReceiptBody);
};

describe('recorded genuine T5 fork execution', () => {
  test.each(receipts.map((r, i) => [i, r] as const))(
    'PASS receipt %s and walk all previous links',
    async (_i, r) => {
      const result = await verify(r, recordedReader(chain), { chain: 10 });
      expect(failures(result)).toEqual([]);
      expect(result.status).toBe('PASS');
    },
  );
  test.each([
    [
      'one evidence byte',
      (r: typeof trade) => {
        r.evidence.sources.demo.raw += '!';
      },
      'evidenceHash',
    ],
    [
      'decision kind',
      (r: typeof trade) => {
        r.decision.kind = 'WAIT';
      },
      'receiptHash',
    ],
    [
      'minOut',
      (r: typeof trade) => {
        r.tx.minOut = String(BigInt(r.tx.minOut) + 1n);
      },
      'receiptHash',
    ],
    [
      'prevHead',
      (r: typeof trade) => {
        r.prevHead = hash('wrong');
      },
      'receiptHash',
    ],
    [
      'policyHash',
      (r: typeof trade) => {
        r.policyHash = hash('wrong');
      },
      'receiptHash',
    ],
  ] as const)('FAIL %s', async (_name, mutate, check) => {
    const r = structuredClone(trade);
    mutate(r);
    const result = await verify(r, recordedReader(chain));
    expect(result.status).toBe('FAIL');
    expect(failures(result)).toEqual([check]);
  });
  test('FAIL different emitting contract', async () => {
    const c = structuredClone(chain);
    c.receipts[0].logs.forEach((l: { address: string }) => {
      l.address = zeroAddress;
    });
    const result = await verify(trade, recordedReader(c));
    expect(failures(result)).toEqual(['receipt_event']);
  });
  test('FAIL event policyHash mismatch', async () => {
    const c = structuredClone(chain);
    const log = c.receipts[0].logs.find(
      (l: { address: string }) =>
        l.address.toLowerCase() === trade.contract.toLowerCase(),
    );
    // seq/receiptHash are indexed; prevHead and policyHash are the first two data words.
    log.data =
      log.data.slice(0, 66) +
      hash('different-policy').slice(2) +
      log.data.slice(130);
    const result = await verify(trade, recordedReader(c));
    expect(failures(result)).toEqual(['event_policyHash']);
  });
  test.each([
    [
      'decision',
      (r: typeof trade) => {
        r.decision.kind = 'WAIT';
      },
      'decision_replay',
    ],
    [
      'policy',
      (r: typeof trade) => {
        r.evidence.sources.replay.raw.policy.dailyLossStopB += 1;
      },
      'policyHash',
    ],
    [
      'minOut',
      (r: typeof trade) => {
        r.tx.minOut = String(BigInt(r.tx.minOut) + 1n);
      },
      'event_receiptHash',
    ],
    [
      'prevHead',
      (r: typeof trade) => {
        r.prevHead = hash('changed');
      },
      'event_receiptHash',
    ],
  ] as const)('FAIL rehashed %s', async (_name, mutate, check) => {
    const r = structuredClone(trade);
    mutate(r);
    rehash(r);
    const result = await verify(r, recordedReader(chain));
    expect(failures(result)).toEqual([check]);
  });
  test('FAIL broken previous chain head despite a valid current event', async () => {
    const c = structuredClone(chain);
    const l = c.receipts[0].logs.find(
      (l: { address: string }) =>
        l.address.toLowerCase() === trade.contract.toLowerCase(),
    );
    l.topics[2] = hash('wrong earlier hash');
    const result = await verify(wait, recordedReader(c), { chain: 1 });
    expect(failures(result)).toEqual(['chain_prevHead']);
  });
  test('historical head includes multiple subsequent receipts mined in the same block', async () => {
    // Synthetic RPC response variation exercises multi-transaction block handling.
    const c = structuredClone(chain);
    const block = c.receipts[0].blockNumber;
    let head = chainHead(trade.prevHead, trade.receiptHash, BigInt(trade.seq));
    for (let i = 1; i <= 2; i++) {
      c.receipts[i].blockNumber = block;
      const log = c.receipts[i].logs.find(
        (l: { address: string }) =>
          l.address.toLowerCase() === trade.contract.toLowerCase(),
      );
      log.blockNumber = block;
      log.logIndex = c.receipts[0].logs.length + i;
      log.data = '0x' + head.slice(2) + log.data.slice(66);
      head = chainHead(head, receipts[i].receiptHash, BigInt(i));
    }
    c.heads[block] = head;
    const result = await verify(trade, recordedReader(c));
    expect(failures(result)).toEqual([]);
    expect(result.status).toBe('PASS');
  });
  test('FAIL historical head mismatch', async () => {
    const c = structuredClone(chain);
    c.heads[chain.receipts[0].blockNumber] = zeroHash;
    expect(failures(await verify(trade, recordedReader(c)))).toEqual([
      'head_after',
    ]);
  });
  test('FAIL wrong execution chain', async () => {
    const c = structuredClone(chain);
    c.chainId = 133;
    expect(failures(await verify(trade, recordedReader(c)))).toEqual([
      'rpc_chain',
    ]);
  });
  test('FAIL missing replay snapshot rather than guessing a current policy', async () => {
    const r = structuredClone(trade);
    delete r.evidence.sources.replay;
    rehash(r);
    expect(failures(await verify(r, recordedReader(chain)))).toEqual([
      'replay_snapshot',
    ]);
  });
  test('metrics use actual mined values and independent chain head formula', async () => {
    const r = await verify(trade, recordedReader(chain));
    expect(r.headAfter).toBe(
      keccak256(
        encodeAbiParameters(
          [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint64' }],
          [trade.prevHead, trade.receiptHash, BigInt(trade.seq)],
        ),
      ),
    );
    expect(r.metrics?.gasHSK).toBe(
      Number(
        BigInt(chain.receipts[0].gasUsed) *
          BigInt(chain.receipts[0].effectiveGasPrice),
      ) / 1e18,
    );
    expect(r.metrics?.realisedPrice).toBeGreaterThan(0);
    expect(r.metrics?.slippageQuoteBps).not.toBeNull();
  });
});
