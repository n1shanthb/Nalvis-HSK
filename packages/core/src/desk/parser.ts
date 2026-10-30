import { encodeFunctionData, keccak256, type Hex } from 'viem';
import { vaultAbi } from '../abi/index.js';
import type { Evidence, Mandate, Policy, Decision } from '../index.js';
import { nlToParamDiff } from '../llm.js';

export interface DeskState {
  balanceA: bigint;
  balanceB: bigint;
  initialBalanceA?: bigint;
  initialBalanceB?: bigint;
  lastDecision?: Decision;
  dailySpentB?: bigint;
  totalGasSpentUSD?: number;
}

export interface DeskParseResult {
  intent: 'POSITION_PNL' | 'DECISION_EXPLANATION' | 'MARKET_BASIS' | 'PARAM_UPDATE' | 'OWNER_ACTION' | 'REFUSAL';
  response: string;
  diff?: Record<string, unknown>;
  calldataHash?: Hex;
  preparedAction?: {
    functionName: string;
    calldata: Hex;
    calldataHash: Hex;
    notice: string;
  };
  refusedReason?: string;
  data?: Record<string, unknown>;
}

export class DeskParser {
  /**
   * Deterministic Natural-Language Desk Parser.
   * STRICT SECURITY BOUNDARY:
   * This class parses and answers queries deterministically.
   * It DOES NOT possess, instantiate, or import any signing keys, wallet instances,
   * RPC broadcast clients, or transaction sending routines.
   * Owner actions (revoke, pause) are PREPARED ONLY (calldata + hash) and must be signed by the Ledger owner.
   */
  constructor() {}

  public parse(
    query: string,
    context: {
      evidence?: Evidence;
      mandate?: Mandate;
      policy?: Policy;
      state?: DeskState;
      decimalsA?: number;
      decimalsB?: number;
    } = {},
  ): DeskParseResult {
    const q = query.trim().toLowerCase();

    // 1. Refusal check: Signing / Execution / Transfer requests
    if (
      /\b(sign|send|transfer|execute|swap|broadcast|transact|bhejo|sign karo|execute karo)\b/i.test(
        q,
      )
    ) {
      return {
        intent: 'REFUSAL',
        response:
          'Refusal: Natural language desk cannot sign, transfer funds, or broadcast transactions. Transactions require Ledger or agent engine execution within the signed mandate.',
        refusedReason: 'Execution/signing forbidden through NL desk',
      };
    }

    // 2. Refusal check: Private key / secrets request
    if (/\b(private\s*key|mnemonic|seed|secret|key do)\b/i.test(q)) {
      return {
        intent: 'REFUSAL',
        response:
          'Refusal: Secret material and private keys are never handled or accessible.',
        refusedReason: 'Secrets access forbidden',
      };
    }

    // 3. Owner Action: Revoke agent (prepare only, never sign)
    if (/\b(revoke|agent hatao|mandate radd|cancel agent)\b/i.test(q)) {
      const calldata = encodeFunctionData({ abi: vaultAbi, functionName: 'revoke' });
      const calldataHash = keccak256(calldata);
      return {
        intent: 'OWNER_ACTION',
        response: `Prepared owner action 'revoke()'. Calldata hash: ${calldataHash}. Review and sign using Ledger in the Owner panel.`,
        calldataHash,
        preparedAction: {
          functionName: 'revoke',
          calldata,
          calldataHash,
          notice: 'Requires Ledger owner signature in Owner panel. Zeroes the agent mandate immediately.',
        },
      };
    }

    // 4. Owner Action: Pause / Unpause vault (prepare only, never sign)
    if (/\b(pause vault|pause trading|rok do|trading pause|emergency stop)\b/i.test(q)) {
      const calldata = encodeFunctionData({ abi: vaultAbi, functionName: 'pause' });
      const calldataHash = keccak256(calldata);
      return {
        intent: 'OWNER_ACTION',
        response: `Prepared owner action 'pause()'. Calldata hash: ${calldataHash}. Review and sign using Ledger in the Owner panel.`,
        calldataHash,
        preparedAction: {
          functionName: 'pause',
          calldata,
          calldataHash,
          notice: 'Requires Ledger owner signature in Owner panel. Halts agent trades until unpaused.',
        },
      };
    }

    // 5. Market Basis / DEX vs CEX spread (English + Hinglish)
    if (
      /\b(basis|spread|difference|price gap|gap|bhaav|farq)\b/i.test(q) ||
      (/\b(cex|dex)\b/i.test(q) && !/\b(balance|position|pnl|p&l)\b/i.test(q))
    ) {
      const dex = context.evidence?.dexMid;
      const cexEntry = context.evidence?.cex?.[0];
      const cexMid = cexEntry ? (cexEntry.bid + cexEntry.ask) / 2 : undefined;

      if (dex !== undefined && cexMid !== undefined && cexMid > 0) {
        const basisBps = Math.round(((dex - cexMid) / cexMid) * 10000);
        const sign = basisBps > 0 ? '+' : '';
        return {
          intent: 'MARKET_BASIS',
          response: `DEX mid: ${dex.toFixed(4)}, CEX mid: ${cexMid.toFixed(4)} | Basis: ${sign}${basisBps} bps`,
          data: {
            dexMid: dex,
            cexMid,
            basisBps,
          },
        };
      }
      return {
        intent: 'MARKET_BASIS',
        response:
          'Insufficient live market evidence to compute DEX-vs-CEX basis. Need both DEX mid and CEX book.',
      };
    }

    // 6. Decision Explanation / Why did you wait/trade/reject (English + Hinglish)
    if (
      /\b(why|decision|reason|rule|trace|kyun|kyu|wait kiya|reject kiya|last trade)\b/i.test(
        q,
      )
    ) {
      const decision = context.state?.lastDecision;
      if (!decision) {
        return {
          intent: 'DECISION_EXPLANATION',
          response:
            'No recent decision available to explain. Once the keeper runs a cycle, rule traces can be inspected here.',
        };
      }
      const traces = decision.ruleTrace
        .map((t) => `${t.rule}: ${t.pass ? 'PASS' : 'FAIL'} (${t.detail})`)
        .join('; ');
      return {
        intent: 'DECISION_EXPLANATION',
        response: `Verdict: ${decision.kind}. Reason: ${traces || 'Evaluated within policy constraints.'}`,
        data: {
          decision,
        },
      };
    }

    // 7. Position / Inventory / P&L (English + Hinglish)
    if (
      /\b(position|balance|balances|holdings|inventory|kitna hai|kitna balance|profit|loss)\b/i.test(
        q,
      ) ||
      /\bp&l\b/i.test(q) ||
      /\bpnl\b/i.test(q)
    ) {
      const decA = context.decimalsA ?? context.evidence?.decimalsA ?? 18;
      const decB = context.decimalsB ?? context.evidence?.decimalsB ?? 6;
      const balA = context.state?.balanceA ?? context.evidence?.vault?.balanceA;
      const balB = context.state?.balanceB ?? context.evidence?.vault?.balanceB;

      if (balA === undefined || balB === undefined) {
        return {
          intent: 'POSITION_PNL',
          response: 'Current Position: Vault balance unavailable. Connect RPC or ensure network deployment is accessible.',
        };
      }

      const numA = Number(balA) / 10 ** decA;
      const numB = Number(balB) / 10 ** decB;

      const cexMid =
        context.evidence?.cex && context.evidence.cex.length > 0
          ? (context.evidence.cex[0].bid + context.evidence.cex[0].ask) / 2
          : undefined;

      let pnlMsg = '';
      if (
        context.state?.initialBalanceA !== undefined &&
        context.state?.initialBalanceB !== undefined &&
        cexMid !== undefined
      ) {
        const initA = Number(context.state.initialBalanceA) / 10 ** decA;
        const initB = Number(context.state.initialBalanceB) / 10 ** decB;
        const currentTotalUSD = numA * cexMid + numB;
        const holdUSD = initA * cexMid + initB;
        const diffUSD = currentTotalUSD - holdUSD;
        pnlMsg = ` | Excess vs Hold: ${diffUSD >= 0 ? '+' : ''}${diffUSD.toFixed(4)} USD`;
      }

      const markInfo = cexMid !== undefined ? ` (CEX mark: $${cexMid.toFixed(4)})` : '';
      return {
        intent: 'POSITION_PNL',
        response: `Current Position: ${numA.toFixed(4)} WHSK, ${numB.toFixed(2)} USDT${markInfo}${pnlMsg}`,
        data: {
          balanceA: balA.toString(),
          balanceB: balB.toString(),
          numA,
          numB,
          cexMid,
        },
      };
    }

    // 8. Parameter diff / adjustment (English + Hinglish)
    let normalizedParamQuery = query;
    if (/zyada conservative/i.test(query) || /risk kam/i.test(query)) {
      normalizedParamQuery = 'be more conservative';
    }

    if (context.policy && context.mandate) {
      const decB = context.decimalsB ?? context.evidence?.decimalsB ?? 6;
      const diffResult = nlToParamDiff(
        normalizedParamQuery,
        context.policy,
        context.mandate,
        decB,
      );
      if (Object.keys(diffResult.diff).length > 0) {
        const diffStr = JSON.stringify(diffResult.diff);
        const m = context.mandate;
        const newMaxTradeInA = diffResult.diff.maxTradeInA !== undefined ? BigInt(diffResult.diff.maxTradeInA as string) : m.maxTradeInA;
        const newMaxTradeInB = diffResult.diff.maxTradeInB !== undefined ? BigInt(diffResult.diff.maxTradeInB as string) : m.maxTradeInB;
        const newPolicyHash = (diffResult.diff.policyHash as Hex | undefined) ?? (m.policyHash as Hex);

        const proposedMandate = {
          agent: '0x0000000000000000000000000000000000000000' as Hex,
          expiry: BigInt(m.expiry),
          maxTradeInA: newMaxTradeInA,
          maxTradeInB: newMaxTradeInB,
          maxDailyInB: m.maxDailyInB,
          maxExposureBps: m.maxExposureBps,
          maxSlippageBps: m.maxSlippageBps,
          minIntervalSec: BigInt(m.minIntervalSec),
          policyHash: newPolicyHash,
        };

        const calldata = encodeFunctionData({
          abi: vaultAbi,
          functionName: 'setMandate',
          args: [proposedMandate],
        });
        const calldataHash = keccak256(calldata);

        return {
          intent: 'PARAM_UPDATE',
          response: `Proposed parameter update: ${diffStr}. Calldata hash: ${calldataHash}. Validated against signed mandate limits.`,
          diff: diffResult.diff,
          calldataHash,
          preparedAction: {
            functionName: 'setMandate',
            calldata,
            calldataHash,
            notice: 'Requires Ledger owner signature in Owner panel to update signed mandate parameters.',
          },
        };
      }
      if (diffResult.refused) {
        return {
          intent: 'REFUSAL',
          response: `Parameter update refused: ${diffResult.refused}`,
          refusedReason: diffResult.refused,
        };
      }
    }

    // 9. General fallback / refusal
    return {
      intent: 'REFUSAL',
      response:
        'Unrecognised query. Desk supports: checking positions/P&L, explaining verdicts, viewing DEX/CEX basis, preparing pause/revoke actions, and proposing conservative parameter updates within mandate limits.',
      refusedReason: 'Unrecognised request',
    };
  }
}
