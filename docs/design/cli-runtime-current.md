# CLI Runtime 当前实现核对（0.162.175）

> 更新时间：2026-07-22。本文只记录已经进入当前代码和 Git 主线的运行时能力；路线图与实验性设计仍以各自的计划文档为准。

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
- sandbox 支持平台能力探测；严格配置下引擎不可用会拒绝启动，而不是静默宣称已隔离。

### 4. Hooks

- `Setup` 在命令执行前触发，可注入受控环境变量。
- `Notification` 支持把会话状态转发到配置的通知适配器。
- hooks 输出会经过统一清理；异常输出不会破坏命令 dispatch 或污染后续会话。
- 未注册 hooks 时保持兼容路径，默认不改变既有输出。

## 关键入口

| 领域 | 实现 |
| --- | --- |
| 命令分发 | `packages/cli/src/lazy-dispatch.js`、`command-manifest.json` |
| 后台监督 | `packages/cli/src/lib/background-agent-supervisor.js` |
| 交互协议 | `packages/cli/src/lib/ipc-attach-protocol.js`、`background-session-transport.js` |
| 执行安全 | `packages/cli/src/lib/process-execution-broker/` |
| hooks | `packages/cli/src/lib/session-hooks.js`、`hook-manager.js` |

## 验证口径

本页对应最近提交 `b32e90dce6` 及其前序 CLI 修复/功能提交。发布前应至少执行：

```bash
cd packages/cli
npm test
npm run lint
```

Windows 还应覆盖 `.cmd` 启动、后台 attach、停止自 PID 记录和 hook 输出清理；TCP attach 需要运行对应的 IPC/transport 回归测试。

