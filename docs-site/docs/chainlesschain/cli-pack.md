# 项目打包 (pack)

> **版本: v0.1 Phase 0+1 (CLI 0.156.6, 2026-04-23) | 状态: 🧪 预览 (Phase 2 pkg 调用与代码签名待补) | 7 阶段流水线 | 73 单元/集成测试**
>
> `cc pack` 把当前项目环境打包成单文件可执行程序，内嵌 WebSocket 服务、完整 Vue Web UI 与 SQLite 模板，收件人无需安装 Node.js 或 npm 即可运行。

## 概述

`cc pack` 是 ChainlessChain CLI 自 0.156.6 起提供的分发指令。它基于 [@yao-pkg/pkg](https://github.com/yao-pkg/pkg) 把 CLI + `web-panel/dist/` + `better-sqlite3` 原生预构建 + 配置模板一起打进一个单文件可执行程序（Windows x64 产物约 80–150 MB，取决于是否附带模型），运行时在首次启动时把 `.chainlesschain/` 模板释放到用户数据目录，随后监听 WebSocket 与 Web UI 端口。

与 [CLI 分发系统](./cli-distribution) 的区别：`cli-distribution` 解决的是把 ~2MB 纯 JS npm 包 + 按需下载的桌面二进制分发到终端用户；`cc pack` 则把**当前项目的具体状态**（包含自定义 skill、自定义配置模板、定制 Web UI）冻结成一份独立产物，适合企业内部 / 离线环境 / 演示机交付。

## 核心特性

- 📦 **7 阶段流水线**: precheck → ensureWebPanel → buildConfigTemplate → collectPrebuilds → generatePkgConfig → runPkg → writeManifests
- 🔐 **密钥扫描**: Phase 3 对 `--preset-config` 扫描 10 种敏感键（apiKey/secret/mnemonic/privateKey/password/token/accessToken/refreshToken 等），命中即拒绝打包，除非显式 `--allow-secrets`
- 🪟 **Web UI 完整嵌入**: Phase 2 强制要求 `web-panel/dist/` 存在或可构建，产物启动即可通过 `http://localhost:18810` 访问完整面板（非 minimal 降级）
- 🗄️ **原生模块回退**: Phase 4 按 `--targets` 收集 `better-sqlite3` 预编译 `.node`；若缺失则自动回退到 `sql.js` (WASM)，产物仍可运行
- 🔒 **CC_PACK_MODE 沙箱**: 产物启动时设置 `CC_PACK_MODE=1`，WebSocket 层默认阻断 `serve`/`setup`/`pack` 递归调用，但解锁 `chat`/`agent` 供 Web UI 高级面板使用
- ✍️ **产物清单与校验**: Phase 7 为每个产物生成 sidecar `.pack-manifest.json`，含 SHA-256、git commit、打包时配置、内嵌端口
- 🏃 **Dry-run 计划**: `--dry-run` 只跑 Phase 1–5 输出 `pkg-config.json` 构建计划，不调用 `@yao-pkg/pkg`，用于 CI 门禁或调试
- 🎯 **单入口脚本**: Phase 5 合成独立的 `pack-entry.js`，不污染真实 CLI 的 `package.json`，`@yao-pkg/pkg` 的所有 `assets`/`scripts` 配置局限于临时目录

## 系统架构

```
┌────────────────────────────────────────────────────────────────┐
│                      cc pack 流水线                             │
│                                                                │
│  [1] precheck           git / node_modules / cliRoot 校验      │
│       │                                                        │
│       ▼                                                        │
│  [2] ensureWebPanel     web-panel/dist 存在或 npm run build    │
│       │                                                        │
│       ▼                                                        │
│  [3] buildConfigTemplate 扫描密钥 + 合成 config.example.json   │
│       │                      (10 种 SECRET_PATTERNS)           │
│       ▼                                                        │
│  [4] collectPrebuilds   better-sqlite3 .node → tempDir/        │
│       │                 缺失 → sql.js WASM 回退                │
│       ▼                                                        │
│  [5] generatePkgConfig  合成 package.json + pack-entry.js      │
│       │                 (注入 CC_PACK_MODE=1 / token / ports)  │
│       ▼          ────── 这里停在 --dry-run ─────               │
│  [6] runPkg             @yao-pkg/pkg → dist/*.exe              │
│       │                                                        │
│       ▼                                                        │
│  [7] writeManifests     .pack-manifest.json + SHA-256          │
│                                                                │
└────────────────────────────────────────────────────────────────┘

产物启动时:
┌───────────────────────────────────────────┐
│  chainlesschain-portable-*.exe            │
│    ├── 释放 .chainlesschain/ 到用户数据目录 │
│    ├── 启动 WS  :18800 (CC_PACK_MODE=1)   │
│    └── 启动 UI  :18810 (uiMode=full)      │
└───────────────────────────────────────────┘
```

## 配置参考

完整参数见 `cc pack --help`。按用途分组如下：

**基本输入输出**:

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `-o, --output <path>` | `dist/chainlesschain-portable-<target>` | 产物路径（不含扩展名，Windows 自动追加 `.exe`） |
| `-t, --targets <list>` | `node20-win-x64` | 逗号分隔的 pkg 目标平台列表 |
| `--cwd <dir>` | `process.cwd()` | 覆盖项目根目录 |

**运行时默认值（烘焙进产物）**:

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--ws-port <n>` | `18800` | 产物启动时的 WebSocket 端口 |
| `--ui-port <n>` | `18810` | 产物启动时的 Web UI 端口 |
| `--token <str>` | `auto` | 访问 token；`auto` 表示首次启动时生成并写入 `.chainlesschain/token` |
| `--bind-host <host>` | `127.0.0.1` | 默认绑定地址 |
| `--allow-remote` | `false` | 将默认绑定改为 `0.0.0.0`，允许远程访问 |
| `--enable-tls` | `false` | 产物运行时启用 TLS |
| `--tls-cert <path>` / `--tls-key <path>` | — | TLS 证书与私钥路径 (PEM) |

**内容纳入策略**:

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--preset-config <path>` | — | 预置 `config.json` 模板（会扫描密钥） |
| `--allow-secrets` | `false` | 跳过密钥扫描（⚠️ 危险） |
| `--include-db` / `--no-include-db` | `true` | 是否打入 DB 初始化模板 |
| `--include-models` | `false` | 是否打入本地 LLM 模型（产物体积激增） |
| `--access-policy <path>` | — | 预置访问策略 JSON |

**构建与验证**:

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--compress` / `--no-compress` | `true` | 启用 pkg GZip 压缩 |
| `--smoke-test` / `--no-smoke-test` | `true` | 产物构建完成后运行冒烟测试 (Phase 2 完成后启用) |
| `--sign <cert>` / `--sign-password <pass>` | — | 代码签名证书 (Phase 2) |
| `--dry-run` | `false` | 只跑 Phase 1–5，输出构建计划 |
| `--skip-web-panel-build` | `false` | 复用已有 `web-panel/dist`，跳过 Phase 2 的 `npm run build` |
| `--allow-dirty` | `false` | 允许在工作树有未提交修改时打包 |

## 性能指标

| 操作 | 目标 | 实际 (Phase 0+1 dry-run) | 状态 |
|------|------|------|------|
| `--dry-run` 全程 (7 阶段中的 1–5) | < 10s | ~ 3–6s (含 web-panel 检查) | ✅ |
| Phase 2 首次构建 `web-panel/dist` | 依赖项目 | ~ 30–60s | — |
| Phase 2 复用现有 dist (`--skip-web-panel-build`) | < 2s | ~ 0.3s | ✅ |
| Phase 3 密钥扫描 (preset 配置) | < 500ms | ~ 50ms (10 种正则) | ✅ |
| Phase 4 原生模块收集 (Win x64) | < 3s | ~ 1–2s | ✅ |
| Phase 6 `@yao-pkg/pkg` 打包 (预期 Phase 2 落地) | 60–180s | 待测 | 🧪 |
| 产物启动冷启动 (释放模板 + 监听端口) | < 5s | 待测 | 🧪 |
| 产物体积 (Win x64，不含模型) | 80–150 MB | 待测 | 🧪 |

## 测试覆盖

```
✅ Phase 0 (17 tests)
  ├── ws-server.test.js            isCommandBlocked / CC_PACK_MODE 解锁
  ├── web-ui-server.test.js        uiMode=auto|full|minimal 策略
  └── commands-ui.test.js          cc ui --ui-mode flag 穿透

✅ Phase 1 packer (56 tests)
  ├── packer-precheck.test.js              (70 行)
  ├── packer-config-template-builder.test.js (237 行, 10 SECRET_PATTERNS)
  ├── packer-native-prebuild-collector.test.js (151 行)
  ├── packer-pkg-config-generator.test.js  (140 行)
  ├── packer-manifest-writer.test.js       (134 行, SHA-256)
  └── integration/packer-dry-run.test.js   (104 行, E2E Phase 1-5)

总计: 73 新增测试, 全绿
E2E 验证: cc pack --dry-run --skip-web-panel-build --allow-dirty ✅
```

## 安全考虑

### 密钥泄漏防护

Phase 3 的密钥扫描是**硬门禁**。`SECRET_PATTERNS` 包含 10 条正则，匹配常见敏感字段路径：

```
/(^|\.)apiKey$/i   /(^|\.)api_key$/i   /(^|\.)secret$/i
/(^|\.)privateKey$/i   /(^|\.)private_key$/i
/(^|\.)mnemonic$/i   /(^|\.)password$/i
/(^|\.)token$/i   /(^|\.)access_token$/i   /(^|\.)refresh_token$/i
```

任何匹配路径上的**非空字符串值**都会导致打包中止并列出命中路径。原因：如果打包方意外把自己的 API Key 塞进 preset 配置，每一份下发的产物都会携带同一把钥匙。`--allow-secrets` 仅在调试或明确接受此风险时使用。

### 产物运行时沙箱

产物启动时设置 `CC_PACK_MODE=1`，`packages/cli/src/gateways/ws/ws-server.js` 的 `isCommandBlocked` 函数据此执行差异化策略：

- **永久阻断**: `serve`、`setup`、`pack`（防止递归启动 WS、打开交互 TTY、自打包）
- **pack 模式解锁**: `chat`、`agent`（这两个命令在普通 CLI 场景下也被 WS 阻断，但在产物内是 Web UI 的核心能力，需要放行）

### 网络暴露

默认 `--bind-host 127.0.0.1`，产物只监听回环地址。`--allow-remote` 会将默认值改为 `0.0.0.0`，此时**必须**同时指定 `--token <str>`（不使用 `auto`）或 `--enable-tls --tls-cert --tls-key`，否则等同于把完整 Web UI 与 WS 命令面直接暴露到局域网。

### 产物完整性

Phase 7 为每个产物写 sidecar `.pack-manifest.json`，含：

- `sha256`: 产物文件的 SHA-256
- `gitCommit` / `gitDirty`: 打包时的源代码状态
- `targets` / `ports` / `includeDb` / `includeModels`: 构建参数回溯
- `builtAt`: ISO 时间戳

收件人在运行前应校验 manifest 中的 `sha256` 与下发信道公布的一致。

## 故障排除

| 问题 | 解决方案 |
|------|---------|
| `Working tree is dirty` (exit 2) | 先提交 / 贮藏修改；或调试时加 `--allow-dirty` |
| `web-panel/dist not found and build failed` (exit 3) | 先手动 `cd desktop-app-vue && npm run build`，再 `cc pack --skip-web-panel-build` |
| `Secrets detected in preset config: ...` (exit 4) | 清理 preset 配置中的真实密钥；或**确认无误后**显式 `--allow-secrets` |
| `No native SQLite driver found AND sql.js not installed` (WARN) | 在项目根 `npm install sql.js`，让产物运行时回退到 WASM 驱动 |
| `@yao-pkg/pkg not found` (Phase 6) | `npm install -g @yao-pkg/pkg` 或把它加进项目 devDependencies |
| 产物启动后 `Web UI not available (uiMode=full)` | Phase 2 没有成功构建 `web-panel/dist`；用 `--dry-run` 观察 Phase 2 日志 |
| 产物端口占用 | `chainlesschain-portable-*.exe --ws-port 19800 --ui-port 19810` 运行时覆盖 |

## 关键文件

- `packages/cli/src/commands/pack.js` — Commander 注册 + 参数透传
- `packages/cli/src/lib/packer/index.js` — 7 阶段流水线编排
- `packages/cli/src/lib/packer/precheck.js` — Phase 1 git / node_modules 校验
- `packages/cli/src/lib/packer/web-panel-builder.js` — Phase 2 Web UI 构建
- `packages/cli/src/lib/packer/config-template-builder.js` — Phase 3 密钥扫描 + 模板合成
- `packages/cli/src/lib/packer/native-prebuild-collector.js` — Phase 4 better-sqlite3 收集
- `packages/cli/src/lib/packer/pkg-config-generator.js` — Phase 5 pkg 配置与 pack-entry.js 合成
- `packages/cli/src/lib/packer/pkg-runner.js` — Phase 6 @yao-pkg/pkg 调用
- `packages/cli/src/lib/packer/manifest-writer.js` — Phase 7 sidecar manifest + SHA-256
- `packages/cli/src/lib/packer/errors.js` — `PackError` 与 `EXIT` 退出码定义
- `packages/cli/src/gateways/ws/ws-server.js` — `isCommandBlocked` / `CC_PACK_MODE` 沙箱
- `packages/cli/src/lib/web-ui-server.js` — `uiMode` 策略（auto / full / minimal）
- `docs/design/CC_PACK_打包指令设计文档.md` — 完整设计文档 (v0.1, 1186 行)

## 使用示例

### 场景 1：验证构建计划 (dry-run)

```bash
cd /path/to/project
cc pack --dry-run --skip-web-panel-build --allow-dirty
```

在不调用 `@yao-pkg/pkg` 的前提下完整跑 Phase 1–5，确认 precheck / web-panel 路径 / 密钥扫描 / 原生模块收集 / pkg 配置都成立。CI 可以把它当作打包门禁。

### 场景 2：最小打包 (当前平台)

```bash
cd desktop-app-vue && npm run build        # 确保 web-panel/dist 是最新
cd /path/to/project
cc pack --skip-web-panel-build -o dist/cc-portable
```

默认 `--targets node20-win-x64`，产物输出到 `dist/cc-portable.exe` + `dist/cc-portable.exe.pack-manifest.json`。

### 场景 3：带预置配置的企业分发

```bash
# preset 配置里写好 LLM provider、默认 workspace、审批策略（但不要写 API Key）
cc pack \
  --preset-config ./enterprise-preset.json \
  --token "$(openssl rand -hex 24)" \
  --bind-host 0.0.0.0 \
  --allow-remote \
  --enable-tls --tls-cert ./cert.pem --tls-key ./key.pem \
  -o dist/cc-enterprise-v1
```

密钥扫描会拒绝 preset 里任何形似 `apiKey`/`secret` 的非空字段；改用显式 `--token` + TLS 保护远程访问。

### 场景 4：多平台打包 (Phase 2 就绪后)

```bash
cc pack --targets node20-win-x64,node20-linux-x64,node20-macos-arm64 \
        -o dist/cc-portable
# → dist/cc-portable-win.exe, dist/cc-portable-linux, dist/cc-portable-macos
```

⚠️ Phase 2 尚未实现交叉打包对应平台的 `better-sqlite3` 预构建收集，当前非当前平台的目标会回退到 `sql.js`。

## 相关文档

- [CLI 分发系统](./cli-distribution) — npm 侧的 ~2MB 轻量分发（与 `cc pack` 互补）
- [WebSocket 服务 (serve)](./cli-serve) — 产物内 WS 层的完整接口
- [Web 管理面板 (ui)](./cli-web-panel) — 产物内 Web UI 的能力与 `--ui-mode`
- [配置说明](./configuration) — `.chainlesschain/config.json` 结构
- [CC_PACK 打包指令设计文档](https://github.com/chainlesschain/chainlesschain/blob/main/docs/design/CC_PACK_打包指令设计文档.md) — 完整设计 (Phase 2+ 远程访问、RBAC、审计日志、代码签名详细规范)
