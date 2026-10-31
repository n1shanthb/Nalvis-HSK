import { openRouter } from '../../core/src/agent/provider.js';
import { it, expect } from 'vitest';
import { zeroHash } from 'viem';
import { localVault, hasAnvil } from '../../core/test/agent/anvil.js';
import { output, action } from '../../core/test/agent/fixtures.js';
import { memoryStore } from '../../core/src/agent/store.js';
import {
  agentConfigSchema,
  createAgentPolicy,
  agentPolicyHash,
} from '../../core/src/agent/policy.js';
import { createAgent } from '../../core/src/agent/agent.js';
import { verify, rpcReader } from '../src/verify.js';
import { receiptHashV3 } from '../../core/src/agent/receipt.js';
import { canonical } from '../../core/src/canonical.js';
it.skipIf(!hasAnvil)(
  'v3 generated local anvil run: 3 wakes, watch edit, fitted trade, anchor and tampering',
  async () => {
    const h = await localVault();
    try {
      const store = memoryStore();
      let config = agentConfigSchema.parse({
        models: { strategist: 'mock', fitter: 'mock' },
        policyFile: '{}',
        heartbeatSec: 300,
        anchorSec: 600,
        dailyLlmBudgetUsd: 10,
      });
      config = { ...config, policyFile: createAgentPolicy(config) };
      await h.write(h.vault, 'setMandate', [
        { ...h.mandate, policyHash: agentPolicyHash(config.policyFile) },
      ]);
      const first = output(action('1', 'HOLD'));
      first.watches.create.push({
        id: 'check',
        kind: { type: 'time', everySec: 300 },
        note: 'revisit',
        cooldownSec: 60,
      });
      const second = output(action('200'));
      second.watches.update.push({
        id: 'check',
        patch: { note: 'edited' },
        reason: 'refine',
      });
      let now = Number((await h.client.getBlock()).timestamp);
      const responses: unknown[] = [
        first,
        second,
        {
          proposal: {
            type: 'BUY',
            legs: [
              { notionalB: '50', notBefore: now + 600 },
              { notionalB: '50', notBefore: now + 900 },
            ],
            directionChanged: false,
          },
          explanation: 'fit cap across cooldown',
        },
        { decision: 'accept', reason: 'preserve intent' },
        output(action('1', 'HOLD')),
      ];
      const provider = openRouter(
        {
          AGENT_OPENROUTER_API_KEY: 'test-only-placeholder',
          STRATEGIST_MODEL: 'mock',
          FITTER_MODEL: 'mock',
        },
        async (url, init) => {
          expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
          expect(JSON.parse(String(init?.body))).toMatchObject({
            model: 'mock',
            response_format: { type: 'json_object' },
            temperature: 0,
          });
          return Response.json({
            model: 'mock-returned',
            usage: { cost: 0.01, prompt_tokens: 10, completion_tokens: 10 },
            choices: [
              { message: { content: JSON.stringify(responses.shift()) } },
            ],
          });
        },
      );
      const agent = await createAgent({
        provider,
        store,
        config,
        clients: {
          evidenceLite: async () => ({
            prices: { dex: '0.0875', cex: '0.0874' },
          }),
          collectEvidence: async () => ({
            marketDataChainId: 177,
            executionChainId: 31337,
            at: now,
            context: 'testnet prices not real',
          }),
          readState: h.state,
          quote: h.quote,
          simulate: h.simulate,
          send: h.send,
        },
      });
      await agent.tick(now);
      await h.advance(300);
      now = Number((await h.client.getBlock()).timestamp);
      const anchor = await agent.tick(now);
      // Align the fitter's notBefore with the next mined execution clock.
      await h.advance(300);
      now = Number((await h.client.getBlock()).timestamp);
      const proposed = {
        proposal: {
          type: 'BUY',
          legs: [
            { notionalB: '50', notBefore: now },
            { notionalB: '50', notBefore: now + 300 },
          ],
          directionChanged: false,
        },
        explanation: 'fit cap across cooldown',
      };
      responses[1] = proposed;
      const trade = await agent.tick(now);
      expect(trade?.final.kind).toBe('RESIZE');
      await h.advance(900);
      now = Number((await h.client.getBlock()).timestamp);
      const hold = await agent.tick(now);
      expect(
        agent.journal.entries.filter((e) => e.type === 'WAKE'),
      ).toHaveLength(3);
      expect(
        agent.journal.entries.filter(
          (e) =>
            e.type === 'WATCH_CHANGE' &&
            e.data.op === 'update' &&
            e.data.accepted,
        ),
      ).toHaveLength(1);
      const reader = rpcReader(h.url);
      for (const receipt of [anchor, trade, hold]) {
        expect(receipt).toBeTruthy();
        const result = await verify(receipt, reader, { agentStore: store });
        expect(result.checks.filter((c) => !c.pass)).toEqual([]);
        expect(result.status).toBe('PASS');
      }
      const base = trade!;
      for (const field of ['amountIn', 'minOut', 'policyHash'] as const) {
        const changed = structuredClone(base);
        if (field === 'policyHash') changed.policyHash = zeroHash;
        else changed.final[field]++;
        changed.receiptHash = receiptHashV3(changed);
        expect(
          (await verify(changed, reader, { agentStore: store })).status,
        ).toBe('FAIL');
      }
      const originalJournal = await store.text('journal.jsonl');
      for (const mutation of ['rawOutput', 'order', 'watch']) {
        const entries = originalJournal
          .trim()
          .split('\n')
          .map((l) => JSON.parse(l));
        if (mutation === 'order')
          [entries[0], entries[1]] = [entries[1], entries[0]];
        else if (mutation === 'rawOutput')
          entries.find((e) => e.type === 'LLM_CALL').data.rawOutput = '{}';
        else
          entries.find(
            (e) => e.type === 'WATCH_CHANGE' && e.data.by === 'strategist',
          ).data.accepted = false;
        await store.writeText(
          'journal.jsonl',
          entries.map(canonical).join('\n') + '\n',
        );
        expect((await verify(base, reader, { agentStore: store })).status).toBe(
          'FAIL',
        );
      }
      await store.writeText('journal.jsonl', originalJournal);
      const calls = agent.journal.entries.filter((e) => e.type === 'LLM_CALL');
      const path = `prompts/${calls[0].data.promptHash}.json`,
        prompt = await store.text(path);
      await store.writeText(path, '{}');
      expect((await verify(base, reader, { agentStore: store })).status).toBe(
        'FAIL',
      );
      await store.writeText(path, prompt);
      const evidencePath = `evidence/${base.evidenceHash}.json`,
        evidence = await store.text(evidencePath);
      await store.writeText(evidencePath, '{}');
      expect((await verify(base, reader, { agentStore: store })).status).toBe(
        'FAIL',
      );
      await store.writeText(evidencePath, evidence);
    } finally {
      await h.stop();
    }
  },
  180000,
);
