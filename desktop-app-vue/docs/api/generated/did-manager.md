# did-manager

**Source**: `src/main/did/did-manager.js`

**Generated**: 2026-02-22T01:23:36.735Z

---

## const

```javascript
const
```

* DID (Decentralized Identity) 管理器
 *
 * 实现 W3C DID Core 标准
 * DID 格式: did:chainlesschain:<identifier>

---

## const DEFAULT_CONFIG =

```javascript
const DEFAULT_CONFIG =
```

* DID 配置

---

## class DIDManager extends EventEmitter

```javascript
class DIDManager extends EventEmitter
```

* DID 管理器类

---

## setP2PManager(p2pManager)

```javascript
setP2PManager(p2pManager)
```

* 设置 P2P 管理器（用于延迟初始化）
   * @param {Object} p2pManager - P2P 管理器实例

---

## async initialize()

```javascript
async initialize()
```

* 初始化 DID 管理器

---

## async ensureTables()

```javascript
async ensureTables()
```

* 确保数据库表存在

---

## async createIdentity(profile =

```javascript
async createIdentity(profile =
```

* 生成新的 DID 身份
   * @param {Object} profile - 用户资料 { nickname, bio, avatar }
   * @param {Object} options - 选项 { setAsDefault }
   * @returns {Promise<Object>} DID 身份对象

---

## async createOrganizationDID(orgId, orgName)

```javascript
async createOrganizationDID(orgId, orgName)
```

* 为组织创建 DID
   * @param {string} orgId - 组织ID
   * @param {string} orgName - 组织名称
   * @returns {Promise<string>} 组织DID

---

## generateDID(publicKey, prefix = null)

```javascript
generateDID(publicKey, prefix = null)
```

* 生成 DID 标识符
   * @param {Uint8Array} publicKey - 公钥
   * @param {string} prefix - 可选前缀（例如 'org' 用于组织）
   * @returns {string} DID 标识符

---

## createDIDDocument(did, keys)

```javascript
createDIDDocument(did, keys)
```

* 创建 DID 文档
   * @param {string} did - DID 标识符
   * @param {Object} keys - 密钥信息
   * @returns {Object} DID 文档

---

## signDIDDocument(document, secretKey)

```javascript
signDIDDocument(document, secretKey)
```

* 签名 DID 文档
   * @param {Object} document - DID 文档
   * @param {Uint8Array} secretKey - 私钥
   * @returns {Object} 签名后的 DID 文档

---

## verifyDIDDocument(signedDocument)

```javascript
verifyDIDDocument(signedDocument)
```

* 验证 DID 文档签名
   * @param {Object} signedDocument - 签名的 DID 文档
   * @returns {boolean} 验证结果

---

## async saveIdentity(identity)

```javascript
async saveIdentity(identity)
```

* 保存身份到数据库
   * @param {Object} identity - 身份对象

---

## getAllIdentities()

```javascript
getAllIdentities()
```

* 获取所有身份
   * @returns {Array} 身份列表

---

## getIdentityByDID(did)

```javascript
getIdentityByDID(did)
```

* 根据 DID 获取身份
   * @param {string} did - DID 标识符
   * @returns {Object|null} 身份对象

---

## async setDefaultIdentity(did)

```javascript
async setDefaultIdentity(did)
```

* 设置默认身份
   * @param {string} did - DID 标识符

---

## async loadDefaultIdentity()

```javascript
async loadDefaultIdentity()
```

* 加载默认身份

---

## async updateIdentityProfile(did, updates)

```javascript
async updateIdentityProfile(did, updates)
```

* 更新身份资料
   * @param {string} did - DID 标识符
   * @param {Object} updates - 更新内容 { nickname, bio, avatar }

---

## async deleteIdentity(did)

```javascript
async deleteIdentity(did)
```

* 删除身份
   * @param {string} did - DID 标识符

---

## exportDIDDocument(did)

```javascript
exportDIDDocument(did)
```

* 导出 DID 文档
   * @param {string} did - DID 标识符
   * @returns {Object} DID 文档

---

## generateQRCodeData(did)

```javascript
generateQRCodeData(did)
```

* 生成 DID 二维码数据
   * @param {string} did - DID 标识符
   * @returns {string} 二维码数据（JSON 字符串）

---

## getCurrentIdentity()

```javascript
getCurrentIdentity()
```

* 获取当前身份
   * @returns {Object|null} 当前身份

---

## async publishToDHT(did)

```javascript
async publishToDHT(did)
```

* 发布 DID 文档到 DHT 网络
   * @param {string} did - DID 标识符
   * @returns {Promise<Object>} 发布结果 { success, key, publishedAt }

---

## async resolveFromDHT(did)

```javascript
async resolveFromDHT(did)
```

* 从 DHT 网络解析 DID 文档
   * @param {string} did - DID 标识符
   * @returns {Promise<Object>} DID 文档数据

---

## async unpublishFromDHT(did)

```javascript
async unpublishFromDHT(did)
```

* 从 DHT 网络取消发布 DID
   * @param {string} did - DID 标识符
   * @returns {Promise<Object>} 取消发布结果

---

## async isPublishedToDHT(did)

```javascript
async isPublishedToDHT(did)
```

* 检查 DID 是否已发布到 DHT
   * @param {string} did - DID 标识符
   * @returns {Promise<boolean>} 是否已发布

---

## startAutoRepublish(interval = null)

```javascript
startAutoRepublish(interval = null)
```

* 启动自动重新发布
   * @param {number} interval - 重新发布间隔（毫秒），默认 24 小时

---

## stopAutoRepublish()

```javascript
stopAutoRepublish()
```

* 停止自动重新发布

---

## async republishAllDIDs()

```javascript
async republishAllDIDs()
```

* 重新发布所有已发布的 DID
   * @returns {Promise<Object>} 重新发布结果

---

## getAutoRepublishStatus()

```javascript
getAutoRepublishStatus()
```

* 获取自动重新发布状态
   * @returns {Object} 状态信息

---

## setAutoRepublishInterval(interval)

```javascript
setAutoRepublishInterval(interval)
```

* 设置自动重新发布间隔
   * @param {number} interval - 间隔（毫秒）

---

## generateMnemonic(strength = 256)

```javascript
generateMnemonic(strength = 256)
```

* 生成助记词
   * @param {number} strength - 强度（默认 256 位，24 个单词）
   * @returns {string} 助记词

---

## validateMnemonic(mnemonic)

```javascript
validateMnemonic(mnemonic)
```

* 验证助记词
   * @param {string} mnemonic - 助记词
   * @returns {boolean} 是否有效

---

## deriveKeysFromMnemonic(mnemonic, index = 0)

```javascript
deriveKeysFromMnemonic(mnemonic, index = 0)
```

* 从助记词派生密钥对
   * @param {string} mnemonic - 助记词
   * @param {number} index - 派生索引（默认 0）
   * @returns {Object} 密钥对

---

## async createIdentityFromMnemonic(profile, mnemonic, options =

```javascript
async createIdentityFromMnemonic(profile, mnemonic, options =
```

* 使用助记词创建身份
   * @param {Object} profile - 身份资料
   * @param {string} mnemonic - 助记词
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 创建的身份

---

## exportMnemonic(did)

```javascript
exportMnemonic(did)
```

* 从身份导出助记词
   * @param {string} did - DID 标识符
   * @returns {string|null} 助记词（如果存在）

---

## hasMnemonic(did)

```javascript
hasMnemonic(did)
```

* 检查身份是否有助记词备份
   * @param {string} did - DID 标识符
   * @returns {boolean} 是否有助记词

---

## async close()

```javascript
async close()
```

* 关闭管理器

---

