import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  encodeAbiParameters,
  parseAbiParameters,
  decodeFunctionData,
} from 'viem';
import { addresses } from '../../core/src/addresses.js';
import { fundingPlan } from '../src/testnet-plan.js';
const q = 2n ** 96n;
it('computes raw ceil caps from execution price, handles both pool orientations and token decimals', () => {
  const a = addresses[133];
  // token0 USDT, token1 WHSK; price 64 B/A => sqrt=1/8.
  const plan = fundingPlan({
    sqrtPriceX96: q / 8n,
    token0: a.usdt.address,
    decimalsA: 18,
    decimalsB: 18,
    now: 1000,
  });
  expect(plan.execPrice).toBe('64');
  expect(plan.mandate.maxTradeInA).toBe(468750000000000000n);
  expect(plan.mandate.maxTradeInB).toBe(25n * 10n ** 18n);
  expect(plan.wrap).toBeGreaterThan(10n ** 18n);
  expect(plan.vaultNeedB).toBe(50n * 10n ** 18n);
  const reverse = fundingPlan({
    sqrtPriceX96: q * 8n,
    token0: a.whsk.address,
    decimalsA: 18,
    decimalsB: 18,
    now: 1000,
  });
  expect(reverse.priceB).toBe(plan.priceB);
  const funded = fundingPlan({
    sqrtPriceX96: q / 8n,
    token0: a.usdt.address,
    decimalsA: 18,
    decimalsB: 18,
    now: 1000,
    balanceB: 60n * 10n ** 18n,
    balanceA: 10n ** 18n,
    vaultA: 10n ** 18n,
    vaultB: 50n * 10n ** 18n,
  });
  expect(funded.swapIn).toBe(0n);
  expect(funded.wrap).toBe(0n);
  expect(funded.vaultNeedA).toBe(0n);
  expect(funded.vaultNeedB).toBe(0n);
  expect(() =>
    fundingPlan({
      sqrtPriceX96: 0n,
      token0: a.usdt.address,
      decimalsA: 18,
      decimalsB: 6,
      now: 0,
    }),
  ).toThrow('price');
});
it('bash dry-run reads a mocked 133 RPC and prints computed funding/caps without writes', async () => {
  const { parseAbi } = await import('viem');
  const abi = parseAbi([
    'function slot0() view returns(uint160,int24,uint16,uint16,uint16,uint8,bool)',
    'function token0() view returns(address)',
    'function decimals() view returns(uint8)',
  ]);
  let writes = 0;
  const rpc = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(Buffer.from(c));
    const body = JSON.parse(Buffer.concat(chunks).toString());
    let result: unknown;
    if (body.method === 'eth_chainId') result = '0x85';
    else if (body.method === 'eth_getBlockByNumber')
      result = {
        number: '0x1',
        timestamp: '0x6a000000',
        hash: '0x' + '1'.repeat(64),
        parentHash: '0x' + '0'.repeat(64),
        transactions: [],
      };
    else if (body.method === 'eth_call') {
      const call = decodeFunctionData({ abi, data: body.params[0].data });
      if (call.functionName === 'slot0')
        result = encodeAbiParameters(
          parseAbiParameters('uint160,int24,uint16,uint16,uint16,uint8,bool'),
          [q / 8n, 0, 0, 16, 16, 0, true],
        );
      else if (call.functionName === 'token0')
        result = encodeAbiParameters(parseAbiParameters('address'), [
          addresses[133].usdt.address,
        ]);
      else result = encodeAbiParameters(parseAbiParameters('uint8'), [18]);
    } else {
      writes++;
      res.statusCode = 400;
      result = null;
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }));
  });
  await new Promise<void>((r, e) => {
    rpc.once('error', e);
    rpc.listen(0, '127.0.0.1', r);
  });
  const dir = await mkdtemp(join(tmpdir(), 'setup-dry-'));
  // cast shim supplies the read-only chain check; all actual plan reads hit mocked HTTP RPC.
  await writeFile(
    join(dir, 'cast'),
    '#!/usr/bin/env bash\n[[ $1 == chain-id ]] || exit 99\necho 133\n',
  );
  await chmod(join(dir, 'cast'), 0o755);
  try {
    const child = spawn('bash', ['scripts/testnet-setup.sh', '--dry-run'], {
      cwd: new URL('../../../', import.meta.url).pathname,
      env: {
        ...process.env,
        PATH: dir + ':' + process.env.PATH,
        HSK_TESTNET_RPC: `http://127.0.0.1:${(rpc.address() as { port: number }).port}`,
        DEPLOYER_ADDRESS: '',
        VAULT_ADDRESS: '',
      },
    });
    let out = '';
    child.stdout.on('data', (d) => {
      out += d;
    });
    child.stderr.on('data', (d) => {
      out += d;
    });
    const code = await new Promise<number | null>((r) => child.once('exit', r));
    expect(code, out).toBe(0);
    expect(out).toContain('Execution price: 64');
    expect(out).toContain('468750000000000000');
    expect(out).toContain('DRY RUN');
    expect(writes).toBe(0);
  } finally {
    rpc.closeAllConnections();
    await new Promise<void>((r) => rpc.close(() => r()));
    await rm(dir, { recursive: true, force: true });
  }
});
