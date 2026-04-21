import { act, type ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BindingItem, ModelItem, ProviderItem, ProviderPayload } from "../lib/api.ts";
import { click, getButtonByText, getButtonsByText, render } from "../test/render.tsx";
import { ProvidersPage } from "./ProvidersPage.tsx";

const providerApiMocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  test: vi.fn(),
  remove: vi.fn()
}));

vi.mock("../lib/api.ts", async () => {
  const actual = await vi.importActual<typeof import("../lib/api.ts")>("../lib/api.ts");

  return {
    ...actual,
    api: {
      ...actual.api,
      providers: {
        create: providerApiMocks.create,
        update: providerApiMocks.update,
        test: providerApiMocks.test,
        remove: providerApiMocks.remove
      }
    }
  };
});

const activeRenders: Array<{ unmount: () => Promise<void> }> = [];

function buildProvider(
  overrides: Partial<ProviderItem> = {}
): ProviderItem {
  return {
    id: "provider-1",
    name: "OpenAI Main",
    enabled: true,
    createdAt: "2026-04-21T00:00:00.000Z",
    updatedAt: "2026-04-21T00:00:00.000Z",
    openaiConfig: {
      id: "provider-1-openai",
      configured: true,
      protocol: "openai",
      baseUrl: "https://openai.example/v1",
      testTimeoutMs: 10000,
      apiVersion: null,
      apiKeyPreview: "sk-***123"
    },
    anthropicConfig: null,
    ...overrides
  };
}

function buildModel(overrides: Partial<ModelItem> = {}): ModelItem {
  return {
    id: "model-1",
    alias: "gpt-4o-mini",
    displayName: "GPT 4o Mini",
    enabled: true,
    bindings: {
      openai: [],
      anthropic: []
    },
    ...overrides
  };
}

function buildBinding(overrides: Partial<BindingItem> = {}): BindingItem {
  return {
    id: "binding-1",
    providerId: "provider-1",
    providerName: "OpenAI Main",
    protocol: "openai",
    upstreamModel: "gpt-4o",
    inputPrice: 1,
    outputPrice: 2,
    enabled: true,
    runtimePriority: 0,
    defaultPriority: 0,
    ...overrides
  };
}

async function setValue(
  element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  value: string
): Promise<void> {
  await act(async () => {
    const prototype =
      element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : element instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
    const valueSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;

    valueSetter?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function flushAsyncWork(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderProvidersPage(
  overrides: Partial<ComponentProps<typeof ProvidersPage>> = {}
) {
  const props: ComponentProps<typeof ProvidersPage> = {
    providers: [buildProvider()],
    models: [],
    refreshProviders: vi.fn().mockResolvedValue(undefined),
    refreshModels: vi.fn().mockResolvedValue(undefined),
    refreshApiKeys: vi.fn().mockResolvedValue(undefined),
    onNotice: vi.fn(),
    onError: vi.fn(),
    ...overrides
  };

  const view = await render(<ProvidersPage {...props} />);
  activeRenders.push(view);

  return { view, props };
}

describe("ProvidersPage", () => {
  afterEach(async () => {
    providerApiMocks.create.mockReset();
    providerApiMocks.update.mockReset();
    providerApiMocks.test.mockReset();
    providerApiMocks.remove.mockReset();

    while (activeRenders.length > 0) {
      const current = activeRenders.pop();
      if (current) {
        await current.unmount();
      }
    }
  });

  it("renders logical provider rows with protocol summary and impact counts", async () => {
    const providerA = buildProvider();
    const providerB = buildProvider({
      id: "provider-2",
      name: "Claude Node",
      openaiConfig: null,
      anthropicConfig: {
        id: "provider-2-anthropic",
        configured: true,
        protocol: "anthropic",
        baseUrl: "https://anthropic.example",
        testTimeoutMs: 15000,
        apiVersion: "2023-06-01",
        apiKeyPreview: "cla***456"
      }
    });

    const { view } = await renderProvidersPage({
      providers: [providerA, providerB],
      models: [
        buildModel({
          bindings: {
            openai: [
              buildBinding({
                providerId: providerA.id,
                providerName: providerA.name
              })
            ],
            anthropic: []
          }
        })
      ]
    });

    expect(getButtonsByText(view.container, "配置")).toHaveLength(2);
    expect(view.container.querySelectorAll("tbody input, tbody select, tbody textarea")).toHaveLength(0);
    expect(view.container.textContent).toContain("1 条 binding");
    expect(view.container.textContent).toContain("仅 OpenAI");
    expect(view.container.textContent).toContain("仅 Anthropic");
  });

  it("creates a provider from the modal with independent openai and anthropic payloads", async () => {
    providerApiMocks.create.mockResolvedValue({
      item: buildProvider({
        id: "provider-created",
        name: "Dual Provider",
        anthropicConfig: {
          id: "provider-created-anthropic",
          configured: true,
          protocol: "anthropic",
          baseUrl: "https://api.anthropic.com",
          testTimeoutMs: 12000,
          apiVersion: "2023-06-01",
          apiKeyPreview: "cla***999"
        }
      })
    });

    const { view, props } = await renderProvidersPage({
      providers: []
    });

    await click(getButtonByText(view.container, "新增 Provider"));

    const modal = view.container.querySelector(".modal-panel");
    expect(modal).toBeTruthy();

    const nameInput = modal?.querySelector('input[placeholder="例如：Official / Proxy / Backup"]');
    const baseUrlInputs = modal?.querySelectorAll('input[placeholder^="https://api."]');
    const passwordInputs = modal?.querySelectorAll('input[type="password"]');
    const anthropicVersionInput = modal?.querySelector(
      `input[placeholder="2023-06-01"]`
    ) as HTMLInputElement | null;

    expect(nameInput).toBeInstanceOf(HTMLInputElement);
    expect(baseUrlInputs).toHaveLength(2);
    expect(passwordInputs).toHaveLength(2);
    expect(anthropicVersionInput).toBeInstanceOf(HTMLInputElement);

    await setValue(nameInput as HTMLInputElement, "Dual Provider");
    await setValue(baseUrlInputs?.[0] as HTMLInputElement, "https://api.openai.com/v1");
    await setValue(passwordInputs?.[0] as HTMLInputElement, "openai-secret");
    await setValue(baseUrlInputs?.[1] as HTMLInputElement, "https://api.anthropic.com");
    await setValue(passwordInputs?.[1] as HTMLInputElement, "anthropic-secret");
    await setValue(anthropicVersionInput as HTMLInputElement, "2023-06-01");

    await click(getButtonByText(modal ?? view.container, "创建 Provider"));
    await flushAsyncWork();

    expect(providerApiMocks.create).toHaveBeenCalledTimes(1);
    const createPayload = providerApiMocks.create.mock.calls[0]?.[0] as ProviderPayload;
    expect(createPayload).toMatchObject({
      name: "Dual Provider",
      enabled: true,
      openai: {
        baseUrl: "https://api.openai.com/v1",
        apiKey: "openai-secret",
        testTimeoutMs: 10000
      },
      anthropic: {
        baseUrl: "https://api.anthropic.com",
        apiKey: "anthropic-secret",
        testTimeoutMs: 10000,
        apiVersion: "2023-06-01"
      }
    });
    expect(props.refreshProviders).toHaveBeenCalledTimes(1);
    expect(props.onNotice).toHaveBeenCalledWith("Provider 已创建。");
  });

  it("omits apiKey when saving without replacement and includes it after entering a new key", async () => {
    const provider = buildProvider();
    providerApiMocks.update.mockResolvedValue({
      item: provider
    });

    const { view, props } = await renderProvidersPage({
      providers: [provider]
    });

    await click(getButtonByText(view.container, "配置"));

    let drawer = view.container.querySelector(".drawer-panel");
    expect(drawer?.textContent).toContain("sk-***123");
    await click(getButtonByText(drawer ?? view.container, "保存配置"));
    await flushAsyncWork();

    expect(providerApiMocks.update).toHaveBeenCalledTimes(1);
    expect(providerApiMocks.update.mock.calls[0]?.[0]).toBe(provider.id);
    expect(providerApiMocks.update.mock.calls[0]?.[1]).toMatchObject({
      name: provider.name,
      enabled: true,
      openai: {
        baseUrl: provider.openaiConfig?.baseUrl,
        testTimeoutMs: provider.openaiConfig?.testTimeoutMs
      }
    });
    expect(providerApiMocks.update.mock.calls[0]?.[1].openai).not.toHaveProperty("apiKey");
    expect(providerApiMocks.update.mock.calls[0]?.[1].anthropic).toBeUndefined();

    const passwordInputs = drawer?.querySelectorAll('input[type="password"]');
    expect(passwordInputs).toHaveLength(2);
    await setValue(passwordInputs?.[0] as HTMLInputElement, "new-secret-key");

    drawer = view.container.querySelector(".drawer-panel");
    await click(getButtonByText(drawer ?? view.container, "保存配置"));
    await flushAsyncWork();

    expect(providerApiMocks.update).toHaveBeenCalledTimes(2);
    expect(providerApiMocks.update.mock.calls[1]?.[1]).toMatchObject({
      openai: {
        apiKey: "new-secret-key"
      }
    });
    const refreshedPasswordInputs = view.container.querySelectorAll('input[type="password"]');
    expect((refreshedPasswordInputs[0] as HTMLInputElement | undefined)?.value).toBe("");
    expect(view.container.textContent).toContain("sk-***123");
    expect(props.refreshProviders).toHaveBeenCalledTimes(2);
    expect(props.refreshModels).toHaveBeenCalledTimes(2);
  });

  it("shows delete impact, requires confirmation text, and refreshes providers, models, and api keys after delete", async () => {
    const provider = buildProvider();
    const otherProvider = buildProvider({
      id: "provider-2",
      name: "Backup Provider",
      openaiConfig: {
        id: "provider-2-openai",
        configured: true,
        protocol: "openai",
        baseUrl: "https://backup.example/v1",
        testTimeoutMs: 10000,
        apiVersion: null,
        apiKeyPreview: "bk-***456"
      }
    });

    providerApiMocks.remove.mockResolvedValue({
      success: true,
      providerId: provider.id,
      providerName: provider.name,
      removedBindingCount: 2,
      affectedModelCount: 2
    });

    const modelA = buildModel({
      id: "model-a",
      bindings: {
        openai: [
          buildBinding({
            id: "binding-a",
            providerId: provider.id,
            providerName: provider.name
          })
        ],
        anthropic: []
      }
    });

    const modelB = buildModel({
      id: "model-b",
      alias: "gpt-4.1",
      displayName: "GPT 4.1",
      bindings: {
        openai: [
          buildBinding({
            id: "binding-b1",
            providerId: provider.id,
            providerName: provider.name,
            enabled: false
          }),
          buildBinding({
            id: "binding-b2",
            providerId: otherProvider.id,
            providerName: otherProvider.name,
            runtimePriority: 1,
            defaultPriority: 1
          })
        ],
        anthropic: []
      }
    });

    const { view, props } = await renderProvidersPage({
      providers: [provider, otherProvider],
      models: [modelA, modelB]
    });

    await click(getButtonsByText(view.container, "配置")[0]!);

    const drawer = view.container.querySelector(".drawer-panel");
    expect(drawer?.textContent).toContain("2 条 binding");
    expect(drawer?.textContent).toContain("2 个模型");

    const deleteButton = getButtonByText(drawer ?? view.container, "删除 Provider");
    expect(deleteButton.disabled).toBe(true);

    const confirmationInput = drawer?.querySelector(
      'input[placeholder="请输入 Provider 名称以确认删除"]'
    );
    expect(confirmationInput).toBeInstanceOf(HTMLInputElement);

    await setValue(confirmationInput as HTMLInputElement, provider.name);
    expect(deleteButton.disabled).toBe(false);

    await click(deleteButton);
    await flushAsyncWork();

    expect(providerApiMocks.remove).toHaveBeenCalledWith(provider.id);
    expect(props.refreshProviders).toHaveBeenCalledTimes(1);
    expect(props.refreshModels).toHaveBeenCalledTimes(1);
    expect(props.refreshApiKeys).toHaveBeenCalledTimes(1);
    expect(props.onNotice).toHaveBeenCalledWith(
      "Provider OpenAI Main 已删除，移除 2 条 binding，影响 2 个模型。"
    );
    expect(view.container.querySelector(".drawer-panel")).toBeNull();
  });
});
