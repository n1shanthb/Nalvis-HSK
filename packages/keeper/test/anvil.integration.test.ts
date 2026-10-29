import { it, expect } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  mkdir,
  writeFile,
} from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseAbi,
  zeroAddress,
  zeroHash,
  type Abi,
  type Hex,
} from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import {
  addresses,
  policyHash,
  units,
  receiptHash,
  canonical,
} from '../../core/src/index.js';
import { vaultAbi, erc20Abi } from '../../core/src/abi/index.js';
import { connectExecution, PUBLIC_ANVIL_MNEMONIC } from '../src/execution.js';
import { loadPolicy, optionsSchema, repositoryRoot } from '../src/config.js';
import { fixtureScenario } from '../src/demo.js';
import { main } from '../src/cli.js';
const rpc = process.env.HSK_MAINNET_RPC;
const found =
  spawnSync('anvil', ['--version'], { stdio: 'ignore' }).status === 0;
const reason = !found
  ? 'anvil binary unavailable'
  : !rpc
    ? 'HSK_MAINNET_RPC unset'
    : !process.env.FORK_BLOCK_177
      ? 'FORK_BLOCK_177 unset'
      : undefined;
if (reason) console.warn(`SKIP keeper anvil fork integration: ${reason}`);
it.skipIf(!!reason)(
  'CLI on a pinned 177 fork: TRADE, WAIT, RESIZE, REJECT and revoke',
  async (context) => {
    const root = repositoryRoot(),
      directory = await mkdtemp(join(tmpdir(), 'keeper-fork-'));
    let child: ChildProcess | undefined;
    try {
      const chain = defineChain({
        id: 31337,
        name: 'anvil',
        nativeCurrency: { name: 'HSK', symbol: 'HSK', decimals: 18 },
        rpcUrls: { default: { http: ['http://127.0.0.1:18545'] } },
      });
      // Preflight read-only RPC. Reachability failures skip clearly; contract/assertion failures never skip.
      const remote = createPublicClient({
        transport: http(rpc, { retryCount: 0, timeout: 5000 }),
      });
      try {
        expect(await remote.getChainId()).toBe(177);
        await remote.getBlock({
          blockNumber: BigInt(process.env.FORK_BLOCK_177!),
        });
      } catch (error) {
        console.warn(
          `SKIP keeper fork integration: RPC preflight failed (${error instanceof Error ? error.name : 'RPC error'})`,
        );
        context.skip();
        return;
      }
      const artifactPath = join(
        root,
        'contracts/out/EdgewiseVault.sol/EdgewiseVault.json',
      );
      if (!existsSync(artifactPath)) {
        const build = spawnSync('forge', ['build'], {
          cwd: join(root, 'contracts'),
          encoding: 'utf8',
        });
        expect(build.status, `forge build failed: ${build.stderr}`).toBe(0);
      }
      child = spawn(
        'anvil',
        [
          '--fork-url',
          rpc!,
          '--fork-block-number',
          process.env.FORK_BLOCK_177!,
          '--chain-id',
          '31337',
          '--port',
          '18545',
          '--silent',
        ],
        { stdio: 'ignore' },
      );
      const client = createPublicClient({
        chain,
        transport: http(chain.rpcUrls.default.http[0], {
          retryCount: 0,
          timeout: 2000,
        }),
      });
      let ready = false;
      for (let i = 0; i < 50; i++) {
        try {
          if ((await client.getChainId()) === 31337) {
            ready = true;
            break;
          }
        } catch {
          /* bounded startup polling */
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(
        ready,
        'Anvil failed to start after successful RPC preflight',
      ).toBe(true);
      const owner = mnemonicToAccount(PUBLIC_ANVIL_MNEMONIC, {
        addressIndex: 0,
      });
      const agent = mnemonicToAccount(PUBLIC_ANVIL_MNEMONIC, {
        addressIndex: 1,
      });
      const deployer = mnemonicToAccount(PUBLIC_ANVIL_MNEMONIC, {
        addressIndex: 2,
      });
      const ownerWallet = createWalletClient({
        account: owner,
        chain,
        transport: http(chain.rpcUrls.default.http[0]),
      });
      const deployWallet = createWalletClient({
        account: deployer,
        chain,
        transport: http(chain.rpcUrls.default.http[0]),
      });
      const artifact = JSON.parse(await readFile(artifactPath, 'utf8'));
      const cfg = addresses[177];
      const deployTx = await deployWallet.deployContract({
        abi: artifact.abi as Abi,
        bytecode: artifact.bytecode.object as Hex,
        args: [
          owner.address,
          cfg.swapRouter02.address,
          cfg.primaryPool.address,
          cfg.whsk.address,
          cfg.usdt.address,
          3000,
          600,
          zeroAddress,
          0,
          0,
        ],
      });
      const deployed = await client.waitForTransactionReceipt({
        hash: deployTx,
      });
      expect(deployed.status).toBe('success');
      const vault = deployed.contractAddress!;
      const routerArtifact = JSON.parse(
        await readFile(
          join(
            root,
            'contracts/out/ProofTradeRouter.sol/ProofTradeRouter.json',
          ),
          'utf8',
        ),
      );
      const routerTx = await deployWallet.deployContract({
        abi: routerArtifact.abi,
        bytecode: routerArtifact.bytecode.object,
        args: [owner.address, cfg.swapRouter02.address],
      });
      const router = (
        await client.waitForTransactionReceipt({ hash: routerTx })
      ).contractAddress!;
      const recording: {
        receipts: unknown[];
        transactions: unknown[];
        heads: Record<string, string>;
        configs: Record<string, unknown>;
      } = { receipts: [], transactions: [], heads: {}, configs: {} };
      // Transfer fork-only test funds from the pool by impersonation; never any remote writes.
      const local = createWalletClient({
        chain,
        transport: http(chain.rpcUrls.default.http[0]),
      });
      await client.request({
        method: 'anvil_impersonateAccount' as never,
        params: [cfg.primaryPool.address] as never,
      });
      await client.request({
        method: 'anvil_setBalance' as never,
        params: [cfg.primaryPool.address, '0x56bc75e2d63100000'] as never,
      });
      const transfer = await local.writeContract({
        account: cfg.primaryPool.address,
        address: cfg.usdt.address,
        abi: parseAbi(['function transfer(address,uint256) returns (bool)']),
        functionName: 'transfer',
        args: [vault, units(900, 6)],
      });
      expect(
        (await client.waitForTransactionReceipt({ hash: transfer })).status,
      ).toBe('success');
      await client.request({
        method: 'anvil_stopImpersonatingAccount' as never,
        params: [cfg.primaryPool.address] as never,
      });
      const policy = loadPolicy();
      async function mandate(cap = 100) {
        const now = Number((await client.getBlock()).timestamp);
        const hash = await ownerWallet.writeContract({
          address: vault,
          abi: vaultAbi,
          functionName: 'setMandate',
          args: [
            {
              agent: agent.address,
              expiry: BigInt(
                Math.max(now, Math.floor(Date.now() / 1000)) + 86400,
              ),
              maxTradeInA: units(100000, 18),
              maxTradeInB: units(cap, 6),
              maxDailyInB: units(10000, 6),
              maxExposureBps: 10000,
              maxSlippageBps: 100,
              minIntervalSec: 0n,
              policyHash: policyHash(policy),
            },
          ],
        });
        expect((await client.waitForTransactionReceipt({ hash })).status).toBe(
          'success',
        );
      }
      await mandate();
      const old = process.env.ANVIL_RPC;
      process.env.ANVIL_RPC = chain.rpcUrls.default.http[0];
      try {
        const execution = await connectExecution(
          optionsSchema.parse({ exec: 'anvil', receipts: directory }),
          policy,
          {
            vault,
            router,
            owner: owner.address,
            agent: agent.address,
            deployer: deployer.address,
            block: deployed.blockNumber,
            commit: 'aa395ae38dee9d01a17d13b12f1b837e29d09a36',
          },
        );
        for (const [scenario, kind] of [
          ['trade', 'TRADE'],
          ['wait', 'WAIT'],
          ['resize', 'RESIZE'],
          ['reject', 'REJECT'],
        ] as const) {
          if (scenario === 'resize') await mandate(50);
          await client.request({
            method: 'evm_increaseTime' as never,
            params: [601] as never,
          });
          await client.request({ method: 'evm_mine' as never });
          execution.collect = async (s) => {
            const f = fixtureScenario(policy, scenario, s.now);
            f.evidence.executionBlockNumber = await client.getBlockNumber();
            const slot = await client.readContract({
              address: cfg.primaryPool.address,
              abi: parseAbi([
                'function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)',
              ]),
              functionName: 'slot0',
            });
            const mid = (Number(slot[0]) ** 2 / 2 ** 192) * 1e12;
            f.evidence.dexMid = mid;
            for (const c of f.evidence.cex) {
              c.bid = mid * 1.02;
              c.ask = mid * 1.02;
            }
            if (f.evidence.apro) f.evidence.apro.price = mid * 1.02;
            if (scenario === 'wait')
              for (const c of f.evidence.cex) {
                c.bid = mid;
                c.ask = mid;
              }
            for (const q of f.evidence.quotes) {
              q.amountIn =
                q.direction === 'BUY_A'
                  ? units(q.sizeB, 6)
                  : units(q.sizeB / mid, 18);
              q.quotedOut =
                q.direction === 'BUY_A'
                  ? units((q.sizeB / mid) * 0.997, 18)
                  : units(q.sizeB * 0.997, 6);
            }
            // Synthetic market evidence only. Real balances/caps and execution quote stay on chain.
            return f.evidence;
          };
          await main(
            [
              'run',
              '--once',
              '--exec',
              'anvil',
              '--demo',
              scenario,
              '--receipts',
              directory,
            ],
            execution,
          );
          const seq = await client.readContract({
            address: vault,
            abi: vaultAbi,
            functionName: 'seq',
          });
          const name = (await readdir(join(directory, '31337'))).find((f) =>
            f.startsWith(`${seq - 1n}-`),
          );
          const r = JSON.parse(
            await readFile(join(directory, '31337', name!), 'utf8'),
          );
          expect(r.decision.kind).toBe(kind);
          // Verify against RPC while the real fork is alive, including its prior links.
          const { verify, rpcReader } =
            await import('../../verifier/src/verify.js');
          const reader = rpcReader(chain.rpcUrls.default.http[0]);
          const verified = await verify(r, reader, {
            txHash: r.settlement.transactionHash,
            chain: 4,
          });
          expect(
            verified.checks.filter((c) => !c.pass),
            JSON.stringify(verified.checks),
          ).toEqual([]);
          expect(verified.status).toBe('PASS');
          const { main: verifyCLI } = await import('../../verifier/src/cli.js');
          const output: string[] = [];
          expect(
            await verifyCLI(
              [
                r.settlement.transactionHash,
                '--receipt',
                join(directory, '31337', name!),
                '--rpc',
                chain.rpcUrls.default.http[0],
                '--chain',
                '4',
                '--json',
              ],
              (s) => output.push(s),
            ),
          ).toBe(0);
          expect(JSON.parse(output[0]).status).toBe('PASS');
          if (process.env.VERIFIER_FIXTURE_DIR) {
            const dir = process.env.VERIFIER_FIXTURE_DIR;
            await mkdir(join(dir, 'receipts'), { recursive: true });
            await writeFile(join(dir, 'receipts', name!), canonical(r) + '\n');
            const mined = await client.getTransactionReceipt({
              hash: r.settlement.transactionHash,
            });
            recording.receipts.push(mined);
            recording.transactions.push(
              await client.getTransaction({ hash: mined.transactionHash }),
            );
            recording.heads[String(mined.blockNumber)] = await reader.head(
              vault,
              mined.blockNumber,
            );
            recording.configs[String(mined.blockNumber)] = await reader.config(
              vault,
              mined.blockNumber,
            );
            await writeFile(
              join(dir, 'chain.json'),
              canonical({ chainId: 31337, ...recording }) + '\n',
            );
          }
          expect(receiptHash(r)).toBe(r.receiptHash);
          expect(r.settlement.log.receiptHash).toBe(r.receiptHash);
          expect(
            await client.readContract({
              address: cfg.usdt.address,
              abi: erc20Abi,
              functionName: 'allowance',
              args: [vault, cfg.swapRouter02.address],
            }),
          ).toBe(0n);
        }
        const revoke = await ownerWallet.writeContract({
          address: vault,
          abi: vaultAbi,
          functionName: 'revoke',
        });
        await client.waitForTransactionReceipt({ hash: revoke });
        await expect(
          main(
            ['run', '--once', '--exec', 'anvil', '--receipts', directory],
            execution,
          ),
        ).rejects.toThrow(/revoked/);
        await expect(
          client.simulateContract({
            account: agent,
            address: vault,
            abi: vaultAbi,
            functionName: 'trade',
            args: [
              {
                tokenIn: cfg.usdt.address,
                amountIn: 1n,
                minOut: 1n,
                deadline: BigInt(
                  Number((await client.getBlock()).timestamp) + 120,
                ),
                validUntil: BigInt(
                  Number((await client.getBlock()).timestamp) + 120,
                ),
                nonce: await client.readContract({
                  address: vault,
                  abi: vaultAbi,
                  functionName: 'nextNonce',
                }),
                receiptHash: zeroHash,
                prevHead: await client.readContract({
                  address: vault,
                  abi: vaultAbi,
                  functionName: 'head',
                }),
                kind: 0,
              },
            ],
          }),
        ).rejects.toThrow();
      } finally {
        if (old === undefined) delete process.env.ANVIL_RPC;
        else process.env.ANVIL_RPC = old;
      }
    } finally {
      child?.kill('SIGTERM');
      await rm(directory, { recursive: true, force: true });
    }
  },
  120000,
);
