#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import {
  desk,
  canonical,
  parseEvidenceJSON,
  policySchema,
  mandateSchema,
} from '../packages/core/dist/index.js';
import {
  verify,
  rpcReader,
} from '../packages/verifier/dist/verifier/src/verify.js';
import { recordedReader } from '../packages/verifier/dist/verifier/src/recorded.js';
import { pnl } from '../packages/verifier/dist/verifier/src/pnl.js';
const args = process.argv.slice(2);
if (args.shift() !== 'desk')
  throw Error(
    'Usage: pnpm nalvis desk "<text>" [--demo | --receipts <directory> --rpc <url>]',
  );
const text = args.shift() ?? '';
let context = {};
if (args.length) {
  const demo = args[0] === '--demo';
  let dir, reader;
  if (demo) {
    if (args.length !== 1) throw Error('Unknown desk options');
    dir = new URL(
      '../packages/verifier/test/fixtures/receipts/',
      import.meta.url,
    );
    reader = recordedReader(
      JSON.parse(
        await readFile(
          new URL(
            '../packages/verifier/test/fixtures/chain.json',
            import.meta.url,
          ),
          'utf8',
        ),
      ),
    );
  } else {
    if (args.length !== 4 || args[0] !== '--receipts' || args[2] !== '--rpc')
      throw Error('Expected --receipts <directory> --rpc <url>');
    dir = resolve(args[1]);
    reader = rpcReader(args[3]);
  }
  const files = (await readdir(dir)).filter((f) =>
    /^\d+-0x[0-9a-f]{64}\.json$/.test(f),
  );
  const receipts = await Promise.all(
    files.map((f) =>
      readFile(
        dir instanceof URL ? new URL(f, dir) : join(dir, f),
        'utf8',
      ).then(JSON.parse),
    ),
  );
  const results = await Promise.all(receipts.map((r) => verify(r, reader)));
  const portfolio = pnl(results);
  const evidence = parseEvidenceJSON(canonical(receipts.at(-1).evidence));
  const raw = evidence.sources.replay.raw;
  const mandate = mandateSchema.parse({
    ...raw.mandate,
    ...Object.fromEntries(
      ['maxTradeInA', 'maxTradeInB', 'maxDailyInB'].map((k) => [
        k,
        BigInt(raw.mandate[k]),
      ]),
    ),
  });
  const transaction = await reader.transaction(
    results[0].receipt.settlement.transactionHash,
  );
  const agent =
    typeof transaction.from === 'string' &&
    /^0x[0-9a-fA-F]{40}$/.test(transaction.from)
      ? transaction.from
      : undefined;
  context = {
    agent,
    receipts: results.map((r) => r.receipt),
    evidence,
    portfolio,
    policy: policySchema.parse(raw.policy),
    mandate,
  };
}
console.log(JSON.stringify(desk(text, context), null, 2));
