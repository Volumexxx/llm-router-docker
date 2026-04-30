import { describe, expect, it } from "vitest";

import {
  MAX_TIMEOUT_MS,
  dashboardQuerySchema,
  providerCreateSchema,
  providerUpdateSchema
} from "../../../packages/shared/src/index.ts";
import { resolveConfig } from "../src/config.ts";

const TEST_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";

describe("timeout configuration limits", () => {
  it("accepts one-hour runtime timeout settings", () => {
    const config = resolveConfig({
      CONFIG_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
      REQUEST_TIMEOUT_MS: MAX_TIMEOUT_MS,
      UPSTREAM_TIMEOUT_MS: MAX_TIMEOUT_MS,
      PROVIDER_TEST_DEFAULT_TIMEOUT_MS: MAX_TIMEOUT_MS
    });

    expect(config.requestTimeoutMs).toBe(MAX_TIMEOUT_MS);
    expect(config.upstreamTimeoutMs).toBe(MAX_TIMEOUT_MS);
    expect(config.providerTestDefaultTimeoutMs).toBe(MAX_TIMEOUT_MS);
  });

  it("rejects runtime timeout settings above one hour", () => {
    expect(() =>
      resolveConfig({
        CONFIG_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
        REQUEST_TIMEOUT_MS: MAX_TIMEOUT_MS + 1
      })
    ).toThrow();

    expect(() =>
      resolveConfig({
        CONFIG_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
        UPSTREAM_TIMEOUT_MS: MAX_TIMEOUT_MS + 1
      })
    ).toThrow();

    expect(() =>
      resolveConfig({
        CONFIG_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
        PROVIDER_TEST_DEFAULT_TIMEOUT_MS: MAX_TIMEOUT_MS + 1
      })
    ).toThrow();
  });

  it("accepts provider timeout settings up to one hour", () => {
    const created = providerCreateSchema.parse({
      name: "provider",
      enabled: true,
      openai: {
        baseUrl: "https://api.openai.com/v1",
        apiKey: "provider-secret",
        testTimeoutMs: MAX_TIMEOUT_MS
      }
    });

    const updated = providerUpdateSchema.parse({
      openai: {
        testTimeoutMs: MAX_TIMEOUT_MS
      }
    });

    expect(created.openai?.testTimeoutMs).toBe(MAX_TIMEOUT_MS);
    expect(updated.openai?.testTimeoutMs).toBe(MAX_TIMEOUT_MS);
  });

  it("rejects provider timeout settings above one hour", () => {
    expect(() =>
      providerCreateSchema.parse({
        name: "provider",
        enabled: true,
        openai: {
          baseUrl: "https://api.openai.com/v1",
          apiKey: "provider-secret",
          testTimeoutMs: MAX_TIMEOUT_MS + 1
        }
      })
    ).toThrow();

    expect(() =>
      providerUpdateSchema.parse({
        openai: {
          testTimeoutMs: MAX_TIMEOUT_MS + 1
        }
      })
    ).toThrow();
  });

  it("accepts dashboard filter query combinations", () => {
    const parsed = dashboardQuerySchema.parse({
      range: "day",
      date: "2026-04-15",
      providerId: "11111111-1111-4111-8111-111111111111",
      modelAlias: "gpt-4o-mini",
      apiKeyId: "22222222-2222-4222-8222-222222222222"
    });

    expect(parsed).toEqual({
      range: "day",
      date: "2026-04-15",
      providerId: "11111111-1111-4111-8111-111111111111",
      modelAlias: "gpt-4o-mini",
      apiKeyId: "22222222-2222-4222-8222-222222222222"
    });
  });
});
