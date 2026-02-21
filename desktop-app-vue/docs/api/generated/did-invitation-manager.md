# did-invitation-manager

**Source**: `src/main/organization/did-invitation-manager.js`

**Generated**: 2026-02-21T22:04:25.810Z

---

## const

```javascript
const
```

* DID邀请管理器
 *
 * 功能：
 * - 通过DID直接发送邀请
 * - DID邀请验证和接受流程
 * - 跨组织DID邀请
 * - 邀请历史和状态追踪
 * - 去中心化邀请机制（无需中心服务器）

---

## const InvitationStatus =

```javascript
const InvitationStatus =
```

* 邀请状态枚举

---

## const InvitationType =

```javascript
const InvitationType =
```

* 邀请类型枚举

---

## class DIDInvitationManager

```javascript
class DIDInvitationManager
```

* DID邀请管理器类

---

## initializeDatabase()

```javascript
initializeDatabase()
```

* 初始化数据库表

---

## registerP2PHandlers()

```javascript
registerP2PHandlers()
```

* 注册P2P消息处理器

---

## async createDIDInvitation(params)

```javascript
async createDIDInvitation(params)
```

* 创建DID邀请
   * @param {Object} params - 邀请参数
   * @param {string} params.orgId - 组织ID
   * @param {string} params.inviteeDID - 被邀请人DID
   * @param {string} params.role - 角色（默认member）
   * @param {string} params.message - 邀请消息
   * @param {number} params.expiresIn - 过期时间（毫秒，默认7天）
   * @param {Object} params.metadata - 额外元数据
   * @returns {Promise<Object>} 邀请信息

---

## async sendInvitationViaPeer(invitation)

```javascript
async sendInvitationViaPeer(invitation)
```

* 通过P2P发送邀请
   * @param {Object} invitation - 邀请信息
   * @returns {Promise<void>}

---

## async handleIncomingInvitation(invitation, senderPeerId)

```javascript
async handleIncomingInvitation(invitation, senderPeerId)
```

* 处理收到的邀请
   * @param {Object} invitation - 邀请信息
   * @param {string} senderPeerId - 发送者PeerId
   * @returns {Promise<void>}

---

## async acceptInvitation(invitationId)

```javascript
async acceptInvitation(invitationId)
```

* 接受邀请
   * @param {string} invitationId - 邀请ID
   * @returns {Promise<Object>} 加入的组织信息

---

## async rejectInvitation(invitationId, reason = "")

```javascript
async rejectInvitation(invitationId, reason = "")
```

* 拒绝邀请
   * @param {string} invitationId - 邀请ID
   * @param {string} reason - 拒绝原因
   * @returns {Promise<void>}

---

## async cancelInvitation(invitationId)

```javascript
async cancelInvitation(invitationId)
```

* 取消邀请
   * @param {string} invitationId - 邀请ID
   * @returns {Promise<void>}

---

## async notifyInviter(invitation, status, reason = "")

```javascript
async notifyInviter(invitation, status, reason = "")
```

* 通知邀请人
   * @param {Object} invitation - 邀请信息
   * @param {string} status - 新状态
   * @param {string} reason - 原因（可选）
   * @returns {Promise<void>}

---

## async notifyInvitee(invitation, status)

```javascript
async notifyInvitee(invitation, status)
```

* 通知被邀请人
   * @param {Object} invitation - 邀请信息
   * @param {string} status - 新状态
   * @returns {Promise<void>}

---

## getReceivedInvitations(status = null)

```javascript
getReceivedInvitations(status = null)
```

* 获取收到的邀请列表
   * @param {string} status - 状态过滤（可选）
   * @returns {Array<Object>} 邀请列表

---

## getSentInvitations(orgId = null, status = null)

```javascript
getSentInvitations(orgId = null, status = null)
```

* 获取发送的邀请列表
   * @param {string} orgId - 组织ID（可选）
   * @param {string} status - 状态过滤（可选）
   * @returns {Array<Object>} 邀请列表

---

## getInvitation(invitationId)

```javascript
getInvitation(invitationId)
```

* 获取邀请详情
   * @param {string} invitationId - 邀请ID
   * @returns {Object|null} 邀请详情

---

## cleanupExpiredInvitations()

```javascript
cleanupExpiredInvitations()
```

* 清理过期邀请
   * @returns {number} 清理的邀请数量

---

## getInvitationStats(orgId = null)

```javascript
getInvitationStats(orgId = null)
```

* 获取邀请统计信息
   * @param {string} orgId - 组织ID（可选）
   * @returns {Object} 统计信息

---

## generateInvitationToken()

```javascript
generateInvitationToken()
```

* 生成安全的邀请令牌
   * @returns {string} 邀请令牌

---

## async createInvitationLink(params)

```javascript
async createInvitationLink(params)
```

* 创建邀请链接
   * @param {Object} params - 邀请链接参数
   * @param {string} params.orgId - 组织ID
   * @param {string} params.role - 角色（默认member）
   * @param {string} params.message - 邀请消息
   * @param {number} params.maxUses - 最大使用次数（默认1，-1表示无限制）
   * @param {number} params.expiresIn - 过期时间（毫秒，默认7天）
   * @param {Object} params.metadata - 额外元数据
   * @returns {Promise<Object>} 邀请链接信息

---

## async validateInvitationToken(token)

```javascript
async validateInvitationToken(token)
```

* 验证邀请令牌
   * @param {string} token - 邀请令牌
   * @returns {Promise<Object>} 邀请链接信息

---

## async acceptInvitationLink(token, options =

```javascript
async acceptInvitationLink(token, options =
```

* 通过邀请链接加入组织
   * @param {string} token - 邀请令牌
   * @param {Object} options - 选项
   * @param {string} options.ipAddress - IP地址（可选）
   * @param {string} options.userAgent - User Agent（可选）
   * @returns {Promise<Object>} 加入的组织信息

---

## getInvitationLinks(orgId, options =

```javascript
getInvitationLinks(orgId, options =
```

* 获取邀请链接列表
   * @param {string} orgId - 组织ID
   * @param {Object} options - 选项
   * @param {string} options.status - 状态过滤（active/expired/revoked）
   * @returns {Array<Object>} 邀请链接列表

---

## getInvitationLink(linkId)

```javascript
getInvitationLink(linkId)
```

* 获取邀请链接详情
   * @param {string} linkId - 链接ID
   * @returns {Object|null} 邀请链接详情

---

## async revokeInvitationLink(linkId)

```javascript
async revokeInvitationLink(linkId)
```

* 撤销邀请链接
   * @param {string} linkId - 链接ID
   * @returns {Promise<void>}

---

## async deleteInvitationLink(linkId)

```javascript
async deleteInvitationLink(linkId)
```

* 删除邀请链接
   * @param {string} linkId - 链接ID
   * @returns {Promise<void>}

---

## getInvitationLinkStats(orgId)

```javascript
getInvitationLinkStats(orgId)
```

* 获取邀请链接统计信息
   * @param {string} orgId - 组织ID
   * @returns {Object} 统计信息

---

## async generateInvitationQRCode(linkId, options =

```javascript
async generateInvitationQRCode(linkId, options =
```

* 为邀请链接生成QR码
   * @param {string} linkId - 链接ID或邀请令牌
   * @param {Object} options - QR码选项
   * @param {number} options.width - 宽度（默认300）
   * @param {string} options.format - 格式（'png'|'svg'|'dataURL'，默认'dataURL'）
   * @param {string} options.errorCorrectionLevel - 纠错级别（'L'|'M'|'Q'|'H'，默认'M'）
   * @returns {Promise<string|Buffer>} QR码数据

---

## async generateDIDInvitationQRCode(invitationId, options =

```javascript
async generateDIDInvitationQRCode(invitationId, options =
```

* 为DID邀请生成QR码
   * @param {string} invitationId - 邀请ID
   * @param {Object} options - QR码选项
   * @returns {Promise<string>} QR码数据URL

---

## async generateBatchInvitationQRCodes(orgId, options =

```javascript
async generateBatchInvitationQRCodes(orgId, options =
```

* 批量生成邀请QR码
   * @param {string} orgId - 组织ID
   * @param {Object} options - 选项
   * @param {string} options.status - 状态过滤
   * @param {string} options.format - QR码格式
   * @returns {Promise<Array<Object>>} QR码列表

---

## async parseInvitationQRCode(qrData)

```javascript
async parseInvitationQRCode(qrData)
```

* 解析邀请QR码
   * @param {string} qrData - QR码数据
   * @returns {Promise<Object>} 解析后的邀请信息

---

