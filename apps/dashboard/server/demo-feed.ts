/** Owner-approved demo HTTP endpoint. Use AGENT_FEED_UPSTREAM to override.
 * Vercel-to-VM traffic is unencrypted; never send wallet keys through this relay.
 * The dedicated proxy token belongs only in the server environment.
 */
export const demoFeedUpstream = 'http://129.159.17.90:8788';
