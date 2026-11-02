import { it, expect } from 'vitest';
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
import { ownerReceiptHash } from '../../core/src/agent/owner-receipt.js';
import {
  sellSessionMessage,
  type SellSession,
} from '../../core/src/copilot.js';
import { canonical, hash } from '../../core/src/canonical.js';
import { verify, rpcReader } from '../src/verify.js';

it.skipIf(!hasAnvil).each([31337, 177] as const)(
  'two real local swaps reuse one owner session on local chain %i, verify independently and reject tampering',
  async (chainId) => {
    const h = await localVault(chainId);
    try {
      const owner = mnemonicToAccount(
        'test test test test test test test test test test test junk',
      );
      const browser = mnemonicToAccount(
        'test test test test test test test test test test test junk',
        { addressIndex: 9 },
      );
      const config = agentConfigSchema.parse({
        models: { strategist: 'mock', fitter: 'mock' },
        policyFile: '{}',
        ...(chainId === 177
          ? { executionChainId: 177, marketContext: 'fresh-dex-cex' }
          : {}),
      });
      config.policyFile = createAgentPolicy(config);
      await h.write(h.vault, 'setMandate', [
        { ...h.mandate, policyHash: agentPolicyHash(config.policyFile) },
      ]);
      const store = memoryStore(),
        provider = mockProvider([]);
      const agent = await createAgent({
        provider,
        store,
        config,
        clients: {
          readState: h.state,
          readOwner: async () => h.owner,
          quote: h.quote,
          simulate: h.simulate,
          send: h.send,
          evidenceLite: async () => ({ prices: {} }),
          collectEvidence: async () => ({
            marketDataChainId: 177,
            executionChainId: chainId,
            now: (await h.state()).blockTime,
          }),
        },
      });
      const first = await h.state();
      const delegation: SellSession = {
        version: 1,
        scope: 'SELL_WITHIN_MANDATE',
        owner: owner.address,
        vault: h.vault.address,
        chainId,
        sessionKey: browser.address,
        policyHash: first.mandate.policyHash,
        issuedAt: first.blockTime,
        expiresAt: first.blockTime + 900,
        nonce: zeroHash,
      };
      const ownerSignature = await owner.signMessage({
        message: sellSessionMessage(delegation),
      });
      for (let i = 0; i < 2; i++) {
        const s = await h.state(),
          preview = sellPreview(
            s,
            await h.quote(sellActionFor(s), s),
            delegation,
          );
        const signed = {
          delegation,
          ownerSignature,
          order: preview.order,
          orderSignature: await browser.signMessage({
            message: { raw: hash(preview.order) },
          }),
        };
        const receipt = await agent.executeOwnerSell(signed);
        const result = await verify(receipt, rpcReader(h.url), {
          agentStore: store,
        });
        expect(result.status, canonical(result.checks)).toBe('PASS');
        expect(provider.calls).toHaveLength(0);
        const changed = {
          ...receipt,
          authorization: { ...signed, order: { ...signed.order, minOut: '1' } },
        };
        changed.receiptHash = ownerReceiptHash(changed);
        expect(
          (await verify(changed, rpcReader(h.url), { agentStore: store }))
            .status,
        ).toBe('FAIL');
        await expect(agent.executeOwnerSell(signed)).rejects.toThrow();
        if (i === 0) await h.advance(301);
      }
      expect((await h.state()).balanceA).toBeLessThan(first.balanceA);
      expect((await h.state()).balanceB).toBeGreaterThan(first.balanceB);
    } finally {
      await h.stop();
    }
  },
  60000,
);
