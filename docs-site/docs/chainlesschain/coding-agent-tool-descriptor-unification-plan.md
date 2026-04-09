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
