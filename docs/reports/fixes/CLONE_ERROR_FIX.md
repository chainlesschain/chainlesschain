# "An object could not be cloned" 错误修复

## 问题描述

在使用 AI 创建项目功能时，出现以下错误：

```
[ERROR] [ChatPanel] AI创建失败: {
  "message": "An object could not be cloned."
}
```

## 根本原因

### 技术分析

1. **错误位置**: `ChatPanel.vue:1309` - `startAICreation` 函数

2. **错误原因**:
   - `aiCreationData` 是 Vue 的响应式 `ref` 对象
   - 当传递给 `createProjectStream` 时，Vue 的响应式代理对象包含不可序列化的内部属性
   - 这些属性（如 `__v_isRef`, `__v_isReactive` 等）无法通过 `structuredClone()` 或 IPC 序列化

3. **触发链**:
   ```
   ProjectDetailPage.vue (route.query.createData)
   → JSON.parse() → Vue ref()
   → ChatPanel.vue (aiCreationData prop)
   → startAICreation(createData)
   → projectStore.createProjectStream(createData) ← 包含 Vue 响应式代理
   → IPC 序列化失败
   → "An object could not be cloned" 错误
   ```

## 修复方案

### 解决方法

在传递数据给 `createProjectStream` 之前，使用 `JSON.parse(JSON.stringify())` 进行深拷贝，移除 Vue 响应式代理：

**文件**: `src/renderer/components/projects/ChatPanel.vue`

**修改位置**: `startAICreation` 函数 (line ~1303)

```javascript
// BEFORE:
try {
  const { useProjectStore } = await import("@/stores/project");
  const projectStore = useProjectStore();

  await projectStore.createProjectStream(createData, (progressUpdate) => {
    // ...
  });
}

// AFTER:
try {
  // BUGFIX: 深拷贝 createData 以确保是纯对象（避免 Vue 响应式代理导致的克隆错误）
  const pureCreateData = JSON.parse(JSON.stringify(createData));

  const { useProjectStore } = await import("@/stores/project");
  const projectStore = useProjectStore();

  await projectStore.createProjectStream(pureCreateData, (progressUpdate) => {
    // ...
  });
}
```

### 为什么这样修复有效？

1. **JSON.stringify()**:
   - 将 Vue 响应式对象序列化为纯 JSON 字符串
   - 自动移除函数、Symbol、undefined 和 Vue 内部属性

2. **JSON.parse()**:
   - 将 JSON 字符串解析为纯 JavaScript 对象
   - 完全去除了 Vue 响应式系统的痕迹

3. **结果**:
   - 得到一个可以安全通过 IPC 传递的纯对象
   - 不包含任何不可序列化的属性

## 替代方案

如果需要保留特定的非 JSON 兼容数据，可以使用其他方案：

### 方案 1: toRaw()（Vue 3 内置）

```javascript
import { toRaw } from 'vue';

const pureCreateData = toRaw(createData);
```

**优点**: 保留原始对象引用
**缺点**: 如果嵌套对象也是响应式的，需要递归处理

### 方案 2: 手动提取字段

```javascript
const pureCreateData = {
  name: createData.name,
  projectType: createData.projectType,
  description: createData.description,
  // ... 其他需要的字段
};
```

**优点**: 最安全，完全控制
**缺点**: 维护成本高，容易遗漏字段

## 测试验证

### 测试步骤

1. 打开项目详情页面
2. 触发 AI 创建项目功能
3. 观察 Console 日志

### 预期结果

✅ **修复前**:
```
[ERROR] [ChatPanel] AI创建失败: {
  "message": "An object could not be cloned."
}
```

✅ **修复后**:
```
[INFO] [ChatPanel] 开始AI创建项目: {...}
[INFO] [Store] createProjectStream被调用
[INFO] [Preload] createStream called with callbacks
[INFO] [ChatPanel] 收到创建进度更新: {...}
```

## 影响范围

### 修改文件

- `src/renderer/components/projects/ChatPanel.vue` (1 处修改)

### 影响功能

- AI 创建项目功能
- 项目流式创建

### 兼容性

✅ 向后兼容 - 不影响现有功能
✅ 性能影响 - 微不足道（JSON 序列化很快）

## 相关问题

### 为什么 Electron IPC 不能传递 Vue 响应式对象？

Electron 的 IPC 使用 `structuredClone()` 算法来序列化数据，该算法：
- ✅ 支持: 原始类型、对象、数组、Date、RegExp、Map、Set 等
- ❌ 不支持: 函数、Symbol、DOM 节点、Proxy 对象（Vue 响应式代理）

Vue 3 的响应式系统基于 ES6 Proxy，这些代理对象无法被 `structuredClone()` 处理。

### 其他可能出现类似错误的场景

1. 使用 `window.postMessage()` 传递 Vue 响应式对象
2. 使用 `localStorage.setItem()` 保存响应式对象
3. 在 Web Worker 中传递响应式对象
4. 使用 `structuredClone()` 直接克隆响应式对象

**通用解决方案**: 始终在跨边界传递数据时使用纯对象

## 最佳实践

### 在 Vue 3 + Electron 项目中

1. **Store 层**: 确保传递给 IPC 的数据是纯对象
2. **Component 层**: Props 可以是响应式，但传递给外部系统前需转换
3. **Preload 层**: 使用 `removeUndefined()` 清理数据
4. **Main 层**: 假设接收的是纯对象

### 代码模式

```javascript
// ✅ 好的做法
const data = JSON.parse(JSON.stringify(reactiveData));
await ipcRenderer.invoke('some-channel', data);

// ❌ 避免的做法
await ipcRenderer.invoke('some-channel', reactiveData);
```

---

**修复日期**: 2026-02-04
**修复人**: Claude (Sonnet 4.5)
**状态**: ✅ 已修复并测试
