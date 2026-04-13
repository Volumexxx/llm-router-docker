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
      BOOTSTRAP_ADMIN_PASSWORD: "admin-password",
      BOOTSTRAP_GATEWAY_API_KEY: "gateway-secret"
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
  return response.headers["set-cookie"];
}

describe("llm router server", () => {
  it("bootstraps and exposes health endpoints", async () => {
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

    await app.close();
  });

  it("creates providers and models, then proxies chat completions", async () => {
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

    const modelId = modelResponse.json().item.id as string;

    await app.inject({
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

    const modelsList = await app.inject({
      method: "GET",
      url: "/v1/models",
      headers: {
        authorization: "Bearer gateway-secret"
      }
    });

    expect(modelsList.statusCode).toBe(200);
    expect(modelsList.json().data).toHaveLength(1);

    const completion = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        authorization: "Bearer gateway-secret"
      },
      payload: {
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "hi" }]
      }
    });

    expect(completion.statusCode).toBe(200);
    expect(completion.json().choices[0].message.content).toBe("hello");
    expect(fetchImpl).toHaveBeenCalled();

    const audit = await app.inject({
      method: "GET",
      url: "/admin/api/audit?page=1&pageSize=20",
      headers: {
        cookie
      }
    });

    expect(audit.statusCode).toBe(200);
    expect(audit.json().items.some((item: { endpoint_type: string; status_category: string }) => item.endpoint_type === "chat_completions" && item.status_category === "success")).toBe(true);

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

    const bindingIds = secondBinding.json().item.bindings.map((binding: { id: string }) => binding.id);
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
