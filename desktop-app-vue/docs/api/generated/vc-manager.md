# vc-manager

**Source**: `src/main/vc/vc-manager.js`

**Generated**: 2026-02-16T13:44:34.597Z

---

## const

```javascript
const
```

* 可验证凭证 (Verifiable Credentials) 管理器
 *
 * 实现 W3C Verifiable Credentials 标准
 * 支持凭证类型：
 * - SelfDeclaration: 自我声明
 * - SkillCertificate: 技能证书
 * - TrustEndorsement: 信任背书
 * - EducationCredential: 教育凭证
 * - WorkExperience: 工作经历

---

## const VC_TYPES =

```javascript
const VC_TYPES =
```

* VC 类型常量

---

## const VC_STATUS =

```javascript
const VC_STATUS =
```

* VC 状态常量

---

## class VCManager extends EventEmitter

```javascript
class VCManager extends EventEmitter
```

* VC 管理器类

---

## async initialize()

```javascript
async initialize()
```

* 初始化 VC 管理器

---

## async ensureTables()

```javascript
async ensureTables()
```

* 确保数据库表存在

---

## async createCredential(params)

```javascript
async createCredential(params)
```

* 创建可验证凭证
   * @param {Object} params - 凭证参数
   * @param {string} params.type - 凭证类型
   * @param {string} params.issuerDID - 颁发者 DID
   * @param {string} params.subjectDID - 主体 DID
   * @param {Object} params.claims - 声明数据
   * @param {number} params.expiresIn - 有效期（毫秒，可选）
   * @returns {Promise<Object>} 创建的 VC

---

## async signCredential(vcDocument, issuerIdentity)

```javascript
async signCredential(vcDocument, issuerIdentity)
```

* 签名 VC 文档
   * @param {Object} vcDocument - VC 文档
   * @param {Object} issuerIdentity - 颁发者身份
   * @returns {Object} 签名后的 VC 文档

---

## async verifyCredential(signedVC)

```javascript
async verifyCredential(signedVC)
```

* 验证 VC 文档签名
   * @param {Object} signedVC - 签名的 VC 文档
   * @returns {Promise<boolean>} 验证结果

---

## async saveCredential(vcRecord)

```javascript
async saveCredential(vcRecord)
```

* 保存凭证到数据库
   * @param {Object} vcRecord - 凭证记录

---

## getCredentials(filters =

```javascript
getCredentials(filters =
```

* 获取所有凭证
   * @param {Object} filters - 过滤条件
   * @returns {Array} 凭证列表

---

## getCredentialById(id)

```javascript
getCredentialById(id)
```

* 根据 ID 获取凭证
   * @param {string} id - 凭证 ID
   * @returns {Object|null} 凭证对象

---

## async revokeCredential(id, issuerDID)

```javascript
async revokeCredential(id, issuerDID)
```

* 撤销凭证
   * @param {string} id - 凭证 ID
   * @param {string} issuerDID - 颁发者 DID（用于验证权限）
   * @returns {Promise<boolean>} 操作结果

---

## async deleteCredential(id)

```javascript
async deleteCredential(id)
```

* 删除凭证
   * @param {string} id - 凭证 ID
   * @returns {Promise<boolean>} 操作结果

---

## exportCredential(id)

```javascript
exportCredential(id)
```

* 导出凭证文档
   * @param {string} id - 凭证 ID
   * @returns {Object} VC 文档

---

## getStatistics(did = null)

```javascript
getStatistics(did = null)
```

* 获取统计信息
   * @param {string} did - DID（可选，用于筛选）
   * @returns {Object} 统计信息

---

## async generateShareData(id)

```javascript
async generateShareData(id)
```

* 生成凭证分享数据
   * @param {string} id - 凭证 ID
   * @returns {Promise<Object>} 分享数据（包含二维码数据）

---

## async importFromShareData(shareData)

```javascript
async importFromShareData(shareData)
```

* 从分享数据导入凭证
   * @param {Object} shareData - 分享数据
   * @returns {Promise<Object>} 导入的凭证

---

## async close()

```javascript
async close()
```

* 关闭管理器

---

