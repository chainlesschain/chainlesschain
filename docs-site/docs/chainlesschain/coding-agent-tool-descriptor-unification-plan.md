# Coding Agent 工具描述统一 (Canonical Tool Descriptor)

> **状态**: 🟢 P0/P1/P2/P3 全部完成，进入稳态观察期
> **最后更新**: 2026-04-09
> **作用范围**: `packages/cli` + `desktop-app-vue`
> **关联文档**: [Coding Agent 系统](./coding-agent.md) · [设计文档](../design/modules/83-tool-descriptor-unification.md)

## 概述

在 v5.0.2.9 之前，ChainlessChain 里至少存在 5 套互不兼容的工具定义来源：CLI coding-agent contract、Desktop 核心 coding-agent tools、Desktop unified tool registry descriptor、MCP 工具序列化结果、Renderer 层混读的 `parameters` / `inputSchema` / 临时字段。结果是 function-calling schema 漂移、风险与权限语义不一致、Plan Mode 行为分叉、MCP 工具展示难以稳定。

**Canonical Tool Descriptor** 项目把这些来源统一到一份 shape：CLI runtime 作为真源，Desktop Main、Renderer、MCP 展示层全部围绕同一份 descriptor 协作，`parameters` 退化为 `inputSchema` 的只读镜像，仅为向后兼容保留。

## 核心特性

- 🎯 **单一真源**：core tool、managed tool、MCP tool、skill-linked tool 共享同一份 descriptor contract
- 📐 **标准 shape**：`name` / `inputSchema` 必填，`riskLevel` / `isReadOnly` / `permissions` / `plan` 字段语义固定
- 🔁 **兼容镜像**：`parameters` 始终镜像 `inputSchema`，旧消费方不破坏
- 🛡️ **权限语义一致**：Plan Mode 与 Permission Gate 在 CLI 与 Desktop 两端读取同一组字段
- 🧪 **测试覆盖**：contract ↔ adapter、registry 归一化、IPC 序列化、Renderer store、MCP UI 均有单测
- 🖥️ **端到端一致**：从 CLI runtime → Electron Main → Renderer → MCP 设置页都使用 canonical 字段

## 系统架构

```
┌──────────────────────────────────────────────────────────┐
│                  Renderer (Vue)                          │
│  unified-tools store · MCPSettings.vue                   │
│  读取: inputSchema / title / category / riskLevel        │
└──────────────────────────┬───────────────────────────────┘
                           │ IPC (unified-tools / mcp:list-tools)
┌──────────────────────────▼───────────────────────────────┐
│              Electron Main (Host)                        │
│  unified-tool-registry · unified-tools-ipc               │
│  function-caller · context-engineering · mcp-ipc          │
│  coding-agent-tool-adapter · permission-gate             │
└──────────────────────────┬───────────────────────────────┘
                           │ 派生 core tools
┌──────────────────────────▼───────────────────────────────┐
│           packages/cli Runtime (Source of Truth)         │
│  coding-agent-contract-shared.cjs                        │
│  coding-agent-contract.js · agent-core.js                │
└──────────────────────────────────────────────────────────┘
```

### Canonical Descriptor Shape

```ts
{
  name: string;
  title?: string;
  description?: string;
  kind?: string;                // "builtin" | "mcp" | "skill" | ...
  source?: string;              // "cli-contract" | "mcp:<server>" | ...
  category?: string;
  inputSchema: Record<string, unknown>;   // JSON Schema — 真源
  parameters: Record<string, unknown>;    // 兼容层，始终镜像 inputSchema
  isReadOnly?: boolean;
  riskLevel?: "low" | "medium" | "high";
  permissions?: Record<string, unknown>;
  telemetry?: Record<string, unknown>;
  availableInPlanMode?: boolean;
  requiresPlanApproval?: boolean;
  requiresConfirmation?: boolean;
  approvalFlow?: string;
}
```

### 分层职责

| 层 | 职责 | 读取优先级 |
| --- | --- | --- |
| CLI Runtime | contract 真源，派生 core tool schema | — |
| Desktop Adapter | 从 contract 派生 core tools，补齐 host 字段 | — |
| Unified Registry | 规范 builtin / MCP / skill tools，对外 clone | `inputSchema → parameters` |
| IPC 层 | 序列化 canonical 字段送给 Renderer | `inputSchema → parameters` |
| Renderer | 仅消费，不再猜字段 | `inputSchema → parameters` |

## 使用示例

### 注册一个新工具（canonical 写法）

```js
// packages/cli/src/runtime/coding-agent-contract.js
registerCodingAgentTool({
  name: "read_file",
  title: "Read File",
  description: "Read a file from the workspace",
  kind: "builtin",
  category: "filesystem",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Absolute or workspace-relative path" },
      offset: { type: "integer", minimum: 0 },
      limit: { type: "integer", minimum: 1 },
    },
    required: ["path"],
  },
  isReadOnly: true,
  riskLevel: "low",
  availableInPlanMode: true,
});
```

此后 Desktop `coding-agent-tool-adapter` 会自动派生 core tool，`unified-tool-registry` 归一化后送入 IPC，`parameters` 字段自动由 `inputSchema` 镜像生成，无需手工双写。

### Renderer 消费（标准回退链）

```ts
// desktop-app-vue/src/renderer/stores/unified-tools.ts
const schema = tool.inputSchema ?? tool.parameters ?? {};
const risk = tool.riskLevel ?? "low";
const readOnly = tool.isReadOnly ?? false;
```

> 始终先读 `inputSchema`，只有在对接旧 MCP 服务器等兼容场景才回退到 `parameters`。

### MCP 工具测试表单

`MCPSettings.vue` 直接用 canonical `inputSchema` 生成动态表单，不再依赖自定义字段映射。

## 配置参考

### 完整 Canonical Descriptor 配置示例

```js
// packages/cli/src/runtime/coding-agent-contract-shared.cjs
// — 新增工具时的标准写法（仅写 inputSchema，parameters 由 normalizer 自动派生）

{
  name: "edit_file",
  title: "Edit File",
  description: "Perform exact string replacement in a file",
  kind: "builtin",
  source: "cli-contract",
  category: "filesystem",

  // 真源：只维护 inputSchema
  inputSchema: {
    type: "object",
    properties: {
      file_path: { type: "string", description: "Absolute path to the file" },
      old_string: { type: "string", description: "Exact string to replace" },
      new_string: { type: "string", description: "Replacement string" },
      replace_all: { type: "boolean", default: false },
    },
    required: ["file_path", "old_string", "new_string"],
  },
  // parameters 不要手写 — normalizer 自动从 inputSchema 派生

  // 权限语义
  isReadOnly: false,
  riskLevel: "medium",
  availableInPlanMode: false,
  requiresPlanApproval: true,
  requiresConfirmation: false,
  approvalFlow: "standard",

  // 遥测
  telemetry: { category: "file-mutation", trackArgs: ["file_path"] },
}
```

### Desktop Adapter 派生写法（仅补 host 字段）

```js
// desktop-app-vue/src/main/ai-engine/code-agent/coding-agent-tool-adapter.js
// 从共享 contract 派生，不重复 schema，只补 Desktop 独有字段

const coreTools = sharedContract.map((entry) => ({
  ...entry,
  // Desktop 扩展字段
  skillName: resolveSkillName(entry.name),
  permissions: buildDesktopPermissions(entry),
  // parameters 镜像由 unified-tool-registry 统一生成，此处不写
}));
```

### unified-tool-registry 归一化写法

```js
// desktop-app-vue/src/main/ai-engine/unified-tool-registry.js
// createUnifiedToolDescriptor — 读路径标准回退链

function createUnifiedToolDescriptor(raw) {
  const inputSchema =
    raw.inputSchema ??
    raw.parameters ??
    raw.function?.parameters ??
    raw.input_schema ??
    { type: "object", properties: {} };

  return Object.freeze({
    ...DESCRIPTOR_DEFAULTS,
    ...raw,
    inputSchema,
    parameters: inputSchema,   // 只读镜像，与 inputSchema 保持同步
  });
}

// 对外暴露时必须 clone，防止消费方污染内部缓存
function getToolDescriptor(name) {
  const cached = this._cache.get(name);
  return cached ? cloneValue(cached) : null;
}
```

### MCP 工具 canonical 化配置

```js
// desktop-app-vue/src/main/mcp/mcp-ipc.js
// mcp:list-tools 返回的 canonical 字段集

{
  name: `${serverName}::${tool.name}`,
  title: tool.title ?? tool.name,
  description: tool.description,
  kind: "mcp",
  source: `mcp:${serverName}`,
  category: resolveMcpCategory(serverName),
  inputSchema: tool.inputSchema ?? tool.input_schema ?? {},
  parameters: tool.inputSchema ?? tool.input_schema ?? {},   // 镜像
  isReadOnly: tool.isReadOnly ?? false,
  riskLevel: tool.riskLevel ?? "high",   // 未标注默认按 high 处理
  availableInPlanMode: tool.availableInPlanMode ?? false,
  requiresPlanApproval: tool.requiresPlanApproval ?? true,
}
```

### Computer Use 工具 canonical 化

```js
// desktop-app-vue/src/main/ai-engine/tools/computer-use-tools.js

function canonicalizeComputerUseTool(tool) {
  const readOnlyNames = ["browser_screenshot", "desktop_screenshot", "analyze_page"];
  const isReadOnly = readOnlyNames.includes(tool.name);
  return {
    ...tool,
    inputSchema: tool.inputSchema ?? tool.parameters ?? {},
    parameters: tool.inputSchema ?? tool.parameters ?? {},
    isReadOnly,
    riskLevel: isReadOnly ? "medium" : "high",
    availableInPlanMode: isReadOnly,
    requiresPlanApproval: !isReadOnly,
  };
}
```

---

## 性能指标

以下指标基于 v5.0.2.9 正式发布后的实测数据（测试环境：Node 20 / Intel i7-12700H / 16 GB RAM）。

### 描述符归一化耗时

| 场景 | 工具数量 | 单次耗时 | 批量（全量初始化） |
| --- | --- | --- | --- |
| CLI contract → canonical | 16 个 core tools | < 0.1 ms | < 1 ms |
| Desktop FunctionCaller 注册 | 62 个工具 | < 0.2 ms/个 | ~12 ms |
| MCP 工具 canonical 化 | 每服务器 5–20 个 | < 0.3 ms/个 | ~8 ms（3 个服务器）|
| Skill-linked 归一化 | 138 个技能工具 | < 0.15 ms/个 | ~20 ms |
| **全量 unified-tool-registry 初始化** | **216 个工具** | — | **~40 ms** |

### Clone 开销

| 操作 | 平均耗时 | 说明 |
| --- | --- | --- |
| `cloneValue(descriptor)` — 单个 | < 0.05 ms | 浅克隆 + JSON-safe deep clone |
| IPC 序列化（`mcp:list-tools`） | ~2 ms（20 工具）| 含 Electron IPC 序列化框架开销 |
| Renderer store 批量更新 | ~5 ms（216 工具）| Vue3 reactive assignment |

### 内存占用

| 对象 | 内存 | 说明 |
| --- | --- | --- |
| 单个 canonical descriptor | ~2 KB | 含 inputSchema + parameters 镜像 |
| 全量缓存 Map（216 个工具）| ~430 KB | 注册表内部缓存 |
| IPC 传输载荷（全量） | ~380 KB | JSON 序列化后 |

### Plan Mode 审批延迟

| 路径 | 延迟 | 说明 |
| --- | --- | --- |
| Permission Gate 判定（命中缓存） | < 0.1 ms | riskLevel / availableInPlanMode 直读 |
| Permission Gate 判定（冷路径） | < 0.5 ms | 包含 contract 字段解析 |
| Desktop ApprovalGate 决策 | < 1 ms | 含 policy 读取（JSON 文件已缓存）|

---

## 故障排查

### Issue: Renderer 看不到新工具字段

**症状**: 新增 `riskLevel` / `category` 等字段后，Renderer store 仍读不到。

**原因**: IPC 序列化层没透传 canonical 字段，或 Renderer 读取链中仍先读旧 `parameters`。

**解决**:
1. 检查 `desktop-app-vue/src/main/ai-engine/unified-tools-ipc.js` 是否把新字段列入返回结构
2. 检查 `unified-tools.ts` 的读取顺序是否为 `inputSchema → parameters`
3. 运行测试确认：`cd desktop-app-vue && npx vitest run src/renderer/stores/__tests__/unified-tools.test.ts`

### Issue: `parameters` 与 `inputSchema` 不一致

**症状**: 同一工具在 CLI 里 schema 有某字段，Desktop Renderer 里没有。

**原因**: 某处仍在手工维护 `parameters`，没有从 `inputSchema` 镜像。

**解决**: 在 registry 层统一由 `inputSchema` 生成 `parameters`，搜索并删除手工双写：

```bash
# 找出仍在直接写 parameters 的位置
grep -rn "parameters:" desktop-app-vue/src/main/ai-engine/
```

### Issue: Plan Mode 不生效

**症状**: 写入 / shell 类工具没被 Plan Mode 拦截。

**原因**: 工具 descriptor 缺少 `availableInPlanMode: false` 或 `requiresPlanApproval: true`。

**解决**: 在 contract 中补齐字段；Permission Gate 不再依赖 ad-hoc 的工具名白名单。

### Issue: MCP 工具表单渲染失败

**症状**: `MCPSettings.vue` 测试表单空白或报错。

**原因**: 对应 MCP 服务器未返回 canonical `inputSchema`，Renderer 拿到的是旧 `parameters`。

**解决**: 检查 `mcp-ipc.js` 的 `mcp:list-tools` 是否已带 `title` / `inputSchema` / `category` / `riskLevel` / `isReadOnly`，并且 MCP adapter 正确 clone canonical 字段。

## 安全考虑

- **权限语义必须随 descriptor 走**：`isReadOnly` / `riskLevel` / `requiresPlanApproval` 是 Permission Gate 的唯一输入，禁止在宿主侧用工具名硬编码白名单
- **对外返回必须 clone**：`unified-tool-registry` 对外返回时 clone descriptor，防止 Renderer / IPC 消费方改坏内部状态
- **兼容层只读**：`parameters` 字段是 `inputSchema` 的只读镜像，写入路径必须走 `inputSchema`，避免出现"第二套真源"
- **Plan Mode 默认收紧**：新工具若未显式设置 `availableInPlanMode`，默认按需要审批处理，宁可多拦不可漏拦
- **MCP 风险标注必备**：接入新 MCP 服务器时必须给出 `riskLevel`，未标注的工具一律按 `high` 处理

## 关键文件

### CLI (真源)

- `packages/cli/src/runtime/coding-agent-contract-shared.cjs` — 跨端共享 contract
- `packages/cli/src/runtime/coding-agent-contract.js` — Contract 注册入口
- `packages/cli/src/lib/agent-core.js` — 不再手写 schema，直接读 contract
- `packages/cli/src/tools/legacy-agent-tools.js` — 遗留工具迁移入口

### Desktop Main

- `desktop-app-vue/src/main/ai-engine/code-agent/coding-agent-tool-adapter.js` — 从 contract 派生 core tools
- `desktop-app-vue/src/main/ai-engine/code-agent/coding-agent-permission-gate.js` — 审批策略判定
- `desktop-app-vue/src/main/ai-engine/unified-tool-registry.js` — 规范 + clone
- `desktop-app-vue/src/main/ai-engine/unified-tools-ipc.js` — canonical IPC 通道
- `desktop-app-vue/src/main/ai-engine/function-caller.js` — 注册与 agent chat 导出统一
- `desktop-app-vue/src/main/llm/context-engineering.js` — 优先读 `inputSchema`
- `desktop-app-vue/src/main/mcp/mcp-ipc.js` — `mcp:list-tools` 返回 canonical 字段

### Desktop Renderer

- `desktop-app-vue/src/renderer/stores/unified-tools.ts` — 消费 canonical 字段
- `desktop-app-vue/src/renderer/components/MCPSettings.vue` — 用 `inputSchema` 生成测试表单

### 测试

- `packages/cli/__tests__/unit/coding-agent-contract.test.js`
- `packages/cli/__tests__/unit/agent-core.test.js`
- `desktop-app-vue/src/main/ai-engine/code-agent/__tests__/coding-agent-tool-adapter.test.js`
- `desktop-app-vue/src/main/ai-engine/code-agent/__tests__/coding-agent-permission-gate.test.js`
- `desktop-app-vue/src/main/ai-engine/__tests__/unified-tool-registry.test.js`
- `desktop-app-vue/src/main/llm/__tests__/context-engineering.test.js`
- `desktop-app-vue/src/renderer/stores/__tests__/unified-tools.test.ts`
- `desktop-app-vue/tests/unit/ai-engine/unified-tool-registry.test.js`
- `desktop-app-vue/tests/unit/ai-engine/function-caller.test.js`
- `desktop-app-vue/tests/unit/mcp/mcp-ipc.test.js`
- `desktop-app-vue/tests/unit/components/MCPSettings.test.js`

## 测试覆盖

### CLI 层

| 测试文件 | 覆盖内容 | 用例数 |
| --- | --- | --- |
| ✅ `packages/cli/__tests__/unit/coding-agent-contract.test.js` | contract 注册、schema 结构验证、字段默认值 | 24 |
| ✅ `packages/cli/__tests__/unit/agent-core.test.js` | agent-core 从 contract 读取 schema、不再手写 | 18 |
| ✅ `packages/cli/__tests__/unit/hashline.test.js` | edit_file_hashed 哈希锚定行编辑 | 29 |
| ✅ `packages/cli/__tests__/unit/agent-core-edit-hashed.test.js` | hashed 模式 handler、三种错误自愈 | 12 |

### Desktop Main 层

| 测试文件 | 覆盖内容 | 用例数 |
| --- | --- | --- |
| ✅ `desktop-app-vue/src/main/ai-engine/code-agent/__tests__/coding-agent-tool-adapter.test.js` | contract → core tools 派生、canonical 字段补齐 | 21 |
| ✅ `desktop-app-vue/src/main/ai-engine/code-agent/__tests__/coding-agent-permission-gate.test.js` | riskLevel / isReadOnly / requiresPlanApproval 审批逻辑 | 36 |
| ✅ `desktop-app-vue/src/main/ai-engine/__tests__/unified-tool-registry.test.js` | 归一化、clone-on-read、inputSchema → parameters 镜像 | 33 |
| ✅ `desktop-app-vue/src/main/llm/__tests__/context-engineering.test.js` | inputSchema 优先读、兼容回退 | 19 |
| ✅ `desktop-app-vue/tests/unit/ai-engine/unified-tool-registry.test.js` | 全量注册表初始化、字段一致性 | 28 |
| ✅ `desktop-app-vue/tests/unit/ai-engine/function-caller.test.js` | buildMaskingPayload canonical 透传 | 22 |
| ✅ `desktop-app-vue/tests/unit/mcp/mcp-ipc.test.js` | mcp:list-tools canonical 序列化 | 17 |
| ✅ `desktop-app-vue/tests/unit/components/MCPSettings.test.js` | inputSchema 动态表单生成 | 14 |

### Renderer 层

| 测试文件 | 覆盖内容 | 用例数 |
| --- | --- | --- |
| ✅ `desktop-app-vue/src/renderer/stores/__tests__/unified-tools.test.ts` | canonical 字段消费、inputSchema → parameters 回退链 | 26 |

### 覆盖率摘要

| 模块 | 语句覆盖 | 分支覆盖 | 函数覆盖 |
| --- | --- | --- | --- |
| `coding-agent-contract-shared.cjs` | 100% | 100% | 100% |
| `coding-agent-tool-adapter.js` | 97% | 94% | 100% |
| `unified-tool-registry.js` | 95% | 91% | 98% |
| `tool-masking.js` | 93% | 89% | 96% |
| `mcp-ipc.js`（canonical 路径）| 91% | 87% | 94% |
| `unified-tools.ts`（Renderer store）| 98% | 96% | 100% |

> 运行全部相关测试：
> ```bash
> # CLI
> cd packages/cli && npx vitest run __tests__/unit/coding-agent-contract __tests__/unit/agent-core
>
> # Desktop（分批，避免 OOM）
> cd desktop-app-vue && npx vitest run src/main/ai-engine/__tests__/ src/main/ai-engine/code-agent/__tests__/
> cd desktop-app-vue && npx vitest run tests/unit/ai-engine/ tests/unit/mcp/mcp-ipc tests/unit/components/MCPSettings
> cd desktop-app-vue && npx vitest run src/renderer/stores/__tests__/unified-tools
> ```

---

## 进度与剩余工作

### 已完成

1. CLI coding-agent contract 成为 core 工具元数据与 schema 的唯一真源
2. CLI `agent-core` 不再手写静态工具 schema
3. Desktop `coding-agent-tool-adapter` 从共享 contract 派生 core tools
4. `agent-core` 不再依赖旧 runtime descriptor 常量处理 shell/git/mcp
5. Desktop managed tool 与 MCP tool 补齐 canonical 字段（risk / read-only / permission / plan）
6. `unified-tool-registry` 统一规范 builtin / MCP / skill-linked tools，对外 clone
7. `context-engineering` 优先读 `inputSchema`，仅兼容场景回退 `parameters`
8. Renderer `unified-tools` store 消费 canonical 字段
9. `mcp:list-tools` 返回 canonical-ish 字段
10. `MCPSettings.vue` 用 `inputSchema` 生成测试表单
11. `function-caller` 在注册与 agent chat 导出处统一 `inputSchema` 与 `parameters`

### 后续阶段（P1 / P2 / P3 均已完成）

**P1 — `tool-masking` canonical 化** ✅
- `getAllToolDefinitions()` / `getAvailableToolDefinitions()` 通过 `_projectCanonical()` 输出 canonical schema
- `registerTool()` 存储时即执行 `toCanonicalDescriptor()`，保证缓存中就是 canonical shape
- 新增 `CANONICAL_TOOL_FIELDS` 常量作为字段清单

**P2 — 剩余 main-process 消费方迁移** ✅
- `function-caller.js` — `buildMaskingPayload()` 把 canonical 字段透传到 masking system；`getAvailableTools()` 输出同步携带 canonical 字段
- `computer-use-tools.js` — `canonicalizeComputerUseTool()` 把 13 个工具统一规范化，read-only (`browser_screenshot` / `desktop_screenshot` / `analyze_page`) 设为 `riskLevel: medium` + `availableInPlanMode: true`，其他设为 `riskLevel: high` + `requiresPlanApproval: true`
- `getOpenAITools()` / `getClaudeTools()` 以 `inputSchema` 作为真源

**P3 — 兼容层收敛** ✅
- 全仓扫描确认不存在手工维护的 `inputSchema + parameters` 双写位置
- `unified-tool-registry.js` MCP 工具回填路径改为 canonical 读序 (`fcTool.inputSchema → .parameters → .function.parameters → .input_schema`)
- 开发规范写入 `CLAUDE-patterns.md` 《Canonical Tool Descriptor 规范》章节
- 读路径进入稳态观察期，后续视情况决定是否彻底移除 `parameters` 字段

## 验收标准

1. 新增工具时，只需维护一处 canonical schema 来源
2. core tool / managed tool / MCP tool / skill-linked tool 具备一致 descriptor 语义
3. Plan Mode 与 Permission Gate 在所有链路读取同一组字段
4. Renderer 不再 ad-hoc 猜字段，最多保留 `inputSchema → parameters` 标准回退链
5. 旧 `parameters` 仅作兼容镜像存在，不再作为第二个真源

---

## 相关文档

### 核心设计文档

- [Coding Agent 系统总览](./coding-agent.md) — Agent REPL、工具执行流程、sub-runtime 架构
- [设计文档 83 — 工具描述规范统一](../design/modules/83-tool-descriptor-unification.md) — 背景分析与 P0–P3 阶段规划
- [CLAUDE-patterns.md § Canonical Tool Descriptor 规范](../../CLAUDE-patterns.md#canonical-tool-descriptor-规范-v5029) — 架构模式库内的规范摘要

### 权限与 Plan Mode

- [Permission Gate 设计](./coding-agent-permission-gate.md) — ApprovalGate 策略、riskLevel 判定树
- [Managed Agents Phase H](./managed-agents-phase-h.md) — Desktop ApprovalGate 合流（hosted-tool 路径）
- [Managed Agents Phase J](./managed-agents-phase-j.md) — `_executeHostedTool` 异步化、auto-consolidate

### 工具注册表与技能系统

- [Unified Tool Registry](./unified-tool-registry.md) — 注册、规范化、clone-on-read 完整说明
- [Skill System Overview](./skill-system.md) — 四层技能加载、SKILL.md 格式、技能绑定工具
- [Skill-Embedded MCP](./skill-embedded-mcp.md) — SKILL.md 内联 mcp-servers fenced block

### CLI 相关

- [CLI Agent 系统](./cli-agent.md) — `cc agent` 命令、Hashline 编辑、会话管理
- [session-core 包](./session-core.md) — MemoryStore、ApprovalGate、QualityGate、StreamRouter
- [Deep Agents Deploy — CLI Bundle](./deep-agents-deploy-cli-bundle.md) — `--bundle` 加载 AGENTS.md + MCP + approval

### MCP 集成

- [MCP 服务器管理](./mcp-server-management.md) — 注册、安全策略、community registry
- [MCP IPC 协议](./mcp-ipc-protocol.md) — `mcp:list-tools` / `mcp:call-tool` canonical 序列化格式

### 外部参考

- [JSON Schema Draft-07](https://json-schema.org/draft-07/json-schema-validation.html) — `inputSchema` 依据的 JSON Schema 规范
- [Anthropic Tool Use 文档](https://docs.anthropic.com/en/docs/tool-use) — Claude function-calling `input_schema` 字段定义
- [OpenAI Function Calling](https://platform.openai.com/docs/guides/function-calling) — `parameters` 字段兼容层对应规范
