import {
  proposalCalldata,
  mandateBaseline,
  type SignedMandate,
  type OwnerProposal,
} from '../../../packages/core/src/desk/proposal.js';
import { keccak256, encodeFunctionData, zeroHash } from 'viem';
import { beforeEach, expect, test, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import { serializeTransaction, hexToBytes, type Address, type Hex } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import { addresses } from '../../../packages/core/src/addresses.js';
const mocks = vi.hoisted(() => ({
  getAddress: vi.fn(),
  signTransaction: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  stopDiscovering: vi.fn(),
  close: vi.fn(),
  startDiscovering: vi.fn(),
  build: vi.fn(),
}));
vi.mock('@ledgerhq/device-management-kit', () => ({
  DeviceActionStatus: {
    Completed: 'completed',
    Error: 'error',
    Stopped: 'stopped',
  },
  DeviceManagementKitBuilder: class {
    addTransport() {
      return this;
    }
    build() {
      return mocks;
    }
  },
}));
vi.mock('@ledgerhq/device-signer-kit-ethereum', () => ({
  SignerEthBuilder: class {
    build() {
      return mocks;
    }
  },
}));
vi.mock('@ledgerhq/device-transport-kit-web-hid', () => ({
  webHidTransportFactory: {},
}));
import {
  connectLedger,
  sendOwnerAction,
  derivationPath,
  deviceResult,
  type OwnerSigner,
} from '../src/owner/ledger.js';
const done = (output: unknown) => ({
  observable: of({ status: 'completed', output }),
});
beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, 'hid', { value: {}, configurable: true });
  mocks.connect.mockResolvedValue('session');
  mocks.disconnect.mockResolvedValue(undefined);
  mocks.startDiscovering.mockReturnValue(of({ id: 'mock-device' }));
  mocks.getAddress.mockReturnValue(
    done({ address: addresses[133].whsk.address }),
  );
  mocks.signTransaction.mockReturnValue(done({ r: '0x01', s: '0x02', v: 0 }));
});
test('DMK WebHID address and transaction path compile and run with mocked SDK', async () => {
  const signer = await connectLedger(133, 2);
  expect(await signer.address()).toBe(addresses[133].whsk.address);
  const unsigned = serializeTransaction({
    type: 'legacy',
    chainId: 133,
    nonce: 0,
    gasPrice: 1n,
    gas: 50000n,
    to: addresses[133].primaryPool.address,
    value: 0n,
    data: '0xb6549f75',
  });
  await signer.signTransaction(unsigned, 133);
  expect(mocks.getAddress).toHaveBeenCalledWith("44'/60'/0'/0/2", {
    checkOnDevice: true,
  });
  expect(mocks.signTransaction).toHaveBeenCalledWith(
    "44'/60'/0'/0/2",
    hexToBytes(unsigned),
  );
  await signer.disconnect();
  expect(mocks.close).toHaveBeenCalledOnce();
  expect(mocks.disconnect).toHaveBeenCalledWith({ sessionId: 'session' });
});
test('forbidden chain refuses before discovery and signer calls', async () => {
  await expect(connectLedger(177)).rejects.toThrow('Writes forbidden');
  await expect(connectLedger(31337)).rejects.toThrow('133 only');
  expect(mocks.startDiscovering).not.toHaveBeenCalled();
  expect(() => derivationPath(-1)).toThrow();
});
test('DMK rejection and transport errors fail closed', async () => {
  mocks.getAddress.mockReturnValue({ observable: of({ status: 'stopped' }) });
  const signer = await connectLedger(133);
  await expect(signer.address()).rejects.toThrow('cancelled');
  await signer.disconnect();
  mocks.startDiscovering.mockReturnValue(throwError(() => Error('USB failed')));
  await expect(connectLedger(133)).rejects.toThrow('USB failed');
  expect(mocks.close).toHaveBeenCalled();
});
test('synchronous action subscriptions are cleaned up', async () => {
  const unsubscribe = vi.fn();
  const result = await deviceResult({
    observable: {
      subscribe(observer) {
        observer.next({ status: 'completed' as never, output: 'ok' });
        return { unsubscribe };
      },
    },
  });
  expect(result).toBe('ok');
  expect(unsubscribe).toHaveBeenCalledOnce();
});
// BIP-39 public Anvil mnemonic, never a funded account. No private key is embedded or logged.
const account = mnemonicToAccount(
  'test test test test test test test test test test test junk',
);
class MockSigner implements OwnerSigner {
  address = vi.fn(async () => account.address);
  disconnect = vi.fn(async () => {});
  signTransaction = vi.fn(async (unsigned: Hex) => {
    const { parseTransaction } = await import('viem');
    const tx = parseTransaction(unsigned);
    const signed = await account.signTransaction({
      ...tx,
      type: 'legacy',
      chainId: 133,
    } as never);
    const parsed = parseTransaction(signed);
    return { r: parsed.r!, s: parsed.s!, v: Number(parsed.v) };
  });
}
function mockClient(owner: Address = account.address) {
  return {
    getChainId: vi.fn(async () => 133),
    readContract: vi.fn(async () => owner),
    getTransactionCount: vi.fn(async () => 0),
    getGasPrice: vi.fn(async () => 1n),
    estimateGas: vi.fn(async () => 50000n),
    sendRawTransaction: vi.fn(async () => '0x' + 'a'.repeat(64)),
  };
}
const params = {
  chainId: 133,
  vault: addresses[133].primaryPool.address,
  owner: account.address,
  data: '0xb6549f75' as Hex,
};
test('MockSigner signs EIP-155 transaction and broadcasts only recovered owner signature on 133', async () => {
  const signer = new MockSigner(),
    client = mockClient();
  await sendOwnerAction({ ...params, signer, client: client as never });
  expect(client.sendRawTransaction).toHaveBeenCalledOnce();
  const raw = client.sendRawTransaction.mock.calls[0] as unknown as [
    { serializedTransaction: Hex },
  ];
  const { parseTransaction } = await import('viem');
  const tx = parseTransaction(raw[0].serializedTransaction);
  expect(tx.chainId).toBe(133);
  expect(tx.to?.toLowerCase()).toBe(params.vault.toLowerCase());
  expect(tx.data).toBe(params.data);
  expect(signer.disconnect).toHaveBeenCalledOnce();
});
test.each(['chain', 'owner', 'signature', 'reject'] as const)(
  '%s failure never broadcasts and disconnects',
  async (reason) => {
    const signer = new MockSigner(),
      client = mockClient();
    if (reason === 'chain') client.getChainId.mockResolvedValue(177);
    if (reason === 'owner')
      client.readContract.mockResolvedValue(addresses[133].whsk.address);
    if (reason === 'signature')
      signer.signTransaction.mockResolvedValue({
        r: ('0x' + '1'.repeat(64)) as Hex,
        s: ('0x' + '2'.repeat(64)) as Hex,
        v: 0,
      });
    if (reason === 'reject')
      signer.signTransaction.mockRejectedValue(Error('Device rejected'));
    await expect(
      sendOwnerAction({ ...params, signer, client: client as never }),
    ).rejects.toThrow();
    expect(client.sendRawTransaction).not.toHaveBeenCalled();
    expect(signer.disconnect).toHaveBeenCalledOnce();
  },
);

test('chain switch after signing refuses broadcast', async () => {
  const signer = new MockSigner(),
    client = mockClient();
  client.getChainId
    .mockResolvedValueOnce(133)
    .mockResolvedValueOnce(133)
    .mockResolvedValueOnce(177);
  await expect(
    sendOwnerAction({ ...params, signer, client: client as never }),
  ).rejects.toThrow('Writes forbidden');
  expect(signer.signTransaction).toHaveBeenCalledOnce();
  expect(client.sendRawTransaction).not.toHaveBeenCalled();
  expect(signer.disconnect).toHaveBeenCalledOnce();
});
test('Ledger adapter rejects mainnet serialized payload even when caller claims 133', async () => {
  const signer = await connectLedger(133);
  const unsigned = serializeTransaction({
    type: 'legacy',
    chainId: 177,
    nonce: 0,
    gas: 50000n,
    gasPrice: 1n,
    to: addresses[133].primaryPool.address,
    value: 0n,
    data: '0xb6549f75',
  });
  await expect(signer.signTransaction(unsigned, 133)).rejects.toThrow(
    'Writes forbidden',
  );
  expect(mocks.signTransaction).not.toHaveBeenCalled();
  await signer.disconnect();
});

test('pause passes the Ledger owner action allowlist', async () => {
  const signer = new MockSigner(),
    client = mockClient();
  await sendOwnerAction({
    ...params,
    data: encodeFunctionData({
      abi: (await import('../../../packages/core/src/abi/index.js')).vaultAbi,
      functionName: 'pause',
    }),
    signer,
    client: client as never,
  });
  expect(signer.signTransaction).toHaveBeenCalledOnce();
  expect(client.sendRawTransaction).toHaveBeenCalledOnce();
});
test.each(['hash', 'tightening', 'during-signature'] as const)(
  'proposal %s cannot sign/broadcast obsolete calldata',
  async (mode) => {
    const agent = mnemonicToAccount(
      'test test test test test test test test test test test junk',
      { addressIndex: 1 },
    ).address;
    let m: SignedMandate = {
      agent,
      expiry: 1900000000n,
      maxTradeInA: 2n * 10n ** 18n,
      maxTradeInB: 100n * 10n ** 18n,
      maxDailyInB: 500n * 10n ** 18n,
      maxExposureBps: 8000,
      maxSlippageBps: 50,
      maxDrawdownBps: 1200,
      minIntervalSec: 300n,
      policyHash: zeroHash,
    };
    const diff = { maxTradeInB: String(25n * 10n ** 18n) },
      data = proposalCalldata('setMandate', diff, m);
    const proposal: OwnerProposal = {
      action: 'setMandate',
      diff,
      calldataHash: keccak256(data),
      baselineHash: mandateBaseline(m, false),
      target: { vault: params.vault, chainId: 133 },
    };
    if (mode === 'hash') proposal.calldataHash = zeroHash;
    if (mode === 'tightening') m = { ...m, maxTradeInB: 20n * 10n ** 18n };
    const signer = new MockSigner();
    const oldSign = signer.signTransaction.getMockImplementation()!;
    if (mode === 'during-signature')
      signer.signTransaction.mockImplementation(async (unsigned) => {
        const result = await oldSign(unsigned);
        m = { ...m, maxTradeInB: 20n * 10n ** 18n };
        return result;
      });
    const client = {
      ...mockClient(),
      getBlockNumber: async () => 1n,
      readContract: vi.fn(async ({ functionName }: { functionName: string }) =>
        functionName === 'owner'
          ? account.address
          : functionName === 'paused'
            ? false
            : [
                m.agent,
                m.expiry,
                m.maxTradeInA,
                m.maxTradeInB,
                m.maxDailyInB,
                m.maxExposureBps,
                m.maxSlippageBps,
                m.maxDrawdownBps,
                m.minIntervalSec,
                m.policyHash,
              ],
      ),
    };
    await expect(
      sendOwnerAction({
        ...params,
        data,
        proposal,
        signer,
        client: client as never,
      }),
    ).rejects.toThrow(mode === 'hash' ? 'hash mismatch' : 'changed');
    if (mode !== 'during-signature')
      expect(signer.signTransaction).not.toHaveBeenCalled();
    expect(client.sendRawTransaction).not.toHaveBeenCalled();
  },
);

// Regress the UI-to-signer path, not just an isolated callback.
test('a loaded desk cap proposal cannot block a manual emergency revoke', async () => {
  const { createElement } = await import('react');
  const { render, screen, fireEvent, waitFor } =
    await import('@testing-library/react');
  const { MandateForm } = await import('../src/owner/MandateForm.js');
  const ledger = await import('../src/owner/ledger.js');
  const mandate: SignedMandate = {
    agent: mnemonicToAccount(
      'test test test test test test test test test test test junk',
      { addressIndex: 1 },
    ).address,
    expiry: 1900000000n,
    maxTradeInA: 10n ** 18n,
    maxTradeInB: 100n * 10n ** 18n,
    maxDailyInB: 500n * 10n ** 18n,
    maxExposureBps: 8000,
    maxSlippageBps: 50,
    maxDrawdownBps: 1000,
    minIntervalSec: 30n,
    policyHash: zeroHash,
  };
  const diff = { maxTradeInB: String(25n * 10n ** 18n) };
  const proposal: OwnerProposal = {
    action: 'setMandate',
    diff,
    calldataHash: keccak256(proposalCalldata('setMandate', diff, mandate)),
    baselineHash: mandateBaseline(mandate, false),
    target: { vault: params.vault, chainId: 133 },
  };
  const signer = new MockSigner(),
    client = mockClient(),
    clear = vi.fn();
  const original = ledger.sendOwnerAction;
  const send = vi
    .spyOn(ledger, 'sendOwnerAction')
    .mockImplementation((args) =>
      original({ ...args, client: client as never }),
    );
  render(
    createElement(MandateForm, {
      chain: 133,
      vault: params.vault,
      snapshot: {
        owner: account.address,
        mandate,
        paused: false,
        blockNumber: 1n,
        decimalsA: 18,
        decimalsB: 18,
      },
      proposal,
      onProposalClear: clear,
      signerFactory: async () => signer,
    }),
  );
  fireEvent.click(screen.getByText('Build exact desk proposal review'));
  fireEvent.click(screen.getByText('Build revoke review'));
  fireEvent.click(screen.getByText('Sign and send reviewed action'));
  await waitFor(() => expect(signer.signTransaction).toHaveBeenCalledOnce());
  await waitFor(() => expect(client.sendRawTransaction).toHaveBeenCalledOnce());
  expect(send.mock.calls[0][0].proposal).toBeUndefined();
  expect(send.mock.calls[0][0].data).toBe('0xb6549f75');
  expect(clear).toHaveBeenCalledTimes(2);
});
