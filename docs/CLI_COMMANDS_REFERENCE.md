# CLI Commands Reference

> Command reference for `chainlesschain` CLI (also available as `cc`, `clc`, `clchain`).
>
> This file is a thin index — detailed command listings live in [`docs/cli/`](./cli/).
> Read the sub-files on demand to avoid bloating agent context.

## Sub-reference Index

| Group | File | Covers |
|-------|------|--------|
| Managed Agents & Hosted API | [`cli/managed-agents.md`](./cli/managed-agents.md) | `agent -p` (headless), `memory store/recall/consolidate`, `session policy/tail/usage/park/unpark/end`, `cost`, `checkpoint`, `compact` (会话压缩 + headless 自动压缩), `goal` (跨会话目标/OKR), `stream`, WS routes (Phase D–I) |
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
chainlesschain pack        # 把当前项目环境打成单文件 .exe（v0.2 Phase 0-3 稳定）
                           #   详见 docs/design/CC_PACK_打包指令设计文档.md
```

## Pair {#pair}

LAN pairing utilities — Linux LAN-pairing 诊断 + pairing token 预生成（#21 A.1）。
完整 Linux setup 指南见 [docs/linux/PAIRING.md](./linux/PAIRING.md)。

```bash
# Preflight 诊断（5 项检查：interfaces / multicast bind / port 5353 holders /
# platform-aware distro detect / firewall hint）
chainlesschain pair preflight                       # 人类可读输出
chainlesschain pair preflight --json                # CI 用 JSON + exit 0/1/2
chainlesschain pair preflight --show-firewall       # 总是显示 firewall fix

# Pairing token 预生成 / 管理（CI / SSH dev box 场景）
chainlesschain pair token generate --did <did> [--name <n>] [--device-id <id>] [--json]
chainlesschain pair token list [--status pending|consumed|revoked|expired] [--did <d>] [--json]
chainlesschain pair token show <code> [--json]
chainlesschain pair token revoke <code> [--json]
```

Token 存 `~/.chainlesschain/pairing-tokens.json`。同 DID 新 token 自动 revoke
前 pending（one-active-token-per-DID 不变量）。Token QR shape 兼容 Electron
desktop `device-pairing-handler.js` `handleQRCodeScan`。

systemd 部署模板：[`dist-tools/systemd/chainlesschain.service`](../dist-tools/systemd/chainlesschain.service)（运行 `cc ui` 作为 long-lived web-panel 服务）。

## Headless Commands (no GUI required)

```bash
chainlesschain db init                            # 初始化数据库
chainlesschain db info                            # 数据库信息
chainlesschain db backup [path]                   # 备份数据库
chainlesschain db restore <backup> [--force]      # 从备份还原
chainlesschain db check [--quick] [--json]        # SQLite integrity_check（损坏退出码 2）
chainlesschain db repair [--out <path>]           # 尽力按行抢救损坏库 → 新文件
chainlesschain db reset [--force]                 # 备份当前库 + 下次启动重建
chainlesschain note add "Title" -c "Content" -t "tag1,tag2"
chainlesschain note list | note search "keyword"
chainlesschain chat                               # 交互式 AI 对话 (流式)
chainlesschain chat --agent                       # Agent 模式 (读写文件)
chainlesschain ask "question"                     # 单次 AI 查询
chainlesschain ask "summarize @notes.md"          # @path 引用：注入文件内容 (--no-file-refs 关闭)
chainlesschain llm models | llm test              # 列出 / 测试模型
chainlesschain agent                              # Agent AI 会话 (Claude Code 风格)
chainlesschain agent --session <id>               # 恢复之前的 agent 会话
chainlesschain agent --continue                   # 恢复最近一次会话 (无需 id)
chainlesschain agent --agent-id <id>              # 按 agent 限定记忆召回范围
chainlesschain agent --recall-limit 5             # 启动时注入 top-5 记忆
chainlesschain agent --no-recall-memory           # 禁用启动记忆召回
chainlesschain agent --no-stream                  # 禁用流式渲染
chainlesschain agent --add-dir ../lib --add-dir x # 额外工作根 (可重复，agent 可读/搜/改)
chainlesschain agent --bundle ./my-agent-bundle   # 加载 agent 包 (AGENTS.md + USER.md + skills/ + mcp.json)
chainlesschain agent "review @src/x.js"           # 交互模式下 @path 注入文件内容
chainlesschain agent -p "fix bug in x.js" [opts]  # Headless / print 模式 (claude -p 对标) — 详见 cli/managed-agents.md
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

## Cost, Checkpoint & Compaction

```bash
chainlesschain cost [<sessionId>] [--json] [--limit 500]   # 估算 $ 花费 (叠加在 session usage 上)
chainlesschain checkpoint create <paths...> [--label <l>]  # 文件状态快照 / 回滚 (Claude Code rewind 对标)
chainlesschain checkpoint list | show <id> [--diff] | restore <id> [--dry-run|--force] | delete <id>
chainlesschain compact <session-id> [--dry-run] [--json]   # 手动压缩存档会话 (Claude Code /compact 对标)
chainlesschain compact <session-id> [--model <m>|--max-tokens <n>|--max-messages <n>]  # 阈值覆盖
chainlesschain agent -p "..." --resume <id>                # 长会话续跑：超阈值本轮自动压缩 + 写 compact 事件
```

> 详见 [`cli/managed-agents.md`](./cli/managed-agents.md)：`cost` 的定价规则 / JSON 形状 /
> `llm.pricing` 配置覆盖；`checkpoint` 的安全语义 / 磁盘布局（区别于 `cc workflow checkpoint`）；
> `compact` + headless 自动压缩的工具对安全 / `--resume` 持久化 / stream-json `compaction` 事件。

## Goal — 跨会话持久目标 / OKR

```bash
chainlesschain goal set "<objective>" [--kr "<KR>" ...]    # 建跨会话目标 (+关键结果)
chainlesschain goal list | show <id> | progress <id> --pct <n> --note <t>
chainlesschain goal kr add <id> "<KR>" [--target <n>] | set <id> <krId> --current <n> [--done]
chainlesschain goal link <id> [sessionId] | pause|resume|close|abandon <id> | active | rm <id>
chainlesschain agent -p "..." --goal [<id>] [--goal-assess]  # 绑定目标 (Phase 1) + 跑完自评 (Phase 2)
```

> 超出 Claude Code 的扩展。Phase 0 存储/命令 + Phase 1 `--goal` 注入每轮对照 + Phase 2
> `--goal-assess` 跑完 LLM 自评进度。详见 [`cli/managed-agents.md`](./cli/managed-agents.md) 的 Goal 节
> （解析优先级 / drift / stream-json 事件）。
