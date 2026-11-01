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
const ledgerStatuses = new Map<number, string>([
  [0x6985, 'Transaction rejected on Ledger. Nothing was sent.'],
  [0x5515, 'Unlock your Ledger, then retry.'],
  [0x6e00, 'Open the Ethereum app on your Ledger, then retry.'],
  [0x6d00, 'Open the Ethereum app on your Ledger, then retry.'],
  [0x6a80, 'Enable Blind signing in the Ethereum app settings, then retry'],
]);
const ledgerNames = new Map<string, number>([
  ['UserRefusedOnDevice', 0x6985],
  ['RefusedByUserDAError', 0x6985],
  ['LockedDeviceError', 0x5515],
  ['DeviceLockedError', 0x5515],
]);
export function humanError(error: unknown): string {
  console.debug('Owner action error', error);
  const seen = new Set<unknown>();
  let current = error;
  const messages: string[] = [];
  let short: string | undefined;
  let ledgerMessage: string | undefined;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const value = current as {
      data?: { errorName?: string };
      shortMessage?: string;
      message?: string;
      statusCode?: unknown;
      statusWord?: unknown;
      _tag?: string;
      constructor?: { name?: string };
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
    // Never infer an APDU status from diagnostic text: it can contain a
    // broadcast transaction hash, calldata or an address with those digits.
    for (const status of [value.statusCode, value.statusWord]) {
      if (typeof status === 'number')
        ledgerMessage ??= ledgerStatuses.get(status);
    }
    for (const name of [value.name, value._tag, value.constructor?.name]) {
      const status = name === undefined ? undefined : ledgerNames.get(name);
      if (status !== undefined) ledgerMessage ??= ledgerStatuses.get(status);
    }
    current = value.cause ?? value.originalError ?? value.error;
  }
  const detail = messages.join(' ');
  if (ledgerMessage) return ledgerMessage;
  if (/\b(?:user rejected|denied by the user)\b/i.test(detail))
    return ledgerStatuses.get(0x6985)!;
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
