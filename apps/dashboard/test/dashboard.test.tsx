import {
  proposalCalldata,
  mandateBaseline,
  type OwnerProposal,
} from '../../../packages/core/src/desk/proposal.js';
import { keccak256 } from 'viem';
import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createPublicClient, custom, decodeFunctionData, zeroHash } from 'viem';
import { App } from '../src/App.js';
import {
  MandateForm,
  validateMandate,
  fieldsFor,
} from '../src/owner/MandateForm.js';
import { readVault, type VaultSnapshot } from '../src/lib/clients.js';
import { vaultAbi } from '../../../packages/core/src/abi/index.js';
import { addresses } from '../../../packages/core/src/addresses.js';
import { VerifyView, recordedTrade } from '../src/views/Verify.js';
import { verify } from '../../../packages/verifier/src/verify.js';
import { recordedReader } from '../../../packages/verifier/src/recorded.js';
import recording from '../../../packages/verifier/test/fixtures/chain.json';
import { encodeFunctionResult } from 'viem';
import { EvidenceDetails } from '../src/views/Evidence.js';
import { parseEvidenceJSON } from '../../../packages/core/src/serialization.js';
// Public documented addresses stand in for roles only in offline tests.
const owner = addresses[133].whsk.address,
  agent = addresses[133].usdt.address;
export const snapshot: VaultSnapshot = {
  owner,
  paused: false,
  decimalsA: 18,
  decimalsB: 18,
  blockNumber: 1n,
  mandate: {
    agent,
    expiry: BigInt(Math.floor(Date.now() / 1000) + 3600),
    maxTradeInA: 10n ** 18n,
    maxTradeInB: 25n * 10n ** 18n,
    maxDailyInB: 100n * 10n ** 18n,
    maxExposureBps: 8000,
    maxSlippageBps: 50,
    maxDrawdownBps: 0,
    minIntervalSec: 30n,
    policyHash: zeroHash,
  },
};
const fetchFailure = () =>
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(Error('Offline test'));
describe('owner mandate review', () => {
  test('clamps slippage, converts decimals and builds real calldata', () => {
    render(
      <MandateForm
        chain={133}
        vault={addresses[133].primaryPool.address}
        snapshot={snapshot}
      />,
    );
    fireEvent.change(screen.getByLabelText('Slippage cap (bps)'), {
      target: { value: '9999' },
    });
    expect(
      (screen.getByLabelText('Slippage cap (bps)') as HTMLInputElement).value,
    ).toBe('100');
    fireEvent.click(screen.getByText('Build setMandate review'));
    expect(screen.getByText('Diff vs current mandate')).toBeTruthy();
    const calldata = screen
      .getByText('Exact calldata')
      .parentElement!.querySelector('code')!.textContent! as `0x${string}`;
    const decoded = decodeFunctionData({ abi: vaultAbi, data: calldata });
    expect(decoded.functionName).toBe('setMandate');
    const args = decoded.args![0] as {
      maxSlippageBps: number;
      maxTradeInB: bigint;
    };
    expect(args.maxSlippageBps).toBe(100);
    expect(args.maxTradeInB).toBe(25n * 10n ** 18n);
    fireEvent.change(screen.getByLabelText('USDT per trade'), {
      target: { value: '1.25' },
    });
    expect(screen.queryByText('Sign and send reviewed action')).toBeNull();
    expect(
      validateMandate(
        { ...fieldsFor(snapshot), maxTradeInB: '1.25' },
        { ...snapshot, decimalsB: 6 },
      ).maxTradeInB,
    ).toBe(1250000n);
  });
  test('refuses agent equal to owner before signer access', () => {
    const signerFactory = vi.fn();
    render(
      <MandateForm
        chain={133}
        vault={addresses[133].primaryPool.address}
        snapshot={snapshot}
        signerFactory={signerFactory}
      />,
    );
    fireEvent.change(screen.getByLabelText('Agent address'), {
      target: { value: owner },
    });
    fireEvent.click(screen.getByText('Build setMandate review'));
    expect(screen.getByRole('status').textContent).toContain(
      'Agent must differ from owner',
    );
    expect(signerFactory).not.toHaveBeenCalled();
    expect(screen.queryByText('Sign and send reviewed action')).toBeNull();
  });
  test.each([177, 31337] as const)('refuses chain %s', (chain) => {
    const signerFactory = vi.fn();
    render(
      <MandateForm
        chain={chain}
        vault={owner}
        snapshot={snapshot}
        signerFactory={signerFactory}
      />,
    );
    expect(screen.getByRole('alert').textContent).toContain(
      `refuses chain ${chain}`,
    );
    expect(signerFactory).not.toHaveBeenCalled();
  });
  test('NO-GO hides owner UI', () => {
    render(
      <MandateForm
        chain={133}
        vault={owner}
        snapshot={snapshot}
        enabled={false}
      />,
    );
    expect(screen.queryByText('Review a mandate change')).toBeNull();
  });
  test('rejects excess precision and expired mandates', () => {
    expect(() =>
      validateMandate(
        { ...fieldsFor(snapshot), maxTradeInB: '1.0000001' },
        { ...snapshot, decimalsB: 6 },
      ),
    ).toThrow('decimal');
    expect(() =>
      validateMandate({ ...fieldsFor(snapshot), expiry: '1' }, snapshot),
    ).toThrow('future');
  });
  test('builds revoke separately and refuses mandate widening through natural language', () => {
    render(<MandateForm chain={133} vault={owner} snapshot={snapshot} />);
    fireEvent.click(screen.getByText('Build revoke review'));
    expect(
      screen.getByText('Exact calldata').parentElement!.textContent,
    ).toContain('0xb6549f75');
    fireEvent.change(screen.getByLabelText('Request'), {
      target: { value: 'maxTradeInB to 100000' },
    });
    fireEvent.click(screen.getByText('Show parameter diff'));
    expect(screen.getByText('requires new Ledger-signed mandate')).toBeTruthy();
  });
});
describe('views', () => {
  test.each(['mandate', 'evidence', 'receipts', 'verify', 'desk'] as const)(
    'route %s renders without console errors',
    async (route) => {
      fetchFailure();
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
      render(<App initialRoute={route} enableOwner={false} />);
      expect(screen.getByRole('note').textContent).toBe(
        'Testnet — pool prices are not real',
      );
      expect(screen.getByRole('main')).toBeTruthy();
      await waitFor(() =>
        expect(
          screen.queryByText(/Reading deployment|Reading receipts/),
        ).toBeNull(),
      );
      expect(errors).not.toHaveBeenCalled();
    },
  );
  test('tampered genuine fixture shows FAIL in Verify view', async () => {
    const tampered = structuredClone(recordedTrade);
    tampered.evidence.dexMid += 0.01;
    render(
      <VerifyView
        chain={31337}
        runRecorded={() => verify(tampered, recordedReader(recording))}
      />,
    );
    fireEvent.click(screen.getByText('Replay recorded Anvil trade'));
    expect(await screen.findByRole('heading', { name: 'FAIL' })).toBeTruthy();
    expect(screen.getByText(/evidenceHash/)).toBeTruthy();
  });
  test('genuine recording passes browser verifier', async () => {
    const result = await verify(recordedTrade, recordedReader(recording));
    expect(result.status).toBe('PASS');
  });
  test('failed CEX and stale APRO are explicit', () => {
    const e = parseEvidenceJSON(JSON.stringify(recordedTrade.evidence));
    e.cex = [];
    e.apro = { price: 0.1, updatedAt: 1, ageSec: e.now - 1 };
    render(<EvidenceDetails e={e} />);
    expect(screen.getAllByText('CEX unavailable')).toHaveLength(2);
    expect(screen.getByText(/old — stale/)).toBeTruthy();
    expect(screen.getByText(/never enforced on-chain/)).toBeTruthy();
  });
  test('mandate reads use a mocked viem transport with pinned block and token decimals', async () => {
    const request = vi.fn(
      async ({ method, params }: { method: string; params?: unknown[] }) => {
        if (method === 'eth_chainId') return '0x85';
        if (method === 'eth_blockNumber') return '0x1';
        if (method === 'eth_call') {
          const data = (params![0] as { data: string }).data;
          if (data === '0x8da5cb5b')
            return encodeFunctionResult({
              abi: vaultAbi,
              functionName: 'owner',
              result: owner,
            });
          if (data === '0x5c975abb')
            return encodeFunctionResult({
              abi: vaultAbi,
              functionName: 'paused',
              result: false,
            });
          if (data === '0x313ce567')
            return '0x' + BigInt(18).toString(16).padStart(64, '0');
          return encodeFunctionResult({
            abi: vaultAbi,
            functionName: 'mandate',
            result: Object.values(snapshot.mandate) as never,
          });
        }
        throw Error(method);
      },
    );
    const client = createPublicClient({ transport: custom({ request }) });
    const result = await readVault(
      133,
      addresses[133].primaryPool.address,
      client as never,
    );
    expect(result.mandate).toEqual(snapshot.mandate);
    expect(result.decimalsB).toBe(18);
    expect(request).toHaveBeenCalled();
  });
});

test('owner panel reviews exact desk calldata and rejects changed mandate/hash before signer factory', () => {
  const diff = { maxTradeInB: String(10n * 10n ** 18n) };
  const data = proposalCalldata('setMandate', diff, snapshot.mandate);
  const proposal: OwnerProposal = {
    action: 'setMandate',
    diff,
    calldataHash: keccak256(data),
    baselineHash: mandateBaseline(snapshot.mandate, false),
    target: { vault: owner, chainId: 133 },
  };
  const signerFactory = vi.fn();
  const view = render(
    <MandateForm
      chain={133}
      vault={owner}
      snapshot={snapshot}
      proposal={proposal}
      signerFactory={signerFactory}
    />,
  );
  fireEvent.click(screen.getByText('Build exact desk proposal review'));
  expect(
    screen.getByText('Exact calldata').parentElement!.querySelector('code')!
      .textContent,
  ).toBe(data);
  view.rerender(
    <MandateForm
      chain={133}
      vault={owner}
      snapshot={{
        ...snapshot,
        mandate: { ...snapshot.mandate, maxSlippageBps: 20 },
      }}
      proposal={proposal}
      signerFactory={signerFactory}
    />,
  );
  fireEvent.click(screen.getByText('Build exact desk proposal review'));
  expect(screen.getByRole('status').textContent).toContain('changed');
  expect(signerFactory).not.toHaveBeenCalled();
});
test('owner panel can build pause calldata', () => {
  render(<MandateForm chain={133} vault={owner} snapshot={snapshot} />);
  fireEvent.click(screen.getByText('Build pause review'));
  const data = screen
    .getByText('Exact calldata')
    .parentElement!.querySelector('code')!.textContent!;
  expect(
    decodeFunctionData({ abi: vaultAbi, data: data as `0x${string}` })
      .functionName,
  ).toBe('pause');
});
