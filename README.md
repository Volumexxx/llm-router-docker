# LLM Router Docker / NAS 公网版

一个适合部署在 NAS 或单机 Docker 环境中的自托管 LLM Router。

它提供：

- 对外的 OpenAI / Anthropic 兼容网关：`GET /v1/models`、`POST /v1/chat/completions`、`POST /v1/responses`、`POST /v1/messages`
- 中文管理后台：Provider 管理、模型路由、审计日志、仪表盘、系统与安全
- 单容器 + SQLite 持久化部署方式，数据目录默认挂载到 `/data`
- 反向代理适配、后台会话、IP 白名单、限流、健康检查
- 多 API Key 管理：后台创建、启用/停用、删除，并按 Key 统计审计与仪表盘数据

## 快速启动

1. 复制环境变量模板

   ```bash
   cp .env.example .env
   ```

2. 至少填写以下变量

   - `CONFIG_ENCRYPTION_KEY`
   - `BOOTSTRAP_ADMIN_USERNAME`
   - `BOOTSTRAP_ADMIN_PASSWORD`
   - `EXTERNAL_BASE_URL`

3. 启动服务

   ```bash
   docker compose up -d --build
   ```

4. 打开后台

   - `https://your-domain.example.com/admin`

5. 使用 bootstrap 管理员账号登录后台

6. 在“系统与安全”页面创建第一把 API Key

首次启动时，如果数据库为空且缺少 bootstrap 管理员变量，服务会直接启动失败，而不是进入不安全状态。

## 本地开发

- 安装依赖：`pnpm install`
- 启动后端：`pnpm dev:server`
- 启动前端：`pnpm dev:web`
- 同时启动：`pnpm dev`
- 构建：`pnpm build`
- 测试：`pnpm test`

默认后端监听 `http://localhost:4000`，Vite 开发服务器监听 `http://localhost:5173`，并代理 `/admin/api`、`/v1`、`/health` 到后端。

## 环境变量

核心变量：

- `CONFIG_ENCRYPTION_KEY`
  - 用于加密存储 Provider API Key。
  - 首次启动必须提供，后续重启也必须保留不变，否则无法解密已有 Provider 密钥。
- `BOOTSTRAP_ADMIN_USERNAME`
  - 仅在数据库为空时使用，用于初始化第一个管理员账号。
- `BOOTSTRAP_ADMIN_PASSWORD`
  - 仅在数据库为空时使用，用于初始化第一个管理员密码。
- `DATA_DIR`
  - 数据目录，默认 `/data`。
- `EXTERNAL_BASE_URL`
  - 推荐对外访问地址，例如 `https://llm.example.com`。
- `ADMIN_EXTERNAL_BASE_URL`
  - 可选，单独指定后台对外地址。
- `TRUST_PROXY`
  - 是否信任 `X-Forwarded-*` 头。部署在 Nginx / Caddy / Traefik 后面时通常应设为 `true`。

运行与安全变量：

- `HOST`
- `PORT`
- `TIMEZONE`
- `MAX_REQUEST_BODY_SIZE_MB`
- `REQUEST_TIMEOUT_MS`
- `UPSTREAM_TIMEOUT_MS`
- `PROVIDER_TEST_DEFAULT_TIMEOUT_MS`
- `SESSION_TTL_HOURS`
- `LOGIN_RATE_LIMIT_WINDOW_MS`
- `LOGIN_RATE_LIMIT_MAX`
- `API_RATE_LIMIT_WINDOW_MS`
- `API_RATE_LIMIT_MAX`
- `MAX_ACTIVE_PROXY_REQUESTS`
- `ADMIN_CIDR_WHITELIST`
- `API_CIDR_WHITELIST`

## 初始化说明

- v1 不再依赖 `BOOTSTRAP_GATEWAY_API_KEY`
- 管理员账号仍然通过 bootstrap 环境变量初始化
- 第一把网关 API Key 需要在后台创建
- 网关协议保持不变：仍然使用 `Authorization: Bearer <key>`

## 数据目录

挂载目录默认包含：

- `app.db`
- `exports/`
- `tmp/`

备份建议：

- 停止容器后直接备份整个数据卷或 `./data` 目录
- 升级前先做卷快照或目录拷贝
- 恢复时使用原数据目录重新启动容器即可

## API 与后台

公网 API：

- `GET /v1/models`
- `POST /v1/chat/completions`
- `POST /v1/responses`
- `POST /v1/messages`

Anthropic / Claude 兼容说明：
- `POST /v1/messages` 使用 `x-api-key` + `anthropic-version: 2023-06-01`
- `GET /v1/models` 在带 `anthropic-version` 头时返回 Anthropic 风格列表结构
- Provider 支持 `openai` 与 `anthropic` 两种协议类型
- Anthropic provider 推荐填写 `https://api.anthropic.com`
- 当前不支持 `tools`、`thinking`、beta headers，以及 OpenAI `responses` 到 Anthropic provider 的映射

管理后台：

- `GET /admin`
- `POST /admin/api/auth/login`
- `POST /admin/api/auth/logout`
- `GET /admin/api/auth/me`
- `GET /admin/api/providers`
- `POST /admin/api/providers/:id/test`
- `GET /admin/api/models`
- `GET /admin/api/dashboard`
- `GET /admin/api/audit`
- `GET /admin/api/security/api-keys`
- `POST /admin/api/security/api-keys`
- `PATCH /admin/api/security/api-keys/:id`
- `DELETE /admin/api/security/api-keys/:id`
- `GET /admin/api/system/status`

## 反向代理示例

### Nginx

```nginx
server {
  listen 443 ssl http2;
  server_name llm.example.com;

  location / {
    proxy_pass http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
```

### Caddy

```caddy
llm.example.com {
  reverse_proxy 127.0.0.1:4000 {
    header_up X-Forwarded-Proto https
    header_up X-Forwarded-Host {host}
  }
}
```

### Traefik

```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.llm-router.rule=Host(`llm.example.com`)"
  - "traefik.http.routers.llm-router.entrypoints=websecure"
  - "traefik.http.routers.llm-router.tls=true"
  - "traefik.http.services.llm-router.loadbalancer.server.port=4000"
```

## 已实现能力

- 单容器部署与健康检查
- SQLite 持久化与首次启动初始化
- 管理员登录、持久化会话 Cookie、退出登录
- Provider 新增、编辑、连通性测试
- 模型别名与多 Provider 绑定
- 运行顺序应用、默认顺序保存、重启恢复默认顺序
- OpenAI 兼容网关转发
- Anthropic / Claude 兼容网关与上游 provider 转发
- 多 API Key 管理与按 Key 审计 / 仪表盘统计
- IP 白名单、基础限流、最大并发控制、代理头识别

## 验证

本地已覆盖的基础校验包括：

- `pnpm build`
- `pnpm test`
- 后端集成测试覆盖：
  - 无 API Key 时的配置错误返回
  - API Key 创建、启用/停用、删除
  - 模型列表与聊天补全的 API Key 审计记录
  - 仪表盘 API Key 维度聚合
  - 默认运行顺序的重启恢复
