# social

**Source**: `src\renderer\stores\social.js`

**Generated**: 2026-01-27T06:44:03.890Z

---

## export const useSocialStore = defineStore("social",

```javascript
export const useSocialStore = defineStore("social",
```

* 社交模块统一状态管理
 * 管理好友、聊天、动态、通知等社交功能的状态

---

## totalUnreadCount: (state) => state.unreadCount + state.unreadNotifications,

```javascript
totalUnreadCount: (state) => state.unreadCount + state.unreadNotifications,
```

* 总未读数（消息+通知）

---

## onlineFriends: (state) =>

```javascript
onlineFriends: (state) =>
```

* 在线好友列表

---

## offlineFriends: (state) =>

```javascript
offlineFriends: (state) =>
```

* 离线好友列表

---

## pendingRequestsCount: (state) =>

```javascript
pendingRequestsCount: (state) =>
```

* 待处理的好友请求数

---

## pinnedSessions: (state) =>

```javascript
pinnedSessions: (state) =>
```

* 置顶的聊天会话

---

## unreadSessionsCount: (state) =>

```javascript
unreadSessionsCount: (state) =>
```

* 未读消息会话数

---

## unreadNotificationsList: (state) =>

```javascript
unreadNotificationsList: (state) =>
```

* 未读通知列表

---

## async loadFriends()

```javascript
async loadFriends()
```

* 加载好友列表

---

## async loadFriendRequests()

```javascript
async loadFriendRequests()
```

* 加载好友请求

---

## async sendFriendRequest(friendDid, message)

```javascript
async sendFriendRequest(friendDid, message)
```

* 发送好友请求

---

## async acceptFriendRequest(requestId)

```javascript
async acceptFriendRequest(requestId)
```

* 接受好友请求

---

## async rejectFriendRequest(requestId)

```javascript
async rejectFriendRequest(requestId)
```

* 拒绝好友请求

---

## setFriendOnlineStatus(did, status)

```javascript
setFriendOnlineStatus(did, status)
```

* 设置好友在线状态

---

## async openChatWithFriend(friend)

```javascript
async openChatWithFriend(friend)
```

* 打开与好友的聊天

---

## async loadChatSessions()

```javascript
async loadChatSessions()
```

* 加载聊天会话列表

---

## async loadMessages(sessionId, limit = 50, offset = 0)

```javascript
async loadMessages(sessionId, limit = 50, offset = 0)
```

* 加载聊天消息

---

## async sendMessage(message)

```javascript
async sendMessage(message)
```

* 发送消息

---

## async receiveMessage(message)

```javascript
async receiveMessage(message)
```

* 接收消息（由P2P消息监听器调用）

---

## async markAsRead(sessionId)

```javascript
async markAsRead(sessionId)
```

* 标记会话为已读

---

## async getCurrentUserDid()

```javascript
async getCurrentUserDid()
```

* 获取当前用户DID

---

## async loadPosts(filter = "all")

```javascript
async loadPosts(filter = "all")
```

* 加载动态列表

---

## async createPost(post)

```javascript
async createPost(post)
```

* 创建动态

---

## async likePost(postId)

```javascript
async likePost(postId)
```

* 点赞动态

---

## async unlikePost(postId)

```javascript
async unlikePost(postId)
```

* 取消点赞

---

## async loadNotifications(limit = 50, _retryCount = 0)

```javascript
async loadNotifications(limit = 50, _retryCount = 0)
```

* 加载通知列表
     * @param {number} limit - 加载数量限制
     * @param {number} _retryCount - 内部使用的重试计数（不要手动传递）

---

## addNotification(notification)

```javascript
addNotification(notification)
```

* 添加通知

---

## async markNotificationAsRead(id)

```javascript
async markNotificationAsRead(id)
```

* 标记通知为已读

---

## async markAllNotificationsAsRead()

```javascript
async markAllNotificationsAsRead()
```

* 全部标记为已读

---

## clearAllNotifications()

```javascript
clearAllNotifications()
```

* 清空所有通知

---

## toggleChatWindow(visible)

```javascript
toggleChatWindow(visible)
```

* 打开/关闭聊天窗口

---

## toggleNotificationPanel(visible)

```javascript
toggleNotificationPanel(visible)
```

* 打开/关闭通知面板

---

## initOnlineStatusListeners()

```javascript
initOnlineStatusListeners()
```

* 初始化在线状态监听

---

## removeOnlineStatusListeners()

```javascript
removeOnlineStatusListeners()
```

* 移除在线状态监听

---

