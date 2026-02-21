# user-profile-manager

**Source**: `src/main/ai-engine/user-profile-manager.js`

**Generated**: 2026-02-21T20:04:16.278Z

---

## class LRUCache

```javascript
class LRUCache
```

* UserProfileManager - 用户画像管理器
 * P2智能层用户画像系统
 *
 * 功能:
 * - 用户画像CRUD操作
 * - 技能水平评估
 * - 偏好提取与分析
 * - 时间模式识别
 * - 自动画像更新
 * - LRU缓存优化
 *
 * Version: v0.21.0
 * Date: 2026-01-02

---

## class LRUCache

```javascript
class LRUCache
```

* 简单LRU缓存实现

---

## setDatabase(db)

```javascript
setDatabase(db)
```

* 设置数据库连接

---

## async getProfile(userId)

```javascript
async getProfile(userId)
```

* 获取用户画像
   * @param {string} userId - 用户ID
   * @returns {Object} 用户画像对象

---

## async loadProfileFromDB(userId)

```javascript
async loadProfileFromDB(userId)
```

* 从数据库加载用户画像

---

## async buildNewProfile(userId)

```javascript
async buildNewProfile(userId)
```

* 构建新用户画像

---

## createDefaultProfile(userId)

```javascript
createDefaultProfile(userId)
```

* 创建默认画像

---

## async loadUserHistory(userId)

```javascript
async loadUserHistory(userId)
```

* 加载用户历史数据

---

## assessSkillLevel(history)

```javascript
assessSkillLevel(history)
```

* 评估技能水平

---

## assessDomainSkills(history)

```javascript
assessDomainSkills(history)
```

* 评估领域技能

---

## extractPreferences(history)

```javascript
extractPreferences(history)
```

* 提取用户偏好

---

## calculateStatistics(history)

```javascript
calculateStatistics(history)
```

* 计算统计信息

---

## analyzeTemporalPatterns(history)

```javascript
analyzeTemporalPatterns(history)
```

* 分析时间模式

---

## async saveProfile(profile)

```javascript
async saveProfile(profile)
```

* 保存用户画像

---

## async updateProfile(userId, newData)

```javascript
async updateProfile(userId, newData)
```

* 更新用户画像（增量更新）

---

## async reassessProfile(userId)

```javascript
async reassessProfile(userId)
```

* 重新评估用户画像（基于最新历史数据）

---

## getStats()

```javascript
getStats()
```

* 获取统计信息

---

## async cleanup()

```javascript
async cleanup()
```

* 清理资源

---

