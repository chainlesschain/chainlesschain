# CLI Runtime 当前实现（0.162.177）

> 更新时间：2026-07-24。

本文是当前 CLI 运行时的实现快照，适合部署、排障和集成方阅读。设计取舍详见[运行时设计核对](/design/cli-runtime-current)。

## 现在可以使用什么

- `cc agent --bg`：后台启动长任务，返回可持久化的会话 ID。
- `cc attach <id>`：通过本机控制通道继续提问、停止或查看后台 Agent；通道不可用时自动改为日志跟随。
- `cc logs <id>`、`cc daemon status|view|resume|stop`：查看和管理后台会话。
- `Setup` / `Notification` hooks：在命令开始前注入环境并发送会话通知。
- 跨平台 sandbox 与 credential agent：通过统一 broker 对子进程执行做默认隔离。
- 技能进程安全：CLI-Anything 与 CLI 指令技能包生成的 handler 通过宿主 Process Broker 执行，不再直接导入 `child_process`。
- `cc session export <id>`：默认扫描并脱敏会话中的 API Key、JWT、连接串等秘密；只有显式 `--no-redact` 才保留原文。
- `CHAINLESSCHAIN_HOME=<dir>`：把配置、会话、状态、日志和缓存统一隔离到指定目录，适合 CI、多项目或便携部署。

## 运行结构

```text
cc
 ├─ lazy command dispatch (manifest + help/alias)
 ├─ agent runtime (foreground / background)
 │    └─ local attach (NDJSON/TCP)
 ├─ process-execution-broker
 │    ├─ sandbox
 │    └─ credential agent
 ├─ skill-process-broker
 │    └─ frozen host facade → process-execution-broker
 ├─ async-hook supervisor (timeout + process-tree reap)
 └─ session hooks (Setup/Notification)
```

## 命令入口

主要入口位于：

- `packages/cli/src/cli.js`：启动与注册。
- `packages/cli/src/lazy-dispatch.js`：命令延迟分发。
- `packages/cli/src/lib/background-agent-supervisor.js`：后台会话监督。
- `packages/cli/src/lib/process-execution-broker/`：子进程安全执行。
- `packages/cli/src/lib/skill-process-broker.js`：为声明 `shell-exec` 的技能创建冻结、带权威来源的进程 facade。
- `packages/cli/src/lib/cli-anything-bridge.js`、`lib/skill-packs/generator.js`：生成使用 Broker 的技能 handler。
- `packages/cli/src/lib/async-hook-supervisor.cjs`：异步 hook 并发、超时与进程树回收。
- `packages/cli/src/lib/paths.js`：`CHAINLESSCHAIN_HOME` 与运行目录解析。
- `packages/cli/src/lib/session-hooks.js`：通知与会话钩子。

## 平台注意

- Windows 上 `.cmd` 启动、hook 输出清理、后台 attach 路径已修复。
- Windows 异步 hook 优先使用 `taskkill /T /F` 回收整棵进程树；当系统允许枚举但拒绝 `taskkill` 时，会先快照后代 PID 并从叶子向上兜底终止。受限沙箱若同时禁止枚举和终止，只能回收当前可控子进程并显式跳过真实树终止测试。
- 本地控制通道优先使用 NDJSON/TCP fallback，需要本地会话凭据。
- 停止后台 Agent 时，supervisor 会校验 PID 与会话绑定关系，避免误杀。

## 配置目录约定

默认运行目录是 `~/.chainlesschain`。设置 `CHAINLESSCHAIN_HOME` 时，该值就是运行目录本身，不会再追加一层 `.chainlesschain`：

```bash
CHAINLESSCHAIN_HOME=/tmp/cc-ci cc session list
# 会话文件：/tmp/cc-ci/sessions/<id>.jsonl
# 主配置：  /tmp/cc-ci/config.json
```

credential agent 会保留运行所需的非秘密会话标识（如 `CC_SESSION_ID`、`CLAUDE_CODE_SESSION_ID`），但仍过滤未知的 `*_SESSION` 变量与长效凭据，避免把无关宿主环境透传给子进程。

## 生成技能的进程边界

- 只有声明 `capabilities: [shell-exec]` 的技能会获得 `context.processBroker`。
- facade 只暴露 `run`、`runSync`、`runFileSync`，并由宿主冻结；`origin=skill:<id>`、`scope=skill` 和插件来源由宿主写入。
- CLI-Anything 把用户输入解析为字面 argv，并使用 `shell:false`；危险 shell 字符和未闭合引号会被拒绝。
- CLI 指令技能包先校验域内命令白名单与 shell 元字符，再通过 Broker 调用 `chainlesschain`。
- 报错 `Process Broker unavailable for skill execution` 时，应升级 CLI 并重新生成/注册技能，不要修改 handler 绕过检查：

```bash
npm i -g chainlesschain@latest
chainlesschain skill sync-cli --force
chainlesschain cli-anything register <name> --force
```

## 验证

在发布或本地验证前，建议执行：

```bash
cd packages/cli
npm run test:unit
npm run test:integration
npm run test:e2e
```

`0.162.177` 发布门已通过 Ubuntu、Windows、macOS 的 unit / integration / E2E 全矩阵、Linux 打包 dry-run，以及三平台 `--version` / `--help` 启动校验。本地单元四分片合计 **24,562 项通过、5 项跳过**；技能 Broker 相关定向回归 **9 个文件、122 项通过**。
