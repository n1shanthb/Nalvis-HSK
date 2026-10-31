import { render, screen } from '@testing-library/react';
import { it, expect } from 'vitest';
import { Landing } from '../src/views/Landing.js';
it('opens the recorded console explicitly and keeps product claims grounded', () => {
  render(<Landing />);
  expect(
    screen
      .getAllByRole('link', { name: /Open live console/ })[0]
      .getAttribute('href'),
  ).toBe('#/agent');
  expect(
    screen
      .getByRole('link', { name: /Watch recorded demo/ })
      .getAttribute('href'),
  ).toBe('?demo=1#/agent');
  expect(screen.getAllByText(/No proven trading edge/i).length).toBeGreaterThan(
    0,
  );
});
