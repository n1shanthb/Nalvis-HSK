import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { it, expect, vi, afterEach } from 'vitest';
const credits = {
  remaining: 19,
  globalRemaining: 199,
  resetAt: 1900000000,
  retryAfter: 0,
};
import { DeskView } from '../src/views/Desk.js';
afterEach(() => vi.unstubAllGlobals());
it('interprets via Groq then answers from verified evidence', async () => {
  const send = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        providers: [{ id: 'groq', available: true }],
        credits,
        status: 'ready',
      }),
    )
    .mockResolvedValueOnce(
      Response.json({
        provider: 'groq',
        model: 'test-model',
        credits,
        command: 'why REJECT #3',
        promptHash: 'a'.repeat(64),
        outputHash: 'b'.repeat(64),
      }),
    );
  vi.stubGlobal('fetch', send);
  render(<DeskView demo />);
  await waitFor(() =>
    expect(
      (screen.getByRole('option', { name: 'Groq' }) as HTMLOptionElement)
        .disabled,
    ).toBe(false),
  );
  fireEvent.change(screen.getByLabelText('Language engine'), {
    target: { value: 'groq' },
  });
  fireEvent.change(screen.getByLabelText('Ask Nalvis'), {
    target: { value: 'Explain the rejected decision' },
  });
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: 'Ask desk' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Ask desk' }));
  await screen.findByText(/Receipt #3 · REJECT:/);
  expect(screen.getByText('why REJECT #3')).toBeTruthy();
  expect(JSON.parse(send.mock.calls[1][1].body)).toEqual({
    provider: 'groq',
    text: 'Explain the rejected decision',
  });
});
it('uses original text with a visible fallback when the provider fails', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          providers: [{ id: 'openrouter', available: true }],
          credits,
          status: 'ready',
        }),
      )
      .mockRejectedValueOnce(new Error('offline')),
  );
  render(<DeskView demo />);
  await waitFor(() =>
    expect(
      (screen.getByRole('option', { name: 'OpenRouter' }) as HTMLOptionElement)
        .disabled,
    ).toBe(false),
  );
  fireEvent.change(screen.getByLabelText('Language engine'), {
    target: { value: 'openrouter' },
  });
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: 'show P&L' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole('button', { name: 'show P&L' }));
  await screen.findByText(/AI unavailable or unable/);
  await screen.findByText(/P&L vs hold after gas:/);
});

it('shows exhausted credits and uses built-in commands without another provider call', async () => {
  const send = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        providers: [{ id: 'groq', available: true }],
        credits: { ...credits, remaining: 1 },
        status: 'ready',
      }),
    )
    .mockResolvedValueOnce(
      Response.json(
        {
          error: 'Budget exhausted',
          credits: { ...credits, remaining: 0, retryAfter: 60 },
        },
        { status: 429 },
      ),
    );
  vi.stubGlobal('fetch', send);
  render(<DeskView demo />);
  await waitFor(() =>
    expect(
      (screen.getByRole('option', { name: 'Groq' }) as HTMLOptionElement)
        .disabled,
    ).toBe(false),
  );
  fireEvent.change(screen.getByLabelText('Language engine'), {
    target: { value: 'groq' },
  });
  fireEvent.change(screen.getByLabelText('Ask Nalvis'), {
    target: { value: 'show positions' },
  });
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: 'Ask desk' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Ask desk' }));
  await screen.findByText(/AI credits: 0 remaining today/);
  expect(
    (screen.getByLabelText('Language engine') as HTMLSelectElement).value,
  ).toBe('rules');
  await screen.findByText(/AI request budget or rate limit reached/);
  fireEvent.click(screen.getByRole('button', { name: 'show P&L' }));
  await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
});
