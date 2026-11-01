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
      'validUntil',
      (r: typeof trade) => {
        r.tx.validUntil = r.tx.deadline - 1;
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
      'receipt_version',
    ],
    [
      'policy',
      (r: typeof trade) => {
        r.evidence.sources.replay.raw.policy.dailyLossStopB += 1;
      },
      'receipt_version',
    ],
    [
      'minOut',
      (r: typeof trade) => {
        r.tx.minOut = String(BigInt(r.tx.minOut) + 1n);
      },
      'receipt_version',
    ],
    [
      'validUntil',
      (r: typeof trade) => {
        r.tx.validUntil = r.tx.deadline - 1;
      },
      'event_receiptHash',
    ],
    [
      'prevHead',
      (r: typeof trade) => {
        r.prevHead = hash('changed');
      },
      'receipt_version',
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
      'receipt_version',
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

describe('T8 decision expiry', () => {
  const modernHold = () => {
    const r = structuredClone(wait);
    r.version = 2;
    r.evidence.executionBlockNumber = r.evidence.sources.replay.blockNumber;
    r.evidence.decisionTime = r.evidence.now;
    const until = r.evidence.now + 120;
    r.evidence.validUntil = until;
    r.evidence.riskInput = {
      sigma: 0.0045,
      observations: 719,
      historyHash: '0x' + 'a'.repeat(64),
    };
    r.decision.validUntil = until;
    r.tx.validUntil = until;
    r.tx.deadline = until;
    rehash(r);
    return r;
  };
  test('rejects mismatched committed expiry before touching the chain', async () => {
    const r = modernHold();
    r.tx.validUntil++;
    rehash(r);
    expect(failures(await verify(r, recordedReader(chain)))).toContain(
      'decision_expiry',
    );
  });
  test('rejects a receipt mined after its evidence expiry', async () => {
    const r = modernHold();
    const reader = {
      ...recordedReader(chain),
      timestamp: async (block: bigint) =>
        block === BigInt(r.evidence.executionBlockNumber)
          ? r.evidence.decisionTime
          : r.evidence.validUntil + 1,
    };
    const result = await verify(r, reader);
    expect(result.checks.find((c) => c.name === 'decision_expiry')?.pass).toBe(
      true,
    );
    expect(result.checks.find((c) => c.name === 'decision_replay')?.pass).toBe(
      true,
    );
    expect(failures(result)).toContain('mined_before_expiry');
  });
});

describe('v2 cannot opt out of required guards', () => {
  test.each(['validUntil', 'riskInput', 'both', 'downgrade'])(
    'rejects stripped %s even after rehash',
    async (field) => {
      const r = structuredClone(wait);
      r.version = 2;
      r.evidence.decisionTime = r.evidence.now;
      r.evidence.validUntil = r.evidence.now + 120;
      r.decision.validUntil = r.evidence.validUntil;
      r.tx.validUntil = r.evidence.validUntil;
      r.evidence.riskInput = {
        sigma: 0,
        observations: 719,
        historyHash: '0x' + 'a'.repeat(64),
      };
      if (field === 'validUntil' || field === 'both' || field === 'downgrade') {
        delete r.evidence.validUntil;
        delete r.decision.validUntil;
        delete r.tx.validUntil;
      }
      if (field === 'riskInput' || field === 'both' || field === 'downgrade')
        delete r.evidence.riskInput;
      if (field === 'downgrade') r.version = 1;
      rehash(r);
      const result = await verify(r, recordedReader(chain));
      expect(result.status).toBe('FAIL');
      expect(failures(result)).toContain(
        field === 'downgrade' ? 'receipt_version' : 'receipt_schema',
      );
    },
  );
  test.each([0, -5, 5])(
    'binds decisionTime to the snapshot block despite server-ahead wall time (tamper %s)',
    async (tamper) => {
      const r = structuredClone(wait);
      r.version = 2;
      r.evidence.executionBlockNumber = r.evidence.sources.replay.blockNumber;
      const blockTime = r.evidence.now - 5;
      r.evidence.decisionTime = blockTime + tamper;
      r.evidence.validUntil = r.evidence.decisionTime + 120;
      r.decision.validUntil = r.evidence.validUntil;
      r.tx.validUntil = r.evidence.validUntil;
      r.tx.deadline = r.evidence.validUntil;
      r.evidence.riskInput = {
        sigma: 0,
        observations: 719,
        historyHash: '0x' + 'a'.repeat(64),
      };
      rehash(r);
      const result = await verify(r, {
        ...recordedReader(chain),
        timestamp: async (block: bigint) =>
          block === BigInt(r.evidence.executionBlockNumber)
            ? blockTime
            : blockTime + 1,
      });
      expect(
        result.checks.find((c) => c.name === 'decision_time_binding')?.pass,
      ).toBe(tamper === 0);
      if (tamper !== 0)
        expect(failures(result)).toContain('decision_time_binding');
    },
  );
});
