# contract-templates

**Source**: `src/main/trade/contract-templates.js`

**Generated**: 2026-02-15T08:42:37.174Z

---

## const

```javascript
const
```

* 智能合约模板系统
 *
 * 提供标准化的合约模板，简化合约创建流程

---

## class ContractTemplates

```javascript
class ContractTemplates
```

* 合约模板类

---

## static simpleTrade(

```javascript
static simpleTrade(
```

* 简单买卖合约模板
   * @param {Object} params - 参数

---

## static subscription(

```javascript
static subscription(
```

* 订阅付费合约模板
   * @param {Object} params - 参数

---

## static bounty(

```javascript
static bounty(
```

* 任务悬赏合约模板
   * @param {Object} params - 参数

---

## static skillExchange(

```javascript
static skillExchange(
```

* 技能交换合约模板
   * @param {Object} params - 参数

---

## static multisigEscrow(

```javascript
static multisigEscrow(
```

* 多重签名托管合约模板
   * @param {Object} params - 参数

---

## static timelockEscrow(

```javascript
static timelockEscrow(
```

* 时间锁托管合约模板
   * @param {Object} params - 参数

---

## static getAllTemplates()

```javascript
static getAllTemplates()
```

* 获取所有模板列表

---

## static createFromTemplate(templateId, params)

```javascript
static createFromTemplate(templateId, params)
```

* 根据模板 ID 创建合约
   * @param {string} templateId - 模板 ID
   * @param {Object} params - 参数

---

## static validateParams(templateId, params)

```javascript
static validateParams(templateId, params)
```

* 验证模板参数
   * @param {string} templateId - 模板 ID
   * @param {Object} params - 参数

---

