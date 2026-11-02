import {
  assertProposal,
  type OwnerProposal,
  type SignedMandate,
} from '../../../../packages/core/src/desk/proposal.js';
import {
  DeviceActionStatus,
  DeviceManagementKitBuilder,
  type DeviceActionState,
  type DeviceManagementKit,
  type DiscoveredDevice,
  type DeviceSessionId,
} from '@ledgerhq/device-management-kit';
import { SignerEthBuilder } from '@ledgerhq/device-signer-kit-ethereum';
import { webHidTransportFactory } from '@ledgerhq/device-transport-kit-web-hid';
import {
  decodeFunctionData,
  parseTransaction,
  serializeTransaction,
  recoverTransactionAddress,
  hexToBytes,
  getAddress,
  serializeSignature,
  type Address,
  type Hex,
} from 'viem';
import { assertWritableChain } from '../../../../packages/core/src/addresses.js';
import { clientFor } from '../lib/clients.js';
import { vaultAbi } from '../../../../packages/core/src/abi/index.js';

export const BLIND_SIGNING_WARNING =
  'Blind signing: HashKey Chain has no Ledger clear-signing metadata; verify the calldata hash shown here matches your device.';
export function assertOwnerChain(chainId: number) {
  if (chainId === 177 && import.meta.env.VITE_MAINNET_EXECUTION === 'true')
    return;
  assertWritableChain(chainId);
  if (chainId !== 133)
    throw Error('Ledger owner actions require chain 133 only');
}
export function derivationPath(index = 0) {
  if (!Number.isInteger(index) || index < 0 || index > 99)
    throw Error('Account index must be 0–99');
  return `44'/60'/0'/0/${index}`;
}
export interface OwnerSigner {
  address(): Promise<Address>;
  signMessage?(message: string): Promise<Hex>;
  signTransaction(
    unsigned: Hex,
    chainId: number,
  ): Promise<{ r: Hex; s: Hex; v: number }>;
  disconnect(): Promise<void>;
}
// Handles synchronous emissions as well as asynchronous DMK actions without subscription leaks.
export function deviceResult<T, E, I>(action: {
  observable: {
    subscribe(observer: {
      next(state: DeviceActionState<T, E, I>): void;
      error(error: unknown): void;
      complete(): void;
    }): { unsubscribe(): void };
  };
  cancel?: () => void;
}): Promise<T> {
  let subscription: { unsubscribe(): void } | undefined;
  let timer: ReturnType<typeof setTimeout>;
  return new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => {
      action.cancel?.();
      reject(Error('Ledger action timed out'));
    }, 120000);
    subscription = action.observable.subscribe({
      next(state) {
        if (state.status === DeviceActionStatus.Completed)
          resolve(state.output);
        else if (state.status === DeviceActionStatus.Error) reject(state.error);
        else if (state.status === DeviceActionStatus.Stopped)
          reject(Error('Ledger action cancelled'));
      },
      error: reject,
      complete() {
        reject(Error('Ledger action completed without a result'));
      },
    });
  }).finally(() => {
    clearTimeout(timer);
    subscription?.unsubscribe();
  });
}
export async function connectLedger(
  chainId: number,
  index = 0,
  dmk?: DeviceManagementKit,
): Promise<OwnerSigner> {
  assertOwnerChain(chainId);
  const path = derivationPath(index);
  if (!('hid' in navigator))
    throw Error(
      'WebHID is unavailable; use a supported browser over HTTPS or localhost',
    );
  const kit =
    dmk ??
    new DeviceManagementKitBuilder()
      .addTransport(webHidTransportFactory)
      .build();
  let sessionId: DeviceSessionId | undefined;
  try {
    const device = await deviceResult<DiscoveredDevice, unknown, unknown>({
      observable: {
        subscribe(observer) {
          return kit.startDiscovering({}).subscribe({
            next(device) {
              observer.next({
                status: DeviceActionStatus.Completed,
                output: device,
              });
            },
            error: observer.error,
            complete: observer.complete,
          });
        },
      },
    });
    kit.stopDiscovering();
    sessionId = await kit.connect({ device });
    const signer = new SignerEthBuilder({ dmk: kit, sessionId }).build();
    return {
      async address() {
        const out = await deviceResult<{ address: string }, unknown, unknown>(
          signer.getAddress(path, { checkOnDevice: true }),
        );
        return getAddress(out.address);
      },
      async signTransaction(unsigned, id) {
        assertOwnerChain(id);
        assertOwnerChain(parseTransaction(unsigned).chainId ?? 0);
        if (id !== chainId || parseTransaction(unsigned).chainId !== id)
          throw Error('Ledger transaction chain mismatch');
        return deviceResult<{ r: Hex; s: Hex; v: number }, unknown, unknown>(
          signer.signTransaction(path, hexToBytes(unsigned)),
        );
      },
      async signMessage(message) {
        assertOwnerChain(chainId);
        const out = await deviceResult<
          { r: Hex; s: Hex; v: number },
          unknown,
          unknown
        >(signer.signMessage(path, message));
        const v = out.v === 0 || out.v === 1 ? out.v + 27 : out.v;
        if (v !== 27 && v !== 28)
          throw Error('Unexpected Ledger message signature');
        return serializeSignature({ r: out.r, s: out.s, v: BigInt(v) });
      },
      async disconnect() {
        try {
          if (sessionId) await kit.disconnect({ sessionId });
        } finally {
          kit.close();
        }
      },
    };
  } catch (error) {
    kit.stopDiscovering();
    kit.close();
    throw error;
  }
}
export async function sendOwnerAction({
  chainId,
  vault,
  owner,
  data,
  signer,
  client = clientFor(chainId === 177 ? 177 : 133),
  proposal,
}: {
  chainId: number;
  vault: Address;
  owner: Address;
  data: Hex;
  signer: OwnerSigner;
  client?: ReturnType<typeof clientFor>;
  proposal?: OwnerProposal;
}) {
  try {
    assertOwnerChain(chainId);
    const action = decodeFunctionData({ abi: vaultAbi, data });
    if (
      action.functionName !== 'setMandate' &&
      action.functionName !== 'revoke' &&
      action.functionName !== 'pause' &&
      action.functionName !== 'unpause' &&
      action.functionName !== 'withdraw'
    )
      throw Error('Unsupported owner action');
    const actualChain = await client.getChainId();
    if (actualChain !== chainId) throw Error('Owner RPC chain mismatch');
    assertOwnerChain(actualChain);
    const liveOwner = await client.readContract({
      address: vault,
      abi: vaultAbi,
      functionName: 'owner',
    });
    const ledgerOwner = await signer.address();
    if (
      getAddress(liveOwner) !== getAddress(owner) ||
      getAddress(ledgerOwner) !== getAddress(owner)
    )
      throw Error('Ledger address does not match current vault owner');
    const [nonce, gasPrice, gas] = await Promise.all([
      client.getTransactionCount({ address: owner, blockTag: 'pending' }),
      client.getGasPrice(),
      client.estimateGas({ account: owner, to: vault, data, value: 0n }),
    ]);
    const tx = {
      type: 'legacy' as const,
      chainId,
      nonce,
      gasPrice,
      gas: (gas * 12n) / 10n,
      to: vault,
      data,
      value: 0n,
    };
    assertOwnerChain(await client.getChainId());
    async function checkLiveProposal() {
      if (proposal) {
        if (
          proposal.target?.chainId !== chainId ||
          proposal.target.vault.toLowerCase() !== vault.toLowerCase()
        )
          throw Error('Desk proposal target mismatch');
        const blockNumber = await client.getBlockNumber({ cacheTime: 0 });
        const [m, paused] = await Promise.all([
          client.readContract({
            address: vault,
            abi: vaultAbi,
            functionName: 'mandate',
            blockNumber,
          }),
          client.readContract({
            address: vault,
            abi: vaultAbi,
            functionName: 'paused',
            blockNumber,
          }),
        ]);
        const [
          agent,
          expiry,
          maxTradeInA,
          maxTradeInB,
          maxDailyInB,
          maxExposureBps,
          maxSlippageBps,
          maxDrawdownBps,
          minIntervalSec,
          policyHash,
        ] = m;
        const signed: SignedMandate = {
          agent,
          expiry,
          maxTradeInA,
          maxTradeInB,
          maxDailyInB,
          maxExposureBps,
          maxSlippageBps,
          maxDrawdownBps,
          minIntervalSec,
          policyHash,
        };
        assertProposal(proposal, signed, paused, data);
      }
    }
    await checkLiveProposal();
    const signature = await signer.signTransaction(
      serializeTransaction(tx),
      chainId,
    );
    // Legacy Ledger signatures may carry parity or EIP-155 v; reject any other chain.
    const v = BigInt(signature.v);
    const parity =
      v === 0n || v === 1n
        ? v
        : v === 27n || v === 28n
          ? v - 27n
          : v - 35n - 2n * BigInt(chainId);
    if (parity !== 0n && parity !== 1n)
      throw Error('Ledger signature chain mismatch');
    const signed = serializeTransaction(tx, {
      r: signature.r,
      s: signature.s,
      v: 35n + 2n * BigInt(chainId) + parity,
    });
    if (
      getAddress(
        await recoverTransactionAddress({ serializedTransaction: signed }),
      ) !== getAddress(owner)
    )
      throw Error('Signed transaction does not recover to vault owner');
    assertOwnerChain(await client.getChainId());
    await checkLiveProposal();
    if ((await client.getChainId()) !== chainId)
      throw Error('Owner RPC chain changed');
    return await client.sendRawTransaction({ serializedTransaction: signed });
  } finally {
    await signer.disconnect();
  }
}
