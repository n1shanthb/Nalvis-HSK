import { expect, it } from 'vitest';
import { executionPrompt, STRATEGIST_PROMPT_V1, marketSourceStatus } from '../../src/agent/strategist.js';
import { configFromEnv, createAgentPolicy, validateAgentPolicy } from '../../src/agent/policy.js';
import type { Evidence } from '../../src/types.js';
it('preserves old policy bindings and requires a new signature for fresh context', () => {
 const env={STRATEGIST_MODEL:'test',FITTER_MODEL:'test',EXECUTION_CHAIN:'177'};
 const old=configFromEnv('',env);old.policyFile=createAgentPolicy(old);
 expect(()=>validateAgentPolicy(old)).not.toThrow();
 const next=configFromEnv(old.policyFile,{...env,AGENT_MARKET_CONTEXT:'fresh-dex-cex'});
 expect(()=>validateAgentPolicy(next)).toThrow('binding');
 next.policyFile=createAgentPolicy(next);
 expect(()=>validateAgentPolicy(next)).not.toThrow();
 expect(executionPrompt(STRATEGIST_PROMPT_V1,177)).not.toContain('APRO is optional');
 expect(executionPrompt(STRATEGIST_PROMPT_V1,177,'fresh-dex-cex')).toContain('APRO is optional');
});
it('labels stale/future oracle and exchange context unusable without changing raw evidence', () => {
 const evidence={now:10000,apro:{updatedAt:1000,price:1},cex:[{venue:'mexc',fetchedAt:9990},{venue:'gate',fetchedAt:9900}]} as Evidence;
 const before=JSON.stringify(evidence);const status=marketSourceStatus(evidence);
 expect(status.apro.usable).toBe(false);
 expect(status.exchanges.map(c=>c.usable)).toEqual([true,false]);
 expect(JSON.stringify(evidence)).toBe(before);
 evidence.apro!.updatedAt=10001;
 expect(marketSourceStatus(evidence).apro.usable).toBe(false);
});
