#!/usr/bin/env node
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createPublicClient, http, defineChain, type Chain, type PublicClient } from 'viem';
import { DeskParser } from './parser.js';
import { queryGroqDesk, buildGroundedContext, verifyGroundedExplanation } from './llm.js';
import { policySchema } from '../policy.js';
import { collectEvidence } from '../evidence.js';
import type { Evidence, Decision } from '../types.js';

const hskMainnet: Chain = defineChain({
  id: 177,
  name: 'HashKey Chain',
  nativeCurrency: { name: 'HSK', symbol: 'HSK', decimals: 18 },
  rpcUrls: {
    default: {
      http: [
        process.env.HSK_MAINNET_RPC || 'https://mainnet.hsk.xyz',
      ],
    },
  },
});

const hskTestnet: Chain = defineChain({
  id: 133,
  name: 'HashKey Chain Testnet',
  nativeCurrency: { name: 'Test HSK', symbol: 'HSK', decimals: 18 },
  rpcUrls: {
    default: {
      http: [
        process.env.HSK_TESTNET_RPC || 'https://testnet.hsk.xyz',
      ],
    },
  },
  testnet: true,
});

async function main() {
  const query = process.argv.slice(2).join(' ').trim();
  if (!query) {
    console.error('Usage: nalvis desk "<query>"');
    process.exit(1);
  }

  // 1. Load default policy
  let policy: ReturnType<typeof policySchema.parse> | undefined;
  try {
    const policyPath = join(process.cwd(), 'policy/default.json');
    if (existsSync(policyPath)) {
      policy = policySchema.parse(JSON.parse(readFileSync(policyPath, 'utf8')));
    }
  } catch {
    // Policy missing or invalid
  }

  // 2. Load latest local receipt for mandate, state and lastDecision fallback
  let lastReceiptDecision: Decision | undefined;
  let lastReceiptMandate: Record<string, unknown> | undefined;
  let lastReceiptState: Record<string, unknown> | undefined;
  try {
    const receiptsDir = join(process.cwd(), 'receipts/demo/31337');
    if (existsSync(receiptsDir)) {
      const files = readdirSync(receiptsDir).filter((f) => f.endsWith('.json')).sort();
      if (files.length > 0) {
        const lastFile = join(receiptsDir, files[files.length - 1]);
        const r = JSON.parse(readFileSync(lastFile, 'utf8')) as {
          decision?: Decision;
          evidence?: {
            sources?: {
              keeperState?: {
                raw?: {
                  mandate?: Record<string, unknown>;
                  state?: Record<string, unknown>;
                };
              };
            };
          };
        };
        lastReceiptDecision = r.decision;
        lastReceiptMandate = r.evidence?.sources?.keeperState?.raw?.mandate;
        lastReceiptState = r.evidence?.sources?.keeperState?.raw?.state;
      }
    }
  } catch {
    // Receipts unavailable
  }

  // 3. Load live evidence from mainnet 177
  let liveEvidence: Evidence | undefined;
  try {
    const marketClient = createPublicClient({
      chain: hskMainnet,
      transport: http(undefined, { timeout: 10000, retryCount: 0 }),
    }) as PublicClient;
    const execClient = createPublicClient({
      chain: hskTestnet,
      transport: http(undefined, { timeout: 10000, retryCount: 0 }),
    }) as PublicClient;
    const sizes = policy
      ? [...new Set(Object.values(policy.presets).flatMap((p) => p.sizeGridB))].sort((a, b) => a - b)
      : [10, 25, 50, 100];
    liveEvidence = await collectEvidence({
      marketClient177: marketClient,
      execClient,
      sizes,
    });
  } catch {
    // Offline or network unreachable
  }

  // 4. Construct live Desk Context
  const mandate = lastReceiptMandate
    ? {
        expiry: Number(lastReceiptMandate.expiry),
        revoked: Boolean(lastReceiptMandate.revoked),
        maxTradeInA: BigInt(String(lastReceiptMandate.maxTradeInA)),
        maxTradeInB: BigInt(String(lastReceiptMandate.maxTradeInB)),
        maxDailyInB: BigInt(String(lastReceiptMandate.maxDailyInB)),
        maxExposureBps: Number(lastReceiptMandate.maxExposureBps),
        maxSlippageBps: Number(lastReceiptMandate.maxSlippageBps),
        minIntervalSec: Number(lastReceiptMandate.minIntervalSec),
        policyHash: String(lastReceiptMandate.policyHash),
      }
    : undefined;

  const deskState = lastReceiptState
    ? {
        balanceA: BigInt(String(lastReceiptState.balanceA)),
        balanceB: BigInt(String(lastReceiptState.balanceB)),
        lastDecision: lastReceiptDecision,
      }
    : undefined;

  const context = {
    evidence: liveEvidence,
    mandate,
    policy,
    state: deskState,
    decimalsA: liveEvidence?.decimalsA ?? 18,
    decimalsB: liveEvidence?.decimalsB ?? 6,
  };

  const parser = new DeskParser();
  const baseline = parser.parse(query, context);

  let modelName = 'none (deterministic fallback)';
  let promptHash: string | undefined;
  let responseText: string | undefined;
  let intent = baseline.intent;

  const groqApiKey = process.env.GROQ_API_KEY;

  if (groqApiKey) {
    try {
      const groqRes = await queryGroqDesk(
        query,
        context,
        { apiKey: groqApiKey, timeoutMs: 5000 },
      );
      modelName = groqRes.model;
      promptHash = groqRes.promptHash;

      // Deterministic validation: pass normalized query through DeskParser
      const validated = parser.parse(groqRes.normalizedQuery || query, context);

      // Safeguard: Do not let LLM change intent or output ungrounded numbers
      const intentMatches = baseline.intent === validated.intent;
      const contextStr = buildGroundedContext(query, context);
      const isGrounded =
        intentMatches &&
        groqRes.explanation &&
        verifyGroundedExplanation(groqRes.explanation, contextStr);

      intent = intentMatches ? validated.intent : baseline.intent;
      responseText = isGrounded ? groqRes.explanation : baseline.response;

      console.log(`[MODE] LLM (Groq: ${modelName})`);
      console.log(`[PROMPT HASH] ${promptHash}`);
      console.log(`[${intent}] ${responseText}`);

      const finalResult = intentMatches ? validated : baseline;
      if (finalResult.diff) {
        console.log('Diff:', JSON.stringify(finalResult.diff, null, 2));
      }
      if (finalResult.calldataHash) {
        console.log('Calldata Hash:', finalResult.calldataHash);
      }
      if (finalResult.preparedAction) {
        console.log('Prepared Action:', JSON.stringify(finalResult.preparedAction, null, 2));
      }
      return;
    } catch {
      // Groq failed or timed out; fall back to deterministic mode
    }
  }

  // Deterministic mode fallback
  console.log(`[MODE] RULE-BASED (Deterministic Fallback)`);
  console.log(`[${baseline.intent}] ${baseline.response}`);
  if (baseline.diff) {
    console.log('Diff:', JSON.stringify(baseline.diff, null, 2));
  }
  if (baseline.calldataHash) {
    console.log('Calldata Hash:', baseline.calldataHash);
  }
  if (baseline.preparedAction) {
    console.log('Prepared Action:', JSON.stringify(baseline.preparedAction, null, 2));
  }
}

main().catch((err) => {
  console.error('Desk CLI error:', err);
  process.exit(1);
});
