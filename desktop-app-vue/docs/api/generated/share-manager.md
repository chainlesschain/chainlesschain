# share-manager

**Source**: `src/main/project/share-manager.js`

**Generated**: 2026-02-21T20:04:16.219Z

---

## const

```javascript
const
```

* 项目分享管理器
 * 负责项目分享功能的创建、查询、更新和删除

---

## async createOrUpdateShare(projectId, shareMode, options =

```javascript
async createOrUpdateShare(projectId, shareMode, options =
```

* 创建或更新项目分享
   * @param {string} projectId - 项目ID
   * @param {string} shareMode - 分享模式 ('private' | 'public')
   * @param {Object} options - 可选配置
   * @returns {Object} 分享信息

---

## generateShareToken()

```javascript
generateShareToken()
```

* 生成分享token
   * @returns {string} 随机token

---

## generateShareLink(token)

```javascript
generateShareLink(token)
```

* 生成分享链接
   * @param {string} token - 分享token
   * @returns {string} 分享链接

---

## getShareByProjectId(projectId)

```javascript
getShareByProjectId(projectId)
```

* 根据项目ID获取分享信息
   * @param {string} projectId - 项目ID
   * @returns {Object|null} 分享信息

---

## getShareByToken(token)

```javascript
getShareByToken(token)
```

* 根据token获取分享信息
   * @param {string} token - 分享token
   * @returns {Object|null} 分享信息

---

## incrementAccessCount(token)

```javascript
incrementAccessCount(token)
```

* 增加访问计数
   * @param {string} token - 分享token
   * @returns {boolean} 是否成功

---

## deleteShare(projectId)

```javascript
deleteShare(projectId)
```

* 删除项目分享
   * @param {string} projectId - 项目ID
   * @returns {boolean} 是否成功

---

## getPublicShares(options =

```javascript
getPublicShares(options =
```

* 获取所有公开分享的项目
   * @param {Object} options - 查询选项
   * @returns {Array} 分享列表

---

## getShareStats(projectId)

```javascript
getShareStats(projectId)
```

* 获取分享统计
   * @param {string} projectId - 项目ID
   * @returns {Object} 统计信息

---

## cleanExpiredShares()

```javascript
cleanExpiredShares()
```

* 清理过期的分享
   * @returns {number} 清理数量

---

## function getShareManager(database)

```javascript
function getShareManager(database)
```

* 获取分享管理器实例
 * @param {Object} database - 数据库实例
 * @returns {ShareManager}

---

