# Cowork Evolution N1–N7 详细设计

> **制定日期**: 2026-04-15
> **前置**: v0.46.0（F1–F9 已落地）— 见 `86_Web_Cowork日常任务协作系统.md` / `docs-site/docs/design/modules/86-web-cowork.md`
> **目标版本**: v0.46.x → v0.47.x
> **实施原则**: 每个 N 一个 commit；全部 CLI-first、`_deps` 注入可测；除 N1 外不涉及 web-panel；DID/EvoMap 走既有模块；向后兼容。

---

## 概览

| # | 名称 | 阶段 | 主要文件 | 预估测试 |
|---|------|------|----------|---------|
| N5 | Cron 秒级 + 别名 | 短期 | `cowork-cron.js` | 10 |
| N3 | Workflow 条件 + forEach | 中期 | `cowork-workflow.js` | 24 |
| N2 | Learning 反馈闭环 | 中期 | `cowork-learning.js` + `cowork-task-templates.js` | 16 |
| N4 | 包 DID 签名 | 中期 | `cowork-share.js` + `did.js` | 18 |
| N6 | 可观测性仪表盘 | 中期 | `cowork-observe.js`（新）+ `web-ui-server.js` 复用 | 16 |
| N7 | 模板市场 EvoMap 集成 | 长期 | `cowork-template-marketplace.js` + `evomap-client.js` | 18 |
| N1 | Workflow 可视化编辑器 | 短期 | `web-panel/views/WorkflowEditor.vue` + WS handlers | 16 |
| | **合计** | | | **118** |

实施顺序（按复杂度↑与前置依赖）：**N5 → N3 → N2 → N4 → N6 → N7 → N1**。

---

## N5 — Cron 秒级 + 别名

### 背景
`cowork-cron.js::parseCron` 当前只接受 5 字段 POSIX（`m h dom mon dow`），且 dow 的 `0`/`7` 等价。不支持：
- 6 字段模式（首字段秒，类 Quartz）
- 字符串别名 `@hourly` `@daily` `@weekly` `@monthly` `@yearly` `@reboot`

### 设计

**扩展入口**：`parseCron(expr)` 增加预处理层

```js
const ALIASES = {
  "@yearly":   "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
  "@monthly":  "0 0 1 * *",
  "@weekly":   "0 0 * * 0",
  "@daily":    "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@hourly":   "0 * * * *",
};

function _expandExpr(expr) {
  const t = expr.trim();
  if (t.startsWith("@")) {
    if (!ALIASES[t]) throw new Error(`Unknown alias: ${t}`);
    return { expr: ALIASES[t], hasSeconds: false };
  }
  const parts = t.split(/\s+/);
  if (parts.length === 6) return { expr: parts.slice(1).join(" "), hasSeconds: true, sec: parts[0] };
  if (parts.length === 5) return { expr: t, hasSeconds: false };
  throw new Error(`Cron must be 5 or 6 fields, got ${parts.length}`);
}
```

- `parseCron(expr)` 返回的 matcher 变成 `(date) => boolean`，但 6 字段时还需比对 `date.getSeconds()` 匹配秒字段。
- `validateCron(expr)` 先走 `_expandExpr`，失败返回错误字符串；成功返回 `null`。
- `@reboot` 不进入周期匹配 — 改为 CronScheduler 启动时触发一次标记，scheduler 记录 `rebootTriggered` set 避免重复。

**scheduler tick 间隔**：
- `hasSeconds === true` 的任务存在 → scheduler 自动改用 1000ms 间隔（默认 60000ms）
- `CoworkCronScheduler` 构造函数新增 `_hasSecondPrecision(schedules)` 检测

**schedules.jsonl 字段扩展**：
```json
{ "id": "...", "cron": "*/30 * * * * *", "hasSeconds": true, ... }
```
`addSchedule` 写入前调 `_expandExpr` 验证。

### 文件变更

| 文件 | 变更 |
|------|------|
| `src/lib/cowork-cron.js` | `ALIASES` 常量 + `_expandExpr` + 秒字段匹配 + `hasSeconds` 标记 + scheduler 自适应 tick |
| `__tests__/unit/cowork-cron.test.js` | +10 tests |

### 测试计划（10）

1. `parseCron("@hourly")` 匹配每小时 0 分
2. `parseCron("@daily")` 匹配每日 00:00
3. `parseCron("@weekly")` 匹配周日 00:00
4. `parseCron("@monthly")` 匹配每月 1 号 00:00
5. `parseCron("@yearly")` 匹配 1/1 00:00
6. `validateCron("@bogus")` 返回字符串错误
7. `parseCron("0 */10 * * * *")` 6 字段，每 10 分钟的第 0 秒匹配
8. `parseCron("30 */15 * * * *")` 每 15 分钟的第 30 秒匹配
9. `validateCron("* * * *")` 4 字段返回错误
10. `scheduler._tickInterval` 含秒任务时 = 1000ms

### 风险
- 秒级任务会放大 scheduler CPU；限制方案：同一进程最多 10 个秒级任务，超出报警不阻塞
- `@reboot` 语义脆弱 — CLI 重启时才触发，不记录持久状态

---

## N3 — Workflow 条件分支 + forEach

### 背景
当前 DAG 模型要求「所有步骤都必须跑」。实际场景需要：
- 上游 summary 含 "error" 时走 B 分支，否则走 C
- 对数组每项各跑一次

### 设计

**Step 定义扩展**（JSON Schema 追加字段）：

```ts
interface WorkflowStep {
  id: string;
  message: string;
  dependsOn?: string[];
  // 新增：
  when?: string;          // 表达式，评估 false 则 status=skipped
  forEach?: string;       // 占位符指向上游数组 items
  forEachAs?: string;     // 默认 "item"，在 message 中用 ${item} / ${item.field}
}
```

**表达式求值器**（沙箱）：

```js
// src/lib/cowork-workflow-expr.js (新文件)
export function evalExpr(expr, ctx) {
  // 仅支持：
  //   path.to.field            → ctx["path"]["to"]["field"]
  //   X contains "str"
  //   X == "str" / X != "str"
  //   X > N / X < N / X >= N / X <= N
  //   !X
  //   X && Y / X || Y
  // 不支持：函数调用、方括号、赋值
  // 实现：tokenize → 简单递归下降 → 求值
}
```

- 先解析为简单 AST，禁止任意 JS 求值（避免 `Function` 构造器注入）
- 变量路径走 `ctx` 对象 dot-access（`step.<id>.summary` 等，与占位符同源）

**forEach 展开**：

```js
function expandForEach(step, ctx) {
  if (!step.forEach) return [step];
  const items = resolvePath(step.forEach, ctx);
  if (!Array.isArray(items)) throw new Error(`forEach source is not an array: ${step.forEach}`);
  return items.map((item, i) => ({
    ...step,
    id: `${step.id}.${i}`,   // 原始 id 保留为虚拟父，子 id 带 index 后缀
    _parentId: step.id,
    message: substitutePlaceholders(step.message, { ...ctx, [step.forEachAs || "item"]: item }),
  }));
}
```

- 扩展后 `planBatches` 在原有拓扑排序前先做一次 `expandForEach`
- `dependsOn: ["myForEachStep"]` 自动等所有子步完成
- 汇总：`ctx["step"]["myForEachStep"]` = `{ items: [{id, status, summary, ...}] }`（每子步结果数组）

**when 跳过**：

- 批次内每步执行前先 `evalExpr(step.when, ctx)`；false → `{ id, status: "skipped", reason: "when=false" }`，不计入 `failed` 计数
- `continueOnError: false` 时 `skipped` 不阻塞下游（与 `completed` 等价放行）

### 文件变更

| 文件 | 变更 |
|------|------|
| `src/lib/cowork-workflow.js` | `expandForEach` + when 检查 + `validateWorkflow` 新字段 |
| `src/lib/cowork-workflow-expr.js` | **新建** — 沙箱表达式求值 |
| `__tests__/unit/cowork-workflow.test.js` | +14 tests |
| `__tests__/unit/cowork-workflow-expr.test.js` | **新建** — +10 tests |

### 测试计划（24）

**expr（10）**：
1. `evalExpr("a.b", { a: { b: 42 } })` → 42
2. `evalExpr("x contains 'err'", { x: "error here" })` → true
3. `evalExpr("x == 'done'", ...)` 字符串相等
4. `evalExpr("n > 5", { n: 10 })` → true
5. `!X` 取反
6. `A && B` / `A || B` 短路
7. 未定义路径 → undefined，比较结果 false
8. 禁止 `Function('')` / `constructor`（单元对抗性测试）
9. 方括号/函数调用报语法错误
10. 嵌套对象深度 ≥3 正常解析

**workflow（14）**：
1. `when: "false"` 步骤 status=skipped
2. `when: "step.a.summary contains 'ok'"` 基于上游摘要判断
3. skipped 不阻塞下游（下游有 dependsOn=A 时仍跑）
4. `forEach: "${step.list.items}"` 扇出 3 个子步
5. `${item}` 占位符被单个元素替换
6. `${item.field}` 取对象字段
7. forEach 源非数组 → 校验报错
8. 下游 `dependsOn: ["fanout"]` 等所有子步完成
9. 子步部分失败，`continueOnError=true` 整体 partial
10. forEach + when 组合：when 在扩展后逐子评估
11. 嵌套 forEach 不支持（明确报错）
12. forEachAs 自定义变量名
13. 0 元素数组 → 0 子步、父步 summary 为 "empty"
14. validateWorkflow 对 when/forEach 新字段格式做类型校验

### 风险
- 表达式语言需要严格沙箱化 — 任何 eval 注入都是高危 RCE；采用手写 tokenizer + 白名单运算符
- forEach 爆炸 — 大数组（>1000）会创建大量子步；限制 `MAX_FAN_OUT = 500`

---

## N2 — Learning 反馈闭环

### 背景
F9 `cowork-learning.js` 只读分析；用户看到「某模板失败率 40%，常见 summary 是 'timeout'」后只能手改模板 — 不闭环。

### 设计

**新增两个子命令**：

```
cowork learning suggest [templateId] [--json]    # 只读生成建议
cowork learning apply   <templateId> --patch <file>  # 应用建议（写用户模板层）
```

**suggest 算法**：

```js
function suggestPromptPatch(history, templateId) {
  const failures = summarizeFailures(history).find(g => g.templateId === templateId);
  if (!failures || failures.failureCount < 3) return null;

  const topSummaries = failures.commonSummaries.slice(0, 3);
  const hint = topSummaries.map(cs => `- 避免 ${cs.summary}（发生 ${cs.count} 次）`).join("\n");

  return {
    templateId,
    basedOn: { failureCount: failures.failureCount, samples: topSummaries },
    promptAppend:
      `\n\n## 常见失败模式（基于历史 ${failures.failureCount} 次）\n${hint}\n请在任务开始前检查以上风险。`,
    confidence: failures.failureCount >= 10 ? "high" : "medium",
  };
}
```

- 门槛 `failureCount >= 3`，< 3 返回 null
- `confidence` 按样本量分 low(3-5) / medium(6-9) / high(10+)
- **不触及** bundled 模板（`source: "built-in"`）— 强制写入 `.chainlesschain/cowork/user-templates/<id>.json`（即便原模板来自 bundled，apply 创建副本）

**apply 流程**：

1. 读 `--patch <file>`（即 suggest 的 JSON 输出）
2. 校验 `patch.templateId` 存在于 bundled/user 层
3. 读当前模板（优先 user，其次 bundled 拷贝）
4. `newTemplate.systemPromptExtension = oldTemplate.systemPromptExtension + patch.promptAppend`
5. `newTemplate.version = bumpVersion(oldTemplate.version || "1.0.0")`
6. `newTemplate._patchedFrom = { at: now(), patchDigest: sha256(patch.promptAppend).slice(0,16) }`
7. 写入 user 层
8. 审计日志追加到 `.chainlesschain/cowork/learning-patches.jsonl`

### 文件变更

| 文件 | 变更 |
|------|------|
| `src/lib/cowork-learning.js` | 导出 `suggestPromptPatch(history, templateId)` |
| `src/lib/cowork-template-marketplace.js` | 导出 `getUserTemplate(cwd, id)` / `saveUserTemplate` 已有 |
| `src/commands/cowork.js` | learning 子树加 `suggest` / `apply` |
| `__tests__/unit/cowork-learning.test.js` | +8 tests (suggest) |
| `__tests__/integration/cowork-learning-apply.test.js` | **新建** — +6 tests（真 fs 读写） |
| `__tests__/e2e/cowork-evolution-commands.test.js` | +2 tests |

### 测试计划（16）

**suggest（8）**：
1. 失败数 <3 返回 null
2. 失败数 =3 返回 confidence=medium
3. 失败数 ≥10 返回 confidence=high
4. promptAppend 包含 Top3 summary
5. basedOn.failureCount 与 samples 正确
6. 未知 templateId → null
7. 历史中无失败 → 所有模板 null
8. `suggestPromptPatch` 不修改 history（只读）

**apply 集成（6）**：
9. 对 bundled 模板 apply 创建 user 层副本
10. 对 user 模板 apply 原地更新
11. version bump 正确
12. `_patchedFrom.patchDigest` 稳定
13. `learning-patches.jsonl` 追加记录
14. patch.templateId 不匹配文件头时报错

**E2E（2）**：
15. `cc cowork learning suggest writer --json` → 有效 JSON
16. `cc cowork learning apply writer --patch x.json` 写文件并重新 `getTemplate(writer)` 体现变化

### 关键约束
- **人工确认不自动化**：`apply` 要求 `--patch <file>` 显式传入，suggest 不能直接触发 apply
- **不改 bundled**：与桌面端「技能漂移保护」原则一致
- **隐私**：patches.jsonl 仅本地

---

## N4 — 包 DID 签名

### 背景
F8 `cowork-share.js` 当前用 canonical-JSON + SHA-256：**防数据损坏，但不防伪造**。任何人都能造包。

### 设计

**签名字段追加**（保持向后兼容）：

```js
buildPacket({ kind, payload, author, cliVersion, signer })
// signer 可选:
//   { did: "did:key:z6Mk...", privateKey: Uint8Array(32) }
// 产生：
//   packet.signature = {
//     alg: "Ed25519",
//     did: signer.did,
//     sig: base64url(ed25519.sign(privateKey, sha256(canonical(bodyWithoutSig))))
//   }
```

- `canonicalize` 忽略 `checksum` 和 `signature`（两者按固定顺序计算）
- 先算 `checksum` → 再算 signature（可选）→ 合并

**读包验证**：

```js
readPacket(filePath, { requireSigned, trustedDids })
// 1. JSON.parse
// 2. verifyChecksum(packet) — 既有行为
// 3. 若 packet.signature 存在:
//    - 导入 did.js 的 publicKeyFromDid(packet.signature.did)
//    - ed25519.verify(pubKey, sig, sha256(canonical(body)))
//    - 失败 → throw "signature invalid"
// 4. 若 requireSigned === true 且 !packet.signature → throw "unsigned packet"
// 5. 若 trustedDids 非空且 packet.signature.did 不在列表 → throw "untrusted signer"
```

**CLI 集成**：

```
cowork share export-template <id> --out pkt.json --author alice [--sign <didId>]
cowork share import <file> [--require-signed] [--trust <did>]
```

- `--sign <didId>` 查本地 DID 存储（复用 `did.js::getDidByLabel` 或类似）
- `--trust` 支持多次：`--trust did:key:1 --trust did:key:2`

**向后兼容**：
- 无 signature 字段的包 → 按旧逻辑处理（只校验 checksum）
- `readPacket` 默认 `requireSigned: false`，不破坏 v0.46.0 行为

### 文件变更

| 文件 | 变更 |
|------|------|
| `src/lib/cowork-share.js` | `buildPacket` signer 参数 + `verifyPacket` signature 校验 + `readPacket` opts |
| `src/lib/did.js` | 导出 `signBytes(privateKey, bytes)` / `verifyBytes(did, sig, bytes)` |
| `src/commands/cowork.js` | share export/import CLI 选项 |
| `__tests__/unit/cowork-share.test.js` | +12 tests |
| `__tests__/integration/cowork-share-did.test.js` | **新建** — +4 tests（生成 DID → 签 → 验） |
| `__tests__/e2e/cowork-evolution-commands.test.js` | +2 tests |

### 测试计划（18）

1–12 同 share.test.js 新增：
- 签名包 verify 通过
- 签名包 payload 被改 → verify 失败
- 签名被改 → verify 失败
- did 不合法格式 → 拒绝
- 未签名包 `verifyPacket` 通过（v0.46 兼容）
- `readPacket({requireSigned:true})` 拒绝未签名包
- `trustedDids` 白名单
- checksum 与 signature 独立 — checksum 改 → 只报 checksum 错
- `signer.privateKey` 长度错 → 抛错
- 别名 algs 不支持 → 抛错
- canonical 不覆盖 signature 字段（否则循环）
- sig base64url 无 padding

13–16 集成：
- 真用户 DID 生成 → 签包 → 验包
- 跨目录：A 导出 B 导入验签
- trustedDids 匹配与不匹配路径
- require-signed 开关行为

17–18 E2E：
- `cc did create --label test` → `cc cowork share export-* --sign test` → 新包含 signature
- `cc cowork share import x.pkt.json --require-signed` 对未签包退出非 0

---

## N6 — Cowork 可观测性仪表盘

### 背景
历史文件多：`history.jsonl` / `workflow-history.jsonl` / `schedules.jsonl` / `shared-results/` — 缺统一看板。

### 设计

**新增命令**：

```
cowork observe [--json]                   # 聚合报告
cowork observe serve [--port 18820]       # 启动只读 HTTP 仪表盘
```

**聚合算法**（`cowork-observe.js` 新建）：

```js
export function aggregate(cwd, { windowDays = 7 } = {}) {
  const now = Date.now();
  const cutoff = now - windowDays * 86400_000;
  const history = loadHistory(cwd).filter(r => parseTs(r.timestamp) >= cutoff);
  return {
    window: { days: windowDays, from: new Date(cutoff).toISOString() },
    tasks: {
      total: history.length,
      completed: history.filter(r => r.status === "completed").length,
      failed: history.filter(r => r.status === "failed").length,
      successRate: /* computed */,
      avgTokens: /* */,
    },
    templates: computeTemplateStats(history),      // 复用 F9
    failures: summarizeFailures(history),          // 复用 F9
    workflows: _loadWorkflowHistory(cwd, cutoff),  // top 10 runs
    schedules: {
      active: loadSchedules(cwd).filter(s => s.enabled !== false).length,
      nextTriggers: _computeNextTriggers(cwd, 5),  // 下 5 次触发时间
    },
  };
}
```

**HTTP 仪表盘**：

- 复用 `packages/cli/src/lib/web-ui-server.js` 模式（HTTP + 单页 HTML）
- 路由：
  - `GET /` → HTML 页面（内嵌 `<script>__DATA__ = ...</script>` 注入 aggregate 结果）
  - `GET /api/observe?days=7` → JSON
- 单页用最小依赖（chart.js CDN 或纯 CSS bar），渲染：
  - 窗口期任务数 / 成功率
  - 模板柱状图（按 runs 排序）
  - Top 失败 summary
  - 下 5 次 cron 触发时间
- XSS 防护：同 ui 命令，`\u003c` escape

**_computeNextTriggers**:
- 读 `schedules.jsonl`
- 对每个 enabled schedule 用 `parseCron` 从 now 开始分钟级向前试探最多 365 天（超出放弃）
- 取最近 5 个

### 文件变更

| 文件 | 变更 |
|------|------|
| `src/lib/cowork-observe.js` | **新建** — aggregate + next-trigger 计算 |
| `src/lib/cowork-observe-html.js` | **新建** — buildHtml(data) 纯函数（便于测试） |
| `src/commands/cowork.js` | observe 子树（无 observe）|
| `__tests__/unit/cowork-observe.test.js` | **新建** — +10 tests |
| `__tests__/integration/cowork-observe-serve.test.js` | **新建** — +3 tests（HTTP 起停）|
| `__tests__/e2e/cowork-evolution-commands.test.js` | +3 tests |

### 测试计划（16）

**aggregate（10）**：
1. 空 history → 返回 total:0、templates:[]
2. windowDays=7 过滤掉 8 天前的记录
3. successRate = completed/total
4. avgTokens 仅计入有 tokenCount 的记录
5. templates 按 runs desc 排序
6. failures 合并相同 summary
7. workflows 读 workflow-history.jsonl
8. schedules.active 排除 enabled=false
9. _computeNextTriggers 对 `*/15 * * * *` 返回相邻 5 个 15 分钟倍数
10. 全部 disabled → nextTriggers=[]

**buildHtml（pure）包含在 10 内**：
11. html 包含 `<meta charset="UTF-8">`
12. 注入 `__DATA__` 正确 escape `<`/`>`/`&`

**serve 集成（3）**：
13. 启动 HTTP，GET /api/observe 返回 200+JSON
14. GET / 返回 200 HTML 含 __DATA__
15. 未知路径返回 404

**E2E（3）**：
16. `cc cowork observe --json` 含 tasks/templates/schedules 顶级键
17. `cc cowork observe serve --port 0` 打印端口并存活
18. `cc cowork observe --json` 在空目录（无 history）不崩溃

---

## N7 — 模板市场 EvoMap 集成

### 背景
F3 `cowork template publish` 仅本地生成 JSON；社区模板无法发现/交换。

### 设计

**新增适配层**：`src/lib/cowork-evomap-adapter.js`

```js
import { createEvomapClient } from "./evomap-client.js";  // 假设已有 or 由 commands/evomap.js 暴露

export async function publishTemplateToHub(template, { hubUrl, signer }) {
  const client = createEvomapClient({ hubUrl });
  const packet = toShareableTemplate(template);           // F3 既有
  const signed = signer ? attachSignature(packet, signer) : packet;  // N4 复用
  return client.publishGene({ kind: "cowork-template", gene: signed });
}

export async function searchTemplatesInHub({ query, hubUrl, limit = 20 }) {
  const client = createEvomapClient({ hubUrl });
  const results = await client.searchGenes({ kind: "cowork-template", query, limit });
  return results.map(r => ({ ...r.gene, _hubMeta: { hubUrl, downloads: r.downloads } }));
}
```

**CLI 扩展**：

```
cowork template publish <id> [--hub <url>] [--sign <didLabel>]
cowork template search [query] [--hub <url>] [--limit 20]
cowork template install <id> [--from-hub <url>]
```

- `--hub` 缺省从 `.chainlesschain/config.json::evomap.defaultHub` 读取
- 已知 hub 列表也复用 `evomap hubs` 配置
- search 结果与本地合并显示，来源列加 `[hub]` 标识
- install `--from-hub` → 先 `client.fetchGene(id)` → 本地保存

**离线降级**：
- 无网络 → warn + 只返回本地结果
- `--hub` 显式传入时网络失败 → 非零退出

### 文件变更

| 文件 | 变更 |
|------|------|
| `src/lib/cowork-evomap-adapter.js` | **新建** — publish/search/fetch 封装 |
| `src/lib/cowork-template-marketplace.js` | `listUserTemplates` 增加 `source` 字段区分 local/hub |
| `src/commands/cowork.js` | template publish/search/install 增加 --hub 选项 |
| `__tests__/unit/cowork-evomap-adapter.test.js` | **新建** — +10 tests（mock evomap-client）|
| `__tests__/integration/cowork-evomap-integration.test.js` | **新建** — +5 tests（本地 fake hub HTTP）|
| `__tests__/e2e/...` | +3 tests |

### 测试计划（18）

**adapter（10）**：
1. publishTemplateToHub 调用 client.publishGene 带 kind=cowork-template
2. 签名透传（signer 给出时）
3. searchTemplatesInHub 调用 client.searchGenes
4. 结果附加 `_hubMeta`
5. publish 网络失败抛错
6. search 网络失败返回 []（降级）
7. limit 传递
8. hub URL 从 config 读取
9. hub URL 显式传入覆盖 config
10. `attachSignature` 未给 signer 时不变

**集成（5）**：假 HTTP 服务模拟 EvoMap Hub
11. publish → hub 收到正确 payload
12. search → hub 返回 → CLI 渲染
13. install --from-hub → 本地文件落盘
14. 签名包 install → 本地保留 signature 字段
15. 401 响应 → 报错退出

**E2E（3）**：
16. `cc cowork template publish <id> --hub http://fake` 调命令行能跑通
17. `cc cowork template search foo --hub http://fake` 打印
18. `cc cowork template install <id> --from-hub http://fake`

### 风险
- EvoMap 协议字段漂移 — 用 zod 或手写校验在 adapter 边界锁 schema
- 滥发模板 spam — 依赖 EvoMap 自己的声誉/签名模型

---

## N1 — Workflow 可视化编辑器

### 背景
F7 `cowork workflow add` 要求用户手写 JSON。可视化可以把门槛降到拖拽水平。

### 设计

**前端架构**（packages/web-panel）：

- 依赖：`@vue-flow/core`（MIT，零 wrapper，~40KB gzip）
- 新页面 `/cowork/workflow` → `WorkflowEditor.vue`
- 组件结构：
  - 左栏：workflow 列表（调 `workflow:list` WS）
  - 中央：Vue Flow 画布 — 节点=step，边=dependsOn
  - 右栏：选中节点属性编辑器（id / message / when / forEach / forEachAs）
  - 顶部：Save / Run / Cancel / Export JSON
- 节点类型：`step`（矩形，显示 id + 首行 message）、`start`（virtual 入口）、`end`（虚拟出口）

**后端 WS 扩展**：

| 消息 | 方向 | payload | 响应 |
|------|------|---------|------|
| `workflow-list` | C→S | `{}` | `{ workflows: [] }` |
| `workflow-get` | C→S | `{ id }` | `{ workflow }` |
| `workflow-save` | C→S | `{ workflow }` | `{ id, saved: true }` |
| `workflow-remove` | C→S | `{ id }` | `{ removed }` |
| `workflow-run` | C→S | `{ id }` | 事件流 `workflow:step-start/complete/done` |
| `workflow:step-start` | S→C | `{ runId, stepId }` | — |
| `workflow:step-complete` | S→C | `{ runId, stepId, status, summary }` | — |
| `workflow:done` | S→C | `{ runId, status }` | — |

**文件拆分**：

| 文件 | 变更 |
|------|------|
| `packages/web-panel/src/views/WorkflowEditor.vue` | **新建**（主页面）|
| `packages/web-panel/src/components/WorkflowNode.vue` | **新建**（自定义节点）|
| `packages/web-panel/src/stores/workflow.js` | **新建**（WS 通信 + state）|
| `packages/web-panel/src/router/index.js` | 增加 `/cowork/workflow` 路由 |
| `packages/web-panel/src/components/AppLayout.vue` | 侧栏增加入口 |
| `packages/web-panel/package.json` | `@vue-flow/core` |
| `packages/cli/src/gateways/ws/action-protocol.js` | 5 个新 handler |
| `packages/cli/src/gateways/ws/message-dispatcher.js` | 5 条新路由 |
| `packages/cli/src/gateways/ws/ws-server.js` | 5 个 delegate |

**关键 UX**：
- 拖边：源节点 → 目标节点，写入 `step.dependsOn`
- 删边：点边 → Del，移除 dependsOn 项
- 循环检测：保存前本地调 `validateWorkflow`（可以直接复用后端逻辑，复制到 web-panel/utils/）
- 占位符自动补全：message 输入框光标处输入 `${` → 下拉提示 `step.<id>.summary`

**安全**：
- `workflow-save` 后端强制 `validateWorkflow`，拒绝循环
- message 内容不渲染为 HTML（WorkflowEditor 侧都用 DOMPurify + marked 或纯文本）

### 测试计划（16）

**后端 WS（8）**：
1. `workflow-list` 空返回 `[]`
2. `workflow-save` 正常保存 → listWorkflows 可见
3. `workflow-save` 循环 dependsOn → 错误响应
4. `workflow-save` 重复 id 覆盖
5. `workflow-get` 存在 → workflow 对象
6. `workflow-get` 不存在 → `{ workflow: null }`
7. `workflow-remove` → `removed: true`
8. `workflow-run` 触发 `workflow:step-start`/`workflow:done`

**前端 store（5，vitest + happy-dom 或 jsdom）**：
9. `useWorkflowStore().list()` 调 WS send 并等响应
10. `save()` 乐观更新 + 回滚
11. 事件流 `workflow:step-complete` 追加到 state
12. `exportJson()` 返回 `JSON.stringify(workflow, null, 2)`
13. `validate()` 检出循环

**组件冒烟（3）**：
14. Mount `<WorkflowEditor>` 不崩溃
15. 拖节点生成 add dependsOn
16. DOMPurify 过滤 `<img onerror=`

### 风险
- Vue Flow 体积 — 监控 build size，超过 +100KB 触发警报
- 大工作流（>50 步）性能 — Vue Flow 对此已有虚拟化，首版只要不崩溃即可

---

## 共同约定

### 版本与发布
- 每个 N 一个 commit，遵循 `feat(cli): N<x> ...` 或 `feat(web-panel): N1 ...`
- N5/N3/N2/N4/N6 落地后 → v0.46.x 补丁；N7/N1 → v0.47.0
- CHANGELOG / README 增量更新按既有格式

### 测试汇总
- **新增测试预估**：N5(10) + N3(24) + N2(16) + N4(18) + N6(16) + N7(18) + N1(16) = **118**
- 既有 v0.46.0 83 tests + 本轮 118 = Cowork 模块累计 **201 tests**

### 回滚策略
- 每个 N 独立开关，未启用时行为等于 v0.46.0
- N5 别名 → 新语法向前兼容
- N3 新字段缺省 → 行为不变
- N2 未调 apply → 模板不变
- N4 无 signature → 旧行为
- N6/N7 纯新增命令
- N1 纯新增路由

---

## 附录：决策记录（ADR 摘要）

| 决策 | 选择 | 备选 | 理由 |
|------|------|------|------|
| 表达式求值 | 手写 tokenizer + 递归下降 | Function 构造器 / eval / new Function | 防 RCE，沙箱可验证 |
| forEach 上限 | 500 | 无限 / 100 | 平衡爆炸防护与可用性 |
| Learning 自动应用 | 明确禁止 | 定时 apply / 阈值触发 | 防 prompt 漂移，与 CLAUDE.md 保持一致 |
| 签名算法 | Ed25519 | ECDSA secp256k1 / RSA | 复用既有 DID 模块，小签名 |
| 仪表盘依赖 | 纯 HTML + 内联数据 | React/Vue SPA | 零构建，与 `web-ui-server.js` 模式一致 |
| EvoMap adapter 边界 | 显式 adapter 模块 | 直接在命令里调 evomap-client | 易 mock、易换实现 |
| N1 图库 | Vue Flow | Cytoscape / mermaid-render / 自画 | MIT、Vue3 原生、体积可接受 |

---

**参考文档**:
- `86_Web_Cowork日常任务协作系统.md` — F1–F9 实施与演进基线
- `docs-site/docs/chainlesschain/cli-cowork.md` — v0.46.0 用户文档
