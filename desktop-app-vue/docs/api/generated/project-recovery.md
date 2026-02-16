# project-recovery

**Source**: `src/main/sync/project-recovery.js`

**Generated**: 2026-02-16T22:06:51.421Z

---

## class ProjectRecovery

```javascript
class ProjectRecovery
```

* 项目恢复工具
 * 用于恢复被同步逻辑错误标记为删除的项目

---

## scanRecoverableProjects()

```javascript
scanRecoverableProjects()
```

* 扫描被标记为删除但应该恢复的项目
   * @returns {Array} 可恢复的项目列表

---

## recoverProject(projectId)

```javascript
recoverProject(projectId)
```

* 恢复单个项目
   * @param {string} projectId - 项目ID
   * @returns {boolean} 是否成功

---

## recoverProjects(projectIds)

```javascript
recoverProjects(projectIds)
```

* 批量恢复项目
   * @param {Array<string>} projectIds - 项目ID数组
   * @returns {Object} 恢复结果

---

## autoRecoverAll()

```javascript
autoRecoverAll()
```

* 自动恢复所有可恢复的项目
   * @returns {Object} 恢复结果

---

## getRecoveryStats()

```javascript
getRecoveryStats()
```

* 获取恢复统计信息
   * @returns {Object} 统计信息

---

