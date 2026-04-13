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
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
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
  name: string
) {
  const response = await app.inject({
    method: "POST",
    url: "/admin/api/security/api-keys",
    headers: {
      cookie
    },
    payload: {
      name
    }
  });

  expect(response.statusCode).toBe(201);
  const body = response.json() as {
    item: {
      id: string;
      name: string;
      maskedPreview: string;
    };
    createdKeyPlaintext: string;
  };

  return {
    id: body.item.id,
    name: body.item.name,
    maskedPreview: body.item.maskedPreview,
    plaintext: body.createdKeyPlaintext
  };
}

async function createProviderAndModel(
  app: Awaited<ReturnType<typeof buildApp>>,
  cookie: string | string[]
) {
  const providerResponse = await app.inject({
    method: "POST",
    url: "/admin/api/providers",
    headers: {
      cookie
    },
    payload: {
      name: "openai-primary",
      baseUrl: "https://provider.example/v1",
      apiKey: "provider-secret",
      enabled: true,
      testTimeoutMs: 10000
    }
  });

  expect(providerResponse.statusCode).toBe(201);
  const providerId = providerResponse.json().item.id as string;

  const modelResponse = await app.inject({
    method: "POST",
    url: "/admin/api/models",
    headers: {
      cookie
    },
    payload: {
      alias: "gpt-4o-mini",
      displayName: "GPT 4o Mini",
      enabled: true
    }
  });

  expect(modelResponse.statusCode).toBe(201);
  const modelId = modelResponse.json().item.id as string;

  const bindingResponse = await app.inject({
    method: "POST",
    url: `/admin/api/models/${modelId}/bindings`,
    headers: {
      cookie
    },
    payload: {
      providerId,
      upstreamModel: "gpt-4o",
      inputPrice: 1,
      outputPrice: 2,
      enabled: true
    }
  });

  expect(bindingResponse.statusCode).toBe(201);

  return {
    providerId,
    modelId
  };
}

describe("llm router server", () => {
  it("bootstraps and exposes health endpoints without bootstrap gateway key", async () => {
    const app = await createTestApp();

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

    await app.close();
  });

  it("returns configuration error when no API key exists", async () => {
    const app = await createTestApp();

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

    await app.close();
  });

  it("creates API keys, authenticates requests, and aggregates audit and dashboard by key", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.endsWith("/models")) {
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
      }

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

      return new Response(JSON.stringify({ error: { message: "not found" } }), {
        status: 404,
        headers: {
          "content-type": "application/json"
        }
      });
    });

    const app = await createTestApp(fetchImpl);
    const cookie = await login(app);
    await createProviderAndModel(app, cookie);

    const webClientKey = await createGatewayApiKey(app, cookie, "web-client");
    const mobileClientKey = await createGatewayApiKey(app, cookie, "mobile-client");

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

    await app.close();
  });

  it("invalidates disabled and deleted API keys while keeping other active keys available", async () => {
    const app = await createTestApp();
    const cookie = await login(app);

    const stableKey = await createGatewayApiKey(app, cookie, "stable-client");
    const disabledKey = await createGatewayApiKey(app, cookie, "disabled-client");
    const deletedKey = await createGatewayApiKey(app, cookie, "deleted-client");

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

    await app.close();
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
    const cookie = await login(app);

    const providerA = await app.inject({
      method: "POST",
      url: "/admin/api/providers",
      headers: { cookie },
      payload: {
        name: "provider-a",
        baseUrl: "https://provider-a.example/v1",
        apiKey: "secret-a",
        enabled: true,
        testTimeoutMs: 10000
      }
    });

    const providerB = await app.inject({
      method: "POST",
      url: "/admin/api/providers",
      headers: { cookie },
      payload: {
        name: "provider-b",
        baseUrl: "https://provider-b.example/v1",
        apiKey: "secret-b",
        enabled: true,
        testTimeoutMs: 10000
      }
    });

    const model = await app.inject({
      method: "POST",
      url: "/admin/api/models",
      headers: { cookie },
      payload: {
        alias: "router-test",
        displayName: "Router Test",
        enabled: true
      }
    });

    const modelId = model.json().item.id as string;

    await app.inject({
      method: "POST",
      url: `/admin/api/models/${modelId}/bindings`,
      headers: { cookie },
      payload: {
        providerId: providerA.json().item.id,
        upstreamModel: "gpt-a",
        inputPrice: 1,
        outputPrice: 1,
        enabled: true
      }
    });

    const secondBinding = await app.inject({
      method: "POST",
      url: `/admin/api/models/${modelId}/bindings`,
      headers: { cookie },
      payload: {
        providerId: providerB.json().item.id,
        upstreamModel: "gpt-b",
        inputPrice: 1,
        outputPrice: 1,
        enabled: true
      }
    });

    const bindingIds = secondBinding
      .json()
      .item.bindings.map((binding: { id: string }) => binding.id);
    const reversed = [...bindingIds].reverse();

    await app.inject({
      method: "POST",
      url: `/admin/api/models/${modelId}/runtime-order/apply`,
      headers: { cookie },
      payload: {
        bindingIds: reversed
      }
    });

    await app.inject({
      method: "POST",
      url: `/admin/api/models/${modelId}/runtime-order/save-default`,
      headers: { cookie }
    });

    await app.close();

    const restarted = await createTestApp(fetchImpl, dataDir);
    const restartedCookie = await login(restarted);
    const models = await restarted.inject({
      method: "GET",
      url: "/admin/api/models",
      headers: { cookie: restartedCookie }
    });

    const firstModel = models.json().items[0];
    expect(firstModel.bindings[0].providerName).toBe("provider-b");

    await restarted.close();
  });
});
