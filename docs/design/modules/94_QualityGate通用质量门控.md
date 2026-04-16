# 94. QualityGate 通用质量门控

> 版本: v1.0
> 日期: 2026-04-16
> 状态: ✅ 已完成
> 适用范围: `packages/session-core`、`desktop-app-vue`、`packages/cli`
> 关联文档: [93. CutClaw 借鉴](./93_CutClaw借鉴_视频剪辑Agent.md)（Path B-2）/ [91. Managed Agents](./91_Managed_Agents对标计划.md)（ApprovalGate 质量扩展）

---

## 1. 结论先行

CutClaw 的 Reviewer Gate 在视频编辑领域验证了"多维度质量检查 → 加权评分 → 阈值门控"的模式。这个模式不应该锁死在视频领域——代码 lint、测试通过率、文档完整度、数据质量都可以复用同一套注册表 + 评分 + 阈值机制。

QualityGate 的设计原则：

```text
把"质量检查"抽象为可注册的 checker 函数 + 可配置的聚合策略 + 可调的阈值门控，
让所有 Skill / Agent / Pipeline 都能声明式地使用质量门控，不需要各自发明一套。
```

---

## 2. 现状与需求

### 2.1 现有质量检查散布

| 领域 | 现状 | 问题 |
|------|------|------|
| Desktop Workflow | `quality-gate-manager.js` 硬编码 5 种检查 | 不可扩展，仅限 workflow pipeline |
| Video Editing | CutClaw Path A Reviewer Gate（设计中） | 仅限 video skill |
| CLI Lint | eslint 结果人工看 | 无标准化评分/门控 |
| Code Review | DebateReview 投票制 | 无质量评分，仅投票 |
| ApprovalGate | 策略级（strict/trusted/autopilot） | 不做内容质量校验 |

### 2.2 目标

- 统一注册表：一个 `QualityGate` 实例管理所有 checker
- 领域无关：checker 只关心 `(result, context) => { pass, score, reason }`
- 可组合：加权平均、最小值、全通过三种聚合策略
- 可观测：每个 checker 结果可通过 `onCheck` 回调上报遥测
- 零强绑：checker 是工厂函数返回的普通对象，不依赖 session-core 其他模块

---

## 3. 设计

### 3.1 核心 API

```javascript
const gate = new QualityGate({
  threshold: 0.6,           // 聚合分 ≥ 0.6 视为通过
  aggregate: "weighted-mean", // 聚合策略
  onCheck: (checkResult) => telemetry.record(checkResult),
});

// 注册
gate.register({
  name: "lint-pass",
  fn: async (result) => ({ pass: result.errors === 0, score: 1 - result.errors / result.total }),
  weight: 1,
  tags: ["code"],
});

// 执行
const { pass, score, checks } = await gate.check(pipelineResult, context, {
  only: ["lint-pass"],      // 可选：仅跑指定 checker
  tags: ["code"],           // 可选：仅跑匹配 tags 的 checker
});
```

### 3.2 Checker 接口

```typescript
interface Checker {
  name: string;                                    // 唯一标识
  fn: (result: any, context: any) => Promise<{     // 检查函数
    pass: boolean;
    score: number;   // [0, 1]
    reason?: string;
  }>;
  weight?: number;   // 聚合权重，默认 1
  description?: string;
  tags?: string[];   // 用于 tag-based 过滤
}
```

### 3.3 聚合策略

| 策略 | 语义 | 适用场景 |
|------|------|----------|
| `weighted-mean` | Σ(score × weight) / Σ(weight) | 多维度综合评分 |
| `min` | 取最低分 | 木桶效应，任一维度差则差 |
| `all-pass` | 全部 pass → 1，任一 fail → 0 | 严格门控 |

### 3.4 内置 Checker 工厂

| 工厂 | 输入字段 | 用途 |
|------|----------|------|
| `createProtagonistChecker({ minRatio })` | `protagonist_ratio` | 视频主角占比 |
| `createDurationChecker({ tolerance })` | `target_duration`, `total_duration` | 时长偏差 |
| `createThresholdChecker({ field, minValue })` | `result[field]` | 通用阈值 |
| `createLintPassChecker({ maxErrors })` | `errorCount`, `totalCount` | lint/test |

工厂返回标准 Checker 对象，调用方 `gate.register(factory())` 即可。

### 3.5 与 ApprovalGate 的关系

```
ApprovalGate: 策略级 — "这个 tool 是否允许执行？"
QualityGate:  内容级 — "这次执行的结果是否达标？"
```

两者互补，不替代。ApprovalGate 在执行前决定权限，QualityGate 在执行后评估质量。

---

## 4. 实现

### 4.1 文件

| 文件 | 行数 | 职责 |
|------|------|------|
| `packages/session-core/lib/quality-gate.js` | ~370 | 核心类 + 聚合 + 4 个 checker 工厂 |
| `packages/session-core/__tests__/quality-gate.test.js` | ~340 | 39 个测试 |

### 4.2 导出

```javascript
// 从 session-core 导入
const {
  QualityGate,
  QUALITY_CHECK_RESULT,   // { PASS, FAIL, SKIP }
  QUALITY_AGGREGATE,       // { WEIGHTED_MEAN, MIN, ALL_PASS }
  validateQualityChecker,
  qualityAggregateScore,
  createProtagonistChecker,
  createDurationChecker,
  createThresholdChecker,
  createLintPassChecker,
} = require("@chainlesschain/session-core");
```

### 4.3 消费方

| 消费方 | 用法 |
|--------|------|
| Video Editing CLI | `--review` flag 注册 protagonist + duration checker |
| DebateReview (Desktop) | `resolveConflictingVerdicts` 用 `detectConflictPairs` + `pickWinnersAndLosers` 做质量排序 |
| Workflow Pipeline (Desktop) | 可选迁移到 QualityGate（当前使用独立 quality-gate-manager） |

---

## 5. 验收

- [x] `validateChecker` 拒绝非法 checker（缺 name/fn、负 weight）
- [x] `aggregateScore` 三种策略正确（weighted-mean / min / all-pass）
- [x] `aggregateScore` 跳过 SKIP 状态条目
- [x] `QualityGate.check` 处理 checker 抛错（graceful degradation）
- [x] `QualityGate.check` 支持 `only` 和 `tags` 过滤
- [x] `onCheck` 遥测回调触发
- [x] score 自动 clamp 到 [0, 1]
- [x] 4 个内置 checker 工厂覆盖 video + code 场景
- [x] 39 个测试全部通过

---

## 6. 与现有方案的关系

- **93 号 CutClaw**: QualityGate 是 CutClaw Path B-2 的通用化产物。video-editing skill 是第一个消费方，但 checker 注册表可被任何 skill 使用。
- **91 号 Managed Agents**: ApprovalGate 做策略级门控，QualityGate 做内容级门控。两者可串联：先 ApprovalGate 决定执行权限，执行后 QualityGate 评估结果质量。
- **Desktop Workflow**: 现有 `quality-gate-manager.js` 是 workflow 专用的硬编码版本。未来可选迁移到 session-core QualityGate，共用 checker 注册表。
