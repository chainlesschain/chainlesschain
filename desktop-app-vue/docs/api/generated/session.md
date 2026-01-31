# session

**Source**: `src\renderer\stores\session.js`

**Generated**: 2026-01-27T06:44:03.890Z

---

## import

```javascript
import
```

* Session Store - Pinia 状态管理
 * 管理会话列表、当前会话、标签、模板等状态
 *
 * @module session-store
 * @version 1.0.0
 * @since 2026-01-17

---

## filteredSessions: (state) =>

```javascript
filteredSessions: (state) =>
```

* 根据筛选条件过滤后的会话列表

---

## hasSelectedSessions: (state) =>

```javascript
hasSelectedSessions: (state) =>
```

* 是否有选中的会话

---

## selectedCount: (state) =>

```javascript
selectedCount: (state) =>
```

* 选中的会话数量

---

## hasCurrentSession: (state) =>

```javascript
hasCurrentSession: (state) =>
```

* 当前会话是否已加载

---

## currentMessages: (state) =>

```javascript
currentMessages: (state) =>
```

* 获取当前会话的消息列表

---

## currentTags: (state) =>

```javascript
currentTags: (state) =>
```

* 获取当前会话的标签

---

## isLoading: (state) =>

```javascript
isLoading: (state) =>
```

* 是否正在加载

---

## async loadSessions(options =

```javascript
async loadSessions(options =
```

* 加载会话列表

---

## async searchSessions(query, options =

```javascript
async searchSessions(query, options =
```

* 搜索会话

---

## async findByTags(tags, options =

```javascript
async findByTags(tags, options =
```

* 按标签查找会话

---

## async loadSessionDetail(sessionId)

```javascript
async loadSessionDetail(sessionId)
```

* 加载会话详情

---

## async deleteSession(sessionId)

```javascript
async deleteSession(sessionId)
```

* 删除会话

---

## async deleteMultiple(sessionIds)

```javascript
async deleteMultiple(sessionIds)
```

* 批量删除会话

---

## async addTags(sessionId, tags)

```javascript
async addTags(sessionId, tags)
```

* 添加标签到会话

---

## async removeTags(sessionId, tags)

```javascript
async removeTags(sessionId, tags)
```

* 移除会话标签

---

## async addTagsToMultiple(sessionIds, tags)

```javascript
async addTagsToMultiple(sessionIds, tags)
```

* 批量添加标签

---

## async loadAllTags()

```javascript
async loadAllTags()
```

* 加载所有标签

---

## async exportToJSON(sessionId, options =

```javascript
async exportToJSON(sessionId, options =
```

* 导出会话为 JSON

---

## async exportToMarkdown(sessionId, options =

```javascript
async exportToMarkdown(sessionId, options =
```

* 导出会话为 Markdown

---

## async exportMultiple(sessionIds, options =

```javascript
async exportMultiple(sessionIds, options =
```

* 批量导出会话

---

## async importFromJSON(jsonData, options =

```javascript
async importFromJSON(jsonData, options =
```

* 从 JSON 导入会话

---

## async generateSummary(sessionId, options =

```javascript
async generateSummary(sessionId, options =
```

* 生成会话摘要

---

## async resumeSession(sessionId, options =

```javascript
async resumeSession(sessionId, options =
```

* 恢复会话

---

## async saveAsTemplate(sessionId, templateInfo)

```javascript
async saveAsTemplate(sessionId, templateInfo)
```

* 保存为模板

---

## async createFromTemplate(templateId, options =

```javascript
async createFromTemplate(templateId, options =
```

* 从模板创建会话

---

## async loadTemplates(options =

```javascript
async loadTemplates(options =
```

* 加载模板列表

---

## async deleteTemplate(templateId)

```javascript
async deleteTemplate(templateId)
```

* 删除模板

---

## async loadGlobalStats()

```javascript
async loadGlobalStats()
```

* 加载全局统计

---

## async updateTitle(sessionId, title)

```javascript
async updateTitle(sessionId, title)
```

* 更新会话标题

---

## async duplicateSession(sessionId, options =

```javascript
async duplicateSession(sessionId, options =
```

* 复制会话

---

## async renameTag(oldTag, newTag)

```javascript
async renameTag(oldTag, newTag)
```

* 重命名标签

---

## async mergeTags(sourceTags, targetTag)

```javascript
async mergeTags(sourceTags, targetTag)
```

* 合并标签

---

## async deleteTag(tag)

```javascript
async deleteTag(tag)
```

* 删除标签

---

## async deleteTags(tags)

```javascript
async deleteTags(tags)
```

* 批量删除标签

---

## async getTagDetails(tag, options =

```javascript
async getTagDetails(tag, options =
```

* 获取标签详情

---

## setFilters(filters)

```javascript
setFilters(filters)
```

* 设置筛选条件

---

## clearFilters()

```javascript
clearFilters()
```

* 清空筛选条件

---

## selectSession(sessionId)

```javascript
selectSession(sessionId)
```

* 选中会话

---

## deselectSession(sessionId)

```javascript
deselectSession(sessionId)
```

* 取消选中会话

---

## toggleSelection(sessionId)

```javascript
toggleSelection(sessionId)
```

* 切换会话选中状态

---

## selectAll()

```javascript
selectAll()
```

* 全选

---

## deselectAll()

```javascript
deselectAll()
```

* 全不选

---

## setCurrentSession(session)

```javascript
setCurrentSession(session)
```

* 设置当前会话

---

## clearCurrentSession()

```javascript
clearCurrentSession()
```

* 清空当前会话

---

## clearError()

```javascript
clearError()
```

* 清空错误

---

## reset()

```javascript
reset()
```

* 重置状态

---

