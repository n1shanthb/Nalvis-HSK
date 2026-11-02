import { expect, it, vi } from 'vitest';
import { keccak256, toBytes } from 'viem';
import { readStrategyNotes } from '../src/agent/strategy-notes.js';
it('displays only the exact committed public strategy summary and rejects tampering', async () => {
  const rawOutput = JSON.stringify({
    thesis: 'Wait until executable costs clear.',
    confidence: 0.7,
    signals: ['Spread exceeds edge'],
  });
  const outputHash = keccak256(toBytes(rawOutput));
  const entry = {
    type: 'LLM_CALL',
    entryHash: '0x' + 'a'.repeat(64),
    data: { role: 'strategist', parsedOk: true, outputHash, rawOutput },
  };
  const request = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(Response.json([entry]));
  expect((await readStrategyNotes(outputHash)).thesis).toBe(
    'Wait until executable costs clear.',
  );
  request.mockResolvedValue(
    Response.json([
      {
        ...entry,
        data: { ...entry.data, rawOutput: rawOutput.replace('Wait', 'Trade') },
      },
    ]),
  );
  await expect(readStrategyNotes(outputHash)).rejects.toThrow(
    'commitment mismatch',
  );
});
