# call-history-manager

**Source**: `src/main/p2p/call-history-manager.js`

**Generated**: 2026-02-21T22:45:05.275Z

---

## const

```javascript
const
```

* Call History Manager
 *
 * 管理通话历史记录

---

## async initialize()

```javascript
async initialize()
```

* 初始化

---

## async recordCallStart(callData)

```javascript
async recordCallStart(callData)
```

* 记录通话开始

---

## async updateCallStatus(callId, status, additionalData =

```javascript
async updateCallStatus(callId, status, additionalData =
```

* 更新通话状态

---

## async recordCallEnd(callId, endData =

```javascript
async recordCallEnd(callId, endData =
```

* 记录通话结束

---

## async getCallHistory(options =

```javascript
async getCallHistory(options =
```

* 获取通话历史

---

## async getCallDetails(callId)

```javascript
async getCallDetails(callId)
```

* 获取通话详情

---

## async getCallStatistics(peerId = null)

```javascript
async getCallStatistics(peerId = null)
```

* 获取通话统计

---

## async deleteCallHistory(callId)

```javascript
async deleteCallHistory(callId)
```

* 删除通话记录

---

## async clearCallHistory(peerId = null)

```javascript
async clearCallHistory(peerId = null)
```

* 清空通话历史

---

## cleanup()

```javascript
cleanup()
```

* 清理资源

---

