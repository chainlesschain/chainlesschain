# identity

**Source**: `src\renderer\stores\identity.js`

**Generated**: 2026-01-27T06:44:03.891Z

---

## export const useIdentityStore = defineStore('identity', () =>

```javascript
export const useIdentityStore = defineStore('identity', () =>
```

* 身份管理Store - 企业版多身份切换
 * 负责管理个人身份和组织身份的切换

---

## const currentIdentity = computed(() =>

```javascript
const currentIdentity = computed(() =>
```

* 获取当前身份信息

---

## const organizationIdentities = computed(() =>

```javascript
const organizationIdentities = computed(() =>
```

* 获取所有组织身份

---

## const isOrganizationContext = computed(() =>

```javascript
const isOrganizationContext = computed(() =>
```

* 是否是组织身份

---

## const currentOrgId = computed(() =>

```javascript
const currentOrgId = computed(() =>
```

* 当前组织ID（如果是组织身份）

---

## async function initialize()

```javascript
async function initialize()
```

* 初始化身份Store

---

## async function loadUserOrganizations()

```javascript
async function loadUserOrganizations()
```

* 加载用户所属的组织

---

## async function switchContext(contextId)

```javascript
async function switchContext(contextId)
```

* 切换身份上下文
   * @param {string} contextId - 身份上下文ID ('personal' 或 'org_xxx')

---

## async function createOrganization(orgData)

```javascript
async function createOrganization(orgData)
```

* 创建组织并添加到身份列表
   * @param {Object} orgData - 组织数据
   * @returns {Promise<Object>} 创建的组织信息

---

## async function joinOrganization(inviteCode)

```javascript
async function joinOrganization(inviteCode)
```

* 加入组织
   * @param {string} inviteCode - 邀请码
   * @returns {Promise<Object>} 加入的组织信息

---

## async function leaveOrganization(orgId)

```javascript
async function leaveOrganization(orgId)
```

* 离开组织
   * @param {string} orgId - 组织ID

---

## async function saveCurrentContext()

```javascript
async function saveCurrentContext()
```

* 保存当前上下文状态

---

## async function saveContextSwitch(contextId)

```javascript
async function saveContextSwitch(contextId)
```

* 保存身份切换记录
   * @param {string} contextId - 新的上下文ID

---

## async function getOrganization(orgId)

```javascript
async function getOrganization(orgId)
```

* 获取组织信息
   * @param {string} orgId - 组织ID

---

## async function getOrganizationMembers(orgId)

```javascript
async function getOrganizationMembers(orgId)
```

* 获取组织成员列表
   * @param {string} orgId - 组织ID

---

## async function checkPermission(permission)

```javascript
async function checkPermission(permission)
```

* 检查权限
   * @param {string} permission - 权限字符串
   * @returns {Promise<boolean>}

---

## async function createInvitation(inviteData)

```javascript
async function createInvitation(inviteData)
```

* 创建邀请
   * @param {Object} inviteData - 邀请数据
   * @returns {Promise<Object>} 邀请信息

---

