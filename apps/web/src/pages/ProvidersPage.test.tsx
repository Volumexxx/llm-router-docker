import { act, type ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ModelItem, ProviderItem, ProviderPayload } from "../lib/api.ts";
import { click, getButtonByText, getButtonsByText, render } from "../test/render.tsx";
import { ProvidersPage } from "./ProvidersPage.tsx";

const providerApiMocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  test: vi.fn(),
  remove: vi.fn()
}));

vi.mock("../lib/api.ts", () => ({
  api: {
    providers: {
      create: providerApiMocks.create,
      update: providerApiMocks.update,
      test: providerApiMocks.test,
      remove: providerApiMocks.remove
    }
  }
}));

const emptyProviderForm: ProviderPayload = {
  name: "",
  baseUrl: "",
  apiKey: "",
  protocol: "openai",
  apiVersion: null,
  enabled: true,
  testTimeoutMs: 10000
};

const activeRenders: Array<{ unmount: () => Promise<void> }> = [];

function buildProvider(overrides: Partial<ProviderItem> = {}): ProviderItem {
  return {
    id: "provider-1",
    name: "OpenAI Main",
    baseUrl: "https://openai.example/v1",
    protocol: "openai",
    apiVersion: null,
    enabled: true,
    testTimeoutMs: 10000,
    apiKeyPreview: "sk-***123",
    ...overrides
  };
}

function buildModel(overrides: Partial<ModelItem> = {}): ModelItem {
  return {
    id: "model-1",
    alias: "gpt-4o-mini",
    displayName: "GPT 4o Mini",
    enabled: true,
    bindings: [],
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
    newProvider: emptyProviderForm,
    setNewProvider: vi.fn(),
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

  it("renders provider rows as summary rows instead of inline editable controls", async () => {
    const providerA = buildProvider();
    const providerB = buildProvider({
      id: "provider-2",
      name: "Claude Node",
      baseUrl: "https://anthropic.example",
      protocol: "anthropic",
      apiVersion: "2023-06-01",
      apiKeyPreview: "cla***456"
    });

    const { view } = await renderProvidersPage({
      providers: [providerA, providerB],
      models: [
        buildModel({
          bindings: [
            {
              id: "binding-1",
              providerId: providerA.id,
              providerName: providerA.name,
              upstreamModel: "gpt-4o",
              inputPrice: 1,
              outputPrice: 2,
              enabled: true,
              runtimePriority: 0,
              defaultPriority: 0
            }
          ]
        })
      ]
    });

    expect(getButtonsByText(view.container, "配置")).toHaveLength(2);
    expect(view.container.querySelectorAll("tbody input, tbody select, tbody textarea")).toHaveLength(0);
    expect(view.container.textContent).toContain("1 条 binding");
    expect(view.container.textContent).toContain("Claude Node");
  });

  it("opens the drawer for the selected provider and keeps key replacement collapsed by default", async () => {
    const providerA = buildProvider();
    const providerB = buildProvider({
      id: "provider-2",
      name: "Claude Node",
      baseUrl: "https://anthropic.example",
      protocol: "anthropic",
      apiVersion: "2023-06-01",
      apiKeyPreview: "cla***456"
    });

    const { view } = await renderProvidersPage({
      providers: [providerA, providerB]
    });

    await click(getButtonsByText(view.container, "配置")[1]!);

    const drawer = view.container.querySelector(".drawer-panel");
    expect(drawer?.textContent).toContain("Claude Node");
    expect(drawer?.querySelector('input[placeholder="输入新的 API Key"]')).toBeNull();

    await click(getButtonByText(drawer ?? view.container, "更换 Key"));
    expect(drawer?.querySelector('input[placeholder="输入新的 API Key"]')).toBeInstanceOf(
      HTMLInputElement
    );
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
    await click(getButtonByText(drawer ?? view.container, "保存配置"));
    await flushAsyncWork();

    expect(providerApiMocks.update).toHaveBeenCalledTimes(1);
    expect(providerApiMocks.update.mock.calls[0]?.[0]).toBe(provider.id);
    expect(providerApiMocks.update.mock.calls[0]?.[1]).not.toHaveProperty("apiKey");

    await click(getButtonByText(drawer ?? view.container, "更换 Key"));
    const replacementInput = view.container.querySelector(
      '.drawer-panel input[placeholder="输入新的 API Key"]'
    );
    expect(replacementInput).toBeInstanceOf(HTMLInputElement);

    await setValue(replacementInput as HTMLInputElement, "new-secret-key");
    drawer = view.container.querySelector(".drawer-panel");
    await click(getButtonByText(drawer ?? view.container, "保存配置"));
    await flushAsyncWork();

    expect(providerApiMocks.update).toHaveBeenCalledTimes(2);
    expect(providerApiMocks.update.mock.calls[1]?.[1]).toMatchObject({
      apiKey: "new-secret-key"
    });
    expect(props.refreshProviders).toHaveBeenCalledTimes(2);
    expect(props.refreshModels).toHaveBeenCalledTimes(2);
    expect(view.container.querySelector('.drawer-panel input[placeholder="输入新的 API Key"]')).toBeNull();
  });

  it("shows delete impact, requires confirmation text, and refreshes providers, models, and api keys after delete", async () => {
    const provider = buildProvider();
    const otherProvider = buildProvider({
      id: "provider-2",
      name: "Backup Provider",
      baseUrl: "https://backup.example/v1",
      apiKeyPreview: "bk-***456"
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
      bindings: [
        {
          id: "binding-a",
          providerId: provider.id,
          providerName: provider.name,
          upstreamModel: "gpt-4o",
          inputPrice: 1,
          outputPrice: 2,
          enabled: true,
          runtimePriority: 0,
          defaultPriority: 0
        }
      ]
    });
    const modelB = buildModel({
      id: "model-b",
      alias: "gpt-4.1",
      displayName: "GPT 4.1",
      bindings: [
        {
          id: "binding-b1",
          providerId: provider.id,
          providerName: provider.name,
          upstreamModel: "gpt-4.1",
          inputPrice: 1,
          outputPrice: 2,
          enabled: false,
          runtimePriority: 0,
          defaultPriority: 0
        },
        {
          id: "binding-b2",
          providerId: otherProvider.id,
          providerName: otherProvider.name,
          upstreamModel: "gpt-4.1-backup",
          inputPrice: 1,
          outputPrice: 2,
          enabled: true,
          runtimePriority: 1,
          defaultPriority: 1
        }
      ]
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
      expect.stringContaining("移除 2 条 binding，影响 2 个模型")
    );
    expect(view.container.querySelector(".drawer-panel")).toBeNull();
  });
});
