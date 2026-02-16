# database

**Source**: `src/main/database.js`

**Generated**: 2026-02-16T13:44:34.594Z

---

## class DatabaseManager

```javascript
class DatabaseManager
```

* 数据库管理类
 * 使用 SQLCipher（加密）或 sql.js 管理本地 SQLite 数据库

---

## initializeQueryCache()

```javascript
initializeQueryCache()
```

* 初始化查询缓存（LRU策略）

---

## getPreparedStatement(sql)

```javascript
getPreparedStatement(sql)
```

* 获取或创建 Prepared Statement
   * @param {string} sql - SQL语句
   * @returns {Statement} Prepared statement

---

## clearPreparedStatements()

```javascript
clearPreparedStatements()
```

* 清除所有 Prepared Statements（用于数据库重置）

---

## async initialize()

```javascript
async initialize()
```

* 初始化数据库

---

## async initializeWithBetterSQLite()

```javascript
async initializeWithBetterSQLite()
```

* 使用 Better-SQLite3 初始化（开发模式）

---

## async initializeWithAdapter()

```javascript
async initializeWithAdapter()
```

* 使用数据库适配器初始化（支持加密）

---

## async initializeWithSqlJs()

```javascript
async initializeWithSqlJs()
```

* 使用 sql.js 初始化（传统方式）

---

## applyStatementCompat()

```javascript
applyStatementCompat()
```

* Add better-sqlite style helpers to sql.js statements.

---

## saveToFile()

```javascript
saveToFile()
```

* 保存数据库到文件

---

## createTables()

```javascript
createTables()
```

* 创建数据库表

---

## ensureTaskBoardOwnerSchema()

```javascript
ensureTaskBoardOwnerSchema()
```

* Ensure task_boards has required columns and related indexes.

---

## migrateDatabase()

```javascript
migrateDatabase()
```

* 数据库迁移：为已存在的表添加新列

---

## runMigrationsOptimized()

```javascript
runMigrationsOptimized()
```

* 运行数据库迁移（优化版）- 使用版本跟踪跳过不必要的迁移

---

## runMigrations()

```javascript
runMigrations()
```

* 运行数据库迁移 - 增量更新数据库结构

---

## checkIfTableNeedsRebuild(tableName, testCategoryValue)

```javascript
checkIfTableNeedsRebuild(tableName, testCategoryValue)
```

* 检查表是否需要重建（通过测试category值）

---

## rebuildProjectsTable()

```javascript
rebuildProjectsTable()
```

* 重建projects表（更新CHECK约束）

---

## rebuildProjectTemplatesTable()

```javascript
rebuildProjectTemplatesTable()
```

* 重建project_templates表（更新CHECK约束）

---

## checkColumnExists(tableName, columnName)

```javascript
checkColumnExists(tableName, columnName)
```

* 检查列是否存在

---

## getKnowledgeItems(limit = 100, offset = 0)

```javascript
getKnowledgeItems(limit = 100, offset = 0)
```

* 获取所有知识库项
   * @param {number} limit - 限制数量
   * @param {number} offset - 偏移量
   * @returns {Array} 知识库项列表

---

## getKnowledgeItemById(id)

```javascript
getKnowledgeItemById(id)
```

* 根据ID获取知识库项
   * @param {string} id - 项目ID
   * @returns {Object|null} 知识库项

---

## getKnowledgeItem(id)

```javascript
getKnowledgeItem(id)
```

* 根据ID获取知识库项（别名）
   * @param {string} id - 项目ID
   * @returns {Object|null} 知识库项

---

## getKnowledgeItemByTitle(title)

```javascript
getKnowledgeItemByTitle(title)
```

* 根据标题获取知识库项
   * @param {string} title - 标题
   * @returns {Object|null} 知识库项

---

## getAllKnowledgeItems()

```javascript
getAllKnowledgeItems()
```

* 获取所有知识库项（无限制）
   * @returns {Array} 知识库项列表

---

## addKnowledgeItem(item)

```javascript
addKnowledgeItem(item)
```

* 添加知识库项
   * @param {Object} item - 知识库项数据
   * @returns {Object} 创建的项目

---

## updateKnowledgeItem(id, updates)

```javascript
updateKnowledgeItem(id, updates)
```

* 更新知识库项
   * @param {string} id - 项目ID
   * @param {Object} updates - 更新数据
   * @returns {Object|null} 更新后的项目

---

## deleteKnowledgeItem(id)

```javascript
deleteKnowledgeItem(id)
```

* 删除知识库项
   * @param {string} id - 项目ID
   * @returns {boolean} 是否删除成功

---

## searchKnowledge(query)

```javascript
searchKnowledge(query)
```

* 搜索知识库项
   * @param {string} query - 搜索关键词
   * @returns {Array} 搜索结果

---

## updateSearchIndex(id, title, content)

```javascript
updateSearchIndex(id, title, content)
```

* 更新搜索索引
   * @param {string} id - 项目ID
   * @param {string} title - 标题
   * @param {string} content - 内容

---

## getAllTags()

```javascript
getAllTags()
```

* 获取所有标签
   * @returns {Array} 标签列表

---

## createTag(name, color = "#1890ff")

```javascript
createTag(name, color = "#1890ff")
```

* 创建标签
   * @param {string} name - 标签名
   * @param {string} color - 颜色
   * @returns {Object} 创建的标签

---

## addTagToKnowledge(knowledgeId, tagId)

```javascript
addTagToKnowledge(knowledgeId, tagId)
```

* 为知识库项添加标签
   * @param {string} knowledgeId - 知识库项ID
   * @param {string} tagId - 标签ID

---

## getKnowledgeTags(knowledgeId)

```javascript
getKnowledgeTags(knowledgeId)
```

* 获取知识库项的标签
   * @param {string} knowledgeId - 知识库项ID
   * @returns {Array} 标签列表

---

## getStatistics()

```javascript
getStatistics()
```

* 获取统计数据
   * @returns {Object} 统计信息

---

## generateId()

```javascript
generateId()
```

* Generate a unique ID
   * @returns {string} UUID

---

## trackQueryPerformance(queryName, duration, sql, params = [])

```javascript
trackQueryPerformance(queryName, duration, sql, params = [])
```

* Track query performance and log slow queries
   * @param {string} queryName - Name of the query operation
   * @param {number} duration - Query execution time in milliseconds
   * @param {string} sql - SQL query string
   * @param {Array|Object} params - Query parameters

---

## normalizeParams(params)

```javascript
normalizeParams(params)
```

* Normalize SQL params to avoid undefined values and special number types.
   * @param {Array|Object|null|undefined} params
   * @returns {Array|Object|null|undefined}

---

## run(sql, params = [])

```javascript
run(sql, params = [])
```

* Execute a write statement (DDL/DML) and persist changes.
   * @param {string} sql
   * @param {Array|Object} params

---

## get(sql, params = [])

```javascript
get(sql, params = [])
```

* Fetch a single row as an object.
   * @param {string} sql
   * @param {Array|Object} params
   * @returns {Object|null}

---

## all(sql, params = [])

```javascript
all(sql, params = [])
```

* Fetch all rows as objects.
   * @param {string} sql
   * @param {Array|Object} params
   * @returns {Array}

---

## exec(sql)

```javascript
exec(sql)
```

* Execute SQL and return raw results (for DDL or queries)
   * @param {string} sql - SQL statement
   * @returns {Array} Raw query results

---

## getDatabase()

```javascript
getDatabase()
```

* Get the underlying database instance
   * @returns {Object} Database instance

---

## prepare(sql)

```javascript
prepare(sql)
```

* Prepare a SQL statement
   * @param {string} sql - SQL statement
   * @returns {Object} Prepared statement

---

## transaction(callback)

```javascript
transaction(callback)
```

* 执行事务
   * @param {Function} callback - 事务回调

---

## updateSyncStatus(tableName, recordId, status, syncedAt)

```javascript
updateSyncStatus(tableName, recordId, status, syncedAt)
```

* 更新单条记录的同步状态
   * 每条记录独立事务，与后端保持一致
   * @param {string} tableName - 表名
   * @param {string} recordId - 记录ID
   * @param {string} status - 同步状态 ('pending'|'synced'|'conflict'|'error')
   * @param {number|null} syncedAt - 同步时间戳（毫秒），null表示清除
   * @returns {boolean} 是否更新成功

---

## batchUpdateSyncStatus(tableName, updates)

```javascript
batchUpdateSyncStatus(tableName, updates)
```

* 批量更新同步状态（仅用于明确的批量操作场景）
   * @param {string} tableName - 表名
   * @param {Array<{id: string, status: string, syncedAt: number}>} updates - 更新列表
   * @returns {Object} 更新结果统计 {success: number, failed: number}

---

## close()

```javascript
close()
```

* 关闭数据库连接

---

## async switchDatabase(newDbPath, options =

```javascript
async switchDatabase(newDbPath, options =
```

* 切换到另一个数据库文件
   * @param {string} newDbPath - 新数据库文件的路径
   * @param {Object} options - 选项（password, encryptionEnabled）
   * @returns {Promise<boolean>} 切换是否成功

---

## getDatabasePath(contextId)

```javascript
getDatabasePath(contextId)
```

* 根据身份上下文获取数据库路径
   * @param {string} contextId - 身份上下文ID ('personal' 或 'org_xxx')
   * @returns {string} 数据库文件路径

---

## getCurrentDatabasePath()

```javascript
getCurrentDatabasePath()
```

* 获取当前数据库路径
   * @returns {string|null} 当前数据库路径

---

## async backup(backupPath)

```javascript
async backup(backupPath)
```

* 备份数据库
   * @param {string} backupPath - 备份路径
   * @returns {Promise<void>}

---

## softDelete(tableName, id)

```javascript
softDelete(tableName, id)
```

* 软删除记录（设置deleted=1而不是物理删除）
   * @param {string} tableName - 表名
   * @param {string} id - 记录ID
   * @returns {boolean} 是否成功

---

## batchSoftDelete(tableName, ids)

```javascript
batchSoftDelete(tableName, ids)
```

* 批量软删除记录
   * @param {string} tableName - 表名
   * @param {Array<string>} ids - 记录ID列表
   * @returns {Object} 删除结果统计 {success: number, failed: number}

---

## restoreSoftDeleted(tableName, id)

```javascript
restoreSoftDeleted(tableName, id)
```

* 恢复软删除的记录
   * @param {string} tableName - 表名
   * @param {string} id - 记录ID
   * @returns {boolean} 是否成功

---

## cleanupSoftDeleted(tableName, olderThanDays = 30)

```javascript
cleanupSoftDeleted(tableName, olderThanDays = 30)
```

* 物理删除软删除的记录（永久删除）
   * @param {string} tableName - 表名
   * @param {number} olderThanDays - 删除多少天前的记录（默认30天）
   * @returns {Object} 清理结果 {deleted: number, tableName: string}

---

## cleanupAllSoftDeleted(olderThanDays = 30)

```javascript
cleanupAllSoftDeleted(olderThanDays = 30)
```

* 清理所有表的软删除记录
   * @param {number} olderThanDays - 删除多少天前的记录（默认30天）
   * @returns {Array<Object>} 清理结果列表

---

## getSoftDeletedStats()

```javascript
getSoftDeletedStats()
```

* 获取软删除记录的统计信息
   * @returns {Object} 统计信息 {total: number, byTable: Object}

---

## startPeriodicCleanup(intervalHours = 24, retentionDays = 30)

```javascript
startPeriodicCleanup(intervalHours = 24, retentionDays = 30)
```

* 启动定期清理任务
   * @param {number} intervalHours - 清理间隔（小时，默认24小时）
   * @param {number} retentionDays - 保留天数（默认30天）
   * @returns {Object} 定时器对象

---

## addRelation(sourceId, targetId, type, weight = 1.0, metadata = null)

```javascript
addRelation(sourceId, targetId, type, weight = 1.0, metadata = null)
```

* 添加知识关系
   * @param {string} sourceId - 源笔记ID
   * @param {string} targetId - 目标笔记ID
   * @param {string} type - 关系类型 (link/tag/semantic/temporal)
   * @param {number} weight - 关系权重 (0.0-1.0)
   * @param {object} metadata - 元数据
   * @returns {object} 创建的关系

---

## addRelations(relations)

```javascript
addRelations(relations)
```

* 批量添加知识关系
   * @param {Array} relations - 关系数组
   * @returns {number} 添加的关系数量

---

## deleteRelations(noteId, types = [])

```javascript
deleteRelations(noteId, types = [])
```

* 删除指定笔记的关系
   * @param {string} noteId - 笔记ID
   * @param {Array<string>} types - 要删除的关系类型列表，如 ['link', 'semantic']。空数组则删除所有类型
   * @returns {number} 删除的关系数量

---

## getGraphData(options =

```javascript
getGraphData(options =
```

* 获取图谱数据
   * @param {object} options - 查询选项
   * @returns {object} { nodes, edges }

---

## getKnowledgeRelations(knowledgeId)

```javascript
getKnowledgeRelations(knowledgeId)
```

* 获取笔记的所有关系
   * @param {string} knowledgeId - 笔记ID
   * @returns {Array} 关系列表

---

## findRelationPath(sourceId, targetId, maxDepth = 3)

```javascript
findRelationPath(sourceId, targetId, maxDepth = 3)
```

* 查找两个笔记之间的关系路径（BFS）
   * @param {string} sourceId - 源笔记ID
   * @param {string} targetId - 目标笔记ID
   * @param {number} maxDepth - 最大搜索深度
   * @returns {object|null} 路径信息

---

## getKnowledgeNeighbors(knowledgeId, depth = 1)

```javascript
getKnowledgeNeighbors(knowledgeId, depth = 1)
```

* 获取笔记的邻居节点（一度或多度关系）
   * @param {string} knowledgeId - 笔记ID
   * @param {number} depth - 深度
   * @returns {object} { nodes, edges }

---

## buildTagRelations()

```javascript
buildTagRelations()
```

* 构建标签关系
   * 为共享标签的笔记建立关系
   * @returns {number} 创建的关系数量

---

## buildTemporalRelations(windowDays = 7)

```javascript
buildTemporalRelations(windowDays = 7)
```

* 构建时间序列关系
   * @param {number} windowDays - 时间窗口（天）
   * @returns {number} 创建的关系数量

---

## getProjects(userId, options =

```javascript
getProjects(userId, options =
```

* 获取所有项目
   * @param {string} userId - 用户ID
   * @returns {Array} 项目列表

---

## getProjectsCount(userId)

```javascript
getProjectsCount(userId)
```

* 获取项目总数
   * @param {string} userId - 用户ID
   * @returns {number} 项目总数

---

## getDatabaseStats()

```javascript
getDatabaseStats()
```

* 调试：获取数据库统计信息
   * @returns {Object} 数据库统计信息

---

## getProjectById(projectId)

```javascript
getProjectById(projectId)
```

* 根据ID获取项目
   * @param {string} projectId - 项目ID
   * @returns {Object|null} 项目

---

## saveProject(project)

```javascript
saveProject(project)
```

* 保存项目
   * @param {Object} project - 项目数据
   * @returns {Object} 保存的项目

---

## updateProject(projectId, updates)

```javascript
updateProject(projectId, updates)
```

* 更新项目
   * @param {string} projectId - 项目ID
   * @param {Object} updates - 更新数据
   * @returns {Object|null} 更新后的项目

---

## deleteProject(projectId)

```javascript
deleteProject(projectId)
```

* 删除项目
   * @param {string} projectId - 项目ID
   * @returns {boolean} 是否删除成功

---

## getProjectFiles(projectId)

```javascript
getProjectFiles(projectId)
```

* 获取项目文件列表
   * @param {string} projectId - 项目ID
   * @returns {Array} 文件列表

---

## saveProjectFiles(projectId, files)

```javascript
saveProjectFiles(projectId, files)
```

* 保存项目文件
   * @param {string} projectId - 项目ID
   * @param {Array} files - 文件列表

---

## updateProjectFile(fileUpdate)

```javascript
updateProjectFile(fileUpdate)
```

* 更新单个文件
   * @param {Object} fileUpdate - 文件更新数据

---

## createConversation(conversationData)

```javascript
createConversation(conversationData)
```

* 创建对话
   * @param {Object} conversationData - 对话数据
   * @returns {Object} 创建的对话

---

## getConversationById(conversationId)

```javascript
getConversationById(conversationId)
```

* 根据ID获取对话
   * @param {string} conversationId - 对话ID
   * @returns {Object|null} 对话对象

---

## getConversationByProject(projectId)

```javascript
getConversationByProject(projectId)
```

* 根据项目ID获取对话
   * @param {string} projectId - 项目ID
   * @returns {Object|null} 对话对象

---

## getConversations(options =

```javascript
getConversations(options =
```

* 获取所有对话
   * @param {Object} options - 查询选项
   * @returns {Array} 对话列表

---

## updateConversation(conversationId, updates)

```javascript
updateConversation(conversationId, updates)
```

* 更新对话
   * @param {string} conversationId - 对话ID
   * @param {Object} updates - 更新数据
   * @returns {Object|null} 更新后的对话

---

## deleteConversation(conversationId)

```javascript
deleteConversation(conversationId)
```

* 删除对话
   * @param {string} conversationId - 对话ID
   * @returns {boolean} 是否删除成功

---

## createMessage(messageData)

```javascript
createMessage(messageData)
```

* 创建消息
   * @param {Object} messageData - 消息数据
   * @returns {Object} 创建的消息

---

## getMessageById(messageId)

```javascript
getMessageById(messageId)
```

* 根据ID获取消息
   * @param {string} messageId - 消息ID
   * @returns {Object|null} 消息对象

---

## getMessagesByConversation(conversationId, options =

```javascript
getMessagesByConversation(conversationId, options =
```

* 获取对话的所有消息（支持分页）
   * @param {string} conversationId - 对话ID
   * @param {Object} options - 查询选项
   * @param {number} options.limit - 每页消息数量
   * @param {number} options.offset - 偏移量
   * @param {string} options.order - 排序方式 ('ASC' 或 'DESC')
   * @returns {Object} 包含消息列表和总数的对象

---

## deleteMessage(messageId)

```javascript
deleteMessage(messageId)
```

* 删除消息
   * @param {string} messageId - 消息ID
   * @returns {boolean} 是否删除成功

---

## clearConversationMessages(conversationId)

```javascript
clearConversationMessages(conversationId)
```

* 清空对话的所有消息
   * @param {string} conversationId - 对话ID
   * @returns {boolean} 是否清空成功

---

## searchMessages(options =

```javascript
searchMessages(options =
```

* 搜索消息
   * @param {Object} options - 搜索选项
   * @param {string} options.query - 搜索关键词
   * @param {string} [options.conversationId] - 对话ID（可选，限制在特定对话中搜索）
   * @param {string} [options.role] - 消息角色（可选，user/assistant/system）
   * @param {number} [options.limit] - 返回结果数量限制（默认50）
   * @param {number} [options.offset] - 偏移量（默认0）
   * @param {string} [options.order] - 排序方式（'ASC'或'DESC'，默认'DESC'）
   * @returns {Object} { messages: Array, total: number, hasMore: boolean }

---

## initDefaultSettings()

```javascript
initDefaultSettings()
```

* 初始化默认配置

---

## getSetting(key)

```javascript
getSetting(key)
```

* 获取单个配置项
   * @param {string} key - 配置键
   * @returns {any} 配置值

---

## getAllSettings()

```javascript
getAllSettings()
```

* 获取所有配置
   * @returns {Object} 配置对象

---

## setSetting(key, value)

```javascript
setSetting(key, value)
```

* 设置单个配置项
   * @param {string} key - 配置键
   * @param {any} value - 配置值
   * @returns {boolean} 是否设置成功

---

## updateSettings(config)

```javascript
updateSettings(config)
```

* 批量更新配置
   * @param {Object} config - 配置对象
   * @returns {boolean} 是否更新成功

---

## deleteSetting(key)

```javascript
deleteSetting(key)
```

* 删除配置项
   * @param {string} key - 配置键
   * @returns {boolean} 是否删除成功

---

## resetSettings()

```javascript
resetSettings()
```

* 重置所有配置为默认值
   * @returns {boolean} 是否重置成功

---

## function getDatabase()

```javascript
function getDatabase()
```

* 获取数据库单例实例
 * @returns {DatabaseManager}

---

## function setDatabase(instance)

```javascript
function setDatabase(instance)
```

* 设置数据库实例（由main index.js调用）
 * @param {DatabaseManager} instance

---

