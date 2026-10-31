import { MandateStateReadError } from './turnover.js';
import { decide } from '../engine.js';
import { zeroHash, formatUnits, type Hex } from 'viem';
import { hash } from '../canonical.js';
import { assertWritableChain } from '../addresses.js';
import type { Provider } from './provider.js';
import type { Store } from './store.js';
import { createJournal } from './journal.js';
import {
  type AgentConfig,
  validateAgentPolicy,
  strategyHash,
} from './policy.js';
import { loadWatches, applyWatchChanges, type WatchState } from './watches.js';
import {
  budgetLeft,
  evaluate,
  type Budget,
  type EvidenceLite,
  type FiredWatch,
} from './monitor.js';
import { runStrategist } from './strategist.js';
import { type Action, type Watch, type StrategistOutput } from './schema.js';
import {
  check,
  quoteTwap,
  type MandateState,
  type ExecQuote,
  type Prepared,
} from './mandate-check.js';
import { fitToMandate, needsOwner, retryAt, type FitResult } from './fitter.js';
import { buildReceiptV3, type ReceiptV3 } from './receipt.js';
export type AgentClients = {
  evidenceLite(): Promise<EvidenceLite>;
  /** Service wrapper supplies collectEvidence(), always refreshed for each wake. */
  collectEvidence(): Promise<unknown>;
  readState(): Promise<MandateState>;
  quote(action: Action, state: MandateState): Promise<ExecQuote>;
  simulate(
    state: MandateState,
    prepared: Prepared,
    receiptHash?: Hex,
  ): Promise<{ ok: boolean; block: bigint; error?: string }>;
  /** send must enforce RPC chain, wallet pending nonce, latest head/nonce and eth_call immediately before signing. No retries. */
  send(receipt: ReceiptV3): Promise<{ transactionHash: Hex }>;
  /** Explicit demo callback invokes legacy decide() with its existing evidence/policy/mandate/state. */
  rulesDemo?(): Promise<Parameters<typeof decide>>;
};
export async function createAgent({
  provider,
  store,
  clients,
  config,
}: {
  provider: Provider;
  store: Store;
  clients: AgentClients;
  config: AgentConfig;
}) {
  const journal = await createJournal(store);
  await store.writeText('policy.json', config.policyFile);
  await store.writeText(
    `policies/${hash(config.policyFile)}.json`,
    config.policyFile,
  );
  type Runtime = {
    budget: Budget;
    thesis: string;
    journalFrom: Hex;
    lastAnchor: number;
    lastPoll?: number;
    state?: string;
    stateAt?: number;
    stateReason?: string;
    ownerEvents: string[];
    pendingOwnerEvents?: NonNullable<EvidenceLite['ownerEvents']>;
  };
  const runtime = (await store.read<Runtime>('runtime.json')) ?? {
    budget: { wakes: [], costs: [] },
    thesis: '',
    journalFrom: zeroHash,
    lastAnchor: 0,
    ownerEvents: [],
  };
  let watches: WatchState | undefined,
    busy = false;
  const initWatches = async (now: number) => {
    const saved = await store.read<WatchState>('watches.json');
    const loaded = await loadWatches(store, now, config.heartbeatSec);
    if (!saved?.watches.some((w) => w.id === 'heartbeat')) {
      const after = loaded.watches.find((w) => w.id === 'heartbeat')!;
      await journal.append(
        'WATCH_CHANGE',
        {
          op: 'create',
          by: 'system',
          watchId: after.id,
          after,
          reason: after.note,
          accepted: true,
        },
        now,
      );
    }
    return loaded;
  };
  const save = async () => {
    await store.write('runtime.json', runtime);
    if (watches) await store.write('watches.json', watches);
  };
  const state = async (value: string, reason: string, now: number) => {
    if (
      runtime.state !== value ||
      runtime.stateReason !== reason ||
      now - (runtime.stateAt ?? 0) >= 3600
    ) {
      await journal.append(
        'STATE',
        { state: value, reason, mode: config.mode },
        now,
      );
      runtime.state = value;
      runtime.stateReason = reason;
      runtime.stateAt = now;
      await save();
    }
  };
  const readState = async (now: number) => {
    try {
      return await clients.readState();
    } catch (e) {
      if (e instanceof MandateStateReadError)
        await state('NEEDS_OWNER', e.message, now);
      throw e;
    }
  };
  const left = (now: number) =>
    budgetLeft(
      runtime.budget,
      now,
      config.maxWakesPerHour,
      config.dailyLlmBudgetUsd,
      config.minWakeGapSec,
    );
  const charge = async (usd: number, now: number) => {
    runtime.budget.costs.push({ at: now, usd });
    await save();
    if (left(now).usd <= 0)
      await state('BUDGET_PAUSED', 'Daily model budget exhausted', now);
  };
  const addRetry = async (at: number, now: number, legOf?: string) => {
    if (!watches) watches = await initWatches(now);
    const id = `retry:${legOf ?? 'wait'}:${at}`;
    if (watches.watches.some((w) => w.id === id)) return;
    const after: Watch = {
      id,
      kind: { type: 'retry', at, ...(legOf ? { legOf } : {}) },
      note: 'Reconfirm with fresh evidence before execution',
      createdBy: 'system',
      createdAt: now,
      cooldownSec: 60,
      fireCount: 0,
    };
    watches.watches.push(after);
    await journal.append(
      'WATCH_CHANGE',
      {
        op: 'create',
        by: 'system',
        watchId: id,
        after,
        reason: after.note,
        accepted: true,
      },
      now,
    );
    await save();
  };
  const wakeInternal = async (fired: FiredWatch[], now: number) => {
    if (!watches) watches = await initWatches(now);
    if (
      config.mode === 'offline' ||
      (config.mode !== 'rules-demo' && !provider.isConfigured())
    ) {
      await state('OFFLINE', 'No model key/model; monitor remains active', now);
      return;
    }
    if (await store.read('pending.json'))
      throw new Error(
        'Unresolved pending intent; reconcile before restart, never resend',
      );
    const budget = left(now);
    if (config.mode !== 'rules-demo' && budget.paused) {
      await state('BUDGET_PAUSED', 'Wake or daily model budget exhausted', now);
      return;
    }
    if (budget.debounced) return;
    await state(
      config.mode === 'rules-demo' ? 'DEMO' : 'ONLINE',
      'testnet sandbox; prices are not real',
      now,
    );
    const ownerIds = fired
      .filter((f) => f.watch.id.startsWith('owner:'))
      .map((f) => f.watch.id.slice(6));
    runtime.ownerEvents.push(...ownerIds);
    runtime.pendingOwnerEvents = (runtime.pendingOwnerEvents ?? []).filter(
      (e) => !ownerIds.includes(e.id),
    );
    runtime.budget.wakes.push(now);
    runtime.budget.lastWake = now;
    for (const f of fired) {
      const w = watches.watches.find((w) => w.id === f.watch.id);
      if (w) {
        w.lastFiredAt = now;
        w.fireCount++;
      }
    }
    await save();
    const evidence = await clients.collectEvidence(),
      evidenceHash = await journal.artifact('evidence', evidence);
    await journal.append(
      'WAKE',
      {
        firedWatches: fired,
        evidenceHash,
        mode: config.mode,
        activeWatches: watches.watches,
      },
      now,
    );
    let s = await readState(now);
    assertWritableChain(s.chainId);
    let local: Hex;
    try {
      local = validateAgentPolicy(config);
      if (provider.id !== 'openrouter')
        throw new Error('Provider differs from signed strategy');
      if (provider.models && hash(provider.models) !== hash(config.models))
        throw new Error('Provider models differ from signed strategy');
    } catch {
      await state(
        'NEEDS_OWNER',
        'Local policy/model/prompt binding invalid',
        now,
      );
      return;
    }
    const common = {
      provider,
      journal,
      now,
      charge: (usd: number) => charge(usd, now),
      canCall: () => left(now).usd > 0,
    };
    const valueB =
      Number(formatUnits(s.balanceB, s.decimalsB)) +
      Number(formatUnits(s.balanceA, s.decimalsA)) *
        Number(
          formatUnits(
            quoteTwap(s, 10n ** BigInt(s.decimalsA), false),
            s.decimalsB,
          ),
        );
    const empty: Action = {
      type: 'HOLD',
      urgency: 'now',
      reason: 'llm_invalid',
    };
    const holdCheck = check(empty, s, {
      block: s.block,
      at: s.blockTime,
      amountIn: 0n,
      amountOut: 0n,
    });
    const demo =
      config.mode === 'rules-demo' && clients.rulesDemo
        ? decide(...(await clients.rulesDemo()))
        : undefined;
    const demoOutput: StrategistOutput | undefined = demo
      ? {
          thesis: 'Explicit rules-demo: legacy decide()',
          action: {
            type:
              demo.kind === 'TRADE' || demo.kind === 'RESIZE'
                ? demo.direction === 'BUY_A'
                  ? 'BUY'
                  : 'SELL'
                : 'HOLD',
            ...(demo.sizeB ? { notionalB: String(demo.sizeB) } : {}),
            urgency: 'now',
            reason: 'rules-demo legacy deterministic engine',
          },
          watches: { create: [], update: [], delete: [] },
          confidence: 1,
          signals: [],
        }
      : undefined;
    const output =
      config.mode === 'rules-demo'
        ? demoOutput
        : await runStrategist({
            ...common,
            input: {
              firedWatches: fired,
              evidence,
              vaultState: {
                ...s,
                valueB,
                highWaterMark: formatUnits(s.highWaterMark, s.decimalsB),
              },
              mandateHuman: {
                ...s.mandate,
                maxTradeInA: formatUnits(s.mandate.maxTradeInA, s.decimalsA),
                maxTradeInB: formatUnits(s.mandate.maxTradeInB, s.decimalsB),
                maxDailyInB: formatUnits(s.mandate.maxDailyInB, s.decimalsB),
              },
              headroom: holdCheck.headroom,
              activeWatches: watches.watches,
              lastThesis: runtime.thesis,
              lastActions: journal.entries
                .filter((e) => e.type === 'ACTION' || e.type === 'FIT_RESULT')
                .slice(-10),
              budget,
            },
          });
    if (output) {
      runtime.thesis = output.thesis;
      // Apply/journal each request separately, including rejected original requests.
      const requests = [
        ...output.watches.create.map((d) => ({
          create: [d],
          update: [],
          delete: [],
        })),
        ...output.watches.update.map((d) => ({
          create: [],
          update: [d],
          delete: [],
        })),
        ...output.watches.delete.map((d) => ({
          create: [],
          update: [],
          delete: [d],
        })),
      ];
      for (const request of requests) {
        const applied = applyWatchChanges(
          watches,
          request,
          now,
          config.watchBounds,
        );
        watches = applied.state;
        for (const event of applied.events)
          await journal.append('WATCH_CHANGE', { ...event, request }, now);
      }
      await save();
    }
    // The strategist may think and manage watches even when execution needs the owner.
    if (s.mandate.policyHash !== local) {
      await state(
        'NEEDS_OWNER',
        'On-chain policyHash differs from exact local policy bytes',
        now,
      );
      return;
    }
    if (needsOwner(s)) {
      await state('NEEDS_OWNER', 'Mandate paused/revoked/expired', now);
      return;
    }
    const intent = output?.action ?? empty;
    let action = intent;
    let fit: FitResult = {
      outcome: 'fits',
      rounds: 0,
      action,
      legs:
        action.type === 'HOLD'
          ? []
          : [{ notionalB: action.notionalB!, notBefore: s.blockTime }],
      trail: action.reason,
      acceptedDirectionChange: false,
    };
    const recordCheck = async (a: Action, st: MandateState) => {
      const q =
        a.type === 'HOLD'
          ? { block: st.block, at: st.blockTime, amountIn: 0n, amountOut: 0n }
          : await clients.quote(a, st);
      const c = check(a, st, q, {
        validUntil: st.blockTime + config.ttlSec,
        kind: a.type === 'HOLD' ? 'WAIT' : fit.rounds > 0 ? 'RESIZE' : 'TRADE',
      });
      const stateHash = await journal.artifact('states', st);
      await journal.append(
        'MANDATE_CHECK',
        {
          stateBlock: String(st.block),
          stateHash,
          action: a,
          quote: q,
          ok: c.ok,
          violations: c.violations,
          headroom: c.headroom,
          prepared: c.prepared,
        },
        now,
      );
      return { q, c, stateHash };
    };
    let checked = await recordCheck(action, s);
    if (action.type !== 'HOLD' && checked.c.ok) {
      const initialSim = await clients.simulate(s, checked.c.prepared);
      if (!initialSim.ok) {
        checked.c.ok = false;
        checked.c.violations.push({
          limit: initialSim.error ?? 'eth_call',
          required: 'simulation succeeds',
          allowed: 'revert',
        });
        await journal.append(
          'MANDATE_CHECK',
          {
            stateBlock: String(s.block),
            stateHash: checked.stateHash,
            action,
            quote: checked.q,
            ok: false,
            violations: checked.c.violations,
            headroom: checked.c.headroom,
            simulation: initialSim,
          },
          now,
        );
      }
    }
    if (action.type !== 'HOLD' && !checked.c.ok) {
      fit = await fitToMandate({
        ...common,
        action,
        thesis: runtime.thesis,
        state: s,
        initial: checked.c,
        market: evidence,
        quote: clients.quote,
        rounds: config.fitRounds,
      });
      action = fit.action;
    }
    if (action.urgency === 'next_window' && action.type !== 'HOLD') {
      fit = {
        ...fit,
        outcome: 'WAIT',
        retryAt: Math.max(
          s.blockTime + 60,
          Number(s.lastTradeAt + s.mandate.minIntervalSec),
        ),
      };
      action = {
        type: 'HOLD',
        urgency: 'next_window',
        reason: 'Strategist requested next window',
      };
    }
    const legOf = hash({ intent, at: now });
    for (const leg of fit.legs.filter((l) => l.notBefore > s.blockTime))
      await addRetry(leg.notBefore, now, legOf);
    if (fit.retryAt) await addRetry(fit.retryAt, now, legOf);
    if (fit.outcome === 'NEEDS_OWNER') {
      await state('NEEDS_OWNER', fit.trail, now);
      return;
    }
    // Refresh ALL execution state after model calls; no cached authorization.
    s = await readState(now);
    assertWritableChain(s.chainId);
    if (s.mandate.policyHash !== local || needsOwner(s)) {
      await state('NEEDS_OWNER', 'Mandate changed during wake', now);
      return;
    }
    checked = await recordCheck(action, s);
    let simulation = await clients.simulate(s, checked.c.prepared);
    if (!checked.c.ok || !simulation.ok) {
      await journal.append(
        'MANDATE_CHECK',
        {
          stateBlock: String(s.block),
          stateHash: checked.stateHash,
          action,
          quote: checked.q,
          ok: false,
          violations: [
            ...checked.c.violations,
            ...(!simulation.ok
              ? [
                  {
                    limit: simulation.error ?? 'eth_call',
                    required: 'simulation succeeds',
                    allowed: 'revert',
                  },
                ]
              : []),
          ],
          headroom: checked.c.headroom,
          simulation,
        },
        now,
      );
      await addRetry(retryAt(s, checked.c), now);
      action = {
        type: 'HOLD',
        urgency: 'next_window',
        reason: 'Final execution recheck failed; retry scheduled',
      };
      checked = await recordCheck(action, s);
      simulation = await clients.simulate(s, checked.c.prepared);
    }
    if (!checked.c.ok || !simulation.ok) return;
    if (action.type === 'HOLD' && now - runtime.lastAnchor < config.anchorSec) {
      await journal.append(
        'ACTION',
        {
          kind: 'WAIT',
          amountIn: '0',
          minOut: '0',
          receiptHash: zeroHash,
          reason: action.reason,
          mode: config.mode,
        },
        now,
      );
      await save();
      return;
    }
    const receipt = buildReceiptV3({
      version: 3,
      marketDataChainId: 177,
      executionChainId: s.chainId,
      contract: s.vault,
      seq: s.seq,
      prevHead: s.head,
      policyHash: local,
      evidenceHash,
      strategy: {
        mode: config.mode === 'rules-demo' ? 'rules-demo' : 'agent',
        provider: provider.id,
        models: config.models,
        promptVersions: ['STRATEGIST_PROMPT_V1', 'FITTER_PROMPT_V1'],
        strategyHash: strategyHash(config),
      },
      intent,
      fit: {
        rounds: fit.rounds,
        trail: fit.trail,
        legs: fit.legs,
        acceptedDirectionChange: fit.acceptedDirectionChange,
      },
      final: checked.c.prepared,
      mandateCheck: {
        stateBlock: s.block,
        stateHash: checked.stateHash,
        ok: true,
      },
      journalHead: journal.head,
      journalFrom: runtime.journalFrom,
      simulation,
    });
    // Refresh immediately before durable intent/send; changes require a new wake.
    const guardState = await readState(now);
    assertWritableChain(guardState.chainId);
    const guardQuote =
      action.type === 'HOLD'
        ? {
            block: guardState.block,
            at: guardState.blockTime,
            amountIn: 0n,
            amountOut: 0n,
          }
        : await clients.quote(action, guardState);
    const guard = check(action, guardState, guardQuote, receipt.final);
    if (
      !guard.ok ||
      guardState.mandate.policyHash !== local ||
      guardState.vault !== s.vault ||
      guardState.chainId !== s.chainId ||
      hash(guardState.mandate) !== hash(s.mandate)
    ) {
      await journal.append(
        'MANDATE_CHECK',
        {
          stateBlock: String(guardState.block),
          stateHash: await journal.artifact('states', guardState),
          action,
          quote: guardQuote,
          ok: guard.ok,
          violations: guard.violations,
          headroom: guard.headroom,
          prepared: guard.prepared,
        },
        now,
      );
      await addRetry(guardState.blockTime + 60, now);
      return;
    }
    // Hash-dependent calldata has a second preflight. Durable intent precedes send.
    const finalSim = await clients.simulate(
      guardState,
      receipt.final,
      receipt.receiptHash,
    );
    if (!finalSim.ok) {
      await journal.append(
        'MANDATE_CHECK',
        {
          stateBlock: String(guardState.block),
          stateHash: await journal.artifact('states', guardState),
          action,
          quote: guardQuote,
          ok: false,
          violations: [
            {
              limit: finalSim.error ?? 'eth_call',
              required: 'simulation succeeds',
              allowed: 'revert',
            },
          ],
          headroom: guard.headroom,
          simulation: finalSim,
        },
        now,
      );
      await addRetry(guardState.blockTime + 60, now);
      await journal.append(
        'ACTION',
        {
          kind: 'WAIT',
          amountIn: '0',
          minOut: '0',
          receiptHash: zeroHash,
          reason: 'Hash-dependent simulation failed; retry scheduled',
          mode: config.mode,
        },
        now,
      );
      return;
    }
    await store.write(`receipts/${receipt.receiptHash}.json`, receipt);
    await store.write('pending.json', {
      receiptHash: receipt.receiptHash,
      seq: s.seq,
      prevHead: s.head,
    });
    const settlement = await clients.send(receipt);
    await store.write(`receipts/${receipt.receiptHash}.json`, {
      ...receipt,
      settlement,
    });
    await journal.append(
      'ACTION',
      {
        kind: receipt.final.kind,
        amountIn: String(receipt.final.amountIn),
        minOut: String(receipt.final.minOut),
        txHash: settlement.transactionHash,
        receiptHash: receipt.receiptHash,
        mode: config.mode,
      },
      now,
    );
    runtime.journalFrom = receipt.journalHead;
    runtime.lastAnchor = now;
    await save();
    await store.write('pending.json', null);
    if (left(now).paused)
      await state('BUDGET_PAUSED', 'Daily model budget exhausted', now);
    return { ...receipt, settlement };
  };
  const locked = async <T>(run: () => Promise<T>) => {
    if (busy) throw new Error('Agent tick/wake already running');
    busy = true;
    try {
      return await run();
    } finally {
      busy = false;
    }
  };
  return {
    journal,
    get mode() {
      return config.mode === 'rules-demo'
        ? 'rules-demo'
        : config.mode === 'offline' || !provider.isConfigured()
          ? 'offline'
          : 'agent';
    },
    wake: (fired: FiredWatch[]) =>
      locked(() => wakeInternal(fired, Math.floor(Date.now() / 1000))),
    tick: (now: number) =>
      locked(async () => {
        if (
          runtime.lastPoll !== undefined &&
          now - runtime.lastPoll < config.pollSec
        )
          return;
        runtime.lastPoll = now;
        watches ??= await initWatches(now);
        const lite = await clients.evidenceLite();
        const fired = evaluate(watches.watches, lite, now);
        runtime.pendingOwnerEvents ??= [];
        for (const event of lite.ownerEvents ?? [])
          if (
            !runtime.ownerEvents.includes(event.id) &&
            !runtime.pendingOwnerEvents.some((e) => e.id === event.id)
          )
            runtime.pendingOwnerEvents.push(event);
        for (const event of runtime.pendingOwnerEvents)
          fired.push({
            watch: {
              id: `owner:${event.id}`,
              kind: { type: 'time', at: now },
              note: event.name,
              createdBy: 'system',
              createdAt: now,
              cooldownSec: 60,
              fireCount: 0,
            },
            why: `Owner event ${event.name}; refresh live mandate`,
          });
        await save();
        if (
          config.mode === 'offline' ||
          (config.mode !== 'rules-demo' && !provider.isConfigured())
        ) {
          await state(
            'OFFLINE',
            'No model key/model; monitor remains active',
            now,
          );
          return;
        }
        if (config.mode !== 'rules-demo' && left(now).paused) {
          await state(
            'BUDGET_PAUSED',
            'Wake or daily model budget exhausted',
            now,
          );
          return;
        }
        if (runtime.state === 'BUDGET_PAUSED' || runtime.state === 'OFFLINE')
          await state(
            config.mode === 'rules-demo' ? 'DEMO' : 'ONLINE',
            'Model configured and budget window available',
            now,
          );
        if (fired.length) return wakeInternal(fired, now);
      }),
  };
}
