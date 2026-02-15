# tool-index

**Source**: `src/main/skill-tool-system/tool-index.js`

**Generated**: 2026-02-15T08:42:37.185Z

---

## class ToolIndex

```javascript
class ToolIndex
```

* 工具索引系统
 * 提供O(1)时间复杂度的工具查找
 *
 * 索引类型：
 * - byId: 通过工具ID查找
 * - byName: 通过工具名称查找
 * - byCategory: 通过类别获取工具列表
 * - byPermission: 通过权限获取工具列表
 * - byRiskLevel: 通过风险级别获取工具列表

---

## _buildIndexes()

```javascript
_buildIndexes()
```

* 构建所有索引
   * @private

---

## getById(id)

```javascript
getById(id)
```

* 通过ID获取工具
   * @param {string} id - 工具ID
   * @returns {Object|undefined} 工具对象

---

## getByName(name)

```javascript
getByName(name)
```

* 通过名称获取工具
   * @param {string} name - 工具名称
   * @returns {Object|undefined} 工具对象

---

## getByCategory(category)

```javascript
getByCategory(category)
```

* 通过类别获取工具列表
   * @param {string} category - 类别名称
   * @returns {Array} 工具对象数组

---

## getByPermission(permission)

```javascript
getByPermission(permission)
```

* 通过权限获取工具列表
   * @param {string} permission - 权限名称
   * @returns {Array} 工具对象数组

---

## getByRiskLevel(level)

```javascript
getByRiskLevel(level)
```

* 通过风险级别获取工具列表
   * @param {number} level - 风险级别 (1-5)
   * @returns {Array} 工具对象数组

---

## getAllCategories()

```javascript
getAllCategories()
```

* 获取所有类别
   * @returns {Array<string>} 类别名称数组

---

## getAllPermissions()

```javascript
getAllPermissions()
```

* 获取所有权限类型
   * @returns {Array<string>} 权限名称数组

---

## getAllRiskLevels()

```javascript
getAllRiskLevels()
```

* 获取所有风险级别
   * @returns {Array<number>} 风险级别数组

---

## query(filters =

```javascript
query(filters =
```

* 多条件查询
   * @param {Object} filters - 过滤条件
   * @param {string} [filters.category] - 类别
   * @param {number} [filters.riskLevel] - 风险级别
   * @param {Array<string>} [filters.permissions] - 需要的权限（AND）
   * @param {boolean} [filters.enabled] - 是否启用
   * @returns {Array} 符合条件的工具数组

---

## search(keyword, fields = ["name", "display_name", "description"])

```javascript
search(keyword, fields = ["name", "display_name", "description"])
```

* 搜索工具（支持模糊匹配）
   * @param {string} keyword - 搜索关键词
   * @param {Array<string>} fields - 搜索字段 ['name', 'display_name', 'description']
   * @returns {Array} 匹配的工具数组

---

## getStats()

```javascript
getStats()
```

* 获取统计信息
   * @returns {Object} 统计数据

---

## healthCheck()

```javascript
healthCheck()
```

* 检查索引健康状态
   * @returns {Object} 健康检查结果

---

## function getToolIndex()

```javascript
function getToolIndex()
```

* 获取工具索引实例（单例模式）
 * @returns {ToolIndex} 工具索引实例

---

## function resetToolIndex()

```javascript
function resetToolIndex()
```

* 重置索引实例（主要用于测试）

---

