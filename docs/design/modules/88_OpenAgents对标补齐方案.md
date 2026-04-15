# 88. Open-Agents 对标补齐方案 (Open-Agents Parity v1.0)

> **状态**: ✅ Phase 1–5 全部落地（3 agent tools + Skill `$ARGUMENTS` + Sub-agent Profiles + prepareCall turn-scoped context + provider-options 三层深合并, 158 new tests pass）
> **日期**: 2026-04-15
> **作用范围**: `packages/cli`、`desktop-app-vue/src/main/ai-engine`
> **对标对象**: [vercel-labs/open-agents](https://github.com/vercel-labs/open-agents) — Vercel Labs 2025-12 开源云端 Coding Agent 参考蓝本
> **关联文档**: [78. CLI Agent Runtime](./78_CLI_Agent_Runtime重构实施计划.md) · [81. 轻量多 Agent 编排](./81_轻量多Agent编排系统.md) · [83. 工具描述规范统一](./83_工具描述规范统一.md) · [85. Hermes Agent 对标](./85_Hermes_Agent对标实施方案.md)

---

## 1. 概述

### 1.1 背景

Open-Agents 是 Vercel Labs 开源的 Coding Agent 参考实现，核心采用 **Vercel AI SDK v5 + ToolLoopAgent** 模型，三层解耦 `Web → Agent → Sandbox`。通过系统性对比，在「CLI Agent 工具集」「Skill 模板能力」「Subagent 编排」「LLM Provider 参数治理」「Turn-scoped 上下文」五个维度存在可补齐的空白。

**本方案只补齐缺失项，不触碰 ChainlessChain 既有优势**：
- ❌ 不动：Durable Workflow / Vercel Sandbox（我们有 sub-runtime-pool + file-sandbox，架构已分离）
- ❌ 不动：11 工具中已有的 8 个（read/write/edit/grep/bash/task/skill + edit_file_hashed 更强）
- ❌ 不动：AI SDK / AI Gateway（我们自有 llm-manager 多 provider 路由）
- ✅ 补齐：3 个缺失 agent 工具 + Skill `$ARGUMENTS` + Subagent Registry + Turn-scoped prepareCall + Provider-options 深合并

### 1.2 对标差距总览

| 维度 | open-agents | ChainlessChain 现状 | 差距等级 | 方案 |
|------|-------------|---------------------|---------|------|
| **agent 工具：web_fetch** | `web_fetch` 工具注入 agent loop | 仅 CLI 命令 `browse fetch`，agent 不可调用 | **HIGH** | Phase 1 |
| **agent 工具：todo_write** | `todo_write` + 内置 TODO 状态管理 | 无 agent tool（有 CLI 命令但非 loop 工具） | **HIGH** | Phase 1 |
| **agent 工具：ask_user_question** | 结构化提问暂停 agent 等待回复 | slot-filler.js 提及未注册 | **MEDIUM** | Phase 1 |
| **Skill `$ARGUMENTS` 占位符** | SKILL.md body 运行时文本替换 | SKILL.md 无占位符支持 | **MEDIUM** | Phase 2 |
| **Skill directory 路径注入** | 自动前置 `Skill directory: <abs>` 行 | 无 | **LOW** | Phase 2 |
| **Subagent Registry 声明式** | `SUBAGENT_REGISTRY` + buildSubagentSummaryLines | cowork debate/compare/analyze 硬编码 role | **MEDIUM** | Phase 3 |
| **prepareCall turn-scoped 上下文** | 每 turn 注入 sandbox/skills/模型覆盖 | agent-repl messages 一次性构建 | **MEDIUM** | Phase 4 |
| **Provider-options 三层深合并** | defaults ← modelId 推断 ← call overrides | llm-manager 仅决定 provider+model | **MEDIUM** | Phase 5 |
| **Ultracite (oxlint+oxfmt)** | 替代 ESLint/Prettier | ESLint + 现状 | **LOW** | 附录（评估） |

### 1.3 已有优势（不重复造轮子，保留不动）

- **edit_file_hashed**: 内容哈希锚定行编辑，open-agents 的 edit 仍是纯字符串匹配，我们更强
- **git 工具**: open-agents 只有 bash，我们有独立 git 工具 + 策略元数据
- **search_sessions + FTS5**: 跨会话搜索能力
- **138 内置 Skills + 4 层加载**: 远超 open-agents 的 skills/discovery 简易实现
- **sub-runtime-pool**: 子进程池 + sessionId 分片，比 open-agents 单沙盒更灵活
- **4 层记忆 + Hooks 三件套**: Hermes 对标已补齐，open-agents 都不具备

### 1.4 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│              Agent REPL (CLI 入口，不变)                     │
├─────────────────────────────────────────────────────────────┤
│  Agent Core  (新增 3 工具 + 每 turn prepareCall)             │
│  ┌─────────┐┌─────────┐┌────────────┐ [既有 13 工具]        │
│  │web_fetch││todo_write││ask_user_   │ read/write/edit/     │
│  │         ││         ││question    │ grep/bash/git/...     │
│  └─────────┘└─────────┘└────────────┘                       │
├─────────────────────────────────────────────────────────────┤
│  Subagent Registry (新增，声明式)                            │
│  explorer (只读) / executor (全权限) / design (前端)         │
│  + 既有 cowork debate/compare/analyze 迁移到 registry        │
├─────────────────────────────────────────────────────────────┤
│  Skill Parser (增强)                                        │
│  $ARGUMENTS 占位符 + Skill directory 注入                   │
├─────────────────────────────────────────────────────────────┤
│  LLM Manager (增强)                                         │
│  resolveCategory → mergeProviderOptions 三层深合并           │
│  provider defaults ← modelId 推断 ← per-call overrides      │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. 实施方案

### Phase 1: Agent 工具三件套补齐 ✅

**影响**: HIGH | **工作量**: MEDIUM | **实际测试**: 59 新增 tests 全绿（todo-manager 15 + web-fetch 22 + agent-core 执行路径 7 + 既有 5 项计数/列表更新）

**落地位置**:
- `packages/cli/src/runtime/coding-agent-policy.cjs` — 新增 web_fetch / todo_write / ask_user_question 策略条目
- `packages/cli/src/runtime/coding-agent-contract-shared.cjs` — 新增 3 tool contracts（tier=extension）
- `packages/cli/src/runtime/agent-core.js` — executeToolInner 新增 3 case 分支
- `packages/cli/src/lib/todo-manager.js` — session TODO 存储 + 校验（单 in_progress / 唯一 id）
- `packages/cli/src/lib/web-fetch.js` — SSRF 防护 + HTML→MD + 重定向链安全检查
- `packages/cli/__tests__/unit/todo-manager.test.js` / `web-fetch.test.js` — 37 独立单测
- AGENT_TOOLS 从 13 → **16**；Ollama 请求 tools 数同步调整

#### 2.1.1 `web_fetch` 工具

**差距**: 现有 `packages/cli/src/commands/browse.js` 是 CLI 子命令，agent loop 无法调用。

**方案**:
- 在 `coding-agent-contract-shared.cjs` 新增 `web_fetch` 契约
- `inputSchema`: `{ url: string, format?: "markdown"|"html"|"text", maxBytes?: number }`
- 实现复用 `packages/cli/src/lib/browser-automation.js` 的 fetch 逻辑，默认 markdown 抽取（readability-like）
- 策略元数据：`riskLevel: "medium"`, `availableInPlanMode: false`, `requiresPlanApproval: true`（避免任意 URL 滥用）
- 白名单域名 / 大小限制从 `unified-config-manager` 读 `.chainlesschain/config.json:webFetch`

#### 2.1.2 `todo_write` 工具

**差距**: agent 没有结构化 TODO 管理能力，复杂任务靠模型自己维护自然语言计划。

**方案**:
- 新增 `packages/cli/src/lib/todo-manager.js`：session 内 TODO 列表（内存 + 可选持久化到 session record）
- 工具契约 `todo_write`: `{ todos: [{ id, content, status: "pending"|"in_progress"|"completed"|"cancelled" }] }`
- 状态规则：单一 in_progress（强制），完成即时标记
- 与 Plan Mode 集成：Plan 审批通过时自动写入初始 TODO 列表
- REPL `/todo` 命令查看当前 session 的 TODO

#### 2.1.3 `ask_user_question` 工具

**差距**: agent 遇到歧义时只能靠 prompt 自然语言询问，没有结构化暂停+恢复。

**方案**:
- 工具契约 `ask_user_question`: `{ question: string, options?: string[], multiSelect?: boolean }`
- agent-repl 捕获到该工具调用时：暂停 loop → 在 REPL 渲染问题 → `@inquirer/prompts` 收集答案 → 作为 tool result 回填
- 非交互模式（`--headless` / WS gateway）：立即返回 error `"user_not_reachable"`，让 agent 自行决策
- slot-filler.js 既有逻辑重构为该工具的 handler

### Phase 2: Skill 模板增强

**影响**: MEDIUM | **工作量**: LOW | **预计测试**: ~20 tests

#### 2.2.1 `$ARGUMENTS` 占位符

**差距**: SKILL.md body 是静态文本，无法动态接收参数。

**方案**:
- `packages/cli/src/lib/skill-md-parser.js` 新增 `substituteArguments(body, args)`:
  - `$ARGUMENTS` → args 原文拼接
  - `$1`/`$2`/... → args 拆分后按位置替换（shell-like）
  - 未替换占位符保留原样（不报错）
- `run_skill` 工具调用时：`args` 字段 → substituteArguments → 注入 messages

#### 2.2.2 Skill directory 路径注入

**差距**: Skill 内部引用脚本/资源时需要绝对路径，目前靠 prompt 硬写。

**方案**:
- Skill 加载时 loader 记录 `skillDir` 绝对路径
- 调用 `run_skill` 时 body 前自动 prepend 一行：`Skill directory: <abs path>`
- 允许 SKILL.md 内部用相对路径如 `./scripts/foo.sh`，LLM 根据 Skill directory 自行拼绝对路径

### Phase 3: Subagent Registry 声明式化

**影响**: MEDIUM | **工作量**: MEDIUM | **预计测试**: ~30 tests

#### 2.3.1 问题

`src/commands/cowork.js` 中 debate / compare / analyze 的 subagent role 是硬编码 if-else，新增角色要改主流程；prompt 里可用子代理的列表也是手写。

#### 2.3.2 方案

- 新建 `packages/cli/src/lib/subagent-registry.js`:
  - `SUBAGENT_REGISTRY`: Map<name, { shortDescription, systemPrompt, toolAllowlist, model?, maxTurns? }>
  - 内置 3 个：`explorer`（readonly 工具集）/ `executor`（全工具）/ `design`（前端特化，含 css_gen/html_gen）
  - `buildSubagentSummaryLines()`: 返回多行字符串供主 system prompt 拼接
- `spawn_sub_agent` 工具 inputSchema 新增 `subagent: string` 字段，registry 查表注入对应 profile
- cowork debate/compare/analyze 迁移：内部改为 `spawn_sub_agent({ subagent: "executor", ... })`，但对外 CLI 命令保持不变（向后兼容）

### Phase 4: Turn-scoped prepareCall

**影响**: MEDIUM | **工作量**: MEDIUM | **预计测试**: ~25 tests

#### 2.4.1 问题

`agent-repl.js` 启动时构建一次 system prompt 就固化到 messages[0]，运行中无法：
- 切模型（per-call override）
- 热更新 skill 列表
- 动态注入 sandbox / cwd / git status 等易变上下文

#### 2.4.2 方案

- agent-core.js `agentLoop` 每次 iteration 前调用 `prepareCall({ messages, turn, session })`：
  - 返回 `{ systemOverride?, modelOverride?, providerOptions?, toolsFilter? }`
  - 默认实现：注入最新 cwd、git status 摘要、可见 skill 列表
- REPL `/model <id>` 命令改为修改 `session.modelOverride`，下一 turn 生效
- 向后兼容：未提供 prepareCall 时退化到现有静态 system prompt

### Phase 5: Provider-options 三层深合并

**影响**: MEDIUM | **工作量**: LOW | **预计测试**: ~15 tests

#### 2.5.1 问题

`llm-manager.resolveCategory()` 只决定 `{ provider, model }`，`thinking` / `reasoning_effort` / `maxTokens` 等 provider-specific 参数无法分层配置，导致 SKILL.md 里要针对每个 provider 重复写。

#### 2.5.2 方案

- 新增 `llm-manager._mergeProviderOptions(provider, modelId, callOverrides)`:
  1. Layer 1 provider defaults: `llm-config.json:providers.<name>.defaults`
  2. Layer 2 modelId 推断: `getAnthropicSettings(modelId)` / `getOpenAISettings(modelId)` — 按模型自动启用 thinking
  3. Layer 3 per-call overrides: 调用方显式传入
  4. 深合并（非浅 spread），数组替换、对象递归
- `chat()` 接入：`resolveCategory` 返回新增 `options` 字段透传给 provider adapter
- SKILL.md modelHints 扩展 `providerOptions` 字段，由 category routing 统一处理

---

## 3. 用户文档（面向最终用户）

### 3.1 新增 CLI 能力

```bash
# web_fetch：agent 内部自动调用，无直接 CLI（既有 browse 命令不变）

# todo_write：agent 维护，用户可查看
chainlesschain agent
> /todo                         # 显示当前 session TODO
> /todo clear                   # 清空

# ask_user_question：agent 自动触发，用户交互式回答

# Skill 参数
chainlesschain skill run my-skill "arg1 arg2"   # $ARGUMENTS = "arg1 arg2", $1=arg1, $2=arg2

# Subagent 显式指定
chainlesschain cowork analyze ./src --subagent explorer
chainlesschain cowork debate ./foo.js --subagent design
```

### 3.2 配置项

`.chainlesschain/config.json` 新增：

```json
{
  "webFetch": {
    "enabled": true,
    "allowedDomains": ["*"],
    "maxBytes": 2000000,
    "timeout": 15000
  },
  "todos": {
    "persist": true,
    "maxPerSession": 50
  },
  "llm": {
    "providerOptions": {
      "anthropic": { "thinking": { "type": "enabled", "budgetTokens": 8000 } },
      "openai":    { "reasoning_effort": "medium" }
    }
  }
}
```

### 3.3 SKILL.md 增强示例

```markdown
---
name: quick-summarize
description: 总结 $ARGUMENTS 指定的文件
---

# 总结任务

Skill directory 下有辅助脚本，直接调用：

\`\`\`bash
node ./scripts/extract.js $1
\`\`\`

用户请求: $ARGUMENTS
```

---

## 4. 实施节奏与里程碑

| Phase | 工作量 | 依赖 | 预计测试 | 优先级 |
|-------|--------|------|---------|--------|
| Phase 1: 三工具补齐 | ~3 天 | 无 | ~60 | **P0** |
| Phase 2: Skill 增强 | ~1 天 | 无 | ~20 | P1 |
| Phase 3: Subagent Registry | ~2 天 | Phase 1（spawn_sub_agent 扩字段） | ~30 | P1 |
| Phase 4: prepareCall | ~2 天 | 无 | ~25 | P2 |
| Phase 5: Provider-options | ~1 天 | 无 | ~15 | P2 |
| **合计** | **~9 天** | | **~150 tests** | |

### 4.1 验收标准

- [ ] Phase 1：agent 可调用 3 个新工具，headless 模式下 ask_user_question 优雅降级
- [ ] Phase 2：`skill run foo "bar baz"` 正确替换 `$ARGUMENTS` / `$1` / `$2`
- [ ] Phase 3：cowork 3 命令全部走 registry，新增 subagent 只需改一个文件
- [ ] Phase 4：REPL 运行中 `/model` 切换立即生效，不需要重启 session
- [ ] Phase 5：SKILL.md 同一份 providerOptions 在 anthropic / openai 下均能透传
- [ ] 所有新增代码使用 `_deps` 注入模式，Vitest 测试在 forks pool 通过
- [ ] 契约更新同步 `coding-agent-contract-shared.cjs` + `coding-agent-policy.cjs`，遵循 §83 canonical descriptor 规范

### 4.2 不做的事

- **不引入 Bun**：保持 Node 18+ 兼容
- **不引入 Vercel AI SDK**：既有 llm-manager 架构稳定，替换成本过高
- **不引入 Ultracite/oxlint**：现有 ESLint 工作良好，性能非瓶颈（附录单独评估）
- **不引入 Durable Workflow**：sub-runtime-pool + session 持久化已覆盖断线恢复

---

## 5. 风险与规避

| 风险 | 影响 | 规避 |
|------|------|------|
| web_fetch 任意 URL 访问 → SSRF / 信息泄漏 | HIGH | 白名单域名 + Plan Mode 审批 + 默认禁用内网段 |
| todo_write 状态在 crash 时丢失 | MEDIUM | persist: true 时写入 session record，crash recover 时重放 |
| ask_user_question 在 WS gateway 场景阻塞 | MEDIUM | 超时 60s 自动返回 error，agent fallback 到自行决策 |
| prepareCall 破坏 Hermes Phase 4 "冻结提示词" 约定 | HIGH | 只注入增量 context（cwd/git/skills），system prompt 主体仍冻结 |
| Subagent Registry 与既有 `auto sub-agent` 冲突 | LOW | registry 为 opt-in，未指定 subagent 时保持现有行为 |

---

## 6. 附录

### 6.1 Open-Agents 源码引用

- `packages/agent/open-harness-agent.ts:1-145` — ToolLoopAgent 主入口
- `packages/agent/subagents/registry.ts` — SUBAGENT_REGISTRY 定义
- `packages/agent/skills/loader.ts` — extractSkillBody / substituteArguments / injectSkillDirectory
- `packages/agent/models.ts:1-202` — mergeProviderOptions + getAnthropicSettings
- `packages/agent/tools/{web_fetch,todo,ask-user-question}.ts` — 三工具实现

### 6.2 Ultracite 评估（附录，不在本方案范围）

Ultracite = oxlint（Rust 实现 ESLint）+ oxfmt（Rust 实现 Prettier），比 ESLint 快 50–100 倍。CLI package 当前 lint 耗时 < 10s，非瓶颈；但 desktop-app-vue 全量 lint ~60s，可单独立项评估迁移 ROI。

### 6.3 未来扩展

- **Durable Resume**：WS server 长任务断线恢复（当前 sub-runtime-pool 已支持，补文档即可）
- **Agent Registry 跨进程**：registry 扩展到 desktop-app-vue cowork 模块，CLI / 桌面共享 subagent 定义
- **Skill Frontmatter 扩展**：借鉴 open-agents `modelHints.providerOptions`，让 Skill 定义即配置

---

**维护者**: 开发团队
**关联 Memory**: 待补齐后写入 `.claude/memory/open_agents_parity.md`
