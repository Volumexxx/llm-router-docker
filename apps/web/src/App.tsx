import { useEffect, useMemo, useState } from "react";

import {
  ApiError,
  api,
  type ApiKeyItem,
  type AuditResponse,
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

type ApiKeyDraft = {
  name: string;
  enabled: boolean;
  allProvidersAllowed: boolean;
  allowedProviderIds: string[];
  allModelsAllowed: boolean;
  allowedModelAliasIds: string[];
};

const sectionMeta: Record<
  Section,
  {
    label: string;
    title: string;
    description: string;
  }
> = {
  dashboard: {
    label: "Dashboard",
    title: "概览看板",
    description: "查看请求趋势、成功率、成本和延迟，快速掌握 Provider、Model 和 API Key 的运行情况。"
  },
  providers: {
    label: "Providers",
    title: "Provider 管理",
    description: "管理逻辑 Provider，并分别配置 OpenAI 与 Anthropic 两套上游连接。"
  },
  models: {
    label: "Models & Routing",
    title: "模型与路由",
    description: "共享对外模型 alias，并在 OpenAI / Anthropic 两个协议标签下分别维护路由绑定。"
  },
  audit: {
    label: "Audit",
    title: "审计日志",
    description: "按时间、状态、Provider、模型和 API Key 筛选请求记录，定位异常更直接。"
  },
  system: {
    label: "System & API Keys",
    title: "系统与 API Keys",
    description: "查看系统状态、网关连通性和 API Key 授权范围，集中完成安全配置。"
  }
};

function buildApiKeyDrafts(items: ApiKeyItem[]): Record<string, ApiKeyDraft> {
  return Object.fromEntries(
    items.map((item) => [
      item.id,
      {
        name: item.name,
        enabled: item.enabled,
        allProvidersAllowed: item.allProvidersAllowed,
        allowedProviderIds: item.allowedProviderIds,
        allModelsAllowed: item.allModelsAllowed,
        allowedModelAliasIds: item.allowedModelAliasIds
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
  const [models, setModels] = useState<ModelItem[]>([]);

  const [dashboardRange, setDashboardRange] = useState<"day" | "week" | "month">("day");
  const [dashboardDayDate, setDashboardDayDate] = useState<string | null>(null);
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
  const [apiKeyDrafts, setApiKeyDrafts] = useState<Record<string, ApiKeyDraft>>({});
  const [newApiKeyName, setNewApiKeyName] = useState("");
  const [createdApiKeyPlaintext, setCreatedApiKeyPlaintext] = useState<string | null>(null);

  const [loginForm, setLoginForm] = useState({
    username: "",
    password: ""
  });

  const modelAliasOptions = useMemo(
    () => models.map((model) => model.alias).sort((left, right) => left.localeCompare(right)),
    [models]
  );

  const currentSectionMeta = sectionMeta[section];

  const handleError = (reason: unknown) => {
    setError(reason instanceof Error ? reason.message : "操作失败，请稍后重试。");
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

  const refreshDashboard = async (range = dashboardRange, dayDate = dashboardDayDate) => {
    const response = await api.dashboard.get(range, range === "day" ? (dayDate ?? undefined) : undefined);
    setDashboard(response);
    if (range === "day") {
      setDashboardDayDate(response.anchorDate);
    }
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
    if (!user) {
      return;
    }

    void refreshDashboard(dashboardRange).catch(handleError);
  }, [dashboardRange, user]);

  const handleDashboardDayDateChange = (date: string) => {
    const previousDate = dashboardDayDate;
    setDashboardDayDate(date);
    void refreshDashboard("day", date).catch((reason) => {
      setDashboardDayDate(previousDate);
      handleError(reason);
    });
  };

  if (loading) {
    return <main className="shell loading-state">正在加载管理控制台...</main>;
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
              handleNotice("登录成功。");
            })
            .catch(handleError);
        }}
      />
    );
  }

  return (
    <main className="shell app-shell">
      <aside className="sidebar">
        <div className="stack sidebar-stack">
          <div className="stack compact-stack">
            <p className="eyebrow">LLM Router</p>
            <h1>Public Router Console</h1>
            <p className="muted">当前登录：{user.username}</p>
          </div>

          <nav className="nav">
            {(Object.keys(sectionMeta) as Section[]).map((value) => (
              <button
                key={value}
                type="button"
                className={section === value ? "nav-item active" : "nav-item"}
                onClick={() => setSection(value)}
              >
                <span>{sectionMeta[value].label}</span>
                <small>{sectionMeta[value].title}</small>
              </button>
            ))}
          </nav>
        </div>

        <div className="stack compact-stack">
          <button
            type="button"
            className="secondary"
            onClick={() => {
              void refreshAll()
                .then(() => handleNotice("数据已刷新。"))
                .catch(handleError);
            }}
          >
            刷新数据
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => {
              void api.auth
                .logout()
                .then(() => {
                  setUser(null);
                  handleNotice("已退出登录。");
                })
                .catch(handleError);
            }}
          >
            退出登录
          </button>
        </div>
      </aside>

      <section className="content">
        <header className="topbar">
          <div className="stack compact-stack">
            <p className="eyebrow">{currentSectionMeta.label}</p>
            <h2>{currentSectionMeta.title}</h2>
            <p className="muted">{currentSectionMeta.description}</p>
          </div>
        </header>

        {notice ? <p className="feedback success">{notice}</p> : null}
        {error ? <p className="feedback error">{error}</p> : null}

        {section === "dashboard" ? (
          <DashboardPage
            dashboard={dashboard}
            range={dashboardRange}
            setRange={setDashboardRange}
            setDayDate={handleDashboardDayDateChange}
          />
        ) : null}

        {section === "providers" ? (
          <ProvidersPage
            providers={providers}
            models={models}
            refreshProviders={refreshProviders}
            refreshModels={refreshModels}
            refreshApiKeys={refreshApiKeys}
            onNotice={handleNotice}
            onError={handleError}
          />
        ) : null}

        {section === "models" ? (
          <ModelsPage
            models={models}
            providers={providers}
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
            providers={providers}
            models={models}
            apiKeys={apiKeys}
            apiKeyDrafts={apiKeyDrafts}
            setApiKeyDrafts={setApiKeyDrafts}
            newApiKeyName={newApiKeyName}
            setNewApiKeyName={setNewApiKeyName}
            createdApiKeyPlaintext={createdApiKeyPlaintext}
            onCreateApiKey={() => {
              if (!newApiKeyName.trim()) {
                setError("请输入 API Key 名称。");
                return;
              }

              void api.security
                .createApiKey({
                  name: newApiKeyName.trim()
                })
                .then(async (response) => {
                  setNewApiKeyName("");
                  setCreatedApiKeyPlaintext(response.createdKeyPlaintext);
                  await Promise.all([refreshApiKeys(), refreshSystem()]);
                  handleNotice(`API Key ${response.item.name} 已创建。`);
                })
                .catch(handleError);
            }}
            onSaveApiKey={(apiKeyId) => {
              const draft = apiKeyDrafts[apiKeyId];
              if (!draft) {
                setError("未找到要保存的 API Key 草稿。");
                return;
              }

              void api.security
                .updateApiKey(apiKeyId, {
                  name: draft.name,
                  enabled: draft.enabled,
                  allowedProviderIds: draft.allProvidersAllowed ? [] : draft.allowedProviderIds,
                  allowedModelAliasIds: draft.allModelsAllowed ? [] : draft.allowedModelAliasIds
                })
                .then(async (response) => {
                  await Promise.all([refreshApiKeys(), refreshSystem()]);
                  handleNotice(`API Key ${response.item.name} 已保存。`);
                })
                .catch(handleError);
            }}
            onDeleteApiKey={(apiKeyId) => {
              const current = apiKeys.find((item) => item.id === apiKeyId);
              if (!current) {
                setError("未找到对应的 API Key。");
                return;
              }

              void api.security
                .deleteApiKey(apiKeyId)
                .then(async () => {
                  await Promise.all([refreshApiKeys(), refreshSystem(), refreshAudit(1)]);
                  handleNotice(`API Key ${current.name} 已删除。`);
                })
                .catch(handleError);
            }}
          />
        ) : null}
      </section>
    </main>
  );
}
