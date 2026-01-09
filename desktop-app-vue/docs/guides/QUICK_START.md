# 🚀 快速开始指南

立即开始使用新的错误处理、加载管理和骨架屏工具！

---

## ⚡ 5分钟快速集成

### 步骤 1: 导入工具 (30秒)

在你的 Vue 组件中添加：

```javascript
import { handleError, withRetry } from '@/utils/errorHandler';
import { useLoading, withLoading } from '@/utils/loadingManager';
import SkeletonLoader from '@/components/common/SkeletonLoader.vue';
```

### 步骤 2: 设置加载状态 (30秒)

```javascript
const { isLoading } = useLoading('myOperation');
```

### 步骤 3: 在模板中使用 (1分钟)

```vue
<template>
  <!-- 加载时显示骨架屏 -->
  <SkeletonLoader v-if="isLoading" type="project-list" :count="5" />

  <!-- 加载完成显示内容 -->
  <div v-else>
    <!-- 你的内容 -->
  </div>
</template>
```

### 步骤 4: 包装异步操作 (2分钟)

```javascript
async function loadData() {
  await withLoading('myOperation', async () => {
    const data = await api.getData();
    // 处理数据
  }, {
    message: '加载中...',
    errorMessage: '加载失败',
  }).catch(handleError);
}
```

### 步骤 5: 调用函数 (30秒)

```javascript
onMounted(() => {
  loadData();
});
```

**完成！** 🎉 你的组件现在有了：
- ✅ 优雅的加载状态
- ✅ 骨架屏动画
- ✅ 统一的错误处理
- ✅ 自动的用户反馈

---

## 📋 常用代码片段

### 片段 1: 基础数据加载

```vue
<template>
  <div>
    <SkeletonLoader v-if="isLoading" type="project-list" :count="5" />
    <div v-else>{{ data }}</div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useLoading, withLoading } from '@/utils/loadingManager';
import { handleError } from '@/utils/errorHandler';
import SkeletonLoader from '@/components/common/SkeletonLoader.vue';

const { isLoading } = useLoading('loadData');
const data = ref(null);

async function loadData() {
  await withLoading('loadData', async () => {
    data.value = await window.electronAPI.getData();
  }, {
    message: '加载数据...',
    errorMessage: '加载失败',
  }).catch(handleError);
}

onMounted(loadData);
</script>
```

### 片段 2: 创建/更新操作

```javascript
async function createItem(formData) {
  try {
    const result = await withLoading('createItem', async () => {
      return await window.electronAPI.createItem(formData);
    }, {
      message: '创建中...',
      successMessage: '创建成功！',
      showSuccess: true,
    });

    // 跳转或刷新
    router.push(`/items/${result.id}`);
  } catch (error) {
    handleError(error, {
      showMessage: true,
      logToFile: true,
      context: { function: 'createItem', formData },
    });
  }
}
```

### 片段 3: 带重试的网络请求

```javascript
import { withRetry } from '@/utils/errorHandler';

async function fetchWithRetry() {
  return await withRetry(
    () => window.electronAPI.fetchData(),
    {
      maxRetries: 3,
      retryDelay: 1000,
      onRetry: (error, attempt) => {
        console.log(`重试 ${attempt + 1}/3...`);
      },
    }
  );
}
```

### 片段 4: 带进度的长操作

```javascript
async function processFile(file) {
  await withLoading('processFile', async (updateProgress) => {
    updateProgress(20);
    const uploaded = await uploadFile(file);

    updateProgress(50);
    const processed = await processData(uploaded);

    updateProgress(80);
    await saveResult(processed);

    updateProgress(100);
  }, {
    message: '处理文件中...',
    successMessage: '处理完成',
  });
}
```

---

## 🎨 骨架屏快速参考

```vue
<!-- 项目卡片 -->
<SkeletonLoader type="project-card" />

<!-- 项目列表 (5个) -->
<SkeletonLoader type="project-list" :count="5" />

<!-- 对话列表 (3个) -->
<SkeletonLoader type="conversation-list" :count="3" />

<!-- 表格 (10行, 5列) -->
<SkeletonLoader type="table" :count="10" :columns="5" />

<!-- 段落文本 (4行) -->
<SkeletonLoader type="paragraph" :count="4" />

<!-- 表单 (5个字段) -->
<SkeletonLoader type="form" :count="5" />

<!-- 图片 -->
<SkeletonLoader type="image" width="300" height="200" />
```

---

## 🔧 快速修复常见问题

### 问题 1: 加载状态不更新

**原因**: 使用了不同的 key

**解决**:
```javascript
// ❌ 错误
const { isLoading } = useLoading('load');
await withLoading('loading', ...); // 不同的 key!

// ✅ 正确
const { isLoading } = useLoading('load');
await withLoading('load', ...); // 相同的 key
```

### 问题 2: 错误没有显示

**原因**: 没有调用 handleError

**解决**:
```javascript
// ❌ 错误
try {
  await operation();
} catch (error) {
  console.error(error); // 只记录，不显示
}

// ✅ 正确
try {
  await operation();
} catch (error) {
  handleError(error, { showMessage: true });
}
```

### 问题 3: 骨架屏不显示

**原因**: 条件判断错误

**解决**:
```vue
<!-- ❌ 错误 -->
<SkeletonLoader v-if="!loading" ... />

<!-- ✅ 正确 -->
<SkeletonLoader v-if="isLoading" ... />
```

---

## 📚 下一步学习

1. **详细文档**: 阅读 `INTEGRATION_GUIDE.md`
2. **完整示例**: 查看 `ProjectsPage.improved.example.js`
3. **测试指南**: 参考 `TESTING_GUIDE.md`
4. **改进总结**: 了解 `PC_IMPROVEMENTS_FINAL.md`

---

## ✅ 检查清单

在提交代码前，确保：

- [ ] 导入了必要的工具
- [ ] 使用 `useLoading()` 管理加载状态
- [ ] 使用 `withLoading()` 包装异步操作
- [ ] 使用 `handleError()` 处理错误
- [ ] 添加了合适的骨架屏
- [ ] 测试了加载状态
- [ ] 测试了错误场景
- [ ] 代码简洁易读

---

## 🎯 实战练习

### 练习 1: 改进一个简单的列表页面

**任务**: 将一个使用手动 loading 的列表页面改为使用新工具

**步骤**:
1. 导入工具
2. 替换 loading 变量为 `useLoading()`
3. 用 `withLoading()` 包装数据加载
4. 添加骨架屏
5. 用 `handleError()` 处理错误

**预计时间**: 10分钟

### 练习 2: 添加重试机制

**任务**: 为一个网络请求添加自动重试

**步骤**:
1. 导入 `withRetry`
2. 包装 API 调用
3. 配置重试参数
4. 测试网络错误场景

**预计时间**: 5分钟

### 练习 3: 添加进度反馈

**任务**: 为文件上传添加进度显示

**步骤**:
1. 使用 `withLoading()` 的 `updateProgress` 参数
2. 在关键步骤更新进度
3. 测试进度显示

**预计时间**: 10分钟

---

## 💡 专业提示

1. **使用相同的 key** 在 `useLoading()` 和 `withLoading()` 中
2. **提供有意义的消息** 让用户知道正在发生什么
3. **选择合适的骨架屏类型** 匹配实际内容布局
4. **记录错误上下文** 便于调试
5. **为长操作显示进度** 提升用户体验

---

## 🚀 开始行动

**现在就开始！** 选择一个组件，花 10 分钟集成这些工具，立即看到效果！

**推荐起点**:
- 简单的列表页面
- 数据加载较多的页面
- 用户经常访问的页面

**需要帮助？**
- 查看 `INTEGRATION_GUIDE.md`
- 参考示例代码
- 查阅工具文档

---

**祝你编码愉快！** 🎉
