/**
 * Anthropic client adapter.
 *
 * Deliberately dependency-free (plain fetch) so the engine package stays
 * installable anywhere and testable without network. Swap this file to change
 * provider — nothing else in the engine knows an LLM exists.
 *
 * The engine NEVER requires this to work. If the key is missing, the call
 * fails, or the response fails validation, narrative.ts falls back to
 * deterministic text. An LLM outage must never take the product down.
 */

import type { LLMClient } from './narrative.ts';

export type AnthropicOptions = {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  timeoutMs?: number;
};

export function createAnthropicClient(opts: AnthropicOptions): LLMClient {
  const {
    apiKey,
    model = 'claude-sonnet-4-5',
    maxTokens = 1200,
    timeoutMs = 20_000,
  } = opts;

  return async (system: string, user: string): Promise<string> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          system,
          // Low temperature: this is an explanation task, not a creative one.
          temperature: 0.2,
          messages: [{ role: 'user', content: user }],
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`Anthropic API returned ${res.status}: ${await res.text()}`);
      }

      const json = (await res.json()) as { content: { type: string; text?: string }[] };
      const text = json.content
        .filter((c) => c.type === 'text')
        .map((c) => c.text ?? '')
        .join('\n')
        .trim();

      if (!text) throw new Error('Anthropic API returned no text content');
      return text;
    } finally {
      clearTimeout(timer);
    }
  };
}

/** Convenience: returns undefined when no key is configured, so callers can
 *  pass it straight through to generateNarrative() and get the fallback. */
export function clientFromEnv(): LLMClient | undefined {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return undefined;
  return createAnthropicClient({ apiKey, model: process.env.FINMANAI_LLM_MODEL });
}
