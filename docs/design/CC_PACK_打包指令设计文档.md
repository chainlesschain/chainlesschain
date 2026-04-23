# `cc pack` — 项目一键打包为可执行文件 设计文档

> 版本：v0.1 (Draft)
> 日期：2026-04-23
> 作者：longfa
> 状态：草案，待实施
> 关联版本：ChainlessChain v5.0.2.49 / CLI 0.156.6

---

## 1. 概述

`cc pack` 是为 ChainlessChain CLI 新增的一条指令，用于把**当前项目环境**一键打包为**单文件可执行程序**，供最终用户无依赖分发使用。产物启动后自动拉起内嵌的 **Web UI（完整 Vue 面板）** 与 **WebSocket 接口**，用户双击即可在浏览器中使用 ChainlessChain 的全部在线能力。

本设计文档覆盖：需求锁定、命令接口、产物结构、启动行为、技术选型、构建流水线、安全模型、测试策略、分阶段交付与风险清单。

---

## 2. 目标与非目标

### 2.1 目标

- **零依赖分发**：产物是单个 `.exe`，拷贝到无 Node / npm / Docker 的新机器仍可运行
- **Web UI 等价**：产物内置的 Web UI 功能与当前 `cc ui` 模式下的完整 Vue 面板**一比一对齐**
- **WS 接口完整**：WebSocket 能力包含 session / chat / agent / execute 等全部在线通道
- **会话持久化**：数据库、配置、会话历史、缓存持久化到本地便携目录
- **可重复构建**：同一 commit 构建出的产物可复现（manifest 含版本与构建时间）

### 2.2 非目标（首发不做）

- 不内嵌 Ollama / Qdrant 等重型服务（体积 + 许可原因）
- 不支持桌面原生窗口（Electron）—— 走浏览器就是用户交互界面
- 不支持自动增量升级（P3 再做）
- 首发不支持 macOS / Linux（P1 再做）
- 不把 U-Key / SIMKey 硬件依赖打进去（硬件驱动由用户独立安装）

---

## 3. 设计决策锁定

| # | 决策 | 原因 |
|---|---|---|
| 1 | **完全独立运行**（含 DB + 配置模板） | 用户首次双击即可用，不需要先跑 `cc init` |
| 2 | **Windows x64 首发** | 目标用户 80% 以上是 Windows；跨平台延后 |
| 3 | **打包 `cc chat` + `cc agent`** | Web UI 的主要功能就是聊天与 Agent，不能阉割 |
| 4 | **命令名：`cc pack`** | 简短、语义清晰；别名 `cc bundle` 可保留 |
| 5 | **Web UI = 完整 Vue 面板** | 极简 HTML 模式仅保留给 `cc ui --minimal`；pack 强制 full |

---

## 4. 用户使用流程

### 4.1 开发者视角（打包方）

```bash
# 在项目根目录
cd C:\code\chainlesschain
cc pack

# 产物输出
# dist/chainlesschain-portable-v5.0.2.49-win-x64.exe (~80 MB)
```

可选：

```bash
# 指定输出路径 + 预置 LLM 配置
cc pack -o ./dist/custom.exe --preset-config ./ship-config.json

# Dry-run 只看会打包什么
cc pack --dry-run

# 启用签名（P2）
cc pack --sign cert.pfx --sign-password env:SIGN_PASS
```

### 4.2 最终用户视角（使用方）

```
1. 下载 chainlesschain-portable-win-x64.exe
2. 双击启动
   ┌────────────────────────────────────────────┐
   │ ChainlessChain Portable v5.0.2.49          │
   │                                            │
   │ [首次启动] 请设置数据库密码：***********   │
   │ [首次启动] 数据目录已初始化：              │
   │   %APPDATA%\chainlesschain-portable\...    │
   │                                            │
   │ Web UI : http://127.0.0.1:18810/?token=... │
   │ WS API : ws://127.0.0.1:18800              │
   │                                            │
   │ 按 Ctrl+C 退出                             │
   └────────────────────────────────────────────┘
3. 浏览器自动打开 Web UI
4. 配置 LLM API Key → 开始使用
5. 关闭窗口 = 退出服务；下次双击数据还在
```

---

## 5. 命令接口

### 5.1 命令签名

```
cc pack [options]
```

### 5.2 参数清单

| 参数 | 默认值 | 说明 |
|---|---|---|
| `-o, --output <path>` | `./dist/chainlesschain-portable-<ver>-<os>-<arch>` | 输出路径，无扩展名由 pkg 自动加 |
| `-t, --targets <list>` | 当前平台（P0：`node20-win-x64`） | 逗号分隔多目标 |
| `--ws-port <n>` | `18800` | 内嵌 WS 默认端口（运行时可被用户改） |
| `--ui-port <n>` | `18810` | 内嵌 Web UI 默认端口 |
| `--token <str\|auto>` | `auto` | 访问令牌；`auto` 首次启动生成并打印 |
| `--preset-config <path>` | - | 打包时预置的 config.json（会脱敏扫描） |
| `--include-db` | `true` | 是否内嵌 DB 初始模板 |
| `--include-models` | `false` | 是否内嵌本地小模型（体积爆炸警告） |
| `--compress` | `true` | pkg GZip 压缩 |
| `--sign <cert>` | - | Windows 代码签名证书路径（P2） |
| `--sign-password <pass>` | - | 签名密码，支持 `env:VAR_NAME` |
| `--smoke-test` | `true` | 打包后自动启动产物做冒烟测试 |
| `--dry-run` | `false` | 只输出打包清单不构建 |
| `--allow-remote` | `false` | 产物运行时默认绑定 `0.0.0.0`（危险） |
| `--bind-host <host>` | `127.0.0.1` | 产物默认绑定地址，可运行时覆盖 |
| `--access-policy <path>` | - | 预置访问策略文件（见 §14.6） |
| `--enable-tls` | `false` | 启用 WSS/HTTPS（需提供证书） |
| `--tls-cert <path>` | - | TLS 证书路径（PEM） |
| `--tls-key <path>` | - | TLS 私钥路径（PEM） |
| `--open` | `true` | 产物启动后自动打开浏览器 |
| `--skip-web-panel-build` | `false` | 假设 `web-panel/dist/` 已最新，跳过重建 |

### 5.3 退出码

| 码 | 含义 |
|---|---|
| 0 | 成功 |
| 1 | 通用失败 |
| 10 | 前置检查失败（非项目根目录、node_modules 缺失等） |
| 11 | web-panel 构建失败 |
| 12 | 原生模块 prebuild 缺失 |
| 13 | pkg 构建失败 |
| 14 | 冒烟测试失败 |
| 15 | 签名失败 |
| 16 | 预置配置含敏感凭据被拒绝 |

---

## 6. 产物结构

### 6.1 可执行文件内部（pkg 虚拟 FS）

```
chainlesschain-portable-win-x64.exe
├── bin/
│   └── cli.js                         # 入口（沿用 bin/chainlesschain.js）
├── src/                               # CLI 源码（去除 dev-only）
│   ├── commands/                      # 109 个命令
│   ├── gateways/ws/                   # WS 服务器
│   ├── lib/                           # 核心库
│   │   ├── web-ui-server.js           # 增强为支持 full 模式
│   │   └── packer/                    # (不包含自身，运行时不用)
│   └── index.js
├── assets/
│   ├── web-panel/dist/                # ★ 完整 Vue 面板 build 产物
│   │   ├── index.html
│   │   ├── assets/*.js
│   │   ├── assets/*.css
│   │   └── assets/*.woff2
│   └── web-ui/                        # 极简 HTML 兜底（保留但不用）
├── templates/
│   └── dot-chainlesschain/            # 初始化模板
│       ├── config.example.json        # 已脱敏
│       ├── db/schema.sql              # SQLCipher 初始化脚本
│       └── README.md                  # 目录说明
├── prebuilds/
│   └── win32-x64/
│       ├── better-sqlite3.node
│       └── better-sqlite3-multiple-ciphers.node  # 可选
├── node_modules/                      # 纯 JS 依赖（pkg 自动）
└── pack-manifest.json                 # 构建元数据
```

### 6.2 运行时落盘目录

```
%APPDATA%\chainlesschain-portable\<project-id>\
├── config.json                        # 用户配置（首启从模板复制）
├── db/
│   └── chainlesschain.db              # SQLCipher 加密数据库
├── memory/
│   └── sessions/                      # 会话历史
├── cache/
│   └── embeddings/                    # 向量缓存
├── logs/
│   └── app.log                        # Rolling 日志
├── state/
│   └── portable.pid                   # 单实例锁
└── .version                           # 当前数据层版本，用于升级判断
```

`<project-id>` 规则：

- 若打包时 `--preset-config` 指定了项目名，用该名
- 否则用打包时项目根目录的 `package.json.name`
- 再否则用哈希前缀：`default-<sha1(exe-path)[:8]>`

### 6.3 `pack-manifest.json` 结构

```json
{
  "schema": 1,
  "productVersion": "v5.0.2.49",
  "cliVersion": "0.156.6",
  "buildTime": "2026-04-23T10:30:00Z",
  "gitCommit": "2630582aa",
  "gitDirty": false,
  "buildHost": "win32",
  "nodeVersion": "v20.17.0",
  "pkgVersion": "@yao-pkg/pkg@5.x",
  "targets": ["node20-win-x64"],
  "ports": { "ws": 18800, "ui": 18810 },
  "includeDb": true,
  "includeModels": false,
  "commands": ["init", "chat", "agent", "..."],
  "sha256": "<self-hash-placeholder>",
  "signed": false
}
```

---

## 7. 启动行为

### 7.1 首次启动流程

```
用户双击 .exe
   ↓
[1] 解析 pkg 内嵌 assets，定位入口
[2] 检测 %APPDATA%\chainlesschain-portable\<project-id>\ 是否存在
    否 → 进入首启引导
    是 → 进入常态启动
[3] 首启引导：
    - 释放 templates/ 到数据目录
    - 初始化 DB（首次不加密）
    - 提示用户设置数据库密码（或读 --db-password / 环境变量）
    - 用户密码通过 SQLCipher 重新加密 DB
    - 落盘 .version 文件
[4] 常态启动：
    - 单实例锁检查（state/portable.pid + 端口探测）
    - 释放 prebuilds/<platform>/*.node 到临时目录
    - require 原生模块
    - 启动 WS server @ ws-port
    - 启动 Web UI server @ ui-port (full 模式)
    - 终端打印状态表
    - 按 --open 决定是否 child_process.exec('start <url>')
    - 挂 Ctrl+C 信号，优雅关闭
```

### 7.2 终端输出示例

```
╔══════════════════════════════════════════════════════╗
║  ChainlessChain Portable                             ║
║  Product: v5.0.2.49  |  Build: 2630582aa             ║
╚══════════════════════════════════════════════════════╝

  Data   : C:\Users\xxx\AppData\Roaming\chainlesschain-portable\demo
  Bind   : 127.0.0.1  (local only)
  Web UI : http://127.0.0.1:18810/?token=a1b2c3d4...
  WS API : ws://127.0.0.1:18800
  TLS    : disabled
  Tokens : 1 (owner)
  Log    : ...\logs\app.log

  [OK] Database connected (encrypted)
  [OK] WS server listening (10 handlers registered)
  [OK] Web UI ready (full panel, 45 assets)
  [OK] Browser opened

  Press Ctrl+C to stop.
```

**开启远程访问时的输出对比**：

```
  Bind   : 0.0.0.0   ⚠ REMOTE ACCESS ENABLED
  Web UI : https://192.168.1.5:18810/?token=***
  WS API : wss://192.168.1.5:18800
  TLS    : enabled (cert: ./cert.pem, expires 2027-01-01)
  Tokens : 3 (1 owner, 1 admin, 1 guest)
  Allow  : 192.168.1.0/24

  ⚠ Exposed to LAN. Anyone on allowed CIDRs can connect.
  ⚠ Run with TLS and strong tokens. Do not expose to public internet
    without a reverse proxy and firewall rules.
```

### 7.3 CLI 透传模式

产物也支持直接在终端跑命令（不起服务）：

```bash
chainlesschain-portable.exe --cli status
chainlesschain-portable.exe --cli note list
chainlesschain-portable.exe --cli doctor
```

`--cli <cmd>` 模式下不启动 WS / Web UI，只运行一次性命令并退出。

---

## 8. 技术选型

### 8.1 打包器

- **首选**：`@yao-pkg/pkg`（社区维护的 vercel/pkg fork，支持 Node 20/22）
- **备选**：Node 原生 **SEA**（Single Executable Applications，Node 20+）
  - 长期方向，但当前资产嵌入能力弱、缺 `__dirname` 适配，P3 再切
- **不选**：`nexe`（启动慢、更新慢）、`bun build --compile`（引入 Bun 依赖）

### 8.2 关键依赖

| 用途 | 库 | 版本 |
|---|---|---|
| 打包器 | `@yao-pkg/pkg` | `^5.x`（devDep） |
| WS | `ws` | `^8.14.2`（已有） |
| HTTP | Node 内置 `http` | - |
| 加密 DB | `better-sqlite3-multiple-ciphers` | 已有，optional |
| 签名 | `@digitalbazaar/signtool` 或直接调用 `signtool.exe` | 外部工具 |
| 文件锁 | `proper-lockfile` | `^4.x` |
| 端口探测 | `net` + `get-port` | 已有 |

### 8.3 目标运行时

- Node 20.x（与 pkg 预编译 runtime 对齐）
- Windows 10 1809+ / Windows Server 2019+
- 架构：x64（P0），arm64（P1）

---

## 9. 构建流水线

`cc pack` 内部执行顺序：

```
┌─────────────────────────────────────────────────────┐
│ Phase 1: 前置检查                                   │
│  - 当前目录是 ChainlessChain 项目根                 │
│  - node_modules 完整                                │
│  - git 工作区干净（--allow-dirty 可跳过）           │
│  - 目标平台 prebuilds 存在                          │
└─────────────────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────────────────┐
│ Phase 2: Web Panel 构建                             │
│  - 检查 packages/cli/src/assets/web-panel/dist/     │
│  - 若缺失或早于源码：npm run build:web-panel        │
│  - 校验 index.html + 至少 5 个 assets               │
└─────────────────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────────────────┐
│ Phase 3: 配置模板生成                               │
│  - 从 .chainlesschain/config.example.json 拷到临时  │
│  - 若指定 --preset-config：                         │
│     · 扫描 apiKey / privateKey / mnemonic 字段      │
│     · 发现敏感字段 → 错误退出（除非 --allow-secrets)│
│     · 合并到模板                                    │
└─────────────────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────────────────┐
│ Phase 4: 原生模块抽取                               │
│  - 遍历 --targets                                   │
│  - 从 node_modules/better-sqlite3/build/Release/    │
│    抽 .node，落到 build-temp/prebuilds/<target>/    │
│  - 缺失 target：报错，给出修复命令                  │
└─────────────────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────────────────┐
│ Phase 5: pkg.config.json 生成                       │
│  - 生成临时 pkg 配置，指向：                        │
│     · assets: web-panel/dist, prebuilds, templates  │
│     · scripts: src/**/*.js（带 glob 排除测试）      │
│     · targets: [...]                                │
│  - 注入环境变量 CC_PACK_MODE=1（供 ws-server 判断）│
└─────────────────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────────────────┐
│ Phase 6: pkg 调用                                   │
│  - spawn('pkg', ['.', ...args])                     │
│  - stream stdout 到控制台，显示进度                 │
│  - pkg 失败 → 错误分类 → 友好提示                   │
└─────────────────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────────────────┐
│ Phase 7: 后处理                                     │
│  - 计算产物 SHA256                                  │
│  - 写 pack-manifest.json（同目录 sidecar）          │
│  - 若有 --sign：调用 signtool.exe                   │
└─────────────────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────────────────┐
│ Phase 8: 冒烟测试（--smoke-test）                   │
│  - spawn 产物，临时端口（18900/18901）              │
│  - 15s 内必须：                                     │
│     · GET /healthz → 200                            │
│     · WS handshake 成功                             │
│     · WS send {op:'ping'} → {op:'pong'}             │
│     · 创建一条 note → 能读回                        │
│  - 关闭产物                                         │
└─────────────────────────────────────────────────────┘
           ↓
       [ 成功 ]
    产物路径 + SHA256 打印
```

---

## 10. Web UI 完整性保证

### 10.1 现状盘点

| 资产 | 路径 | 打包状态 |
|---|---|---|
| 极简 HTML | `src/lib/web-ui-server.js` `buildHtml()` | 已存在，pack 模式 **不使用** |
| Vue 完整面板源码 | `src/web-panel/` (或类似) | 需 `build:web-panel` 构建 |
| Vue 构建产物 | `src/assets/web-panel/dist/` | **pack 必须包含** |

### 10.2 `web-ui-server.js` 增强

引入 `mode` 参数：

- `mode: 'minimal'`（当前默认）：走 `buildHtml()` 内嵌 HTML
- `mode: 'full'`（pack 模式强制）：从 `assets/web-panel/dist/` 读静态资源

`cc pack` 打包时在入口 `bin/cli.js` 里通过环境变量或配置文件指示 `mode: 'full'`。

### 10.3 功能对齐检查清单（P0 验收必看）

Web UI 在 pack 产物中必须支持的功能（与浏览器访问 `cc ui` 时一致）：

- [ ] 登录与 Token 鉴权
- [ ] 聊天（单轮 + 多轮 + 流式）
- [ ] Agent 模式（任务规划 + 执行）
- [ ] 知识库查询（BM25 + 向量，向量依赖外部 Qdrant 可选）
- [ ] Note CRUD
- [ ] Session 列表与恢复
- [ ] MCP Server 管理
- [ ] 配置页（LLM Provider / 模型 / 密钥）
- [ ] 日志查看
- [ ] 技能（Skills）列表

**任何一项在 pack 产物中缺失 = P0 不通过。**

---

## 11. WebSocket 接口能力

### 11.1 当前 `ws-server.js` 暴露的操作

- `session-create` / `session-message` / `session-resume` / `session-list`
- `execute` / `executeJson`
- `worktree-diff` / `worktree-merge`
- `compression-stats`

### 11.2 `blockedCommands` 变更

**现状**：硬编码 `['serve', 'chat', 'agent', 'setup']` 全禁。

**变更**：

```
DEFAULT_BLOCKED = ['serve', 'setup']      // 任何模式都禁
PACK_EXTRA_ALLOWED = ['chat', 'agent']    // pack 模式解禁
```

判断方式：
- 优先读环境变量 `CC_PACK_MODE=1`（pack 启动时注入）
- 退路：读 `pack-manifest.json` 是否存在

### 11.3 新增 WS 消息类型

#### 11.3.1 运行时信息
- `op: 'runtime-info'` → `{ mode: 'pack' | 'dev', productVersion, dataDir, bindHost, tlsEnabled }`

#### 11.3.2 鉴权与角色
- `op: 'auth'` → `{ok, role, permissions:[...]}`：Token 校验，返回当前连接的角色与允许的操作
- `op: 'whoami'` → 返回当前连接身份

#### 11.3.3 访问管理（owner/admin）
- `op: 'token-list'` → 所有 Token 元信息（不含 value）
- `op: 'token-create'` → `{id, role, expiresAt?, allowedIPs?}` → 返回新 Token value（仅此一次）
- `op: 'token-revoke'` → `{id}`
- `op: 'access-policy-get'` / `access-policy-set`
- `op: 'bind-host-change'` → `{host: '0.0.0.0' | '127.0.0.1' | ...}`（owner 独占，需二次确认）
- `op: 'ban-list'` / `op: 'ban-clear'`
- `op: 'audit-tail'` → 流式返回最近 N 条审计日志

所有管理类 op 经过权限中间件，不足角色直接返回 `{error: 'forbidden', required: 'owner'}`。

### 11.4 跨主机访问的协议选择

| 场景 | 协议 | 备注 |
|---|---|---|
| 同机本地 | `ws://127.0.0.1:18800` | 默认 |
| 局域网内网 | `ws://192.168.x.x:18800` | 需 `--allow-remote` |
| 跨网络 | `wss://host:18800` | 必须 TLS + 强 Token |

Web UI 连接 WS 时自动根据访问 URL 协议（http/https）选择 ws/wss，降低配置复杂度。

---

## 12. 数据与配置策略

### 12.1 DB 密码初始化 UX

三种进入路径（按优先级）：

1. **环境变量**：`CHAINLESSCHAIN_DB_PASSWORD=xxx` 启动前设置
2. **CLI 参数**：`chainlesschain-portable.exe --db-password xxx`（仅首启有效）
3. **交互式提示**：终端阻塞提示用户输入（适合双击场景）

首次设置后写入 `%APPDATA%\chainlesschain-portable\<proj>\state\.db-pass-set`（空文件 marker），后续启动从 OS keyring 读（Windows Credential Manager），读失败回退到交互式提示。

### 12.2 Pre-seeded 配置安全扫描

`--preset-config` 指定的 JSON 在合并前扫描：

| 字段路径 | 处理 |
|---|---|
| `llm.providers.*.apiKey` | 检测非空 → 报错 |
| `did.mnemonic` / `did.privateKey` | 检测非空 → 报错 |
| `*.secret` / `*.password` / `*.token` | 检测非空 → 报错 |
| 其他（模型名、端点 URL 等） | 允许 |

`--allow-secrets` 显式开关跳过扫描（产物将**包含**凭据，极度危险，警告后二次确认）。

### 12.3 外部服务连接

产物启动后首次访问 Web UI 的配置页，引导用户填写：

- **LLM Provider**：OpenAI / Anthropic / DeepSeek / Ollama endpoint
- **Qdrant**：可选，缺失时降级为纯 BM25
- **MCP Servers**：可选

所有外部地址默认 `localhost:xxxx`，指向用户本机服务。

---

## 13. 原生模块处理

### 13.1 涉及模块

| 模块 | 用途 | 必需性 |
|---|---|---|
| `better-sqlite3` | 主 DB 引擎 | **必需** |
| `better-sqlite3-multiple-ciphers` | 加密 DB | 可选但推荐 |
| `bufferutil` / `utf-8-validate` | ws 性能优化 | 可选 |

### 13.2 prebuild 抽取

`packages/cli/src/lib/packer/native-prebuild-collector.js` 做的事：

```
输入: targets = ['node20-win-x64']
步骤:
  1. 读取 node_modules/better-sqlite3/build/Release/*.node
  2. 校验 ABI：
     - pkg Node runtime ABI (node20 → 115)
     - 本机 .node 文件内嵌的 ABI
     - 不匹配 → 报错，提示 npm rebuild 或下载预编译
  3. 拷到 build-temp/prebuilds/<target>/
  4. 重复 for better-sqlite3-multiple-ciphers
```

### 13.3 运行时加载

pkg assets 不能直接 `require('.node')`。启动时做：

```
启动
 ↓
os.tmpdir() / cc-portable-<pid>/
 ↓
把 snapshot:/prebuilds/<platform>/*.node 拷到临时目录
 ↓
monkey-patch Module._resolveFilename 或直接
require(absolutePathToTempNodeFile)
 ↓
进程退出时清理临时目录
```

这部分逻辑放到 `src/lib/packer/runtime-native-loader.js`（**运行时**模块，会被 pkg 打进去）。

---

## 14. 安全模型与访问控制

### 14.1 网络边界（三级绑定策略）

| 模式 | 绑定地址 | 适用场景 | 触发方式 |
|---|---|---|---|
| **本机独占**（默认） | `127.0.0.1` | 单机使用，最安全 | 默认行为 |
| **局域网共享** | `0.0.0.0` 或指定网卡 IP | 多设备/团队内网 | `--allow-remote` 或 Web UI 设置开启 |
| **自定义** | 指定地址 | 特定网卡、Docker 内网 | `--bind-host <ip>` |

绑定地址可三处配置（优先级从高到低）：
1. CLI 参数 `--bind-host <ip>` / `--allow-remote`
2. 数据目录下 `config.json` 的 `server.bindHost`
3. 产物打包时预置的默认值

**任何 ≠ 127.0.0.1 的绑定必须显式开启**，首次切换时 Web UI 弹警告二次确认。

### 14.2 鉴权（Token 层）

#### 14.2.1 Token 模型

- 支持**多 Token 并存**（不再是单一全局 Token）
- 每个 Token 绑定：
  - `id`：可读的名称（如 "my-iphone"、"teammate-alice"）
  - `value`：实际令牌字符串（32 字节随机）
  - `role`：权限角色（见 §14.3）
  - `createdAt` / `expiresAt`
  - `allowedIPs`：可选 IP/CIDR 白名单
  - `lastUsedAt` / `useCount`：审计字段

#### 14.2.2 Token 管理入口

| 入口 | 能力 |
|---|---|
| 启动时终端打印 | 产物首启生成 **owner** 级 Token，打印一次（不再显示） |
| Web UI 设置页 | 创建/吊销/查看所有 Token，owner 角色可见 |
| `--cli token list/create/revoke` | 命令行管理 |
| `config.json` | 静态 Token 列表（适合部署场景） |

#### 14.2.3 Token 传递

- Web UI：URL query `?token=xxx` 首次进入，之后存 `sessionStorage`
- WS：首包 `{op:'auth', token:'xxx'}`，握手不过则断开
- HTTP API：`Authorization: Bearer <token>`

### 14.3 访问角色（RBAC）

**四级角色**（可在 `config.json` 或 Web UI 配置）：

| 角色 | 能做 | 不能做 | 典型场景 |
|---|---|---|---|
| **owner** | 全部，包括 Token 管理、绑定地址切换 | - | 产物所有者 |
| **admin** | 全部 WS 操作，配置修改 | 改 owner、改绑定地址 | 可信管理员 |
| **member** | chat / agent / session / note 读写 | execute / 配置修改 / Token 管理 | 团队成员 |
| **guest** | chat / session 只读 / note 只读 | 写操作、agent、execute | 临时分享、演示 |

每个 WS 操作标注所需角色：

| 操作 | 最低角色 |
|---|---|
| `auth` / `ping` / `runtime-info` | guest |
| `session-list` / `session-resume` | guest |
| `session-create` / `session-message` | member |
| agent 相关 | member |
| `execute` / `executeJson` | admin |
| `worktree-*` | admin |
| `access-grant` / `access-revoke` / `bind-host-change` | owner |

### 14.4 IP 访问控制

- **全局黑白名单**：`config.json.server.allowedCIDRs` / `deniedCIDRs`
- **Token 级白名单**：每个 Token 可独立限制来源 IP
- **自动封禁**：连续 N 次认证失败的 IP 临时封禁（默认 5 次 / 10 分钟）
- **审计**：所有连接尝试（成功/失败）记录到 `logs/access.log`

### 14.5 频控与防滥用

| 限制 | 默认值 | 可配置 |
|---|---|---|
| 单 IP 并发 WS 连接 | 5 | `server.maxConnsPerIP` |
| 认证失败自动封禁 | 5 次 / 10 min | `server.banPolicy` |
| WS 消息速率 | 30 msg/s per conn | `server.rateLimitMsg` |
| HTTP 请求速率 | 60 req/min per IP | `server.rateLimitHttp` |
| Token 总数上限 | 50 | `server.maxTokens` |

### 14.6 访问策略文件

`--access-policy <path>` 接受一个 JSON：

```json
{
  "schema": 1,
  "bindHost": "0.0.0.0",
  "enableTls": true,
  "tlsCert": "./cert.pem",
  "tlsKey": "./key.pem",
  "allowedCIDRs": ["192.168.1.0/24", "10.0.0.0/8"],
  "deniedCIDRs": [],
  "tokens": [
    { "id": "owner", "role": "owner", "value": "env:CC_OWNER_TOKEN" },
    { "id": "team-readonly", "role": "guest", "expiresAt": "2026-12-31" }
  ],
  "banPolicy": { "failThreshold": 5, "windowMin": 10, "banMin": 30 },
  "rateLimit": { "wsMsgPerSec": 30, "httpReqPerMin": 60 }
}
```

打包时写入产物作为**默认策略**，运行时可被 Web UI 或 `config.json` 覆盖。值含 `env:NAME` 前缀则在启动时从环境变量读取。

### 14.7 TLS / WSS 支持

远程访问强烈建议走 TLS：

- 产物支持 `--enable-tls --tls-cert --tls-key` 启动
- 协议自动升级：HTTP→HTTPS、WS→WSS
- 证书来源：
  - 用户自备（CA 签发 / Let's Encrypt / 内部 CA）
  - 自签名（首启提示用户接受浏览器警告）
  - 未来：内嵌 mkcert 生成本地开发证书
- 不启用 TLS 且 `bindHost != 127.0.0.1` 时，**启动时打印强警告**

### 14.8 审计日志

所有访问事件记录到 `logs/access.log`（JSONL 格式）：

```json
{"ts":"2026-04-23T10:00:00Z","event":"auth.success","ip":"192.168.1.10","token":"team-readonly","role":"guest"}
{"ts":"2026-04-23T10:00:05Z","event":"ws.op","ip":"192.168.1.10","op":"session-message","sessionId":"..."}
{"ts":"2026-04-23T10:00:30Z","event":"auth.fail","ip":"10.0.0.5","reason":"invalid-token"}
{"ts":"2026-04-23T10:01:00Z","event":"ban","ip":"10.0.0.5","reason":"auth-fail-threshold"}
```

Web UI 设置页提供审计日志查看器（owner/admin 可见）。

### 14.9 危险命令白名单

WS 侧严格控制可调用命令：

- 禁止：`serve`（套娃）、`setup`（需 TTY）、`pack`（无意义自举）
- 允许：其他 100+ 命令
- 有参数注入风险的命令走 Arg Validator（复用 `ipc-validator.js` 思路）
- **敏感命令（admin 角色）**：涉及 `execute` 的一律需要 admin 角色并记审计

### 14.10 敏感数据

- DB 加密：SQLCipher + 用户密码（PBKDF2 派生）
- 日志脱敏：API Key / Token / 私钥在日志中替换为 `***`
- 凭据不入产物：见 §12.2
- Token 在 `config.json` 中可选加密存储（绑定 DB 密码派生的 KDF）

### 14.11 代码签名（P2）

- 用户首次启动未签名 exe 会触发 Windows SmartScreen 警告
- P2 必须完成 EV 证书签名
- 过渡期：README 提供 SHA256 校验步骤

### 14.12 安全默认值总结

| 项 | 默认 | 说明 |
|---|---|---|
| 绑定地址 | `127.0.0.1` | 本机独占 |
| TLS | 关闭 | 本机访问无需 |
| Token 数 | 1 个 owner | 首启生成 |
| 远程访问 | 拒绝 | 显式开启 |
| 失败封禁 | 5/10min | 自动 |
| 审计日志 | 开启 | 本地落盘 |

即使用户什么都不配置，开箱也是安全的本机模式。

---

## 15. 端口与进程生命周期

### 15.1 端口冲突处理

启动时：

1. 尝试绑定默认端口（18800 / 18810）
2. 占用时：
   - 递增 +1 最多尝试 10 次（18800→18809）
   - 全占用 → 报错退出
3. 最终端口写入 `state/ports.json`，Web UI 启动脚本动态读取

### 15.2 单实例锁

- 使用 `proper-lockfile` 锁 `state/portable.pid`
- 已有实例 → 提示用户是否"打开现有实例的 Web UI"
- 已有实例不可达（进程死了但锁残留）→ 清锁续跑

### 15.3 优雅关闭

Ctrl+C / 窗口关闭：

```
收到 SIGINT
  ↓
停止接受新 WS 连接
  ↓
通知所有活动 session: "shutting down"
  ↓
等待最多 10s 让 chat/agent 收尾
  ↓
flush DB WAL
  ↓
删除临时 .node 文件
  ↓
释放单实例锁
  ↓
exit(0)
```

### 15.4 崩溃恢复

- 意外崩溃 → 下次启动检测到 stale lock → 清理并告警
- DB WAL 残留 → SQLCipher 自动 recovery
- 损坏数据 → 提示用户 "是否重置？" 或 `--reset-data` 参数

---

## 16. 错误处理与诊断

### 16.1 启动失败分类

| 错误 | 用户看到 | 处理 |
|---|---|---|
| DB 密码错误 | "数据库密码错误，请重试" | 允许重试 3 次，超过退出 |
| 端口全被占 | "端口 18800-18809 均被占用" | 提示 `--ws-port` 指定 |
| DB 损坏 | "数据库文件损坏" | 提示 `--reset-data` 或 `--restore <backup>` |
| 缺失 .node | "原生模块加载失败：<details>" | 提示去 issue 反馈（不应该发生） |

### 16.2 日志与反馈

- 所有启动信息写入 `logs/app.log`
- 崩溃时生成 crash dump 到 `logs/crash-<timestamp>.log`
- Web UI 提供 "下载诊断包" 按钮 → 打包 logs + config (脱敏) + manifest

### 16.3 Diagnose 命令

产物支持：

```bash
chainlesschain-portable.exe --diagnose
```

输出：
- 数据目录路径 + 大小
- DB 是否可打开
- 端口可用性
- 原生模块加载状态
- 最近一次崩溃日志摘要

---

## 17. 升级与迁移

### 17.1 产物版本标识

- `pack-manifest.json` 嵌入 productVersion + gitCommit
- 数据目录 `.version` 文件记录数据层版本

### 17.2 升级策略

用户用新版本 exe 打开旧数据：

```
启动
 ↓
读 .version = v5.0.2.40（旧）
读 manifest.productVersion = v5.0.2.49（新）
 ↓
执行 migration/<from>-<to>.sql 序列
  - v5.0.2.40 → v5.0.2.49 的增量
 ↓
成功 → 写新 .version
失败 → 回滚 + 提示用户
```

### 17.3 向下兼容

- 老数据目录始终可被新 exe 打开
- 新数据目录**不保证**被老 exe 打开（会提示版本不匹配）

### 17.4 数据备份

- 每次升级前自动备份到 `backups/<timestamp>/`
- 保留最近 3 份，超出自动清理

---

## 18. 分阶段交付

### Phase 0：本地联调（~1 天）

**目标**：改 `ws-server.js` 和 `web-ui-server.js`，本地 `cc ui` 能跑完整 Vue 面板且支持 chat/agent。

**产出**：
- [ ] `blockedCommands` 改为环境变量驱动
- [ ] `web-ui-server.js` 加 `mode: 'full' | 'minimal'`
- [ ] 本地 `cc ui --mode full` 验证通过

### Phase 1：最小 pack（~2 天）

**目标**：Windows x64 单目标能产出可运行 exe。

**产出**：
- [ ] `cc pack` 命令骨架 + 8 个 packer 子模块
- [ ] Phase 2-7 流水线跑通
- [ ] 产物能启动 Web UI（better-sqlite3 可能还缺）

### Phase 2：原生模块 + 独立性（~1 天）

**目标**：产物在无 Node 环境可用。

**产出**：
- [ ] prebuild 抽取 + 运行时 native loader
- [ ] 首启 DB 初始化 + 密码设置
- [ ] 数据目录策略

### Phase 3：冒烟测试与签名（~1 天）

**目标**：产物可安全分发。

**产出**：
- [ ] `--smoke-test` 实现
- [ ] 代码签名流水线
- [ ] README 含 SHA256 校验说明

### Phase 4（P1）：跨平台（~3 天）

- [ ] macOS (Intel + ARM)
- [ ] Linux x64

### Phase 5（P2+）：增量升级、auto-update

---

## 19. 测试矩阵

| 测试层 | 范围 | 数量预估 |
|---|---|---|
| **单元测试** | packer 各子模块 | ~50 |
| **集成测试** | `cc pack --dry-run` 全流程 | ~10 |
| **端到端测试** | 实际产出 exe + 启动 + HTTP/WS 请求 | ~5 |
| **手工测试** | 无 Node 新机器 + 浏览器操作 Web UI | P0 必做 |

### 19.1 E2E 关键用例

1. `cc pack` 产物启动 → Web UI 打开 → 发一条 chat → 收到回复
2. `cc pack` 产物启动 → WS 手工发 `session-create` → `session-message` → 收到流式数据
3. `cc pack` 产物启动 → 关闭 → 再启动 → 历史会话还在
4. `cc pack` 产物启动 → `--cli status` 模式 → 输出正常
5. `cc pack` 产物启动 → 模拟 DB 损坏 → 触发恢复流程

### 19.2 CI 集成

`.github/workflows/cli-pack.yml`（建议）：

- 触发：`packages/cli/src/commands/pack.js` 或 `src/lib/packer/` 变更
- Job：Windows runner 跑 `cc pack --smoke-test`
- Artifact：上传产物到 GitHub Actions artifacts（保留 7 天）

---

## 20. 实施清单

### 20.1 新增文件

```
packages/cli/src/commands/pack.js
packages/cli/src/lib/packer/
├── index.js                        # 编排入口
├── precheck.js                     # Phase 1
├── web-panel-builder.js            # Phase 2
├── config-template-builder.js      # Phase 3 + 安全扫描
├── native-prebuild-collector.js    # Phase 4
├── pkg-config-generator.js         # Phase 5
├── pkg-runner.js                   # Phase 6
├── manifest-writer.js              # Phase 7
├── code-signer.js                  # Phase 7 (P2)
├── smoke-tester.js                 # Phase 8
└── runtime-native-loader.js        # 运行时（被打进产物）
packages/cli/tests/unit/pack/
├── precheck.test.js
├── config-template-builder.test.js
├── native-prebuild-collector.test.js
├── pkg-config-generator.test.js
├── manifest-writer.test.js
└── smoke-tester.test.js
packages/cli/tests/integration/pack-dry-run.test.js
docs/design/CC_PACK_打包指令设计文档.md    ← 本文档
```

### 20.2 修改文件

```
packages/cli/src/index.js
  - 注册 pack 命令
packages/cli/src/gateways/ws/ws-server.js
  - blockedCommands 改为环境驱动
packages/cli/src/lib/web-ui-server.js
  - 加 mode 参数
  - full 模式从 assets/web-panel/dist/ 读
packages/cli/bin/chainlesschain.js
  - 检测 CC_PACK_MODE，决定入口分支
packages/cli/package.json
  - devDep 加 @yao-pkg/pkg
  - scripts 加 pack / pack:win
  - pkg 字段（assets / scripts / targets）
```

### 20.3 零改动组件

- 其他 100+ 命令不动
- 核心库 `@chainlesschain/core-*` 不动
- Desktop 应用不动

---

## 21. 风险与未解决问题

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| pkg 与 Node 20 新特性不兼容 | 中 | 高 | 锁定 Node 版本，测试矩阵覆盖 |
| better-sqlite3 ABI 版本漂移 | 中 | 高 | CI 固定构建环境 |
| Windows SmartScreen 拦截 | 高 | 中 | P2 买 EV 证书 |
| 产物体积过大（>150MB） | 中 | 中 | 按需拆分 sidecar，删 dev-only |
| Web Panel 构建失败导致打包阻塞 | 中 | 低 | `--skip-web-panel-build` 应急 |
| 用户忘记 DB 密码导致数据永久丢失 | 低 | 极高 | UX 引导用户写下；提供恢复 key（未来） |
| 同机多项目 ID 冲突 | 中 | 中 | `<project-id>` 哈希兜底 |
| pkg 停止维护 | 低 | 中 | 预留 SEA 迁移路径 |
| 远程访问误开放到公网 | 中 | 极高 | 默认 127.0.0.1 + 二次确认 + 启动强警告 + 审计日志 |
| Token 泄露 | 中 | 高 | 多 Token + 角色分级 + 过期 + IP 白名单 + 自动封禁 |
| TLS 证书管理麻烦 | 高 | 中 | 支持自签名 + 未来内嵌 mkcert |
| RBAC 权限漏判 | 低 | 高 | 每个 WS op 标注所需角色，默认 deny，单测覆盖 |

### 21.1 未解决问题（需讨论）

1. **Web Panel 当前功能完整度**：需要单独做一次盘点，确认 §10.3 清单每一项今天在 `cc ui` 里是否真的可用
2. **`<project-id>` 选择策略**：是否允许用户打包时传 `--project-id` 覆盖
3. **多产物共用数据目录**：不同版本 exe 打开同一数据目录的行为未定义
4. **产物自更新**：是否需要产物能检测到新版本并提示下载
5. **遥测/崩溃上报**：是否需要匿名遥测帮助发现问题（需用户同意）

---

## 22. 法律与合规

### 22.1 第三方许可

产物内嵌的依赖必须合规：

- [ ] 生成 `THIRD_PARTY_NOTICES.txt` 并嵌入产物
- [ ] Node runtime（MIT）
- [ ] better-sqlite3（MIT）/ SQLCipher（BSD-3）
- [ ] pkg fork（MIT）
- [ ] Web Panel 所有依赖（MIT / Apache 居多）

### 22.2 数据合规

- 产物默认不上报任何数据到外部
- 所有数据本地存储
- 符合国内个保法要求（参考 CLAUDE.local.md 中 "等保三级" / 专利信息）

### 22.3 出口管制

- 包含加密算法（SQLCipher + Signal Protocol）
- 确认在国内分发无出口限制问题

---

## 23. 未来演进

### v2：自动更新

- 产物启动检查 update server
- 差分更新包（只下载变动资源）
- SEA 迁移更合适做这个

### v3：桌面集成

- Windows 托盘图标（不改 exe 本质，加 `--tray` 模式）
- 开机自启选项
- macOS .app bundle

### v4：多实例管理

- 一个产物管理多个项目数据目录
- `--workspace` 切换

### v5：企业分发

- MSI 安装包（非单 exe）
- 组策略部署
- 统一配置中心

---

## 附录 A：命令速查

```bash
# 最简打包（当前平台，全部默认）
cc pack

# 指定输出路径
cc pack -o ./dist/my-app.exe

# 指定产物的默认端口
cc pack --ws-port 28800 --ui-port 28810

# 预置 LLM 配置（脱敏后合并）
cc pack --preset-config ./ship-config.json

# 跳过 web-panel 重建（CI 加速）
cc pack --skip-web-panel-build

# Dry-run 查看会打包什么
cc pack --dry-run

# 冒烟测试关闭（CI 里分离 job 做）
cc pack --no-smoke-test

# 带签名（P2）
cc pack --sign cert.pfx --sign-password env:SIGN_PASS

# 诊断现有产物
chainlesschain-portable-win-x64.exe --diagnose

# —— 访问控制相关 ——

# 打包时预置访问策略（内网分发）
cc pack --access-policy ./team-policy.json

# 打包时启用 TLS 默认开
cc pack --enable-tls --tls-cert ./cert.pem --tls-key ./key.pem

# 产物运行时开启远程访问（一次性）
chainlesschain-portable-win-x64.exe --allow-remote --bind-host 0.0.0.0

# 产物运行时走 TLS（wss）
chainlesschain-portable-win-x64.exe --enable-tls --tls-cert cert.pem --tls-key key.pem

# 产物运行时用指定策略文件
chainlesschain-portable-win-x64.exe --access-policy ./policy.json

# 命令行管理 Token（需 owner token 环境变量）
chainlesschain-portable-win-x64.exe --cli token list
chainlesschain-portable-win-x64.exe --cli token create --role guest --expires 2026-12-31
chainlesschain-portable-win-x64.exe --cli token revoke --id team-readonly
```

---

## 附录 B：与现有命令的关系

| 现有命令 | pack 模式下行为 |
|---|---|
| `cc init` | 产物首启时自动跑（释放模板） |
| `cc setup` | **禁用**（TTY 交互在 Web UI 里由配置页替代） |
| `cc start` | 产物启动即等价 start |
| `cc stop` | Ctrl+C 或 Web UI 关闭按钮 |
| `cc status` | `--cli status` 可用 |
| `cc doctor` | `--cli doctor` 可用，或 Web UI 诊断面板 |
| `cc ui` | **就是**产物启动时自动做的事 |
| `cc chat` | WS 通道暴露 |
| `cc agent` | WS 通道暴露 |
| `cc serve` | **禁用**（套娃） |
| `cc pack` | **禁用**（自举无意义） |

---

## 附录 C：术语表

| 术语 | 含义 |
|---|---|
| pkg | 把 Node 项目打包为单文件 exe 的工具 |
| prebuild | 预编译的原生模块 `.node` 文件 |
| SEA | Node.js 原生 Single Executable Application |
| pack 模式 | 产物运行时的环境标识（`CC_PACK_MODE=1`） |
| 数据目录 | `%APPDATA%\chainlesschain-portable\<project-id>\` |
| 产物 | `cc pack` 的输出（单文件 exe） |
| Smoke test | 产物打包后的自动冒烟验证 |

---

**文档结束。**

下一步：若方案通过，按 §18 Phase 0 开始实施。
