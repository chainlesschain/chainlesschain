# MCP Tool Search（tool-search）

> 大规模 MCP 工具面的上下文规模化：工具 schema 延迟装载 + `tool_search` 按需检索 + prompt cache 稳定性保障。`cc` v0.162.155 引入，对标 Claude Code ToolSearch。

## 概述

接入多个 MCP server 后，全部工具的完整 `inputSchema` 会作为 `tools` 参数随**每一次** LLM 请求发送。几个大型 server（GitHub、Slack、数据库类）轻松让工具定义吃掉 10–30% 的上下文窗口——对话还没开始，预算已经烧掉一截；且任何工具列表变化都会打爆 prompt cache 前缀。

MCP Tool Search 在工具 schema 的估算 token 超过阈值（默认 auto = 模型窗口的 10%）时自动启用：把每个 MCP 工具定义就地替换为紧凑 stub（工具名 + `[deferred]` 一行摘要 + 空参数），并追加一个内部检索工具 `tool_search`。模型需要某个工具时先检索、拿到完整 schema（从工具结果返回，不改写 tools 数组），再正常调用。未超阈值或显式关闭时，行为与旧版**字节不变**。

## 核心特性

- 🔍 **`tool_search` 内部工具**：`select:<name>` 精确取（逗号分隔多个 / 唯一裸名）；关键词检索（工具名命中 ×3 > 描述 ×1）；`+词` 强制命中工具名
- 🪶 **schema 延迟装载**：deferred 工具只留一行摘要 stub，完整 schema 经工具结果按需返回（对话内容，append-only）
- ⚡ **prompt cache 稳定**：stub 常驻 tools 数组且按字典序排列；晚连接 server 的新工具以 stub 追加末尾、不重排缓存前缀——Anthropic 路径尾部 `cache_control` 断点跨 turn 保持命中
- 🩹 **直调自愈**：未先检索就直接调 deferred 工具 → 返回内嵌完整 schema 的错误并标记已装载（该次调用不出 CLI），重试即通过，最多浪费一轮
- 🎛️ **三态开关 + 阈值 + 白名单**：`enabled: auto|true|false`、`thresholdRatio`、`alwaysLoad`（server 名 / 全名 / `*` glob 永远全量装载）
- 📊 **`/context` 集成**：REPL `/context` 显示 per-server schema token 占用、tool search 状态与优化建议
- 📜 **server instructions 透传**：MCP `initialize` 返回的使用指引随 `tool_search` 结果按 server 附带

## 系统架构

```
resolveAgentMcp (mcp-config.js)
  --mcp-config / cc mcp add / .mcp.json / 插件 / IDE / PDH / IDEA
        │  extraToolDefinitions + externalToolExecutors + instructionsByServer
        ▼
maybeApplyToolSearch (runtime/mcp-tool-search.js)     ← headless-runner /
  ├─ resolveToolSearchConfig  settings 分层 + CC_TOOL_SEARCH     headless-stream /
  ├─ 阈值判定  schema tokens > window × thresholdRatio ?         agent-repl 三处接线
  └─ applyToolSearchDeferral  就地重写（可重入，late-connect 追加）
        │
        ├─ [deferred] stub × N（字典序） + tool_search 定义（末尾）
        └─ toolSearchRegistry { deferred: Map<name→完整定义>, loaded: Set }
        ▼
agentLoop (runtime/agent-core.js)
  ├─ kind:"tool-search" → executeToolSearch（检索 + 标记 loaded + 返回 schema）
  └─ kind:"mcp" → gateDeferredMcpCall（未装载直调→自愈 error）→ mcpClient.callTool
```

## 工作流程

1. **装载期**：MCP 全部 source 解析完成后，`maybeApplyToolSearch` 估算全部 MCP 工具定义的 token 成本，超阈值则执行 deferral 重写，stderr 打印 `mcp: tool search active — N schema(s) deferred (~X tok saved)`。
2. **检索期**：模型看到 `[deferred]` stub 与 `tool_search` 的使用说明，调用 `tool_search({ query: "select:mcp__github__create_issue" })` 或关键词检索；结果携带完整 `parameters`、描述与 server instructions，同时这些工具被标记为已装载。
3. **调用期**：模型按 schema 构造参数直接调用 `mcp__<server>__<tool>`；cc 自己 dispatch（executor 映射），不经 provider 校验，stub 定义不影响执行。
4. **自愈路径**：跳过检索直接调用 → 返回 `error` + `schema` + `description` 的自愈结果并标记已装载，模型重试即成功。

## 配置参考

```jsonc
// .claude/settings.json（用户 / 项目根 / 项目本地 / managed 分层合并，closest wins）
{
  "mcp": {
    "toolSearch": {
      // "auto"（默认）= 按阈值自动；true = 总是延迟；false = 关闭（保持旧行为）
      "enabled": "auto",
      // auto 阈值：MCP schema 估算 tokens > 窗口 × ratio 时启用（默认 0.1）
      "thresholdRatio": 0.1,
      // tool_search 单次默认返回上限（默认 5，调用可用 max_results 覆盖，硬上限 50）
      "maxResults": 5,
      // 永远全量装载（不 defer）：server 名 / mcp__server__tool 全名 / * glob
      "alwaysLoad": ["ide", "mcp__github__create_issue", "mcp__slack__*"],
    },
  },
}
```

```bash
# 环境变量覆盖 settings（最高优先级）
CC_TOOL_SEARCH=1     # 强制启用（无视阈值）
CC_TOOL_SEARCH=0     # 强制关闭
CC_TOOL_SEARCH=auto  # 按阈值（默认）
```

非法配置值一律忽略回退默认（fail-to-defaults，与 `autoMode.decisions` 同语义）；`thresholdRatio` 仅接受 `(0, 1]` 数值，`maxResults` 仅接受 1–50 整数。

## 性能指标

| 操作                                | 目标            | 实测                         | 状态 |
| ----------------------------------- | --------------- | ---------------------------- | ---- |
| deferral 重写（12 工具真实 server） | < 50ms          | 毫秒级（纯内存重写）         | ✅   |
| 上下文节省（12 个大 schema 工具）   | > 50%           | ~14,050 tokens（真机 smoke） | ✅   |
| `tool_search` 检索（进程内）        | < 10ms          | < 1ms（Map 遍历 + 打分）     | ✅   |
| 未启用路径开销                      | 0（字节不变）   | 0（wiring 对象不被触碰）     | ✅   |
| 跨 turn tools 数组稳定性            | 引用+内容双稳定 | 集成测试断言通过             | ✅   |

## 测试覆盖率

```
✅ mcp-tool-search.test.js（30 单测）
  ├── resolveToolSearchConfig — 默认 / settings 分层 / env 覆盖 / 非法值回退
  ├── matchesAlwaysLoad — server 名 / 全名 / glob 锚定不过度匹配
  ├── applyToolSearchDeferral — stub 重写 / 字典序 / 重入 append-only / alwaysLoad 保位
  ├── maybeApplyToolSearch — off 与低于阈值字节不变 / auto 超阈值 / 强制启用
  ├── searchDeferredTools / executeToolSearch — select 与关键词语义 / loaded 标记 / instructions
  ├── gateDeferredMcpCall — 自愈 gate 首拒次过
  └── describeMcpToolContext — /context 口径与建议
✅ agent-tool-search-loop.test.js（3 真 agent-loop 集成）
  ├── search→call 全链路（stub 可见 / schema 在 tool result / dispatch 到 mcpClient）
  ├── 直调自愈两连（首次不出 CLI，重试到达 server）
  └── CC_TOOL_SEARCH=0 legacy 路径等价
✅ 真进程 smoke — cc agent + 真 stdio MCP server（12 工具）auto 阈值命中 + =0 legacy
```

## 安全考虑

- `tool_search` 是**只读本地工具**（同 `list_skills` 风险级），不经审批门，不发起任何网络/进程操作
- deferral 只重写发给 LLM 的工具**定义**，不触碰 executor 路由与权限链——MCP 工具调用仍走原有权限规则 / hooks / 审批
- 自愈 gate 拒绝的直调**不会到达真 server**（防止以猜测参数打真实服务）
- `alwaysLoad` 与全部配置项经 sanitize（非法值回退默认），managed settings 层可由组织策略锁定

## 故障排查

| 症状                                  | 排查                                                                                                          |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 工具描述带 `[deferred]`、参数为空     | 正常——tool search 已激活；模型会先调 `tool_search`。想全量装载：`CC_TOOL_SEARCH=0` 或 `alwaysLoad` 收白名单   |
| 模型调 MCP 工具报 "deferred MCP tool" | 自愈路径——错误里已带完整 schema 且已标记装载，模型重试即过；频发说明模型忽略 stub 提示，考虑 `enabled: false` |
| 未见 "tool search active" 提示        | auto 模式未达阈值（schema 太小）；`CC_TOOL_SEARCH=1` 可强制；stream-json 模式该提示有意静音                   |
| `/context` 无 MCP 一节                | 当前会话没有连接任何 MCP server（`/mcp` 查看连接状态）                                                        |
| 某工具永远搜不到                      | `tool_search` 只索引 deferred 工具；`alwaysLoad` 命中的工具本就全量在 tools 列表里，无需检索                  |

## 关键文件

- `packages/cli/src/runtime/mcp-tool-search.js` — 核心模块（配置解析 / 阈值判定 / deferral 重写 / 检索 / 自愈 gate / context 口径）
- `packages/cli/src/runtime/mcp-config.js` — MCP 装载链 + `instructionsByServer` 聚合
- `packages/cli/src/runtime/agent-core.js` — `kind:"tool-search"` dispatch + mcp 分支前置 gate
- `packages/cli/src/harness/mcp-client.js` — initialize `instructions` 捕获
- `packages/cli/src/repl/agent-repl.js` — REPL 接线 + `/context` MCP 一节
- `packages/cli/__tests__/unit/mcp-tool-search.test.js` / `agent-tool-search-loop.test.js` — 测试

## 使用示例

### 场景 1：大 MCP 面自动省上下文（无需任何配置）

```bash
# 连了 4 个 server、80 个工具 —— schema 超过窗口 10% 时自动激活
cc agent --mcp-config ./mcp.json
#   mcp: github (35 tools)
#   mcp: slack (20 tools) ...
#   mcp: tool search active — 78 schema(s) deferred (~45210 tok saved); ...
```

### 场景 2：强制开启 / 关闭

```bash
CC_TOOL_SEARCH=1 cc agent -p "给 repo 建个 issue" --mcp-config ./mcp.json   # 小面也延迟
CC_TOOL_SEARCH=0 cc agent -p "..." --mcp-config ./mcp.json                  # 保持旧行为
```

### 场景 3：白名单高频工具 + 查看占用

```jsonc
// .claude/settings.json — ide server 与 github 建 issue 保持全量，其余延迟
{
  "mcp": {
    "toolSearch": {
      "enabled": true,
      "alwaysLoad": ["ide", "mcp__github__create_issue"],
    },
  },
}
```

```text
（REPL 内）/context
MCP tool schemas (sent every request):
  github            1240 tok   4%  (35 tools, 34 deferred)
  slack              310 tok   1%  (20 tools, 20 deferred)
  total             1550 tok  (tool search: 54 deferred, 3 loaded, ~43660 tok saved)
```

### 场景 4：模型侧的检索流（自动发生，无需人工干预）

```text
assistant → tool_search({ "query": "+github issue" })
tool     ← { count: 2, tools: [{ name: "mcp__github__create_issue", parameters: {...}, ... }],
             note: "Schemas loaded — call these tools directly ..." }
assistant → mcp__github__create_issue({ title: "...", body: "..." })
```

## 相关文档

- [MCP 服务器管理 (mcp)](./cli-mcp) — server 配置 / 连接 / OAuth / registry
- [Agent 模式命令大全](./cli-agent-mode) — `--mcp-config` / 权限 / `/context` 等
- [代理模式 (agent)](./cli-agent) — agent 内部架构
- [上下文工程](./context-engineering) — 上下文注入与压缩体系
