# group-chat-manager

**Source**: `src\main\social\group-chat-manager.js`

**Generated**: 2026-01-27T06:44:03.809Z

---

## const

```javascript
const
```

* 群聊管理器
 * 负责群聊的创建、管理、消息发送等功能
 * 支持端到端加密的群组消息（基于Signal Protocol Sender Keys）
 *
 * @module group-chat-manager

---

## setCurrentUserDid(did)

```javascript
setCurrentUserDid(did)
```

* 设置当前用户DID

---

## async createGroup(options)

```javascript
async createGroup(options)
```

* 创建群聊
   * @param {Object} options - 群聊选项
   * @param {string} options.name - 群聊名称
   * @param {string} options.description - 群聊描述
   * @param {string} options.avatar - 群聊头像
   * @param {Array<string>} options.memberDids - 初始成员DID列表
   * @param {boolean} options.encrypted - 是否启用端到端加密

---

## async getGroups()

```javascript
async getGroups()
```

* 获取群聊列表

---

## async getGroupDetails(groupId)

```javascript
async getGroupDetails(groupId)
```

* 获取群聊详情

---

## async addGroupMember(groupId, memberDid, role = 'member')

```javascript
async addGroupMember(groupId, memberDid, role = 'member')
```

* 添加群成员

---

## async removeGroupMember(groupId, memberDid)

```javascript
async removeGroupMember(groupId, memberDid)
```

* 移除群成员

---

## async leaveGroup(groupId)

```javascript
async leaveGroup(groupId)
```

* 退出群聊

---

## async dismissGroup(groupId)

```javascript
async dismissGroup(groupId)
```

* 解散群聊

---

## async sendGroupMessage(groupId, content, options =

```javascript
async sendGroupMessage(groupId, content, options =
```

* 发送群消息

---

## async getGroupMessages(groupId, limit = 50, offset = 0)

```javascript
async getGroupMessages(groupId, limit = 50, offset = 0)
```

* 获取群消息

---

## async markMessageAsRead(messageId, groupId)

```javascript
async markMessageAsRead(messageId, groupId)
```

* 标记消息为已读

---

## async getGroupMember(groupId, memberDid)

```javascript
async getGroupMember(groupId, memberDid)
```

* 获取群成员

---

## async sendSystemMessage(groupId, content)

```javascript
async sendSystemMessage(groupId, content)
```

* 发送系统消息

---

## async generateGroupEncryptionKey(groupId)

```javascript
async generateGroupEncryptionKey(groupId)
```

* 生成群组加密密钥（Sender Key）

---

## async encryptGroupMessage(groupId, plaintext)

```javascript
async encryptGroupMessage(groupId, plaintext)
```

* 加密群消息

---

## async decryptGroupMessage(groupId, ciphertext, keyId)

```javascript
async decryptGroupMessage(groupId, ciphertext, keyId)
```

* 解密群消息

---

## async broadcastGroupMessage(groupId, message)

```javascript
async broadcastGroupMessage(groupId, message)
```

* 通过P2P网络广播群消息

---

## async notifyGroupMembers(groupId, notification)

```javascript
async notifyGroupMembers(groupId, notification)
```

* 通知群成员

---

## async updateGroupInfo(groupId, updates)

```javascript
async updateGroupInfo(groupId, updates)
```

* 更新群信息

---

## cleanup()

```javascript
cleanup()
```

* 清理资源

---

