import { it, expect } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mnemonicToAccount } from 'viem/accounts';
import { zeroHash } from 'viem';
import { localVault, hasAnvil } from '../../core/test/agent/anvil.js';
import { mockProvider } from '../../core/test/agent/fixtures.js';
import { memoryStore } from '../../core/src/agent/store.js';
import { createAgent } from '../../core/src/agent/agent.js';
import {
  agentConfigSchema,
  createAgentPolicy,
  agentPolicyHash,
} from '../../core/src/agent/policy.js';
import {
  sellActionFor,
  sellPreview,
} from '../../core/src/agent/owner-preview.js';
import {
  sellSessionMessage,
  type SellSession,
} from '../../core/src/copilot.js';
import { hash } from '../../core/src/canonical.js';
import { connectAgentRpc } from '../src/agent-rpc.js';
import { verify, rpcReader } from '../../verifier/src/verify.js';

it.skipIf(!hasAnvil)(
  'the real sender persists the v4 transaction hash and restart reconciliation recovers it without resending',
  async () => {
    const h = await localVault(),
      market = await localVault(177),
      root = await mkdtemp(join(tmpdir(), 'nalvis-owner-'));
    try {
      const owner = mnemonicToAccount(
        'test test test test test test test test test test test junk',
      );
      const dev = mnemonicToAccount(
        'test test test test test test test test test test test junk',
        { addressIndex: 1 },
      );
      const browser = mnemonicToAccount(
        'test test test test test test test test test test test junk',
        { addressIndex: 9 },
      );
      const config = agentConfigSchema.parse({
        models: { strategist: 'mock', fitter: 'mock' },
        policyFile: '{}',
      });
      config.policyFile = createAgentPolicy(config);
      await h.write(h.vault, 'setMandate', [
        { ...h.mandate, policyHash: agentPolicyHash(config.policyFile) },
      ]);
      const deployment = join(root, 'deployment.json');
      await writeFile(
        deployment,
        JSON.stringify({
          vault: h.vault.address,
          router: h.router.address,
          owner: h.owner,
          agent: h.agent,
          deployer: (await h.wallet.getAddresses())[2],
          block: 0,
          commit: '0'.repeat(40),
        }),
      );
      const env = {
        ANVIL_RPC: h.url,
        HSK_MAINNET_RPC: market.url,
        AGENT_DEPLOYMENT: deployment,
        AGENT_PRIVATE_KEY:
          '0x' + Buffer.from(dev.getHdKey().privateKey!).toString('hex'),
      };
      const store = memoryStore(),
        rpc = await connectAgentRpc('anvil', store, env);
      rpc.clients.quote = h.quote;
      rpc.clients.collectEvidence = async () => ({
        marketDataChainId: 177,
        executionChainId: 31337,
        now: (await h.state()).blockTime,
      });
      const send = rpc.clients.send;
      let sends = 0;
      rpc.clients.send = async (receipt) => {
        sends++;
        await send(receipt);
        throw Error('Injected disconnect after mined receipt');
      };
      const agent = await createAgent({
        provider: mockProvider([]),
        store,
        clients: rpc.clients,
        config,
      });
      const s = await h.state();
      const delegation: SellSession = {
        version: 1,
        scope: 'SELL_WITHIN_MANDATE',
        chainId: 31337,
        owner: h.owner,
        vault: h.vault.address,
        sessionKey: browser.address,
        policyHash: s.mandate.policyHash,
        issuedAt: s.blockTime,
        expiresAt: s.blockTime + 900,
        nonce: zeroHash,
      };
      const order = sellPreview(
        s,
        await h.quote(sellActionFor(s), s),
        delegation,
      ).order;
      const signed = {
        delegation,
        ownerSignature: await owner.signMessage({
          message: sellSessionMessage(delegation),
        }),
        order,
        orderSignature: await browser.signMessage({
          message: { raw: hash(order) },
        }),
      };
      await expect(agent.executeOwnerSell(signed)).rejects.toThrow(
        'settlement is uncertain',
      );
      const pending = await store.read<{ receiptHash: string }>('pending.json');
      expect(pending).toBeTruthy();
      expect(await store.read('.pending.json')).toBeTruthy();
      const restarted = await connectAgentRpc('anvil', store, env);
      await restarted.reconcile(agent.journal);
      expect(await store.read('pending.json')).toBeNull();
      const recovered = await store.read(
        `receipts/${pending!.receiptHash}.json`,
      );
      expect(
        (await verify(recovered, rpcReader(h.url), { agentStore: store }))
          .status,
      ).toBe('PASS');
      expect(sends).toBe(1);
      expect((await h.state()).nextNonce).toBe(1n);
    } finally {
      await h.stop();
      await market.stop();
      await rm(root, { recursive: true, force: true });
    }
  },
  60000,
);
