import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";

import { Drawer } from "../components/Drawer.tsx";
import type { ModelItem, ProviderItem, SystemStatus, UserItem, UserStatus } from "../lib/api.ts";
import { formatDateTime, formatNumber } from "../lib/format.ts";

export type UserDraft = {
  displayName: string;
  status: UserStatus;
  allowedProviderIds: string[];
  allowedModelAliasIds: string[];
};

const USER_STATUS_LABELS: Record<UserStatus, string> = {
  pending: "待审",
  approved: "通过",
  rejected: "拒绝",
  disabled: "停用"
};

interface SystemUsersPageProps {
  systemStatus: SystemStatus | null;
  users: UserItem[];
  providers: ProviderItem[];
  models: ModelItem[];
  userDrafts: Record<string, UserDraft>;
  setUserDrafts: Dispatch<SetStateAction<Record<string, UserDraft>>>;
  onApproveUser: (userId: string, apiKeyPlaintext?: string) => void;
  onSaveUser: (userId: string) => void;
}

function toggleId(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

function selectedCount(selectedIds: string[], items: Array<{ id: string }>): number {
  const validIds = new Set(items.map((item) => item.id));
  return selectedIds.filter((id) => validIds.has(id)).length;
}

function ScopeEditor({
  title,
  items,
  selectedIds,
  onToggle,
  onSelectAll,
  onClear
}: {
  title: string;
  items: Array<{ id: string; label: string }>;
  selectedIds: string[];
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  onClear: () => void;
}) {
  const count = selectedCount(selectedIds, items);
  const allSelected = items.length > 0 && count === items.length;

  return (
    <div className="scope-card">
      <div className="panel-head">
        <h4>{title}</h4>
        <span className="pill">{allSelected ? "全部可用" : `已选 ${count} 项`}</span>
      </div>

      <div className="scope-card-actions">
        <button type="button" className={allSelected ? "chip active" : "chip"} onClick={onSelectAll}>
          全部可用
        </button>
        <button type="button" className="chip" onClick={onClear}>
          清空
        </button>
      </div>

      {items.length === 0 ? (
        <p className="muted">当前还没有可选项目。</p>
      ) : (
        <div className="checkbox-list">
          {items.map((item) => (
            <label key={item.id} className="checkbox-item">
              <input
                type="checkbox"
                checked={selectedIds.includes(item.id)}
                onChange={() => onToggle(item.id)}
              />
              <span>{item.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export function buildUserDrafts(users: UserItem[]): Record<string, UserDraft> {
  return Object.fromEntries(
    users.map((user) => [
      user.id,
      {
        displayName: user.displayName,
        status: user.status,
        allowedProviderIds: user.allowedProviderIds,
        allowedModelAliasIds: user.allowedModelAliasIds
      }
    ])
  );
}

export function SystemUsersPage({
  systemStatus,
  users,
  providers,
  models,
  userDrafts,
  setUserDrafts,
  onApproveUser,
  onSaveUser
}: SystemUsersPageProps) {
  const pendingUsers = users.filter((user) => user.role === "user" && user.status === "pending");
  const [approvalKeyByUserId, setApprovalKeyByUserId] = useState<Record<string, string>>({});
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const selectedUser = users.find((user) => user.id === selectedUserId) ?? null;
  const selectedDraft = selectedUser ? userDrafts[selectedUser.id] : null;

  useEffect(() => {
    if (selectedUserId && !users.some((user) => user.id === selectedUserId)) {
      setSelectedUserId(null);
    }
  }, [selectedUserId, users]);

  const providerOptions = useMemo(
    () => providers.map((provider) => ({ id: provider.id, label: provider.name })),
    [providers]
  );
  const modelOptions = useMemo(
    () => models.map((model) => ({ id: model.id, label: model.alias })),
    [models]
  );

  const patchSelectedDraft = (patch: Partial<UserDraft>) => {
    if (!selectedUser || !selectedDraft) {
      return;
    }

    setUserDrafts((current) => ({
      ...current,
      [selectedUser.id]: {
        ...selectedDraft,
        ...patch
      }
    }));
  };

  return (
    <div className="stack">
      <section className="panel hero-panel">
        <div className="panel-head">
          <div className="stack compact-stack">
            <p className="eyebrow">System & Users</p>
            <h3>系统状态</h3>
          </div>
        </div>

        <div className="metric-grid">
          <article className="stat-card">
            <span>服务状态</span>
            <strong>{systemStatus?.ready ? "Ready" : "Not Ready"}</strong>
          </article>
          <article className="stat-card">
            <span>活跃用户</span>
            <strong>
              {formatNumber(systemStatus?.activeUserCount ?? 0)} /{" "}
              {formatNumber(systemStatus?.totalUserCount ?? 0)}
            </strong>
          </article>
          <article className="stat-card">
            <span>待审批</span>
            <strong>{formatNumber(systemStatus?.pendingUserCount ?? 0)}</strong>
          </article>
          <article className="stat-card">
            <span>最大并发代理</span>
            <strong>{formatNumber(systemStatus?.maxActiveProxyRequests ?? 0)}</strong>
          </article>
        </div>

        <div className="detail-grid">
          <div>
            <span>推荐 API 地址</span>
            <strong>{systemStatus?.recommendedApiBaseUrl ?? "-"}</strong>
          </div>
          <div>
            <span>推荐后台地址</span>
            <strong>{systemStatus?.recommendedAdminUrl ?? "-"}</strong>
          </div>
          <div>
            <span>数据目录</span>
            <strong>{systemStatus?.dataDir ?? "-"}</strong>
          </div>
          <div>
            <span>数据库文件</span>
            <strong>{systemStatus?.dbPath ?? "-"}</strong>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div className="stack compact-stack">
            <h3>注册审批</h3>
            <p className="muted">审批时可手动填入默认 API Key；留空则自动生成。</p>
          </div>
          <span className="pill">{pendingUsers.length} 个待审批</span>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>用户名</th>
                <th>注册时间</th>
                <th>默认 Key</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {pendingUsers.length === 0 ? (
                <tr>
                  <td colSpan={4}>
                    <div className="table-empty">暂无待审批注册。</div>
                  </td>
                </tr>
              ) : (
                pendingUsers.map((user) => (
                  <tr key={user.id}>
                    <td>{user.username}</td>
                    <td>{formatDateTime(user.createdAt)}</td>
                    <td>
                      <input
                        value={approvalKeyByUserId[user.id] ?? ""}
                        onChange={(event) =>
                          setApprovalKeyByUserId((current) => ({
                            ...current,
                            [user.id]: event.target.value
                          }))
                        }
                        placeholder="留空自动生成"
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="primary"
                        onClick={() => onApproveUser(user.id, approvalKeyByUserId[user.id]?.trim() || undefined)}
                      >
                        审批通过
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div className="stack compact-stack">
            <h3>用户列表</h3>
            <p className="muted">点击配置后在右侧抽屉维护展示名称、状态和可用范围。</p>
          </div>
          <span className="pill">{users.length} 个账号</span>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>用户名</th>
                <th>展示名称</th>
                <th>角色</th>
                <th>状态</th>
                <th>API Keys</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>{user.username}</td>
                  <td>{user.displayName}</td>
                  <td>{user.role}</td>
                  <td>{USER_STATUS_LABELS[user.status]}</td>
                  <td>
                    {formatNumber(user.activeApiKeyCount)} / {formatNumber(user.totalApiKeyCount)}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setSelectedUserId(user.id)}
                    >
                      配置
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <Drawer
        open={Boolean(selectedUser && selectedDraft)}
        size="wide"
        title={selectedUser ? `用户配置 · ${selectedUser.username}` : ""}
        subtitle="配置展示名称、账号状态，以及该用户可使用的 Provider 和 Model。"
        onClose={() => setSelectedUserId(null)}
      >
        {selectedUser && selectedDraft ? (
          <div className="stack">
            <section className="panel panel-elevated">
              <div className="panel-head">
                <div className="stack compact-stack">
                  <h4>基本信息</h4>
                  <p className="muted">展示名称默认使用注册用户名，状态会影响控制台登录和网关鉴权。</p>
                </div>
                <span className="pill">{selectedUser.role}</span>
              </div>

              <div className="form-grid">
                <label>
                  <span>展示名称</span>
                  <input
                    value={selectedDraft.displayName}
                    onChange={(event) => patchSelectedDraft({ displayName: event.target.value })}
                  />
                </label>
                <label>
                  <span>状态</span>
                  <select
                    value={selectedDraft.status}
                    onChange={(event) => patchSelectedDraft({ status: event.target.value as UserStatus })}
                  >
                    <option value="pending">{USER_STATUS_LABELS.pending}</option>
                    <option value="approved">{USER_STATUS_LABELS.approved}</option>
                    <option value="rejected">{USER_STATUS_LABELS.rejected}</option>
                    <option value="disabled">{USER_STATUS_LABELS.disabled}</option>
                  </select>
                </label>
              </div>
            </section>

            <section className="panel panel-elevated">
              <div className="panel-head">
                <div className="stack compact-stack">
                  <h4>可用范围</h4>
                  <p className="muted">只允许勾选的 Provider 与 Model 参与路由。</p>
                </div>
              </div>

              <div className="scope-grid">
                <ScopeEditor
                  title="Allowed Providers"
                  items={providerOptions}
                  selectedIds={selectedDraft.allowedProviderIds}
                  onToggle={(providerId) =>
                    patchSelectedDraft({
                      allowedProviderIds: toggleId(selectedDraft.allowedProviderIds, providerId)
                    })
                  }
                  onSelectAll={() =>
                    patchSelectedDraft({
                      allowedProviderIds: providerOptions.map((provider) => provider.id)
                    })
                  }
                  onClear={() => patchSelectedDraft({ allowedProviderIds: [] })}
                />

                <ScopeEditor
                  title="Allowed Models"
                  items={modelOptions}
                  selectedIds={selectedDraft.allowedModelAliasIds}
                  onToggle={(modelId) =>
                    patchSelectedDraft({
                      allowedModelAliasIds: toggleId(selectedDraft.allowedModelAliasIds, modelId)
                    })
                  }
                  onSelectAll={() =>
                    patchSelectedDraft({
                      allowedModelAliasIds: modelOptions.map((model) => model.id)
                    })
                  }
                  onClear={() => patchSelectedDraft({ allowedModelAliasIds: [] })}
                />
              </div>

              <div className="toolbar">
                <button type="button" className="primary" onClick={() => onSaveUser(selectedUser.id)}>
                  保存用户配置
                </button>
              </div>
            </section>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
