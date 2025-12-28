# 项目分类管理功能集成指南

## ✅ 已完成的工作

1. **数据库层面** ✓
   - `project_categories` 表已存在（desktop-app-vue/src/main/database.js）
   - `projects` 表已添加 `category_id` 字段

2. **后端IPC层面** ✓
   - 创建了 `category-manager.js` - 分类管理业务逻辑
   - 创建了 `category-ipc.js` - IPC处理函数

3. **前端Store** ✓
   - 创建了 `src/renderer/stores/category.js` - Pinia Store

4. **前端UI组件** ✓
   - 创建了 `CategorySelector.vue` - 分类选择器组件
   - 创建了 `CategoryManageDialog.vue` - 分类管理对话框

---

## 📋 需要完成的集成步骤

### 步骤 1: 在 main/index.js 中注册 CategoryIPC

在 `desktop-app-vue/src/main/index.js` 文件中找到注册其他IPC处理函数的位置（大约在 750 行附近，`fileIPC.registerHandlers` 之后），添加以下代码：

```javascript
// 注册项目分类管理IPC handlers
if (!this.categoryIPCRegistered) {
  try {
    console.log('注册项目分类管理IPC handlers...');
    const { registerCategoryIPCHandlers } = require('./category-ipc');
    registerCategoryIPCHandlers(this.database, this.mainWindow);
    this.categoryIPCRegistered = true;
    console.log('项目分类管理IPC handlers注册成功');
  } catch (error) {
    console.error('项目分类管理IPC handlers注册失败:', error);
  }
}
```

### 步骤 2: 在 main/index.js 中添加 electronAPI 接口

找到 `electronAPI` 的定义位置（通常在 contextBridge.exposeInMainWorld 调用中），添加 category 相关的 API：

```javascript
category: {
  initializeDefaults: (userId) => ipcRenderer.invoke('category:initialize-defaults', userId),
  getAll: (userId) => ipcRenderer.invoke('category:get-all', userId),
  get: (categoryId) => ipcRenderer.invoke('category:get', categoryId),
  create: (categoryData) => ipcRenderer.invoke('category:create', categoryData),
  update: (categoryId, updates) => ipcRenderer.invoke('category:update', categoryId, updates),
  delete: (categoryId) => ipcRenderer.invoke('category:delete', categoryId),
  updateSort: (sortData) => ipcRenderer.invoke('category:update-sort', sortData),
},
```

### 步骤 3: 在项目创建页面中集成分类选择功能

在 `NewProjectPage.vue` 中：

```vue
<template>
  <!-- 在项目创建表单中添加分类选择 -->
  <a-form-item label="项目分类">
    <CategorySelector
      v-model="formData.category_id"
      :show-manage="true"
      @change="handleCategoryChange"
    />
  </a-form-item>
</template>

<script setup>
import CategorySelector from '@/components/projects/CategorySelector.vue';

// 表单数据中添加 category_id
const formData = ref({
  // ... 其他字段
  category_id: null,
});

// 处理分类变化
const handleCategoryChange = (category) => {
  console.log('选中的分类:', category);
  formData.value.category_id = category?.id || null;
};
</script>
```

### 步骤 4: 在项目列表页面中集成分类过滤功能

在项目列表页面（例如 `ProjectsListPage.vue`）中：

```vue
<template>
  <div class="projects-page">
    <!-- 顶部分类过滤器 -->
    <div class="filter-section">
      <CategorySelector
        v-model="filters.category_id"
        :show-all="true"
        @change="handleFilterChange"
      />
    </div>

    <!-- 项目列表 -->
    <div class="projects-grid">
      <!-- 项目卡片 -->
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { useProjectStore } from '@/stores/project';
import CategorySelector from '@/components/projects/CategorySelector.vue';

const projectStore = useProjectStore();

const filters = ref({
  category_id: null,
  // ... 其他过滤条件
});

// 处理分类过滤变化
const handleFilterChange = (category) => {
  console.log('过滤分类:', category);
  filters.value.category_id = category?.id || null;
  // 刷新项目列表
  fetchProjects();
};

// 获取项目列表（应用分类过滤）
const fetchProjects = async () => {
  // 在查询时添加 category_id 过滤
  // ...
};
</script>
```

### 步骤 5: 更新 project store 以支持分类过滤

在 `src/renderer/stores/project.js` 中，更新 `filters` 和 `filteredProjects`：

```javascript
state: () => ({
  // ... 其他状态
  filters: {
    projectType: '',
    status: '',
    tags: [],
    searchKeyword: '',
    category_id: '', // 添加分类过滤
  },
}),

getters: {
  filteredProjects: (state) => {
    let result = [...state.projects];

    // ... 其他过滤逻辑

    // 添加分类过滤
    if (state.filters.category_id) {
      result = result.filter((p) => p.category_id === state.filters.category_id);
    }

    return result;
  },
}
```

---

## 🎨 UI 参考

根据你提供的截图，分类选择器的样式已经实现：
- **一级分类**：写作、营销、Excel、简历、PPT、研究、教育、生活、播客、设计、网页
- **二级分类**：全部模板、办公文档、商业、技术、活动、财务、分析、求职

这些默认分类会在首次运行时自动初始化。

---

## 🔧 测试步骤

1. 启动应用后，分类会自动初始化
2. 在项目创建页面，可以看到分类选择器
3. 点击一级分类，会显示对应的二级分类
4. 点击"管理分类"按钮，可以添加、编辑、删除分类
5. 在项目列表页面，使用分类过滤器筛选项目

---

## 📝 注意事项

1. **数据库迁移**：首次运行时会自动创建 `project_categories` 表和默认分类数据
2. **用户隔离**：每个用户（userId）都有自己的分类数据
3. **级联删除**：删除一级分类时，会检查是否有子分类和关联项目
4. **软删除**：分类删除使用软删除机制，数据不会立即物理删除

---

## 🐛 常见问题

**Q: electronAPI.category 未定义？**
A: 确保在 main/index.js 中正确添加了 electronAPI 的 category 接口定义。

**Q: 分类列表为空？**
A: 检查是否调用了 `categoryStore.initializeDefaults()` 来初始化默认分类。

**Q: IPC 调用失败？**
A: 确保在 main/index.js 中注册了 CategoryIPC 处理函数。

---

## 📚 相关文件

- **数据库**: `src/main/database.js` (line 385-400, 1126-1135)
- **业务逻辑**: `src/main/category-manager.js`
- **IPC处理**: `src/main/category-ipc.js`
- **前端Store**: `src/renderer/stores/category.js`
- **UI组件**:
  - `src/renderer/components/projects/CategorySelector.vue`
  - `src/renderer/components/projects/CategoryManageDialog.vue`

---

完成以上步骤后，项目分类管理功能即可正常使用！🎉
