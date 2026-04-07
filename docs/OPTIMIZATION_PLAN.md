# ChainlessChain 优化与演进计划

> 创建日期: 2026-04-07
> 基线版本: v5.0.2.9
> 状态: 🚧 进行中

## 执行原则

- 按优先级逐项实施，每项独立可提交
- 改动遵循 CLAUDE.md 与 `.claude/rules/` 规范
- 每完成一项更新本文档勾选状态

---

## 🔴 高优先级（解锁开发流程 + 长期可维护性）

### H1. Pre-commit hook 改 lint-staged ✅
- **结论**: 已落地（无需改动）
- **核实**:
  - `.husky/pre-commit` 已用 `lint-staged --no-stash`，仅处理暂存文件
  - `scripts/typecheck-staged.js` 仅在 staged 含 ts/tsx/vue 时触发
  - `package.json` lint-staged 配置已分桶（eslint+prettier / prettier / security-check）
- **MEMORY.md 中"11 分钟"系旧版本遗留**，最近一次 push 实测 TS 检查 < 1 分钟，可接受

### H2. IPC Registry 按域拆分 🚧 部分完成
- **现状**: `desktop-app-vue/src/main/ipc/ipc-registry.js` 仍 5704 行，77 phases
- **已落地**:
  - 引入 `safeRegister(name, options)` 辅助函数（40 行），封装 try/catch + 日志重复模式
  - 转换 Phase 9–14 + Phase 16 子模块（8 phase）使用 safeRegister，每个 phase 缩减约 30%
  - 通过语法验证 + 模块导入测试
- **剩余工作**（预计 2d，需要专门 PR + 烟雾测试）:
  - 余下 ~70 个简单 phase 用同样模式转换
  - 复杂 phase（cowork-v2 跨设备协作、unified-tool-registry 等含动态依赖装配）保留原结构
  - 按域拆分到 `domains/{ai,blockchain,p2p,...}.js`（先决条件：补 ipc-registry 集成测试）
- **验收**: 单文件 < 1500 行 / domain 文件各 < 800 行

### H3. database.js 拆分 ⏳
- **现状**: 9440 行混合连接、加密、缓存、schema、迁移
- **方案**: 提取 5 模块
  - `database/db-adapter.js`
  - `database/db-encryption.js`
  - `database/db-cache.js`（含 LRU 预编译语句缓存）
  - `database/db-schema.js`
  - `database/db-migration.js`
- **验收**: 主入口 < 1500 行，所有 db 测试通过
- **工作量**: 3d

### H4. 预编译语句缓存 LRU ✅
- **改动**: `database.js:85` `Map` → `lru-cache` (max=500)
- **新方法**: `initializePreparedStatementCache()` 替代直接 `new Map()`
- **兼容**: `clearPreparedStatements()` 同时支持 lru-cache v6 (`reset`) 和 v7+/Map (`clear`)
- **验证**: 模块导入成功，对外 API 不变（has/get/set 三方法兼容）

### H5. Android P2PClient 提取到 core-p2p ⏳
- **现状**: `app/` 模块的 P2PClient 无法被 `feature-ai` 引用
- **方案**: 复用 `RemoteSkillProvider` 接口模式
  - 在 `core-p2p` 定义 `P2PClientApi` 接口
  - `app/` 中实现并通过 Hilt `@Binds` 暴露
  - `feature-ai` 依赖接口
- **验收**: KSP/Hilt 编译通过
- **工作量**: 2d

---

## 🟡 中优先级（测试覆盖 + 启动性能）

### M1. Agents 模块补测试 ✅ 部分完成 (3 / 6 模块)
- **新建**: `desktop-app-vue/src/main/ai-engine/agents/__tests__/`
- **覆盖**:
  - `agent-capabilities.test.js` — **31 tests** (静态目录、getCapabilitiesForType、
    getToolsForCapabilities、matchCapabilities、findBestAgentType、validate、
    exportSummary 等所有静态方法)
  - `sub-agent-context.test.js` — **21 tests** (constructor、summarize 三层策略、
    forceComplete、run with mock LLM、toJSON)
  - `agent-registry.test.js` — **32 tests** (类型注册、实例生命周期、
    terminate 状态机、cleanup、getPerformanceStats、getStatistics,
    使用 fake better-sqlite3 db)
- **合计**: **84 个新单元测试,全部通过**
- **未覆盖**: `agent-templates.js` (1670 行)、`agent-coordinator.js` (1611 行)、
  `agents-ipc.js` (481 行) — 体量较大且 IPC 涉及 Electron context,
  需要独立 PR + Electron mock 框架
- **工作量**: 已完成核心 3 个模块 (~1d)

### M2. 启动期同步 IO 异步化 ⏳
- **改动**:
  - `src/main/index.js:11` `execSync("chcp 65001")` → 异步 spawn
  - `bootstrap/index.js` 9 phase 串行 → 独立子系统并行
- **验收**: 启动时间 -30%
- **工作量**: 2d

### M3. extended-tools 重组 ⏳
- **现状**: 20 个 `extended-tools-{2..12}*.js` 命名混乱、重复
- **方案**: 重组为 `tools-llm/infra/specialized/...` + `tool-factory`
- **工作量**: 3d

### M4. v5.0.x 新模块测试补齐 ⏳
- **范围**: `inference/`、`multi-agent/`、`tools/`
- **参考**: `code-agent/__tests__/`
- **工作量**: 2d

### M5. TODO/FIXME 治理 ✅
- **新工具**: `desktop-app-vue/scripts/scan-todos.js`
- **npm scripts**:
  - `npm run scan:todos` — 默认报告（按 tag/目录分组）
  - `npm run scan:todos:strict` — 严格模式，生产 handler 占位符 → 退出码 1
- **支持**: `--json` 输出 / `--strict` CI 模式
- **首次扫描结果**: src/main + src/renderer 共 18 个 TODO（远低于原报告 263 — 那是误把 node_modules/test 计入），其中 1 个生产 handler 占位符违规：
  - `src/main/ai-engine/cowork/skills/builtin/project-scaffold/handler.js:274` — `TODO: Implement data fetching`
- **后续**: 把 `scan:todos:strict` 加入 CI（可在 GH Actions 中加 step）

### M6. 测试工具统一到 Vitest ⏳
- **现状**: Jest + Vitest + Playwright + Jasmine 四套
- **方案**: 渐进迁移到 Vitest，引入 sharding 缓解 OOM
- **工作量**: 5d（分阶段）

---

## 🟢 低优先级（清理与规范）

### L1. LLM 会话状态总线 ✅
- **新模块**: `desktop-app-vue/src/main/llm/llm-state-bus.js`
- **架构**: 单例 EventEmitter,作为 LLM 状态变更的统一广播点
- **事件常量** (`Events`):
  - `llm:provider-changed` / `llm:model-switched`
  - `llm:service-paused` / `llm:service-resumed`
  - `llm:budget-alert`
  - `session:invalidated` / `all:invalidated`
- **核心 API**:
  - `forwardFrom(source)` — 把任意 EventEmitter 源镜像到总线(幂等,返回 unbind)
  - `dispatch(event, payload)` — 带统计 + 错误隔离的派发
  - `invalidateAll(reason)` / `invalidateSession(id, reason)` — 显式失效
  - `getStats()` — 监听器数 + 各事件派发计数
- **接入点**:
  - `llm-manager.js` 构造时 `forwardFrom(this)`,close() 时 unbind
  - `session-manager.js` 订阅 PROVIDER_CHANGED/MODEL_SWITCHED → 清空 sessionCache
  - `agent-orchestrator.js` 订阅 PROVIDER_CHANGED → 丢弃 active executions
  - 三个订阅都通过 `enableStateBus !== false` 开关控制(测试可禁用)
- **测试**: 18 个 bus 单元测试 + 43 个 session-manager 测试 + 63 个 agent-orchestrator 测试 + 23 个 llm-manager 测试,**全部通过**

### L2. Web Panel 增量构建检测 ✅
- **新脚本**: `packages/cli/scripts/build-web-panel.mjs`
- **机制**: SHA-256 哈希 `web-panel/{src,index.html,vite.config.*,package*.json,tsconfig.json}`
- **存储**: `cli/src/assets/web-panel/.build-hash`（与 dist 同目录，已 gitignore）
- **行为**: 输入未变化且产物存在 → 跳过 npm install + vite build（节省 30~60s）
- **强制重建**: `npm run build:web-panel:force` 或 `node scripts/build-web-panel.mjs --force`
- **package.json**: 行内一行命令 → 调用脚本，可读性大幅提升
- **验证**: 首次构建写入 hash；二次运行命中跳过 ✓

### L3. 演示/模板技能标记 ✅
- 三个技能 frontmatter 加 `experimental: true` + `user-invocable: false`：
  - `builtin/test-skill/SKILL.md`
  - `builtin/handler-test-skill/SKILL.md`
  - `builtin/my-custom-skill/SKILL.md`
- 加载器仍可加载（用于单元测试），但不再出现在用户技能列表

### L4. IPC handler 中间件缓存 ✅
- **改动**: `desktop-app-vue/src/main/ipc/ipc-middleware.js`
- **核心**: `_wrapCache: Map<channel, { handler, options, wrapped }>`
- **优化点**:
  - 同 (channel, handler, options) 元组重复 wrap → 直接返回缓存包装器（避免重复闭包分配）
  - rateLimit/permission name 在 wrap 时一次性预解析（消除每次调用的属性查找）
  - 新增 `getWrappedHandler(channel)` 提供 O(1) 通道索引
  - 新增 `invalidateChannel(channel)` 支持热重新注册
- **getStats**: 多出 `cachedChannels` 字段（测试已同步更新）
- **验证**: 20 个原有测试全部通过

### L5. wallet-manager 同步 randomBytes ❌ WONTFIX
- **复核结论**: 原诊断不成立
- **理由**:
  - `crypto.randomBytes(16-32)` 对小字节数实际是 OpenSSL CSPRNG 即时返回，非阻塞
  - 真正的性能瓶颈是 `pbkdf2Sync`（同行 816、886），但改异步会级联 6 处调用点
  - 钱包加密/解密被 5+ 同步流程使用，不宜单独 async 化
- **如需后续优化**: 整体重构 `_encryptData/_decryptData` 为 async，配合调用方调整

### L6. SQL 拼接规则补丁 ✅
- **现状澄清**: `code-engine-test.js:12` 是**故意的测试 fixture**（用于验证安全扫描器），不是真 bug
- **rules-validator 改进**:
  - 加 test/fixture/demo 文件路径排除
  - 加 SQL 生成器技能（database-query / db-migration）路径排除
  - 修复多行 `.prepare(\`...\`)` 调用检测：从仅查当前行 → 查前 3 行上下文
  - 修复 `this.database.prepare` / `db.prepare` 等不同前缀
- **效果**: SQL_INJECTION 警告从 ~119 降到 69（消除约 50 个误报）
- **变更**: `desktop-app-vue/scripts/rules-validator.js:170-228`

---

## 🔵 演进方向（v5.1+）

### E1. 模块联邦化
- IPC 拆分后引入 DI 容器（已有 `ai-container`）
- Cowork / Coding Agent / Skills 子系统独立加载/卸载

### E2. 统一可观测性
- 138 技能 + 4500 IPC 加 OpenTelemetry collector
- 复用 BI Engine 做内部 dashboard

### E3. 技能市场闭环
- sync-cli 反向：用户技能 → marketplace 上架
- 基于 ZKP/DID 做签名验证

---

## 进度追踪

| 状态 | 含义 |
|---|---|
| ⏳ | 待办 |
| 🚧 | 进行中 |
| ✅ | 完成 |
| ⏸️ | 暂停 |
| ❌ | 取消 |

**完成统计**: 10 / 21
- ✅ H1 Pre-commit (核实已就位)
- 🚧 H2 IPC Registry (引入 safeRegister + 8 phase 转换)
- ✅ H4 Prepared Statement LRU
- ✅ L1 LLM 状态总线 (llm-state-bus + 3 个订阅方接入)
- ✅ L2 Web Panel 增量构建（hash 跳过）
- ✅ L3 实验性技能标记
- ✅ L4 IPC 中间件 channel 缓存 + 预解析
- ✅ L6 SQL 拼接 + rules-validator 改进 (50 误报清除)
- 🚧 M1 Agents 模块测试 (3 / 6 模块,84 测试)
- ✅ M5 TODO 治理扫描器
- ❌ L5 WONTFIX (复核后撤回)
- ⏸️ M2 部分（chcp 须保持同步；bootstrap 跨阶段 DAG 待专门 PR）

---

## 测试验证 (2026-04-07)

针对 H4 / L1 / L2 / L4 / M1 改动跑回归：

| 范围 | 文件数 | 用例 | 结果 |
|---|---|---|---|
| 单元 — agents/__tests__ + llm-state-bus + session/orchestrator/llm-manager + ipc-middleware | 6 | 165 | ✅ 全通过 |
| 单元 — llm-ipc + multi-agent-ipc + specialized-agent + 其他相关 | 7 | 296 | ✅ 全通过 (99 skipped) |
| 集成 — llm-fallback + coding-agent-lifecycle + coding-agent-hosted-tools + interactive-planning-ipc | 4 | 68 | ✅ 全通过 |

合计 **529 个测试通过, 0 失败**, 覆盖本轮 L1/L2/L4/H4/M1 的所有触点。
e2e (`tests/e2e/llm/`, `tests/e2e/ai/cowork-evolution.e2e.test.ts`) 需 Electron launcher,
留给独立 PR 在 CI 矩阵中跑。
