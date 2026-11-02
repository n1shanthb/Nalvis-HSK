// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { mnemonicToAccount } from 'viem/accounts';
import { zeroHash } from 'viem';
import { createCopilotHandler } from '../server/copilot.js';
import {
  fixtureState,
  quote,
} from '../../../packages/core/test/agent/fixtures.js';
import {
  sellActionFor,
  sellPreview,
} from '../../../packages/core/src/agent/owner-preview.js';
import {
  sellSessionMessage,
  type SellSession,
} from '../../../packages/core/src/copilot.js';
import { hash } from '../../../packages/core/src/canonical.js';
async function setup() {
  const owner = mnemonicToAccount(
    'test test test test test test test test test test test junk',
  );
  const browser = mnemonicToAccount(
    'test test test test test test test test test test test junk',
    { addressIndex: 9 },
  );
  const state = fixtureState();
  const delegation: SellSession = {
    version: 1,
    scope: 'SELL_WITHIN_MANDATE',
    chainId: state.chainId,
    owner: owner.address,
    sessionKey: browser.address,
    vault: state.vault,
    policyHash: state.mandate.policyHash,
    issuedAt: state.blockTime,
    expiresAt: state.blockTime + 900,
    nonce: zeroHash,
  };
  const preview = sellPreview(
    state,
    await quote(sellActionFor(state), state),
    delegation,
  );
  const signed = {
    delegation,
    order: preview.order,
    ownerSignature: await owner.signMessage({
      message: sellSessionMessage(delegation),
    }),
    orderSignature: await browser.signMessage({
      message: { raw: hash(preview.order) },
    }),
  };
  const queue = {
    enqueue: vi.fn().mockResolvedValue(zeroHash),
    claim: vi.fn(),
    finish: vi.fn(),
    status: vi.fn(),
  };
  const deps = {
    state: async () => ({ owner: owner.address, state }),
    preview: vi.fn(),
    queue,
  };
  const handler = createCopilotHandler(
    { COPILOT_TRADES_ENABLED: 'true' },
    deps,
  );
  const post = (body: unknown, origin = 'https://app.example') =>
    new Request('https://app.example/api/copilot', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  return { signed, queue, deps, handler, post };
}
it('accepts only an explicit same-origin confirmation carrying both valid owner and order signatures', async () => {
  const f = await setup();
  expect(
    (await f.handler(f.post({ op: 'confirm', signed: f.signed }))).status,
  ).toBe(202);
  expect(f.queue.enqueue).toHaveBeenCalledTimes(1);
});
it('rejects forged, expired, changed-order and cross-origin requests without enqueuing', async () => {
  const f = await setup();
  expect(
    (
      await f.handler(
        f.post({ op: 'confirm', signed: f.signed }, 'https://evil.example'),
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await f.handler(
        f.post({
          op: 'confirm',
          signed: { ...f.signed, order: { ...f.signed.order, amountIn: '1' } },
        }),
      )
    ).status,
  ).toBe(400);
  f.deps.state = async () => ({
    state: { ...fixtureState(), blockTime: f.signed.order.validUntil + 1 },
    owner: f.signed.delegation.owner,
  });
  expect(
    (await f.handler(f.post({ op: 'confirm', signed: f.signed }))).status,
  ).toBe(400);
  expect(f.queue.enqueue).not.toHaveBeenCalled();
});
it('does not enqueue on a preview, or when the operator has not enabled command execution', async () => {
  const f = await setup();
  f.deps.preview.mockResolvedValue({ executable: false });
  expect(
    (await f.handler(f.post({ op: 'preview', session: f.signed.delegation })))
      .status,
  ).toBe(200);
  expect(
    (
      await createCopilotHandler(
        {},
        f.deps,
      )(f.post({ op: 'confirm', signed: f.signed }))
    ).status,
  ).toBe(503);
  expect(f.queue.enqueue).not.toHaveBeenCalled();
});
