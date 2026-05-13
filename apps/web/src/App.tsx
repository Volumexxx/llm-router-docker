import { useEffect, useMemo, useState } from "react";

import {
  ApiError,
  api,
  type ApiKeyItem,
  type AuditResponse,
  type ConsoleUser,
  type DashboardFilters,
  type DashboardSummary,
  type ModelItem,
  type ProviderItem,
  type SystemStatus,
  type UserItem,
  type VisibleModelItem
} from "./lib/api.ts";
import { ApiKeysPage } from "./pages/ApiKeysPage.tsx";
import { AuditPage } from "./pages/AuditPage.tsx";
import { DashboardPage } from "./pages/DashboardPage.tsx";
import { LoginPage } from "./pages/LoginPage.tsx";
import { ModelsPage } from "./pages/ModelsPage.tsx";
import { ProvidersPage } from "./pages/ProvidersPage.tsx";
import { RegisterPage, type RegisterForm } from "./pages/RegisterPage.tsx";
import { buildUserDrafts, SystemUsersPage, type UserDraft } from "./pages/SystemUsersPage.tsx";
import { UserModelsPage } from "./pages/UserModelsPage.tsx";

type Section = "dashboard" | "providers" | "models" | "audit" | "apiKeys" | "users";
type AuthMode = "login" | "register";

type AuditFilters = {
  providerId: string;
  apiKeyId: string;
  userId: string;
  modelAlias: string;
  statusCategory: string;
  endpointType: string;
  page: number;
};

const EMPTY_DASHBOARD_FILTERS: DashboardFilters = {
  providerId: "",
  modelAlias: "",
  apiKeyId: "",
  userId: ""
};

const sectionMeta: Record<
  Section,
  {
    label: string;
    title: string;
    description: string;
    adminOnly?: boolean;
  }
> = {
  dashboard: {
    label: "Dashboard",
    title: "概览看板",
    description: "查看运行指标总览和维度分析。"
  },
  providers: {
    label: "Providers",
    title: "Provider 管理",
    description: "管理上游 Provider 连接。",
    adminOnly: true
  },
  models: {
    label: "Models & Routing",
    title: "模型与路由",
    description: "管理员维护路由；普通用户查看可用模型。"
  },
  audit: {
    label: "Audit",
    title: "审计日志",
    description: "查看请求审计、Token 和错误摘要。"
  },
  apiKeys: {
    label: "API Keys",
    title: "API Keys",
    description: "管理当前账号自己的 API Keys。"
  },
  users: {
    label: "System & Users",
    title: "系统与用户",
    description: "查看系统状态、审批注册并配置用户权限。",
    adminOnly: true
  }
};

function visibleSections(user: ConsoleUser | null): Section[] {
  const isAdmin = user?.role === "admin";
  return (Object.keys(sectionMeta) as Section[]).filter(
    (section) => isAdmin || !sectionMeta[section].adminOnly
  );
}

function mapVisibleModels(items: VisibleModelItem[]): ModelItem[] {
  return items.map((item) => ({
    id: item.alias,
    alias: item.alias,
    displayName: item.displayName,
    enabled: true,
    bindings: {
      openai: [],
      anthropic: []
    }
  }));
}

export default function App() {
  const [user, setUser] = useState<ConsoleUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState<Section>("dashboard");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [providers, setProviders] = useState<ProviderItem[]>([]);
  const [models, setModels] = useState<ModelItem[]>([]);
  const [visibleModels, setVisibleModels] = useState<VisibleModelItem[]>([]);
  const [users, setUsers] = useState<UserItem[]>([]);
  const [userDrafts, setUserDrafts] = useState<Record<string, UserDraft>>({});

  const [dashboardRange, setDashboardRange] = useState<"day" | "week" | "month">("day");
  const [dashboardDayDate, setDashboardDayDate] = useState<string | null>(null);
  const [dashboardFilters, setDashboardFilters] =
    useState<DashboardFilters>(EMPTY_DASHBOARD_FILTERS);
  const [dashboard, setDashboard] = useState<DashboardSummary | null>(null);

  const [audit, setAudit] = useState<AuditResponse | null>(null);
  const [auditFilters, setAuditFilters] = useState<AuditFilters>({
    providerId: "",
    apiKeyId: "",
    userId: "",
    modelAlias: "",
    statusCategory: "",
    endpointType: "",
    page: 1
  });

  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [apiKeys, setApiKeys] = useState<ApiKeyItem[]>([]);
  const [auditApiKeys, setAuditApiKeys] = useState<ApiKeyItem[]>([]);
  const [newApiKeyName, setNewApiKeyName] = useState("");
  const [createdApiKeyPlaintext, setCreatedApiKeyPlaintext] = useState<string | null>(null);

  const [loginForm, setLoginForm] = useState({
    username: "",
    password: ""
  });
  const [registerForm, setRegisterForm] = useState<RegisterForm>({
    username: "",
    password: "",
    confirmPassword: ""
  });
  const [authMode, setAuthMode] = useState<AuthMode>("login");

  const isAdmin = user?.role === "admin";
  const availableSections = useMemo(() => visibleSections(user), [user]);
  const currentSectionMeta = sectionMeta[section];
  const modelAliasOptions = useMemo(
    () =>
      (isAdmin ? models.map((model) => model.alias) : visibleModels.map((model) => model.alias))
        .sort((left, right) => left.localeCompare(right)),
    [isAdmin, models, visibleModels]
  );

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

  const refreshAdminModels = async () => {
    const response = await api.models.list();
    setModels(response.items);
  };

  const refreshUserModels = async () => {
    const response = await api.me.models();
    setVisibleModels(response.items);
    setModels(mapVisibleModels(response.items));
  };

  const refreshUsers = async () => {
    const response = await api.users.list();
    setUsers(response.items);
    setUserDrafts(buildUserDrafts(response.items));
  };

  const refreshOwnApiKeys = async (targetUser = user) => {
    const response = await api.me.listApiKeys();
    setApiKeys(response.items);
    if (targetUser?.role !== "admin") {
      setAuditApiKeys(response.items);
    }
  };

  const refreshAdminApiKeys = async () => {
    const response = await api.security.listApiKeys(true);
    setAuditApiKeys(response.items);
  };

  const refreshDashboard = async (
    range = dashboardRange,
    dayDate = dashboardDayDate,
    filters = dashboardFilters,
    targetUser = user
  ) => {
    const response = await api.dashboard.get(
      range,
      range === "day" ? (dayDate ?? undefined) : undefined,
      targetUser?.role === "admin" ? filters : EMPTY_DASHBOARD_FILTERS
    );
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
    const response = await api.audit.list(nextFilters);
    setAudit(response);
  };

  const refreshSystem = async () => {
    const response = await api.system.status();
    setSystemStatus(response);
  };

  const refreshAll = async (targetUser = user) => {
    if (!targetUser) {
      return;
    }

    if (targetUser.role === "admin") {
      await Promise.all([
        refreshProviders(),
        refreshAdminModels(),
        refreshUsers(),
        refreshAdminApiKeys(),
        refreshOwnApiKeys(targetUser),
        refreshDashboard(dashboardRange, dashboardDayDate, dashboardFilters, targetUser),
        refreshAudit(1),
        refreshSystem()
      ]);
      return;
    }

    setProviders([]);
    await Promise.all([
      refreshUserModels(),
      refreshOwnApiKeys(targetUser),
      refreshDashboard(dashboardRange, dashboardDayDate, EMPTY_DASHBOARD_FILTERS, targetUser),
      refreshAudit(1, { providerId: "", userId: "" }),
      refreshSystem()
    ]);
  };

  useEffect(() => {
    const bootstrap = async () => {
      try {
        const me = await api.auth.me();
        setUser(me.user);
        await refreshAll(me.user);
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
    if (!availableSections.includes(section)) {
      setSection("dashboard");
    }
  }, [availableSections, section]);

  useEffect(() => {
    if (!user) {
      return;
    }

    void refreshDashboard(dashboardRange, dashboardDayDate, dashboardFilters, user).catch(handleError);
  }, [dashboardRange, user]);

  const handleDashboardDayDateChange = (date: string) => {
    const previousDate = dashboardDayDate;
    setDashboardDayDate(date);
    void refreshDashboard("day", date, dashboardFilters, user).catch((reason) => {
      setDashboardDayDate(previousDate);
      handleError(reason);
    });
  };

  const handleDashboardFilterApply = (nextFilters: DashboardFilters) => {
    const previousFilters = dashboardFilters;
    setDashboardFilters(nextFilters);
    void refreshDashboard(dashboardRange, dashboardDayDate, nextFilters, user).catch((reason) => {
      setDashboardFilters(previousFilters);
      handleError(reason);
    });
  };

  const handleDashboardFilterClear = () => {
    const previousFilters = dashboardFilters;
    setDashboardFilters(EMPTY_DASHBOARD_FILTERS);
    void refreshDashboard(dashboardRange, dashboardDayDate, EMPTY_DASHBOARD_FILTERS, user).catch(
      (reason) => {
        setDashboardFilters(previousFilters);
        handleError(reason);
      }
    );
  };

  const copyApiKey = async (apiKeyId: string) => {
    const response = await api.me.getApiKeyPlaintext(apiKeyId);
    await navigator.clipboard.writeText(response.plaintext);
    handleNotice("API Key 已复制到剪贴板。");
  };

  if (loading) {
    return <main className="shell loading-state">正在加载控制台...</main>;
  }

  if (!user) {
    if (authMode === "register") {
      return (
        <RegisterPage
          error={error}
          registerForm={registerForm}
          setRegisterForm={setRegisterForm}
          onSubmit={(username, password) => {
            void api.auth
              .register(username, password)
              .then(() => {
                setRegisterForm({ username: "", password: "", confirmPassword: "" });
                setAuthMode("login");
                handleNotice("注册已提交，请等待管理员审批。");
              })
              .catch(handleError);
          }}
          onBackToLogin={() => {
            setAuthMode("login");
            setError(null);
            setNotice(null);
          }}
        />
      );
    }

    return (
      <LoginPage
        error={error}
        notice={notice}
        loginForm={loginForm}
        setLoginForm={setLoginForm}
        onSubmit={(event) => {
          event.preventDefault();
          void api.auth
            .login(loginForm.username, loginForm.password)
            .then(async (response) => {
              setUser(response.user);
              await refreshAll(response.user);
              handleNotice("登录成功。");
            })
            .catch(handleError);
        }}
        onRegister={() => {
          setRegisterForm({ username: "", password: "", confirmPassword: "" });
          setAuthMode("register");
          setError(null);
          setNotice(null);
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
            <p className="muted">当前登录：{user.displayName}</p>
          </div>

          <nav className="nav">
            {availableSections.map((value) => (
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
            providers={providers}
            models={models}
            apiKeys={auditApiKeys}
            users={users}
            isAdmin={isAdmin}
            dashboardFilters={dashboardFilters}
            applyDashboardFilters={handleDashboardFilterApply}
            clearDashboardFilters={handleDashboardFilterClear}
            range={dashboardRange}
            setRange={setDashboardRange}
            setDayDate={handleDashboardDayDateChange}
          />
        ) : null}

        {section === "providers" && isAdmin ? (
          <ProvidersPage
            providers={providers}
            models={models}
            refreshProviders={refreshProviders}
            refreshModels={refreshAdminModels}
            refreshApiKeys={refreshAdminApiKeys}
            onNotice={handleNotice}
            onError={handleError}
          />
        ) : null}

        {section === "models" && isAdmin ? (
          <ModelsPage
            models={models}
            providers={providers}
            refreshModels={refreshAdminModels}
            onNotice={handleNotice}
            onError={handleError}
            setError={(message) => setError(message)}
          />
        ) : null}

        {section === "models" && !isAdmin ? (
          <UserModelsPage
            models={visibleModels}
            onRefresh={() => {
              void refreshUserModels()
                .then(() => handleNotice("模型列表已刷新。"))
                .catch(handleError);
            }}
          />
        ) : null}

        {section === "audit" ? (
          <AuditPage
            providers={providers}
            apiKeys={auditApiKeys}
            users={users}
            isAdmin={isAdmin}
            modelAliasOptions={modelAliasOptions}
            audit={audit}
            auditFilters={auditFilters}
            setAuditFilters={setAuditFilters}
            refreshAudit={refreshAudit}
            onError={handleError}
          />
        ) : null}

        {section === "apiKeys" ? (
          <ApiKeysPage
            systemStatus={systemStatus}
            apiKeys={apiKeys}
            newApiKeyName={newApiKeyName}
            setNewApiKeyName={setNewApiKeyName}
            createdApiKeyPlaintext={createdApiKeyPlaintext}
            onCreateApiKey={() => {
              if (!newApiKeyName.trim()) {
                setError("请输入 API Key 名称。");
                return;
              }

              void api.me
                .createApiKey({ name: newApiKeyName.trim() })
                .then(async (response) => {
                  setNewApiKeyName("");
                  setCreatedApiKeyPlaintext(response.createdKeyPlaintext);
                  await Promise.all([refreshOwnApiKeys(user), refreshSystem()]);
                  handleNotice(`API Key ${response.item.name} 已创建。`);
                })
                .catch(handleError);
            }}
            onCopyApiKey={(apiKeyId) => {
              void copyApiKey(apiKeyId).catch(handleError);
            }}
            onToggleApiKeyEnabled={(apiKeyId, enabled) => {
              void api.me
                .updateApiKey(apiKeyId, { enabled })
                .then(async () => {
                  await Promise.all([refreshOwnApiKeys(user), refreshSystem(), refreshAudit(1)]);
                  handleNotice(enabled ? "API Key 已启用。" : "API Key 已停用。");
                })
                .catch(handleError);
            }}
            onDeleteApiKey={(apiKeyId) => {
              void api.me
                .deleteApiKey(apiKeyId)
                .then(async () => {
                  await Promise.all([refreshOwnApiKeys(user), refreshSystem(), refreshAudit(1)]);
                  handleNotice("API Key 已删除。");
                })
                .catch(handleError);
            }}
          />
        ) : null}

        {section === "users" && isAdmin ? (
          <SystemUsersPage
            systemStatus={systemStatus}
            users={users}
            providers={providers}
            models={models}
            userDrafts={userDrafts}
            setUserDrafts={setUserDrafts}
            onApproveUser={(userId, apiKeyPlaintext) => {
              void api.users
                .approve(userId, apiKeyPlaintext)
                .then(async (response) => {
                  await Promise.all([refreshUsers(), refreshAdminApiKeys(), refreshSystem()]);
                  handleNotice(
                    `用户 ${response.item.displayName} 已审批，默认 API Key：${response.apiKey.createdKeyPlaintext}`
                  );
                })
                .catch(handleError);
            }}
            onSaveUser={(userId) => {
              const draft = userDrafts[userId];
              if (!draft) {
                setError("未找到用户配置草稿。");
                return;
              }

              void api.users
                .update(userId, {
                  displayName: draft.displayName,
                  status: draft.status,
                  allowedProviderIds: draft.allowedProviderIds,
                  allowedModelAliasIds: draft.allowedModelAliasIds
                })
                .then(async (response) => {
                  await refreshUsers();
                  handleNotice(`用户 ${response.item.displayName} 已保存。`);
                })
                .catch(handleError);
            }}
          />
        ) : null}
      </section>
    </main>
  );
}
