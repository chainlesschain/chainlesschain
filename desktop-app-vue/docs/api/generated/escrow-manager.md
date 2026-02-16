# escrow-manager

**Source**: `src/main/trade/escrow-manager.js`

**Generated**: 2026-02-16T22:06:51.415Z

---

## const

```javascript
const
```

* 托管管理器
 *
 * 负责交易托管的管理，包括：
 * - 创建托管
 * - 锁定资金
 * - 释放资金
 * - 退款处理
 * - 争议处理

---

## const EscrowStatus =

```javascript
const EscrowStatus =
```

* 托管状态

---

## class EscrowManager extends EventEmitter

```javascript
class EscrowManager extends EventEmitter
```

* 托管管理器类

---

## async initialize()

```javascript
async initialize()
```

* 初始化托管管理器

---

## async initializeTables()

```javascript
async initializeTables()
```

* 初始化数据库表

---

## async createEscrow(

```javascript
async createEscrow(
```

* 创建托管
   * @param {Object} options - 托管选项

---

## async lockEscrow(escrowId)

```javascript
async lockEscrow(escrowId)
```

* 锁定托管资金
   * @param {string} escrowId - 托管 ID

---

## async releaseEscrow(escrowId, recipientDid)

```javascript
async releaseEscrow(escrowId, recipientDid)
```

* 释放托管资金给卖家
   * @param {string} escrowId - 托管 ID
   * @param {string} recipientDid - 接收者 DID（通常是卖家）

---

## async refundEscrow(escrowId, reason = "")

```javascript
async refundEscrow(escrowId, reason = "")
```

* 退款给买家
   * @param {string} escrowId - 托管 ID
   * @param {string} reason - 退款原因

---

## async disputeEscrow(escrowId, reason)

```javascript
async disputeEscrow(escrowId, reason)
```

* 标记托管为争议状态
   * @param {string} escrowId - 托管 ID
   * @param {string} reason - 争议原因

---

## async cancelEscrow(escrowId)

```javascript
async cancelEscrow(escrowId)
```

* 取消托管（仅在 CREATED 状态）
   * @param {string} escrowId - 托管 ID

---

## async getEscrow(escrowId)

```javascript
async getEscrow(escrowId)
```

* 获取托管详情
   * @param {string} escrowId - 托管 ID

---

## async getEscrows(filters =

```javascript
async getEscrows(filters =
```

* 获取托管列表
   * @param {Object} filters - 筛选条件

---

## async getEscrowHistory(escrowId)

```javascript
async getEscrowHistory(escrowId)
```

* 获取托管历史
   * @param {string} escrowId - 托管 ID

---

## recordHistory(escrowId, fromStatus, toStatus, operatedBy, reason)

```javascript
recordHistory(escrowId, fromStatus, toStatus, operatedBy, reason)
```

* 记录托管历史
   * @param {string} escrowId - 托管 ID
   * @param {string} fromStatus - 原状态
   * @param {string} toStatus - 新状态
   * @param {string} operatedBy - 操作者 DID
   * @param {string} reason - 原因

---

## async getStatistics()

```javascript
async getStatistics()
```

* 获取统计信息

---

## async close()

```javascript
async close()
```

* 关闭托管管理器

---

