import { expect, it } from 'vitest';
import { assertMainnetActivation } from '../src/mainnet-guard.js';
import {
  addresses,
  assertWritableChain,
  assertExecutionChain,
} from '../../core/src/addresses.js';
import {
  configFromEnv,
  createAgentPolicy,
  strategyHash,
} from '../../core/src/agent/policy.js';
import {
  executionPrompt,
  STRATEGIST_PROMPT_V1,
} from '../../core/src/agent/strategist.js';
const approved = {
  MAINNET_EXECUTION_ACK: 'I_ACCEPT_REAL_FUNDS_RISK_ON_177',
  VAULT_ADDRESS: addresses[177].primaryPool.address,
  MAINNET_DEPLOY_COMMIT: 'a'.repeat(40),
};
it('requires explicit activation and refuses CI even with the acknowledgment', () => {
  expect(() => assertMainnetActivation({})).toThrow();
  expect(() => assertMainnetActivation({ ...approved, CI: 'true' })).toThrow();
  expect(() =>
    assertMainnetActivation({ ...approved, MAINNET_DEPLOY_COMMIT: '' }),
  ).toThrow();
  expect(() => assertMainnetActivation(approved)).not.toThrow();
  expect(() => assertWritableChain(177)).toThrow();
  expect(() => assertExecutionChain(177)).not.toThrow();
  expect(() => assertExecutionChain(1)).toThrow();
});
it('mainnet policy commits real-funds prompts without changing existing sandbox policies', () => {
  const env = {
    STRATEGIST_MODEL: 'test/strategy',
    FITTER_MODEL: 'test/fitter',
  };
  const sandbox = configFromEnv('', env),
    mainnet = configFromEnv('', { ...env, EXECUTION_CHAIN: '177' });
  expect(strategyHash(mainnet)).not.toBe(strategyHash(sandbox));
  expect(
    JSON.parse(createAgentPolicy(sandbox)).strategy.STRATEGIST_PROMPT_V1,
  ).toBe(STRATEGIST_PROMPT_V1);
  expect(
    JSON.parse(createAgentPolicy(mainnet)).strategy.STRATEGIST_PROMPT_V1,
  ).toBe(executionPrompt(STRATEGIST_PROMPT_V1, 177));
  expect(executionPrompt(STRATEGIST_PROMPT_V1, 177)).toContain('real funds');
  expect(executionPrompt(STRATEGIST_PROMPT_V1, 177)).not.toContain(
    'testnet prices are not real',
  );
});
