import { useEffect, useMemo, useState } from "react";

import {
  ApiError,
  api,
  type ApiKeyItem,
  type AuditResponse,
  type BindingItem,
  type BindingPayload,
  type DashboardSummary,
  type ModelItem,
  type ProviderItem,
  type SystemStatus
} from "./lib/api.ts";
import { AuditPage } from "./pages/AuditPage.tsx";
import { DashboardPage } from "./pages/DashboardPage.tsx";
import { LoginPage } from "./pages/LoginPage.tsx";
import { ModelsPage } from "./pages/ModelsPage.tsx";
import { ProvidersPage } from "./pages/ProvidersPage.tsx";
import { SystemPage } from "./pages/SystemPage.tsx";

type Section = "dashboard" | "providers" | "models" | "audit" | "system";
type AuditFilters = {
  providerId: string;
  apiKeyId: string;
  modelAlias: string;
  statusCategory: string;
  endpointType: string;
  page: number;
};

const defaultProviderForm = {
  name: "",
  baseUrl: "",
  apiKey: "",
  enabled: true,
  testTimeoutMs: 10000
};

const defaultModelForm = {
  alias: "",
  displayName: "",
  enabled: true
};

const defaultBindingForm: BindingPayload = {
  providerId: "",
  upstreamModel: "",
  inputPrice: 0,
  outputPrice: 0,
  enabled: true
};

function buildApiKeyDrafts(items: ApiKeyItem[]) {
  return Object.fromEntries(
    items.map((item) => [
      item.id,
      {
        name: item.name,
        enabled: item.enabled
      }
    ])
  );
}

export default function App() {
  const [user, setUser] = useState<{ id: string; username: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState<Section>("dashboard");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [providers, setProviders] = useState<ProviderItem[]>([]);
  const [providerSecrets, setProviderSecrets] = useState<Record<string, string>>({});
  const [newProvider, setNewProvider] = useState(defaultProviderForm);

  const [models, setModels] = useState<ModelItem[]>([]);
  const [newModel, setNewModel] = useState(defaultModelForm);
  const [bindingDrafts, setBindingDrafts] = useState<Record<string, BindingPayload>>({});

  const [dashboardRange, setDashboardRange] = useState<"day" | "week" | "month">("day");
  const [dashboard, setDashboard] = useState<DashboardSummary | null>(null);

  const [audit, setAudit] = useState<AuditResponse | null>(null);
  const [auditFilters, setAuditFilters] = useState<AuditFilters>({
    providerId: "",
    apiKeyId: "",
    modelAlias: "",
    statusCategory: "",
    endpointType: "",
    page: 1
  });

  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [apiKeys, setApiKeys] = useState<ApiKeyItem[]>([]);
  const [auditApiKeys, setAuditApiKeys] = useState<ApiKeyItem[]>([]);
  const [apiKeyDrafts, setApiKeyDrafts] = useState<Record<string, { name: string; enabled: boolean }>>({});
  const [newApiKeyName, setNewApiKeyName] = useState("");
  const [createdApiKeyPlaintext, setCreatedApiKeyPlaintext] = useState<string | null>(null);

  const [loginForm, setLoginForm] = useState({
    username: "",
    password: ""
  });

  const modelAliasOptions = useMemo(
    () => models.map((model) => model.alias).sort((a, b) => a.localeCompare(b)),
    [models]
  );

  const handleError = (reason: unknown) => {
    setError(reason instanceof Error ? reason.message : "操作失败");
    setNotice(null);
  };

  const handleNotice = (message: string) => {
    setNotice(message);
    setError(null);
  };

  const refreshProviders = async () => {
    const response = await api.providers.list();
    setProviders(response.items);
  };

  const refreshModels = async () => {
    const response = await api.models.list();
    setModels(response.items);
  };

  const refreshDashboard = async (range = dashboardRange) => {
    const response = await api.dashboard.get(range);
    setDashboard(response);
  };

  const refreshAudit = async (page = auditFilters.page, overrides?: Partial<AuditFilters>) => {
    const nextFilters = {
      ...auditFilters,
      ...overrides,
      page
    };
    const response = await api.audit.list({
      ...nextFilters
    });
    setAudit(response);
  };

  const refreshSystem = async () => {
    const response = await api.system.status();
    setSystemStatus(response);
  };

  const refreshApiKeys = async () => {
    const response = await api.security.listApiKeys(true);
    setAuditApiKeys(response.items);
    const activeItems = response.items.filter((item) => !item.deletedAt);
    setApiKeys(activeItems);
    setApiKeyDrafts(buildApiKeyDrafts(activeItems));
  };

  const refreshAll = async () => {
    await Promise.all([
      refreshProviders(),
      refreshModels(),
      refreshDashboard(),
      refreshAudit(1),
      refreshSystem(),
      refreshApiKeys()
    ]);
  };

  useEffect(() => {
    const bootstrap = async () => {
      try {
        const me = await api.auth.me();
        setUser(me.user);
        await refreshAll();
      } catch (reason) {
        if (!(reason instanceof ApiError && reason.status === 401)) {
          handleError(reason);
        }
      } finally {
        setLoading(false);
      }
    };

    void bootstrap();
  }, []);

  useEffect(() => {
    if (providers.length === 0) {
      return;
    }

    setBindingDrafts((current) => {
      const next = { ...current };
      models.forEach((model) => {
        if (!next[model.id]) {
          next[model.id] = {
            ...defaultBindingForm,
            providerId: providers[0]?.id ?? ""
          };
        }
      });
      return next;
    });
  }, [models, providers]);

  useEffect(() => {
    if (!user) {
      return;
    }

    void refreshDashboard(dashboardRange).catch(handleError);
  }, [dashboardRange, user]);

  const updateProviderField = (
    providerId: string,
    field: keyof ProviderItem,
    value: string | boolean | number
  ) => {
    setProviders((current) =>
      current.map((provider) =>
        provider.id === providerId
          ? {
              ...provider,
              [field]: value
            }
          : provider
      )
    );
  };

  const updateModelField = (modelId: string, field: keyof ModelItem, value: string | boolean) => {
    setModels((current) =>
      current.map((model) =>
        model.id === modelId
          ? {
              ...model,
              [field]: value
            }
          : model
      )
    );
  };

  const updateBindingField = (
    modelId: string,
    bindingId: string,
    field: keyof BindingItem,
    value: string | boolean | number
  ) => {
    setModels((current) =>
      current.map((model) =>
        model.id === modelId
          ? {
              ...model,
              bindings: model.bindings.map((binding) =>
                binding.id === bindingId
                  ? {
                      ...binding,
                      [field]: value
                    }
                  : binding
              )
            }
          : model
      )
    );
  };

  const moveBinding = (modelId: string, index: number, direction: -1 | 1) => {
    setModels((current) =>
      current.map((model) => {
        if (model.id !== modelId) {
          return model;
        }

        const nextBindings = [...model.bindings];
        const targetIndex = index + direction;
        if (targetIndex < 0 || targetIndex >= nextBindings.length) {
          return model;
        }

        const [item] = nextBindings.splice(index, 1);
        nextBindings.splice(targetIndex, 0, item);

        return {
          ...model,
          bindings: nextBindings
        };
      })
    );
  };

  if (loading) {
    return <main className="shell loading-state">正在初始化管理台...</main>;
  }

  if (!user) {
    return (
      <LoginPage
        error={error}
        loginForm={loginForm}
        setLoginForm={setLoginForm}
        onSubmit={(event) => {
          event.preventDefault();
          void api.auth
            .login(loginForm.username, loginForm.password)
            .then(async (response) => {
              setUser(response.user);
              await refreshAll();
              handleNotice("后台登录成功");
            })
            .catch(handleError);
        }}
      />
    );
  }

  return (
    <main className="shell app-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">LLM Router</p>
          <h1>公网版控制台</h1>
          <p className="muted">管理员：{user.username}</p>
        </div>
        <nav className="nav">
          {[
            ["dashboard", "概览仪表盘"],
            ["providers", "Provider 管理"],
            ["models", "模型与路由"],
            ["audit", "审计日志"],
            ["system", "系统与安全"]
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={section === value ? "nav-item active" : "nav-item"}
              onClick={() => setSection(value as Section)}
            >
              {label}
            </button>
          ))}
        </nav>
        <button
          type="button"
          className="ghost"
          onClick={() => {
            void api.auth
              .logout()
              .then(() => {
                setUser(null);
                handleNotice("已退出登录");
              })
              .catch(handleError);
          }}
        >
          退出登录
        </button>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">运行态</p>
            <h2>
              {section === "dashboard"
                ? "运行总览"
                : section === "providers"
                  ? "Provider 管理"
                  : section === "models"
                    ? "模型别名与路由"
                    : section === "audit"
                      ? "审计检索"
                      : "系统状态与 API Key"}
            </h2>
          </div>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              void refreshAll()
                .then(() => handleNotice("数据已刷新"))
                .catch(handleError);
            }}
          >
            立即刷新
          </button>
        </header>

        {notice ? <p className="feedback success">{notice}</p> : null}
        {error ? <p className="feedback error">{error}</p> : null}

        {section === "dashboard" ? (
          <DashboardPage
            dashboard={dashboard}
            range={dashboardRange}
            setRange={setDashboardRange}
          />
        ) : null}

        {section === "providers" ? (
          <ProvidersPage
            providers={providers}
            providerSecrets={providerSecrets}
            setProviderSecrets={setProviderSecrets}
            newProvider={newProvider}
            setNewProvider={setNewProvider}
            updateProviderField={updateProviderField}
            refreshProviders={refreshProviders}
            onNotice={handleNotice}
            onError={handleError}
          />
        ) : null}

        {section === "models" ? (
          <ModelsPage
            models={models}
            providers={providers}
            newModel={newModel}
            setNewModel={setNewModel}
            bindingDrafts={bindingDrafts}
            setBindingDrafts={setBindingDrafts}
            updateModelField={updateModelField}
            updateBindingField={updateBindingField}
            moveBinding={moveBinding}
            refreshModels={refreshModels}
            onNotice={handleNotice}
            onError={handleError}
            setError={(message) => setError(message)}
          />
        ) : null}

        {section === "audit" ? (
          <AuditPage
            providers={providers}
            apiKeys={auditApiKeys}
            modelAliasOptions={modelAliasOptions}
            audit={audit}
            auditFilters={auditFilters}
            setAuditFilters={setAuditFilters}
            refreshAudit={refreshAudit}
            onError={handleError}
          />
        ) : null}

        {section === "system" ? (
          <SystemPage
            systemStatus={systemStatus}
            apiKeys={apiKeys}
            apiKeyDrafts={apiKeyDrafts}
            setApiKeyDrafts={setApiKeyDrafts}
            newApiKeyName={newApiKeyName}
            setNewApiKeyName={setNewApiKeyName}
            createdApiKeyPlaintext={createdApiKeyPlaintext}
            onCreateApiKey={() => {
              if (!newApiKeyName.trim()) {
                setError("请先填写 API Key 名称");
                return;
              }

              void api.security
                .createApiKey(newApiKeyName.trim())
                .then(async (response) => {
                  setNewApiKeyName("");
                  setCreatedApiKeyPlaintext(response.createdKeyPlaintext);
                  await Promise.all([refreshApiKeys(), refreshSystem()]);
                  handleNotice(`API Key ${response.item.name} 已创建`);
                })
                .catch(handleError);
            }}
            onSaveApiKey={(apiKeyId) => {
              const draft = apiKeyDrafts[apiKeyId];
              if (!draft) {
                setError("没有可保存的 API Key 草稿");
                return;
              }

              void api.security
                .updateApiKey(apiKeyId, draft)
                .then(async (response) => {
                  await Promise.all([refreshApiKeys(), refreshSystem()]);
                  handleNotice(`API Key ${response.item.name} 已更新`);
                })
                .catch(handleError);
            }}
            onDeleteApiKey={(apiKeyId) => {
              const current = apiKeys.find((item) => item.id === apiKeyId);
              if (!current) {
                setError("API Key 不存在");
                return;
              }

              if (!window.confirm(`确认删除 API Key「${current.name}」吗？删除后将立即失效。`)) {
                return;
              }

              void api.security
                .deleteApiKey(apiKeyId)
                .then(async () => {
                  await Promise.all([refreshApiKeys(), refreshSystem(), refreshAudit(1)]);
                  handleNotice(`API Key ${current.name} 已删除`);
                })
                .catch(handleError);
            }}
          />
        ) : null}
      </section>
    </main>
  );
}
