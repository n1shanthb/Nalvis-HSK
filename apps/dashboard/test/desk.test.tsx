import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import * as contextModule from '../src/lib/desk-context.js';
import { DeskView } from '../src/views/Desk.js';
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

it('hands the exact desk proposal to the owner review callback without signing', async () => {
  const context = await demoContext();
  vi.spyOn(contextModule, 'liveDeskContext').mockResolvedValue({
    ...context,
    target: { vault: context.receipts.at(-1)!.contract, chainId: 133 },
  });
  const onProposal = vi.fn();
  render(<DeskView chain={133} onProposal={onProposal} />);
  fireEvent.change(screen.getByLabelText('Ask Nalvis'), {
    target: { value: 'pause' },
  });
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: 'Ask Copilot' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Ask Copilot' }));
  fireEvent.click(await screen.findByText('Review exact proposal with Ledger'));
  expect(onProposal).toHaveBeenCalledOnce();
  expect(onProposal.mock.calls[0][0]).toMatchObject({
    action: 'pause',
    diff: { paused: true },
    target: { chainId: 133 },
  });
});
