# social-ipc

**Source**: `src/main/social/social-ipc.js`

**Generated**: 2026-02-17T10:13:18.188Z

---

## const

```javascript
const
```

* Social IPC 处理器
 * 负责处理社交网络相关的前后端通信
 *
 * @module social-ipc
 * @description 提供联系人管理、好友关系、动态发布、聊天消息、群聊等社交功能的 IPC 接口

---

## function registerSocialIPC(

```javascript
function registerSocialIPC(
```

* 注册所有 Social IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.contactManager - 联系人管理器
 * @param {Object} dependencies.friendManager - 好友管理器
 * @param {Object} dependencies.postManager - 动态管理器
 * @param {Object} dependencies.database - 数据库管理器（用于聊天功能）
 * @param {Object} dependencies.groupChatManager - 群聊管理器

---

## ipcMain.handle("contact:add", async (_event, contact) =>

```javascript
ipcMain.handle("contact:add", async (_event, contact) =>
```

* 添加联系人
   * Channel: 'contact:add'

---

## ipcMain.handle("contact:add-from-qr", async (_event, qrData) =>

```javascript
ipcMain.handle("contact:add-from-qr", async (_event, qrData) =>
```

* 从二维码添加联系人
   * Channel: 'contact:add-from-qr'

---

## ipcMain.handle("contact:get-all", async () =>

```javascript
ipcMain.handle("contact:get-all", async () =>
```

* 获取所有联系人
   * Channel: 'contact:get-all'

---

## ipcMain.handle("contact:get", async (_event, did) =>

```javascript
ipcMain.handle("contact:get", async (_event, did) =>
```

* 根据 DID 获取联系人
   * Channel: 'contact:get'

---

## ipcMain.handle("contact:update", async (_event, did, updates) =>

```javascript
ipcMain.handle("contact:update", async (_event, did, updates) =>
```

* 更新联系人信息
   * Channel: 'contact:update'

---

## ipcMain.handle("contact:delete", async (_event, did) =>

```javascript
ipcMain.handle("contact:delete", async (_event, did) =>
```

* 删除联系人
   * Channel: 'contact:delete'

---

## ipcMain.handle("contact:search", async (_event, query) =>

```javascript
ipcMain.handle("contact:search", async (_event, query) =>
```

* 搜索联系人
   * Channel: 'contact:search'

---

## ipcMain.handle("contact:get-friends", async () =>

```javascript
ipcMain.handle("contact:get-friends", async () =>
```

* 获取好友列表（通过联系人管理器）
   * Channel: 'contact:get-friends'

---

## ipcMain.handle("contact:get-statistics", async () =>

```javascript
ipcMain.handle("contact:get-statistics", async () =>
```

* 获取联系人统计信息
   * Channel: 'contact:get-statistics'

---

## ipcMain.handle("friend:send-request", async (_event, targetDid, message) =>

```javascript
ipcMain.handle("friend:send-request", async (_event, targetDid, message) =>
```

* 发送好友请求
   * Channel: 'friend:send-request'

---

## ipcMain.handle("friend:accept-request", async (_event, requestId) =>

```javascript
ipcMain.handle("friend:accept-request", async (_event, requestId) =>
```

* 接受好友请求
   * Channel: 'friend:accept-request'

---

## ipcMain.handle("friend:reject-request", async (_event, requestId) =>

```javascript
ipcMain.handle("friend:reject-request", async (_event, requestId) =>
```

* 拒绝好友请求
   * Channel: 'friend:reject-request'

---

## ipcMain.handle("friend:get-pending-requests", async () =>

```javascript
ipcMain.handle("friend:get-pending-requests", async () =>
```

* 获取待处理的好友请求
   * Channel: 'friend:get-pending-requests'

---

## ipcMain.handle("friend:get-friends", async (_event, groupName) =>

```javascript
ipcMain.handle("friend:get-friends", async (_event, groupName) =>
```

* 获取好友列表（可按分组过滤）
   * Channel: 'friend:get-friends'

---

## ipcMain.handle("friend:get-list", async () =>

```javascript
ipcMain.handle("friend:get-list", async () =>
```

* 获取好友列表（返回包装格式，供前端使用）
   * Channel: 'friend:get-list'

---

## ipcMain.handle("friend:remove", async (_event, friendDid) =>

```javascript
ipcMain.handle("friend:remove", async (_event, friendDid) =>
```

* 删除好友
   * Channel: 'friend:remove'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 更新好友备注
   * Channel: 'friend:update-nickname'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 更新好友分组
   * Channel: 'friend:update-group'

---

## ipcMain.handle("friend:get-statistics", async () =>

```javascript
ipcMain.handle("friend:get-statistics", async () =>
```

* 获取好友统计信息
   * Channel: 'friend:get-statistics'

---

## ipcMain.handle("post:create", async (_event, options) =>

```javascript
ipcMain.handle("post:create", async (_event, options) =>
```

* 发布动态
   * Channel: 'post:create'

---

## ipcMain.handle("post:get-feed", async (_event, options) =>

```javascript
ipcMain.handle("post:get-feed", async (_event, options) =>
```

* 获取动态流
   * Channel: 'post:get-feed'

---

## ipcMain.handle("post:get", async (_event, postId) =>

```javascript
ipcMain.handle("post:get", async (_event, postId) =>
```

* 获取单条动态
   * Channel: 'post:get'

---

## ipcMain.handle("post:delete", async (_event, postId) =>

```javascript
ipcMain.handle("post:delete", async (_event, postId) =>
```

* 删除动态
   * Channel: 'post:delete'

---

## ipcMain.handle("post:like", async (_event, postId) =>

```javascript
ipcMain.handle("post:like", async (_event, postId) =>
```

* 点赞动态
   * Channel: 'post:like'

---

## ipcMain.handle("post:unlike", async (_event, postId) =>

```javascript
ipcMain.handle("post:unlike", async (_event, postId) =>
```

* 取消点赞
   * Channel: 'post:unlike'

---

## ipcMain.handle("post:get-likes", async (_event, postId) =>

```javascript
ipcMain.handle("post:get-likes", async (_event, postId) =>
```

* 获取点赞列表
   * Channel: 'post:get-likes'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 添加评论
   * Channel: 'post:add-comment'

---

## ipcMain.handle("post:get-comments", async (_event, postId) =>

```javascript
ipcMain.handle("post:get-comments", async (_event, postId) =>
```

* 获取评论列表
   * Channel: 'post:get-comments'

---

## ipcMain.handle("post:delete-comment", async (_event, commentId) =>

```javascript
ipcMain.handle("post:delete-comment", async (_event, commentId) =>
```

* 删除评论
   * Channel: 'post:delete-comment'

---

## ipcMain.handle("chat:get-sessions", async () =>

```javascript
ipcMain.handle("chat:get-sessions", async () =>
```

* 获取聊天会话列表
   * Channel: 'chat:get-sessions'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 获取聊天消息
   * Channel: 'chat:get-messages'

---

## ipcMain.handle("chat:save-message", async (_event, message) =>

```javascript
ipcMain.handle("chat:save-message", async (_event, message) =>
```

* 保存聊天消息
   * Channel: 'chat:save-message'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 更新消息状态
   * Channel: 'chat:update-message-status'

---

## ipcMain.handle("chat:mark-as-read", async (_event, sessionId) =>

```javascript
ipcMain.handle("chat:mark-as-read", async (_event, sessionId) =>
```

* 标记会话为已读
   * Channel: 'chat:mark-as-read'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 添加消息表情回应
   * Channel: 'chat:add-reaction'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 移除消息表情回应
   * Channel: 'chat:remove-reaction'

---

## ipcMain.handle("chat:get-reactions", async (_event, messageId) =>

```javascript
ipcMain.handle("chat:get-reactions", async (_event, messageId) =>
```

* 获取消息的所有表情回应
   * Channel: 'chat:get-reactions'

---

## ipcMain.handle("chat:get-reaction-stats", async (_event, messageId) =>

```javascript
ipcMain.handle("chat:get-reaction-stats", async (_event, messageId) =>
```

* 获取消息的表情回应统计
   * Channel: 'chat:get-reaction-stats'

---

## ipcMain.handle("group:create", async (_event, options) =>

```javascript
ipcMain.handle("group:create", async (_event, options) =>
```

* 创建群聊
   * Channel: 'group:create'

---

## ipcMain.handle("group:get-list", async () =>

```javascript
ipcMain.handle("group:get-list", async () =>
```

* 获取群聊列表
   * Channel: 'group:get-list'

---

## ipcMain.handle("group:get-details", async (_event, groupId) =>

```javascript
ipcMain.handle("group:get-details", async (_event, groupId) =>
```

* 获取群聊详情
   * Channel: 'group:get-details'

---

## ipcMain.handle("group:update-info", async (_event, groupId, updates) =>

```javascript
ipcMain.handle("group:update-info", async (_event, groupId, updates) =>
```

* 更新群信息
   * Channel: 'group:update-info'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 添加群成员
   * Channel: 'group:add-member'

---

## ipcMain.handle("group:remove-member", async (_event, groupId, memberDid) =>

```javascript
ipcMain.handle("group:remove-member", async (_event, groupId, memberDid) =>
```

* 移除群成员
   * Channel: 'group:remove-member'

---

## ipcMain.handle("group:leave", async (_event, groupId) =>

```javascript
ipcMain.handle("group:leave", async (_event, groupId) =>
```

* 退出群聊
   * Channel: 'group:leave'

---

## ipcMain.handle("group:dismiss", async (_event, groupId) =>

```javascript
ipcMain.handle("group:dismiss", async (_event, groupId) =>
```

* 解散群聊
   * Channel: 'group:dismiss'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 发送群消息
   * Channel: 'group:send-message'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 获取群消息
   * Channel: 'group:get-messages'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 标记群消息为已读
   * Channel: 'group:mark-message-read'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 邀请成员加入群聊
   * Channel: 'group:invite-member'

---

## ipcMain.handle("group:accept-invitation", async (_event, invitationId) =>

```javascript
ipcMain.handle("group:accept-invitation", async (_event, invitationId) =>
```

* 接受群聊邀请
   * Channel: 'group:accept-invitation'

---

## ipcMain.handle("group:reject-invitation", async (_event, invitationId) =>

```javascript
ipcMain.handle("group:reject-invitation", async (_event, invitationId) =>
```

* 拒绝群聊邀请
   * Channel: 'group:reject-invitation'

---

## ipcMain.handle("group:get-invitations", async (_event, inviteeDid) =>

```javascript
ipcMain.handle("group:get-invitations", async (_event, inviteeDid) =>
```

* 获取群聊邀请列表
   * Channel: 'group:get-invitations'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 发送文件消息（图片/文件）
   * Channel: 'chat:send-file'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 选择并发送图片
   * Channel: 'chat:select-and-send-image'

---

## ipcMain.handle("chat:select-and-send-file", async (_event,

```javascript
ipcMain.handle("chat:select-and-send-file", async (_event,
```

* 选择并发送文件
   * Channel: 'chat:select-and-send-file'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 下载文件
   * Channel: 'chat:download-file'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 转发消息
   * Channel: 'chat:forward-message'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 获取文件传输进度
   * Channel: 'chat:get-transfer-progress'

---

## ipcMain.handle("chat:cancel-transfer", async (_event,

```javascript
ipcMain.handle("chat:cancel-transfer", async (_event,
```

* 取消文件传输
   * Channel: 'chat:cancel-transfer'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 接受文件传输
   * Channel: 'chat:accept-transfer'

---

## ipcMain.handle("chat:play-voice-message", async (_event,

```javascript
ipcMain.handle("chat:play-voice-message", async (_event,
```

* 播放语音消息
   * Channel: 'chat:play-voice-message'

---

