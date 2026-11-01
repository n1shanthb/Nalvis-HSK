import type { Store } from '../../../../packages/core/src/agent/store.js';
import {
  validateChain,
  type JournalEntry,
} from '../../../../packages/core/src/agent/journal.js';
import { readFeedJSON, snapshotBase } from './feed-client.js';
const hash = /^0x[\da-f]{64}$/i;
/** Browser read-only artifact store. Hashes/replay are checked by the existing v3 verifier. */
export async function verificationStore(
  base = import.meta.env.VITE_AGENT_FEED_URL,
): Promise<Store> {
  let entries: JournalEntry[] = [];
  let source: 'live' | 'snapshot' = 'live';
  if (base)
    try {
      let after = '';
      for (;;) {
        const page = await readFeedJSON(
          base,
          `/feed/journal?limit=200${after ? '&after=' + after : ''}`,
        );
        if (!Array.isArray(page)) throw Error('Invalid journal');
        entries.push(...page);
        if (page.length < 200) break;
        const next = page.at(-1)?.entryHash;
        if (!hash.test(next) || next === after)
          throw Error('Invalid journal cursor');
        after = next;
        await new Promise((r) => setTimeout(r, 150));
      }
      validateChain(entries);
    } catch {
      source = 'snapshot';
    }
  else source = 'snapshot';
  const cache = new Map<string, string>();
  if (source === 'snapshot') {
    const manifest = await readFeedJSON('', snapshotBase + '/journal.json');
    if (!Array.isArray(manifest)) throw Error('Exported journal unavailable');
    entries = manifest;
    validateChain(entries);
  }
  cache.set(
    'journal.jsonl',
    entries.map((e) => JSON.stringify(e)).join('\n') + '\n',
  );
  const text = async (path: string): Promise<string> => {
    if (cache.has(path)) return cache.get(path)!;
    if (
      path !== 'policy.json' &&
      !/^(prompts|evidence|states|receipts)\/0x[\da-f]{64}\.json$/i.test(path)
    )
      throw Error('Artifact path denied');
    let raw: string;
    if (source === 'live') {
      // Keep a single verifier below the public feed rate cap.
      await new Promise((r) => setTimeout(r, 150));
      if (path === 'policy.json') {
        const p = (await readFeedJSON(base!, '/feed/policy')) as {
          text?: unknown;
        };
        if (typeof p.text !== 'string') throw Error('Policy unavailable');
        raw = p.text;
      } else
        raw = JSON.stringify(
          await readFeedJSON(base!, '/feed/' + path.slice(0, -5)),
        );
    } else {
      const r = await fetch(snapshotBase + '/' + path, {
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) throw Error('Snapshot artifact unavailable');
      raw = await r.text();
    }
    cache.set(path, raw);
    return raw;
  };
  return {
    text,
    async read<T>(p: string) {
      const raw = await text(p);
      return raw ? (JSON.parse(raw) as T) : undefined;
    },
    async write() {
      throw Error('Read only');
    },
    async writeText() {
      throw Error('Read only');
    },
    async append() {
      throw Error('Read only');
    },
  };
}
export const v3Groups = [
  ['(a) Receipt hash and chain', ['v3_receipt_hash', 'v3_chain_id']],
  ['(b) Signed policy and strategy', ['v3_policy_binding', 'v3_strategy']],
  [
    '(c) Journal chain and anchor range',
    ['v3_journal_range', 'v3_journal_head'],
  ],
  [
    '(d) Evidence and model transcripts',
    [
      'v3_evidence_hash',
      'v3_input_hash',
      'v3_output_hash',
      'v3_prompt_version',
      'v3_output_schema',
    ],
  ],
  ['(e) Watch bounds replay', ['v3_watch_bounds', 'v3_system_watch']],
  [
    '(f) Mandate and historical state',
    ['v3_mandate_replay', 'v3_historical_state', 'v3_final_check'],
  ],
  ['(g) Fitter acceptance and final action', ['v3_final_action', 'v3_intent']],
  [
    '(h) Calldata, receipt event and chain head',
    ['v3_calldata', 'v3_receipt_event', 'v3_chain_head'],
  ],
] as const;
