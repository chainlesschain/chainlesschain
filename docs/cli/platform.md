# CLI — Platform Services

> Parent: [`../CLI_COMMANDS_REFERENCE.md`](../CLI_COMMANDS_REFERENCE.md)
>
> Covers: Phase 9 Low-Code, EvoMap, CLI-Anything, Server & Web Panel, AI Orchestration.

## Phase 9: Low-Code & Multi-Agent

```bash
chainlesschain lowcode create / components / publish
```

## EvoMap & CLI-Anything

```bash
chainlesschain evomap search / download / publish / list / hubs
chainlesschain cli-anything doctor / scan / register / list / remove
```

## Server & Web Panel

```bash
chainlesschain serve                            # WebSocket 服务器 (端口 18800)
chainlesschain serve --port 9000 --token <s>    # 自定义端口 + 鉴权
chainlesschain serve --bundle ./agent-bundle    # 为所有会话加载 bundle (AGENTS.md + MCP + 审批)
chainlesschain ui                               # Web 面板 (端口 18810)
chainlesschain ui --port 18810 --ws-port 18800 --token <s>
```

## AI Orchestration

```bash
chainlesschain orchestrate "task"               # 自动检测 AI Agent
chainlesschain orchestrate "task" --backends claude,gemini --strategy parallel-all
chainlesschain orchestrate detect               # 检测 AI CLI 工具
chainlesschain orchestrate --status [--json]    # 查看状态
chainlesschain orchestrate --webhook [--webhook-port 9090]
```
