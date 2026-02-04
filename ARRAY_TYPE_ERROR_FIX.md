# "projects.unshift is not a function" 错误修复

## 问题描述

在项目加载过程中，出现以下错误：

```
Uncaught Error: this.projects.unshift is not a function
```

## 根本原因

### 技术分析

1. **IPC 返回结构不一致**:
   - IPC handler `electronAPI.project.getAll()` 返回的是对象: `{ projects: [], total: 0, hasMore: false }`
   - Project store 错误地将整个响应对象赋值给 `this.projects`
   - `this.projects` 应该是数组，但被赋值为对象

2. **触发链**:
   ```
   electronAPI.project.getAll(userId)
   → 返回 { projects: [...], total: X, hasMore: false }
   → this.projects = 响应对象 (错误！)
   → this.projects.unshift(...) ← 失败，对象没有 unshift 方法
   ```

3. **影响位置**:
   - `fetchProjects()` 函数 (line 182)
   - `syncProjects()` 函数 (line 705)

## 修复方案

### 解决方法

在两处位置提取 `projects` 数组并正确赋值：

**文件**: `src/renderer/stores/project.js`

### 修复位置 1: fetchProjects() (line 182)

```javascript
// BEFORE:
const localProjects = await electronAPI.project.getAll(userId);
this.projects = localProjects;

// AFTER:
const response = await electronAPI.project.getAll(userId);
// BUGFIX: IPC 返回的是 { projects: [], total: 0, hasMore: false }
const localProjects = Array.isArray(response) ? response : (response.projects || []);
this.projects = localProjects;
this.pagination.total = response.total || localProjects.length;
```

### 修复位置 2: syncProjects() (line 705)

```javascript
// BEFORE:
const localProjects = await electronAPI.project.getAll(userId);
this.projects = localProjects;

// AFTER:
const response = await electronAPI.project.getAll(userId);
// BUGFIX: IPC 返回的是 { projects: [], total: 0, hasMore: false }
const localProjects = Array.isArray(response) ? response : (response.projects || []);
this.projects = localProjects;
this.pagination.total = response.total || localProjects.length;
```

## 为什么这样修复有效？

1. **类型检查**:
   - `Array.isArray(response)` - 检查是否已经是数组（向后兼容）
   - 如果不是数组，提取 `response.projects`
   - 如果 `response.projects` 不存在，使用空数组 `[]`

2. **分页信息**:
   - 同时提取 `response.total` 以更新分页总数
   - 如果 `total` 不存在，使用数组长度

3. **结果**:
   - `this.projects` 始终是数组类型
   - 可以安全调用 `unshift()`, `push()`, `filter()` 等数组方法
   - 分页信息正确更新

## IPC 返回结构说明

### 实际返回格式

**文件**: `src/main/project/project-core-ipc.js`

```javascript
ipcMain.handle("project:getAll", async (event, userId) => {
  return {
    projects: [...],  // 项目数组
    total: 100,       // 总数
    hasMore: false    // 是否有更多
  };
});
```

### Store 期望格式

**文件**: `src/renderer/stores/project.js`

```javascript
// this.projects 应该是数组
this.projects = [
  { id: 1, name: "Project 1", ... },
  { id: 2, name: "Project 2", ... }
];

// this.pagination 应该包含分页信息
this.pagination = {
  total: 100,
  page: 1,
  pageSize: 20
};
```

## 测试验证

### 测试步骤

1. 打开应用
2. 导航到项目列表页面
3. 观察 Console 日志是否有 "unshift is not a function" 错误
4. 尝试创建新项目
5. 检查项目列表是否正确更新

### 预期结果

✅ **修复前**:
```
Uncaught Error: this.projects.unshift is not a function
```

✅ **修复后**:
```
[INFO] [Store] 成功加载 X 个项目
[INFO] [Store] 项目列表已更新
```

## 影响范围

### 修改文件

- `src/renderer/stores/project.js` (2 处修改: line 182, line 705)

### 影响功能

- 项目列表加载
- 项目同步
- 新建项目后的列表更新
- 项目删除后的列表更新

### 兼容性

✅ 向后兼容 - 使用 `Array.isArray()` 检查确保与旧代码兼容
✅ 性能影响 - 无影响，仅添加类型检查

## 相关错误模式

### 类似问题的通用解决方案

在处理 IPC 返回值时，始终检查数据结构：

```javascript
// ✅ 好的做法
const response = await electronAPI.someMethod();
const dataArray = Array.isArray(response)
  ? response
  : (response.data || []);

// ❌ 避免的做法
const data = await electronAPI.someMethod();
// 假设 data 一定是数组
this.items = data;  // 危险！可能是对象
```

### 其他可能出现类似错误的场景

1. **Template Store**: `electronAPI.template.getAll()`
2. **Chat Store**: `electronAPI.chat.getConversations()`
3. **Organization Store**: `electronAPI.organization.getAll()`

**建议**: 为所有 IPC 调用添加类型检查和数据提取逻辑

## 最佳实践

### IPC Handler 统一返回格式

```javascript
// ✅ 推荐：统一返回对象格式
ipcMain.handle("some:method", async (event, ...args) => {
  return {
    success: true,
    data: [...],      // 实际数据
    total: 100,       // 分页信息
    hasMore: false,
    error: null
  };
});
```

### Store 统一处理格式

```javascript
// ✅ 推荐：统一提取逻辑
async fetchData() {
  const response = await electronAPI.someMethod();

  // 提取数据数组
  this.items = Array.isArray(response)
    ? response
    : (response.data || response.items || []);

  // 提取分页信息
  if (response.total !== undefined) {
    this.pagination.total = response.total;
  }
}
```

## 与其他修复的关系

此修复是继以下修复之后的第四个问题：

1. ✅ **Manager 初始化问题** - 修复了 TemplateManager 和 OrganizationManager
2. ✅ **数据库 Schema 不匹配** - 重建了数据库
3. ✅ **Vue 响应式克隆错误** - 添加了深拷贝
4. ✅ **数组类型错误** (当前) - 修复了 IPC 返回值处理

## 总修复文件汇总

| 修复 | 文件 | 行数变更 |
|------|------|----------|
| Manager 初始化 | `src/main/bootstrap/core-initializer.js` | ~5行 |
| Manager 初始化 | `src/main/bootstrap/social-initializer.js` | ~15行 |
| Manager 初始化 | `src/main/template/template-manager.js` | ~30行 |
| Vue 克隆错误 | `src/renderer/components/projects/ChatPanel.vue` | ~2行 |
| 数组类型错误 | `src/renderer/stores/project.js` | ~10行 (2处) |

---

**修复日期**: 2026-02-04
**修复人**: Claude (Sonnet 4.5)
**状态**: ✅ 已修复
**测试状态**: 待用户验证
