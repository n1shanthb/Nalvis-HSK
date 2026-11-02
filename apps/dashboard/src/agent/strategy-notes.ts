import { z } from 'zod';
import { keccak256, toBytes } from 'viem';
import { agentFeedBase, readFeedJSON } from './feed-client.js';
const entry = z.object({
  entryHash: z.string().regex(/^0x[\da-f]{64}$/i),
  type: z.string(),
  data: z.record(z.unknown()),
});
const notes = z.object({
  thesis: z.string().max(800),
  confidence: z.number().min(0).max(1),
  signals: z.array(z.string()).max(6),
});
/** Retrieve the exact recorded strategist output referenced by the latest action. */
export async function readStrategyNotes(outputHash: string) {
  if (!/^0x[\da-f]{64}$/i.test(outputHash)) throw Error('Invalid output hash');
  let after = '';
  for (let page = 0; page < 20; page++) {
    if (page > 0) await new Promise((resolve) => setTimeout(resolve, 150));
    const entries = z
      .array(entry)
      .parse(
        await readFeedJSON(
          agentFeedBase(),
          '/feed/journal?limit=200' + (after ? '&after=' + after : ''),
        ),
      );
    const match = entries.find(
      (e) =>
        e.type === 'LLM_CALL' &&
        e.data.role === 'strategist' &&
        e.data.parsedOk === true &&
        e.data.outputHash === outputHash,
    );
    if (match) {
      const raw = z.string().max(8192).parse(match.data.rawOutput);
      if (keccak256(toBytes(raw)).toLowerCase() !== outputHash.toLowerCase())
        throw Error('Output commitment mismatch');
      return notes.parse(JSON.parse(raw));
    }
    if (entries.length < 200) break;
    const next = entries.at(-1)!.entryHash;
    if (next === after) throw Error('Invalid journal cursor');
    after = next;
  }
  throw Error('Strategy notes unavailable in the bounded journal read');
}
