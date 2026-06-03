# Coding Agent MVP 工具清单与权限矩阵

## 1. 文档信息

- 项目: `chainlesschain`
- 模块: Coding Agent
- 日期: `2026-04-08`
- 阶段: Phase 0 / Phase 1 / Phase 2
- 状态: CLI 已完成，Desktop 已完成共享策略主线对齐

## 2. 目标

定义 MVP 阶段允许接入的工具集合、权限级别、计划模式行为和审批规则。

这份清单的目标不是覆盖仓库里所有工具，而是控制首版复杂度，优先支撑稳定的代码理解与修改闭环。

## 2.1 当前实现状态

截至 `2026-04-08`：

- CLI 已按本文档落地 `read_file`、`list_dir`、`search_files`、`edit_file`、`write_file`、`run_shell`、`git`
- `git` 已是独立工具，不再只作为 `run_shell` 的命令字符串隐式存在
- plan mode 已支持只读 Git 例外
- CLI 与 Desktop 已共享 `coding-agent-policy.cjs` 的核心权限语义
- CLI 已增加 `coding-agent-shell-policy.cjs`，用于限制 `run_shell` 的命令级行为
- CLI 与 Desktop 已新增共享 `coding-agent-managed-tool-policy.cjs`，用于 managed tool allowlist、trusted MCP server 与高风险 MCP opt-in 判定
- CLI WebSocket coding session 默认只启用 MVP 工具集，扩展工具需通过 `enabledToolNames` 显式打开
- CLI runtime 已支持 trusted/allowlisted MCP server 自动连接，并把本地 MCP 工具注入 coding session
- Desktop 侧的权限门控和审批 UI 已对齐本文档的大部分策略

## 3. MVP 范围

MVP 只保留最核心的 7 类能力：

1. 读取文件
2. 列出目录
3. 搜索文件
4. 编辑文件
5. 写入文件
6. 执行受控 shell 命令
7. 执行受控 git 命令

MCP 不进入 MVP 默认工具集合。

## 4. 权限级别定义

### `read`

只读操作，不修改文件、不启动外部进程、不联网。

### `write`

修改工作区文件，但不直接执行系统命令。

### `execute`

执行本地命令或脚本，具备较高风险。

### `elevated`

需要额外审批或宿主放行的高风险操作，例如：

- 脱离沙箱执行
- 网络下载
- 影响 Git 历史
- 访问工作区外路径

## 5. 工具矩阵

| 工具名 | 用途 | 权限级别 | Plan Mode | 是否需要审批 | 备注 |
| --- | --- | --- | --- | --- | --- |
| `read_file` | 读取文件内容 | `read` | 允许 | 否 | 支持文本文件，后续再扩展 PDF/图片 |
| `list_dir` | 查看目录结构 | `read` | 允许 | 否 | 仅限工作区内 |
| `search_files` | 按文件名或内容检索 | `read` | 允许 | 否 | 优先走 `rg` |
| `edit_file` | 小范围修改现有文件 | `write` | 禁止直接执行 | 是 | 先生成计划，再审批执行 |
| `write_file` | 新建或整体重写文件 | `write` | 禁止直接执行 | 是 | 首版应限制到工作区内 |
| `run_shell` | 执行命令 | `execute` | 禁止直接执行 | 是 | 默认仅允许白名单模式 |
| `git` | 受控 Git 操作 | `execute` | 禁止直接执行 | 是 | `status/diff` 可降级为只读 |

实现状态：

- CLI：已完成
- Desktop：已对齐共享策略主线，跨进程回归仍可继续补强

## 6. 每个工具的最小契约

## `read_file`

输入：

```json
{
  "path": "packages/cli/src/runtime/runtime-factory.js"
}
```

规则：

- 路径必须在工作区内
- 默认只处理文本文件
- 大文件需要截断并返回截断标记

## `list_dir`

输入：

```json
{
  "path": "desktop-app-vue/src/main",
  "depth": 2
}
```

规则：

- 限制最大深度
- 限制最大返回项数

## `search_files`

输入：

```json
{
  "query": "code-agent-ipc",
  "path": "desktop-app-vue/src/main",
  "mode": "content"
}
```

规则：

- 优先使用 `rg`
- 限制结果条数
- 返回文件路径和上下文片段

## `edit_file`

输入：

```json
{
  "path": "desktop-app-vue/src/main/ipc/ipc-registry.js",
  "edits": [
    {
      "oldText": "old snippet",
      "newText": "new snippet"
    }
  ]
}
```

规则：

- 首版优先走精确替换
- 不支持工作区外写入
- 必须先经过计划模式批准

## `write_file`

输入：

```json
{
  "path": "docs/implementation-plans/new-doc.md",
  "content": "# title"
}
```

规则：

- 新建文件允许
- 覆盖现有文件需要更高风险提示
- 必须先经过计划模式批准

## `run_shell`

输入：

```json
{
  "command": "npm run test:jest",
  "cwd": "C:\\code\\chainlesschain",
  "timeoutMs": 120000
}
```

规则：

- 默认只允许工作区内运行
- 首版尽量限制到只读或验证型命令
- 高风险命令必须审批
- 需要结构化返回退出码、stdout、stderr

当前实现说明：

- CLI 已实现结构化 `stdout / stderr / exitCode`
- CLI 已把命令白名单和显式拒绝规则收成独立策略模块 `packages/cli/src/runtime/coding-agent-shell-policy.cjs`
- 当前已显式拦截：
  - 通过 `run_shell` 调用 `git`
  - 删除类命令
  - 网络下载命令
  - `powershell -EncodedCommand`

## `git`

输入：

```json
{
  "command": "status",
  "cwd": "C:\\code\\chainlesschain"
}
```

规则：

- `status`、`diff`、`log` 可视为低风险
- `commit`、`push`、`reset`、`checkout`、`rebase` 属于高风险
- 首版不默认开放破坏性 Git 命令

当前实现说明：

- CLI 已实现独立 `git` 工具
- CLI 计划阶段已允许只读 Git 查询继续执行
- CLI 当前识别的只读 Git 子命令包括：
  - `status`
  - `diff`
  - `log`
  - `show`
  - `rev-parse`

## 7. Plan Mode 行为矩阵

| 工具名 | 计划阶段可调用 | 执行阶段可调用 | 说明 |
| --- | --- | --- | --- |
| `read_file` | 是 | 是 | 计划时允许读取上下文 |
| `list_dir` | 是 | 是 | 计划时允许探查目录 |
| `search_files` | 是 | 是 | 计划时允许定位影响面 |
| `edit_file` | 否 | 是 | 需先形成计划并审批 |
| `write_file` | 否 | 是 | 需先形成计划并审批 |
| `run_shell` | 否 | 是 | 执行前需明确批准 |
| `git` | 部分允许 | 是 | 只读 Git 在计划期可放行，写操作不行 |

建议：

- `git status`
- `git diff`
- `git log --oneline`

可作为计划阶段的只读例外。

当前实现状态：

- CLI：已完成
- Desktop：已完成共享策略对齐

## 8. 审批策略

## 8.1 自动放行

以下情况可自动放行：

- `read_file`
- `list_dir`
- `search_files`
- 计划阶段的只读 Git 查询

## 8.2 需要审批

以下情况必须审批：

- `edit_file`
- `write_file`
- `run_shell`
- 非只读 Git 命令
- 任何访问工作区外路径的操作
- 任何需要脱离沙箱的操作

## 8.3 必须拒绝

MVP 阶段默认拒绝：

- 工作区外递归写入
- 未经审批的破坏性 Git 命令
- 未经审批的网络下载命令
- 删除类工具
- 浏览器自动化和 GUI 控制类工具

## 9. 首版建议的命令白名单

`run_shell` 首版推荐优先允许：

- `npm run test:*`
- `npm run lint`
- `npm run build:*`
- `npx playwright test <single-file>`
- `rg <pattern>`

说明：

- `git status` 和 `git diff` 已迁移到独立 `git` 工具，不再推荐通过 `run_shell` 作为主路径调用

以下命令应默认视为高风险：

- `rm`
- `del`
- `git reset`
- `git checkout --`
- `git clean`
- `curl`
- `wget`
- `powershell -EncodedCommand`

## 10. 后续扩展顺序

不建议在 MVP 同时引入以下工具：

- MCP 通用工具
- 浏览器自动化
- 远程控制
- 多代理委派
- 图像、视频、语音类工具

建议扩展顺序：

1. MCP 只读资源读取
2. 计划持久化
3. 子代理
4. worktree 隔离
5. 背景任务

## 11. 验收标准

- 工具集合控制在 7 个左右
- 每个工具都有稳定 schema
- 每个工具都有明确权限级别
- Plan Mode 是否允许调用有明确定义
- 审批策略可以直接映射到 CLI 和 Desktop

## 12. 当前验收结果

- 工具集合：已完成
- 工具 schema：CLI 已完成
- 权限级别：CLI 已完成
- Plan Mode 定义：CLI 已完成
- CLI tool telemetry：已完成
- session 恢复时保留工具策略上下文：已完成
- Desktop 映射：已完成共享策略主线对齐
- 共享策略模块：已完成
- run_shell 命令策略模块：已完成
- managed tool / MCP 共享策略模块：已完成
- coding session 默认 MVP tool allowlist：已完成
- CLI runtime MCP auto-connect 主线：已完成
- `interrupt` 真实中断链路：已完成
- 最小 harness 状态聚合与后台任务接口：Desktop 已完成
- Desktop harness 面板入口：已完成
- Desktop 后台任务详情抽屉与 history 分页：已完成
- Desktop 后台任务 history “load more” 交互：已完成
- Desktop 后台任务状态筛选 / 搜索 / 抽屉任务切换：已完成
- Desktop 后台任务分页浏览：已完成

已验证测试：

- `packages/cli/__tests__/unit/agent-core.test.js`
- `packages/cli/__tests__/unit/coding-agent-managed-tool-policy.test.js`
- `packages/cli/__tests__/unit/agent-runtime.test.js`
- `packages/cli/__tests__/unit/coding-agent-shell-policy.test.js`
- `packages/cli/__tests__/unit/coding-agent-contract.test.js`
- `packages/cli/__tests__/unit/legacy-agent-tools.test.js`
- `packages/cli/__tests__/unit/ws-session-manager.test.js`
- `packages/cli/__tests__/unit/ws-agent-handler.test.js`
- `packages/cli/__tests__/unit/session-manager.test.js`
- `packages/cli/__tests__/integration/ws-session-workflow.test.js`
- `desktop-app-vue/src/main/ai-engine/code-agent/__tests__/coding-agent-tool-adapter.test.js`
- `desktop-app-vue/src/main/ai-engine/code-agent/__tests__/coding-agent-permission-gate.test.js`
- `desktop-app-vue/src/main/ai-engine/code-agent/__tests__/coding-agent-session-service.test.js`

已验证结果：

- `packages/cli` unit suite 通过
- 通过数：`121 passed / 3078 passed`
- CLI 共享策略定向回归通过：`3 files, 13 passed`
- CLI MCP runtime bootstrap 定向回归通过：`2 files, 13 passed`
- CLI 会话工具 allowlist 定向回归通过：`3 files, 139 passed`
- CLI MCP 主线定向回归通过：`6 files, 170 passed`
- CLI WebSocket session workflow 集成回归通过：`1 file, 19 passed`
- Desktop MCP / host policy 定向回归通过：`3 files, 39 passed`
- Desktop bridge / session-service MCP 跨进程回归通过：`2 files, 46 passed`
- Desktop coding-agent integration 回归通过：`2 files, 15 passed`
- Renderer coding-agent store 回归通过：`1 file, 8 passed`
- AIChatPage coding-agent 页面回归通过：`1 file, 65 passed`
- interrupt 主线定向回归通过：`6 files, 175 passed`
- Phase 5 最小 harness 定向回归通过：`5 files, 84 passed`
- AIChatPage harness 面板 / 详情抽屉 / history / filter / pagination 页面回归通过：`1 file, 75 passed`

## 13. 剩余缺口

- `run_shell` 命令白名单仍偏约定式，尚未完全配置化
- skill 按需装载边界还没有继续下探，当前只完成了 managed tool / MCP 主线
- Desktop 侧还可以继续补 renderer/IPC/CLI 端到端回归，验证策略、事件语义与 harness 状态完全一致
- Phase 5 仍缺子代理、review mode、任务图编排等更高阶 harness 能力
