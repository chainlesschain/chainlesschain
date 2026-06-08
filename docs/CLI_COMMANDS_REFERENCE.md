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

# Headless / print 模式 (Claude Code `claude -p` 对标；可进 CI / 管道)
chainlesschain agent -p "fix the bug in x.js"     # 单轮非交互执行后退出
echo "task" | chainlesschain agent -p              # 从 stdin 读取任务
chainlesschain agent -p "..." --output-format json        # text(默认)|json|stream-json
chainlesschain agent -p "..." --max-turns 5               # 限制 agent 循环迭代上限
chainlesschain agent -p "..." --allowed-tools "read_file,git"     # 工具白名单
chainlesschain agent -p "..." --disallowed-tools "run_shell"      # 工具黑名单
chainlesschain agent -p "..." --permission-mode plan      # plan|acceptEdits|bypassPermissions
                                                  #   默认 fail-closed：拒绝中/高危 shell；
                                                  #   plan=只读工具，bypassPermissions=全放行
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

## Cost — 估算 $ 花费 {#cost}

在 `cc session usage`（token 计数）之上叠加价格层。读取同一份 JSONL `token_usage`
事件；本地 provider (ollama 等) = 免费，未知模型标 `unpriced`（不臆测）。

```bash
chainlesschain cost                        # 全局花费汇总 (按 provider/model 拆分)
chainlesschain cost <sessionId>            # 单会话花费
chainlesschain cost --json                 # 机器可读
chainlesschain cost --limit 500            # 全局汇总最多扫描的会话数
```

价格为公开 list 价的估算 (USD / 1M tokens)。可在配置 `llm.pricing` 覆盖/新增费率，
无需改源码：`{ "<provider>": [ { "match": "<子串>", "in": <num>, "out": <num> } ] }`。

## Checkpoint — 文件状态快照 / 回滚 {#checkpoint}

Claude Code "rewind" 的 CLI 对标：在有风险的 agent 运行前给文件拍快照，出问题再还原。
内容寻址存储于 `~/.chainlesschain/checkpoints`。区别于 `cc workflow checkpoint`（执行态）。

```bash
chainlesschain checkpoint create <paths...> [--label <l>]  # 快照文件/目录 (跳过 node_modules 等)
chainlesschain checkpoint list                             # 列出快照 (最新在前)
chainlesschain checkpoint show <id> [--diff]               # 清单 / 与当前文件对比
chainlesschain checkpoint restore <id> [--dry-run|--force] # 还原 (会先自动快照当前态，可再回滚)
chainlesschain checkpoint delete <id> [--force]            # 删除快照
```

> `restore` 有破坏性：非交互环境必须加 `--force`，TTY 下会弹确认；还原前自动生成
> safety checkpoint，所以回滚本身也可撤销。所有子命令支持 `--json`。
