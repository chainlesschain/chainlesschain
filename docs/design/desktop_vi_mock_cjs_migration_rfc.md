# RFC: desktop-app-vue 测试 vi.mock CJS Interop 迁移

> **状态**：草案（待评审）
> **起稿**：2026-05-18
> **背景 memo**：`~/.claude/projects/.../memory/vi_mock_cjs_interop_systemic.md`
> **先例**：commit `d5aae6ac9` `_setChromiumForTesting` seam（browser-engine 25/25 解锁）

## 1. 背景

desktop-app-vue 主进程是 CommonJS（`.claude/rules/eslint-style.md` 强制：`src/main/**/*.js` 必须 CJS）。Vitest 的 `vi.mock(...)` factory 配合 ES module hoist 工作，但**无法拦截 CJS source 顶层 `const x = require("y")`** —— factory 返回 `{ default: {...} }` shape 与 CJS module 真实导出不匹配，source 拿到真模块、mock 完全失效。

后果：7 个 test 文件长期 skip，**33 个 `it.skip`/`describe.skip` blocks** 被锁死，其下内层 ~278 个 test 假性 "已写未跑"。

precedent `d5aae6ac9` 把 browser-engine.js 顶层 `const { chromium } = require("playwright-core")` 改为 `let _chromium = require("playwright-core").chromium` + 暴露 `_setChromiumForTesting()` seam，test 端用 `beforeEach` 注入 fake，**25/25 unskip 不动 production 语义**。模板已验证，此 RFC 把它形式化 + 推广到剩余 7 文件。

## 2. 受影响文件清单（ground-truth verified 2026-05-18）

| 文件 | skip blocks | mock 目标 | 源 require 模式 | 建议模板 |
|---|---:|---|---|---|
| `api/backend-client` | 1 | `axios` | 2 顶层 const | T1 seam |
| `code-tools/code-ipc` | 1 | factory functions | 2 顶层 const | T1 seam |
| `ai-engine/conversation-executor` | 8 | `fs/promises` | 4 顶层 const | T3 混合 |
| `llm/llm-manager` | **8** | 内部 LLM client | **10 顶层 const** | T2 constructor `_deps` |
| `blockchain/contract-ipc` | 1 | `ipcMain` | 2 顶层 const | T1 seam |
| `did/did-manager` | 4 | `tweetnacl` | 9 顶层 const | T3 混合 |
| `config/unified-config-manager` | 10 | `fs` + electron `app` | inline require | T1 seam |
| **合计** | **33** | — | — | — |

> 旧表格在 memory 里记 "8 文件"，含已 land 的 browser-engine（commit `d5aae6ac9`）。剩 7。

## 3. 模板（三选一）

### T1 — 模块级 seam（适合单一重型外部 dep）

```js
// source (CJS): 把 destructured const 改成 let
let _chromium = require("playwright-core").chromium;
function _setChromiumForTesting(impl) {
  _chromium = impl ?? require("playwright-core").chromium;  // null 恢复
}
module.exports = { Klass, _setChromiumForTesting };
```

```js
// test: 不再用 vi.mock("playwright-core")，直接注入
import { Klass, _setChromiumForTesting } from "../../../src/...";
beforeEach(() => _setChromiumForTesting(makeFakeChromium()));
afterEach(() => _setChromiumForTesting(null));
```

**适用**：`backend-client (axios)` / `code-ipc (factory)` / `contract-ipc (ipcMain)` / `unified-config-manager (fs+app)`.

### T2 — 构造函数 `_deps` 注入（适合 class 内部多 dep）

```js
function MyClass(options = {}, _deps = {
  fs: require("fs"),
  axios: require("axios"),
  llmClient: require("./llm-client"),
}) {
  this._deps = _deps;
  // 内部一律 this._deps.fs / this._deps.axios ...
}
module.exports = MyClass;
```

```js
// test：beforeEach 构造时传 fake
const inst = new MyClass({}, { fs: fakeFs, axios: fakeAxios, llmClient: fakeLLM });
```

**适用**：`llm-manager` (10 deps，T1 单 seam 不够)。

### T3 — 混合（seam + injection）

重外部 dep（fs/promises, tweetnacl）用 T1 seam（避免每个 caller 都注入），轻内部 module 用 T2 constructor injection。

**适用**：`conversation-executor` (fs/promises 重，rest 内部)、`did-manager` (tweetnacl 重，rest 内部)。

## 4. 分批计划

| Batch | 文件 | 工期 | 解锁 | 验证模板 |
|---|---|---:|---:|---|
| **1（轻型 pilot）** | `backend-client` + `code-ipc` + `contract-ipc` | 3-6h | +3 blocks | T1 单 seam 可复用 |
| **2（重型）** | `conversation-executor` + `did-manager` + `unified-config-manager` | 6-9h | +22 blocks | T3 混合 |
| **3（DI 重构）** | `llm-manager` | 3-4h | +8 blocks | T2 constructor `_deps` |

每 batch **单 session 完成**（memory `feedback_parallel_session_git_race.md` — vi.mock 文件改 source 在并行 session 期间踩过 HEAD lock fail）。每文件改完立即跑该文件 + 1 个上游集成测试，再进下一个。

## 5. 风险 + 缓解

| 风险 | 缓解 |
|---|---|
| Source-side refactor 改 production 语义 | T1/T2/T3 都只动 **dep 来源**，不动逻辑；改完每文件先跑既有 non-skipped 测确认 0 reg |
| `feedback_lint_staged_no_stash_data_loss.md` — 多文件 modified 期间 lint-staged 误吞 | commit 前 `git status --porcelain` 必验，每 batch 单 commit |
| `KNOWN_TEST_ISSUES.md` 写 "All Resolved" 误导（stale 2026-02-10） | Batch 1 完成时一并更新此文档反映真实 |
| llm-manager T2 constructor 改动 = breaking change for 所有 caller | grep `new LLMManager(` 全 codebase 改 caller signature；估 ~5-10 处 |

## 6. 不在范围

- E2E 测试 skip（`tests/e2e/**`）—— 性质不同（playwright app launch）
- Remote handler 测试 skip（`tests/remote/handlers/*`）—— 多数为 safety/network 合法 skip
- 200+ 总 skip 中其它 ~40 个非 vi.mock-CJS 类 skip
- ES module 化整个主进程（违 `.claude/rules/eslint-style.md`，独立 RFC）

## 7. Done 标准

- 7 文件 33 个 skip blocks 归零
- 每文件 commit 信息含 `(vi.mock CJS migration B<n>)` tag
- memory `vi_mock_cjs_interop_systemic.md` 更新到 "0 affected"
- `KNOWN_TEST_ISSUES.md` 重写或 archive
- 不引入新 skip；既有非 vi.mock-CJS skip 不动

## 8. Next step

待用户拍板：
- (a) 批准 RFC + 启 Batch 1
- (b) RFC 进 review 期，先做别的
- (c) 重写某模板或调整 batch 划分

## 附录：规范章节补全（v5.0.3.108）

> 本文为设计文档。为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述
见正文头部。RFC: desktop-app-vue 测试 vi.mock CJS Interop 迁移：测试 mock 迁移。

### 2. 核心特性
vi.mock / CJS interop / 测试迁移 RFC。

### 3. 系统架构
见正文架构 / 设计章节。

### 4. 系统定位
ChainlessChain 的「vi.mock CJS 迁移 RFC」。

### 5. 核心功能
见正文功能 / 设计章节。

### 6. 技术架构
见正文实现 / 技术章节。

### 7. 系统特点
见正文（状态 / 版本 / 特性）。

### 8. 应用场景
见正文应用场景 / 背景。

### 9. 竞品对比
见正文对比 / 借鉴（如有）。

### 10. 配置参考
见正文配置 / 参数章节。

### 11. 性能指标
见正文性能 / 指标章节。

### 12. 测试覆盖
见正文测试 / E2E 章节。

### 13. 安全考虑
见正文安全 / 权限章节。

### 14. 故障排除
见正文故障 / trap / 已知限制章节。

### 15. 关键文件
见正文实现位置 / 关键文件章节。

### 16. 使用示例
见正文使用 / 命令 / API 示例。

### 17. 相关文档
[系统设计主文档](./系统设计_主文档.md)、相关设计文档。
