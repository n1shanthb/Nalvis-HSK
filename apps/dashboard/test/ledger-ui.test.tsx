import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { App } from '../src/App.js';
import { demoReceipts } from '../src/lib/demo.js';
import { VerifyView } from '../src/views/Verify.js';
import { OperationView } from '../src/components/operations/OperationView.js';

test('legacy receipt links preserve selected receipt and demo provenance', async () => {
  const hash = demoReceipts[0].receiptHash;
  window.history.replaceState(null, '', `?demo=1#/receipts?receipt=${hash}`);
  render(<App />);
  await screen.findByRole('heading', {
    name: 'Every decision. Accounted for.',
  });
  expect(window.location.hash).toBe(`#/activity?receipt=${hash}`);
  expect(window.location.search).toBe('?demo=1');
  expect(
    screen.getByRole('link', { name: 'Activity', current: 'page' }),
  ).toBeTruthy();
  expect(document.querySelector('.activity-row[open]')?.textContent).toContain(
    hash,
  );
});

test('market evidence stays independently addressable without an agent redirect', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw Error('offline UI fixture');
    }),
  );
  try {
    window.history.replaceState(null, '', '?#/evidence');
    render(<App />);
    await screen.findByRole('heading', { name: 'Live market evidence' });
    expect(window.location.hash).toBe('#/evidence');
  } finally {
    vi.unstubAllGlobals();
  }
});

test('reduced motion uses keyboard-selectable operations without requiring WebGL', async () => {
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  try {
    render(<OperationView feed={null} />);
    await waitFor(() =>
      expect(
        screen
          .getByRole('button', { name: '2D fallback' })
          .hasAttribute('disabled'),
      ).toBe(true),
    );
    fireEvent.click(
      screen.getAllByRole('button', { name: /Receipt PROOF/ })[0],
    );
    expect(
      screen.getByRole('link', { name: 'Inspect receipts & verify →' }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'No connected agent feed. No stage activity is assumed.',
      ),
    ).toBeTruthy();
    expect(document.querySelector('canvas')).toBeNull();
  } finally {
    vi.unstubAllGlobals();
  }
});

test('a demo Activity transaction deep link verifies against its recorded RPC without live calls', async () => {
  const tx = demoReceipts[0].settlement!.transactionHash;
  window.history.replaceState(null, '', `?demo=1#/verify?tx=${tx}`);
  const fetcher = vi.fn(async () => {
    throw Error('network must not be used');
  });
  vi.stubGlobal('fetch', fetcher);
  try {
    render(<VerifyView chain={31337} demo />);
    await screen.findByRole('heading', { name: 'PASS' });
    expect(fetcher).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toContain(
      'Offline RPC replay',
    );
  } finally {
    vi.unstubAllGlobals();
  }
});
