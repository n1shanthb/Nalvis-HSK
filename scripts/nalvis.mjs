#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const { createPublicClient, http } = createRequire(
  new URL('../packages/core/package.json', import.meta.url),
)('viem');
import { readFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import {
  desk,
  receiptSequenceOrder,
  canonical,
  parseEvidenceJSON,
  policySchema,
  mandateSchema,
  readDeskMandate,
} from '../packages/core/dist/index.js';
import {
  verify,
  rpcReader,
} from '../packages/verifier/dist/verifier/src/verify.js';
import { recordedReader } from '../packages/verifier/dist/verifier/src/recorded.js';
import { pnl } from '../packages/verifier/dist/verifier/src/pnl.js';
export async function runDesk(argv, dependencies = {}) {
  const args = [...argv];
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
        '../packages/verifier/test/fixtures/t8/receipts/',
        import.meta.url,
      );
      reader = recordedReader(
        JSON.parse(
          await readFile(
            new URL(
              '../packages/verifier/test/fixtures/t8/chain.json',
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
    receipts.sort(receiptSequenceOrder);
    const results = await Promise.all(receipts.map((r) => verify(r, reader)));
    const portfolio = pnl(results);
    const latestPriced = [...receipts]
      .reverse()
      .find((r) => r.evidence.dexMid && r.evidence.cex.length === 2);
    const evidence = parseEvidenceJSON(
      canonical((latestPriced ?? receipts.at(-1)).evidence),
    );
    const raw = parseEvidenceJSON(canonical(receipts.at(-1).evidence)).sources
      .replay.raw;
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
      results.at(-1).receipt.settlement.transactionHash,
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
      evidenceLabel: 'Recorded receipt snapshot; not a live quote',
      portfolio,
      policy: policySchema.parse(raw.policy),
      mandate,
    };
    if (!demo) {
      delete context.mandate;
      delete context.agent;
      try {
        if (
          receipts.some(
            (r) =>
              r.contract.toLowerCase() !== receipts[0].contract.toLowerCase(),
          )
        )
          throw Error('Mixed receipt vaults');
        const client = (
          dependencies.clientFor ??
          ((url) => createPublicClient({ transport: http(url) }))
        )(args[3]);
        Object.assign(
          context,
          await readDeskMandate(
            client,
            receipts[0].contract,
            receipts[0].executionChainId,
            context.policy,
          ),
        );
      } catch (e) {
        context.proposalError = e.message;
      }
    }
  }
  return desk(text, context);
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  console.log(JSON.stringify(await runDesk(process.argv.slice(2)), null, 2));
