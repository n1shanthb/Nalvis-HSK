import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { useResource } from '../src/lib/useResource.js';
import { MandateView } from '../src/views/Mandate.js';
import { DeploymentError } from '../src/lib/clients.js';
import * as clients from '../src/lib/clients.js';
afterEach(() => vi.useRealTimers());
test('failed poll keeps owner flow mounted at current step', async () => {
  vi.useFakeTimers();
  const loader = vi
    .fn()
    .mockResolvedValueOnce('vault')
    .mockRejectedValue(Error('timeout'));
  function View() {
    const r = useResource(loader);
    return (
      <>
        {r.data && <input aria-label="wizard step" defaultValue="Connect" />}
        {r.error && <p>stale, retrying</p>}
      </>
    );
  }
  render(<View />);
  await act(async () => {});
  fireEvent.change(screen.getByLabelText('wizard step'), {
    target: { value: 'Review' },
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30000);
  });
  expect((screen.getByLabelText('wizard step') as HTMLInputElement).value).toBe(
    'Review',
  );
  expect(screen.getByText('stale, retrying')).toBeTruthy();
});
test.each([
  ['missing', 'Not deployed on 133 yet'],
  ['unverified', 'Deployment not verified against docs/ADDRESSES.md'],
  ['rpc', 'RPC unavailable, retrying'],
])('mandate identifies %s errors', async (kind, message) => {
  vi.spyOn(clients, 'loadDeployment').mockRejectedValue(
    kind === 'rpc'
      ? Error('timeout')
      : new DeploymentError(kind as 'missing' | 'unverified'),
  );
  render(<MandateView chain={133} />);
  await waitFor(() =>
    expect(screen.getAllByText(message).length).toBeGreaterThan(0),
  );
  if (kind !== 'missing')
    expect(screen.queryByText('Not deployed on 133 yet')).toBeNull();
});
