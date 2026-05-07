# Plugin Marketplace 部署指南

把 `backend/plugin-marketplace-service/` 接到生产 `plugins.chainlesschain.com` 的步骤。
DNS 已经指向 47.111.5.128，下面只剩服务器侧操作。

## 架构小结

| 组件 | 位置 | 端口 | 备注 |
|------|------|------|------|
| Spring 服务 | 容器 `chainlesschain-plugin-marketplace` | 8090 | context-path `/api` |
| MinIO（对象存储） | 容器 `chainlesschain-marketplace-minio` | 9000 / 9011 | 9000=S3 API，9011=控制台（9001 被 signaling-server 占用） |
| 数据库 | 复用根 `chainlesschain-postgres` | 5432 | 独立库 `plugin_marketplace`，用户 `chainlesschain` |
| 缓存 | 复用根 `chainlesschain-redis` | 6379 | database=2（避开 project-service 的 0） |
| DB 初始化 | `marketplace-db-init` 一次性容器 | — | 幂等，跑 `schema.sql` |
| Nginx 反代 | 宝塔面板自动管理 | 443 | `plugins.chainlesschain.com` → `127.0.0.1:8090`，证书 BT Panel Let's Encrypt 自动续签 |

桌面端 `marketplace-api.js:17-20` 已经默认指向 `https://plugins.chainlesschain.com/api`，不用改客户端。

## 前置（在服务器 47.111.5.128 上）

1. 项目已 clone 到 `/opt/chainlesschain`（或别的固定路径），后续假设这个位置。
2. 已装 Docker + docker compose。
3. 已装宝塔面板（nginx 由 BT Panel 管理，不需要单独装 certbot）。

## Step 1：在 `.env` 加 3 个变量

`/opt/chainlesschain/.env` 追加：

```bash
# Plugin Marketplace
MARKETPLACE_MINIO_ACCESS_KEY=<生成 16+ 字符随机串>
MARKETPLACE_MINIO_SECRET_KEY=<生成 32+ 字符随机串>
PLUGIN_MARKETPLACE_JWT_SECRET=<生成 32+ 字符随机串，至少 256 bits>
```

生成命令参考：`openssl rand -hex 32`。

**这一步不能跳**，默认值是开发占位符，生产用会有安全问题。

## Step 2：拉代码 + 构建 + 启动容器

```bash
cd /opt/chainlesschain
git pull
docker compose build plugin-marketplace-service
docker compose up -d marketplace-minio plugin-marketplace-service
```

启动顺序由 `depends_on` 自动编排：
1. `postgres` 已健康（已在跑）
2. `marketplace-db-init` 跑一次 schema 初始化（30 秒内完成，状态变 exited 0）
3. `marketplace-minio` 健康
4. `plugin-marketplace-service` 启动（Spring 冷启动 ~60-90s）

## Step 3：本机 smoke

```bash
# 健康检查（容器网络）
curl -fsS http://127.0.0.1:8090/api/actuator/health

# 列插件（schema.sql 自带 2 条 sample 数据）
curl -fsS http://127.0.0.1:8090/api/plugins | jq .

# MinIO 控制台
# 浏览器开 http://47.111.5.128:9011
# 用户名/密码 = MARKETPLACE_MINIO_ACCESS_KEY / SECRET_KEY
```

如果 `/api/plugins` 返回的是 schema.sql 的 translator/code-formatter 两条 hardcoded sample 数据，**记得清掉**（它们引用的 `https://plugins.chainlesschain.com/files/*.zip` 文件不存在）：

```bash
docker exec chainlesschain-postgres psql -U chainlesschain -d plugin_marketplace \
  -c "DELETE FROM plugins WHERE plugin_id IN ('translator','code-formatter');"
```

## Step 4：宝塔面板配置反代 + 申请 SSL

> **不要用 `deploy/nginx/chainlesschain.conf`** —— 那是 BT Panel 之外的纯 nginx 部署的参考文件，宝塔走自己的 vhost 目录（`/www/server/panel/vhost/nginx/*.conf`），手改会被覆盖。
> 走宝塔面板 UI 全程点点点。

### 4.1 添加网站

宝塔面板 → **网站** → **添加站点**：

| 字段 | 值 |
|------|-----|
| 域名 | `plugins.chainlesschain.com` |
| 备注 | ChainlessChain 插件市场 |
| 根目录 | （默认 `/www/wwwroot/plugins.chainlesschain.com`，不会真用到，反代会绕过） |
| FTP / 数据库 | 不创建 |
| PHP 版本 | **纯静态** |

提交。

### 4.2 配置反向代理

点新建好的站点名 → 左侧菜单 **反向代理** → **添加反向代理**：

| 字段 | 值 |
|------|-----|
| 代理名称 | `plugin-marketplace` |
| 目标 URL | `http://127.0.0.1:8090` |
| 发送域名 | `$host` |
| 内容替换 | （空） |

保存。

打开 **配置文件** 看一眼，宝塔自动写出来的 location 块差不多是：

```nginx
location ^~ / {
    proxy_pass http://127.0.0.1:8090;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header REMOTE-HOST $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;
    ...
}
```

把 `client_max_body_size` 调到 `100M`（插件 .zip 上限 50MB，留余量）；如果配置文件里没有，在 `server { }` 块开头加：

```nginx
client_max_body_size 100M;
proxy_read_timeout 60s;
proxy_connect_timeout 60s;
```

保存重载。

### 4.3 申请 Let's Encrypt 证书

站点设置 → **SSL** → **Let's Encrypt** 标签：

1. 勾选域名 `plugins.chainlesschain.com`（确保 DNS 已经指向 47.111.5.128，宝塔会做 HTTP-01 验证）
2. 点 **申请**
3. 几秒到 ~30 秒，证书签好后宝塔自动写入 `/www/server/panel/vhost/cert/plugins.chainlesschain.com/`
4. 顶部开关打开 **强制 HTTPS**

证书 90 天到期，宝塔默认自动续签（**面板设置 → 计划任务 → SSL 续签** 那条任务）。

### 4.4 BT 反代 + Spring `/api` 路径核对

宝塔反代是 `location ^~ /` 整站透传，所以：

- 外部 `https://plugins.chainlesschain.com/api/plugins`
- → 宝塔 nginx 转给 `http://127.0.0.1:8090/api/plugins`
- → Spring 服务（context-path `/api`）匹配 `PluginController @RequestMapping("/plugins")`

路径不需要 rewrite，Spring 这边的 `/api` 前缀正好和外部 URL 对齐。✓

## Step 5：外网验证

```bash
# 从你本地（或任何外网机器）
curl -fsS https://plugins.chainlesschain.com/health
curl -fsS https://plugins.chainlesschain.com/api/plugins | jq .
```

桌面端不用任何配置改动，下次启动 `PluginMarketplacePage` 自动走这条线。

## 回滚

如果出问题：

```bash
# 停服务但保留数据
docker compose stop plugin-marketplace-service marketplace-minio

# 完全卸载（数据保留在 ./data/marketplace-minio + plugin_marketplace 库里）
docker compose rm -f plugin-marketplace-service marketplace-minio marketplace-db-init

# 删库（不可恢复）
docker exec chainlesschain-postgres psql -U chainlesschain -d postgres \
  -c "DROP DATABASE plugin_marketplace;"

# nginx 回滚（BT Panel）：站点 → plugins.chainlesschain.com → 删除站点（会一并删反代和 SSL）
```

## 已知遗留 / 待办

- `backend/plugin-marketplace-service/docker-compose.yml` 是旧的独立栈（Postgres+Redis+MinIO+Prometheus+Grafana+ES+Kibana 一锅端）。**已被根 `docker-compose.yml` 取代**，但文件留着没删，避免破坏文档/CI 引用。新部署不要用它，会和根 compose 撞 5432/6379/9090 端口。
- `application-prod.yml` 里 `jpa.hibernate.ddl-auto=validate` —— 后面如果改 entity，要手写 migration（推荐加 Flyway，参考 project-service）。
- 默认 redis password (`chainlesschain_redis_2024`) 和 postgres password (`chainlesschain_pwd_2024`) 都是 hardcoded，整个 ChainlessChain 部署链都用同一对，不算这次问题，但生产建议统一替换。
