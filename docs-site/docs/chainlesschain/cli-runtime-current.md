# CLI Runtime 当前实现（0.162.175）

本文是当前 CLI 运行时的实现快照，适合部署、排障和集成方阅读。设计取舍详见[运行时设计核对](/design/cli-runtime-current)。

## 现在可以使用什么

- `cc agent --bg`：后台启动长任务，返回可持久化的会话 ID。
- `cc attach <id>`：通过本机控制通道继续提问、停止或查看后台 Agent；通道不可用时自动改为日志跟随。
- `cc logs <id>`、`cc daemon status|view|resume|stop`：查看和管理后台会话。
- `Setup` / `Notification` hooks：在命令开始前注入环境并发送会话通知。
- 跨平台 sandbox 与 credential agent：通过统一 broker 对子进程执行做默认隔离。

## 运行结构

```text
cc
 ├─ lazy command dispatch (manifest + help/alias)
 ├─ agent runtime (foreground / background)
 │    └─ local attach (NDJSON/TCP)
 ├─ process-execution-broker
 │    ├─ sandbox
 │    └─ credential agent
 └─ session hooks (Setup/Notification)
```

## 命令入口

主要入口位于：

- `packages/cli/src/cli.js`：启动与注册。
- `packages/cli/src/lazy-dispatch.js`：命令延迟分发。
- `packages/cli/src/lib/background-agent-supervisor.js`：后台会话监督。
- `packages/cli/src/lib/process-execution-broker/`：子进程安全执行。
- `packages/cli/src/lib/session-hooks.js`：通知与会话钩子。

## 平台注意

- Windows 上 `.cmd` 启动、hook 输出清理、后台 attach 路径已修复。
- 本地控制通道优先使用 NDJSON/TCP fallback，需要本地会话凭据。
- 停止后台 Agent 时，supervisor 会校验 PID 与会话绑定关系，避免误杀。

## 验证

在发布或本地验证前，建议执行：

```bash
cd packages/cli
npm test
npm run lint
```

重点覆盖：`agent --bg`、`attach`、`stop`、hooks 输出、Windows 命令分发和 sandbox 能力探测。
