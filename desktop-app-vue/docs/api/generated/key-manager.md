# key-manager

**Source**: `src/main/database/key-manager.js`

**Generated**: 2026-02-16T22:06:51.490Z

---

## const

```javascript
const
```

* 数据库加密密钥管理器
 *
 * 负责生成、派生和管理数据库加密密钥
 * 支持U-Key硬件密钥派生和密码派生两种模式

---

## const KEY_DERIVATION_CONFIG =

```javascript
const KEY_DERIVATION_CONFIG =
```

* 密钥派生配置

---

## class KeyManager

```javascript
class KeyManager
```

* 密钥管理器类

---

## async initialize()

```javascript
async initialize()
```

* 初始化密钥管理器

---

## isEncryptionEnabled()

```javascript
isEncryptionEnabled()
```

* 检查是否启用了加密

---

## hasUKey()

```javascript
hasUKey()
```

* 检查是否有可用的U-Key

---

## async deriveKeyFromUKey(pin)

```javascript
async deriveKeyFromUKey(pin)
```

* 使用U-Key派生数据库加密密钥
   * @param {string} pin - U-Key PIN码
   * @returns {Promise<string>} 十六进制格式的加密密钥

---

## async deriveKeyFromPassword(password, salt = null)

```javascript
async deriveKeyFromPassword(password, salt = null)
```

* 使用密码派生数据库加密密钥
   * @param {string} password - 用户密码
   * @param {Buffer} [salt] - 盐值，如果不提供则生成新的
   * @returns {Promise<{key: string, salt: string}>} 密钥和盐值（十六进制）

---

## async getOrCreateKey(options =

```javascript
async getOrCreateKey(options =
```

* 获取或生成数据库加密密钥
   * @param {Object} options - 选项
   * @param {string} options.password - 密码（密码模式必需）
   * @param {string} options.pin - U-Key PIN码（U-Key模式必需）
   * @param {string} options.salt - 盐值（密码模式，已有数据库时必需）
   * @param {boolean} options.forcePassword - 强制使用密码模式
   * @returns {Promise<{key: string, salt?: string, method: string}>}

---

## clearKeyCache()

```javascript
clearKeyCache()
```

* 清除缓存的密钥

---

## async saveKeyMetadata(metadata)

```javascript
async saveKeyMetadata(metadata)
```

* 保存密钥元数据（不包含密钥本身）
   * @param {Object} metadata - 元数据

---

## loadKeyMetadata()

```javascript
loadKeyMetadata()
```

* 加载密钥元数据
   * @returns {Object|null}

---

## async close()

```javascript
async close()
```

* 关闭密钥管理器

---

