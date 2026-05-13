import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ModelItem, ProviderItem, SystemStatus, UserItem } from "../lib/api.ts";
import { click, getButtonByText, render } from "../test/render.tsx";
import { buildUserDrafts, SystemUsersPage } from "./SystemUsersPage.tsx";

describe("SystemUsersPage", () => {
  const activeRenders: Array<{ unmount: () => Promise<void> }> = [];

  afterEach(async () => {
    while (activeRenders.length > 0) {
      await activeRenders.pop()?.unmount();
    }
  });

  function buildStatus(): SystemStatus {
    return {
      ready: true,
      readyErrors: [],
      dataDir: "/data",
      dbPath: "/data/app.db",
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
      activeUserCount: 1,
      totalUserCount: 2,
      pendingUserCount: 1,
      warnings: []
    };
  }

  function buildUser(overrides: Partial<UserItem> = {}): UserItem {
    return {
      id: "user-1",
      username: "alice",
      displayName: "alice",
      role: "user",
      status: "pending",
      approvedAt: null,
      approvedByUserId: null,
      createdAt: "2026-05-13T00:00:00.000Z",
      updatedAt: "2026-05-13T00:00:00.000Z",
      allowedProviderIds: [],
      allowedModelAliasIds: [],
      allProvidersAllowed: false,
      allModelsAllowed: false,
      activeApiKeyCount: 0,
      totalApiKeyCount: 0,
      ...overrides
    };
  }

  const provider: ProviderItem = {
    id: "provider-1",
    name: "Provider A",
    enabled: true,
    createdAt: "2026-05-13T00:00:00.000Z",
    updatedAt: "2026-05-13T00:00:00.000Z",
    openaiConfig: null,
    anthropicConfig: null
  };

  const model: ModelItem = {
    id: "model-1",
    alias: "gpt-test",
    displayName: "GPT Test",
    enabled: true,
    bindings: { openai: [], anthropic: [] }
  };

  it("approves pending users and saves user permission drafts in a drawer", async () => {
    const users = [buildUser()];
    const onApproveUser = vi.fn();
    const onSaveUser = vi.fn();
    let drafts = buildUserDrafts(users);

    const view = await render(
      <SystemUsersPage
        systemStatus={buildStatus()}
        users={users}
        providers={[provider]}
        models={[model]}
        userDrafts={drafts}
        setUserDrafts={(update) => {
          drafts = typeof update === "function" ? update(drafts) : update;
        }}
        onApproveUser={onApproveUser}
        onSaveUser={onSaveUser}
      />
    );
    activeRenders.push(view);

    expect(view.container.textContent).not.toContain("用户配置 · alice");
    expect(view.container.textContent).not.toContain("空白 scope");
    expect(view.container.textContent).not.toContain("全部不勾选");

    await click(getButtonByText(view.container, "审批通过"));
    expect(onApproveUser).toHaveBeenCalledWith("user-1", undefined);

    await click(getButtonByText(view.container, "配置"));
    expect(view.container.textContent).toContain("用户配置 · alice");

    const providerCheckbox = view.container.querySelector(
      '.scope-card input[type="checkbox"]'
    ) as HTMLInputElement;

    await act(async () => {
      providerCheckbox.click();
    });

    expect(drafts["user-1"]?.allowedProviderIds).toEqual(["provider-1"]);

    await click(getButtonByText(view.container, "全部可用"));
    expect(drafts["user-1"]?.allowedProviderIds).toEqual(["provider-1"]);

    await click(getButtonByText(view.container, "清空"));
    expect(drafts["user-1"]?.allowedProviderIds).toEqual([]);

    await view.rerender(
      <SystemUsersPage
        systemStatus={buildStatus()}
        users={users}
        providers={[provider]}
        models={[model]}
        userDrafts={drafts}
        setUserDrafts={(update) => {
          drafts = typeof update === "function" ? update(drafts) : update;
        }}
        onApproveUser={onApproveUser}
        onSaveUser={onSaveUser}
      />
    );

    await click(getButtonByText(view.container, "保存用户配置"));
    expect(onSaveUser).toHaveBeenCalledWith("user-1");
  });

  it("renders user statuses and status options with short Chinese labels", async () => {
    const users = [
      buildUser({ id: "user-pending", username: "alice", displayName: "alice", status: "pending" }),
      buildUser({ id: "user-approved", username: "bob", displayName: "bob", status: "approved" }),
      buildUser({ id: "user-rejected", username: "carol", displayName: "carol", status: "rejected" }),
      buildUser({ id: "user-disabled", username: "dave", displayName: "dave", status: "disabled" })
    ];
    let drafts = buildUserDrafts(users);

    const view = await render(
      <SystemUsersPage
        systemStatus={buildStatus()}
        users={users}
        providers={[provider]}
        models={[model]}
        userDrafts={drafts}
        setUserDrafts={(update) => {
          drafts = typeof update === "function" ? update(drafts) : update;
        }}
        onApproveUser={() => undefined}
        onSaveUser={() => undefined}
      />
    );
    activeRenders.push(view);

    expect(view.container.textContent).toContain("待审");
    expect(view.container.textContent).toContain("通过");
    expect(view.container.textContent).toContain("拒绝");
    expect(view.container.textContent).toContain("停用");

    await click(getButtonByText(view.container, "配置"));
    const statusOptions = Array.from(view.container.querySelectorAll("select option")).map(
      (option) => option.textContent
    );

    expect(statusOptions).toEqual(["待审", "通过", "拒绝", "停用"]);
  });
});
