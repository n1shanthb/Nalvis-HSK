import type { VercelRequest, VercelResponse } from '@vercel/node';
import { queryGroqDesk, DeskParser } from '@nalvis/core';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { query, evidence, mandate, policy, state, decimalsA, decimalsB } = req.body || {};

  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'Missing query parameter' });
  }

  const parser = new DeskParser();
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    // Deterministic fallback if server has no Groq key configured
    const deterministic = parser.parse(query, {
      evidence,
      mandate,
      policy,
      state,
      decimalsA,
      decimalsB,
    });
    return res.status(200).json({
      llmUsed: false,
      model: 'deterministic-fallback',
      result: deterministic,
    });
  }

  try {
    const groqRes = await queryGroqDesk(
      query,
      { evidence, mandate, policy, state, decimalsA, decimalsB },
      { apiKey, timeoutMs: 5000 },
    );

    // Single source of truth: validate proposed intent/query deterministically
    const validated = parser.parse(groqRes.normalizedQuery || query, {
      evidence,
      mandate,
      policy,
      state,
      decimalsA,
      decimalsB,
    });

    return res.status(200).json({
      llmUsed: true,
      model: groqRes.model,
      promptHash: groqRes.promptHash,
      result: {
        ...validated,
        response: groqRes.explanation || validated.response,
      },
    });
  } catch (err) {
    // Graceful fallback to deterministic rule engine
    const fallback = parser.parse(query, {
      evidence,
      mandate,
      policy,
      state,
      decimalsA,
      decimalsB,
    });
    return res.status(200).json({
      llmUsed: false,
      model: 'deterministic-fallback',
      fallbackReason: err instanceof Error ? err.message : String(err),
      result: fallback,
    });
  }
}
