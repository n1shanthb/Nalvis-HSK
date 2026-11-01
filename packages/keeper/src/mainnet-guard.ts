/** Explicit human activation. Credentials are never inspected or logged here. */
export function assertMainnetActivation(
  env: Record<string, string | undefined>,
) {
  if (env.CI === 'true' || env.NODE_ENV === 'test')
    throw Error('Mainnet forbidden in test/CI');
  if (env.MAINNET_EXECUTION_ACK !== 'I_ACCEPT_REAL_FUNDS_RISK_ON_177')
    throw Error('Mainnet execution not acknowledged');
  if (!/^0x[0-9a-fA-F]{40}$/.test(env.VAULT_ADDRESS ?? ''))
    throw Error('Explicit mainnet vault required');
  if (!/^[0-9a-f]{40}$/.test(env.MAINNET_DEPLOY_COMMIT ?? ''))
    throw Error('Reviewed deployment commit required');
}
