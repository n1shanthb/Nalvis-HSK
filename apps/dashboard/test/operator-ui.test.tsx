import { render, screen, fireEvent } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { App } from '../src/App.js';
import { Header } from '../src/components/Header.js';
import { AgentView } from '../src/views/Agent.js';

test('mobile navigation opens modally, closes on Escape and restores its trigger', () => {
  const show = vi.fn(function (this: HTMLDialogElement) {
    this.open = true;
  });
  const close = vi.fn(function (this: HTMLDialogElement) {
    this.open = false;
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: show,
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: close,
  });
  render(<Header demo onDesk={() => {}} activeRoute="agent" />);
  const trigger = screen.getByRole('button', { name: 'Menu' });
  fireEvent.click(trigger);
  expect(show).toHaveBeenCalledOnce();
  const dialog = screen.getByRole('dialog', { name: 'Workspace navigation' });
  expect(dialog.querySelector('[aria-current="page"]')?.textContent).toContain(
    'Agent',
  );
  fireEvent(dialog, new Event('cancel', { bubbles: true }));
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(trigger);
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
});

test('skip link focuses the workspace without changing hash routing', async () => {
  window.history.replaceState(null, '', '?demo=1#/verify');
  const scroll = vi.fn();
  render(<App initialRoute="verify" />);
  const main = screen.getByRole('main');
  main.scrollIntoView = scroll;
  fireEvent.click(screen.getByRole('link', { name: 'Skip to content' }));
  expect(document.activeElement).toBe(main);
  expect(window.location.hash).toBe('#/verify');
});

test('readiness precedes charts and disconnected state never presents fixture status', () => {
  window.history.replaceState(null, '', '?#/agent');
  const { container } = render(<AgentView />);
  const readiness = screen.getByLabelText('System readiness');
  const chart = container.querySelector('.chart');
  expect(chart).toBeTruthy();
  expect(
    readiness.compareDocumentPosition(chart!) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    screen.getByText('Agent feed not connected yet', { selector: 'strong' }),
  ).toBeTruthy();
  expect(screen.queryByText('Agent online')).toBeNull();
});
