/**
 * Pre-flight token estimator.
 * Uses a fast character-based approximation (4 chars ≈ 1 token) by default.
 * Falls back to character counting if tiktoken is unavailable.
 */

import type { ChatMessage } from "../types/openai.js";

// Approximate tokens per message overhead (role, separators, etc.)
const TOKENS_PER_MESSAGE = 4;
const TOKENS_PER_ROLE = 1;

/** Fast approximation: ~4 chars per token (works for English text). */
function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function extractText(content: ChatMessage["content"]): string {
  if (typeof content === "string") return content;
  if (content === null) return "";
  return content
    .filter((p) => p.type === "text")
    .map((p) => (p as { type: "text"; text: string }).text)
    .join(" ");
}

/**
 * Estimate token count for a chat completion request.
 * Returns a conservative (slightly high) estimate.
 */
export function estimateChatTokens(
  messages: ChatMessage[],
  maxTokens?: number
): number {
  let total = 3; // every reply is primed with <|start|>assistant<|message|>

  for (const msg of messages) {
    total += TOKENS_PER_MESSAGE;
    total += TOKENS_PER_ROLE; // role token
    total += approxTokens(extractText(msg.content));
    if (msg.name) total += 1;
  }

  // Add expected output tokens (use max_tokens or a default of 1024)
  total += maxTokens ?? 1024;

  return total;
}

/**
 * Estimate tokens for a plain text prompt (legacy completions).
 */
export function estimateCompletionTokens(
  prompt: string | string[],
  maxTokens?: number
): number {
  const text = Array.isArray(prompt) ? prompt.join(" ") : prompt;
  return approxTokens(text) + (maxTokens ?? 1024);
}
