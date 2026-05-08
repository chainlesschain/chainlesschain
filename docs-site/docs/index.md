---
layout: home

hero:
  name: ChainlessChain
  text: 去中心化个人 AI 管理平台
  tagline: v5.0.3.44 | CLI 0.161.5 · 112 命令 · 139 桌面 Skills · 28 Android Skills · V2 规范层（iter16-iter28 · 220+ 治理表面）· 14800+ 测试 · Web Shell（Phase 1.6 默认 · `--no-web-shell` opt-out · MTC 视图 in-process 提速绕过 asar 冷启动 · Phase 3c.7 截图识别 + 通知设置 + 托盘路由收口）· Web Panel i18n M3 全覆盖 · MTC v0.11（跨联邦信任锚 + 离线审计 + 多跳路由 · **publisher_signature M-of-N strip-all-sigs 修正**）· cc pack OTA · B4 ASAR surgery（Win 安装 20m → ~5m）· **P2P 社交全栈 audit-grade 闭环**（§2.2.10 → §2.2.24，15 节：跨机同步 + MTC 联邦 + DID 签名 + Merkle envelope + 跨机分发 + trust filter + 桌面 viewer + 外部归档 + M-of-N 多签 + 跨联邦信任 + 默认壳全套 + sign-as-self + WebDAV 凭据 secure-config + 主进程定时归档 cron — 私钥 / 密码均不过线）· **chat-panel-v5 三壳对齐**（V5 / V6 / web-shell 聊天能力严格对等：流式 + 历史切换 + 上下文记忆 + 工具调用面板）· **安全硬化级联**（HIGH 44→0 · MOD 4→0 · LOW 45→0 · drop hdkey/werift/speedtest-net + override transitive vulns）· CI 三发 macOS / 规则误报 / Win cold-start 解锁
  image:
    src: /logo.png
    alt: ChainlessChain Logo
  actions:
    - theme: brand
      text: 快速开始
      link: /guide/getting-started
    - theme: alt
      text: 查看文档
      link: /guide/introduction
    - theme: alt
      text: GitHub
      link: https://github.com/chainlesschain

features:
  - icon: 🔐
    title: 安全优先
    details: 支持本地优先、权限控制、会话持久化与远程访问保护。
  - icon: 🤖
    title: AI 原生
    details: 支持多 Provider、多模型、Agent 工作流、压缩策略与会话恢复。
  - icon: 🧭
    title: CLI + Web Panel
    details: 同时提供 Headless CLI、Web 管理面板、任务监控与会话管理。
  - icon: 🧪
    title: 工程化验证
    details: 单元、集成、E2E 与文档持续对齐，减少设计与实现偏移。
---

> 2026-04-08 更新：文档站已对齐 CLI Agent Runtime 重构、统一 runtime event、session record、后台任务增强、Worktree 合并助手、压缩观测、会话迁移，以及 **Coding Agent Phase 5 最小 Harness + 真实 interrupt**。
>
> 2026-04-19 更新：CLI V2 规范层 iter17–iter21 累计新增 40 个 lib 治理表面（chat-core / claude-code-bridge / compliance-manager / cowork-learning / cowork-workflow / privacy-computing / token-incentive / hardening-manager / aiops / multimodal / instinct-manager / tenant-saas / quantization / trust-security / nl-programming / perception / code-agent / collaboration-governance / community-governance / did-manager / sso-manager / org-manager / scim-manager / sync-manager / agent-network / browser-automation / dlp-engine / evomap-governance / federation-hardening / ipfs-storage / p2p-manager / wallet-manager / activitypub-bridge / matrix-bridge / nostr-bridge / bi-engine / memory-manager / session-manager / hook-manager / workflow-engine），统一遵循 4 状态 profile maturity + 5 状态 lifecycle 模型；CLI 版本升级到 `0.151.0`。
>
> 2026-04-26 更新：**web-panel Phase B 全量收官**。从桌面端移植 5 个高频功能到浏览器面板：`/community`（社交：联系人/好友/帖子）、`/marketplace`（技能市场：发布/调用/统计）、`/crosschain`（跨链桥：5 链桥接 + HTLC + 跨链消息）、`/aiops`（运维：异常检测 + Playbook + 基线）、`/compliance`（合规：STIX 2.1 IoC + UEBA 行为分析）。配套：侧边栏改造（独立滚动 + 8 个二级菜单可折叠 + localStorage 持久化）、SPA fallback 测试覆盖率从 23 路由扩到 34、新增 19 个集成测试（每命令实跑一次 `cc serve` WS）。Commits: `260787c99` / `792b211e1` / `8f7d87ede` / `30cf3b6ab` / `04c57237d` / `7ee1985c5` / `d43e43a93`。
>
> 2026-04-27 更新：**web-panel V5→Web 全量化迁移收官 — Phase B/C/D 一日连发**。Phase B 补齐 B6–B10（`/privacy` 隐私计算 + `/inference` 推理网络 + `/nlprog` 自然语言编程 + `/tenant` 多租户 SaaS + `/pipeline` Pipeline 编排）共 10/10 全量上线，CLI 升 `0.157.7`。随后 Phase C 5/5 全量：`/governance` 治理 + `/audit` 审计 + `/reputation` 信誉 + `/recommend` 推荐 + `/sla` SLA，CLI 升 `0.157.8`。同日 Phase D 5/5 收口：`/codegen` 代码生成 + `/search` 多维搜索 + `/tokens` Token 激励 + `/trust` 信任根 + `/federation` 联邦熔断，CLI 升 `0.157.9`。**至此 Phase A (3) + B (10) + C (5) + D (5) = 23 ports 全部落地，router 28 → 50 (+22 routes)，web-panel 单元测试 27 → 1489 全绿**。从此 `cc ui` 浏览器端与桌面 Electron 端功能对等。Phase D commits: `fa8479d49` / `da852045d` / `6e1941beb` / `6b7ac0985` / `a7909b8a6` → bundle `1faa9e11f`。
>
> 2026-05-01 更新：**MTC v0.5 — Phase 3 federation 全套 + libp2p auto-discovery**（commit `d75abe6e8` / sweep `f7e333a41`）。Phase 3.1 多签 landmark + `cc mtc federation {join,leave,status}` 本地 registry；Phase 3.2 `cc mtc batch* / publish-skills --federation <id> --threshold <M>` 多签发布；Phase 3.3 `--transport filesystem` 跨进程 drop-zone 发现（NFS/Syncthing/SMB/USB）；Phase 3.4 `--transport libp2p` 真 P2P gossipsub topic auto-discovery。Backend Q-ENG-2 OperationLogService 桥接 `cc audit mtc emit` 写回 `audit_mtc_event_id`（V013 migration），web-panel `Audit.vue` 加 4 态 MTC 列徽章。**476 MTC 测试全绿**（core-mtc 182 + CLI 89 + desktop 33 + web-panel 153 + backend 19）跨 6 层覆盖，含异构 Ed25519 + SLH-DSA 联邦。
>
> 2026-05-02 更新：**Web Panel i18n M3 全覆盖 + V6 LanguageSwitcher + web-shell opt-out + projects folder picker**。i18n M3 一波收 ~25 个视图（Speech/Analytics/Cron/Security/Templates/Search/Audit/McpTools/Backup/Tokens/Mtc/WebAuthn/Community/Wallet/Inference/Organization/Recommend/Federation/Reputation/AIOps/Projects 等），中英双语 vue-i18n 全量贯通；V6 preview topbar 接 `LanguageSwitcher`（`645b19f30`）。web-shell 默认 ON 后加 `--no-web-shell` dev opt-out + settings-authoritative precedence（`9119bdec1`）；projects 加 folder picker 走 `cc init --cwd` 完成"打开已有文件夹"流（`c935a95d4`）。CLI `0.160.0 → 0.160.1`，root `productVersion v5.0.3.1 → v5.0.3.4`。
>
> 2026-05-03 更新：**MTC v0.11 — 跨联邦信任锚 + 离线审计 + 多跳路由 + Gas 感知 + SLA + 监控仪表板**。六条线一次收口跨链桥 §11 + 联邦治理 v0.2 §11 全部可做项：(A1) 跨联邦信任锚 schema + validate（6 类错误码）+ `cc mtc federation cross-trust-create/cross-trust-validate`；(A2) 离线第三方审计器 `auditGovernanceLog()` 顺序回放每个事件、构建滚动 roster、ERROR/WARN 两级 finding；(A3) 多跳传输路由 `--hops <n>`；(A4) Gas 感知 closeBatch；(A5) SLA tracker 有界等待 + p95；(A6) 监控仪表板 web-panel `/mtc` 聚合视图（多联邦健康度 + 同步延迟 + 待批次）。仅 Q-COMP-3（链上锚定法务）+ 真 RPC 链适配两项保留外部阻塞。
>
> 2026-05-04 更新：**官网 + 双语整站 + brochure 同步**。docs-website-v2（Astro）整站 8 页 zh + 8 页 en 双语镜像，SiteHeader/SiteFooter 检测 `/en/` 前缀自动切换 nav + dictionary，"EN ↔ 中文" 双向切换；新增三大核心能力屏 / Cowork 5 阶段流程图 / 6 平台 + 6 路测试细分 strip / SLA + 5 类伙伴 + 6 合作方式区块；/security 补 Trinity Trust Root v3.2 三脚（U盾 / SIMKey / TEE）+ 后量子 PQC（ML-KEM/ML-DSA）+ 零知识（Groth16 + zk-STARK）+ FIPS 140-3 硬件标准；/about 补 6 点里程碑时间线 + 资质双块（已获 5 项 + 进行中 4 项）。CLI 版本号统一引用 `packages/cli/package.json`，三处硬编码漂移修掉。CLI `0.161.2`，root `productVersion v5.0.3.29`。Brochure v3 重新生成对齐当前版本。
>
> 2026-05-07 更新 III：**v5.0.3.41 — chat-panel-v5 三壳对齐 + B4 social 滚动收口**。本版 productVersion .40 → .41，正式 ship 前 4 个 "5.0.3.40 续" 滚动条目（cred-persist + auto-archive、mofn-sign v2 + webpanel UI、merkle envelope finality、跨机同步 Phase A + Web Shell Phase 3c.7）以及两条新增：(A) V6 默认壳 AIChatPanel 反向对齐 V5 ChatPanel 的 4 个核心特性（流式响应 + 历史会话切换 + 上下文记忆引用 + 工具调用面板，Phase E commit `b33527d31`）；(B) web-shell ChatPanel v5 端口 v1+v1.1（commit `72b13388a`）port V5 全部 router 协议 / autoSendMessage 信号 / virtual list / 5 intent / 6 IPC 走 WS topic。从此 V5 / V6 / web-shell 三壳聊天体验严格对等，Phase 1.6 默认 web-shell 用户不再缺任何 V5 聊天能力。同时修：web-panel `views-mount-smoke.test.js` 在 63 文件并行套件 first-import 撞 30s timeout（Pipeline.vue + Chat.vue 在 4-fork 池下 SFC transform 竞争），fix 走 file-level `vi.setConfig({ testTimeout: 60_000 })`，全局 timeout 不动（验证全局升 60s 反让 worker pool 调度恶化）。回归全绿：desktop 1454/1454 + CLI mtc-federation 集成 41/41 + web-panel 1853/1853 unit + 63/63 e2e。

> 2026-05-07 更新 II：**v5.0.3.40 — MTC 视图 in-process 提速 + CI 三发解锁**。主修：v5.0.3.39 切到 `asar:true` 后 `cc` 子进程冷启动从 dev 的 ~2.5s 涨到打包后 6-10s，`Mtc.vue` `onMounted` 三发并发（`loadStatus` + `loadBridgeStatus` + `loadBridgeSla`）必撞 8s/6s ws.execute timeout（用户截图 "状态加载失败 / 加载桥 MTC 状态失败"）。修法：新增 3 个 in-process WS topic（`mtc.audit-status` / `mtc.bridge-status` / `mtc.bridge-sla`）直查 `audit-mtc` / `cross-chain-mtc` lib（纯文件读，无 SQLite，无 spawn，零 asar 开销）；`Mtc.vue` 通过 `useShellMode().isEmbedded` 双路径分叉，embedded 走新 topic，浏览器/`cc serve` 仍走旧 `ws.execute`；保底 timeout 8000/6000 → 30000 ms。配 7 + 1 新单测。同时打包三发 CI 修复（commit `25d834958`）：(1) `build-win-with-deref` 7 个 test 在 macOS unit fallback 上 fail，根因 `isSymlink` 用 `realpathSync` 比较，但 macOS `os.tmpdir()` 路径含 `/var → /private/var` 的隐式 symlink，所有 tmp 子目录都误判 → platform split：Win 用 realpath（junction 需要），POSIX 用 `lstat.isSymbolicLink()`；(2) rules-validator 把测试 fixture `TestDbManager.exec(sql)` 当 SQL_INJECTION 报红 → `getAllFiles` 跳过 `__tests__/__mocks__/` + `.test.js`/`.spec.js`/`.d.ts`；(3) CLI subprocess `node bin/chainlesschain.js` cold-start 在繁忙 Windows 主机超 10/15s execSync timeout → 统一 bump 60s（与项目 testTimeout 对齐）。Tests：Desktop unit 10482/10482 + MTC handler 7/7 + web-panel mtc-parser 14/14 + CLI unit 17392/17392 + CLI integration 821/821，共 28716+ 测试。

> 2026-05-07 更新：**B4 post-pack ASAR surgery 落地（v5.0.3.39，issue #8）**。重启 `asar: true`（v5.0.3.4-13 因 electron-builder walker 漏掉 4 个 transitive 包改成 `asar: false`，代价是 NSIS 内 ~110k loose files → Windows 安装 ~20 分钟）。新 `scripts/asar-surgery.js` 在 afterPack 钩子里 extract → inject 4 个 walker-dropped 包（call-bind-apply-helpers / side-channel-{list,map,weakmap}）到 asar header top-level → 重新 createPackageWithOptions，并保留 electron-builder 原始 unpackDir 决策。新 `scripts/build-win-with-deref.js` Win 包装 `electron-builder --win`，临时把 `@chainlesschain/{core-mtc,session-core}` workspace symlinks 替换成 verbatim 拷贝（asar packer 拒绝跨 app-root 符号链接），finally 用 'junction' 还原（Win 非 admin 不能创建 'dir' symlink）。预期 Windows 安装 ~5 分钟、安装包 ~300 MB 减重。Tests：`tests/unit/scripts/asar-surgery.test.js`（8 用例）+ `build-win-with-deref.test.js`（15 用例）真 fs + 真 `@electron/asar` 跑 fixture，过程中暴露并修掉一个真 bug：`@electron/asar` 有 module-level `filesystemCache` keyed by archive path，extractAll 后必须 `asar.uncache(asarPath)` 才能让 listPackage 读到 fresh header（否则 verification gate 永远抛 stale）。Mac/Linux 通过 afterPack 同一路径自动获益。Refuted 路径（不要再走）：asarUnpack glob（issue #6 经验证）、extraResources to app.asar.unpacked/（v5.0.3.12）、4 包提为直接 dep（v5.0.3.6）。

## 当前验证结果

- CLI 单元（`__tests__/unit`，含全部 V2 治理表面）：`14255/14255` (332 文件)
- CLI 集成（`__tests__/integration`）：`696/696` (40 文件)
- CLI E2E（`__tests__/e2e`）：`565/565` (38 文件)
- CLI 定向单元（含 `agent-core` / `ws-agent-handler` / `interaction-adapter` / `abort-utils` 真实 interrupt 主线）：`175/175`
- CLI `ws-session-workflow` 集成：`20/20`
- CLI `coding-agent-envelope-roundtrip` E2E：`7/7`
- Desktop Coding Agent 主链路（bridge / ipc-v3 / session-service / permission-gate / tool-adapter / 集成 / store / AIChatPage）：`9 files, 197/197`
- Phase 5 最小 harness 定向回归：`5 files, 84/84`
- AIChatPage harness 面板 + dot-case 事件页面回归：`69/69`
- Web Panel 单元测试（`__tests__/unit/`，含 Phase A + B + C + D 全部 parser）：`1489/1489`
- Web Panel 集成测试（`__tests__/integration/phase-b-cli-commands.test.js`）：`19/19`（每命令对实跑 `cc serve`）
- Web Panel 路由数：`50`（Phase A 3 + B 10 + C 5 + D 5 = 23 V5→Web 端口完成）
- Web Panel 构建：通过
- Docs Site 构建：通过

**2026-04-08 文档对齐回归（修改文件全量定向）**：

| 类型 | 范围 | 通过 |
| --- | --- | --- |
| CLI 单元 | agent-core / sub-agent-registry / ws-agent-handler | 126/126 |
| Desktop main 单元 | coding-agent-bridge / coding-agent-ipc-v3 / coding-agent-session-service | 77/77 |
| Renderer 单元 | coding-agent store / AIChatPage | 81/81 |
| CLI 集成 | ws-session-workflow | 32/32 |
| Desktop 集成 | coding-agent-lifecycle | 18/18 |
| CLI E2E | coding-agent-envelope-roundtrip | 7/7 |
| **小计** | **6 套** | **341/341** |

## 快速开始

### 方式一：CLI 安装

```bash
npm install -g chainlesschain
chainlesschain setup
chainlesschain start
```

### 方式二：源码运行

```bash
git clone https://github.com/chainlesschain/chainlesschain.git
cd chainlesschain
npm install
npm run dev:desktop-vue
```

## 文档导航

- [产品概览](/guide/introduction)
- [快速开始](/guide/getting-started)
- [CLI 文档](/chainlesschain/cli)
- [Agent 架构优化](/chainlesschain/agent-optimization)
- [Web 管理界面](/chainlesschain/cli-ui)
- [WebSocket 服务](/chainlesschain/cli-serve)
- [设计文档索引](/design/)

## 当前推荐阅读

如果你是从本轮 Runtime / Web Panel / 协议演进切入，建议优先看下面几页：

- [WebSocket 服务](/chainlesschain/cli-serve)
- [Web 管理界面](/chainlesschain/cli-ui)
- [Agent 架构优化](/chainlesschain/agent-optimization)
- [设计模块 69：WebSocket 服务器接口](/design/modules/69-websocket-server)
- [设计模块 73：Web 管理界面](/design/modules/73-web-ui)
- [设计模块 75：Web 管理面板](/design/modules/75-web-panel)
- [设计模块 78：CLI Agent Runtime 重构计划](/design/modules/78-cli-agent-runtime)
- [设计模块 79：Coding Agent 系统](/design/modules/79-coding-agent)
- [Coding Agent 用户文档](/chainlesschain/coding-agent)
- [Minimal Coding Agent 实施计划](/chainlesschain/minimal-coding-agent-plan)

## 本轮重点能力

### CLI Agent Runtime 重构

- 命令入口正在统一收口到 `Runtime / Gateway / Harness` 分层。
- WebSocket 协议处理已拆到 `gateways/ws`，由 dispatcher 统一分发。
- Web Panel 已通过 `onRuntimeEvent()` 开始消费统一 runtime event。
- `session-created`、`session-resumed`、`session-list-result` 现在都带标准 `record`。

### 后台任务增强

- 支持任务历史分页查询、任务详情输出摘要和多节点恢复策略基础能力。
- 任务完成后通过 `task:notification` 实时推送到 Web Panel。

### Worktree 合并助手

- 支持 `worktree-diff` 预览、`worktree-merge` 一键合并。
- 冲突结果包含文件级摘要、自动化候选项和预览入口。

### 压缩策略观测

- 支持 `windowMs`、`provider`、`model` 三个维度筛选。
- Dashboard 展示命中率、节省 Token、策略分布和变体分布。

### 会话迁移

- 支持旧 JSON 会话迁移到 JSONL。
- 支持 dry-run 报告、抽样校验和失败重试。

### Coding Agent Phase 5 最小 Harness 与真实 Interrupt

- `coding-agent:interrupt` 已从 `close-session` 别名收口为**真实中断**语义：CLI runtime 通过共享 `abort-utils.js` + `AbortController` 终止当前正在执行的 turn，同时保留 session 可继续使用。
- `CodingAgentSessionService.getHarnessStatus()` 一次性聚合 `sessions` / `worktrees` / `backgroundTasks` 三类概览。
- 新增五条 IPC：`harness-status` / `list-background-tasks` / `get-background-task` / `get-background-task-history` / `stop-background-task`，Desktop main → bridge → IPC v3 → preload → renderer store 全链路打通。
- Desktop 聊天页 (`AIChatPage.vue`) 新增 **Coding Agent Harness** 面板，展示会话 / worktree / 后台任务概览，支持 Refresh、View Details（详情 + 历史）、Stop Task。
- AIChatPage 已迁移到点分小写事件协议：`tool.call.*` / `assistant.final` / `approval.*` / `approval.high-risk.*`。

## 当前架构主线

本轮文档已经把下面这条主线补齐到可阅读状态：

- CLI 入口正在统一收口到 `Runtime / Gateway / Harness`
- WebSocket 层从“大一统消息处理器”演进为 `gateways/ws`
- Web Panel 主干页面开始通过 `onRuntimeEvent()` 消费统一事件
- session / task / worktree / telemetry 开始共享标准 `record`

如果你想从设计层继续深入，可以直接进入 [设计文档索引](/design/)，再顺着 69、73、75、78 四个模块继续看。
