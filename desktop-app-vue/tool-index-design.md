# 工具索引系统设计

## 背景

当前builtin-tools.js包含300个工具定义，每次查找工具时需要遍历整个数组。随着工具数量增加，性能会成为瓶颈。建立索引可以将查找时间复杂度从O(n)降低到O(1)。

## 设计目标

1. **快速查找**: 通过ID、名称、类别快速定位工具
2. **内存高效**: 索引结构紧凑，避免重复存储
3. **易于维护**: 自动生成，无需手动维护
4. **向后兼容**: 不影响现有代码

## 索引结构

### 1. 主索引 (Primary Index)

按工具ID建立Map索引：

```javascript
const toolIndexById = new Map([
  ['tool_id_1', toolObject1],
  ['tool_id_2', toolObject2],
  // ...
]);
```

**用途**: 通过ID快速获取工具对象
**查找复杂度**: O(1)

### 2. 名称索引 (Name Index)

按工具name建立Map索引：

```javascript
const toolIndexByName = new Map([
  ['tool_name_1', toolObject1],
  ['tool_name_2', toolObject2],
  // ...
]);
```

**用途**: 通过name快速获取工具对象
**查找复杂度**: O(1)

### 3. 类别索引 (Category Index)

按category分组：

```javascript
const toolIndexByCategory = new Map([
  ['ai', [tool1, tool2, ...]],
  ['data', [tool3, tool4, ...]],
  ['blockchain', [tool5, tool6, ...]],
  // ...
]);
```

**用途**: 获取某类别下的所有工具
**查找复杂度**: O(1)获取数组，O(m)遍历（m为该类别工具数）

### 4. 权限索引 (Permission Index)

按required_permissions建立倒排索引：

```javascript
const toolIndexByPermission = new Map([
  ['file:read', new Set(['tool1_id', 'tool2_id', ...])],
  ['network:request', new Set(['tool3_id', 'tool4_id', ...])],
  // ...
]);
```

**用途**: 查找需要特定权限的所有工具
**查找复杂度**: O(1)

### 5. 风险级别索引 (Risk Level Index)

按risk_level分组：

```javascript
const toolIndexByRiskLevel = new Map([
  [1, [tool1, tool2, ...]],
  [2, [tool3, tool4, ...]],
  [3, [tool5, tool6, ...]],
  // ...
]);
```

**用途**: 获取特定风险级别的工具
**查找复杂度**: O(1)

## 索引文件结构

```javascript
// src/main/skill-tool-system/tool-index.js

const tools = require('./builtin-tools');

class ToolIndex {
  constructor(toolsArray) {
    this.tools = toolsArray;
    this.byId = new Map();
    this.byName = new Map();
    this.byCategory = new Map();
    this.byPermission = new Map();
    this.byRiskLevel = new Map();

    this._buildIndexes();
  }

  _buildIndexes() {
    this.tools.forEach(tool => {
      // ID索引
      this.byId.set(tool.id, tool);

      // Name索引
      this.byName.set(tool.name, tool);

      // Category索引
      if (!this.byCategory.has(tool.category)) {
        this.byCategory.set(tool.category, []);
      }
      this.byCategory.get(tool.category).push(tool);

      // Permission索引
      if (tool.required_permissions) {
        tool.required_permissions.forEach(perm => {
          if (!this.byPermission.has(perm)) {
            this.byPermission.set(perm, new Set());
          }
          this.byPermission.get(perm).add(tool.id);
        });
      }

      // Risk Level索引
      const riskLevel = tool.risk_level || 1;
      if (!this.byRiskLevel.has(riskLevel)) {
        this.byRiskLevel.set(riskLevel, []);
      }
      this.byRiskLevel.get(riskLevel).push(tool);
    });
  }

  // 查找方法
  getById(id) {
    return this.byId.get(id);
  }

  getByName(name) {
    return this.byName.get(name);
  }

  getByCategory(category) {
    return this.byCategory.get(category) || [];
  }

  getByPermission(permission) {
    const ids = this.byPermission.get(permission);
    if (!ids) return [];
    return Array.from(ids).map(id => this.byId.get(id));
  }

  getByRiskLevel(level) {
    return this.byRiskLevel.get(level) || [];
  }

  // 获取所有类别
  getAllCategories() {
    return Array.from(this.byCategory.keys());
  }

  // 获取所有权限类型
  getAllPermissions() {
    return Array.from(this.byPermission.keys());
  }

  // 统计信息
  getStats() {
    return {
      totalTools: this.tools.length,
      categoriesCount: this.byCategory.size,
      permissionsCount: this.byPermission.size,
      riskLevelsCount: this.byRiskLevel.size
    };
  }
}

// 单例模式
let indexInstance = null;

function getToolIndex() {
  if (!indexInstance) {
    indexInstance = new ToolIndex(tools);
  }
  return indexInstance;
}

module.exports = {
  ToolIndex,
  getToolIndex
};
```

## 使用示例

```javascript
const { getToolIndex } = require('./tool-index');

const index = getToolIndex();

// 通过ID查找
const tool = index.getById('tool_contract_analyzer');

// 通过名称查找
const tool2 = index.getByName('contract_analyzer');

// 获取某类别的所有工具
const aiTools = index.getByCategory('ai');
console.log(`AI工具数量: ${aiTools.length}`);

// 获取需要特定权限的工具
const fileReadTools = index.getByPermission('file:read');
console.log(`需要file:read权限的工具: ${fileReadTools.length}个`);

// 获取特定风险级别的工具
const highRiskTools = index.getByRiskLevel(3);
console.log(`高风险工具: ${highRiskTools.length}个`);

// 获取统计信息
const stats = index.getStats();
console.log(stats);
```

## 性能优化

### 内存占用估算

- 300个工具对象: 不重复存储，仅存储引用
- ID索引Map: ~300条 × 50字节 ≈ 15KB
- Name索引Map: ~300条 × 50字节 ≈ 15KB
- Category索引Map: ~45个类别 × 100字节 ≈ 5KB
- Permission索引Map: ~20个权限 × 100字节 ≈ 2KB
- Risk Level索引Map: ~5个级别 × 100字节 ≈ 500字节

**总额外内存**: ~38KB

### 时间复杂度对比

| 操作 | 无索引 | 有索引 | 提升 |
|------|--------|--------|------|
| 通过ID查找 | O(n) | O(1) | 300x |
| 通过Name查找 | O(n) | O(1) | 300x |
| 获取类别工具 | O(n) | O(1) | 300x |
| 权限过滤 | O(n×m) | O(1) | 更大 |

## 集成方式

### 方案1: 修改现有代码

在需要查找工具的地方，替换为索引查找：

```javascript
// Before
const tool = tools.find(t => t.id === toolId);

// After
const { getToolIndex } = require('./tool-index');
const tool = getToolIndex().getById(toolId);
```

### 方案2: 扩展builtin-tools.js

在builtin-tools.js底部添加索引导出：

```javascript
// 在module.exports = tools; 之后添加

const { ToolIndex } = require('./tool-index');
module.exports.index = new ToolIndex(tools);
```

**推荐方案2**，向后兼容且易于采用。

## 测试计划

1. **功能测试**: 验证所有索引查找正确性
2. **性能测试**: 对比有无索引的查找性能
3. **内存测试**: 测量实际内存占用
4. **压力测试**: 大量并发查询

## 后续优化

1. **缓存**: 为频繁查询的结果添加缓存
2. **懒加载**: 按需构建索引
3. **增量更新**: 支持动态添加/删除工具
4. **搜索优化**: 添加模糊搜索、全文搜索索引

## 实施步骤

1. ✅ 设计索引结构（本文档）
2. ⏳ 实现ToolIndex类
3. ⏳ 编写测试用例
4. ⏳ 性能基准测试
5. ⏳ 集成到现有代码
6. ⏳ 文档更新

---

**创建时间**: 2025-01-02
**状态**: 设计完成
