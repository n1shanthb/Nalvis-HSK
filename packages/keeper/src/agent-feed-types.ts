export interface AgentState {
  executionChainId?: 133 | 177 | 31337;
  mode: 'live' | 'demo';
  state: 'online' | 'offline' | 'budget_paused' | 'needs_owner';
  provider: string;
  models: { strategist: string; fitter: string };
  lastWakeAt: number | null;
  nextWakeAt: number | null;
  wakesToday: number;
  llmCallsToday: number;
  spendTodayUsd: number;
  budgetUsd: number;
  journalHead: string | null;
  policyHashOk: boolean;
}
export interface WatchView {
  id: string;
  label: string;
  kind: string;
  createdBy: 'agent' | 'system';
  note: string;
  createdAt: number;
  expiresAt?: number;
  lastFiredAt?: number;
  fireCount: number;
}
export interface WatchChangeView {
  at: number;
  op: 'create' | 'edit' | 'delete';
  by: 'agent' | 'system';
  watchId: string;
  label: string;
  reason: string;
  accepted: boolean;
  rejectReason?: string;
}
export interface ActionView {
  at: number;
  intent: { type: string; notionalB: number };
  final: {
    kind: string;
    direction?: string;
    amountIn?: string;
    minOut?: string;
  };
  trail: string;
  rounds: {
    role: string;
    round: number;
    summary: string;
    outputHash: string | null;
  }[];
  violations: { limit: string; required: string; allowed: string }[];
  txHash?: string;
  receiptHash?: string;
}
export interface AgentFeed {
  spendByDay?: { day: string; usd: number }[];
  state: AgentState;
  watches: WatchView[];
  history: WatchChangeView[];
  actions: ActionView[];
  stats: {
    calls24h: number;
    estimatedSpendUsd: number;
    averageLatencyMs: number;
  };
}
