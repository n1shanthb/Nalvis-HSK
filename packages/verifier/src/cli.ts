#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { verify, rpcReader, type Verification } from './verify.js';
import { recordedReader } from './recorded.js';
import { pnl } from './pnl.js';
const usage =
  'Usage: verify <txHash|receipt.json> [--receipt path] [--rpc url] [--chain N] [--json] [--receipts folder] | verify --pnl folder [options]';
async function files(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return (
    await Promise.all(
      entries
        .filter((e) => !e.name.startsWith('.'))
        .map((e) =>
          e.isDirectory()
            ? files(join(dir, e.name))
            : e.name.endsWith('.json')
              ? [join(dir, e.name)]
              : [],
        ),
    )
  ).flat();
}
const load = async (path: string): Promise<unknown> =>
  JSON.parse(await readFile(path, 'utf8'));
export async function main(
  argv = process.argv.slice(2),
  out: (s: string) => void = (s) => {
    process.stdout.write(s + '\n');
  },
): Promise<number> {
  let json = argv.includes('--json');
  try {
    if (argv[0] === 'verify') argv = argv.slice(1);
    const flags: Record<string, string> = {};
    let target: string | undefined;
    for (let i = 0; i < argv.length; i++) {
      const a = argv[i];
      if (a === '--json') continue;
      if (a.startsWith('--')) {
        if (
          ![
            '--receipt',
            '--rpc',
            '--chain',
            '--pnl',
            '--receipts',
            '--recorded',
            '--agent-root',
          ].includes(a) ||
          flags[a] !== undefined ||
          !argv[i + 1] ||
          argv[i + 1].startsWith('--')
        )
          throw Error(usage);
        flags[a] = argv[++i];
      } else if (!target) target = a;
      else throw Error(usage);
    }
    json = argv.includes('--json');
    const chain = flags['--chain'] === undefined ? 1 : Number(flags['--chain']);
    if (!Number.isSafeInteger(chain) || chain < 0 || chain > 10000)
      throw Error('chain_depth: must be 0..10000');
    const reader = flags['--recorded']
      ? recordedReader(await load(flags['--recorded']))
      : rpcReader(
          flags['--rpc'] ??
            process.env.ANVIL_RPC ??
            process.env.HSK_TESTNET_RPC ??
            'http://127.0.0.1:8545',
        );
    const hashes = /^0x[0-9a-fA-F]{64}$/;
    const paths = flags['--pnl'] ? await files(flags['--pnl']) : [];
    let txHash: `0x${string}` | undefined;
    if (!flags['--pnl']) {
      if (!target) throw Error(usage);
      if (hashes.test(target)) {
        txHash = target as `0x${string}`;
        if (flags['--receipt']) paths.push(flags['--receipt']);
        else {
          const matches = [];
          for (const path of await files(flags['--receipts'] ?? 'receipts')) {
            const r = z
              .object({
                settlement: z
                  .object({ transactionHash: z.string() })
                  .passthrough()
                  .optional(),
              })
              .passthrough()
              .parse(await load(path));
            if (
              r.settlement?.transactionHash.toLowerCase() ===
              target.toLowerCase()
            )
              matches.push(path);
          }
          if (matches.length !== 1)
            throw Error('receipt_lookup: expected one receipt; use --receipt');
          paths.push(matches[0]);
        }
      } else paths.push(flags['--receipt'] ?? target);
    }
    const agentStore = flags['--agent-root']
      ? (await import('../../core/src/agent/store.js')).jsonFileStore(
          flags['--agent-root'],
        )
      : undefined;
    const results: Verification[] = [];
    for (const path of paths)
      results.push(
        await verify(await load(path), reader, { txHash, chain, agentStore }),
      );
    const pass =
      results.length > 0 && results.every((r) => r.status === 'PASS');
    const profit = flags['--pnl'] && pass ? pnl(results) : undefined;
    const report = {
      status: pass ? 'PASS' : 'FAIL',
      source: flags['--recorded']
        ? 'recorded RPC replay (offline; not live chain proof)'
        : 'execution RPC',
      results,
      ...(profit ? { pnl: profit } : {}),
    };
    if (json)
      out(
        JSON.stringify(report, (_, v) =>
          typeof v === 'bigint' ? String(v) : v,
        ),
      );
    else {
      out(`${report.status} — ${report.source}`);
      for (const r of results) {
        out(r.label);
        out('CHECK                         RESULT');
        for (const c of r.checks)
          out(
            `${c.name.padEnd(29)} ${c.pass ? 'PASS' : 'FAIL'}${c.detail ? ' ' + c.detail : ''}`,
          );
        if (r.metrics) {
          const m = r.metrics;
          out(`Realised price (tokenB/tokenA) ${m.realisedPrice ?? 'n/a'}`);
          out(
            `Slippage vs quote / TWAP (bps) ${m.slippageQuoteBps ?? 'n/a'} / ${m.slippageTwapBps ?? 'n/a'}`,
          );
          out(
            `Pool fee (input units, rounded up; rate ${m.poolFeeRatePpm} ppm) ${m.poolFeeInput}`,
          );
          out(
            `Gas ${m.gasUsed} × ${m.effectiveGasPrice} wei = ${m.gasHSK} HSK / ${m.gasUSD ?? 'unavailable'} USD`,
          );
        }
      }
      if (profit)
        out(
          `P&L vs hold: ${profit.excessVsHoldUSD.toFixed(6)} USD after gas\n${profit.assumptions}`,
        );
    }
    return pass ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (json)
      out(
        JSON.stringify({
          status: 'FAIL',
          checks: [{ name: 'cli_input', pass: false, detail: message }],
        }),
      );
    else out(`FAIL cli_input: ${message}`);
    return 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().then((code) => {
    process.exitCode = code;
  });
