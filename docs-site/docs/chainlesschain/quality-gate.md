# QualityGate 通用质量门控

> **版本: v1.0 (2026-04-16) | 状态: ✅ 生产就绪 | 4 个内置工厂 | 3 种聚合策略 | 39 测试通过**
>
> QualityGate 把"质量检查"抽象为可注册的 checker 函数 + 可配置的聚合策略 + 可调的阈值门控，让所有 Skill / Agent / Pipeline 都能声明式地使用质量门控，不需要各自发明一套。借鉴 CutClaw 的 Reviewer Gate 设计泛化而来。

## 概述

QualityGate 解决的核心问题：质量检查散布在多个系统中（Desktop Workflow 硬编码 5 种检查、CutClaw 仅限 video、CLI lint 无标准化评分、DebateReview 仅投票无评分），缺乏统一的注册表、评分和门控机制。QualityGate 提供统一的 checker 注册 → 执行 → 聚合 → 门控流程，领域无关、可组合、可观测。

## 核心特性

- 📝 **Checker 注册表**: `gate.register()` 注册领域无关的质量检查函数
- 📊 **三种聚合策略**: `weighted-mean`（加权平均）/ `min`（木桶效应）/ `all-pass`（严格全通过）
- 🎯 **阈值门控**: 聚合分 ≥ threshold 视为通过，支持动态调整
- 🏷️ **Tag 过滤**: 运行时通过 `only` 或 `tags` 精确控制执行范围
- 📡 **遥测回调**: `onCheck` 回调上报每个 checker 结果
- 🏭 **4 个内置工厂**: 覆盖 video + code 场景，开箱即用
- ⚡ **零强绑**: checker 是普通对象，不依赖 session-core 其他模块
- 🔄 **score clamp**: 自动 clamp 到 [0, 1]，防止越界
- 🛡️ **容错降级**: checker 抛错时 graceful degradation，不中断整体检查

## Checker 注册与执行

### 注册自定义 Checker

```javascript
const {
  QualityGate,
  QUALITY_AGGREGATE,
} = require("@chainlesschain/session-core");

const gate = new QualityGate({
  threshold: 0.6,
  aggregate: QUALITY_AGGREGATE.WEIGHTED_MEAN,
  onCheck: (checkResult) => telemetry.record(checkResult),
});

gate.register({
  name: "lint-pass",
  fn: async (result) => ({
    pass: result.errors === 0,
    score: 1 - result.errors / result.total,
  }),
  weight: 1,
  tags: ["code"],
});

const { pass, score, checks } = await gate.check(pipelineResult, context);
```

### 使用内置 Checker 工厂

```javascript
const {
  QualityGate,
  createProtagonistChecker,
  createDurationChecker,
  createThresholdChecker,
  createLintPassChecker,
} = require("@chainlesschain/session-core");

const gate = new QualityGate({ threshold: 0.7 });

gate.register(createProtagonistChecker({ minRatio: 0.3 }));
gate.register(createDurationChecker({ tolerance: 0.15 }));
gate.register(createThresholdChecker({ field: "confidence", minValue: 0.8 }));
gate.register(createLintPassChecker({ maxErrors: 0 }));

const result = await gate.check({
  protagonist_ratio: 0.8,
  target_duration: 60,
  total_duration: 65,
  confidence: 0.9,
  errorCount: 0,
  totalCount: 50,
});
```

### Tag 和 Only 过滤

```javascript
// 仅运行 video 相关 checker
const videoResult = await gate.check(result, context, { tags: ["video"] });

// 仅运行指定 checker
const lintResult = await gate.check(result, context, { only: ["lint-pass"] });
```

## Checker 接口

```typescript
interface Checker {
  name: string;                                    // 唯一标识
  fn: (result: any, context: any) => Promise<{     // 检查函数
    pass: boolean;
    score: number;   // [0, 1]，超出范围自动 clamp
    reason?: string; // 可选的检查理由
  }>;
  weight?: number;   // 聚合权重，默认 1
  description?: string;
  tags?: string[];   // 用于 tag-based 过滤
}
```

## 聚合策略

| 策略 | 语义 | 适用场景 |
|------|------|----------|
| `weighted-mean` | &Sigma;(score &times; weight) / &Sigma;(weight) | 多维度综合评分（默认） |
| `min` | 取最低分 | 木桶效应，任一维度差则差 |
| `all-pass` | 全部 pass → 1，任一 fail → 0 | 严格门控，CI/CD 场景 |

SKIP 状态的 checker 在聚合时自动跳过，不影响分数。

## 内置 Checker 工厂

| 工厂函数 | 输入字段 | 用途 | 默认 tags |
|----------|----------|------|-----------|
| `createProtagonistChecker({ minRatio })` | `protagonist_ratio` | 视频主角占比 ≥ minRatio | `["video", "vision"]` |
| `createDurationChecker({ tolerance })` | `target_duration`, `total_duration` | 时长偏差 ≤ tolerance | `["video", "timing"]` |
| `createThresholdChecker({ field, minValue })` | `result[field]` | 通用字段阈值 | 自定义 |
| `createLintPassChecker({ maxErrors })` | `errorCount`, `totalCount` | lint/test 错误数 ≤ maxErrors | `["code"]` |

## 与 ApprovalGate 的关系

```
ApprovalGate: 策略级 — "这个 tool 是否允许执行？" (执行前)
QualityGate:  内容级 — "这次执行的结果是否达标？" (执行后)
```

两者互补，不替代。可串联使用：先 ApprovalGate 决定执行权限，执行后 QualityGate 评估结果质量。

## 系统架构

```
┌─────────────────────────────────────────────────┐
│                 消费方                           │
│                                                  │
│  ┌──────────────┐  ┌─────────────┐  ┌─────────┐│
│  │Video Editing  │  │DebateReview │  │Workflow ││
│  │--review flag  │  │冲突解决     │  │Pipeline ││
│  └──────┬───────┘  └──────┬──────┘  └────┬────┘│
└─────────┼─────────────────┼──────────────┼──────┘
          │                 │              │
          ▼                 ▼              ▼
┌─────────────────────────────────────────────────┐
│              QualityGate                         │
│                                                  │
│  register(checker)  →  check(result, ctx, opts) │
│                                                  │
│  ┌──────────────────────────────────────────┐   │
│  │         Checker 注册表                    │   │
│  │  protagonistChecker (weight:2, video)    │   │
│  │  durationChecker   (weight:1, video)     │   │
│  │  lintPassChecker   (weight:1, code)      │   │
│  │  thresholdChecker  (weight:1.5, custom)  │   │
│  └──────────────────────────────────────────┘   │
│                     │                            │
│                     ▼                            │
│  ┌──────────────────────────────────────────┐   │
│  │         聚合引擎                          │   │
│  │  weighted-mean / min / all-pass          │   │
│  │  → score (clamp [0,1])                   │   │
│  │  → pass (score ≥ threshold)              │   │
│  └──────────────────────────────────────────┘   │
│                     │                            │
│                     ▼                            │
│  onCheck(checkResult) → 遥测上报                 │
└─────────────────────────────────────────────────┘
```

## 配置参考

### QualityGate 构造参数

```javascript
{
  threshold: 0.6,                      // 通过阈值 [0, 1]，默认 0.6
  aggregate: "weighted-mean",          // 聚合策略，默认 "weighted-mean"
  onCheck: null,                       // 遥测回调 (checkResult) => void
}
```

### Checker 注册参数

```javascript
{
  name: "my-checker",                  // 必填：唯一标识
  fn: async (result, ctx) => ({        // 必填：检查函数
    pass: true,
    score: 0.85,
    reason: "all good",
  }),
  weight: 1,                           // 可选：聚合权重，默认 1
  description: "检查描述",              // 可选
  tags: ["custom"],                    // 可选：tag 过滤
}
```

### check() 选项

```javascript
{
  only: ["lint-pass"],                 // 可选：仅运行指定 checker
  tags: ["code"],                      // 可选：仅运行匹配 tags 的 checker
}
```

## 性能指标

### 响应时间

| 操作 | 目标 | 实际 | 状态 |
|------|------|------|------|
| register() | &lt; 1ms | &lt; 0.1ms | ✅ |
| check() (4 checkers) | &lt; 15ms | &lt; 10ms | ✅ |
| 聚合计算 | &lt; 1ms | &lt; 0.1ms | ✅ |
| validateChecker | &lt; 1ms | &lt; 0.1ms | ✅ |

### 资源使用

| 指标 | 数值 |
|------|------|
| 内存占用 (单 gate) | &lt; 1MB |
| Checker 数量上限 | 无限制 |
| 并发检查支持 | Promise.all |

## 测试覆盖率

### 单元测试

```
✅ quality-gate.test.js                - 39 测试用例
  ├── validateChecker 拒绝非法 checker（缺 name/fn、负 weight）
  ├── aggregateScore 三种策略正确（weighted-mean / min / all-pass）
  ├── aggregateScore 跳过 SKIP 状态条目
  ├── QualityGate.check 处理 checker 抛错（graceful degradation）
  ├── QualityGate.check 支持 only 和 tags 过滤
  ├── onCheck 遥测回调触发
  ├── score 自动 clamp 到 [0, 1]
  └── 4 个内置 checker 工厂覆盖 video + code 场景
```

**总覆盖率**: 39 测试，100% 通过

### 消费方测试

```
✅ debate-review.test.js               - 34 测试 (含冲突解决 + 质量评分)
✅ video-editing-pipeline.test.js       - --review 质量门控路径
```

## 安全考虑

### 输入验证

1. **Checker 验证** — `validateQualityChecker()` 拒绝缺 name/fn、负 weight 的 checker
2. **Score clamp** — 自动 clamp 到 [0, 1]，防止越界攻击
3. **参数类型检查** — threshold / weight 必须为 number，aggregate 必须为已知策略

### 容错安全

1. **Checker 抛错容错** — 单个 checker 抛错不中断整体检查，标记为 SKIP
2. **空结果处理** — 无 checker 匹配时返回 `{ pass: true, score: 1 }`（无检查视为通过）
3. **权重为零防护** — 所有权重为零时聚合策略正确处理

### 遥测安全

1. **onCheck 隔离** — 遥测回调抛错不影响检查结果
2. **无敏感数据** — checkResult 仅包含 name/pass/score/reason，不含原始数据

## 故障排查

### 常见问题

**Q: check() 返回 pass=true 但期望 fail?**

检查以下几点:

1. threshold 设置是否正确 — 默认 0.6，可能需要调高
2. weight 分布是否合理 — 高权重 checker 通过会拉高整体分数
3. 使用 `all-pass` 策略 — 如果需要全部通过才算通过

**Q: checker 被跳过 (SKIP)?**

可能原因:

1. checker fn 内部抛错 — 查看 checks 数组中的 reason 字段
2. only/tags 过滤未匹配 — 检查 checker 的 tags 和 check() 的过滤参数
3. checker 返回的 score 不在 [0, 1] — 虽然会 clamp 但可能暗示逻辑错误

**Q: 自定义 checker 注册失败?**

检查:

1. name 是否唯一 — 重复 name 会报错
2. fn 是否为函数 — 必须是 async function 或返回 Promise 的函数
3. weight 是否为正数 — 负 weight 会被拒绝

### 调试模式

```javascript
// 查看所有注册的 checker
console.log(gate.checkers);

// 使用 onCheck 回调调试
const gate = new QualityGate({
  threshold: 0.6,
  onCheck: (result) => {
    console.log(`[${result.name}] pass=${result.pass} score=${result.score} reason=${result.reason}`);
  },
});
```

## 关键文件

| 文件 | 职责 | 行数 |
|------|------|------|
| `packages/session-core/lib/quality-gate.js` | 核心类 + 聚合引擎 + 4 个工厂 | ~370 |
| `packages/session-core/__tests__/quality-gate.test.js` | 39 个测试用例 | ~340 |

### 消费方文件

| 文件 | 用法 |
|------|------|
| `packages/cli/src/skills/video-editing/reviewer.js` | `--review` flag 注册 protagonist + duration checker |
| `desktop-app-vue/src/main/ai-engine/cowork/debate-review.js` | `resolveConflictingVerdicts` 质量评分排序 |

## 使用示例

### 视频剪辑质量检查

```bash
# --review 自动注册 protagonist + duration checker
chainlesschain video edit --video raw.mp4 --audio bgm.mp3 \
  --instruction "节奏感强的角色蒙太奇" \
  --review
```

### 自定义代码质量门控

```javascript
const gate = new QualityGate({ threshold: 0.8, aggregate: "all-pass" });

gate.register(createLintPassChecker({ maxErrors: 0 }));
gate.register(createThresholdChecker({
  name: "test-coverage",
  field: "coveragePercent",
  minValue: 80,
  tags: ["code", "coverage"],
}));

const result = await gate.check({
  errorCount: 0,
  totalCount: 100,
  coveragePercent: 92,
});

if (!result.pass) {
  console.log("Quality gate failed:", result.checks.filter(c => !c.pass));
}
```

### DebateReview 冲突质量评分

```javascript
// 内部使用 — DebateReview 用 issue severity × verdict weight 做质量评分
const { resolved, conflictPairs, demotions } =
  debateReview.resolveConflictingVerdicts(reviews);
// 低质量 reviewer 被标记 _demoted，verdict 不计入最终结论
```

## 相关文档

- [Session-Core 会话运行时 →](/chainlesschain/session-core)
- [视频剪辑 Agent →](/chainlesschain/video-editing)
- [Agent Bundle 打包部署 →](/chainlesschain/agent-bundles)
- [Managed Agents 对标 →](/chainlesschain/managed-agents-parity)
- [多智能体协作 (Cowork) →](/chainlesschain/cowork)

---

> 本文档为 QualityGate 完整参考。设计文档详见：
>
> - [94. QualityGate 通用质量门控](/design/modules/94-quality-gate)
> - [93. CutClaw 借鉴 — 视频剪辑 Agent](/design/modules/93-cutclaw-video-editing-agent)
