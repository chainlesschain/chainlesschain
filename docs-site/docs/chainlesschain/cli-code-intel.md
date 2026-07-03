# 语义代码智能 — LSP 驱动的导航与诊断（`cc code-intel`）

> **版本: Phase 2 (LSP 代码智能) 四期落地 · 2026-07-04 | 状态: ✅ 生产就绪 | 8 子命令 + 接入 agent 执行链 + 编辑后增量诊断 + 崩溃自动重启守卫 | ~65 单测 + skip-guarded 真-server 集成 | 零新增运行时依赖**
>
> `cc code-intel`（别名 `ci`）通过标准 **Language Server Protocol** 提供跨文件的语义导航——跳转定义、查找全部引用、悬停类型、符号搜索、诊断、重命名预览——而非文本近似。同一套 LSP 能力还作为 `code_intelligence` 工具**接入了 agent 执行链**：agent 改符号前先查引用、改完后自动看到自己引入的诊断错误。

## 概述

在 LSP 落地之前，CLI 的代码理解只有文本搜索（`search_files`）——它找不到「这个符号的真正定义在哪」「谁引用了它」「改完编译报什么错」。Phase 2 从零构建了一个完整的 LSP 客户端栈，把这些**语义**问题交给真正的语言服务器回答。

设计上有三条硬约束：

1. **零新增运行时依赖**——不捆绑任何语言服务器，而是探测系统 `PATH` 和项目 `node_modules/.bin`；装了就用，没装就优雅降级到文本搜索。
2. **进程复用 + 空闲自释放**——语言服务器启动昂贵（要索引整个项目），所以按 `(项目根, 语言)` 池化复用；空闲 60s 自动释放，杜绝 orphaned 进程 / 悬挂 timer 泄漏。
3. **崩溃有界重启**——崩溃的服务器在下次请求时自动重启，但用滑动窗口封顶，防止启动即崩的服务器每请求 thrash 重索引。

分四期落地：一期 CLI 命令 + LSP 栈；二期接入 agent 工具链；三期编辑后自动增量诊断回喂；四期崩溃自动重启守卫。

## 核心特性

- 🧭 **8 语义操作**: 跳转定义 / 查找全部引用 / 悬停类型 / 文档符号 / 工作区符号搜索 / 诊断 / 重命名预览 / 服务器状态。
- 🔌 **零依赖探测**: 探测 `PATH` + `node_modules/.bin`，装了 `typescript-language-server` / `pyright` / `gopls` 等即用；没装优雅降级文本搜索。
- 🤖 **接入 agent 执行链**: `code_intelligence` 作为 agent 工具（默认工具数 20→21），readonly / plan-mode 可用；系统提示引导 agent 改符号前查引用、改后查诊断。
- 📝 **编辑后增量诊断回喂**: `write_file` / `edit_file` 成功后自动附 `newDiagnostics`（error+warning，≤20），agent **同轮**即见自己引入的类型/语法错。
- ♻️ **进程池 + 空闲自释放**: 按 `(根, 语言)` 复用语言服务器，空闲 60s 自释放 + `process.once('exit')` 兜底回收。
- 🔁 **崩溃有界重启**: 服务器崩溃下次请求自动重启；滑动窗（默认 30s）内崩 ≥3 次即隔离降级文本搜索，窗口清后恢复——防 thrash。
- ⏱️ **全程限时**: 编辑诊断 6s 墙钟 cap + 3s 诊断超时，仅首个编辑付冷启动税，之后 pool warm。
- 🎛️ **可关**: `CC_EDIT_DIAGNOSTICS=0` 关编辑后诊断；无 server 时零成本（先探测不冷启不存在的 server）。

## 系统架构

```
┌───────────────────────────────────────────────────────────┐
│  cc code-intel <sub>          │   agent 执行链              │
│  (commands/codeintel.js)      │   (runtime/agent-core.js)   │
│  status/def/refs/hover/       │   executeToolInner:         │
│  symbols/wsymbols/diag/rename │   ┌──────────────────────┐  │
└───────────┬───────────────────┘   │ code_intelligence 工具│  │
            │                       │ write_file/edit_file  │  │
            │                       │  → _postEditDiagnostics│  │
            │                       └───────────┬──────────┘  │
            └───────────────┬───────────────────┘             │
                            ▼                                  │
        ┌───────────────────────────────────────┐             │
        │        code-intelligence.js            │◀────────────┘
        │  高层 API：def/refs/hover/symbols/     │
        │  diagnostics/rename（1-based 位置）     │
        └───────────────────┬───────────────────┘
                            ▼
        ┌───────────────────────────────────────┐
        │            LSPManager                   │
        │           (lsp/lsp-manager.js)          │
        │  · 按 (根,语言) 池化 + 空闲自释放        │
        │  · didOpen/didChange 文档同步            │
        │  · 1-based(用户)⇄0-based(LSP) 位置转换   │
        │  · 崩溃有界重启（_crashLog 滑动窗）       │
        └──────┬─────────────────────┬───────────┘
               ▼                     ▼
   ┌────────────────────┐   ┌──────────────────────┐
   │    LSPClient       │   │ lsp-server-registry  │
   │ (lsp-client.js)    │   │ 探测 PATH/node_modules│
   │ JSON-RPC over stdio│   │ TS/JS/Py/Go/Rust 解析  │
   │ jsonrpc-stream.js  │   └──────────────────────┘
   └─────────┬──────────┘
             ▼
   ┌──────────────────────┐
   │ 语言服务器子进程       │  typescript-language-server /
   │ (spawn, stdio)        │  pyright-langserver / gopls / …
   └──────────────────────┘
```

## 命令参考

`cc code-intel`（别名 `cc ci`）—— 通过 LSP 做语义代码导航。所有子命令支持 `--json`。

| 子命令                                 | 说明                                |
| -------------------------------------- | ----------------------------------- |
| `status`                               | 显示已安装/可探测的语言服务器       |
| `def <file> <line> <col>`              | 跳转到 `file:line:col` 处符号的定义 |
| `refs <file> <line> <col>`             | 查找该符号的全部引用                |
| `hover <file> <line> <col>`            | 显示该符号的类型/文档信息           |
| `symbols <file>`                       | 列出文档内声明的符号                |
| `wsymbols <query>`                     | 按名字跨工作区搜索符号              |
| `diag <file>`                          | 显示文件的诊断（错误/警告）         |
| `rename <file> <line> <col> <newName>` | **预览**跨文件符号重命名（不落盘）  |

> `line` / `col` 是 **1-based**（与编辑器一致）；位置转换在 `LSPManager` 内部统一完成。`rename` 只**预览**改动，不应用编辑。

## 支持的语言

| 语言                    | 语言服务器（探测顺序）         | 状态                                                  |
| ----------------------- | ------------------------------ | ----------------------------------------------------- |
| TypeScript / JavaScript | `typescript-language-server`   | ✅ 真机验证（跨文件 def / 全量 refs / 诊断 / rename） |
| Python                  | `pyright-langserver` → `pylsp` | 🔌 解析器就绪（装了即用，真机验证待各 toolchain）     |
| Go                      | `gopls`                        | 🔌 解析器就绪                                         |
| Rust                    | `rust-analyzer`                | 🔌 解析器就绪                                         |

未安装对应服务器时，命令返回 `unavailable` 并提示安装建议，agent 侧则优雅降级到文本搜索。

## 配置参考

| 项           | 机制                                | 默认    | 说明                                     |
| ------------ | ----------------------------------- | ------- | ---------------------------------------- |
| 服务器探测   | `PATH` + `<root>/node_modules/.bin` | 自动    | 零新增运行时依赖                         |
| 空闲释放     | server 池 idle 超时                 | 60s     | 空闲自释放 + `process.once('exit')` 兜底 |
| 编辑后诊断   | `CC_EDIT_DIAGNOSTICS`               | 开      | 设 `0` 关闭                              |
| 诊断限时     | 墙钟 cap / 诊断超时                 | 6s / 3s | 仅首编辑付冷启动税                       |
| 诊断条数     | `newDiagnostics` 上限               | 20      | error+warning                            |
| 崩溃重启阈值 | `maxRestarts` / `restartWindowMs`   | 3 / 30s | 超阈隔离，窗口清后恢复                   |

## 性能指标

| 维度     | 特性                                                     |
| -------- | -------------------------------------------------------- |
| 冷启动   | 仅首次请求某语言付服务器启动 + 索引税；之后 pool warm    |
| 复用     | 同 `(根, 语言)` 的多文件共用一个服务器实例               |
| 空闲回收 | 60s 无请求自动释放，无 orphaned tsserver / 悬挂 timer    |
| 崩溃恢复 | 崩溃下次请求重启；滑动窗超阈隔离，O(任务数) 扫描         |
| 编辑诊断 | 6s 墙钟 cap 全程限时，无 server 时零成本（先探测再决定） |
| 依赖开销 | 零新增运行时依赖，探测式发现                             |

> 真机验证（TS 项目）：跨文件跳转定义 → `math.ts`、查找引用 → 3 处、诊断 → `TS2304 notDeclared`、rename 预览不改盘；`executeTool` 实测 references(4) / diagnostics(TS2322) / definition 通过，dispose 干净退出；编辑引入未声明名 → `TS2304` 附到 `edit_file` 结果。

## 测试覆盖

共 **~65 单测** + skip-guarded 真-server 集成（无 `typescript-language-server` 时自动 skip），全绿。

| 测试文件                                | 数量 | 覆盖                                                                  |
| --------------------------------------- | ---- | --------------------------------------------------------------------- |
| `lsp-client.test.js`                    | 15   | JSON-RPC 生命周期 / 请求-响应 / 崩溃传播 / notify                     |
| `lsp-manager.test.js`                   | 12   | 池化复用 / didOpen→didChange / 诊断收集 / 位置转换 / **崩溃有界重启** |
| `agent-core-code-intel.test.js`         | 11   | 工具校验 / 无 server 降级 / 格式 + skip-guarded live                  |
| `jsonrpc-stream.test.js`                | 10   | Content-Length 分帧 / 半包 / 多消息                                   |
| `lsp-server-registry.test.js`           | 10   | 语言→服务器解析 / PATH+node_modules 探测 / argsFor                    |
| `code-intelligence.test.js`             | 7    | 高层 API def/refs/hover/symbols/diag/rename                           |
| `code-intelligence.integration.test.js` | live | **真 `typescript-language-server`**（无则 skip）                      |

## 安全考虑

- **只读为主**: `code_intelligence` 工具是 readonly（plan-mode 可用），导航/诊断不改文件；`rename` 只**预览**跨文件改动，绝不自动落盘。
- **无远程代码执行**: 语言服务器是本地 stdio 子进程，不联网；探测只读 `PATH` / `node_modules`。
- **进程回收**: 空闲自释放 + `process.once('exit')` 兜底，会话结束不留 orphaned tsserver 进程。
- **崩溃隔离**: 崩溃循环的服务器被隔离降级（不 thrash 重索引），保护主机资源。

## 故障排除

| 现象                                      | 原因                                | 处理                                                                        |
| ----------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------- |
| `no language server installed for <lang>` | 未装对应服务器                      | 装它，如 `npm i -g typescript-language-server`（TS）/ `pip install pyright` |
| `no language mapping for <ext>`           | 文件类型无语言映射                  | 目前支持 TS/JS/Py/Go/Rust；其余降级文本搜索                                 |
| def/refs 返回空                           | 服务器仍在索引项目                  | CLI 一次性命令会等首个诊断发布（项目加载信号）；大仓首次稍慢                |
| `<server> crash-looped … quarantined`     | 服务器启动即崩 ≥3 次/30s            | 检查服务器版本/项目配置；隔离期后自动重试，或修根因                         |
| 编辑后没有 `newDiagnostics`               | `CC_EDIT_DIAGNOSTICS=0` 或无 server | 开启环境变量 / 装语言服务器                                                 |
| agent 未用 code_intelligence              | 工具被 plan-mode/权限限制           | 确认权限模式；readonly 场景默认可用                                         |

## 关键文件

| 文件                                              | 职责                                                                          |
| ------------------------------------------------- | ----------------------------------------------------------------------------- |
| `packages/cli/src/commands/codeintel.js`          | `cc code-intel` CLI（8 子命令 + `--json`）                                    |
| `packages/cli/src/lib/lsp/code-intelligence.js`   | 高层 API（def/refs/hover/symbols/diagnostics/rename，1-based 位置）           |
| `packages/cli/src/lib/lsp/lsp-manager.js`         | 服务器池化 + 文档同步 + 位置转换 + **崩溃有界重启**                           |
| `packages/cli/src/lib/lsp/lsp-client.js`          | 单服务器 JSON-RPC over stdio 客户端                                           |
| `packages/cli/src/lib/lsp/lsp-server-registry.js` | 语言→服务器解析 + PATH/node_modules 探测                                      |
| `packages/cli/src/lib/lsp/jsonrpc-stream.js`      | Content-Length 分帧的 JSON-RPC 流                                             |
| `packages/cli/src/runtime/agent-core.js`          | `code_intelligence` 工具 case + `_postEditDiagnostics` 编辑后诊断 + server 池 |

## 使用示例

### 1. 查看可用的语言服务器

```bash
cc code-intel status
# typescript-language-server: ✔ detected (node_modules/.bin)
# pyright-langserver: ✗ not found
```

### 2. 跳转定义 / 查找引用

```bash
cc ci def src/app.ts 42 15        # 光标在 app.ts 第42行第15列的符号 → 其定义
cc ci refs src/math.ts 3 17       # 该符号的全部引用（跨文件）
cc ci refs src/math.ts 3 17 --json
```

### 3. 诊断与符号

```bash
cc ci diag src/app.ts             # 错误/警告列表
cc ci symbols src/app.ts          # 文档内符号
cc ci wsymbols createUser         # 跨工作区按名搜索符号
```

### 4. 重命名预览（不落盘）

```bash
cc ci rename src/math.ts 3 17 multiply
# 预览：跨 N 个文件的 M 处改动（需自行确认后再应用）
```

### 5. agent 自动使用（无需手动调用）

```bash
cc agent -p "把 add() 改名为 sum() 并更新所有调用处"
# agent 改前用 code_intelligence 查 add 的全部引用，改后自动看到 newDiagnostics
# 里残留的编译错误并在同轮修复。
```

## 相关文档

- [CLI Agent 模式](./cli-agent.md) — `cc agent` 无头执行（`code_intelligence` 工具所在的执行链）
- [Coding Agent 系统](./coding-agent.md) — 面向真实代码仓库的多轮编码闭环
- [Agent Team `cc team`](./cli-team.md) / [可靠性评测 `cc eval`](./cli-eval.md) — 同批 Claude Code 平价能力
- 内部计划：`docs/CLAUDE_CODE_CLI_PARITY_OPTIMIZATION_PLAN.md` Phase 2（LSP 语义代码智能）
