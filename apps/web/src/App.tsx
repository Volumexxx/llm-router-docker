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

type ApiKeyDraft = {
  name: string;
  enabled: boolean;
  allowedProviderIds: string[];
  allowedModelAliasIds: string[];
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

const defaultApiKeyDraft: ApiKeyDraft = {
  name: "",
  enabled: true,
  allowedProviderIds: [],
  allowedModelAliasIds: []
};

function buildApiKeyDrafts(items: ApiKeyItem[]): Record<string, ApiKeyDraft> {
  return Object.fromEntries(
    items.map((item) => [
      item.id,
      {
        name: item.name,
        enabled: item.enabled,
        allowedProviderIds: item.allowedProviderIds,
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
  const [apiKeyDrafts, setApiKeyDrafts] = useState<Record<string, ApiKeyDraft>>({});
  const [newApiKeyDraft, setNewApiKeyDraft] = useState<ApiKeyDraft>(defaultApiKeyDraft);
  const [createdApiKeyPlaintext, setCreatedApiKeyPlaintext] = useState<string | null>(null);

  const [loginForm, setLoginForm] = useState({
    username: "",
    password: ""
  });

  const modelAliasOptions = useMemo(
    () => models.map((model) => model.alias).sort((left, right) => left.localeCompare(right)),
    [models]
  );

  const handleError = (reason: unknown) => {
    setError(reason instanceof Error ? reason.message : "Operation failed");
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
    return <main className="shell loading-state">Loading admin console...</main>;
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
              handleNotice("Signed in successfully");
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
          <h1>Public Router Console</h1>
          <p className="muted">Admin: {user.username}</p>
        </div>

        <nav className="nav">
          {[
            ["dashboard", "Dashboard"],
            ["providers", "Providers"],
            ["models", "Models & Routing"],
            ["audit", "Audit"],
            ["system", "System & API Keys"]
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
                handleNotice("Signed out");
              })
              .catch(handleError);
          }}
        >
          Sign Out
        </button>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">Runtime</p>
            <h2>
              {section === "dashboard"
                ? "Operations Dashboard"
                : section === "providers"
                  ? "Provider Management"
                  : section === "models"
                    ? "Model Routing"
                    : section === "audit"
                      ? "Audit Search"
                      : "System Status & API Keys"}
            </h2>
          </div>

          <button
            type="button"
            className="secondary"
            onClick={() => {
              void refreshAll()
                .then(() => handleNotice("Data refreshed"))
                .catch(handleError);
            }}
          >
            Refresh Now
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
            providers={providers}
            models={models}
            apiKeys={apiKeys}
            apiKeyDrafts={apiKeyDrafts}
            setApiKeyDrafts={setApiKeyDrafts}
            newApiKeyDraft={newApiKeyDraft}
            setNewApiKeyDraft={setNewApiKeyDraft}
            createdApiKeyPlaintext={createdApiKeyPlaintext}
            onCreateApiKey={() => {
              if (!newApiKeyDraft.name.trim()) {
                setError("Please enter an API key name");
                return;
              }

              void api.security
                .createApiKey({
                  name: newApiKeyDraft.name.trim(),
                  allowedProviderIds: newApiKeyDraft.allowedProviderIds,
                  allowedModelAliasIds: newApiKeyDraft.allowedModelAliasIds
                })
                .then(async (response) => {
                  setNewApiKeyDraft(defaultApiKeyDraft);
                  setCreatedApiKeyPlaintext(response.createdKeyPlaintext);
                  await Promise.all([refreshApiKeys(), refreshSystem()]);
                  handleNotice(`API key ${response.item.name} created`);
                })
                .catch(handleError);
            }}
            onSaveApiKey={(apiKeyId) => {
              const draft = apiKeyDrafts[apiKeyId];
              if (!draft) {
                setError("No pending API key changes found");
                return;
              }

              void api.security
                .updateApiKey(apiKeyId, draft)
                .then(async (response) => {
                  await Promise.all([refreshApiKeys(), refreshSystem()]);
                  handleNotice(`API key ${response.item.name} updated`);
                })
                .catch(handleError);
            }}
            onDeleteApiKey={(apiKeyId) => {
              const current = apiKeys.find((item) => item.id === apiKeyId);
              if (!current) {
                setError("API key not found");
                return;
              }

              if (
                !window.confirm(
                  `Delete API key "${current.name}" now? It will stop working immediately.`
                )
              ) {
                return;
              }

              void api.security
                .deleteApiKey(apiKeyId)
                .then(async () => {
                  await Promise.all([refreshApiKeys(), refreshSystem(), refreshAudit(1)]);
                  handleNotice(`API key ${current.name} deleted`);
                })
                .catch(handleError);
            }}
          />
        ) : null}
      </section>
    </main>
  );
}
