# PDH Bridge — 个人数据 IDE 桥接

> **模块: 101 | 状态: 🟡 Phase 0 完成并真机验证 + Phase 1 采集工具（L1–L4）已落地接入 | 协议: MCP over JSON-RPC 2.0 (2024-11-05) | 传输: Streamable HTTP @ 127.0.0.1 | 6 设备工具 | CLI 41 测 + Android 25 测**
>
> PDH Bridge 把"App ↔ cc"的关系**反转**过来：不再让 App 把 cc 当一次性子进程，而是**让手机 App 变成一台"设备能力 MCP 服务器"**，让 `cc agent` 作为客户端连上去，用一个输入框主动指挥采集 / 分析 / 办事。这是"个人数据版 Cursor"——看数据（人）+ AI 辅助办个人事务。
>
> 设计文档：[`docs/design/modules/101_个人数据IDE桥接方案.md`](/design/modules/101-personal-data-ide-bridge)（15 决策 + 9 段分期，已定稿）。本文档描述**已落地的实现**。

## 概述

ChainlessChain 个人数据中台（PDH）此前的能力都锁在 Kotlin 侧——采集器只能在 App UI 里手点触发，`cc agent` 够不着。PDH Bridge 借鉴 IDE 桥接（module 98，把 IDE 当 MCP server）的思路，把这层关系反过来：

- **App = 设备能力 MCP 服务器**：App 在本机 `127.0.0.1` 上跑一个轻量 MCP server（Ktor CIO），把"采集系统数据 / 采集 App 业务数据 / root 取证打捞 / 采集本地文件"等设备能力暴露成 MCP 工具。
- **cc = 客户端**：App 启动时拉起内置的 `cc`，并通过环境变量把端口/令牌注入进去；`cc agent` 自动发现并连上这台 server，从而能**主动调用**设备采集能力，而不是被动地被 Kotlin 调用。
- **一个输入框统一指挥**：采集、查询、分析、办事，未来都从一个对话框发出（Phase 2）。

这样做的核心收益：**Agent 第一次拿到了"指挥设备采集自己数据"的能力**——这是把零散烟囱数据汇成"个人全貌"、再由端侧 AI 服务个人事务的关键一步。它服务于项目北极星使命——**数据主权回归个人 + AI 普惠服务个人**。

## 实现进度

| 阶段        | 内容                                                                                         | 状态                                                                |
| ----------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **Phase 0** | 协议冻结 + Kotlin 协议核 + Ktor HTTP shell + lockfile 发现 + app 启动接线 + cc 侧发现层      | ✅ **已落地 + chopin 真机 e2e 验证**                                |
| **Phase 1** | 采集工具（L1 本地文件 / L2 系统数据 / L3 App 业务数据 7 源 / L4 root 打捞）接入生产 ToolHost | ✅ **代码已落地 + 单元测试**（完整真机采集需登录账号 / L4 需 root） |
| **Phase 2** | 安卓单输入框 Chat + 三类信任卡 + 隐私分级路由 + 不可信数据隔离                               | ⬜ 设计待开工                                                       |
| **Phase 3** | 本地文件（L1）抽取管线（PDF/Office/OCR/转写/EXIF）                                           | ⬜ 设计待开工                                                       |
| **Phase 4** | 数据库直读（L4 归一化 + 原库只读直查）                                                       | ⬜ 设计待开工                                                       |
| **Phase 5** | 自学习纠正回路（补 PDH feedback loop）                                                       | ⬜ 设计待开工                                                       |
| **Phase 6** | 人看视图（数据全貌 / 出境台账 / AI 画像可纠）                                                | ⬜ 设计待开工                                                       |
| **Phase 7** | 跨设备资产备份（加密 + DID + libp2p E2E P2P）                                                | ⬜ 设计待开工                                                       |
| **Phase 8** | 跨设备操作 + 事务执行                                                                        | ⬜ 设计待开工                                                       |

> **真机 e2e（Phase 0，chopin rooted）**：App 启动后 bridge 在 `127.0.0.1:18510` 起服 + 写出 cc 兼容 lockfile（0600/0700）；`curl` 实证 `initialize` → `protocolVersion 2024-11-05`、`tools/call pdh_ping` → `pong`、错误 token → `401`。

## 核心特性

- 🔄 **进程模型反转**：App 从"一次性子进程消费者"升级为"常驻设备能力 server"，agent 主动指挥采集（镜像 IDE 桥接 Phase 6 的双工模型）。
- 🔌 **标准 MCP 协议**：MCP over JSON-RPC 2.0（protocolVersion `2024-11-05`），与 cc 的 MCP client 字节兼容，复用现成 transport，不发明私有协议。
- 🧩 **纯 JDK 协议核**：协议核 `PdhBridgeProtocol` 不依赖任何 Android / Ktor API，可在纯 JVM 上 headless 单测；Ktor CIO 仅作薄 HTTP 外壳。
- 🗂️ **四层数据面**：L1 本地文件 / L2 系统数据 / L3 App 业务数据 / L4 App 数据库直读，统一暴露为 MCP 工具。
- 🔐 **每实例 Bearer 令牌**：localhost 在共享设备上不够安全，每个 server 实例生成 256-bit 令牌，写进 lockfile，客户端必须出示。
- 📡 **零扫描发现（env 直连）**：App 注入 `CHAINLESSCHAIN_PDH_PORT`（+ 可选 `_TOKEN`），内置 cc 精确锁定实例；外部 agent 回退到 lockfile 扫描（取最新存活锁）。
- 🤝 **引导式人机协同（assist_required）**：采集前置缺失（未登录 / cookie 未暖 / 需进对应页面）时，工具返回 `assist_required` 而不是失败——这是设计的"诚实降级"原则。
- ⏱️ **长阻塞工具豁免**：`pdh` server 标记为 `longRunning`，免疫 agent loop 的单次调用超时——`assist_required` 可阻塞等用户在目标 App 里完成一步再重试。
- 🪪 **保留服务名 `pdh`**：发现到的 server 注册为保留名 `pdh`，工具命名空间 `mcp__pdh__*`，让位用户显式注册的同名 server。
- 🔁 **采集衔接复用现成管线**：collect 工具 Kotlin 侧产快照，再 `spawn cc hub sync-adapter <provider>` 入库（决策 #15"方案 i"），无需改动 cc bundle。

## 系统架构

### 进程与连接拓扑

```
┌───────────────────────────────── Android App (单 uid 沙箱) ─────────────────────────────┐
│                                                                                         │
│   ┌──────────────────────┐        启动接线          ┌────────────────────────────────┐  │
│   │  PdhBridgeModule      │ ──────(Hilt @Provides)──▶│  PdhBridgeServer (Ktor CIO)    │  │
│   │  装配 L1–L4 采集器     │                          │  127.0.0.1:18510 (端口扫描)     │  │
│   └──────────────────────┘                          │  • Bearer 令牌 (256-bit)        │  │
│                                                      │  • Mcp-Session-Id 头            │  │
│   ┌──────────────────────┐                          │  • POST /mcp                    │  │
│   │ PdhLockfileWriter     │ ◀──写 <port>.json (0600)─┤  PdhBridgeProtocol (纯 JDK 核)  │  │
│   │ ~/.chainlesschain/    │                          └───────────┬────────────────────┘  │
│   │   pdh-bridge/         │                                      │ tools/call             │
│   └──────────┬───────────┘                          ┌───────────▼────────────────────┐  │
│              │ 发现                                   │  6 设备工具                      │  │
│              │                                       │  pdh_ping / collect_files (L1)   │  │
│   ┌──────────▼───────────┐  注入 CHAINLESSCHAIN_     │  collect_system_data (L2)        │  │
│   │  内置 cc (in-APK)     │  PDH_PORT / _TOKEN        │  collect_app_data (L3, 7 源)     │  │
│   │  cc agent  ───MCP────▶│ ────连接(Bearer)────────▶ │  salvage_app_data (L4, root)     │  │
│   │  (mcp__pdh__* 工具)   │                           │  list_collectors                 │  │
│   └──────────────────────┘                           └───────────┬────────────────────┘  │
│                                                                   │ 快照 + spawn           │
│                                                       ┌───────────▼────────────────────┐  │
│                                                       │  cc hub sync-adapter <provider> │  │
│                                                       │  → vault (SQLCipher AES-256)    │  │
│                                                       └─────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

### MCP 协议核（`PdhBridgeProtocol`）

纯 Kotlin / JSON-RPC 2.0，与 cc 的 MCP client POST 的内容字节兼容。支持方法：

| 方法                              | 行为                                                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `initialize`                      | 返回 `protocolVersion: 2024-11-05` + `capabilities.tools` + `serverInfo`（name `chainlesschain-pdh-android`, version `0.1.0`） |
| `notifications/initialized`       | 通知（无 `id`）→ 仅 ACK（HTTP 202，无响应体）                                                                                  |
| `tools/list`                      | 返回工具清单（name / description / inputSchema）                                                                               |
| `tools/call`                      | 调用指定工具；工具内部失败 → **带 `isError:true` 的 in-band 内容结果**（不是 transport 错误）                                  |
| `resources/list` / `prompts/list` | 返回空数组（占位，保持客户端兼容）                                                                                             |

错误码遵循 JSON-RPC：`-32700` Parse error / `-32600` Invalid request / `-32601` Method/Tool not found / `-32603` Internal error。

### Lockfile 发现协议

App 在内置 cc 的 HOME 下写发现锁，cc 侧读取后连接：

```
路径: <appFiles>/.chainlesschain/pdh-bridge/<port>.json   (文件 0600, 目录 0700, best-effort)
```

```json
{
  "kind": "pdh-bridge",
  "version": 1,
  "transport": "http",
  "url": "http://127.0.0.1:18510/mcp",
  "port": 18510,
  "device": "android",
  "appUid": 10367,
  "token": "<256-bit hex>",
  "pid": 12345,
  "started_at": 1718900000000
}
```

> **关键对齐**：cc 侧（`pdh-bridge.js`）扫描的是 `os.homedir()/.chainlesschain/pdh-bridge/`，而内置 cc 的 HOME 由 PtyEnvironment 设为 bootstrapper 的 homeDir，因此 bridge **必须**把 lockfile 写到那个目录，否则 cc 发现不到。

### 发现两条路径（cc 侧 `discoverPdhServer`）

| 路径                 | 触发                                       | 行为                                                                  |
| -------------------- | ------------------------------------------ | --------------------------------------------------------------------- |
| **Path A（确定性）** | `CHAINLESSCHAIN_PDH_PORT` 已设（App 注入） | 找到端口匹配的存活锁直接用；令牌可来自锁或 `CHAINLESSCHAIN_PDH_TOKEN` |
| **Path B（扫描）**   | 无 env / env 端口无存活锁                  | 取最新存活锁（一台设备只有一个 PDH server，无 workspace 概念）        |

存活判定：`pid` 发信号 0 探活（跨平台，含 Windows）；锁文件 `pid` 已死 **且** 文件 mtime 超过 30s TTL → 判定 stale 丢弃。

## 工具清单

PDH Bridge 当前暴露 **6 个设备工具**（agent 侧命名空间 `mcp__pdh__*`）：

| 工具                  | 层  | 需 root | 功能                                                                 |
| --------------------- | --- | ------- | -------------------------------------------------------------------- |
| `pdh_ping`            | —   | 否      | 存活探针（liveness）                                                 |
| `collect_files`       | L1  | 否      | 采集本地文件入库（默认 Documents + Download，或传 `roots` 数组覆盖） |
| `collect_system_data` | L2  | 否      | 采集系统数据（联系人 + 已安装应用），免 root 免登录                  |
| `collect_app_data`    | L3  | 否      | 经 App 已存登录态采集业务数据；无凭证 → 返回 `assist_required`       |
| `salvage_app_data`    | L4  | **是**  | 免密钥 root 内存打捞（目标 App 须前台运行）                          |
| `list_collectors`     | —   | —       | 列出各采集器的层级 + root 需求（自反射）                             |

### `collect_app_data` 支持的 7 个数据源

| App key               | 适配器               | 取数方式                  |
| --------------------- | -------------------- | ------------------------- |
| `weibo`               | `social-weibo`       | cookie（无需签名）        |
| `bilibili`            | `social-bilibili`    | cookie（无需签名）        |
| `12306`               | `travel-12306`       | cookie（无需签名）        |
| `douyin`              | `social-douyin`      | 签名门控（WebSignBridge） |
| `xiaohongshu` / `xhs` | `social-xiaohongshu` | 签名门控（WebSignBridge） |
| `toutiao`             | `social-toutiao`     | 签名门控（WebSignBridge） |
| `kuaishou`            | `social-kuaishou`    | 签名门控（WebSignBridge） |

### `salvage_app_data` 支持的目标 App（root）

`douyin` / `toutiao` / `wechat` / `kuaishou` / `xiaohongshu` / `weibo`（免密钥内存扫描 + 叶子页打捞，目标 App 须前台运行）。

> ⚠️ 抖音 IM 走 WCDB2 私有页格式，叶子页打捞只能解出其小配置/资源库，IM 正文不可一次性打捞——加密 IM 的正解是 frida 借 App 自身已 keyed 连接在线导出（见相关文档）。

### 工具统一返回契约（诚实降级）

| status            | 含义                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------- |
| `ok`              | 成功，返回 `collected` / `ingested` / `kgTriples` / `ragDocs` 等计数                   |
| `assist_required` | 采集前置缺失（需人在 App 内操作），返回 `instruction` + `reason`，agent 引导用户后重试 |
| `partial`         | 部分成功（设计契约）                                                                   |
| `error`           | 失败，返回错误信息——**绝不静默失败 / 假装成功 / 编造数据**                             |

## 配置参考

### 环境变量

| 变量                       | 作用                                            | 设置方           |
| -------------------------- | ----------------------------------------------- | ---------------- |
| `CHAINLESSCHAIN_PDH_PORT`  | 直连指定端口（Path A 快路径）                   | App 注入内置 cc  |
| `CHAINLESSCHAIN_PDH_TOKEN` | 配合上面，提供 Bearer 令牌（lockfile 无令牌时） | App 注入（可选） |
| `CHAINLESSCHAIN_PDH`       | 显式声明"在 PDH 终端内"（开启自动连接）         | 可选 opt-in      |

### `cc agent` 命令行开关

| 开关       | 行为                                   |
| ---------- | -------------------------------------- |
| `--pdh`    | 强制启用 PDH 发现（即便不在 PDH 终端） |
| `--no-pdh` | 关闭 PDH 发现                          |
| 默认       | 在 PDH 终端内（env 命中）自动连接      |

### server 端口与路径

```text
基础端口        : 18510
端口扫描尝试    : 10  (18510 → 18519, 取第一个空闲端口)
监听地址        : 127.0.0.1  (仅本机)
MCP 端点        : http://127.0.0.1:<port>/mcp  (POST)
lockfile 目录   : <appFiles>/.chainlesschain/pdh-bridge/
stale TTL       : 30000ms  (pid 已死 + 文件超时才判废)
```

### MCP server 配置（cc 侧自动生成）

```javascript
// discoverPdhServer → pdhServerToMcpConfig
{
  url: "http://127.0.0.1:18510/mcp",
  transport: "http",            // http / https / sse 受支持；ws 暂不支持
  headers: { Authorization: "Bearer <token>" },
  longRunning: true,            // 免疫 agent loop 单次调用超时（assist_required 可阻塞）
}
```

## 性能指标

> PDH Bridge 的开销集中在**采集本身**（网络 / IO 受限），协议层本身极轻。下表区分"已验证的架构事实"与"采集特征"，不虚构基准数字。

### 协议层（架构事实）

| 指标     | 数值 / 特征                                                                |
| -------- | -------------------------------------------------------------------------- |
| 传输     | Streamable HTTP（POST /mcp），localhost 回环，无跨网开销                   |
| 协议核   | 纯 JSON 解析 + 分发，无重型依赖                                            |
| 端口绑定 | 启动时一次性扫描 ≤10 端口（`ServerSocket` 探测），幂等                     |
| 鉴权     | 每请求一次 Bearer 字符串比较                                               |
| 发现     | lockfile 读取 + `process.kill(pid,0)` 探活，O(锁数量)，一台设备通常 1 把锁 |

### 采集特征

| 维度                       | 特征                                                                            |
| -------------------------- | ------------------------------------------------------------------------------- |
| `collect_system_data` (L2) | 本地 ContentResolver 读取 + 入库，免 root/登录，最快路径                        |
| `collect_app_data` (L3)    | 受网络 / cookie 暖热 / 签名生成影响；无凭证立即返回 `assist_required`（不阻塞） |
| `salvage_app_data` (L4)    | root 内存扫描 + 叶子页打捞，耗时随目标库大小变化                                |
| `assist_required` 阻塞     | 由用户操作节奏决定，故 server 标记 `longRunning` 豁免超时                       |
| 重活调度（设计）           | 大批量采集 / 抽取走 WorkManager（充电 + WiFi + idle），不占前台                 |

## 测试覆盖

### Android 侧（纯 JVM headless，25 用例）

```
✅ PdhBridgeProtocolTest.kt    - 9 用例 (initialize/tools-list/tools-call/通知/未知方法/工具失败 isError)
✅ PdhBridgeServerTest.kt      - 5 用例 (真 HTTP: 鉴权/401/会话头/端口扫描/parse error)
✅ PdhLockfileWriterTest.kt    - 3 用例 (写/删/schema 字段对齐 cc reader)
✅ CollectFilesToolTest.kt     - 5 用例 (默认根/自定义 roots/入库报告)
✅ ListCollectorsToolTest.kt   - 3 用例 (层级 + root 需求反射)
```

> 协议核 `PdhBridgeProtocol` 与 lockfile 核 `PdhLockfileWriter` 刻意不引用任何 Android / Ktor API，因此可在纯 JVM 上 headless 单测；`PdhBridgeServer` 经真 HTTP 集成测试（`embeddedServer` 在纯 JVM 也能跑）。

### CLI 侧（41 用例）

```
✅ pdh-bridge.test.js     - 26 用例 (lockfile 解析/stale 过滤/localhost 校验/Path A·B 发现/MCP 配置/doctor)
✅ pdh-command.test.js    -  7 用例 (cc pdh list / status / doctor 渲染 + token 脱敏)
✅ mcp-config-pdh.test.js -  8 用例 (loadPdhMcp / resolveAgentMcp 接线 / --pdh·--no-pdh 门控)
```

### 真机 e2e（Phase 0）

- ✅ App 启动起 bridge @ `127.0.0.1:18510` + 写 cc 兼容 lockfile（0600/0700）
- ✅ `curl initialize` → `protocolVersion 2024-11-05`
- ✅ `curl tools/call pdh_ping` → `pong`
- ✅ 错误 token → `401 unauthorized`

## 安全考虑

### 传输与鉴权

1. **仅监听 localhost** — server 绑定 `127.0.0.1`，不暴露到网络。
2. **每实例 Bearer 令牌** — localhost 在共享设备上不够（同机其它进程也能访问回环），每个 server 生成 256-bit 令牌写进 lockfile，请求必须出示，否则 `401`。
3. **per-uid 沙箱 lockfile** — lockfile 写在 App 私有 files 目录（系统级 per-uid 隔离），额外 `0600/0700` chmod 作 best-effort 兜底。
4. **会话标识** — 每实例随机 `Mcp-Session-Id`，错误响应也回带，便于客户端区分实例。

### 数据-指令隔离（防 prompt injection，Phase 2 设计）

会"办事"的 agent 必须把**采集到的内容当不可信输入**：injection 可以污染 agent 的"想法"，但**污染不了行动**——所有副作用（写 / 事务）都过审批闸（复用 cc 的 permission / approval 基建）。

### 硬不变量（L4）

**改副本不改原库**：L4 原始库**只读**，没有任何写回原 App 库的工具——这是硬性不变量。编辑只发生在"工作副本"（从同步库复制出来的可变拷贝），定期同步能干净刷新同步库而不丢用户改动（存储三态：源只读 / 同步库镜像只读 / 工作副本可改）。

### 隐私分级（端侧优先，Phase 2 设计）

复用现有 4 档 LLM 路由（LOCAL / PC / LAN / CLOUD），默认走端侧 MediaPipe；云档只送 RAG 摘要、不送原始 vault；**高敏感数据默认不出端**，但保留用户显式同意（单次 / 单类）上云的口子。

### 身份与加密（DID 提前为基础层）

vault / 资产从早期即绑个人 DID，作密钥派生 / 加密 / 跨设备认领 / 备份恢复的统一身份根；vault 自身 SQLCipher AES-256 加密。

## 故障排查

### `cc pdh doctor` — 一键诊断发现

```bash
cc pdh doctor
# PDH bridge discovery
#   lock dir       : ~/.chainlesschain/pdh-bridge
#   in PDH terminal: true  (CHAINLESSCHAIN_PDH_PORT 已设)
#   live locks     : 1
#   chosen         : android port 18510 http://127.0.0.1:18510/mcp
#   reason         : matched CHAINLESSCHAIN_PDH_PORT (env fast-path)
```

### `cc pdh ping` — 活体连通探针

`list / status / doctor` 只**读** lockfile（发现层）；`cc pdh ping` 真正**连上**所发现的 server 并验证它能应答（discover → connect → `pdh_ping` 往返 → 报告）。不必跑整个 agent 即可确认桥真的通。

```bash
cc pdh ping
# PDH android:18510 OK — pong, 8 tools, 23ms

cc pdh ping --json
# { "ok": true, "stage": "ping", "device": "android", "port": 18510,
#   "tools": 8, "latencyMs": 23, "pingAttempted": true, "pingOk": true,
#   "pingText": "pong" }
```

- 旧版桥没有 `pdh_ping` 工具时，回退为「connect 即存活」（`pingAttempted: false`）。
- 失败时退出码非 0（可 `cc pdh ping && …` 脚本化）；`stage` 指出失败环节（`discover` / `connect` / `ping`）。
- 报告里的 `toolNames` 列出桥暴露的采集器裸名（`collect_files` / `query_app_data` / …），可一眼确认桥的版本与能力。
- 结果**绝不含** bearer token。

### `cc pdh feedback` — 看 AI 学到了什么（透明度）

自学习飞轮（§3.5.13）把你的每次纠正存进反馈台账，并在每个个人助手会话里前置注入——但这份「AI 对你的理解」原本你看不见。`cc pdh feedback` 把它显出来（计数 / 净倾向 / 记住的纠正，最新优先），对应 Android 透明视图的「AI 画像」段（§3.5.18：「看见 AI 对你的理解」）。

```bash
cc pdh feedback
# PDH 自学习反馈 (12 条)
#   👍 7  👎 2  净倾向 +5
#   已记住的纠正 (最新优先):
#     • 金额一律用人民币
#     • 汇报要简洁

cc pdh feedback --json   # { total, positive, negative, sentiment, corrections:[…] }
```

空台账如实显示「尚无跨会话反馈记录」，绝不臆造（§3.5.18 诚实原则）。

> **数据出口透明度（§3.5.18 出境台账）**：个人助手每轮若把对话发往云端 LLM、或某工具（cookie→第三方 API / 发消息 / 导出 / 跨设备）把数据发出端外，cc 会发一条结构化 `egress` 事件，App 端记入端侧加密台账——尤其云端 LLM 调用发生在 cc 子进程里、App 本看不见，这条事件补上了这个维度。本地推理轮不产生出境事件（诚实的「0 条出境」）。

### 常见问题

**Q: `cc agent` 连不上 PDH（工具 `mcp__pdh__*` 不出现）?**

1. App 的 bridge server 是否在跑？看 logcat `PdhBridgeServer: started on 127.0.0.1:...`。
2. lockfile 是否写到了**内置 cc 的 HOME** 下的 `.chainlesschain/pdh-bridge/`？（cc 扫的是 `os.homedir()`，必须与 bootstrapper homeDir 对齐）
3. `cc pdh list` 是否看到存活锁？没有则可能 server 没起或锁已 stale。
4. 锁在但连不上？跑 `cc pdh ping` 一步验证「能否真正连上并应答」——它会指出卡在 `discover` / `connect` / `ping` 哪一环。
5. env 是否注入了 `CHAINLESSCHAIN_PDH_PORT`？没有则走扫描路径（Path B）。
6. 是否被 `--no-pdh` 关掉了？

**Q: lockfile 存在但 `cc pdh status` 说"none usable"?**

1. `url` 是否 localhost（`127.0.0.1`/`::1`）？非 localhost 会被拒。
2. `transport` 是否受支持（http / https / sse）？`ws` 暂不支持。
3. 锁是否 stale（pid 已死 + 文件 mtime 超 30s）？重启 App 重新写锁。

**Q: `collect_app_data` 一直返回 `assist_required`?**

这是**正常的引导式协同**，不是错误：目标 App 没有可用登录态。按 `instruction` 在对应 App 内登录（让 cookie 生效）/ 进入消息页暖热，然后重试。

**Q: `salvage_app_data` 失败?**

1. 设备是否 root？L4 打捞需要 root。
2. 目标 App 是否前台运行？内存打捞要求目标进程活着且在前台。
3. 目标库是否标准 SQLCipher？抖音 IM 等 WCDB2 私有格式不可一次性打捞。

**Q: 401 unauthorized?**

客户端 Bearer 令牌与 lockfile / env 里的不一致——确认 `CHAINLESSCHAIN_PDH_TOKEN` 或锁文件 `token` 字段被正确读取。

## 关键文件

### Android 侧（`android-app/app/src/main/java/com/chainlesschain/android/pdh/bridge/`）

| 文件                                       | 职责                                                           |
| ------------------------------------------ | -------------------------------------------------------------- |
| `PdhBridgeProtocol.kt`                     | 纯 JDK MCP / JSON-RPC 2.0 协议核（headless 可测）              |
| `PdhBridgeServer.kt`                       | Ktor CIO HTTP 外壳（端口扫描 / Bearer / 会话头 / 写锁 / 启停） |
| `PdhLockfileWriter.kt`                     | 发现 lockfile 读写（schema 对齐 cc reader，0600/0700）         |
| `PdhBridgeModule.kt`                       | Hilt 装配——把 L1–L4 采集器接成生产 ToolHost                    |
| `PdhToolHost.kt`                           | 生产工具集组装器（pdh_ping + 采集工具 + list_collectors）      |
| `PdhTool.kt`                               | 工具接口（name / description / inputSchema / call）            |
| `CollectFilesTool.kt`                      | L1 本地文件采集工具                                            |
| `CollectSystemDataTool.kt`                 | L2 系统数据采集工具                                            |
| `CollectAppDataTool.kt`                    | L3 App 业务数据采集工具（7 源 + 签名门控接线）                 |
| `SalvageAppDataTool.kt`                    | L4 root 内存打捞工具                                           |
| `ListCollectorsTool.kt` / `PdhPingTool.kt` | 采集器清单 / 存活探针                                          |
| `StubPdhToolHost.kt`                       | Phase 0 假工具集（仅供 headless 协议测试保留）                 |

### CLI 侧（`packages/cli/src/`）

| 文件                    | 职责                                                                   |
| ----------------------- | ---------------------------------------------------------------------- |
| `lib/pdh-bridge.js`     | cc 侧发现层（env 直连 + lockfile 扫描 + stale 过滤 + MCP 配置 + 诊断） |
| `commands/pdh.js`       | `cc pdh list / status / doctor` 检视命令（token 脱敏）                 |
| `runtime/mcp-config.js` | `loadPdhMcp` + `resolveAgentMcp` 把 PDH 接进 agent 的 MCP 装配         |
| `commands/agent.js`     | `--pdh` / `--no-pdh` 开关                                              |

## 使用示例

### 检视设备 PDH 发现状态

```bash
# 列出当前存活的 PDH lockfile
cc pdh list

# 显示 cc agent 此刻会连接的 PDH server（含脱敏后的 MCP 配置）
cc pdh status

# 解释 PDH 发现为什么选/没选某台 server
cc pdh doctor
```

### 用 agent 主动采集（设备内置 cc）

```bash
# 在 App 内置终端里，env 已注入 CHAINLESSCHAIN_PDH_PORT，agent 自动连上 PDH
cc agent "采集本机系统数据（联系人和已安装应用）入库"
# → agent 调用 mcp__pdh__collect_system_data

cc agent "把我的微博数据采集进个人知识库"
# → agent 调用 mcp__pdh__collect_app_data {app: "weibo"}
#   若未登录 → 返回 assist_required，agent 引导你先在微博 App 登录再重试

# 显式强制 / 关闭 PDH 发现
cc agent --pdh "列出这台设备能采集哪些数据"   # → mcp__pdh__list_collectors
cc agent --no-pdh "..."                       # 不连 PDH
```

### 直接探测协议（调试，无需 agent）

```bash
# 用 lockfile 里的 port/token
curl -s -X POST http://127.0.0.1:18510/mcp \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
# → {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05", ...}}

curl -s -X POST http://127.0.0.1:18510/mcp \
  -H "Authorization: Bearer <token>" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"pdh_ping","arguments":{}}}'
# → {"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"pong"}]}}
```

## 相关文档

- [个人数据中台 →](/chainlesschain/personal-data-hub)
- [个人 AI 知识库 →](/chainlesschain/personal-ai-knowledge-base)
- [Android 本地终端（内置 cc CLI）→](/chainlesschain/android-local-terminal)
- [CLI Agent →](/chainlesschain/cli-agent)
- [设计文档 — 101 个人数据 IDE 桥接方案 →](/design/modules/101-personal-data-ide-bridge)

---

> 本文档描述 PDH Bridge 已落地的实现（Phase 0 完成 + Phase 1 采集工具落地）。完整 9 段分期与 15 条决策详见 [设计文档](/design/modules/101-personal-data-ide-bridge)。
