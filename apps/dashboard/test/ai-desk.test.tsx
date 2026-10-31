import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { it, expect, vi, afterEach } from 'vitest';
import { DeskView } from '../src/views/Desk.js';
afterEach(() => vi.unstubAllGlobals());
it('interprets via Groq then answers from verified evidence', async () => {
  const send = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        providers: [{ id: 'groq', available: true, model: 'test-model' }],
      }),
    )
    .mockResolvedValueOnce(
      Response.json({
        provider: 'groq',
        model: 'test-model',
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
          providers: [
            { id: 'openrouter', available: true, model: 'test-router' },
          ],
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
