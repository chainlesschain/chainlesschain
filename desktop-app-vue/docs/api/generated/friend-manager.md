# friend-manager

**Source**: `src/main/social/friend-manager.js`

**Generated**: 2026-02-15T08:42:37.184Z

---

## const

```javascript
const
```

* 好友管理器
 *
 * 负责好友关系的管理，包括：
 * - 好友请求发送与接收
 * - 好友列表管理
 * - 好友状态同步
 * - 好友分组和备注

---

## const FriendshipStatus =

```javascript
const FriendshipStatus =
```

* 好友关系状态

---

## const FriendRequestStatus =

```javascript
const FriendRequestStatus =
```

* 好友请求状态

---

## const FriendOnlineStatus =

```javascript
const FriendOnlineStatus =
```

* 好友在线状态

---

## class FriendManager extends EventEmitter

```javascript
class FriendManager extends EventEmitter
```

* 好友管理器类

---

## async initialize()

```javascript
async initialize()
```

* 初始化好友管理器

---

## async initializeTables()

```javascript
async initializeTables()
```

* 初始化数据库表

---

## async loadFriendStatus()

```javascript
async loadFriendStatus()
```

* 加载好友在线状态

---

## setupP2PListeners()

```javascript
setupP2PListeners()
```

* 设置 P2P 监听器

---

## async handlePeerConnected(peerId)

```javascript
async handlePeerConnected(peerId)
```

* 处理节点连接事件

---

## async handlePeerDisconnected(peerId)

```javascript
async handlePeerDisconnected(peerId)
```

* 处理节点断开事件

---

## async sendFriendRequest(targetDid, message = "")

```javascript
async sendFriendRequest(targetDid, message = "")
```

* 发送好友请求
   * @param {string} targetDid - 目标用户 DID
   * @param {string} message - 请求消息

---

## async handleFriendRequestReceived(fromDid, message, timestamp)

```javascript
async handleFriendRequestReceived(fromDid, message, timestamp)
```

* 处理收到的好友请求
   * @param {string} fromDid - 发送者 DID
   * @param {string} message - 请求消息
   * @param {number} timestamp - 时间戳

---

## async acceptFriendRequest(requestId)

```javascript
async acceptFriendRequest(requestId)
```

* 接受好友请求
   * @param {number} requestId - 请求 ID

---

## async rejectFriendRequest(requestId)

```javascript
async rejectFriendRequest(requestId)
```

* 拒绝好友请求
   * @param {number} requestId - 请求 ID

---

## async getFriendRequest(fromDid, toDid)

```javascript
async getFriendRequest(fromDid, toDid)
```

* 获取好友请求
   * @param {string} fromDid - 发送者 DID
   * @param {string} toDid - 接收者 DID

---

## async getPendingFriendRequests()

```javascript
async getPendingFriendRequests()
```

* 获取所有待处理的好友请求

---

## async getFriends(groupName = null)

```javascript
async getFriends(groupName = null)
```

* 获取好友列表
   * @param {string} groupName - 分组名称 (可选)

---

## async removeFriend(friendDid)

```javascript
async removeFriend(friendDid)
```

* 删除好友
   * @param {string} friendDid - 好友 DID

---

## async updateFriendNickname(friendDid, nickname)

```javascript
async updateFriendNickname(friendDid, nickname)
```

* 更新好友备注
   * @param {string} friendDid - 好友 DID
   * @param {string} nickname - 备注名

---

## async updateFriendGroup(friendDid, groupName)

```javascript
async updateFriendGroup(friendDid, groupName)
```

* 更新好友分组
   * @param {string} friendDid - 好友 DID
   * @param {string} groupName - 分组名称

---

## async updateFriendStatus(friendDid, status, deviceCount = 1)

```javascript
async updateFriendStatus(friendDid, status, deviceCount = 1)
```

* 更新好友在线状态
   * @param {string} friendDid - 好友 DID
   * @param {string} status - 在线状态
   * @param {number} deviceCount - 设备数量

---

## async isFriend(did)

```javascript
async isFriend(did)
```

* 检查是否是好友
   * @param {string} did - DID

---

## async getStatistics()

```javascript
async getStatistics()
```

* 获取好友统计

---

## async close()

```javascript
async close()
```

* 关闭好友管理器

---

