# contract-engine

**Source**: `src/main/trade/contract-engine.js`

**Generated**: 2026-02-21T22:04:25.769Z

---

## const

```javascript
const
```

* 智能合约引擎
 *
 * 负责智能合约的管理和执行，包括：
 * - 创建和管理合约
 * - 多种托管类型（简单、多重签名、时间锁、条件）
 * - 自动条件检查和执行
 * - 仲裁机制
 * - 合约模板系统

---

## const ContractType =

```javascript
const ContractType =
```

* 合约类型

---

## const EscrowType =

```javascript
const EscrowType =
```

* 托管类型

---

## const ContractStatus =

```javascript
const ContractStatus =
```

* 合约状态

---

## const ConditionType =

```javascript
const ConditionType =
```

* 条件类型

---

## class SmartContractEngine extends EventEmitter

```javascript
class SmartContractEngine extends EventEmitter
```

* 智能合约引擎类

---

## async initialize()

```javascript
async initialize()
```

* 初始化合约引擎

---

## async initializeTables()

```javascript
async initializeTables()
```

* 初始化数据库表

---

## async createContract(

```javascript
async createContract(
```

* 创建合约
   * @param {Object} options - 合约选项

---

## async activateContract(contractId)

```javascript
async activateContract(contractId)
```

* 激活合约
   * @param {string} contractId - 合约 ID

---

## async signContract(contractId, signature)

```javascript
async signContract(contractId, signature)
```

* 签名合约（多重签名）
   * @param {string} contractId - 合约 ID
   * @param {string} signature - 签名

---

## async checkConditions(contractId)

```javascript
async checkConditions(contractId)
```

* 检查合约条件
   * @param {string} contractId - 合约 ID

---

## async evaluateCondition(contractId, conditionType, conditionData)

```javascript
async evaluateCondition(contractId, conditionType, conditionData)
```

* 评估单个条件
   * @param {string} contractId - 合约 ID
   * @param {string} conditionType - 条件类型
   * @param {Object} conditionData - 条件数据

---

## async executeContract(contractId)

```javascript
async executeContract(contractId)
```

* 执行合约
   * @param {string} contractId - 合约 ID

---

## async executeContractLogic(contract)

```javascript
async executeContractLogic(contract)
```

* 执行合约具体逻辑
   * @param {Object} contract - 合约对象

---

## async cancelContract(contractId, reason)

```javascript
async cancelContract(contractId, reason)
```

* 取消合约
   * @param {string} contractId - 合约 ID
   * @param {string} reason - 取消原因

---

## async initiateArbitration(contractId, reason, evidence = null)

```javascript
async initiateArbitration(contractId, reason, evidence = null)
```

* 发起仲裁
   * @param {string} contractId - 合约 ID
   * @param {string} reason - 仲裁原因
   * @param {string} evidence - 证据

---

## async resolveArbitration(arbitrationId, resolution)

```javascript
async resolveArbitration(arbitrationId, resolution)
```

* 解决仲裁
   * @param {string} arbitrationId - 仲裁 ID
   * @param {string} resolution - 解决方案

---

## async getContract(contractId)

```javascript
async getContract(contractId)
```

* 获取合约详情
   * @param {string} contractId - 合约 ID

---

## async getContracts(filters =

```javascript
async getContracts(filters =
```

* 获取合约列表
   * @param {Object} filters - 筛选条件

---

## async getContractConditions(contractId)

```javascript
async getContractConditions(contractId)
```

* 获取合约条件
   * @param {string} contractId - 合约 ID

---

## async getContractEvents(contractId)

```javascript
async getContractEvents(contractId)
```

* 获取合约事件
   * @param {string} contractId - 合约 ID

---

## recordEvent(contractId, eventType, eventData = null, actorDid = null)

```javascript
recordEvent(contractId, eventType, eventData = null, actorDid = null)
```

* 记录合约事件
   * @param {string} contractId - 合约 ID
   * @param {string} eventType - 事件类型
   * @param {Object} eventData - 事件数据
   * @param {string} actorDid - 操作者 DID

---

## startAutoCheck(interval = 60000)

```javascript
startAutoCheck(interval = 60000)
```

* 启动自动检查
   * @param {number} interval - 检查间隔（毫秒）

---

## async autoCheckAndExecute()

```javascript
async autoCheckAndExecute()
```

* 自动检查并执行合约

---

## stopAutoCheck()

```javascript
stopAutoCheck()
```

* 停止自动检查

---

## async _deployContractToBlockchain(contractId, options)

```javascript
async _deployContractToBlockchain(contractId, options)
```

* 部署合约到区块链（私有方法）
   * @param {string} contractId - 合约 ID
   * @param {Object} options - 部署选项

---

## async _saveDeployedContract(options)

```javascript
async _saveDeployedContract(options)
```

* 保存合约部署记录（私有方法）
   * @param {Object} options - 部署信息

---

## async _getDeployedContract(contractId)

```javascript
async _getDeployedContract(contractId)
```

* 获取合约的区块链部署信息（私有方法）
   * @param {string} contractId - 合约 ID

---

## async close()

```javascript
async close()
```

* 关闭合约引擎

---

