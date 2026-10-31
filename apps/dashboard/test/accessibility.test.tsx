import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { App } from '../src/App.js';
import { AgentView } from '../src/views/Agent.js';
import { MandateWizard } from '../src/owner/MandateWizard.js';
import { LedgerProvider } from '../src/owner/LedgerContext.js';
import { ConnectLedger } from '../src/owner/ConnectLedger.js';
import { snapshot, vault, owner } from './ux-fixtures.js';
test('drawer makes background inert, closes with document Escape, and restores focus', async () => {
  window.history.replaceState(null, '', '?demo=1#/agent');
  render(<App initialRoute="agent" />);
  const trigger = screen.getByRole('button', { name: 'AI desk', exact: true });
  trigger.focus();
  fireEvent.click(trigger);
  await screen.findByRole('dialog');
  expect(trigger.closest('[inert]')).toBeTruthy();
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(document.activeElement).toBe(trigger);
  expect(
    screen.getByRole('link', { name: 'Agent' }).getAttribute('aria-current'),
  ).toBe('page');
});
test('watch tabs respond to arrows and label their panel', () => {
  window.history.replaceState(null, '', '?demo=1#/agent');
  render(<AgentView />);
  const tab = screen.getByRole('tab', { name: 'Active watches' });
  tab.focus();
  fireEvent.keyDown(tab, { key: 'ArrowRight' });
  const history = screen.getByRole('tab', { name: 'Watch history' });
  expect(document.activeElement).toBe(history);
  expect(history.getAttribute('aria-selected')).toBe('true');
  expect(screen.getByRole('tabpanel').getAttribute('id')).toBe(
    history.getAttribute('aria-controls'),
  );
});
test('wizard validates agent and policy inline', () => {
  render(
    <MandateWizard chain={133} vault={vault} snapshot={snapshot} previewOnly />,
  );
  fireEvent.click(screen.getByText('Choose a preset'));
  fireEvent.click(screen.getByRole('button', { name: /Balanced/ }));
  for (const [name, value] of [
    ['Agent address', owner],
    ['Policy hash', 'bad'],
  ]) {
    const field = screen.getByLabelText(name);
    fireEvent.change(field, { target: { value } });
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(
      document.getElementById(field.getAttribute('aria-describedby')!),
    ).toBeTruthy();
  }
});
test('shared Ledger address is reused and checked against the wizard owner', async () => {
  const signerFactory = vi.fn(async () => ({
    address: async () => owner,
    disconnect: async () => {},
    signTransaction: vi.fn(),
  }));
  render(
    <LedgerProvider>
      <ConnectLedger
        vault={vault}
        signerFactory={signerFactory}
        readOwner={async () => owner}
      />
      <MandateWizard chain={133} vault={vault} snapshot={snapshot} />
    </LedgerProvider>,
  );
  fireEvent.click(screen.getAllByRole('button', { name: 'Connect Ledger' })[0]);
  await waitFor(() =>
    expect(
      screen
        .getByRole('button', { name: 'Choose a preset' })
        .hasAttribute('disabled'),
    ).toBe(false),
  );
  expect(screen.queryByRole('button', { name: 'Connect Ledger' })).toBeNull();
  expect(signerFactory).toHaveBeenCalledOnce();
});
