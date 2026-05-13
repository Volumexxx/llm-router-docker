import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ApiKeyItem, SystemStatus } from "../lib/api.ts";
import { click, getButtonByText, render } from "../test/render.tsx";
import { ApiKeysPage } from "./ApiKeysPage.tsx";

describe("ApiKeysPage", () => {
  const activeRenders: Array<{ unmount: () => Promise<void> }> = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    while (activeRenders.length > 0) {
      await activeRenders.pop()?.unmount();
    }
  });

  function buildStatus(): SystemStatus {
    return {
      ready: true,
      readyErrors: [],
      dataDir: "",
      dbPath: "",
      timezone: "UTC",
      externalBaseUrl: null,
      adminExternalBaseUrl: null,
      detectedBaseUrl: "https://router.example",
      recommendedApiBaseUrl: "https://router.example/v1",
      recommendedAdminUrl: "https://router.example/admin",
      trustProxy: true,
      maxRequestBodySizeBytes: 100,
      upstreamTimeoutMs: 1000,
      loginRateLimit: { windowMs: 1000, max: 10 },
      apiRateLimit: { windowMs: 1000, max: 10 },
      maxActiveProxyRequests: 100,
      adminWhitelistEnabled: false,
      apiWhitelistEnabled: false,
      appliedMigrations: [],
      activeApiKeyCount: 1,
      totalApiKeyCount: 1,
      warnings: []
    };
  }

  function buildKey(): ApiKeyItem {
    return {
      id: "key-1",
      name: "默认",
      maskedPreview: "lrk***123",
      enabled: true,
      deletedAt: null,
      lastUsedAt: null,
      createdAt: "2026-05-13T00:00:00.000Z",
      updatedAt: "2026-05-13T00:00:00.000Z",
      allowedProviderIds: [],
      allowedModelAliasIds: [],
      allProvidersAllowed: true,
      allModelsAllowed: true
    };
  }

  it("shows only masked keys and exposes create/toggle/copy/delete actions", async () => {
    const onCreateApiKey = vi.fn();
    const onCopyApiKey = vi.fn();
    const onToggleApiKeyEnabled = vi.fn();
    const onDeleteApiKey = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const view = await render(
      <ApiKeysPage
        systemStatus={buildStatus()}
        apiKeys={[buildKey()]}
        newApiKeyName=""
        setNewApiKeyName={() => undefined}
        createdApiKeyPlaintext={null}
        onCreateApiKey={onCreateApiKey}
        onCopyApiKey={onCopyApiKey}
        onToggleApiKeyEnabled={onToggleApiKeyEnabled}
        onDeleteApiKey={onDeleteApiKey}
      />
    );
    activeRenders.push(view);

    expect(view.container.textContent).toContain("https://router.example/v1");
    expect(view.container.textContent).toContain("lrk***123");
    expect(view.container.textContent).not.toContain("manual-secret");

    await click(getButtonByText(view.container, "创建 API Key"));
    const toggle = view.container.querySelector(
      'input[aria-label="toggle-api-key-key-1"]'
    ) as HTMLInputElement;
    await act(async () => {
      toggle.click();
    });
    await click(getButtonByText(view.container, "复制"));
    await click(getButtonByText(view.container, "删除"));

    expect(onCreateApiKey).toHaveBeenCalledTimes(1);
    expect(onToggleApiKeyEnabled).toHaveBeenCalledWith("key-1", false);
    expect(onCopyApiKey).toHaveBeenCalledWith("key-1");
    expect(onDeleteApiKey).toHaveBeenCalledWith("key-1");
  });
});
