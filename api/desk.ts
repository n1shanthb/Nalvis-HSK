import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  queryGroqDesk,
  DeskParser,
  buildGroundedContext,
  verifyGroundedExplanation,
} from '@nalvis/core';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { query, evidence, mandate, policy, state, decimalsA, decimalsB } = req.body || {};

  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'Missing query parameter' });
  }

  const parser = new DeskParser();
  const deskContext = {
    evidence,
    mandate,
    policy,
    state,
    decimalsA,
    decimalsB,
  };
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    // Deterministic fallback if server has no Groq key configured
    const deterministic = parser.parse(query, deskContext);
    return res.status(200).json({
      llmUsed: false,
      model: 'deterministic-fallback',
      result: deterministic,
    });
  }

  try {
    const groqRes = await queryGroqDesk(
      query,
      deskContext,
      { apiKey, timeoutMs: 5000 },
    );

    // Single source of truth: deterministic parser on user query
    const baseline = parser.parse(query, deskContext);

    // Validate proposed normalized query
    const validated = parser.parse(groqRes.normalizedQuery || query, deskContext);

    // Safeguard 1: Do not let LLM change user intent
    const intentMatches = baseline.intent === validated.intent;
    const finalIntent = intentMatches ? validated.intent : baseline.intent;

    // Safeguard 2: Verify grounding - every number in explanation must come from context
    const contextStr = buildGroundedContext(query, deskContext);
    const isGrounded =
      intentMatches &&
      groqRes.explanation &&
      verifyGroundedExplanation(groqRes.explanation, contextStr);

    return res.status(200).json({
      llmUsed: true,
      model: groqRes.model,
      promptHash: groqRes.promptHash,
      result: {
        ...(intentMatches ? validated : baseline),
        intent: finalIntent,
        response: isGrounded ? groqRes.explanation : baseline.response,
      },
    });
  } catch (err) {
    // Graceful fallback to deterministic rule engine
    const fallback = parser.parse(query, deskContext);
    return res.status(200).json({
      llmUsed: false,
      model: 'deterministic-fallback',
      fallbackReason: err instanceof Error ? err.message : String(err),
      result: fallback,
    });
  }
}
