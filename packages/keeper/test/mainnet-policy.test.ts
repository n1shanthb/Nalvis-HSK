import { it, expect } from 'vitest';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeAbiParameters, decodeFunctionData } from 'viem';
import { addresses } from '../../core/src/addresses.js';
import { vaultAbi } from '../../core/src/abi/index.js';
import { agentPolicyHash } from '../../core/src/agent/policy.js';

it('mainnet policy generator uses 6-decimal tiny caps and makes no write RPC calls', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nalvis-mainnet-policy-'));
  await mkdir(join(root, 'policy'));
  const methods: string[] = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += String(chunk);
    const p = JSON.parse(body);
    methods.push(p.method);
    let result: unknown;
    if (p.method === 'eth_chainId') result = '0xb1';
    else if (p.method === 'eth_getBlockByNumber')
      result = {
        number: '0x1',
        timestamp: '0x6b000000',
        transactions: [],
        hash: '0x' + '1'.repeat(64),
      };
    else if (p.method === 'eth_call') {
      const call = p.params[0];
      if (call.data.startsWith('0x313ce567'))
        result = encodeAbiParameters(
          [{ type: 'uint8' }],
          [
            call.to.toLowerCase() === addresses[177].usdt.address.toLowerCase()
              ? 6
              : 18,
          ],
        );
      else
        result = encodeAbiParameters(
          [
            { type: 'uint256' },
            { type: 'uint160' },
            { type: 'uint32' },
            { type: 'uint256' },
          ],
          [10n ** 18n, 1n, 0, 100000n],
        );
    } else {
      res.writeHead(400);
      res.end('Unexpected RPC method');
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ jsonrpc: '2.0', id: p.id, result }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  try {
    const port = (server.address() as { port: number }).port;
    const script = fileURLToPath(
      new URL('../mainnet-policy.mjs', import.meta.url),
    );
    const env = {
      ...process.env,
      HSK_MAINNET_RPC: `http://127.0.0.1:${port}`,
      STRATEGIST_MODEL: 'test/strategy',
      FITTER_MODEL: 'test/fitter',
      AGENT_ADDRESS: addresses[177].whsk.address,
    };
    const { stdout } = await promisify(execFile)(process.execPath, [script], {
      cwd: root,
      env,
    });
    const output = JSON.parse(stdout),
      policy = await readFile(
        join(root, 'policy/agent-mainnet-v3.json'),
        'utf8',
      );
    expect(output.policyHash).toBe(agentPolicyHash(policy));
    const decoded = decodeFunctionData({
      abi: vaultAbi,
      data: output.calldata,
    });
    expect(decoded.functionName).toBe('setMandate');
    const m = (
      decoded.args as unknown as [
        { maxTradeInB: bigint; maxDailyInB: bigint; policyHash: string },
      ]
    )[0];
    expect(m.maxTradeInB).toBe(100000n);
    expect(m.maxDailyInB).toBe(500000n);
    expect(m.policyHash).toBe(output.policyHash);
    expect(
      methods.every((m) =>
        ['eth_chainId', 'eth_getBlockByNumber', 'eth_call'].includes(m),
      ),
    ).toBe(true);
    await expect(
      promisify(execFile)(process.execPath, [script], { cwd: root, env }),
    ).rejects.toThrow();
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await rm(root, { recursive: true, force: true });
  }
}, 20000);
