import { createAgentFeedHandler } from '../apps/dashboard/server/agent-feed.js';
import { demoFeedUpstream } from '../apps/dashboard/server/demo-feed.js';
export default {
  fetch: createAgentFeedHandler(
    process.env.AGENT_FEED_UPSTREAM ?? demoFeedUpstream,
    fetch,
    process.env.AGENT_FEED_PROXY_TOKEN,
  ),
};
