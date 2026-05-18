# 代码生成 Agent (codegen)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 核心特性

- **代码生成追踪**: 记录生成会话 (prompt/语言/框架/token 消耗)
- **启发式代码审查**: 内置安全规则检测 (eval/SQL注入/XSS/路径穿越/命令注入)
- **脚手架模板目录**: 支持 React/Vue/Express/FastAPI/Spring Boot 五种模板
- **CI/CD 平台目录**: GitHub Actions / GitLab CI / Jenkins

## 概述

ChainlessChain CLI 代码生成 Agent 模块 (Phase 86) 是 Desktop 端 Code Generation Agent 2.0 的 CLI 移植。Desktop 端使用 LLM 驱动全栈代码生成和 AI 代码审查；CLI 端提供会话追踪、启发式安全审查和脚手架记录管理。每次 `generate` 记录 prompt、语言、框架及 token 消耗；`review` 对代码片段运行 5 条安全规则检测并按严重性分级；`scaffold` 追踪脚手架项目的创建记录。

## 命令参考

### codegen templates — 脚手架模板目录

```bash
chainlesschain codegen templates
chainlesschain codegen templates --json
```

列出支持的脚手架模板: `react`, `vue`, `express`, `fastapi`, `spring_boot`。

### codegen severities — 审查严重性等级

```bash
chainlesschain codegen severities
chainlesschain codegen severities --json
```

列出代码审查严重性等级: `critical`, `high`, `medium`, `low`, `info`。

### codegen rules — 安全规则目录

```bash
chainlesschain codegen rules
chainlesschain codegen rules --json
```

列出内置安全检测规则: `eval_detection`, `sql_injection`, `xss`, `path_traversal`, `command_injection`。

### codegen platforms — CI/CD 平台目录

```bash
chainlesschain codegen platforms
chainlesschain codegen platforms --json
```

列出支持的 CI/CD 平台: `github_actions`, `gitlab_ci`, `jenkins`。

### codegen generate — 记录代码生成会话

```bash
chainlesschain codegen generate -p "实现用户注册 API"
chainlesschain codegen generate -p "React 登录页" -l typescript -f react --files 3 --tokens 1200
chainlesschain codegen generate -p "REST API" -l python -f fastapi --code "..." -m '{"model":"gpt-4"}' --json
```

记录一次代码生成会话。`-p` (必填) 指定生成 prompt，`-l` 编程语言，`-f` 框架，`--code` 生成的代码，`--files` 生成文件数，`--tokens` 消耗 token 数，`-m` 元数据 JSON。

### codegen show — 查看生成详情

```bash
chainlesschain codegen show <generation-id>
chainlesschain codegen show <generation-id> --json
```

显示生成会话的完整信息: ID、prompt、语言、框架、文件数、token 消耗。

### codegen list — 列出生成记录

```bash
chainlesschain codegen list
chainlesschain codegen list -l typescript -f react --limit 20 --json
```

列出代码生成记录。可按语言 (`-l`) 和框架 (`-f`) 过滤，`--limit` 限制结果数。

### codegen review — 运行代码审查

```bash
chainlesschain codegen review -c "eval(userInput)"
chainlesschain codegen review -c "SELECT * FROM users WHERE id = '" -l javascript -g <gen-id> --json
```

对代码片段运行启发式安全审查。`-c` (必填) 指定待审代码，`-l` 编程语言，`-g` 关联到已有生成记录。返回检出问题数、安全问题数及各严重性分布。

### codegen review-show — 查看审查详情

```bash
chainlesschain codegen review-show <review-id>
chainlesschain codegen review-show <review-id> --json
```

显示审查详情: 代码哈希、语言、总问题数、安全问题数，以及每条检出的规则名、严重性和匹配内容。

### codegen reviews — 列出审查记录

```bash
chainlesschain codegen reviews
chainlesschain codegen reviews -l python --limit 10 --json
```

列出所有审查记录。可按语言过滤。

### codegen scaffold — 记录脚手架生成

```bash
chainlesschain codegen scaffold -t react -n my-app
chainlesschain codegen scaffold -t fastapi -n api-server --files 8 -o ./projects/api --json
chainlesschain codegen scaffold -t vue -n dashboard -o '{"typescript":true}' --json
```

记录一次脚手架生成。`-t` (必填) 模板类型，`-n` (必填) 项目名，`-o` 选项 JSON 或输出路径，`--files` 生成文件数。

### codegen scaffold-show — 查看脚手架详情

```bash
chainlesschain codegen scaffold-show <scaffold-id>
chainlesschain codegen scaffold-show <scaffold-id> --json
```

显示脚手架记录: 模板、项目名、选项、文件数、输出路径。

### codegen scaffolds — 列出脚手架记录

```bash
chainlesschain codegen scaffolds
chainlesschain codegen scaffolds -t react --limit 10 --json
```

列出所有脚手架记录。可按模板类型过滤。

### codegen stats — 统计信息

```bash
chainlesschain codegen stats
chainlesschain codegen stats --json
```

显示代码 Agent 汇总统计: 生成总数/文件总数/token 总数/语言数、审查总数/问题总数/安全问题数/平均问题数、脚手架总数及各模板分布。

## 数据存储

所有数据持久化到 SQLite 数据库 (`code_generations` / `code_reviews` / `code_scaffolds` 三张表)，首次执行子命令时自动建表。

## 系统架构

```
┌────────────────────────────────────────────────────────┐
│              chainlesschain codegen (Phase 86)          │
├────────────────────────────────────────────────────────┤
│  generate        │  review          │  scaffold        │
│  (prompt/lang/   │  (5 rule heuri-  │  (template-      │
│   framework/     │   stic: eval,    │   based, tracks  │
│   tokens)        │   sql-injection, │   react/vue/     │
│                  │   xss, path-     │   express/       │
│                  │   traversal,     │   fastapi/       │
│                  │   command-inj)   │   spring-boot)   │
├────────────────────────────────────────────────────────┤
│  SQLite: code_generations / code_reviews /             │
│          code_scaffolds                                │
├────────────────────────────────────────────────────────┤
│  stats aggregator (counts / tokens / issues)           │
└────────────────────────────────────────────────────────┘
```

数据流：`generate` 写入 generation → `review --gen-id` 关联到该会话 → `stats` 聚合。

## 配置参考

| 配置项             | 含义                     | 默认                          |
| ------------------ | ------------------------ | ----------------------------- |
| 模板目录           | 支持的脚手架模板         | react, vue, express, fastapi, spring_boot |
| 审查规则           | 启发式正则规则           | eval_detection, sql_injection, xss, path_traversal, command_injection |
| 严重性等级         | 审查结果分级             | critical / high / medium / low / info |
| 关联模式           | `review -g <gen-id>`     | 可选，关联到已有生成记录      |
| JSON 输出          | `--json`                 | 所有列表/show 命令支持        |

## 性能指标

| 操作                      | 典型耗时         |
| ------------------------- | ---------------- |
| generate 记录写入         | < 15 ms          |
| review（小代码片段）      | < 20 ms          |
| review（1000+ 行）        | < 100 ms         |
| scaffold 记录写入         | < 10 ms          |
| stats 聚合（10k 记录）    | < 50 ms          |

注：CLI 侧 review 为启发式模式匹配，非 LLM 调用；LLM 审查由 Desktop 端 Code Generation Agent 2.0 完成。

## 测试覆盖率

```
__tests__/unit/code-agent.test.js — 65 tests (755 lines)
```

覆盖：generate 记录、review 规则触发（每条规则独立用例）、scaffold 模板分支、
stats 聚合、边界值（空 prompt、超大 code）、JSON 输出一致性。
V2 surface（Phase 86）见 `code_agent_v2_phase86_cli.md` 备忘录（65 tests）。

## 安全考虑

1. **review 只做启发式** — 不会将代码发送到任何外部服务；5 条规则均为本地正则
2. **敏感 prompt 持久化提示** — `generate` 会将 prompt 明文存入 SQLite；如含敏感信息请通过环境变量或显式规避
3. **代码哈希化存储** — `review` 存 SHA-256(code) 而非原文，减少敏感泄漏面
4. **scaffold 仅记录** — 不执行实际 shell 命令创建项目，需由上层调用方完成
5. **JSON 输入校验** — `-m` / `-o` 参数如非合法 JSON 将被拒绝，防止注入

## 故障排查

**Q: review 没检测出应该匹配的规则?**

1. 确认代码包含规则关键词（如 `eval(`、`SELECT ... '`、`document.write`、`../`）
2. 可用 `codegen rules --json` 查看规则枚举，与实际 `codegen review-show` 的 `rules_matched` 对比
3. 规则为启发式，复杂的代码模式需要上层 LLM 审查

**Q: generate 记录不显示在 list?**

1. 检查 `--limit` 是否过小（默认 50）
2. 若过滤了 `-l` / `-f`，请与实际写入值比对
3. 首次运行时自动建表；检查数据目录 `.chainlesschain/` 是否有写权限

**Q: scaffold 记录不影响实际文件系统?**

CLI 侧 `scaffold` 只做记录追踪，实际脚手架生成由 Desktop Agent 或外部 CLI（`create-react-app` 等）完成。

## 关键文件

- `packages/cli/src/commands/codegen.js` — Commander 子命令（~527 行）
- `packages/cli/src/lib/code-agent.js` — 管理器 + 5 条启发式规则
- `packages/cli/__tests__/unit/code-agent.test.js` — 单测（65 tests）
- 数据表：`code_generations` / `code_reviews` / `code_scaffolds`
- 设计文档：`docs/design/modules/51_代码生成Agent2.0.md`

## 使用示例

```bash
# 1. 记录一次 LLM 生成
gid=$(chainlesschain codegen generate -p "React Todo" -l typescript -f react --files 4 --tokens 1800 --json | jq -r .id)

# 2. 对生成结果做安全审查（关联到 generation）
chainlesschain codegen review -c "eval(userInput)" -l javascript -g $gid

# 3. 列出高危审查
chainlesschain codegen reviews --limit 20 --json | jq '.[] | select(.security_issues > 0)'

# 4. 脚手架追踪
chainlesschain codegen scaffold -t fastapi -n api-server --files 8 -o ./projects/api

# 5. 全局统计
chainlesschain codegen stats --json
```

## 相关文档

- 设计文档: `docs/design/modules/51_代码生成Agent2.0.md`
- 管理器: `packages/cli/src/lib/code-agent.js`
- 命令: `packages/cli/src/commands/codegen.js`
- [Autonomous Developer →](/chainlesschain/cli-dev)
- [Tech Learning Engine →](/chainlesschain/autonomous-developer)
