# identityStore

**Source**: `src\renderer\stores\identityStore.js`

**Generated**: 2026-01-27T06:44:03.891Z

---

## import

```javascript
import
```

* 身份上下文 Store
 *
 * 管理多个身份上下文(个人、组织)的切换和状态
 *
 * @module identityStore

---

## const isPersonalContext = computed(() =>

```javascript
const isPersonalContext = computed(() =>
```

* 是否在个人身份

---

## const isOrganizationContext = computed(() =>

```javascript
const isOrganizationContext = computed(() =>
```

* 是否在组织身份

---

## const currentContextId = computed(() =>

```javascript
const currentContextId = computed(() =>
```

* 当前上下文ID

---

## const currentOrgId = computed(() =>

```javascript
const currentOrgId = computed(() =>
```

* 当前组织ID

---

## const personalContext = computed(() =>

```javascript
const personalContext = computed(() =>
```

* 个人上下文

---

## const organizationContexts = computed(() =>

```javascript
const organizationContexts = computed(() =>
```

* 组织上下文列表

---

## const contextCount = computed(() =>

```javascript
const contextCount = computed(() =>
```

* 上下文数量

---

## const hasOrganizations = computed(() =>

```javascript
const hasOrganizations = computed(() =>
```

* 是否有组织

---

## async function initialize(userDID)

```javascript
async function initialize(userDID)
```

* 初始化身份上下文

---

## async function loadContexts()

```javascript
async function loadContexts()
```

* 加载所有上下文

---

## async function ensurePersonalContext(userDID, displayName = '个人')

```javascript
async function ensurePersonalContext(userDID, displayName = '个人')
```

* 确保个人上下文存在

---

## async function createOrganizationContext(orgId, orgDID, displayName, avatar = null)

```javascript
async function createOrganizationContext(orgId, orgDID, displayName, avatar = null)
```

* 创建组织上下文

---

## async function switchContext(targetContextId)

```javascript
async function switchContext(targetContextId)
```

* 切换身份上下文

---

## async function switchToPersonal()

```javascript
async function switchToPersonal()
```

* 切换到个人身份

---

## async function switchToOrganization(orgId)

```javascript
async function switchToOrganization(orgId)
```

* 切换到组织身份

---

## async function deleteOrganizationContext(orgId)

```javascript
async function deleteOrganizationContext(orgId)
```

* 删除组织上下文

---

## async function getSwitchHistory(limit = 10)

```javascript
async function getSwitchHistory(limit = 10)
```

* 获取切换历史

---

## function getContextById(contextId)

```javascript
function getContextById(contextId)
```

* 根据上下文ID获取上下文

---

## async function refreshActiveContext()

```javascript
async function refreshActiveContext()
```

* 刷新当前上下文

---

## function reset()

```javascript
function reset()
```

* 重置 Store

---

