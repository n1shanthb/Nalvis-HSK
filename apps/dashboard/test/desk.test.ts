import { encodeFunctionData, keccak256, parseAbi, type Hex } from 'viem';
import { it, expect } from 'vitest';
import { demoContext } from '../src/lib/demo.js';
import { desk } from '../../../packages/core/src/desk/index.js';
it('builds an exact unsigned cap proposal using the verified recording agent', async () => {
  const context = await demoContext();
  const reply = desk('set cap to 25', context);
  expect(context.results.every((r) => r.status === 'PASS')).toBe(true);
  expect(reply.diff).toEqual({ maxTradeInB: '25000000' });
  const m = context.mandate;
  expect(reply.calldataHash).toBe(
    keccak256(
      encodeFunctionData({
        abi: parseAbi([
          'function setMandate((address agent,uint256 expiry,uint256 maxTradeInA,uint256 maxTradeInB,uint256 maxDailyInB,uint16 maxExposureBps,uint16 maxSlippageBps,uint16 maxDrawdownBps,uint256 minIntervalSec,bytes32 policyHash) m)',
        ]),
        functionName: 'setMandate',
        args: [
          {
            agent: context.agent,
            expiry: BigInt(m.expiry),
            maxTradeInA: m.maxTradeInA,
            maxTradeInB: 25000000n,
            maxDailyInB: m.maxDailyInB,
            maxExposureBps: m.maxExposureBps,
            maxSlippageBps: m.maxSlippageBps,
            maxDrawdownBps: m.maxDrawdownBps!,
            minIntervalSec: BigInt(m.minIntervalSec),
            policyHash: m.policyHash as Hex,
          },
        ],
      }),
    ),
  );
  expect(reply.message).toContain('Proposal only');
});
