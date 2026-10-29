#!/usr/bin/env node
import { DeskParser } from './parser.js';
import { queryGroqDesk } from './llm.js';

async function main() {
  const query = process.argv.slice(2).join(' ').trim();
  if (!query) {
    console.error('Usage: nalvis desk "<query>"');
    process.exit(1);
  }

  const parser = new DeskParser();
  let modelName = 'none (deterministic fallback)';
  let promptHash: string | undefined;
  let responseText: string | undefined;
  let intent: string | undefined;

  const groqApiKey = process.env.GROQ_API_KEY;

  if (groqApiKey) {
    try {
      const groqRes = await queryGroqDesk(
        query,
        {},
        { apiKey: groqApiKey, timeoutMs: 5000 },
      );
      modelName = groqRes.model;
      promptHash = groqRes.promptHash;

      // Deterministic validation: pass normalized query through DeskParser
      const validated = parser.parse(groqRes.normalizedQuery || query);
      intent = validated.intent;
      responseText = groqRes.explanation || validated.response;

      console.log(`[MODE] LLM (Groq: ${modelName})`);
      console.log(`[PROMPT HASH] ${promptHash}`);
      console.log(`[${intent}] ${responseText}`);

      if (validated.diff) {
        console.log('Diff:', JSON.stringify(validated.diff, null, 2));
      }
      if (validated.calldataHash) {
        console.log('Calldata Hash:', validated.calldataHash);
      }
      if (validated.preparedAction) {
        console.log('Prepared Action:', JSON.stringify(validated.preparedAction, null, 2));
      }
      return;
    } catch {
      // Groq failed or timed out; fall back to deterministic mode
    }
  }

  // Deterministic mode fallback
  const result = parser.parse(query);
  console.log(`[MODE] RULE-BASED (Deterministic Fallback)`);
  console.log(`[${result.intent}] ${result.response}`);
  if (result.diff) {
    console.log('Diff:', JSON.stringify(result.diff, null, 2));
  }
  if (result.calldataHash) {
    console.log('Calldata Hash:', result.calldataHash);
  }
  if (result.preparedAction) {
    console.log('Prepared Action:', JSON.stringify(result.preparedAction, null, 2));
  }
}

main().catch((err) => {
  console.error('Desk CLI error:', err);
  process.exit(1);
});
