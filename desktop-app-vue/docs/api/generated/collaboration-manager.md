# collaboration-manager

**Source**: `src/main/collaboration/collaboration-manager.js`

**Generated**: 2026-02-21T20:04:16.260Z

---

## const

```javascript
const
```

* 协作管理器
 * 提供实时协作编辑功能，支持多用户同时编辑文档
 * 基于ShareDB实现OT (Operational Transformation) 算法

---

## async initialize(options =

```javascript
async initialize(options =
```

* 初始化协作管理器

---

## async createTables()

```javascript
async createTables()
```

* 创建数据库表

---

## async startServer()

```javascript
async startServer()
```

* 启动WebSocket服务器

---

## async stopServer()

```javascript
async stopServer()
```

* 停止WebSocket服务器

---

## async handleMessage(connectionId, message)

```javascript
async handleMessage(connectionId, message)
```

* 处理消息

---

## async handleJoin(connectionId, payload)

```javascript
async handleJoin(connectionId, payload)
```

* 处理加入文档

---

## async handleCursorUpdate(connectionId, payload)

```javascript
async handleCursorUpdate(connectionId, payload)
```

* 处理光标更新

---

## async handleSelectionUpdate(connectionId, payload)

```javascript
async handleSelectionUpdate(connectionId, payload)
```

* 处理选区更新

---

## async handlePresenceUpdate(connectionId, payload)

```javascript
async handlePresenceUpdate(connectionId, payload)
```

* 处理在线状态更新

---

## handleDisconnect(connectionId)

```javascript
handleDisconnect(connectionId)
```

* 处理断开连接

---

## async joinDocument(userId, userName, documentId)

```javascript
async joinDocument(userId, userName, documentId)
```

* 加入文档协作

---

## async submitOperation(documentId, userId, operation)

```javascript
async submitOperation(documentId, userId, operation)
```

* 提交操作

---

## onDocumentChange(documentId, callback)

```javascript
onDocumentChange(documentId, callback)
```

* 监听文档变更

---

## broadcastToDocument(documentId, excludeUserId, message)

```javascript
broadcastToDocument(documentId, excludeUserId, message)
```

* 广播消息到文档的所有用户

---

## getOnlineUsers(documentId)

```javascript
getOnlineUsers(documentId)
```

* 获取在线用户

---

## getOperationHistory(documentId, limit = 100)

```javascript
getOperationHistory(documentId, limit = 100)
```

* 获取文档操作历史

---

## getSessionHistory(documentId, limit = 50)

```javascript
getSessionHistory(documentId, limit = 50)
```

* 获取会话历史

---

## generateConnectionId()

```javascript
generateConnectionId()
```

* 生成连接ID

---

## getStatus()

```javascript
getStatus()
```

* 获取服务器状态

---

## getAllOnlineUsers()

```javascript
getAllOnlineUsers()
```

* 获取所有在线用户

---

## async checkDocumentPermission(userDID, orgId, knowledgeId, action = "read")

```javascript
async checkDocumentPermission(userDID, orgId, knowledgeId, action = "read")
```

* 检查文档权限 (企业版功能)
   * @param {string} userDID - 用户DID
   * @param {string} orgId - 组织ID
   * @param {string} knowledgeId - 知识库ID
   * @param {string} action - 操作类型 (read/write/delete)
   * @returns {Promise<boolean>} 是否有权限

---

## _getPermissionLevel(permission)

```javascript
_getPermissionLevel(permission)
```

* 获取权限级别数值
   * @param {string} permission - 权限名称
   * @returns {number} 权限级别（数值越大权限越高）
   * @private

---

## setOrganizationManager(organizationManager)

```javascript
setOrganizationManager(organizationManager)
```

* 设置组织管理器引用
   * @param {Object} organizationManager - 组织管理器实例

---

## function getCollaborationManager()

```javascript
function getCollaborationManager()
```

* 获取协作管理器实例
 * @returns {CollaborationManager}

---

