# CLI Runtime 当前实现核对（0.162.175）

> 更新时间：2026-07-23。本文只记录已经进入当前代码的运行时能力；路线图与实验性设计仍以各自的计划文档为准。

## 当前边界

CLI 运行时由四个相互协作的层组成：命令分发、会话生命周期、工具执行安全和 hooks 事件总线。

```text
cc entry
  ├─ command manifest + lazy dispatch
  ├─ foreground / background agent runtime
  │    └─ local attach transport (NDJSON / TCP fallback)
  ├─ process-execution-broker
  │    ├─ platform sandbox
  │    └─ credential agent
  └─ session hooks (Setup / Notification / lifecycle)
```

## 已落地能力

### 1. 命令分发

- 命令注册以 `packages/cli/src/command-manifest.json` 为索引。
- 启动阶段只解析当前命令需要的模块，lazy dispatch 会保留 `--help`、命令过滤和别名行为。
- Windows 下 hook 输出清理、命令参数处理和 Node.js 22 JSON import 语法已完成兼容性修复。
- 当前顶层命令数保持 **175**，本轮主要是分发稳定性和启动路径修复，没有扩大命令面。

### 2. 后台 Agent 与交互 attach

- `cc agent --bg` 启动独立 worker，并持久化状态、心跳、日志与 phase。
- `cc attach <id>` 在本地控制通道可用时支持发送 follow-up prompt、停止和查看状态；不可用时退化为日志跟随。
- 交互询问通过 attach 回传给 worker，问题不会被错误降级为普通 idle。
- 控制通道优先使用本机 IPC；TCP 传输用于跨平台或 IPC 不可用的场景，仍需本地会话凭据握手。
- supervisor 对自杀 PID、死 PID 和孤儿 worker 有保护，停止操作不会误杀当前 CLI 或被 PID 复用的进程树。

### 3. 执行安全

- `process-execution-broker` 统一 shell 执行入口，跨平台 sandbox 与 credential agent 默认接入。
- 凭据代理向子进程提供受控占位符，避免把长效凭据直接暴露给 agent 工具链。
- 非秘密运行标识使用显式 allowlist：`CC_SESSION_ID`、`CLAUDE_CODE_SESSION_ID` 可以跨 broker 边界；未知 `*_SESSION` 与凭据型变量仍默认过滤。这样既不破坏会话关联，也不放宽通用环境透传。
- sandbox 支持平台能力探测；严格配置下引擎不可用会拒绝启动，而不是静默宣称已隔离。

### 4. 路径与会话隔离

- `getHomeDir()` 的默认值为 `~/.chainlesschain`。
- `CHAINLESSCHAIN_HOME` 是完整运行目录覆盖值，而不是用户 home 的父目录；设置为 `/tmp/cc-run` 时，会话位于 `/tmp/cc-run/sessions/`，不会写入 `/tmp/cc-run/.chainlesschain/sessions/`。
- 配置、状态、服务、日志、缓存和 JSONL 会话共享这条目录契约。单元、集成和 E2E 夹具必须设置独立的 `CHAINLESSCHAIN_HOME`，不得写入开发者真实 home。
- `cc session export` 默认经过 secret scan/redaction；`--no-redact` 是显式可信备份开关。

### 5. Hooks 与进程生命周期

- `Setup` 在命令执行前触发，可注入受控环境变量。
- `Notification` 支持把会话状态转发到配置的通知适配器。
- hooks 输出会经过统一清理；异常输出不会破坏命令 dispatch 或污染后续会话。
- 未注册 hooks 时保持兼容路径，默认不改变既有输出。
- 异步 hooks 受并发上限、去重和单 hook timeout 约束。停止或超时时必须回收 shell 与真实命令形成的整棵进程树，不能只杀 shell 留下孤儿任务。
- POSIX 通过独立进程组和负 PID 信号回收；Windows 优先 `taskkill /T /F`。为处理策略限制下 `taskkill` 非零退出，supervisor 会在终止前一次性读取进程表、构造目标后代树，并按叶子优先顺序兜底终止。
- WMIC 不存在时才使用 PowerShell/CIM，避免在权限拒绝场景重复做高延迟探测。受管沙箱同时禁止进程枚举与树终止时，真实树测试按能力跳过，解析和 fallback 行为由可注入单元测试覆盖。

## 关键入口

| 领域           | 实现                                                                             |
| -------------- | -------------------------------------------------------------------------------- |
| 命令分发       | `packages/cli/src/lazy-dispatch.js`、`command-manifest.json`                     |
| 后台监督       | `packages/cli/src/lib/background-agent-supervisor.js`                            |
| 交互协议       | `packages/cli/src/lib/ipc-attach-protocol.js`、`background-session-transport.js` |
| 执行安全       | `packages/cli/src/lib/process-execution-broker/`                                 |
| 路径契约       | `packages/cli/src/lib/paths.js`、`harness/jsonl-session-store.js`                |
| 异步 hook 回收 | `packages/cli/src/lib/async-hook-supervisor.cjs`                                 |
| hooks          | `packages/cli/src/lib/session-hooks.js`、`hook-manager.js`                       |

## 验证口径

发布前应分别执行三个层级，不能只用默认 `npm test` 代替：

```bash
cd packages/cli
npm run test:unit
npm run test:integration
npm run test:e2e
```

2026-07-23 本轮已完成 E2E 全量分片验证：**59 个测试文件、633 项通过；10 项按环境能力跳过**。单元层新增 Windows 进程表解析与 taskkill-denied 叶子优先 fallback；集成层覆盖真实 hook spawn、后台 idle/finalize、loop home 隔离、plan approval 和文档转换失败路径。

Windows 还应覆盖 `.cmd` 启动、后台 attach、停止自 PID 记录、hook 输出清理和进程树能力探测；TCP attach 需要运行对应的 IPC/transport 回归测试。真实系统能力不可用时，测试必须明确跳过并由注入测试补齐，不得把权限拒绝伪装成功。
