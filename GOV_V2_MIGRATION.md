# Governance V2 样板迁移指南

> 更新时间：2026-04-22
> 状态：`governance-v2-helpers.js` 已落地，生产 `lib` 仍未开始接入
> 范围：`packages/cli/src/lib/*.js` 中 iter16–iter28 的 Governance V2 overlay

---

## 快照

截至 2026-04-22，仓库现状如下：

- `packages/cli/package.json` 是 `"type": "module"`，Governance V2 helper 必须按 ESM 方式导入。
- `packages/cli/src/lib/governance-v2-helpers.js` 已提供 5 个可复用 helper。
- `rg -n "export function _resetState.*GovV2\\(" packages/cli/src/lib` 当前可定位到 **88** 个 Gov-V2 reset 入口。
- `rg -l "function _\\w+Pos\\(|function _\\w+CheckP\\(|function _\\w+CheckJ\\(" packages/cli/src/lib` 当前可定位到 **149** 个仍含私有样板 helper 的 `lib` 文件。
- 当前没有生产 `lib` 实际导入 `governance-v2-helpers.js`；它现在只被自己的单测引用。

这意味着迁移指南必须覆盖“从 0 开始接入”的全过程，而不是只描述 helper 的设计意图。

## 目标

治理样板在大量 CLI surface 上重复实现了同一套结构：

- 两个 `Map`：profile 集合 + job/session/proposal 集合
- 四个 cap：`maxActive`、`maxPending`、`idleMs`、`stuckMs`
- 一个正整数校验器：`_xxxPos`
- 两个状态机检查器：`_checkP` / `_checkJ`
- 两个计数器：`_countActive` / `_countPending`
- 一个 `_resetStateXxxGovV2()`
- 一组 `getXxxV2()` / `setXxxV2()` 导出

跨文件差异主要只有三类：

- 前缀命名不同
- 默认 cap 不同
- 领域词不同：profile / decision / run / share / delivery / proposal

迁移的目标不是改语义，而是把重复的“框架代码”收敛到 helper，同时保持对外 API、错误信息、状态流转和测试行为不变。

## 适用范围

优先迁移满足以下条件的文件：

1. 文件里存在两个独立 `Map`，分别表示 profile 和 job/session/proposal。
2. 文件里存在四个数值 cap，且默认值是 module-level 常量或字面量。
3. 文件里存在 `_xxxPos`、`_xxxCheckP`、`_xxxCheckJ` 这类只服务于 V2 overlay 的私有 helper。
4. `_resetState...GovV2()` 只做两件事：清空状态 + 恢复默认 cap。
5. 业务逻辑只是消费这些 helper，不依赖更复杂的动态配置加载。
6. 状态机仍属于常见的 4-state profile + 5-state action 结构。

最适合作为第一批试点的文件：

- `packages/cli/src/lib/downloader.js`
- `packages/cli/src/lib/skill-mcp.js`
- `packages/cli/src/lib/stix-parser.js`
- `packages/cli/src/lib/process-manager.js`
- `packages/cli/src/lib/ws-chat-handler.js`
- `packages/cli/src/lib/sub-agent-profiles.js`
- `packages/cli/src/lib/cowork-observe.js`
- `packages/cli/src/lib/cowork-mcp-tools.js`

这批文件体量较小，Gov-V2 overlay 相对独立，适合验证迁移套路。

## 不适用范围

以下情况不要强行套用 helper：

- 只有一个 `Map`，没有 profile/job 双存储语义。
- cap 默认值来自运行时配置或环境，而不是静态默认值。
- 状态机明显偏离 4-state / 5-state 惯例，或者状态转移包含条件副作用。
- setter/getter 带有额外业务逻辑，而不只是设置和读取数值。
- `_resetState...V2()` 除了清空状态和恢复默认值外，还会级联清理别的缓存或外部资源。

这类文件可以只做局部收敛，或者保持现状。

## Helper 对照表

| 旧样板 | 新 helper |
|---|---|
| `_xxxPos(n, label)` | `positiveInteger(n, label)` |
| `_xxxCheckP(from, to)` | `createTransitionChecker(profileTransitions, label)` |
| `_xxxCheckJ(from, to)` | `createTransitionChecker(jobTransitions, label)` |
| `_countActive(...)` / `_countPending(...)` | `countBy(map, predicate)` |
| `new Map([...new Set(...)])` 状态声明 | `buildTransitionMap({...})` |
| 4 组 cap getter/setter | `createCapRegistry(defaults)` |

`positiveInteger()` 很少需要直接暴露。大多数文件只要用 `createCapRegistry()` 即可。

## 迁移原则

### 1. 公开导出名不能变

命令层和测试层直接引用这些名字，迁移后必须保持完全一致，例如：

- `setMaxActiveCogovProfilesPerOwnerV2`
- `getCogovDecisionStuckMsV2`
- `_resetStateCollaborationGovernanceGovV2`

不要因为 helper 里字段名不同就顺手“顺一遍命名”。

### 2. 错误文本尽量保持不变

`createTransitionChecker()` 的第二个参数直接进入错误信息。迁移时要保留旧领域名，例如：

- `cogov profile`
- `cogov decision`
- `daomgov proposal`

否则单测和 CLI 输出会漂移。

### 3. cap 字段名优先服务于旧校验 label

`createCapRegistry()` 里的 key 同时决定：

- 内部 `caps` 的字段名
- 自动生成的 getter/setter 名字
- `positiveInteger()` 报错时的 label

如果旧代码的“公开导出名”和“校验 label”不完全一致，不要直接别名导出，要包一层函数。

### 4. `_resetState...GovV2()` 必须语义等价

该函数是测试入口，不只是工具函数。它必须：

- 清空相关 `Map`
- 恢复四个默认 cap
- 不额外引入副作用

## 推荐写法

`packages/cli` 是 ESM 包，迁移后的导入应使用 `.js` 后缀：

```js
import {
  createTransitionChecker,
  createCapRegistry,
  countBy,
  buildTransitionMap,
} from "./governance-v2-helpers.js";
```

### 直接别名导出

适用于 helper 字段名和历史 API 名称完全一致的情况：

```js
const _cogovCaps = createCapRegistry({
  maxActiveCogovProfilesPerOwner: 8,
  maxPendingCogovDecisionsPerProfile: 20,
  cogovProfileIdleMs: 30 * 24 * 60 * 60 * 1000,
  cogovDecisionStuckMs: 60 * 1000,
});

export const setMaxActiveCogovProfilesPerOwnerV2 =
  _cogovCaps.setters.maxActiveCogovProfilesPerOwner;
export const getMaxActiveCogovProfilesPerOwnerV2 =
  _cogovCaps.getters.maxActiveCogovProfilesPerOwner;
```

### 包装导出

适用于旧函数名和 helper 字段名不完全一致，或者旧 setter 需要保留返回值的情况：

```js
const _daomgovCaps = createCapRegistry({
  daomgovProfileIdleMs: 30 * 24 * 60 * 60 * 1000,
});

export function setDaomProfileIdleMsV2(n) {
  _daomgovCaps.setters.daomgovProfileIdleMs(n);
  return _daomgovCaps.getters.daomgovProfileIdleMs();
}

export function getDaomProfileIdleMsV2() {
  return _daomgovCaps.getters.daomgovProfileIdleMs();
}
```

如果旧 setter 原本不返回值，也可以省略 `return`，但不要在未核对旧行为时直接把 helper setter 裸导出。

## 单文件迁移步骤

1. 先锁定目标文件中的 Gov-V2 区块，不要顺手改非 V2 逻辑。
2. 删除 `_xxxPos`、`_xxxCheckP`、`_xxxCheckJ`、`_countActive`、`_countPending` 的重复实现。
3. 保留两个 `Map` 状态存储；helper 不负责管理业务实体，只负责公共样板。
4. 用 `buildTransitionMap()` 重写 profile/action 两张状态图。
5. 用 `createTransitionChecker()` 生成两个 transition checker。
6. 用 `createCapRegistry()` 收敛四个 cap。
7. 用 `countBy()` 重写 active/pending 统计。
8. 重写 `_resetState...GovV2()`，只保留 `clear()` 和 `resetCaps()`。
9. 逐个核对公开导出名、setter 返回值、stats 字段名是否保持不变。

## 安全模板

下面是更接近真实迁移的模板，不只替换了 cap，还覆盖了状态机和计数逻辑：

```js
import {
  createTransitionChecker,
  createCapRegistry,
  countBy,
  buildTransitionMap,
} from "./governance-v2-helpers.js";

const _shgovPsV2 = new Map();
const _shgovJsV2 = new Map();

const _shgovPTrans = buildTransitionMap({
  pending: ["active", "archived"],
  active: ["paused", "archived"],
  paused: ["active", "archived"],
  archived: [],
});

const _shgovJTrans = buildTransitionMap({
  queued: ["sharing", "cancelled"],
  sharing: ["delivered", "failed", "cancelled"],
  delivered: [],
  failed: [],
  cancelled: [],
});

const _shgovCheckP = createTransitionChecker(_shgovPTrans, "shgov profile");
const _shgovCheckJ = createTransitionChecker(_shgovJTrans, "shgov share");

const _shgovCaps = createCapRegistry({
  maxActiveShgovProfilesPerOwner: 8,
  maxPendingShgovSharesPerProfile: 20,
  shgovProfileIdleMs: 30 * 24 * 60 * 60 * 1000,
  shgovShareStuckMs: 60 * 1000,
});

export const setMaxActiveShgovProfilesPerOwnerV2 =
  _shgovCaps.setters.maxActiveShgovProfilesPerOwner;
export const getMaxActiveShgovProfilesPerOwnerV2 =
  _shgovCaps.getters.maxActiveShgovProfilesPerOwner;

const _shgovCountActive = (owner) =>
  countBy(
    _shgovPsV2,
    (p) => p.owner === owner && p.status === SHGOV_PROFILE_MATURITY_V2.ACTIVE,
  );

const _shgovCountPending = (profileId) =>
  countBy(
    _shgovJsV2,
    (j) =>
      j.profileId === profileId &&
      (j.status === SHGOV_SHARE_LIFECYCLE_V2.QUEUED ||
        j.status === SHGOV_SHARE_LIFECYCLE_V2.SHARING),
  );

export function _resetStateCoworkShareGovV2() {
  _shgovPsV2.clear();
  _shgovJsV2.clear();
  _shgovCaps.resetCaps();
}
```

## 迁移前后必须核对的点

### 导出面

- 公开函数名不变
- stats 函数名不变
- reset 函数名不变
- weird historical names 也不纠正，例如 `pausedDaomProfileV2()` 这类既有 API

### 运行时行为

- activate/recover 时的 cap 判断逻辑不变
- terminal 状态的 `touch` 拒绝逻辑不变
- `autoSuspend` / `autoPause` / `autoFailStuck` 这类定时钩子不变
- `metadata.failReason` / `metadata.cancelReason` 这类副作用字段不变

### 错误与返回值

- transition error 文案不变
- 正整数校验文案不变
- setter 是否返回值不变
- getter 返回的字段名不变

## 定位与检查命令

### 定位候选文件

```powershell
rg -l "export function _resetState.*GovV2\\(" packages/cli/src/lib
```

### 定位仍未迁移的私有样板 helper

```powershell
rg -n "function _\\w+Pos\\(|function _\\w+CheckP\\(|function _\\w+CheckJ\\(" packages/cli/src/lib
```

### 检查某个文件是否仍残留旧样板

```powershell
rg -n "_cogovPos\\(|_cogovCheckP\\(|_cogovCheckJ\\(" packages/cli/src/lib/collaboration-governance.js
```

### 检查 helper 接入情况

```powershell
rg -n "governance-v2-helpers\\.js" packages/cli/src/lib packages/cli/__tests__
```

## 测试要求

每迁移一个文件，至少跑两类测试：

1. `packages/cli/__tests__/unit/lib/*-v2*.test.js`
2. 如果存在，同名的大单测：`packages/cli/__tests__/unit/<module>.test.js`

示例：

```powershell
cd packages/cli
npm run test -- __tests__/unit/lib/collaboration-governance-v2.test.js
npm run test -- __tests__/unit/collaboration-governance.test.js
```

如果只跑第一类测试，很容易漏掉对命令层导出名或 reset 行为的回归。

## 批量推进建议

推荐按以下节奏推进：

### P0：小文件试点

先迁 5 到 8 个小文件，验证：

- helper 足够覆盖当前套路
- 不需要额外抽象
- 错误文本和测试兼容

### P1：按迭代倒序推进

建议按照 iter28 → iter16 倒序，每个 iter 单独一个 PR。这样做的好处：

- 新文件上下文更近，更容易批量替换
- 回滚边界清晰
- review 时更容易对比“迁移前后只改样板、不改业务”

### P2：补回归约束

当第一批迁移稳定后，再补自动化约束：

- lint 规则或 grep 审核脚本
- 拒绝新增 `_xxxPos` / `_xxxCheckP` / `_xxxCheckJ`
- 检查新增 Gov-V2 surface 是否直接复用 helper

## Definition Of Done

一个文件完成迁移，至少满足以下条件：

1. Gov-V2 overlay 仍然通过原有单测。
2. 公开导出名、stats 字段名、reset 名称完全不变。
3. 文件内不再出现对应前缀的 `_xxxPos` / `_xxxCheckP` / `_xxxCheckJ`。
4. `_resetState...GovV2()` 只负责清空状态和恢复默认 cap。
5. 没有顺手改业务语义、默认值、状态机、错误消息。

---

`governance-v2-helpers.js` 现在应被视为唯一新增入口；后续所有 Gov-V2 样板新增或重构，默认都应先考虑复用它，而不是继续复制一份 `_xxxPos + _checkP + _checkJ + 4 caps + reset` 套路。
