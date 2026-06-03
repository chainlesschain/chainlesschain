# 工具集成指南

本指南说明如何在现有组件中集成新的错误处理、加载管理和骨架屏组件。

---

## 📦 可用工具

### 1. 错误处理工具 (`errorHandler.js`)
- 统一的错误处理和用户反馈
- 自动重试机制
- 超时处理
- 错误日志记录

### 2. 加载状态管理 (`loadingManager.js`)
- 集中式加载状态管理
- 进度跟踪
- 自动用户反馈
- 防抖/节流支持

### 3. 骨架屏组件 (`SkeletonLoader.vue`)
- 多种预设样式
- 流畅的加载动画
- 改善用户体验

---

## 🚀 快速开始

### 步骤 1: 导入工具

```javascript
// 在组件的 <script setup> 中
import { handleError, withRetry, withTimeout, ErrorType } from '@/utils/errorHandler';
import { useLoading, withLoading } from '@/utils/loadingManager';
import SkeletonLoader from '@/components/common/SkeletonLoader.vue';
```

### 步骤 2: 设置加载状态

```javascript
// 为不同的操作创建加载状态
const { isLoading: isLoadingProjects, start, finish, fail } = useLoading('projects');
const { isLoading: isCreating } = useLoading('createProject');
```

### 步骤 3: 在模板中使用

```vue
<template>
  <div class="page">
    <!-- 加载时显示骨架屏 -->
    <SkeletonLoader v-if="isLoadingProjects" type="project-list" :count="5" />

    <!-- 加载完成后显示内容 -->
    <div v-else class="content">
      <!-- 你的内容 -->
    </div>

    <!-- 按钮显示加载状态 -->
    <a-button
      :loading="isCreating"
      :disabled="isCreating"
      @click="handleCreate"
    >
      {{ isCreating ? '创建中...' : '创建项目' }}
    </a-button>
  </div>
</template>
```

---

## 📖 详细示例

### 示例 1: 加载数据列表

**改进前:**
```javascript
async function loadProjects() {
  try {
    loading.value = true;
    const data = await api.getProjects();
    projects.value = data;
  } catch (error) {
    console.error('加载失败:', error);
    message.error('加载项目失败');
  } finally {
    loading.value = false;
  }
}
```

**改进后:**
```javascript
async function loadProjects() {
  await withLoading(
    'projects',
    async () => {
      const data = await api.getProjects();
      projects.value = data;
    },
    {
      message: '加载项目列表...',
      errorMessage: '加载项目失败',
      showError: true,
    }
  ).catch(error => {
    handleError(error, {
      showMessage: true,
      logToFile: true,
      context: { function: 'loadProjects' },
    });
  });
}
```

### 示例 2: 创建/更新操作

**改进前:**
```javascript
async function createProject(data) {
  try {
    message.loading({ content: '创建中...', key: 'create', duration: 0 });
    const result = await api.createProject(data);
    message.success({ content: '创建成功', key: 'create' });
    return result;
  } catch (error) {
    message.error({ content: '创建失败', key: 'create' });
    throw error;
  }
}
```

**改进后:**
```javascript
async function createProject(data) {
  try {
    const result = await withLoading(
      'createProject',
      async (updateProgress) => {
        updateProgress(30);
        const result = await api.createProject(data);
        updateProgress(80);
        return result;
      },
      {
        message: '创建项目中...',
        successMessage: '项目创建成功！',
        showSuccess: true,
      }
    );

    // 跳转到新项目
    router.push(`/projects/${result.id}`);
    return result;

  } catch (error) {
    handleError(error, {
      showMessage: true,
      logToFile: true,
      context: { function: 'createProject', data },
    });
    throw error;
  }
}
```

### 示例 3: 带重试的网络请求

```javascript
async function fetchDataWithRetry() {
  try {
    const data = await withRetry(
      () => api.getData(),
      {
        maxRetries: 3,
        retryDelay: 1000,
        onRetry: (error, attempt) => {
          console.log(`重试 ${attempt + 1}/3...`);
        },
        shouldRetry: (error) => {
          // 只在网络错误时重试
          return error.message.includes('network') ||
                 error.message.includes('timeout');
        },
      }
    );
    return data;
  } catch (error) {
    handleError(error, {
      showMessage: true,
      showNotification: true,
      context: { function: 'fetchDataWithRetry' },
    });
  }
}
```

### 示例 4: 带超时的长时间操作

```javascript
async function processLargeFile(file) {
  try {
    const result = await withTimeout(
      withLoading(
        'processFile',
        async (updateProgress) => {
          updateProgress(10);
          const result = await api.uploadFile(file);
          updateProgress(50);
          await api.processFile(result.id);
          updateProgress(90);
          return result;
        },
        {
          message: '处理文件中...',
          successMessage: '文件处理完成',
        }
      ),
      60000, // 60秒超时
      '文件处理超时，请稍后重试'
    );
    return result;
  } catch (error) {
    handleError(error, {
      showMessage: true,
      logToFile: true,
      context: { function: 'processLargeFile', fileName: file.name },
    });
  }
}
```

### 示例 5: 批量操作

```javascript
import { withBatchLoading } from '@/utils/loadingManager';

async function deleteMultipleProjects(projectIds) {
  try {
    const operations = projectIds.map(id =>
      () => api.deleteProject(id)
    );

    const results = await withBatchLoading(
      operations,
      {
        message: `删除 ${projectIds.length} 个项目...`,
        successMessage: '批量删除完成',
        errorMessage: '部分项目删除失败',
        showSuccess: true,
      }
    );

    // 刷新列表
    await loadProjects();

    return results;
  } catch (error) {
    handleError(error, {
      showMessage: true,
      context: { function: 'deleteMultipleProjects', count: projectIds.length },
    });
  }
}
```

---

## 🎨 骨架屏使用

### 可用类型

```vue
<!-- 项目卡片 -->
<SkeletonLoader type="project-card" />

<!-- 项目列表 -->
<SkeletonLoader type="project-list" :count="5" />

<!-- 对话列表 -->
<SkeletonLoader type="conversation-list" :count="3" />

<!-- 表格 -->
<SkeletonLoader type="table" :count="10" :columns="5" />

<!-- 段落文本 -->
<SkeletonLoader type="paragraph" :count="4" />

<!-- 表单 -->
<SkeletonLoader type="form" :count="5" />

<!-- 图片 -->
<SkeletonLoader type="image" width="300" height="200" />

<!-- 默认 -->
<SkeletonLoader />
```

### 完整示例

```vue
<template>
  <div class="projects-page">
    <!-- 加载状态 -->
    <div v-if="isLoadingProjects" class="loading-section">
      <SkeletonLoader type="project-list" :count="8" />
    </div>

    <!-- 内容 -->
    <div v-else-if="projects.length > 0" class="projects-list">
      <ProjectCard
        v-for="project in projects"
        :key="project.id"
        :project="project"
      />
    </div>

    <!-- 空状态 -->
    <div v-else class="empty-state">
      <a-empty description="暂无项目" />
    </div>
  </div>
</template>

<script setup>
import { onMounted } from 'vue';
import { useLoading, withLoading } from '@/utils/loadingManager';
import { handleError } from '@/utils/errorHandler';
import SkeletonLoader from '@/components/common/SkeletonLoader.vue';

const { isLoading: isLoadingProjects } = useLoading('projects');
const projects = ref([]);

async function loadProjects() {
  await withLoading(
    'projects',
    async () => {
      const data = await api.getProjects();
      projects.value = data;
    },
    {
      message: '加载项目...',
      errorMessage: '加载失败',
    }
  ).catch(handleError);
}

onMounted(() => {
  loadProjects();
});
</script>
```

---

## ⚠️ 最佳实践

### 1. 错误处理

✅ **推荐:**
```javascript
// 使用 handleError 统一处理
catch (error) {
  handleError(error, {
    showMessage: true,
    logToFile: true,
    context: { function: 'functionName', ...params },
  });
}
```

❌ **不推荐:**
```javascript
// 直接 console.error 和 message.error
catch (error) {
  console.error('Error:', error);
  message.error('操作失败');
}
```

### 2. 加载状态

✅ **推荐:**
```javascript
// 使用 withLoading 自动管理
await withLoading('key', async () => {
  // 异步操作
}, { message: '加载中...' });
```

❌ **不推荐:**
```javascript
// 手动管理 loading 状态
loading.value = true;
try {
  await operation();
} finally {
  loading.value = false;
}
```

### 3. 骨架屏

✅ **推荐:**
```vue
<!-- 根据内容类型选择合适的骨架屏 -->
<SkeletonLoader v-if="isLoading" type="project-list" :count="5" />
<ProjectList v-else :projects="projects" />
```

❌ **不推荐:**
```vue
<!-- 只显示 loading spinner -->
<a-spin v-if="isLoading" />
<ProjectList v-else :projects="projects" />
```

### 4. 进度反馈

✅ **推荐:**
```javascript
// 为长时间操作提供进度反馈
await withLoading('upload', async (updateProgress) => {
  updateProgress(20);
  await step1();
  updateProgress(50);
  await step2();
  updateProgress(80);
  await step3();
}, { message: '上传中...' });
```

### 5. 错误分类

✅ **推荐:**
```javascript
// 根据错误类型提供不同的处理
if (error.message.includes('权限')) {
  handleError(
    createError('没有权限执行此操作', ErrorType.PERMISSION, ErrorLevel.WARNING),
    { showMessage: true }
  );
} else {
  handleError(error, { showMessage: true, logToFile: true });
}
```

---

## 🔧 迁移清单

将现有组件迁移到新工具时，请按以下步骤操作:

- [ ] 1. 导入必要的工具函数
- [ ] 2. 将手动 loading 状态替换为 `useLoading()`
- [ ] 3. 将 try-catch 块替换为 `withLoading()` + `handleError()`
- [ ] 4. 添加骨架屏组件替代 loading spinner
- [ ] 5. 为长时间操作添加进度反馈
- [ ] 6. 为网络请求添加重试机制
- [ ] 7. 为关键操作添加超时处理
- [ ] 8. 测试所有错误场景
- [ ] 9. 测试加载状态显示
- [ ] 10. 验证用户体验改善

---

## 📚 参考资料

- **错误处理工具**: `src/renderer/utils/errorHandler.js`
- **加载管理工具**: `src/renderer/utils/loadingManager.js`
- **骨架屏组件**: `src/renderer/components/common/SkeletonLoader.vue`
- **改进示例**: `src/renderer/pages/projects/ProjectsPage.improved.example.js`
- **测试指南**: `TESTING_GUIDE.md`
- **改进总结**: `IMPROVEMENTS_SUMMARY.md`

---

## 💡 常见问题

### Q: 如何为同一个操作使用多个加载状态？

A: 使用不同的 key:
```javascript
const { isLoading: isLoadingList } = useLoading('list');
const { isLoading: isLoadingDetails } = useLoading('details');
```

### Q: 如何禁用自动错误提示？

A: 设置 `showMessage: false`:
```javascript
handleError(error, { showMessage: false, logToFile: true });
```

### Q: 如何自定义骨架屏样式？

A: 修改 `SkeletonLoader.vue` 中的 CSS，或创建自定义骨架屏组件。

### Q: 重试机制会影响性能吗？

A: 重试只在失败时触发，且可以通过 `shouldRetry` 函数控制重试条件。

### Q: 如何在多个组件间共享加载状态？

A: 使用相同的 key:
```javascript
// 组件 A
const { isLoading } = useLoading('shared-operation');

// 组件 B
const { isLoading } = useLoading('shared-operation'); // 同一个状态
```

---

**最后更新**: 2026-01-09
**版本**: 1.0.0
