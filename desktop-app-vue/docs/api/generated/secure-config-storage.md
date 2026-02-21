# secure-config-storage

**Source**: `src/main/llm/secure-config-storage.js`

**Generated**: 2026-02-21T20:04:16.239Z

---

## const

```javascript
const
```

* 安全配置存储模块
 *
 * 提供三层加密策略：
 * 1. Electron safeStorage (操作系统凭证存储 - 最安全)
 * 2. AES-256-GCM + 机器特征派生密钥 (后备方案)
 * 3. 基于密码的加密 (用于导出/迁移)
 *
 * @module secure-config-storage

---

## const SENSITIVE_FIELDS = [

```javascript
const SENSITIVE_FIELDS = [
```

* 敏感配置字段列表 - 支持14+个LLM提供商

---

## const API_KEY_PATTERNS =

```javascript
const API_KEY_PATTERNS =
```

* API Key 格式验证规则

---

## class SecureConfigStorage

```javascript
class SecureConfigStorage
```

* 安全配置存储类
 *
 * 使用策略模式支持多种加密后端：
 * - safeStorage: Electron原生，使用操作系统凭证管理器
 * - fallback: 基于机器特征的AES-256-GCM加密

---

## _checkSafeStorageAvailability()

```javascript
_checkSafeStorageAvailability()
```

* 检查 Electron safeStorage 是否可用
   * @private

---

## _getDefaultStoragePath()

```javascript
_getDefaultStoragePath()
```

* 获取默认存储路径
   * @private

---

## _getBackupDir()

```javascript
_getBackupDir()
```

* 获取备份目录路径
   * @private

---

## _getMachineKeySeed()

```javascript
_getMachineKeySeed()
```

* 获取机器特定的密钥种子
   * @private

---

## _deriveKey(salt)

```javascript
_deriveKey(salt)
```

* 从机器种子派生加密密钥
   * @private

---

## _encryptWithSafeStorage(data)

```javascript
_encryptWithSafeStorage(data)
```

* 使用 safeStorage 加密数据
   * @private

---

## _decryptWithSafeStorage(encryptedData)

```javascript
_decryptWithSafeStorage(encryptedData)
```

* 使用 safeStorage 解密数据
   * @private

---

## _encryptWithAES(data)

```javascript
_encryptWithAES(data)
```

* 使用 AES-256-GCM 加密数据（后备方案）
   * @private

---

## _decryptWithAES(encryptedData)

```javascript
_decryptWithAES(encryptedData)
```

* 使用 AES-256-GCM 解密数据
   * @private

---

## _getEncryptionType(data)

```javascript
_getEncryptionType(data)
```

* 判断加密方式
   * @private

---

## encrypt(data)

```javascript
encrypt(data)
```

* 加密数据
   * @param {Object} data - 要加密的数据对象
   * @returns {Buffer} 加密后的数据

---

## decrypt(encryptedData)

```javascript
decrypt(encryptedData)
```

* 解密数据
   * @param {Buffer} encryptedData - 加密的数据
   * @returns {Object} 解密后的数据对象

---

## _decryptLegacy(encryptedData)

```javascript
_decryptLegacy(encryptedData)
```

* 解密旧版本格式
   * @private

---

## save(config)

```javascript
save(config)
```

* 保存加密配置
   * @param {Object} config - 配置对象
   * @returns {boolean} 是否成功

---

## load(useCache = true)

```javascript
load(useCache = true)
```

* 加载加密配置
   * @param {boolean} useCache - 是否使用缓存
   * @returns {Object|null} 配置对象或 null

---

## exists()

```javascript
exists()
```

* 检查是否存在加密配置
   * @returns {boolean}

---

## delete()

```javascript
delete()
```

* 删除加密配置
   * @returns {boolean}

---

## createBackup()

```javascript
createBackup()
```

* 创建备份
   * @returns {string|null} 备份文件路径或 null

---

## restoreFromBackup(backupPath)

```javascript
restoreFromBackup(backupPath)
```

* 从备份恢复
   * @param {string} backupPath - 备份文件路径
   * @returns {boolean}

---

## listBackups()

```javascript
listBackups()
```

* 列出所有备份
   * @returns {Array<{path: string, date: Date, size: number}>}

---

## exportWithPassword(password, exportPath)

```javascript
exportWithPassword(password, exportPath)
```

* 导出配置（使用密码加密）
   * @param {string} password - 导出密码
   * @param {string} exportPath - 导出文件路径
   * @returns {boolean}

---

## importWithPassword(password, importPath)

```javascript
importWithPassword(password, importPath)
```

* 导入配置（使用密码解密）
   * @param {string} password - 导入密码
   * @param {string} importPath - 导入文件路径
   * @returns {boolean}

---

## getStorageInfo()

```javascript
getStorageInfo()
```

* 获取存储信息
   * @returns {Object}

---

## migrateToSafeStorage()

```javascript
migrateToSafeStorage()
```

* 迁移到更安全的加密方式
   * @returns {boolean}

---

## clearCache()

```javascript
clearCache()
```

* 清除缓存

---

## function validateApiKeyFormat(provider, apiKey)

```javascript
function validateApiKeyFormat(provider, apiKey)
```

* 验证 API Key 格式
 * @param {string} provider - 提供商名称
 * @param {string} apiKey - API Key
 * @returns {{valid: boolean, message?: string}}

---

## function extractSensitiveFields(config)

```javascript
function extractSensitiveFields(config)
```

* 从配置对象中提取敏感字段
 * @param {Object} config - 完整配置
 * @returns {Object} 敏感字段

---

## function mergeSensitiveFields(config, sensitive)

```javascript
function mergeSensitiveFields(config, sensitive)
```

* 将敏感字段合并回配置对象
 * @param {Object} config - 配置对象（会被修改）
 * @param {Object} sensitive - 敏感字段

---

## function sanitizeConfig(config)

```javascript
function sanitizeConfig(config)
```

* 从配置对象中移除敏感字段（替换为占位符）
 * @param {Object} config - 配置对象
 * @returns {Object} 脱敏后的配置

---

## function isSensitiveField(fieldPath)

```javascript
function isSensitiveField(fieldPath)
```

* 检查字段是否为敏感字段
 * @param {string} fieldPath - 字段路径
 * @returns {boolean}

---

## function getProviderSensitiveFields(provider)

```javascript
function getProviderSensitiveFields(provider)
```

* 获取提供商的敏感字段列表
 * @param {string} provider - 提供商名称
 * @returns {string[]}

---

## function getSecureConfigStorage()

```javascript
function getSecureConfigStorage()
```

* 获取安全配置存储单例
 * @returns {SecureConfigStorage}

---

## function resetInstance()

```javascript
function resetInstance()
```

* 重置单例（仅用于测试）

---

