# identity-context-manager

**Source**: `src/main/identity/identity-context-manager.js`

**Generated**: 2026-02-15T07:37:13.831Z

---

## const

```javascript
const
```

* 身份上下文管理器
 *
 * 功能:
 * - 管理多个身份上下文(个人、多个组织)
 * - 身份切换
 * - 数据库文件隔离
 * - 上下文数据加载/卸载
 *
 * @author ChainlessChain Enterprise
 * @version 1.0.0

---

## async initialize()

```javascript
async initialize()
```

* 初始化身份上下文管理器

---

## createTables()

```javascript
createTables()
```

* 创建数据表

---

## async migrateIfNeeded()

```javascript
async migrateIfNeeded()
```

* 迁移现有数据(从个人版升级到企业版)

---

## async createPersonalContext(userDID, displayName)

```javascript
async createPersonalContext(userDID, displayName)
```

* 创建个人上下文

---

## async createOrganizationContext(

```javascript
async createOrganizationContext(
```

* 创建组织上下文

---

## getAllContexts(userDID)

```javascript
getAllContexts(userDID)
```

* 获取所有身份上下文

---

## getActiveContext(userDID)

```javascript
getActiveContext(userDID)
```

* 获取当前激活的上下文

---

## async switchContext(userDID, targetContextId)

```javascript
async switchContext(userDID, targetContextId)
```

* 切换身份上下文

---

## async loadContext(contextId)

```javascript
async loadContext(contextId)
```

* 加载上下文数据

---

## async unloadContext(contextId)

```javascript
async unloadContext(contextId)
```

* 卸载上下文数据

---

## getContextDatabase(contextId)

```javascript
getContextDatabase(contextId)
```

* 获取上下文数据库连接

---

## async loadDefaultContext()

```javascript
async loadDefaultContext()
```

* 加载默认上下文

---

## async deleteOrganizationContext(userDID, orgId)

```javascript
async deleteOrganizationContext(userDID, orgId)
```

* 删除组织上下文

---

## getSwitchHistory(userDID, limit = 10)

```javascript
getSwitchHistory(userDID, limit = 10)
```

* 获取切换历史

---

## cleanup()

```javascript
cleanup()
```

* 清理资源

---

