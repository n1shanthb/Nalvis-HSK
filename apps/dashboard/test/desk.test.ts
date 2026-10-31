import { it, expect } from 'vitest';
import { demoContext } from '../src/lib/demo.js';
import { desk } from '../../../packages/core/src/desk/index.js';
it('builds an exact unsigned cap proposal using the verified recording agent', async () => {
  const context = await demoContext();
  const reply = desk('set cap to 25', context);
  expect(context.results.every((r) => r.status === 'PASS')).toBe(true);
  expect(reply.diff).toEqual({ maxTradeInB: '25000000' });
  expect(reply.calldataHash).toMatch(/^0x[0-9a-f]{64}$/);
  expect(reply.message).toContain('Proposal only');
});
