import { render, screen } from '@testing-library/react';
import { it, expect } from 'vitest';
import { Landing } from '../src/views/Landing.js';
it('opens the recorded console explicitly and keeps product claims grounded', () => {
  render(<Landing />);
  expect(
    screen.getByRole('link', { name: /Open console/ }).getAttribute('href'),
  ).toBe('?demo=1#/mandate');
  expect(
    screen
      .getByRole('link', { name: /Enter the recorded demo/ })
      .getAttribute('href'),
  ).toBe('?demo=1#/mandate');
  expect(screen.getAllByText(/No proven trading edge/i).length).toBeGreaterThan(
    0,
  );
});
