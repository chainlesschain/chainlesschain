# organization-manager

**Source**: `src/main/organization/organization-manager.js`

**Generated**: 2026-02-16T13:44:34.641Z

---

## class OrganizationManager

```javascript
class OrganizationManager
```

* 组织管理器 - 去中心化组织核心模块
 * 负责组织的创建、加入、管理等核心功能
 *
 * @class OrganizationManager

---

## setupP2PEventListeners()

```javascript
setupP2PEventListeners()
```

* 设置P2P事件监听器

---

## async createOrganization(orgData)

```javascript
async createOrganization(orgData)
```

* 创建组织
   * @param {Object} orgData - 组织数据
   * @param {string} orgData.name - 组织名称
   * @param {string} orgData.description - 组织描述
   * @param {string} orgData.type - 组织类型 (startup|company|community|opensource|education)
   * @param {string} orgData.avatar - 组织头像URL
   * @returns {Promise<Object>} 创建的组织信息

---

## async joinOrganization(inviteCode)

```javascript
async joinOrganization(inviteCode)
```

* 加入组织
   * @param {string} inviteCode - 邀请码
   * @returns {Promise<Object>} 加入的组织信息

---

## async getOrganization(orgId)

```javascript
async getOrganization(orgId)
```

* 获取组织信息
   * @param {string} orgId - 组织ID
   * @returns {Promise<Object|null>} 组织信息

---

## async updateOrganization(orgId, updates)

```javascript
async updateOrganization(orgId, updates)
```

* 更新组织信息
   * @param {string} orgId - 组织ID
   * @param {Object} updates - 更新的字段
   * @returns {Promise<Object>} 更新结果

---

## async getUserOrganizations(userDID)

```javascript
async getUserOrganizations(userDID)
```

* 获取用户所属的所有组织
   * @param {string} userDID - 用户DID
   * @returns {Promise<Array>} 组织列表

---

## async addMember(orgId, memberData)

```javascript
async addMember(orgId, memberData)
```

* 添加成员
   * @param {string} orgId - 组织ID
   * @param {Object} memberData - 成员数据
   * @returns {Promise<Object>} 添加的成员信息

---

## async getOrganizationMembers(orgId)

```javascript
async getOrganizationMembers(orgId)
```

* 获取组织成员列表
   * @param {string} orgId - 组织ID
   * @returns {Promise<Array>} 成员列表

---

## async updateMemberRole(orgId, memberDID, newRole)

```javascript
async updateMemberRole(orgId, memberDID, newRole)
```

* 更新成员角色
   * @param {string} orgId - 组织ID
   * @param {string} memberDID - 成员DID
   * @param {string} newRole - 新角色
   * @returns {Promise<void>}

---

## async removeMember(orgId, memberDID)

```javascript
async removeMember(orgId, memberDID)
```

* 移除成员
   * @param {string} orgId - 组织ID
   * @param {string} memberDID - 成员DID
   * @returns {Promise<void>}

---

## async createInvitation(orgId, inviteData)

```javascript
async createInvitation(orgId, inviteData)
```

* 创建邀请
   * @param {string} orgId - 组织ID
   * @param {Object} inviteData - 邀请数据
   * @returns {Promise<Object>} 邀请信息

---

## getInvitations(orgId)

```javascript
getInvitations(orgId)
```

* 获取组织的所有邀请（包括邀请码和DID邀请）
   * @param {string} orgId - 组织ID
   * @returns {Array} 邀请列表

---

## getInvitationStatus(invitation)

```javascript
getInvitationStatus(invitation)
```

* 获取邀请状态
   * @param {Object} invitation - 邀请对象
   * @returns {string} 状态

---

## async revokeInvitation(orgId, invitationId)

```javascript
async revokeInvitation(orgId, invitationId)
```

* 撤销邀请
   * @param {string} orgId - 组织ID
   * @param {string} invitationId - 邀请ID
   * @returns {Promise<Object>} 结果

---

## async deleteInvitation(orgId, invitationId)

```javascript
async deleteInvitation(orgId, invitationId)
```

* 删除邀请
   * @param {string} orgId - 组织ID
   * @param {string} invitationId - 邀请ID
   * @returns {Promise<Object>} 结果

---

## shortenDID(did)

```javascript
shortenDID(did)
```

* 缩短DID显示
   * @param {string} did - 完整DID
   * @returns {string} 缩短的DID

---

## async inviteByDID(orgId, inviteData)

```javascript
async inviteByDID(orgId, inviteData)
```

* 通过DID邀请用户加入组织
   * @param {string} orgId - 组织ID
   * @param {Object} inviteData - 邀请数据
   * @param {string} inviteData.invitedDID - 被邀请人的DID
   * @param {string} inviteData.role - 角色 (member|admin|viewer)
   * @param {string} inviteData.message - 邀请消息（可选）
   * @param {number} inviteData.expireAt - 过期时间戳（可选）
   * @returns {Promise<Object>} 邀请信息

---

## async acceptDIDInvitation(invitationId)

```javascript
async acceptDIDInvitation(invitationId)
```

* 接受DID邀请
   * @param {string} invitationId - 邀请ID
   * @returns {Promise<Object>} 组织信息

---

## async rejectDIDInvitation(invitationId)

```javascript
async rejectDIDInvitation(invitationId)
```

* 拒绝DID邀请
   * @param {string} invitationId - 邀请ID
   * @returns {Promise<boolean>} 是否成功

---

## async getPendingDIDInvitations()

```javascript
async getPendingDIDInvitations()
```

* 获取待处理的DID邀请（当前用户收到的）
   * @returns {Promise<Array>} 邀请列表

---

## async getDIDInvitationHistory(options =

```javascript
async getDIDInvitationHistory(options =
```

* 获取当前用户的DID邀请历史（已接受、已拒绝、已过期）
   * @param {Object} options - 选项
   * @param {string} options.status - 状态筛选（accepted|rejected）
   * @param {number} options.limit - 限制数量
   * @returns {Promise<Object>} { accepted, rejected, expired }

---

## async getDIDInvitations(orgId, options =

```javascript
async getDIDInvitations(orgId, options =
```

* 获取组织的DID邀请列表（用于管理）
   * @param {string} orgId - 组织ID
   * @param {Object} options - 选项
   * @param {string} options.status - 状态筛选（pending|accepted|rejected|expired）
   * @param {number} options.limit - 限制数量
   * @returns {Promise<Array>} 邀请列表

---

## async initializeBuiltinRoles(orgId)

```javascript
async initializeBuiltinRoles(orgId)
```

* 初始化内置角色
   * @param {string} orgId - 组织ID
   * @returns {Promise<void>}

---

## async checkPermission(orgId, userDID, permission)

```javascript
async checkPermission(orgId, userDID, permission)
```

* 检查权限
   * @param {string} orgId - 组织ID
   * @param {string} userDID - 用户DID
   * @param {string} permission - 权限字符串 (如 'knowledge.write')
   * @returns {Promise<boolean>} 是否有权限

---

## async logActivity(

```javascript
async logActivity(
```

* 记录活动日志
   * @param {string} orgId - 组织ID
   * @param {string} actorDID - 操作者DID
   * @param {string} action - 操作类型
   * @param {string} resourceType - 资源类型
   * @param {string} resourceId - 资源ID
   * @param {Object} metadata - 元数据
   * @returns {Promise<void>}

---

## async getOrganizationActivities(orgId, limit = 50)

```javascript
async getOrganizationActivities(orgId, limit = 50)
```

* 获取组织活动日志
   * @param {string} orgId - 组织ID
   * @param {number} limit - 限制数量
   * @returns {Promise<Array>} 活动日志列表

---

## getMemberActivities(orgId, memberDID, limit = 10)

```javascript
getMemberActivities(orgId, memberDID, limit = 10)
```

* 获取成员活动历史
   * @param {string} orgId - 组织ID
   * @param {string} memberDID - 成员DID
   * @param {number} limit - 限制数量
   * @returns {Array} 活动列表

---

## generateInviteCode()

```javascript
generateInviteCode()
```

* 生成邀请码
   * @returns {string} 邀请码

---

## getDefaultPermissionsByRole(role)

```javascript
getDefaultPermissionsByRole(role)
```

* 根据角色获取默认权限
   * @param {string} role - 角色名称
   * @returns {Array} 权限数组

---

## async initializeOrgP2PNetwork(orgId)

```javascript
async initializeOrgP2PNetwork(orgId)
```

* 初始化组织P2P网络
   * @param {string} orgId - 组织ID
   * @returns {Promise<void>}

---

## async connectToOrgP2PNetwork(orgId)

```javascript
async connectToOrgP2PNetwork(orgId)
```

* 连接到组织P2P网络
   * @param {string} orgId - 组织ID
   * @returns {Promise<void>}

---

## async handleOrgSyncMessage(orgId, message)

```javascript
async handleOrgSyncMessage(orgId, message)
```

* 处理组织同步消息
   * @param {string} orgId - 组织ID
   * @param {Object} message - 消息内容
   * @returns {Promise<void>}

---

## async broadcastOrgMessage(orgId, data)

```javascript
async broadcastOrgMessage(orgId, data)
```

* 广播组织消息
   * @param {string} orgId - 组织ID
   * @param {Object} data - 消息数据
   * @returns {Promise<void>}

---

## async requestIncrementalSync(orgId)

```javascript
async requestIncrementalSync(orgId)
```

* 请求增量同步
   * @param {string} orgId - 组织ID
   * @returns {Promise<void>}

---

## async getLocalVersion(orgId)

```javascript
async getLocalVersion(orgId)
```

* 获取本地数据版本号
   * @param {string} orgId - 组织ID
   * @returns {Promise<number>} 版本号

---

## async sendIncrementalData(orgId, targetDID, sinceVersion)

```javascript
async sendIncrementalData(orgId, targetDID, sinceVersion)
```

* 发送增量数据
   * @param {string} orgId - 组织ID
   * @param {string} targetDID - 目标用户DID
   * @param {number} sinceVersion - 起始版本号
   * @returns {Promise<void>}

---

## async applyIncrementalData(orgId, syncData)

```javascript
async applyIncrementalData(orgId, syncData)
```

* 应用增量数据
   * @param {string} orgId - 组织ID
   * @param {Object} syncData - 同步数据
   * @returns {Promise<void>}

---

## async checkConflict(orgId, change)

```javascript
async checkConflict(orgId, change)
```

* 检查是否有冲突
   * @param {string} orgId - 组织ID
   * @param {Object} change - 变更记录
   * @returns {Promise<boolean>} 是否冲突

---

## async resolveConflict(orgId, change)

```javascript
async resolveConflict(orgId, change)
```

* 解决冲突 - 使用Last-Write-Wins策略
   * @param {string} orgId - 组织ID
   * @param {Object} change - 变更记录
   * @returns {Promise<void>}

---

## async applyChange(orgId, change)

```javascript
async applyChange(orgId, change)
```

* 应用变更
   * @param {string} orgId - 组织ID
   * @param {Object} change - 变更记录
   * @returns {Promise<void>}

---

## async syncMemberUpdate(orgId, data)

```javascript
async syncMemberUpdate(orgId, data)
```

* 同步成员更新
   * @param {string} orgId - 组织ID
   * @param {Object} data - 成员数据
   * @returns {Promise<void>}

---

## async syncKnowledgeChange(orgId, data)

```javascript
async syncKnowledgeChange(orgId, data)
```

* 同步知识库变更
   * @param {string} orgId - 组织ID
   * @param {Object} data - 知识库变更数据
   * @returns {Promise<void>}

---

## async syncKnowledgeChange(orgId, data)

```javascript
async syncKnowledgeChange(orgId, data)
```

* 同步知识库变更
   * @param {string} orgId - 组织ID
   * @param {Object} data - 变更数据
   * @param {string} data.type - 变更类型 (create|update|delete)
   * @param {string} data.knowledgeId - 知识库条目ID
   * @param {Object} data.content - 变更内容
   * @param {string} data.authorDID - 作者DID
   * @param {number} data.timestamp - 变更时间戳

---

## async createKnowledgeEntry(

```javascript
async createKnowledgeEntry(
```

* 创建知识库条目

---

## async updateKnowledgeEntry(

```javascript
async updateKnowledgeEntry(
```

* 更新知识库条目

---

## async deleteKnowledgeEntry(orgId, knowledgeId, authorDID, timestamp)

```javascript
async deleteKnowledgeEntry(orgId, knowledgeId, authorDID, timestamp)
```

* 删除知识库条目

---

## async syncOrganizationData(orgId)

```javascript
async syncOrganizationData(orgId)
```

* 同步组织数据
   * @param {string} orgId - 组织ID
   * @returns {Promise<void>}

---

## async leaveOrganization(orgId, userDID)

```javascript
async leaveOrganization(orgId, userDID)
```

* 离开组织
   * @param {string} orgId - 组织ID
   * @param {string} userDID - 用户DID
   * @returns {Promise<void>}

---

## async deleteOrganization(orgId, userDID)

```javascript
async deleteOrganization(orgId, userDID)
```

* 删除组织（仅owner可操作）
   * @param {string} orgId - 组织ID
   * @param {string} userDID - 用户DID
   * @returns {Promise<void>}

---

## async getRoles(orgId)

```javascript
async getRoles(orgId)
```

* 获取组织所有角色
   * @param {string} orgId - 组织ID
   * @returns {Promise<Array>} 角色列表

---

## async getRole(roleId)

```javascript
async getRole(roleId)
```

* 获取单个角色
   * @param {string} roleId - 角色ID
   * @returns {Promise<Object|null>} 角色信息

---

## async createCustomRole(orgId, roleData, creatorDID)

```javascript
async createCustomRole(orgId, roleData, creatorDID)
```

* 创建自定义角色
   * @param {string} orgId - 组织ID
   * @param {Object} roleData - 角色数据
   * @param {string} roleData.name - 角色名称
   * @param {string} roleData.description - 角色描述
   * @param {Array<string>} roleData.permissions - 权限列表
   * @param {string} creatorDID - 创建者DID
   * @returns {Promise<Object>} 创建的角色

---

## async updateRole(roleId, updates, updaterDID)

```javascript
async updateRole(roleId, updates, updaterDID)
```

* 更新角色（仅能更新自定义角色）
   * @param {string} roleId - 角色ID
   * @param {Object} updates - 更新数据
   * @param {string} updates.name - 角色名称
   * @param {string} updates.description - 角色描述
   * @param {Array<string>} updates.permissions - 权限列表
   * @param {string} updaterDID - 更新者DID
   * @returns {Promise<Object>} 更新后的角色

---

## async deleteRole(roleId, deleterDID)

```javascript
async deleteRole(roleId, deleterDID)
```

* 删除自定义角色
   * @param {string} roleId - 角色ID
   * @param {string} deleterDID - 删除者DID
   * @returns {Promise<void>}

---

## getAllPermissions()

```javascript
getAllPermissions()
```

* 获取所有可用权限列表
   * @returns {Array} 权限列表

---

## getOnlineMembers(orgId)

```javascript
getOnlineMembers(orgId)
```

* 获取组织在线成员列表
   * @param {string} orgId - 组织ID
   * @returns {Array<string>} 在线成员DID列表

---

## getOnlineMemberCount(orgId)

```javascript
getOnlineMemberCount(orgId)
```

* 获取组织在线成员数量
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

## async isMember(orgId, userDID)

```javascript
async isMember(orgId, userDID)
```

* 检查用户是否是组织成员
   * @param {string} orgId - 组织ID
   * @param {string} userDID - 用户DID
   * @returns {Promise<boolean>} 是否是成员

---

## async broadcastOrgP2PMessage(orgId, message)

```javascript
async broadcastOrgP2PMessage(orgId, message)
```

* 广播消息到组织
   * @param {string} orgId - 组织ID
   * @param {Object} message - 消息内容
   * @returns {Promise<void>}

---

## getOrgNetworkStats(orgId)

```javascript
getOrgNetworkStats(orgId)
```

* 获取组织P2P网络统计信息
   * @param {string} orgId - 组织ID
   * @returns {Object} 统计信息

---

## async disconnectFromOrgP2PNetwork(orgId)

```javascript
async disconnectFromOrgP2PNetwork(orgId)
```

* 断开组织P2P网络连接
   * @param {string} orgId - 组织ID
   * @returns {Promise<void>}

---

## async handleKnowledgeEvent(orgId, type, data)

```javascript
async handleKnowledgeEvent(orgId, type, data)
```

* 处理知识库事件
   * @param {string} orgId - 组织ID
   * @param {string} type - 事件类型 (knowledge:create|knowledge:update|knowledge:delete|knowledge:sync)
   * @param {Object} data - 事件数据
   * @returns {Promise<Object>} 处理结果

---

## async getOrgKnowledgeForSync(orgId, since = 0)

```javascript
async getOrgKnowledgeForSync(orgId, since = 0)
```

* 获取组织知识库数据用于同步
   * @param {string} orgId - 组织ID
   * @param {number} since - 时间戳，获取此时间之后的数据
   * @returns {Promise<Object>} 知识库数据

---

