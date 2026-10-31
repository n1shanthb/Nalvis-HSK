import { keccak256, toBytes } from 'viem';
import { z } from 'zod';
import { canonical, hash } from '../canonical.js';
import { defaultWatchBounds } from './watches.js';
import { STRATEGIST_PROMPT_V1, FITTER_PROMPT_V1 } from './strategist.js';
import { schemaVersion } from './schema.js';
const positive = z.number().int().positive();
export const agentConfigSchema = z
  .object({
    mode: z.enum(['agent', 'offline', 'rules-demo']).default('agent'),
    models: z.object({ strategist: z.string(), fitter: z.string() }).strict(),
    watchBounds: z
      .object({
        maxActive: positive,
        minCooldownSec: positive,
        minEverySec: positive,
        maxEverySec: positive,
        minPct: z.number().positive(),
        maxPct: z.number().positive(),
        maxExpirySec: positive,
        maxChangesPerHour: positive,
      })
      .strict()
      .default(defaultWatchBounds),
    fitRounds: positive.max(20).default(3),
    heartbeatSec: positive.default(3600),
    pollSec: positive.default(20),
    minWakeGapSec: positive.default(60),
    maxWakesPerHour: positive.default(12),
    dailyLlmBudgetUsd: z.number().positive().default(1),
    anchorSec: positive.default(7200),
    ttlSec: positive.max(120).default(120),
    policyFile: z.string(),
  })
  .strict();
export type AgentConfig = z.infer<typeof agentConfigSchema>;
export function configFromEnv(
  policyFile: string,
  env: Record<string, string | undefined> = process.env,
): AgentConfig {
  return agentConfigSchema.parse({
    mode: env.AGENT_MODE ?? 'agent',
    models: {
      strategist: env.STRATEGIST_MODEL ?? '',
      fitter: env.FITTER_MODEL || env.STRATEGIST_MODEL || '',
    },
    fitRounds: Number(env.AGENT_FIT_ROUNDS ?? 3),
    heartbeatSec: Number(env.AGENT_HEARTBEAT_SEC ?? 3600),
    pollSec: Number(env.AGENT_POLL_SEC ?? 20),
    minWakeGapSec: Number(env.AGENT_MIN_WAKE_GAP_SEC ?? 60),
    maxWakesPerHour: Number(env.AGENT_MAX_WAKES_PER_HOUR ?? 12),
    dailyLlmBudgetUsd: Number(env.AGENT_DAILY_LLM_BUDGET_USD ?? 1),
    anchorSec: Number(env.AGENT_ANCHOR_SEC ?? 7200),
    policyFile,
  });
}
export function strategyDefinition(
  config: Pick<AgentConfig, 'models' | 'watchBounds' | 'fitRounds'>,
) {
  return {
    provider: 'openrouter',
    models: config.models,
    STRATEGIST_PROMPT_V1,
    FITTER_PROMPT_V1,
    schemaVersion,
    watchBounds: config.watchBounds,
    fitRounds: config.fitRounds,
  };
}
export const strategyHash = (
  config: Pick<AgentConfig, 'models' | 'watchBounds' | 'fitRounds'>,
) => hash(strategyDefinition(config));
/** Ledger helper hashes exact file bytes, including any trailing newline. */
export const agentPolicyHash = (file: string) => keccak256(toBytes(file));
export function createAgentPolicy(
  config: Pick<AgentConfig, 'models' | 'watchBounds' | 'fitRounds'>,
  extra: Record<string, unknown> = {},
) {
  return canonical({
    ...extra,
    version: 3,
    strategy: strategyDefinition(config),
    strategyHash: strategyHash(config),
  });
}
export function validateAgentPolicy(config: AgentConfig) {
  const policy = z
    .object({
      version: z.literal(3),
      strategy: z.unknown(),
      strategyHash: z.string(),
    })
    .passthrough()
    .parse(JSON.parse(config.policyFile));
  if (
    policy.strategyHash !== strategyHash(config) ||
    hash(policy.strategy) !== policy.strategyHash
  )
    throw new Error('Policy strategy binding mismatch');
  return agentPolicyHash(config.policyFile);
}
