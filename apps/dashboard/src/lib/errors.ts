const reverts: Record<string, string> = {
  Unauthorized:
    'This action requires the current vault owner or authorized agent.',
  InvalidMandate: 'The mandate is invalid. Check the agent, expiry and limits.',
  Inactive:
    'The mandate is paused, revoked or expired. Ask the owner to review it.',
  InvalidConfig:
    'The vault configuration is invalid. Check the verified deployment.',
  Deadline: 'This transaction deadline has passed. Build a fresh review.',
  DecisionExpired: 'The agent decision expired. Request a fresh decision.',
  Nonce: 'Vault activity changed. Refresh and build a new review.',
  Interval: 'The minimum trade interval has not elapsed. Please wait.',
  TradeCap: 'The trade exceeds the per-trade mandate cap.',
  DailyCap:
    'The daily mandate cap has been reached. Wait for the next UTC day.',
  Exposure: 'The trade would exceed the mandate exposure cap.',
  Underfill: 'The swap could not meet the reviewed minimum output.',
  InvalidToken: 'This token is outside the vault pair. Choose a vault token.',
  OracleInvalid:
    'Oracle evidence is unavailable or outside the permitted limits.',
  Drawdown:
    'The drawdown circuit breaker is active. The owner must review the mandate.',
  PreviousHead: 'The receipt chain changed. Refresh before retrying.',
  InvalidKind: 'This decision type is not valid for the requested action.',
  Paused: 'The vault is paused. Unpause it before trading.',
  Slippage: 'The quote exceeds the slippage limit. Request a fresh quote.',
  CapExceeded: 'The action exceeds a mandate cap.',
  Cooldown: 'The minimum trade interval has not elapsed. Please wait.',
  InsufficientBalance: 'The vault has insufficient funds for this amount.',
};
export function humanError(error: unknown): string {
  console.debug('Owner action error', error);
  const seen = new Set<unknown>();
  let current = error;
  const messages: string[] = [];
  let short: string | undefined;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const value = current as {
      data?: { errorName?: string };
      shortMessage?: string;
      message?: string;
      statusCode?: number;
      statusWord?: number;
      name?: string;
      cause?: unknown;
      originalError?: unknown;
      error?: unknown;
    };
    if (value.data?.errorName)
      return (
        reverts[value.data.errorName] ??
        `The vault rejected this action (${value.data.errorName}). Review the current mandate.`
      );
    short ??= value.shortMessage;
    messages.push(value.message ?? '', value.name ?? '');
    const status = value.statusCode ?? value.statusWord;
    if (status !== undefined) messages.push(status.toString(16));
    current = value.cause ?? value.originalError ?? value.error;
  }
  const detail = messages.join(' ');
  if (/6985|user.*reject|reject.*user/i.test(detail))
    return 'Transaction rejected on Ledger. Nothing was sent.';
  if (/5515|device.*locked/i.test(detail))
    return 'Unlock your Ledger, then retry.';
  if (/6e00|6d00/i.test(detail))
    return 'Open the Ethereum app on your Ledger, then retry.';
  if (/6a80/i.test(detail))
    return 'Enable Blind signing in the Ethereum app settings, then retry';
  if (/NotAllowedError|permission denied|access denied/i.test(detail))
    return 'Ledger permission was denied. Allow WebHID access and retry.';
  if (/WebHID|hid.*unavailable|unsupported.*browser/i.test(detail))
    return 'WebHID is unavailable. Use Chrome/Edge over HTTPS or localhost.';
  return (
    short ??
    (error instanceof Error
      ? error.message
      : 'The action failed. Check your Ledger and connection, then retry.')
  )
    .split('\n')[0]
    .slice(0, 180);
}
