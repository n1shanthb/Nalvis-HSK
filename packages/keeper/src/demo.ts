import { readFileSync } from 'node:fs';
import {
  parseEvidenceJSON,
  policyHash,
  units,
  type Evidence,
  type Policy,
  type Mandate,
  type EngineState,
} from '../../core/src/index.js';
import { repositoryRoot, type Options } from './config.js';
import { join } from 'node:path';

/** Recorded synthetic scenario; never a live price or a claim of edge. Default policy is unchanged. */
export function fixtureScenario(
  policy: Policy,
  scenario: Options['demo'] = 'wait',
  now = 1800000000,
) {
  const evidence = parseEvidenceJSON(
    readFileSync(
      join(
        repositoryRoot(),
        'packages/core/test/fixtures/synthetic-evidence.json',
      ),
      'utf8',
    ),
  );
  evidence.now = now;
  evidence.lastSwapAt = now;
  for (const c of evidence.cex) c.fetchedAt = now;
  if (evidence.apro) {
    evidence.apro.updatedAt = now;
    evidence.apro.ageSec = 0;
  }
  for (const s of Object.values(evidence.sources)) s.fetchedAt = now;
  const mandate: Mandate = {
    expiry: now + 3600,
    revoked: false,
    maxTradeInA: units(1000, 18),
    maxTradeInB: units(scenario === 'resize' ? 50 : 100, 6),
    maxDailyInB: units(1000, 6),
    maxExposureBps: 10000,
    maxSlippageBps: 100,
    minIntervalSec: 0,
    policyHash: policyHash(policy),
  };
  const state: EngineState = {
    preset: 'balanced',
    balanceA: units(scenario === 'wait' ? 500 : 100, 18),
    balanceB: units(scenario === 'wait' ? 500 : 900, 6),
    lastTradeAt: 0,
    dailySpentB: 0n,
    dailyBucket: Math.floor(now / 86400),
    dailyLossB: 0,
    llmValid: true,
  };
  if (scenario === 'reject') evidence.cex = [];
  evidence.sources.demo = {
    url: 'fixture:DEMO',
    method: 'synthetic',
    fetchedAt: now,
    raw: `DEMO ${scenario}; synthetic prices; no proven edge`,
  };
  return { evidence, mandate, state };
}
/** Use the real mandate/state; DEMO changes only the labelled market evidence. */
export function demoEvidence(
  policy: Policy,
  scenario: NonNullable<Options['demo']>,
  live: Evidence,
): Evidence {
  const { evidence } = fixtureScenario(policy, scenario, live.now);
  evidence.executionChainId = live.executionChainId;
  evidence.executionBlockNumber = live.executionBlockNumber;
  if (live.vault) evidence.vault = live.vault;
  // Preserve the real pool mid and quote cost curve. Only labelled CEX basis/quality are synthetic.
  evidence.dexMid = live.dexMid;
  evidence.quotes = live.quotes;
  evidence.blockNumber = live.blockNumber;
  evidence.sources = { ...live.sources, demo: evidence.sources.demo };
  if (scenario !== 'reject' && live.dexMid) {
    const price = live.dexMid * (scenario === 'wait' ? 1 : 1.05);
    evidence.cex = ['mexc', 'gate'].map((venue) => ({
      venue: venue as 'mexc' | 'gate',
      bid: price,
      ask: price,
      fetchedAt: live.now,
    }));
    evidence.apro = { price, updatedAt: live.now, ageSec: 0 };
    evidence.lastSwapAt = live.now;
  }
  return evidence;
}
