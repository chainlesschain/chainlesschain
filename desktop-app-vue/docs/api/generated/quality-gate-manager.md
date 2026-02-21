# quality-gate-manager

**Source**: `src/main/workflow/quality-gate-manager.js`

**Generated**: 2026-02-21T20:04:16.184Z

---

## const

```javascript
const
```

* 质量门禁管理器
 *
 * 管理工作流各阶段的质量检查
 *
 * 质量门禁检查项:
 * - 完整性检查 (completeness)
 * - 一致性验证 (consistency)
 * - LLM质量评估 (llm_quality)
 * - 格式验证 (format)
 * - 依赖验证 (dependency)
 *
 * v0.27.0: 新建文件

---

## const GateStatus =

```javascript
const GateStatus =
```

* 质量门禁状态枚举

---

## const DEFAULT_QUALITY_GATES =

```javascript
const DEFAULT_QUALITY_GATES =
```

* 预定义质量门禁配置

---

## const CHECK_EXECUTORS =

```javascript
const CHECK_EXECUTORS =
```

* 检查项执行器映射

---

## class QualityGateManager extends EventEmitter

```javascript
class QualityGateManager extends EventEmitter
```

* 质量门禁管理器类

---

## _initializeDefaultGates()

```javascript
_initializeDefaultGates()
```

* 初始化默认门禁
   * @private

---

## registerGate(gate)

```javascript
registerGate(gate)
```

* 注册质量门禁
   * @param {Object} gate - 门禁配置

---

## getGate(gateId)

```javascript
getGate(gateId)
```

* 获取门禁配置
   * @param {string} gateId - 门禁ID
   * @returns {Object|null} 门禁配置

---

## getGateByStage(stageId)

```javascript
getGateByStage(stageId)
```

* 获取阶段对应的门禁
   * @param {string} stageId - 阶段ID
   * @returns {Object|null} 门禁配置

---

## async check(gateIdOrStageId, result, context =

```javascript
async check(gateIdOrStageId, result, context =
```

* 执行质量门禁检查
   * @param {string} gateIdOrStageId - 门禁ID或阶段ID
   * @param {Object} result - 阶段执行结果
   * @param {Object} context - 上下文信息
   * @returns {Object} 检查结果

---

## override(gateId, reason = '手动跳过')

```javascript
override(gateId, reason = '手动跳过')
```

* 手动覆盖门禁（跳过）
   * @param {string} gateId - 门禁ID
   * @param {string} reason - 跳过原因
   * @returns {boolean} 是否成功

---

## getAllStatuses()

```javascript
getAllStatuses()
```

* 获取所有门禁状态
   * @returns {Object} 门禁状态映射

---

## getCheckResult(gateId)

```javascript
getCheckResult(gateId)
```

* 获取门禁检查结果
   * @param {string} gateId - 门禁ID
   * @returns {Object|null} 检查结果

---

## reset()

```javascript
reset()
```

* 重置所有门禁状态

---

## resetGate(gateId)

```javascript
resetGate(gateId)
```

* 重置单个门禁状态
   * @param {string} gateId - 门禁ID

---

