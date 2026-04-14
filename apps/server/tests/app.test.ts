import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../src/app.ts";

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "llm-router-"));
}

const cleanupDirs: string[] = [];

afterEach(() => {
  while (cleanupDirs.length > 0) {
    const dir = cleanupDirs.pop();
    if (!dir) {
      continue;
    }

    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows can keep SQLite handles around briefly during failed tests.
    }
  }
});

async function createTestApp(fetchImpl?: typeof fetch, dataDir?: string) {
  const dir = dataDir ?? createTempDir();
  cleanupDirs.push(dir);

  return buildApp({
    fetchImpl,
    configOverrides: {
      NODE_ENV: "test",
      DATA_DIR: dir,
      CONFIG_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef",
      BOOTSTRAP_ADMIN_USERNAME: "admin",
      BOOTSTRAP_ADMIN_PASSWORD: "admin-password"
    }
  });
}

async function login(app: Awaited<ReturnType<typeof buildApp>>) {
  const response = await app.inject({
    method: "POST",
    url: "/admin/api/auth/login",
    payload: {
      username: "admin",
      password: "admin-password"
    }
  });

  expect(response.statusCode).toBe(200);
  const cookie = response.headers["set-cookie"];
  expect(cookie).toBeTruthy();
  return cookie as string | string[];
}

async function createGatewayApiKey(
  app: Awaited<ReturnType<typeof buildApp>>,
  cookie: string | string[],
  payload: {
    name: string;
    allowedProviderIds?: string[];
    allowedModelAliasIds?: string[];
  }
) {
  const response = await app.inject({
    method: "POST",
    url: "/admin/api/security/api-keys",
    headers: {
      cookie
    },
    payload
  });

  expect(response.statusCode).toBe(201);
  const body = response.json() as {
    item: {
      id: string;
      name: string;
      maskedPreview: string;
      allowedProviderIds: string[];
      allowedModelAliasIds: string[];
    };
    createdKeyPlaintext: string;
  };

  return {
    id: body.item.id,
    name: body.item.name,
    maskedPreview: body.item.maskedPreview,
    allowedProviderIds: body.item.allowedProviderIds,
    allowedModelAliasIds: body.item.allowedModelAliasIds,
    plaintext: body.createdKeyPlaintext
  };
}

async function createProvider(
  app: Awaited<ReturnType<typeof buildApp>>,
  cookie: string | string[],
  input: {
    name: string;
    baseUrl: string;
    apiKey?: string;
    enabled?: boolean;
    testTimeoutMs?: number;
  }
) {
  const response = await app.inject({
    method: "POST",
    url: "/admin/api/providers",
    headers: {
      cookie
    },
    payload: {
      apiKey: input.apiKey ?? "provider-secret",
      enabled: input.enabled ?? true,
      testTimeoutMs: input.testTimeoutMs ?? 10000,
      ...input
    }
  });

  expect(response.statusCode).toBe(201);
  return response.json().item as {
    id: string;
    name: string;
    baseUrl: string;
  };
}

async function createModel(
  app: Awaited<ReturnType<typeof buildApp>>,
  cookie: string | string[],
  input: {
    alias: string;
    displayName: string;
    enabled?: boolean;
  }
) {
  const response = await app.inject({
    method: "POST",
    url: "/admin/api/models",
    headers: {
      cookie
    },
    payload: {
      enabled: input.enabled ?? true,
      ...input
    }
  });

  expect(response.statusCode).toBe(201);
  return response.json().item as {
    id: string;
    alias: string;
    displayName: string;
  };
}

async function addBinding(
  app: Awaited<ReturnType<typeof buildApp>>,
  cookie: string | string[],
  modelId: string,
  input: {
    providerId: string;
    upstreamModel: string;
    inputPrice?: number;
    outputPrice?: number;
    enabled?: boolean;
  }
) {
  const response = await app.inject({
    method: "POST",
    url: `/admin/api/models/${modelId}/bindings`,
    headers: {
      cookie
    },
    payload: {
      inputPrice: input.inputPrice ?? 1,
      outputPrice: input.outputPrice ?? 1,
      enabled: input.enabled ?? true,
      ...input
    }
  });

  expect(response.statusCode).toBe(201);
  return response.json().item as {
    id: string;
    alias: string;
    bindings: Array<{ id: string; providerName: string }>;
  };
}

async function createProviderAndModel(
  app: Awaited<ReturnType<typeof buildApp>>,
  cookie: string | string[]
) {
  const provider = await createProvider(app, cookie, {
    name: "openai-primary",
    baseUrl: "https://provider.example/v1"
  });

  const model = await createModel(app, cookie, {
    alias: "gpt-4o-mini",
    displayName: "GPT 4o Mini"
  });

  await addBinding(app, cookie, model.id, {
    providerId: provider.id,
    upstreamModel: "gpt-4o",
    inputPrice: 1,
    outputPrice: 2
  });

  return {
    providerId: provider.id,
    modelId: model.id
  };
}

describe("llm router server", () => {
  it("bootstraps and exposes health endpoints without bootstrap gateway key", async () => {
    const app = await createTestApp();

    try {
      const live = await app.inject({
        method: "GET",
        url: "/health/live"
      });
      const ready = await app.inject({
        method: "GET",
        url: "/health/ready"
      });

      expect(live.statusCode).toBe(200);
      expect(ready.statusCode).toBe(200);
      expect(ready.json().status).toBe("ready");
      expect(ready.json().checks.encryptionKeyLoaded).toBe(true);
      expect(ready.json().checks.gatewayKeyConfigured).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it("returns configuration error when no API key exists", async () => {
    const app = await createTestApp();

    try {
      const response = await app.inject({
        method: "GET",
        url: "/v1/models",
        headers: {
          authorization: "Bearer lrk_00000000-0000-0000-0000-000000000000_missing"
        }
      });

      expect(response.statusCode).toBe(503);
      expect(response.json().error.code).toBe("api_keys_not_configured");

      const cookie = await login(app);
      const systemStatus = await app.inject({
        method: "GET",
        url: "/admin/api/system/status",
        headers: {
          cookie
        }
      });

      expect(systemStatus.statusCode).toBe(200);
      expect(systemStatus.json().activeApiKeyCount).toBe(0);
      expect(systemStatus.json().totalApiKeyCount).toBe(0);
    } finally {
      await app.close();
    }
  });

  it("creates API keys, authenticates requests, and aggregates audit and dashboard by key", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.endsWith("/chat/completions")) {
        return new Response(
          JSON.stringify({
            id: "chatcmpl-test",
            object: "chat.completion",
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: "hello"
                },
                finish_reason: "stop"
              }
            ],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 5,
              total_tokens: 15
            }
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json"
            }
          }
        );
      }

      return new Response(
        JSON.stringify({
          data: [{ id: "gpt-4o" }]
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      );
    });

    const app = await createTestApp(fetchImpl);

    try {
      const cookie = await login(app);
      await createProviderAndModel(app, cookie);

      const webClientKey = await createGatewayApiKey(app, cookie, {
        name: "web-client"
      });
      const mobileClientKey = await createGatewayApiKey(app, cookie, {
        name: "mobile-client"
      });

      const modelsList = await app.inject({
        method: "GET",
        url: "/v1/models",
        headers: {
          authorization: `Bearer ${webClientKey.plaintext}`
        }
      });

      expect(modelsList.statusCode).toBe(200);
      expect(modelsList.json().data).toHaveLength(1);

      const completion = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        headers: {
          authorization: `Bearer ${mobileClientKey.plaintext}`
        },
        payload: {
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: "hi" }]
        }
      });

      expect(completion.statusCode).toBe(200);
      expect(completion.json().choices[0].message.content).toBe("hello");
      expect(fetchImpl).toHaveBeenCalled();

      const auditAll = await app.inject({
        method: "GET",
        url: "/admin/api/audit?page=1&pageSize=20",
        headers: {
          cookie
        }
      });

      expect(auditAll.statusCode).toBe(200);
      expect(
        auditAll.json().items.some(
          (item: {
            endpoint_type: string;
            api_key_id: string | null;
          }) => item.endpoint_type === "model_list" && item.api_key_id === webClientKey.id
        )
      ).toBe(true);

      const auditByKey = await app.inject({
        method: "GET",
        url: `/admin/api/audit?page=1&pageSize=20&apiKeyId=${mobileClientKey.id}`,
        headers: {
          cookie
        }
      });

      expect(auditByKey.statusCode).toBe(200);
      expect(
        auditByKey
          .json()
          .items.some(
            (item: {
              endpoint_type: string;
              api_key_id: string | null;
              api_key_name: string | null;
            }) =>
              item.endpoint_type === "chat_completions" &&
              item.api_key_id === mobileClientKey.id &&
              item.api_key_name === "mobile-client"
          )
      ).toBe(true);

      const dashboard = await app.inject({
        method: "GET",
        url: "/admin/api/dashboard?range=day",
        headers: {
          cookie
        }
      });

      expect(dashboard.statusCode).toBe(200);
      expect(
        dashboard
          .json()
          .apiKeyCards.some(
            (card: { label: string; requests: number }) =>
              card.label.includes("mobile-client") && card.requests >= 1
          )
      ).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("records token usage for responses endpoints", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.endsWith("/responses")) {
        return new Response(
          JSON.stringify({
            id: "resp_test",
            object: "response",
            output: [
              {
                type: "message",
                role: "assistant",
                content: [{ type: "output_text", text: "hello from responses" }]
              }
            ],
            response: {
              usage: {
                input_tokens: 14,
                input_tokens_details: {
                  cached_tokens: 3
                },
                output_tokens: 6,
                total_tokens: 20
              }
            }
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json"
            }
          }
        );
      }

      return new Response(
        JSON.stringify({
          data: [{ id: "gpt-4o" }]
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      );
    });

    const app = await createTestApp(fetchImpl);

    try {
      const cookie = await login(app);
      await createProviderAndModel(app, cookie);
      const apiKey = await createGatewayApiKey(app, cookie, {
        name: "responses-client"
      });

      const response = await app.inject({
        method: "POST",
        url: "/v1/responses",
        headers: {
          authorization: `Bearer ${apiKey.plaintext}`
        },
        payload: {
          model: "gpt-4o-mini",
          input: "Say hello"
        }
      });

      expect(response.statusCode).toBe(200);

      const auditResponse = await app.inject({
        method: "GET",
        url: `/admin/api/audit?page=1&pageSize=20&apiKeyId=${apiKey.id}&endpointType=responses`,
        headers: {
          cookie
        }
      });

      expect(auditResponse.statusCode).toBe(200);
      const responsesAudit = auditResponse
        .json()
        .items.find((item: { endpoint_type: string }) => item.endpoint_type === "responses");
      expect(responsesAudit).toBeTruthy();
      expect(responsesAudit.input_tokens).toBe(11);
      expect(responsesAudit.cached_input_tokens).toBe(3);
      expect(responsesAudit.output_tokens).toBe(6);
      expect(responsesAudit.total_tokens).toBe(20);

      const dashboard = await app.inject({
        method: "GET",
        url: "/admin/api/dashboard?range=day",
        headers: {
          cookie
        }
      });

      expect(dashboard.statusCode).toBe(200);
      expect(dashboard.json().overall.inputTokens).toBe(11);
      expect(dashboard.json().overall.cacheTokens).toBe(3);
      expect(dashboard.json().overall.outputTokens).toBe(6);
      expect(dashboard.json().overall.totalTokens).toBe(20);
    } finally {
      await app.close();
    }
  });

  it("invalidates disabled and deleted API keys while keeping other active keys available", async () => {
    const app = await createTestApp();

    try {
      const cookie = await login(app);
      const stableKey = await createGatewayApiKey(app, cookie, {
        name: "stable-client"
      });
      const disabledKey = await createGatewayApiKey(app, cookie, {
        name: "disabled-client"
      });
      const deletedKey = await createGatewayApiKey(app, cookie, {
        name: "deleted-client"
      });

      const disableResponse = await app.inject({
        method: "PATCH",
        url: `/admin/api/security/api-keys/${disabledKey.id}`,
        headers: {
          cookie
        },
        payload: {
          enabled: false
        }
      });

      expect(disableResponse.statusCode).toBe(200);

      const invalidAfterDisable = await app.inject({
        method: "GET",
        url: "/v1/models",
        headers: {
          authorization: `Bearer ${disabledKey.plaintext}`
        }
      });

      expect(invalidAfterDisable.statusCode).toBe(401);
      expect(invalidAfterDisable.json().error.code).toBe("gateway_auth_invalid");

      const deleteResponse = await app.inject({
        method: "DELETE",
        url: `/admin/api/security/api-keys/${deletedKey.id}`,
        headers: {
          cookie
        }
      });

      expect(deleteResponse.statusCode).toBe(200);

      const invalidAfterDelete = await app.inject({
        method: "GET",
        url: "/v1/models",
        headers: {
          authorization: `Bearer ${deletedKey.plaintext}`
        }
      });

      expect(invalidAfterDelete.statusCode).toBe(401);
      expect(invalidAfterDelete.json().error.code).toBe("gateway_auth_invalid");

      const stillValid = await app.inject({
        method: "GET",
        url: "/v1/models",
        headers: {
          authorization: `Bearer ${stableKey.plaintext}`
        }
      });

      expect(stillValid.statusCode).toBe(200);

      const activeList = await app.inject({
        method: "GET",
        url: "/admin/api/security/api-keys",
        headers: {
          cookie
        }
      });

      expect(activeList.statusCode).toBe(200);
      expect(
        activeList.json().items.some((item: { id: string }) => item.id === deletedKey.id)
      ).toBe(false);

      const fullList = await app.inject({
        method: "GET",
        url: "/admin/api/security/api-keys?includeDeleted=true",
        headers: {
          cookie
        }
      });

      expect(fullList.statusCode).toBe(200);
      expect(
        fullList.json().items.some(
          (item: { id: string; deletedAt: string | null }) =>
            item.id === deletedKey.id && item.deletedAt !== null
        )
      ).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("falls back to the next allowed provider inside api key scope and records cache tokens", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes("provider-a.example") && url.endsWith("/chat/completions")) {
        return new Response(
          JSON.stringify({
            choices: [{ message: { role: "assistant", content: "from-a" } }],
            usage: {
              prompt_tokens: 12,
              completion_tokens: 8,
              total_tokens: 20
            }
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json"
            }
          }
        );
      }

      if (url.includes("provider-b.example") && url.endsWith("/chat/completions")) {
        return new Response(
          JSON.stringify({
            choices: [{ message: { role: "assistant", content: "from-b" } }],
            usage: {
              prompt_tokens: 12,
              prompt_tokens_details: {
                cached_tokens: 4
              },
              completion_tokens: 8,
              total_tokens: 20
            }
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json"
            }
          }
        );
      }

      return new Response(
        JSON.stringify({
          data: [{ id: "router-test-upstream" }]
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      );
    });

    const app = await createTestApp(fetchImpl);

    try {
      const cookie = await login(app);
      const providerA = await createProvider(app, cookie, {
        name: "provider-a",
        baseUrl: "https://provider-a.example/v1"
      });
      const providerB = await createProvider(app, cookie, {
        name: "provider-b",
        baseUrl: "https://provider-b.example/v1"
      });
      const model = await createModel(app, cookie, {
        alias: "router-test",
        displayName: "Router Test"
      });

      await addBinding(app, cookie, model.id, {
        providerId: providerA.id,
        upstreamModel: "model-a"
      });
      await addBinding(app, cookie, model.id, {
        providerId: providerB.id,
        upstreamModel: "model-b"
      });

      const scopedKey = await createGatewayApiKey(app, cookie, {
        name: "provider-b-only",
        allowedProviderIds: [providerB.id],
        allowedModelAliasIds: [model.id]
      });

      const modelsResponse = await app.inject({
        method: "GET",
        url: "/v1/models",
        headers: {
          authorization: `Bearer ${scopedKey.plaintext}`
        }
      });

      expect(modelsResponse.statusCode).toBe(200);
      expect(modelsResponse.json().data.map((item: { id: string }) => item.id)).toContain("router-test");

      const completion = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        headers: {
          authorization: `Bearer ${scopedKey.plaintext}`
        },
        payload: {
          model: "router-test",
          messages: [{ role: "user", content: "hi" }]
        }
      });

      expect(completion.statusCode).toBe(200);
      expect(completion.json().choices[0].message.content).toBe("from-b");
      expect(
        fetchImpl.mock.calls.some(([input]) =>
          String(input).includes("provider-a.example/v1/chat/completions")
        )
      ).toBe(false);
      expect(
        fetchImpl.mock.calls.some(([input]) =>
          String(input).includes("provider-b.example/v1/chat/completions")
        )
      ).toBe(true);

      const auditResponse = await app.inject({
        method: "GET",
        url: `/admin/api/audit?page=1&pageSize=20&apiKeyId=${scopedKey.id}`,
        headers: {
          cookie
        }
      });

      expect(auditResponse.statusCode).toBe(200);
      const chatAudit = auditResponse
        .json()
        .items.find((item: { endpoint_type: string }) => item.endpoint_type === "chat_completions");
      expect(chatAudit).toBeTruthy();
      expect(chatAudit.input_tokens).toBe(8);
      expect(chatAudit.cached_input_tokens).toBe(4);
      expect(chatAudit.output_tokens).toBe(8);
      expect(chatAudit.total_tokens).toBe(20);

      const dashboard = await app.inject({
        method: "GET",
        url: "/admin/api/dashboard?range=day",
        headers: {
          cookie
        }
      });

      expect(dashboard.statusCode).toBe(200);
      expect(dashboard.json().overall.inputTokens).toBe(8);
      expect(dashboard.json().overall.cacheTokens).toBe(4);
      expect(dashboard.json().overall.outputTokens).toBe(8);
      expect(dashboard.json().overall.totalTokens).toBe(20);
      expect(
        dashboard
          .json()
          .apiKeyCards.some(
            (card: { label: string; inputTokens: number; cacheTokens: number }) =>
              card.label.includes("provider-b-only") &&
              card.inputTokens === 8 &&
              card.cacheTokens === 4
          )
      ).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("returns model_not_routable externally when api key scope denies the model", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [{ id: "router-test-upstream" }]
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    );

    const app = await createTestApp(fetchImpl);

    try {
      const cookie = await login(app);
      const provider = await createProvider(app, cookie, {
        name: "provider-scope",
        baseUrl: "https://provider-scope.example/v1"
      });
      const deniedModel = await createModel(app, cookie, {
        alias: "denied-model",
        displayName: "Denied Model"
      });
      const allowedModel = await createModel(app, cookie, {
        alias: "allowed-model",
        displayName: "Allowed Model"
      });

      await addBinding(app, cookie, deniedModel.id, {
        providerId: provider.id,
        upstreamModel: "denied-upstream"
      });

      const scopedKey = await createGatewayApiKey(app, cookie, {
        name: "allowed-model-only",
        allowedProviderIds: [provider.id],
        allowedModelAliasIds: [allowedModel.id]
      });

      const modelsResponse = await app.inject({
        method: "GET",
        url: "/v1/models",
        headers: {
          authorization: `Bearer ${scopedKey.plaintext}`
        }
      });

      expect(modelsResponse.statusCode).toBe(200);
      expect(modelsResponse.json().data).toHaveLength(0);

      const completion = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        headers: {
          authorization: `Bearer ${scopedKey.plaintext}`
        },
        payload: {
          model: "denied-model",
          messages: [{ role: "user", content: "hi" }]
        }
      });

      expect(completion.statusCode).toBe(404);
      expect(completion.json().error.code).toBe("model_not_routable");

      const auditResponse = await app.inject({
        method: "GET",
        url: `/admin/api/audit?page=1&pageSize=20&apiKeyId=${scopedKey.id}`,
        headers: {
          cookie
        }
      });

      expect(auditResponse.statusCode).toBe(200);
      expect(
        auditResponse
          .json()
          .items.some(
            (item: { endpoint_type: string; error_code?: string }) =>
              item.endpoint_type === "chat_completions" &&
              item.error_code === "api_key_scope_denied"
          )
      ).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("restores default runtime order on restart", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [{ id: "gpt-4o" }]
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    );

    const dataDir = createTempDir();
    cleanupDirs.push(dataDir);

    const app = await createTestApp(fetchImpl, dataDir);

    try {
      const cookie = await login(app);
      const providerA = await createProvider(app, cookie, {
        name: "provider-a",
        baseUrl: "https://provider-a.example/v1",
        apiKey: "secret-a"
      });
      const providerB = await createProvider(app, cookie, {
        name: "provider-b",
        baseUrl: "https://provider-b.example/v1",
        apiKey: "secret-b"
      });
      const model = await createModel(app, cookie, {
        alias: "router-test",
        displayName: "Router Test"
      });

      await addBinding(app, cookie, model.id, {
        providerId: providerA.id,
        upstreamModel: "gpt-a"
      });
      const secondBinding = await addBinding(app, cookie, model.id, {
        providerId: providerB.id,
        upstreamModel: "gpt-b"
      });

      const bindingIds = secondBinding.bindings.map((binding) => binding.id);
      const reversed = [...bindingIds].reverse();

      const applyResponse = await app.inject({
        method: "POST",
        url: `/admin/api/models/${model.id}/runtime-order/apply`,
        headers: { cookie },
        payload: {
          bindingIds: reversed
        }
      });
      expect(applyResponse.statusCode).toBe(200);

      const saveDefaultResponse = await app.inject({
        method: "POST",
        url: `/admin/api/models/${model.id}/runtime-order/save-default`,
        headers: { cookie },
        payload: {
          bindingIds: reversed
        }
      });
      expect(saveDefaultResponse.statusCode).toBe(200);

      const savedModel = saveDefaultResponse.json().item as {
        bindings: Array<{
          id: string;
          runtimePriority: number;
          defaultPriority: number;
          providerName: string;
        }>;
      };

      expect(savedModel.bindings.map((binding) => binding.id)).toEqual(reversed);
      expect(savedModel.bindings.map((binding) => binding.runtimePriority)).toEqual([0, 1]);
      expect(savedModel.bindings.map((binding) => binding.defaultPriority)).toEqual([0, 1]);
    } finally {
      await app.close();
    }

    const restarted = await createTestApp(fetchImpl, dataDir);

    try {
      const restartedCookie = await login(restarted);
      const models = await restarted.inject({
        method: "GET",
        url: "/admin/api/models",
        headers: { cookie: restartedCookie }
      });

      const firstModel = models.json().items[0];
      expect(firstModel.bindings[0].providerName).toBe("provider-b");
    } finally {
      await restarted.close();
    }
  });

  it("validates save-default binding ids", async () => {
    const app = await createTestApp();

    try {
      const cookie = await login(app);
      const providerA = await createProvider(app, cookie, {
        name: "default-order-provider-a",
        baseUrl: "https://default-a.example/v1"
      });
      const providerB = await createProvider(app, cookie, {
        name: "default-order-provider-b",
        baseUrl: "https://default-b.example/v1"
      });
      const model = await createModel(app, cookie, {
        alias: "default-order-test",
        displayName: "Default Order Test"
      });

      await addBinding(app, cookie, model.id, {
        providerId: providerA.id,
        upstreamModel: "model-a"
      });
      const secondBinding = await addBinding(app, cookie, model.id, {
        providerId: providerB.id,
        upstreamModel: "model-b"
      });

      const bindingIds = secondBinding.bindings.map((binding) => binding.id);

      const missingBodyResponse = await app.inject({
        method: "POST",
        url: `/admin/api/models/${model.id}/runtime-order/save-default`,
        headers: { cookie }
      });

      expect(missingBodyResponse.statusCode).toBe(400);
      expect(missingBodyResponse.json().error.code).toBe("validation_error");

      const invalidBindingResponse = await app.inject({
        method: "POST",
        url: `/admin/api/models/${model.id}/runtime-order/save-default`,
        headers: { cookie },
        payload: {
          bindingIds: [bindingIds[0]]
        }
      });

      expect(invalidBindingResponse.statusCode).toBe(400);
      expect(invalidBindingResponse.json().error.code).toBe("binding_order_invalid");
    } finally {
      await app.close();
    }
  });

  it("deletes model bindings from the admin API", async () => {
    const app = await createTestApp();

    try {
      const cookie = await login(app);
      const providerA = await createProvider(app, cookie, {
        name: "binding-provider-a",
        baseUrl: "https://binding-a.example/v1"
      });
      const providerB = await createProvider(app, cookie, {
        name: "binding-provider-b",
        baseUrl: "https://binding-b.example/v1"
      });
      const model = await createModel(app, cookie, {
        alias: "binding-delete-test",
        displayName: "Binding Delete Test"
      });

      await addBinding(app, cookie, model.id, {
        providerId: providerA.id,
        upstreamModel: "model-a"
      });
      const secondBinding = await addBinding(app, cookie, model.id, {
        providerId: providerB.id,
        upstreamModel: "model-b"
      });

      const bindingToDelete = secondBinding.bindings.find(
        (binding) => binding.providerName === "binding-provider-b"
      );
      expect(bindingToDelete).toBeTruthy();

      const deleteResponse = await app.inject({
        method: "DELETE",
        url: `/admin/api/models/${model.id}/bindings/${bindingToDelete?.id}`,
        headers: {
          cookie
        }
      });

      expect(deleteResponse.statusCode).toBe(200);

      const modelsResponse = await app.inject({
        method: "GET",
        url: "/admin/api/models",
        headers: {
          cookie
        }
      });

      expect(modelsResponse.statusCode).toBe(200);
      const reloadedModel = modelsResponse
        .json()
        .items.find((item: { id: string }) => item.id === model.id);
      expect(reloadedModel).toBeTruthy();
      expect(reloadedModel.bindings).toHaveLength(1);
      expect(reloadedModel.bindings[0].providerName).toBe("binding-provider-a");
    } finally {
      await app.close();
    }
  });
});
