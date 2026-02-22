# org-p2p-network

**Source**: `src/main/organization/org-p2p-network.js`

**Generated**: 2026-02-22T01:23:36.703Z

---

## const

```javascript
const
```

* 组织P2P网络管理器
 *
 * 功能：
 * - Topic订阅机制
 * - 组织成员自动发现
 * - 组织内消息广播
 * - 成员在线状态同步
 * - 去中心化组织协作

---

## const MessageType =

```javascript
const MessageType =
```

* 消息类型枚举

---

## class OrgP2PNetwork extends EventEmitter

```javascript
class OrgP2PNetwork extends EventEmitter
```

* 组织P2P网络管理器类

---

## async initialize(orgId)

```javascript
async initialize(orgId)
```

* 初始化组织P2P网络
   * @param {string} orgId - 组织ID
   * @returns {Promise<void>}

---

## async subscribeTopic(orgId, topic)

```javascript
async subscribeTopic(orgId, topic)
```

* 订阅组织Topic
   * @param {string} orgId - 组织ID
   * @param {string} topic - Topic名称
   * @returns {Promise<void>}

---

## async unsubscribeTopic(orgId)

```javascript
async unsubscribeTopic(orgId)
```

* 取消订阅组织Topic
   * @param {string} orgId - 组织ID
   * @returns {Promise<void>}

---

## registerMessageHandlers(orgId)

```javascript
registerMessageHandlers(orgId)
```

* 注册消息处理器
   * @param {string} orgId - 组织ID

---

## async handleTopicMessage(orgId, message)

```javascript
async handleTopicMessage(orgId, message)
```

* 处理Topic消息
   * @param {string} orgId - 组织ID
   * @param {Object} message - 消息对象

---

## async broadcastMessage(orgId, message)

```javascript
async broadcastMessage(orgId, message)
```

* 广播消息到组织
   * @param {string} orgId - 组织ID
   * @param {Object} message - 消息内容
   * @returns {Promise<void>}

---

## async broadcastDirect(orgId, message)

```javascript
async broadcastDirect(orgId, message)
```

* 直接消息广播（PubSub不可用时的后备方案）
   * @param {string} orgId - 组织ID
   * @param {Object} message - 消息内容
   * @returns {Promise<void>}

---

## startHeartbeat(orgId)

```javascript
startHeartbeat(orgId)
```

* 启动心跳
   * @param {string} orgId - 组织ID

---

## stopHeartbeat(orgId)

```javascript
stopHeartbeat(orgId)
```

* 停止心跳
   * @param {string} orgId - 组织ID

---

## async sendHeartbeat(orgId)

```javascript
async sendHeartbeat(orgId)
```

* 发送心跳
   * @param {string} orgId - 组织ID
   * @returns {Promise<void>}

---

## startDiscovery(orgId)

```javascript
startDiscovery(orgId)
```

* 启动成员发现
   * @param {string} orgId - 组织ID

---

## stopDiscovery(orgId)

```javascript
stopDiscovery(orgId)
```

* 停止成员发现
   * @param {string} orgId - 组织ID

---

## async requestDiscovery(orgId)

```javascript
async requestDiscovery(orgId)
```

* 请求成员发现
   * @param {string} orgId - 组织ID
   * @returns {Promise<void>}

---

## async broadcastMemberOnline(orgId)

```javascript
async broadcastMemberOnline(orgId)
```

* 广播成员上线
   * @param {string} orgId - 组织ID
   * @returns {Promise<void>}

---

## async broadcastMemberOffline(orgId)

```javascript
async broadcastMemberOffline(orgId)
```

* 广播成员下线
   * @param {string} orgId - 组织ID
   * @returns {Promise<void>}

---

## async handleMemberOnline(orgId, data)

```javascript
async handleMemberOnline(orgId, data)
```

* 处理成员上线
   * @param {string} orgId - 组织ID
   * @param {Object} data - 消息数据

---

## async handleMemberOffline(orgId, data)

```javascript
async handleMemberOffline(orgId, data)
```

* 处理成员下线
   * @param {string} orgId - 组织ID
   * @param {Object} data - 消息数据

---

## async handleHeartbeat(orgId, data)

```javascript
async handleHeartbeat(orgId, data)
```

* 处理心跳
   * @param {string} orgId - 组织ID
   * @param {Object} data - 消息数据

---

## async handleDiscoveryRequest(orgId, data)

```javascript
async handleDiscoveryRequest(orgId, data)
```

* 处理发现请求
   * @param {string} orgId - 组织ID
   * @param {Object} data - 消息数据

---

## async handleDiscoveryResponse(orgId, data)

```javascript
async handleDiscoveryResponse(orgId, data)
```

* 处理发现响应
   * @param {string} orgId - 组织ID
   * @param {Object} data - 消息数据

---

## async handleMemberEvent(orgId, data)

```javascript
async handleMemberEvent(orgId, data)
```

* 处理成员事件
   * @param {string} orgId - 组织ID
   * @param {Object} data - 消息数据

---

## async handleKnowledgeEvent(orgId, data)

```javascript
async handleKnowledgeEvent(orgId, data)
```

* 处理知识库事件
   * @param {string} orgId - 组织ID
   * @param {Object} data - 消息数据

---

## async handleBroadcastMessage(orgId, data)

```javascript
async handleBroadcastMessage(orgId, data)
```

* 处理广播消息
   * @param {string} orgId - 组织ID
   * @param {Object} data - 消息数据

---

## addOnlineMember(orgId, memberDID)

```javascript
addOnlineMember(orgId, memberDID)
```

* 添加在线成员
   * @param {string} orgId - 组织ID
   * @param {string} memberDID - 成员DID

---

## removeOnlineMember(orgId, memberDID)

```javascript
removeOnlineMember(orgId, memberDID)
```

* 移除在线成员
   * @param {string} orgId - 组织ID
   * @param {string} memberDID - 成员DID

---

## getOnlineMembers(orgId)

```javascript
getOnlineMembers(orgId)
```

* 获取在线成员列表
   * @param {string} orgId - 组织ID
   * @returns {Array<string>} 在线成员DID列表

---

## getOnlineMemberCount(orgId)

```javascript
getOnlineMemberCount(orgId)
```

* 获取在线成员数量
   * @param {string} orgId - 组织ID
   * @returns {number} 在线成员数量

---

## isMemberOnline(orgId, memberDID)

```javascript
isMemberOnline(orgId, memberDID)
```

* 检查成员是否在线
   * @param {string} orgId - 组织ID
   * @param {string} memberDID - 成员DID
   * @returns {boolean} 是否在线

---

## getOrgTopic(orgId)

```javascript
getOrgTopic(orgId)
```

* 获取组织Topic名称
   * @param {string} orgId - 组织ID
   * @returns {string} Topic名称

---

## getNetworkStats(orgId)

```javascript
getNetworkStats(orgId)
```

* 获取网络统计信息
   * @param {string} orgId - 组织ID
   * @returns {Object} 统计信息

---

## async cleanup()

```javascript
async cleanup()
```

* 清理资源

---

