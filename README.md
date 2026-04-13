# LLM Router Docker / NAS 公网版

一个适合部署在 NAS 或单机 Docker 环境中的自托管 LLM 路由网关：

- 对外提供 OpenAI 兼容接口：`GET /v1/models`、`POST /v1/chat/completions`、`POST /v1/responses`
- 对内提供中文管理台：Provider 管理、模型别名与路由、仪表盘、审计日志、系统与安全
- 使用 SQLite 持久化配置与审计数据，数据目录默认挂载到 `/data`
- 适配反向代理、公网域名、后台会话、IP 白名单、限流、健康检查

## 快速启动

1. 复制环境变量模板。
   `cp .env.example .env`
2. 填写至少以下必填项。
   `CONFIG_ENCRYPTION_KEY`
   `BOOTSTRAP_ADMIN_USERNAME`
   `BOOTSTRAP_ADMIN_PASSWORD`
   `BOOTSTRAP_GATEWAY_API_KEY`
   `EXTERNAL_BASE_URL`
3. 启动服务。
   `docker compose up -d --build`
4. 打开后台。
   `https://your-domain.example.com/admin`

首次启动时，如果数据库为空且缺少 bootstrap 环境变量，服务会直接启动失败，而不是进入不安全状态。

## 本地开发

- 安装依赖：`pnpm install`
- 启动后端：`pnpm dev:server`
- 启动前端：`pnpm dev:web`
- 构建：`pnpm build`
- 测试：`pnpm test`

默认后端监听 `http://localhost:4000`，Vite 开发服务器监听 `http://localhost:5173`，并代理 `/admin/api`、`/v1`、`/health` 到后端。

## 环境变量

核心变量：

- `CONFIG_ENCRYPTION_KEY`: Provider API Key 的加密密钥，必须为足够长的随机字符串
- `BOOTSTRAP_ADMIN_USERNAME`: 首次启动时的管理员用户名
- `BOOTSTRAP_ADMIN_PASSWORD`: 首次启动时的管理员密码
- `BOOTSTRAP_GATEWAY_API_KEY`: 首次启动时的统一网关 Key
- `DATA_DIR`: 数据目录，默认 `/data`
- `TRUST_PROXY`: 是否信任 `X-Forwarded-*` 头，反向代理部署建议设置为 `true`
- `EXTERNAL_BASE_URL`: 推荐的外部访问基地址，例如 `https://llm.example.com`
- `ADMIN_EXTERNAL_BASE_URL`: 可选，单独指定后台外部地址

安全与运行变量：

- `MAX_REQUEST_BODY_SIZE_MB`
- `REQUEST_TIMEOUT_MS`
- `UPSTREAM_TIMEOUT_MS`
- `LOGIN_RATE_LIMIT_WINDOW_MS`
- `LOGIN_RATE_LIMIT_MAX`
- `API_RATE_LIMIT_WINDOW_MS`
- `API_RATE_LIMIT_MAX`
- `MAX_ACTIVE_PROXY_REQUESTS`
- `ADMIN_CIDR_WHITELIST`
- `API_CIDR_WHITELIST`

## 数据目录

挂载目录默认包含：

- `app.db`: SQLite 数据库
- `exports/`: 预留导出目录
- `tmp/`: 临时目录

备份建议：

- 停止容器后直接备份整个数据卷或 `./data` 目录
- 升级前先做卷快照或目录拷贝
- 恢复时使用原数据目录重新启动容器即可

## API 与后台

公网 API：

- `GET /v1/models`
- `POST /v1/chat/completions`
- `POST /v1/responses`

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
- `POST /admin/api/security/gateway-key`
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
- SQLite 持久化与首启 bootstrap
- 管理员登录、会话 Cookie、退出登录
- Provider 新增、编辑、连通性测试
- 模型别名与多 Provider 绑定
- 运行时顺序应用、默认顺序保存、重启后恢复默认顺序
- OpenAI 兼容网关鉴权、模型列表、聊天补全、Responses 转发
- 审计日志、仪表盘统计、网关 Key 轮换
- IP 白名单、基础限流、最大并发控制、代理头识别

## 验证

已通过的本地验证：

- `pnpm build`
- `pnpm test`
- 后端集成测试覆盖 bootstrap、登录、Provider/模型配置、网关转发、默认顺序重启恢复
