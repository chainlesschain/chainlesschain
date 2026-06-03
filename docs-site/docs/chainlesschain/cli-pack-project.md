# 项目打包模式 (pack --project)

> **版本: v0.4 (CLI 0.156.6, 2026-04-24) | 状态: ✅ Phase 0-3 已落地 (Phase 0/1/2a/2b/3a/3b 全部合入 main)**
>
> `cc pack --project` 是 [`cc pack`](./cli-pack) 的项目模式扩展。它读取当前目录的 `.chainlesschain/` 项目内容（config、skills、rules、persona），将其一并打进单文件可执行程序。最终用户双击 exe，启动的就是"这个项目对应的 Agent"，而不是裸 ChainlessChain CLI 实例。

---

## 概述

[`cc pack`](./cli-pack) 基础模式打包的实质是 **CLI 自身**：产物是一个通用的 ChainlessChain 便携 exe，用户的项目内容（自定义 skills、config、persona）并不包含在内。

`--project` 模式解决这个问题：

```bash
npm i -g chainlesschain
mkdir my-medical-agent && cd my-medical-agent
cc init -t medical-triage        # 或 empty + 手动编辑
# 编辑 .chainlesschain/config.json、rules.md、skills/*
cc pack                          # CWD 有 .chainlesschain/ → 自动进入项目模式
# 产出：dist/my-medical-agent-portable-win-x64.exe
```

产物双击即跑成"我的医疗分诊 Agent"：内嵌 skills 自动加载（通过 `GET /api/skills` 暴露），自定义 persona 由环境变量 `CC_PACK_AUTO_PERSONA` 驱动自动激活，config 首次启动时物化到 `~/.chainlesschain-projects/<name>-<configSha8>/`。

**与 [基础 `cc pack`](./cli-pack) 的区别**：

| 维度 | 基础模式 | 项目模式 |
|---|---|---|
| 内嵌内容 | CLI runtime + Web UI | CLI runtime + Web UI + `.chainlesschain/` |
| 产物名 | `chainlesschain-portable-<target>.exe` | `<project-name>-portable-<target>.exe` |
| 双击行为 | 通用 Web UI（裸实例） | 项目 persona + 自定义 skills 已就绪 |
| 触发方式 | 手动指定 | CWD 有 config 时自动检测 |
| 子命令集 | 完整 CLI 表面 | 受 `pack.allowedSubcommands` 白名单收敛 |
| Sidecar | `<artifact>.pack-manifest.json` | 同上；`bundledSkills` 字段额外包含项目内 skill 列表 |

---

## 核心特性

- 📁 **项目即产物**：CWD 的 `.chainlesschain/` 全量内嵌（打包时快照），首次启动物化到用户数据目录，用户可后续修改
- 🔍 **自动检测**：CWD 有 `.chainlesschain/config.json` 时 `cc pack` 默认进入项目模式；`--no-project` 显式恢复基础行为；`--project` 强制模式下缺 config 直接报错
- 🏷️ **项目命名**：产物名取 config.json 的 `name` 字段；非法字符（`[^a-z0-9_-]`）由 `sanitizeProjectName()` 折叠为 `-`，Windows 保留名自动追加 `-proj`，上限 64 字符
- 🎭 **Persona 自动激活**：`config.pack.autoPersona` 写入 `BAKED.projectAutoPersona`，运行时导出为环境变量 `CC_PACK_AUTO_PERSONA` 供 skill-loader 拾取（Phase 3b 落地）
- 🔒 **子命令白名单**：`config.pack.allowedSubcommands` 写入 `CC_PROJECT_ALLOWED_SUBCOMMANDS` 环境变量，`createProgram` 过滤未列出的子命令（Phase 3a 落地；未列出子命令根本不注册到 commander）
- 🔑 **密钥保护**：复用基础模式的 secret-scanner（10 种正则），项目 config 命中即拒绝打包
- 📋 **项目 sidecar**：Phase 7 manifest 自动扩展 `bundledSkills` 数组，便于收件方审计
- 🔄 **漂移合并**：bundle 时计算 `.chainlesschain/` 全量 SHA-256；启动时标记文件（`.pack-version`）与 configSha 不一致则**合并**（新文件追加，已存在文件保留用户改动并 warn）
- 🧠 **GET /api/skills**：Web UI 启动后 HTTP 暴露 `/api/skills`，返回 `{schema:1, skills:[{name, source, category, ...}]}`（Phase 2b 落地），驱动 Web 端面板的技能列表
- ⚠️ **安全拒绝**：skill 含 `node_modules/`、项目超 50MB、config 含密钥，均硬拒打包（可以 `--force-large-project` 越过 50MB 上限，其余无逃生舱）

---

## 系统架构

基础模式的 7 阶段流水线插入新的 **Phase 3.5**，扩展为 8 阶段：

```
┌────────────────────────────────────────────────────────────────────────┐
│                    cc pack --project 流水线（8 阶段）                   │
│                                                                        │
│  [1] precheck               基础校验 + 项目 config schema 校验          │
│       │                     resolveProjectMode(flag, configPresent)    │
│       ▼                                                                │
│  [2] ensureWebPanel         同基础模式（web-panel/dist）                │
│       │                                                                │
│       ▼                                                                │
│  [3] buildConfigTemplate    项目 config 作为 preset → secret-scanner   │
│       │                                                                │
│       ▼                                                                │
│  [3.5] collectProjectAssets  ◀── 项目模式专属                         │
│       │    .chainlesschain/ → tempDir/project/                        │
│       │    skip: .git/ node_modules/ .cache/ dist/ *.log              │
│       │    拒绝: skill node_modules / 超 50MB / 密钥命中               │
│       │    计算全量 SHA-256 / 解析 bundledSkills 列表                  │
│       ▼                                                                │
│  [4] collectPrebuilds       同基础模式（better-sqlite3 / sql.js）       │
│       │                                                                │
│       ▼                                                                │
│  [5] generatePkgConfig      assets 追加 tempDir/project/**/*           │
│       │                     BAKED 扩展 projectMode/Name/Sha/Entry/     │
│       │                     AutoPersona/AllowedSubcommands/BundledDir  │
│       │                     入口脚本插入 copyRecursiveMerge + chdir    │
│       ▼                ────── 这里停在 --dry-run ──────                │
│  [6] runPkg                 同基础模式（@yao-pkg/pkg）                  │
│       │                                                                │
│       ▼                                                                │
│  [7] writeManifests         manifest.bundledSkills 扩展                │
│       │                                                                │
│       ▼                                                                │
│  [8] smokeTest              HTTP 200 on / + WS 握手                    │
│                             + GET /api/skills 断言 bundledSkills      │
│                             （对旧 artifact 的 404 软容忍）            │
└────────────────────────────────────────────────────────────────────────┘

产物启动时（项目模式）:
┌─────────────────────────────────────────────────────────────────────┐
│  my-medical-agent-portable-win-x64.exe                              │
│    ├── 检测 user-data 标记文件 .pack-version == BAKED.configSha     │
│    ├── 不一致 → copyRecursiveMerge（新文件追加，已存在保留 + warn）  │
│    ├── 一致 → 跳过物化                                              │
│    ├── CC_PROJECT_ROOT → userDataDir                                │
│    ├── CC_PACK_AUTO_PERSONA → config.pack.autoPersona               │
│    ├── CC_PROJECT_ALLOWED_SUBCOMMANDS → 逗号分隔                    │
│    ├── 启动 WS  :18800 (CC_PACK_MODE=1)                             │
│    └── 启动 UI  :18810 (默认 entry=ui；/api/skills 返回项目 skills) │
└─────────────────────────────────────────────────────────────────────┘
```

**触发矩阵**：

| 命令 / 上下文 | 行为 |
|---|---|
| `cc pack`（CWD 有 `.chainlesschain/config.json`） | 自动进入项目模式 |
| `cc pack`（CWD 无 `.chainlesschain/`） | 基础 CLI-only 模式（不变） |
| `cc pack --project` | 强制项目模式；缺 config 直接报错退出 (exit 10) |
| `cc pack --no-project` | 强制 CLI-only，即使 CWD 有 config |
| `cc pack --cwd <path>` | 以 `<path>` 作为 CWD 解析（自动/强制判断基于 `<path>/.chainlesschain/`） |

---

## 配置参考

### `.chainlesschain/config.json` — `pack` 字段

项目模式在 config.json 顶层新增 `pack` 对象：

```json
{
  "name": "my-medical-agent",
  "template": "medical-triage",
  "pack": {
    "entry": "ui",
    "autoPersona": "medical-triage-persona",
    "allowedSubcommands": ["ui", "chat", "agent", "skill"]
  }
}
```

| 字段 | 默认值 | 说明 |
|---|---|---|
| `pack.entry` | `"ui"` | 双击 / 无参启动时执行的子命令（`"ui"` / `"chat"` / `"agent"` / `"skill <name>"`） |
| `pack.autoPersona` | `null` | 启动时自动激活的 persona skill 名；写入 `CC_PACK_AUTO_PERSONA` |
| `pack.allowedSubcommands` | `["ui","chat","agent","skill"]` | commander 注册白名单；其他子命令被跳过 |

> `pack.autoOpenBrowser` 字段尚未进入 v0.4 实施范围（由 `cc ui` 自身的行为兜底），以 [基础模式 flags](./cli-pack#配置参考) 为准。

### 新增 CLI Flags

以下 flags 在现有 `cc pack` flags（见 [cli-pack § 配置参考](./cli-pack#配置参考)）基础上新增：

| 参数 | 默认值 | 说明 |
|---|---|---|
| `--project` | 自动检测 | 强制项目模式（缺 config 直接报错） |
| `--no-project` | — | 强制 CLI-only 模式 |
| `--entry <subcommand>` | 取自 `config.pack.entry` | 覆盖默认双击行为 |
| `--project-config-override <path>` | — | 打包时用另一份 config.json（调试用） |
| `--force-refresh-on-launch` | `false` | 每次产物启动强制重置 user-data（不保留用户改动） |
| `--force-large-project` | `false` | 跳过 50MB 上限 |

所有基础 flags（`--dry-run` / `--allow-dirty` / `--smoke-test` / `--token` / `--ws-port` / `--ui-port` / `--bind-host` 等）行为完全等价，见 [cli-pack § 配置参考](./cli-pack#配置参考)。

---

## 性能指标

以下数值基于 2026-04-24 的本地 Win11 x64 实测（Node 20.17.0 + yao-pkg 6.3.2；项目为 `.chainlesschain/` 典型目录，~2MB + 3 个 skill）：

| 操作 | 目标 | 实测 | 状态 |
|---|---|---|---|
| Phase 3.5 资产收集 | < 3s | ~180ms | ✅ |
| SHA-256 全量计算 | < 1s | ~90ms | ✅ |
| `@yao-pkg/pkg` 打包（含项目资产，热 cache） | < 90s | ~35–55s | ✅ |
| 产物首次启动 + 物化 | < 8s | ~3–4s | ✅ |
| 产物冷启动（user-data 已就绪） | < 5s | ~2–3s | ✅ |
| 产物体积（Win x64，典型项目，不含模型） | < 100 MB | ~58 MB | ✅ |

体积预算：pkg + Node runtime ~52MB + Web panel ~4MB + native prebuilds ~1.5MB + 项目内容（典型）~0.5MB = **~58 MB**。

---

## 测试覆盖

Phase 0-3 合入 main 时 **108 条测试全绿**（其中项目模式新增 97 条单元 + 11 条集成；完整 pack 套件总数更大）：

```
✅ __tests__/unit/packer-precheck-project-mode.test.js          26 条
     auto-detect on/off × --project/--no-project 行为矩阵
     sanitizeProjectName（Windows 保留名、64 char 上限、非法字符折叠）
     config schema 校验（pack.entry / allowedSubcommands 类型）

✅ __tests__/unit/packer-project-assets-collector.test.js       17 条
     50MB cap 触发 / node_modules 拒绝 / .git skip + .chainlesschain 保留
     bundledSkills 解析 / secret-scan 复用 / dotfile 过滤策略
     --force-large-project 越过上限

✅ __tests__/unit/packer-pkg-config-generator.test.js           28 条
     BAKED 扩展字段（projectMode/Name/Sha/Entry/AutoPersona/AllowedSubcommands）
     物化逻辑 / chdir / persona 激活 env / allowedSubcommands env

✅ __tests__/unit/packer-manifest-writer.test.js                 9 条
     项目模式 bundledSkills 字段注入 + SHA-256 一致性

✅ __tests__/unit/packer-allowed-commands.test.js                9 条
     createProgram opts.allowedCommands / CC_PROJECT_ALLOWED_SUBCOMMANDS 识别

✅ __tests__/unit/packer-smoke-runner.test.js                    8 条
     HTTP 200 + WS 握手 + /api/skills 断言 + 404 软容忍

✅ __tests__/integration/packer-pipeline.integration.test.js     8 条
     8 阶段顺序 / 烘入值 / --no-smoke-test / 秘钥扫描拦截 / manifest sidecar

✅ __tests__/integration/packer-dry-run.test.js                  3 条
     Phase 1-5 + 停在 pkg 调用前

⚠️ __tests__/e2e/pack-artifact.test.js                          4 条（门禁）
     CC_PACK_E2E=1 + Windows 时启用；CI 按需开启
     真实 pkg / SHA 校验 / 启动 exe / HTTP 200 + WS 101 握手
```

完整测试策略对齐 [cli-pack § 测试覆盖](./cli-pack#测试覆盖) 的分层结构（unit / integration / E2E 门禁）。

---

## 安全考虑

> 本节在基础模式安全模型（见 [cli-pack § 安全考虑](./cli-pack#安全考虑)）之上新增项目模式特有的风险与措施。

| 风险 | 措施 |
|---|---|
| **密钥打进 exe** | secret-scanner 复用（10 类正则），项目 config 命中即拒；无逃生舱 |
| **LLM API keys** | 明确不允许内嵌。keys 由 `<exePath>/.env` 或 `%APPDATA%/.chainlesschain-projects/<id>/.env` sidecar 提供 |
| **第三方 skill node_modules** | collectProjectAssets 检测到 skill 含 `node_modules/` 直接 `PackError`（exit `EXIT.PROJECT`），提示用户先 `cc skill sync-cli` 发布 |
| **物化路径冲突** | user-data 目录后缀为 `<projectName>-<configSha8>`，避免不同版本 / 不同项目同名碰撞 |
| **exe 体积过大** | 项目内容超 50MB 硬拒；需显式 `--force-large-project` 跳过 |
| **递归打包** | 默认白名单已过滤 `pack` 子命令；CC_PACK_MODE=1 沙箱同基础模式 |
| **Windows 路径长度** | user-data 走 `%APPDATA%`；sanitize 后项目名 64 char 以内 |
| **bundledSkills 审计** | 写入 `pack-manifest.json` sidecar；Phase 8 smoke 断言 `/api/skills` 返回集合包含 bundledSkills |

---

## 运行时 env var 覆盖

以下 env var 在 [基础模式覆盖表](./cli-pack#运行时-env-var-覆盖) 基础上新增：

| 环境变量 | 来源 | 说明 |
|---|---|---|
| `CC_PROJECT_ROOT` | 入口脚本写入 | 指向物化后的 user-data 目录；外部覆盖可强制用其他目录（例：`$env:CC_PROJECT_ROOT="D:\cc-data"`） |
| `CC_PACK_AUTO_PERSONA` | 入口脚本写入 | 等同 `config.pack.autoPersona` 的烘入值；skill-loader 启动时读取 |
| `CC_PROJECT_ALLOWED_SUBCOMMANDS` | 入口脚本写入 | 逗号分隔；`createProgram` 在注册 commander 命令前做白名单过滤 |

---

## 故障排除

| 症状 | 根因 | 处理 |
|---|---|---|
| `@yao-pkg/pkg not found` (exit 13) | `pkg` 是 dev-only 工具，`npm i -g chainlesschain` 不会一并装入 | 全局安装时跑 `cd "$(npm root -g)/chainlesschain" && npm install @yao-pkg/pkg`；CLI 已按安装上下文（monorepo / 全局 / 本地）给出对应命令，照着执行即可 |
| `PackError: .chainlesschain/config.json not found` (exit 10) | `--project` 强制模式但 CWD 无 config | 先运行 `cc init` 初始化项目，或切换到正确目录 |
| `PackError: Secrets detected in project config` (exit 16) | config.json 含 apiKey / secret 等字段（10 类正则） | 把 key 移出 config，改用旁边的 `.env` sidecar |
| `PackError: skill contains node_modules` (exit `EXIT.PROJECT`) | skill 目录下存在 node_modules | 运行 `cc skill sync-cli` 发布 skill，再重试 |
| `PackError: Project assets exceed 50MB` (exit `EXIT.PROJECT`) | 项目内容体积过大 | 清理大文件，或确认后加 `--force-large-project` |
| 启动时 user-data 不更新 | configSha 匹配（视为已就绪） | 强制重置：打包时加 `--force-refresh-on-launch`；或删除 user-data 目录 |
| 已存在文件被保留而非覆盖 | `copyRecursiveMerge` 默认保护用户改动 | 日志中 `[cc-pack] Keeping existing file (user-modified):` 为预期 warn；需覆盖时加 `--force-refresh-on-launch` |
| skill 不在 `/api/skills` 返回列表 | skill 目录命名不合规 / frontmatter `name` 缺失 | 检查 `.chainlesschain/skills/<name>/skill.md` 的 `name:` 字段 |
| `/api/skills` 返回 404 但 smoke 通过 | 产物是 Phase 2b 之前的老版本 | 用 CLI 0.156.6+ 重新打包即可获得 endpoint；smoke-runner 软容忍设计 |
| 双击后启动通用 UI 而非项目 UI | CWD 无 `.chainlesschain/` 或 `--no-project` 强制 | 确认用 `--project` 打包，或从项目目录重新打包 |
| 子命令 `cc xxx` 不存在（产物内） | 未在 `allowedSubcommands` 白名单 | 编辑 config 加入对应子命令，重新打包 |

基础模式的故障排除条目（`ERR_VM_DYNAMIC_IMPORT`、`NODE_MODULE_VERSION` ABI mismatch 等）继续适用，见 [cli-pack § 故障排除](./cli-pack#故障排除)。

---

## 关键文件

**项目模式专属**：

- `packages/cli/src/lib/packer/project-assets-collector.js` — Phase 3.5 资产收集
- `packages/cli/__tests__/unit/packer-precheck-project-mode.test.js` — 触发矩阵单测 (26 条)
- `packages/cli/__tests__/unit/packer-project-assets-collector.test.js` — 资产收集单测 (17 条)
- `packages/cli/__tests__/unit/packer-allowed-commands.test.js` — 白名单单测 (9 条)

**改造文件**（在 [cli-pack § 关键文件](./cli-pack#关键文件) 基础上）：

- `packages/cli/src/commands/pack.js` — 新增 `--project` / `--no-project` / `--entry` / `--force-refresh-on-launch` / `--force-large-project` / `--project-config-override`
- `packages/cli/src/lib/packer/precheck.js` — `resolveProjectMode` 触发矩阵 + `sanitizeProjectName`
- `packages/cli/src/lib/packer/pkg-config-generator.js` — BAKED 扩展 + 入口模板 `copyRecursiveMerge` + env var 导出
- `packages/cli/src/lib/packer/manifest-writer.js` — `bundledSkills` 扩展
- `packages/cli/src/lib/packer/smoke-runner.js` — Phase 8 `/api/skills` 断言（404 软容忍）
- `packages/cli/src/lib/packer/index.js` — 8 阶段流水线编排（插入 Phase 3.5）
- `packages/cli/src/lib/web-ui-server.js` — Phase 2b `GET /api/skills` endpoint
- `packages/cli/src/index.js` — `createProgram(opts)` 支持 `allowedCommands` 白名单过滤 + 读 `CC_PROJECT_ALLOWED_SUBCOMMANDS`

**设计文档**：

- [`docs/design/CC_PACK_打包指令设计文档.md`](https://github.com/chainlesschain/chainlesschain/blob/main/docs/design/CC_PACK_%E6%89%93%E5%8C%85%E6%8C%87%E4%BB%A4%E8%AE%BE%E8%AE%A1%E6%96%87%E6%A1%A3.md) — 完整设计规范（v0.4，含 Phase 0-3 实施拆分）

---

## 使用示例

### 场景 1：从零初始化并打包

```bash
mkdir my-bot && cd my-bot
cc init -t assistant           # 生成 .chainlesschain/
# 编辑 config.json 的 name、pack.autoPersona 等字段
cc pack --dry-run              # 验证构建计划，不真正打包
cc pack                        # 自动检测项目模式
# → dist/my-bot-portable-win-x64.exe
```

### 场景 2：强制模式 + 指定入口

```bash
cc pack --project \
        --entry "agent" \
        -o dist/my-headless-agent
# 产物双击直接进入 agent 模式，不启动 Web UI
# allowedSubcommands 仍取 config.pack.allowedSubcommands，未在 flags 中暴露
```

### 场景 3：Dry-run 验证项目资产

```bash
cc pack --project --dry-run --allow-dirty
# Phase 1–5 全跑，输出：
#   - 检测到项目模式: my-medical-agent
#   - bundledSkills: [triage-v1, intake-form, escalation]
#   - configSha: abc12345...
#   - 项目资产体积: 2.3 MB (< 50MB cap ✅)
#   - secret-scan: 0 命中 ✅
```

### 场景 4：企业分发 + TLS + 强制刷新

```bash
cc pack --project \
        --token "$(openssl rand -hex 24)" \
        --bind-host 0.0.0.0 \
        --allow-remote \
        --enable-tls --tls-cert ./cert.pem --tls-key ./key.pem \
        --force-refresh-on-launch \
        -o dist/cc-enterprise-agent-v1
```

`--force-refresh-on-launch` 确保下发新版本时用户数据目录总是同步最新内容。LLM API keys 不写进 exe，改用同目录的 `.env` sidecar 分发。

---

## 相关文档

- **[项目打包 (pack)](./cli-pack)** — 基础打包流水线、参数全集、安全模型（本页共享底层能力）
- **[CC_PACK 打包指令设计文档](https://github.com/chainlesschain/chainlesschain/blob/main/docs/design/CC_PACK_%E6%89%93%E5%8C%85%E6%8C%87%E4%BB%A4%E8%AE%BE%E8%AE%A1%E6%96%87%E6%A1%A3.md)** — 完整设计规范（v0.4，含 Phase 0-3 实施拆分）
- [CLI 分发系统](./cli-distribution) — npm 侧轻量分发（与 `cc pack` 互补）
- [WebSocket 服务 (serve)](./cli-serve) — 产物内 WS 层完整接口
- [配置说明](./configuration) — `.chainlesschain/config.json` 结构
