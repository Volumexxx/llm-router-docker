import { describe, expect, it } from "vitest";

import { extractUsage } from "../src/lib/utils.ts";

describe("extractUsage", () => {
  it("reads cached tokens from prompt_tokens_details", () => {
    const usage = extractUsage({
      usage: {
        prompt_tokens: 20,
        prompt_tokens_details: {
          cached_tokens: 6
        },
        completion_tokens: 5,
        total_tokens: 25
      }
    });

    expect(usage.inputTokens).toBe(20);
    expect(usage.cachedInputTokens).toBe(6);
    expect(usage.outputTokens).toBe(5);
    expect(usage.totalTokens).toBe(25);
  });

  it("reads cached tokens from input_tokens_details and falls back total tokens", () => {
    const usage = extractUsage({
      usage: {
        input_tokens: 12,
        input_tokens_details: {
          cached_tokens: 4
        },
        output_tokens: 7
      }
    });

    expect(usage.inputTokens).toBe(12);
    expect(usage.cachedInputTokens).toBe(4);
    expect(usage.outputTokens).toBe(7);
    expect(usage.totalTokens).toBe(19);
  });

  it("reads usage nested inside a responses payload", () => {
    const usage = extractUsage({
      type: "response.completed",
      response: {
        id: "resp_123",
        usage: {
          input_tokens: 18,
          input_tokens_details: {
            cached_tokens: 5
          },
          output_tokens: 9,
          total_tokens: 27
        }
      }
    });

    expect(usage.inputTokens).toBe(18);
    expect(usage.cachedInputTokens).toBe(5);
    expect(usage.outputTokens).toBe(9);
    expect(usage.totalTokens).toBe(27);
  });

  it("returns null usage fields when payload has no usage object", () => {
    const usage = extractUsage({
      object: "chat.completion"
    });

    expect(usage.inputTokens).toBeNull();
    expect(usage.cachedInputTokens).toBeNull();
    expect(usage.outputTokens).toBeNull();
    expect(usage.totalTokens).toBeNull();
  });
});
