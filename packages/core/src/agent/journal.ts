import { keccak256, toBytes, zeroHash, type Hex } from 'viem';
import { canonical, hash } from '../canonical.js';
import type { Store } from './store.js';
export type EntryType =
  | 'WAKE'
  | 'LLM_CALL'
  | 'WATCH_CHANGE'
  | 'MANDATE_CHECK'
  | 'FIT_RESULT'
  | 'ACTION'
  | 'STATE';
export type JournalEntry = {
  seq: number;
  at: number;
  type: EntryType;
  data: Record<string, unknown>;
  prevEntryHash: Hex;
  entryHash: Hex;
};
export const outputHash = (raw: string) => keccak256(toBytes(raw));
export function validateChain(
  entries: JournalEntry[],
  from: Hex = zeroHash,
  firstSeq = 0,
): Hex {
  let prev = from;
  for (const e of entries) {
    const { entryHash, ...body } = e;
    if (
      e.seq !== firstSeq++ ||
      e.prevEntryHash !== prev ||
      hash(body) !== entryHash
    )
      throw new Error('Broken journal chain');
    prev = entryHash;
  }
  return prev;
}
/** Journal is authoritative: restart reads/validates the entire append-only log. */
export async function createJournal(store: Store) {
  const raw = await store.text('journal.jsonl');
  if (raw && !raw.endsWith('\n'))
    throw new Error('Truncated journal; manual recovery required');
  const entries: JournalEntry[] = raw.trim()
    ? raw
        .trimEnd()
        .split('\n')
        .map((line) => JSON.parse(line))
    : [];
  let head = validateChain(entries),
    queue = Promise.resolve();
  return {
    entries,
    get head() {
      return head;
    },
    async artifact(kind: 'prompts' | 'evidence' | 'states', value: unknown) {
      const h = hash(value);
      await store.write(`${kind}/${h}.json`, value);
      return h;
    },
    async append(
      type: EntryType,
      data: Record<string, unknown>,
      at: number,
    ): Promise<JournalEntry> {
      let entry!: JournalEntry;
      const task = queue.then(async () => {
        const body = {
          seq: entries.length,
          at,
          type,
          data,
          prevEntryHash: head,
        };
        entry = { ...body, entryHash: hash(body) };
        await store.append('journal.jsonl', canonical(entry));
        entries.push(entry);
        head = entry.entryHash;
      });
      queue = task;
      await task;
      return entry;
    },
  };
}
export type Journal = Awaited<ReturnType<typeof createJournal>>;
