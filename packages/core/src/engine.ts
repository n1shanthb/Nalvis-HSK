import { riskCheck } from './risk.js';
import {
  evidenceSchema,
  engineStateSchema,
  type Evidence,
  type EngineState,
  type Decision,
  type RuleTrace,
} from './types.js';
import {
  mandateSchema,
  policySchema,
  policyHash,
  type Policy,
  type Mandate,
} from './policy.js';
import { cexMid, quality, valueA, evaluateQuote } from './engine-helpers.js';

export function decide(
  evidence: Evidence,
  policy: Policy,
  mandate: Mandate,
  state: EngineState,
): Decision {
  const ruleTrace: RuleTrace = [];
  let lastRisk: Decision['riskCheck'];
  const trace = (rule: string, pass: boolean, detail: string) => {
    ruleTrace.push({ rule, pass, detail });
  };
  const finish = (kind: Decision['kind']): Decision => ({
    kind,
    ruleTrace,
    ...(lastRisk ? { riskCheck: lastRisk } : {}),
    ...(evidence.validUntil !== undefined
      ? { validUntil: evidence.validUntil }
      : {}),
  });
  const ep = evidenceSchema.safeParse(evidence),
    pp = policySchema.safeParse(policy),
    mp = mandateSchema.safeParse(mandate),
    sp = engineStateSchema.safeParse(state);
  if (!ep.success || !pp.success || !mp.success || !sp.success) {
    trace('schema', false, 'Invalid evidence, policy, mandate or state');
    return finish('REJECT');
  }
  const e = ep.data,
    p = pp.data,
    m = mp.data;
  if (
    e.validUntil !== undefined &&
    e.validUntil !== e.now + (p.decisionTtlSec ?? 120)
  ) {
    trace('decision_expiry', false, 'Evidence expiry differs from policy');
    return finish('REJECT');
  }
  if (e.validUntil !== undefined && !e.riskInput) {
    trace(
      'risk_input',
      false,
      'Historical volatility is required for new decisions',
    );
    return finish('REJECT');
  }
  const failure = quality(e, p);
  trace('data_quality', !failure, failure);
  if (failure) return finish('REJECT');
  if (!state.llmValid) {
    trace(
      'llm_invalid',
      false,
      'Invalid preset output; deterministic fallback recorded',
    );
    return finish('REJECT');
  }
  const mid = cexMid(e);
  if (e.apro!.ageSec > p.dataQuality.aproMaxAgeSec)
    trace('apro_stale_ignored', true, 'Old APRO is evidence only');
  else if (
    Math.abs(mid / e.apro!.price - 1) * 10000 >
    p.dataQuality.aproBandBps
  ) {
    trace('apro_band', false, 'Fresh oracle disagrees');
    return finish('REJECT');
  } else trace('apro_band', true, 'Fresh oracle within band');
  if (m.revoked) {
    trace('mandate_revoked', false, 'Revoked');
    return finish('REJECT');
  }
  if (e.now >= m.expiry) {
    trace('mandate_expired', false, 'Expired');
    return finish('REJECT');
  }
  if (m.policyHash !== policyHash(p)) {
    trace('policy_hash', false, 'Policy differs from signed mandate');
    return finish('REJECT');
  }
  const spent =
    state.dailyBucket === Math.floor(e.now / 86400) ? state.dailySpentB : 0n;
  const loss =
    state.dailyBucket === Math.floor(e.now / 86400) ? state.dailyLossB : 0;
  if (spent >= m.maxDailyInB || loss >= p.dailyLossStopB) {
    trace('daily_stop', false, 'Daily budget or loss stop exhausted');
    return finish('REJECT');
  }
  const preset = p.presets[state.preset];
  if (
    e.now <
    state.lastTradeAt + Math.max(m.minIntervalSec, preset.cooldownSec)
  ) {
    trace('cooldown', true, 'Minimum interval not elapsed');
    return finish('WAIT');
  }
  const a = valueA(state.balanceA, e),
    total = a + state.balanceB;
  if (total <= 0n) {
    trace('balances', false, 'Empty portfolio');
    return finish('REJECT');
  }
  const weight = Number(a) / Number(total),
    deviation = weight - preset.targetWeightA;
  if (Math.abs(deviation) * 10000 <= preset.bandBps) {
    trace('band', true, 'Within target band');
    return finish('WAIT');
  }
  const direction = deviation < 0 ? 'BUY_A' : 'SELL_A';
  const basis = e.dexMid! / mid - 1;
  if (
    (direction === 'BUY_A' && basis >= 0) ||
    (direction === 'SELL_A' && basis <= 0)
  ) {
    trace('basis', false, 'Basis does not favour target direction');
    return finish('WAIT');
  }
  const grid = [...preset.sizeGridB].sort((a, b) => b - a);
  for (let i = 0; i < grid.length; i++) {
    const sizeB = grid[i];
    const quote = e.quotes.find(
      (q) => q.direction === direction && q.sizeB === sizeB,
    );
    if (!quote) {
      trace('quote_missing', false, `${direction} ${sizeB}`);
      return finish('REJECT');
    }
    const { valid, minOut, cost } = evaluateQuote(
      quote,
      e,
      p,
      m,
      state,
      spent,
      basis,
    );
    trace('size', valid, `${sizeB}: cost=${cost}`);
    const risk =
      valid && e.riskInput
        ? riskCheck(e, quote, preset.edgeBufferBps)
        : undefined;
    if (risk) lastRisk = risk;
    if (risk)
      trace(
        'monte_carlo',
        risk.accepted,
        `${sizeB}: 256 bounded price stresses; worst cost ${risk.worstCostBps.toFixed(4)} bps`,
      );
    if (valid && (!risk || risk.accepted))
      return {
        ...(e.validUntil !== undefined ? { validUntil: e.validUntil } : {}),
        ...(risk ? { riskCheck: risk } : {}),
        kind: i === 0 ? 'TRADE' : 'RESIZE',
        direction,
        sizeB,
        amountIn: quote.amountIn,
        minOut,
        ruleTrace,
      };
  }
  if (ruleTrace.some((t) => t.rule === 'monte_carlo' && !t.pass)) {
    trace(
      'risk_reject',
      false,
      'No smaller grid size survives historical sigma stress',
    );
    return finish('REJECT');
  }
  trace('edge_or_caps', false, 'No valid grid size');
  return finish('WAIT');
}
