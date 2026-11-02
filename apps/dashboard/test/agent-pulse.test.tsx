import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { AgentPulse } from '../src/components/AgentPulse.js';
import { fixture } from '../src/agent/fixture.js';
it('shows recorded reasoning and outcomes without inventing a running phase or swap', () => {
  render(
    <AgentPulse
      observation={{
        feed: fixture,
        provenance: 'demo',
        connection: 'loading',
        unreachable: false,
      }}
    />,
  );
  expect(
    screen.getByRole('img', { name: 'Recorded decision outcomes over time' }),
  ).toBeTruthy();
  expect(
    screen.getByText(/In-progress model thinking is not exposed/),
  ).toBeTruthy();
  expect(
    screen.getByText(
      /Each dot is a recorded decision, not a swap confirmation/,
    ),
  ).toBeTruthy();
  expect(
    screen.getByText(
      fixture.actions.slice().sort((a, b) => b.at - a.at)[0].trail,
    ),
  ).toBeTruthy();
});
