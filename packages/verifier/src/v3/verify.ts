import {
  decodeFunctionData,
  decodeEventLog,
  parseAbiItem,
  zeroHash,
  type Address,
  type Hex,
} from 'viem';
import { canonical, hash } from '../../../core/src/canonical.js';
import {
  receiptV3Schema,
  receiptHashV3,
} from '../../../core/src/agent/receipt.js';
import {
  validateChain,
  outputHash,
  type JournalEntry,
} from '../../../core/src/agent/journal.js';
import {
  strategistSchema,
  fitterSchema,
  fitterReplySchema,
} from '../../../core/src/agent/schema.js';
import {
  check,
  mandateStateSchema,
  type ExecQuote,
} from '../../../core/src/agent/mandate-check.js';
import {
  applyWatchChanges,
  defaultWatchBounds,
  type WatchState,
  type WatchChange,
  type WatchBounds,
} from '../../../core/src/agent/watches.js';
import {
  STRATEGIST_PROMPT_V1,
  FITTER_PROMPT_V1,
  FITTER_REPLY_PROMPT_V1,
} from '../../../core/src/agent/strategist.js';
import type { Store } from '../../../core/src/agent/store.js';
import { agentPolicyHash } from '../../../core/src/agent/policy.js';
import { vaultAbi, receiptEvent } from '../../../core/src/abi/index.js';
import { chainHead, type ChainReader, type Verification } from '../verify.js';
import { z } from 'zod';
export const modelNotice =
  'Model outputs are recorded and bound, not reproduced.';
const equal = (a: unknown, b: unknown) => canonical(a) === canonical(b);
export async function verifyV3(
  input: unknown,
  reader: ChainReader,
  store: Store | undefined,
  options: { txHash?: Hex } = {},
): Promise<Verification> {
  const result: Verification = {
    status: 'FAIL',
    checks: [],
    label: `execution — prices not real. ${modelNotice}`,
  };
  let current = 'v3_schema';
  const require = (name: string, pass: boolean, detail?: string) => {
    current = name;
    result.checks.push({ name, pass, ...(detail ? { detail } : {}) });
    if (!pass) throw Error(name);
  };
  try {
    const r = receiptV3Schema.parse(input);
    result.receiptV3 = r;
    require('v3_artifact_store', !!store, 'Pass the agent artifact root; journal/prompts/evidence/states/policy are required');
    require('v3_receipt_hash', receiptHashV3(r) === r.receiptHash);
    require('v3_chain_id', (await reader.chainId()) === r.executionChainId);
    const policyFile = await store!.text('policy.json'),
      policy = JSON.parse(policyFile);
    require('v3_policy_binding', agentPolicyHash(policyFile) === r.policyHash &&
      policy.version === 3 &&
      policy.strategyHash === r.strategy.strategyHash &&
      hash(policy.strategy) === r.strategy.strategyHash);
    const definition = policy.strategy;
    require('v3_strategy', definition.provider === r.strategy.provider &&
      equal(definition.models, r.strategy.models) &&
      definition.STRATEGIST_PROMPT_V1 === STRATEGIST_PROMPT_V1 &&
      definition.FITTER_PROMPT_V1 === FITTER_PROMPT_V1 &&
      definition.schemaVersion === 1);
    const entries: JournalEntry[] = (await store!.text('journal.jsonl'))
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    current = 'v3_journal_chain';
    validateChain(entries);
    const from =
        r.journalFrom === zeroHash
          ? -1
          : entries.findIndex((e) => e.entryHash === r.journalFrom),
      to = entries.findIndex((e) => e.entryHash === r.journalHead);
    require('v3_journal_range', (r.journalFrom === zeroHash || from >= 0) &&
      to > from);
    const range = entries.slice(from + 1, to + 1);
    require('v3_journal_head', range.at(-1)?.entryHash === r.journalHead);
    const artifact = async (
      kind: 'evidence' | 'prompts' | 'states',
      h: unknown,
    ) => {
      require('v3_artifact_path', typeof h === 'string' &&
        /^0x[\da-f]{64}$/i.test(h));
      const value = await store!.read(`${kind}/${h}.json`);
      require(`v3_${kind}_hash`, value !== undefined && hash(value) === h);
      return value;
    };
    await artifact('evidence', r.evidenceHash);
    // Replay all prior watch mutations to establish the true state at range start.
    let watchState: WatchState = { watches: [], changes: [] };
    let latestIntent: unknown,
      acceptedProposal: unknown,
      acceptedReply: unknown;
    let finalCheck: JournalEntry | undefined;
    for (const entry of entries.slice(0, to + 1)) {
      const d = entry.data,
        inRange = entry.seq > from;
      if (entry.type === 'WAKE') {
        await artifact('evidence', d.evidenceHash);
        for (const fired of d.firedWatches as { watch: { id: string } }[]) {
          const w = watchState.watches.find((w) => w.id === fired.watch.id);
          if (w) {
            w.lastFiredAt = entry.at;
            w.fireCount++;
          }
        }
        latestIntent = undefined;
        acceptedProposal = undefined;
        acceptedReply = undefined;
      }
      if (entry.type === 'LLM_CALL') {
        const prompt = (await artifact('prompts', d.promptHash)) as {
          system: string;
          input: unknown;
        };
        require('v3_input_hash', hash(prompt.input) === d.inputHash);
        const systems: Record<string, string> = {
          STRATEGIST_PROMPT_V1,
          FITTER_PROMPT_V1,
          FITTER_REPLY_PROMPT_V1,
        };
        require('v3_prompt_version', systems[String(d.promptVersion)] ===
          prompt.system);
        require('v3_output_hash', typeof d.rawOutput === 'string' &&
          outputHash(d.rawOutput) === d.outputHash &&
          Buffer.byteLength(d.rawOutput) <= 8192);
        const schema =
          d.promptVersion === 'STRATEGIST_PROMPT_V1'
            ? strategistSchema
            : d.promptVersion === 'FITTER_PROMPT_V1'
              ? fitterSchema
              : fitterReplySchema;
        let parsed: ReturnType<typeof schema.safeParse>;
        try {
          parsed = schema.safeParse(JSON.parse(String(d.rawOutput)));
        } catch {
          parsed = { success: false, error: new z.ZodError([]) };
        }
        require('v3_output_schema', parsed.success === d.parsedOk);
        require('v3_provider', d.provider === r.strategy.provider &&
          typeof d.model === 'string');
        if (parsed.success && inRange) {
          if (d.promptVersion === 'STRATEGIST_PROMPT_V1')
            latestIntent = strategistSchema.parse(parsed.data).action;
          if (d.promptVersion === 'FITTER_PROMPT_V1')
            acceptedProposal = fitterSchema.parse(parsed.data).proposal;
          if (d.promptVersion === 'FITTER_REPLY_PROMPT_V1')
            acceptedReply = fitterReplySchema.parse(parsed.data);
        }
      }
      if (entry.type === 'WATCH_CHANGE') {
        const event = d as WatchChange;
        if (event.by === 'system') {
          require('v3_system_watch', event.accepted &&
            event.op === 'create' &&
            event.after?.createdBy === 'system' &&
            (event.after.kind.type === 'retry' ||
              event.watchId === 'heartbeat'));
          if (event.after) watchState.watches.push(event.after);
        } else {
          // Rejected requests retain the original request, so bounds can be independently replayed.
          const request = d.request as
            | import('../../../core/src/agent/schema.js').WatchChanges
            | undefined;
          require('v3_watch_request', !!request);
          const applied = applyWatchChanges(
            watchState,
            request!,
            entry.at,
            (definition.watchBounds ?? defaultWatchBounds) as WatchBounds,
          );
          const actual = applied.events[0];
          const { request: _request, ...recorded } = d;
          void _request;
          require('v3_watch_bounds', !!actual && equal(actual, recorded));
          watchState = applied.state;
        }
      }
      if (entry.type === 'MANDATE_CHECK' && inRange) {
        const snapshot = mandateStateSchema.parse(
          await artifact('states', d.stateHash),
        );
        require('v3_state_block', snapshot.block ===
          BigInt(String(d.stateBlock)));
        const q = d.quote as ExecQuote;
        const quote = {
          ...q,
          block: BigInt(q.block),
          amountIn: BigInt(q.amountIn),
          amountOut: BigInt(q.amountOut),
        };
        const action = importAction(d.action),
          prepared = d.prepared as
            | import('../../../core/src/agent/mandate-check.js').Prepared
            | undefined;
        const restored = prepared
          ? {
              ...prepared,
              amountIn: BigInt(prepared.amountIn),
              minOut: BigInt(prepared.minOut),
              nonce: BigInt(prepared.nonce),
            }
          : undefined;
        const replay = check(action, snapshot, quote, restored);
        if (!d.simulation)
          require('v3_mandate_replay', replay.ok === d.ok &&
            equal(replay.violations, d.violations) &&
            equal(replay.headroom, d.headroom));
        else require('v3_simulation_violation', d.ok === false);
        if (!d.projected && reader.agentState) {
          const historical = await reader.agentState(
            r.contract as Address,
            snapshot.block,
            snapshot.agent,
          );
          const { pending: _p, ...actual } = historical,
            { pending: _s, ...expected } = snapshot;
          void _p;
          void _s;
          require('v3_historical_state', equal(actual, expected));
        }
        if (!d.projected && d.ok) finalCheck = entry;
      }
    }
    require('v3_intent', r.strategy.mode === 'rules-demo' ||
      equal(latestIntent, r.intent) ||
      r.intent.reason === 'llm_invalid');
    require('v3_final_check', !!finalCheck &&
      finalCheck.data.stateHash === r.mandateCheck.stateHash &&
      r.mandateCheck.ok &&
      r.simulation.ok &&
      r.simulation.block === r.mandateCheck.stateBlock);
    const finalState = mandateStateSchema.parse(
      await artifact('states', r.mandateCheck.stateHash),
    );
    const fq = finalCheck!.data.quote as ExecQuote;
    const finalAction = importAction(finalCheck!.data.action);
    const replay = check(
      finalAction,
      finalState,
      {
        ...fq,
        block: BigInt(fq.block),
        amountIn: BigInt(fq.amountIn),
        amountOut: BigInt(fq.amountOut),
      },
      r.final,
    );
    require('v3_final_action', replay.ok &&
      equal(replay.prepared, r.final) &&
      r.final.direction === finalAction.type &&
      r.prevHead === r.final.prevHead);
    if (r.final.direction !== 'HOLD' && r.fit.rounds > 0) {
      const reply = acceptedReply as
          z.infer<typeof fitterReplySchema> | undefined,
        proposal = acceptedProposal as z.infer<typeof fitterSchema>['proposal'];
      require('v3_fitter_acceptance', reply?.decision === 'accept' ||
        reply?.decision === 'revise');
      if (reply?.decision === 'accept')
        require('v3_accepted_leg', !!proposal &&
          proposal.type === r.final.direction &&
          proposal.legs[0].notionalB === finalAction.notionalB &&
          equal(proposal.legs, r.fit.legs));
      if (reply?.decision === 'revise')
        require('v3_revised_action', equal(reply.revisedAction, finalAction));
    }
    if (r.final.direction !== 'HOLD' && r.final.direction !== r.intent.type)
      require('v3_direction_acceptance', (r.fit.acceptedDirectionChange &&
        (acceptedReply as { decision?: string })?.decision === 'accept') ||
        (r.fit.acceptedDirectionChange &&
          (acceptedReply as { decision?: string })?.decision === 'revise'));
    const txHash = options.txHash ?? r.settlement?.transactionHash;
    require('v3_settlement', !!txHash);
    const mined = z
      .object({
        status: z.literal('success'),
        blockNumber: z.bigint(),
        to: z.string(),
        logs: z.array(
          z
            .object({
              address: z.string(),
              data: z.string(),
              topics: z.array(z.string()),
            })
            .passthrough(),
        ),
      })
      .passthrough()
      .parse(await reader.receipt(txHash!));
    const tx = z
      .object({ to: z.string(), input: z.string() })
      .passthrough()
      .parse(await reader.transaction(txHash!));
    require('v3_tx_destination', tx.to.toLowerCase() ===
      r.contract.toLowerCase() &&
      mined.to.toLowerCase() === r.contract.toLowerCase());
    const decoded = decodeFunctionData({
      abi: vaultAbi,
      data: tx.input as Hex,
    });
    const kind = ['TRADE', 'RESIZE', 'WAIT', 'REJECT'].indexOf(r.final.kind);
    if (kind >= 2)
      require('v3_calldata', decoded.functionName === 'commitHold' &&
        equal(decoded.args, [r.receiptHash, r.prevHead, kind]));
    else {
      require('v3_calldata_function', decoded.functionName === 'trade');
      const p = (decoded.args as readonly unknown[])[0] as Record<
        string,
        unknown
      >;
      require('v3_calldata', equal(p, {
        tokenIn: r.final.tokenIn,
        amountIn: r.final.amountIn,
        minOut: r.final.minOut,
        deadline: BigInt(r.final.deadline),
        validUntil: BigInt(r.final.validUntil),
        nonce: r.final.nonce,
        prevHead: r.prevHead,
        receiptHash: r.receiptHash,
        kind,
      }));
    }
    const events = mined.logs
      .filter((l) => l.address.toLowerCase() === r.contract.toLowerCase())
      .flatMap((l) => {
        try {
          return [
            decodeEventLog({
              abi: [parseAbiItem(receiptEvent)],
              data: l.data as Hex,
              topics: l.topics as [Hex, ...Hex[]],
            }).args,
          ];
        } catch {
          return [];
        }
      });
    require('v3_receipt_event', events.length === 1 &&
      events[0].seq === r.seq &&
      events[0].receiptHash === r.receiptHash &&
      events[0].prevHead === r.prevHead &&
      events[0].policyHash === r.policyHash &&
      events[0].kind === kind &&
      events[0].amountIn === r.final.amountIn &&
      events[0].minOut === r.final.minOut);
    if (kind < 2)
      require('v3_event_token', events[0].tokenIn.toLowerCase() ===
        r.final.tokenIn.toLowerCase());
    if (reader.timestamp) {
      const at = await reader.timestamp(mined.blockNumber);
      require('v3_mined_expiry', kind >= 2 ||
        (at <= r.final.validUntil && at <= r.final.deadline));
    }
    result.headAfter = chainHead(r.prevHead, r.receiptHash, r.seq);
    require('v3_chain_head', (await reader.head(
      r.contract as Address,
      mined.blockNumber,
    )) === result.headAfter);
    result.status = 'PASS';
  } catch (e) {
    if (!result.checks.some((c) => c.name === current && !c.pass))
      result.checks.push({
        name: current,
        pass: false,
        detail: e instanceof Error ? e.message : 'Invalid v3 receipt',
      });
  }
  return result;
}
import { actionSchema } from '../../../core/src/agent/schema.js';
function importAction(value: unknown) {
  return actionSchema.parse(value);
}
