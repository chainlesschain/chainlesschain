# Governance V2 样板迁移指南

> 状态：**helpers 已落地，批量迁移待调度**
> 工具：`packages/cli/src/lib/governance-v2-helpers.js`（10 个单测）
> 目标：消除 86 个 CLI V2 surface 中 ~4,300 行重复的状态机/cap/helper 代码

---

## 背景

iter16–iter28 产出了 86 个 gov-V2 surface（见 `packages/cli/src/lib/*.js` 的 `_resetState...GovV2` 导出）。每个文件独立实现了近乎一致的脚手架：

- 两个 Map（profiles + jobs/sessions）
- 四个数值 cap（`maxActivePerOwner` / `maxPendingPerProfile` / `idleMs` / `stuckMs`）
- 一个正整数校验器 `_xxxPos`
- 4-state / 5-state 状态转换表 + `_checkP` / `_checkJ`
- `_countActive` / `_countPending`
- `_resetStateXxxGovV2`
- 对 4 个 cap 的 get/set 函数对

跨文件差异只在于**命名前缀和默认值**，逻辑完全一致 → 高重复度、高维护成本。

## 现状（已完成）

`packages/cli/src/lib/governance-v2-helpers.js` 抽出以下 5 个纯函数：

```js
positiveInteger(n, label)              // 代替 _xxxPos
createTransitionChecker(map, label)    // 代替 _checkP / _checkJ
createCapRegistry(defaults)            // 代替 4 组 get/set 函数
countBy(map, predicate)                // 代替 _countActive / _countPending
buildTransitionMap(plainObj)           // 提供更可读的 transition 声明
```

配套 `packages/cli/__tests__/unit/governance-v2-helpers.test.js`（10 tests）覆盖边界。

## 迁移单个 lib 文件的步骤

以 `cowork-share.js` 为例（对应 shgov-* 命令）：

### Before（~50 行样板）

```js
const _shgovPsV2 = new Map();
const _shgovJsV2 = new Map();
let _shgovMaxActive = 8,
    _shgovMaxPending = 20,
    _shgovIdleMs = 30 * 24 * 60 * 60 * 1000,
    _shgovStuckMs = 60 * 1000;

function _shgovPos(n, label) { /* 7 行 */ }
function _shgovCheckP(from, to) { /* 5 行 */ }
function _shgovCheckJ(from, to) { /* 5 行 */ }
function _shgovCountActive(owner) { /* 6 行 */ }
function _shgovCountPending(profileId) { /* 8 行 */ }

export function setMaxActiveShgovProfilesPerOwnerV2(n) { _shgovMaxActive = _shgovPos(n, "…"); }
export function getMaxActiveShgovProfilesPerOwnerV2() { return _shgovMaxActive; }
// ×4 cap → 8 个函数

export function _resetStateCoworkShareGovV2() {
  _shgovPsV2.clear();
  _shgovJsV2.clear();
  _shgovMaxActive = 8;
  _shgovMaxPending = 20;
  _shgovIdleMs = 30 * 24 * 60 * 60 * 1000;
  _shgovStuckMs = 60 * 1000;
}
```

### After（~15 行）

```js
const {
  createTransitionChecker,
  createCapRegistry,
  countBy,
  buildTransitionMap,
} = require('./governance-v2-helpers');

const _shgovPsV2 = new Map();
const _shgovJsV2 = new Map();

const _shgovPTrans = buildTransitionMap({
  pending: ['active', 'archived'],
  active: ['paused', 'archived'],
  paused: ['active', 'archived'],
});
const _shgovJTrans = buildTransitionMap({
  queued: ['sharing', 'cancelled'],
  sharing: ['delivered', 'failed', 'cancelled'],
});
const _shgovCheckP = createTransitionChecker(_shgovPTrans, 'shgov profile');
const _shgovCheckJ = createTransitionChecker(_shgovJTrans, 'shgov share');

const _shgovCaps = createCapRegistry({
  maxActiveShgovProfilesPerOwner: 8,
  maxPendingShgovSharesPerProfile: 20,
  shgovProfileIdleMs: 30 * 24 * 60 * 60 * 1000,
  shgovShareStuckMs: 60 * 1000,
});

// 导出 cap accessors —— 名字与历史 API 保持字节级一致
export const setMaxActiveShgovProfilesPerOwnerV2 =
  _shgovCaps.setters.maxActiveShgovProfilesPerOwner;
export const getMaxActiveShgovProfilesPerOwnerV2 =
  _shgovCaps.getters.maxActiveShgovProfilesPerOwner;
// ... ×3

const _shgovCountActive = (owner) =>
  countBy(_shgovPsV2, (p) => p.owner === owner && p.status === SHGOV_PROFILE_MATURITY_V2.ACTIVE);
const _shgovCountPending = (profileId) =>
  countBy(_shgovJsV2, (j) =>
    j.profileId === profileId &&
    (j.status === SHGOV_SHARE_LIFECYCLE_V2.QUEUED ||
     j.status === SHGOV_SHARE_LIFECYCLE_V2.SHARING));

export function _resetStateCoworkShareGovV2() {
  _shgovPsV2.clear();
  _shgovJsV2.clear();
  _shgovCaps.resetCaps();
}
```

## 验收清单（每个 lib 文件）

1. 旧 get/set 函数名 **一个不能改** —— 否则命令层（`commands/cowork.js` 等）直接导入的 binding 会断。用 `export const`/`module.exports` 别名对齐到 helpers。
2. `_resetStateXxxGovV2()` 被下游所有测试用来开场清场 —— 行为必须等价（caps 恢复到编译期默认 + 清空两个 Map）。
3. 两个状态机表（`_xxxPTrans` / `_xxxJTrans`）保留为 module-level const，供域内其它函数复用。
4. **迁移后必须运行 lib 对应的单测** —— e.g. `cowork-share` 对应 `__tests__/unit/cowork-share*.test.js`，零失败才算通过。

## 执行策略建议

86 个 lib × ~15 分钟/文件 ≈ 22 小时纯手工，加回归 > 3 人天。建议：

**P0（立刻可做）**：对 **最新 iter28 中 8 个 fresh lib**（`downloader.js` / `skill-mcp.js` / `cowork-mcp-tools.js` / `stix-parser.js` / `sub-agent-profiles.js` / `cowork-observe.js` / `process-manager.js` / `ws-chat-handler.js`）做 pilot 迁移，验证 helpers 无盲点。

**P1**：按 iter 倒序 28 → 16 推进，每个 iter 一个 PR，便于回滚。

**P2**：迁移完成后可以给 helpers 加 lint 规则 —— 检测 `_xxxPos` / `_checkP` / `_checkJ` 等私有 helper 名字在 lib 文件里不再出现，自动拒绝回退。

## 不迁移的情况

以下场景 helpers 不适用，保留原样即可：

- lib 只有一个 Map（没有双 Map 语义，如 `cowork-adapter.js`）—— 用不到 `countBy` 但可以用 caps
- lib 的 cap 默认值是按配置动态计算的（非 module-level 常量）
- lib 的状态机是 7+ 状态（超出 4-state/5-state 惯例）—— 建议先和团队讨论新惯例再迁移

---

*Helper 已通过 10 个单元测试，可直接使用。批量迁移需单独排期。*
