# CLI Commands Reference

> Command reference for `chainlesschain` CLI (also available as `cc`, `clc`, `clchain`).
>
> This file is a thin index — detailed command listings live in [`docs/cli/`](./cli/).
> Read the sub-files on demand to avoid bloating agent context.

## Sub-reference Index

| Group | File | Covers |
|-------|------|--------|
| Managed Agents & Hosted API | [`cli/managed-agents.md`](./cli/managed-agents.md) | `memory store/recall/consolidate`, `session policy/tail/usage/park/unpark/end`, `stream`, WS routes (Phase D–I) |
| Core Phases 2–7 · Init · Cowork | [`cli/core-phases.md`](./cli/core-phases.md) | `import/export`, `mcp`, `did/encrypt/auth/audit`, `p2p/wallet/org/plugin`, `init/persona`, `cowork`, `hook/workflow/hmemory/a2a`, `sandbox/evolution/evomap/dao` |
| Phase 8 · Blockchain & Enterprise | [`cli/blockchain-enterprise.md`](./cli/blockchain-enterprise.md) | `compliance/threat-intel`, `pqc`, `nostr/matrix/activitypub/scim/terraform`, `hardening/stress/reputation/sla/tech/dev/collab/marketplace/incentive/kg/tenant/governance/recommend/crosschain/privacy/inference/trust/social/fusion/infra` |
| Observability & Code Intel | [`cli/observability.md`](./cli/observability.md) | `codegen` (Phase 86), `ops` (AIOps Phase 25), `perception` (Phase 84), `dbevo` (Phase 80), `federation` (Phase 58) |
| Platform Services | [`cli/platform.md`](./cli/platform.md) | `lowcode`, `evomap`, `cli-anything`, `serve`, `ui`, `orchestrate` |
| Video Editing Agent | [`cli/video.md`](./cli/video.md) | `video edit/deconstruct/plan/assemble/render/assets` (CutClaw-inspired) |

## System Management

```bash
chainlesschain setup       # 交互式初始化向导
chainlesschain start       # 启动桌面应用
chainlesschain stop        # 停止应用
chainlesschain status      # 显示状态
chainlesschain services up # 启动 Docker 服务
chainlesschain config list # 显示配置
chainlesschain update      # 检查更新
chainlesschain doctor      # 诊断环境
```

## Headless Commands (no GUI required)

```bash
chainlesschain db init                            # 初始化数据库
chainlesschain db info                            # 数据库信息
chainlesschain note add "Title" -c "Content" -t "tag1,tag2"
chainlesschain note list | note search "keyword"
chainlesschain chat                               # 交互式 AI 对话 (流式)
chainlesschain chat --agent                       # Agent 模式 (读写文件)
chainlesschain ask "question"                     # 单次 AI 查询
chainlesschain llm models | llm test              # 列出 / 测试模型
chainlesschain agent                              # Agent AI 会话 (Claude Code 风格)
chainlesschain agent --session <id>               # 恢复之前的 agent 会话
chainlesschain agent --agent-id <id>              # 按 agent 限定记忆召回范围
chainlesschain agent --recall-limit 5             # 启动时注入 top-5 记忆
chainlesschain agent --no-recall-memory           # 禁用启动记忆召回
chainlesschain agent --no-stream                  # 禁用流式渲染
chainlesschain agent --bundle ./my-agent-bundle   # 加载 agent 包 (AGENTS.md + USER.md + skills/ + mcp.json)
chainlesschain skill list                         # 列出全部技能 (四层: bundled/marketplace/managed/workspace)
chainlesschain skill list --category cli-direct   # 列出 CLI 命令技能包
chainlesschain skill run code-review "Review this code"
chainlesschain skill run cli-knowledge-pack "note list"   # 通过技能包运行 CLI 命令
chainlesschain skill run cli-identity-pack "did create"
chainlesschain skill add <name> | skill remove <name>     # 创建 / 删除自定义项目技能
chainlesschain skill sources                              # 显示技能分层路径和数量
chainlesschain skill sync-cli [--force|--dry-run|--remove|--json]   # 重新生成 CLI 技能包
```

## Phase 1: AI Intelligence Layer

```bash
chainlesschain search "keyword"            # BM25 混合搜索
chainlesschain tokens show                 # Token 用量追踪
chainlesschain memory add "remember this"  # 持久化记忆 (简单版)
chainlesschain session list                # 会话管理
```

> For scoped-memory (`memory store/recall/consolidate`) and session lifecycle
> (`session policy/tail/usage/park/unpark/end`), see [`cli/managed-agents.md`](./cli/managed-agents.md).
