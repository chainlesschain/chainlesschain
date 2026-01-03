# 项目分类菜单完整集成指南

## 📋 需要修改的3个位置

### 1️⃣ 添加菜单项（MainLayout.vue）

**文件**: `src/renderer/components/MainLayout.vue`
**位置**: 第 36 行之前

在"我的项目"菜单项**上方**添加：

```vue
<a-menu-item key="project-categories">
  <template #icon><AppstoreOutlined /></template>
  项目分类
</a-menu-item>
```

**完整代码（第 30-42 行）**:

```vue
<a-sub-menu key="project-management">
  <template #icon><FolderOutlined /></template>
  <template #title>
    <span>项目管理</span>
    <a-badge count="核心" :number-style="{ backgroundColor: '#52c41a', fontSize: '10px', padding: '0 4px' }" style="margin-left: 8px" />
  </template>

  <!-- ✨ 在这里添加 ✨ -->
  <a-menu-item key="project-categories">
    <template #icon><AppstoreOutlined /></template>
    项目分类
  </a-menu-item>

  <a-menu-item key="projects">
    <template #icon><FolderOpenOutlined /></template>
    我的项目
  </a-menu-item>
  <!-- ... 其他菜单项 -->
</a-sub-menu>
```

---

### 2️⃣ 添加menuConfig配置（MainLayout.vue）

**文件**: `src/renderer/components/MainLayout.vue`
**位置**: 大约第 365-367 行

在 `menuConfig` 对象的 `projects` 配置**之前**添加：

```javascript
// 菜单配置
const menuConfig = {
  // 项目管理模块
  'project-categories': { path: '/projects/categories', title: '项目分类' },  // ✨ 添加这一行
  projects: { path: '/projects', title: '我的项目' },
  'template-management': { path: '/template-management', title: '模板管理' },
  // ... 其他配置
};
```

---

### 3️⃣ 添加路由配置（router/index.js）

**文件**: `src/renderer/router/index.js`
**位置**: 大约第 138 行，在 `projects` 路由**之前**

```javascript
// 项目管理模块
{
  path: 'projects/categories',  // ✨ 添加这个路由
  name: 'ProjectCategories',
  component: () => import('../pages/projects/CategoryManagePage.vue'),
  meta: { title: '项目分类' },
},
{
  path: 'projects',
  name: 'Projects',
  component: () => import('../pages/projects/ProjectsPage.vue'),
  meta: { title: '我的项目' },
},
```

**重要**: `projects/categories` 必须在 `projects` 之前，否则会被 `projects/:id` 匹配！

---

## 🔍 快速验证

修改完成后，可以通过以下方式验证：

1. **查找验证**:
```bash
# 验证菜单项已添加
grep -n "project-categories" src/renderer/components/MainLayout.vue

# 应该显示2行：
# - 菜单项定义（<a-menu-item key="project-categories">）
# - menuConfig配置（'project-categories': { path: ...）
```

2. **运行测试**:
```bash
npm run dev
```

3. **手动测试**:
   - 点击左侧菜单"项目管理"
   - 应该能看到"项目分类"菜单项在"我的项目"上方
   - 点击"项目分类"，应该跳转到分类管理页面

---

## ✅ 检查清单

- [ ] MainLayout.vue 中添加了 `<a-menu-item key="project-categories">`
- [ ] MainLayout.vue 中添加了 `'project-categories': { path: '/projects/categories', ...}` 到 menuConfig
- [ ] router/index.js 中添加了 `projects/categories` 路由
- [ ] 确认 AppstoreOutlined 图标已导入（在 MainLayout.vue 的 import 语句中）
- [ ] 启动应用并测试菜单功能

---

## 📦 已创建的文件列表

所有需要的文件都已经创建好了：

### 后端文件
- ✅ `src/main/category-manager.js` - 分类业务逻辑
- ✅ `src/main/category-ipc.js` - IPC处理函数
- ✅ `src/main/database.js` - 数据库表已存在（project_categories）

### 前端文件
- ✅ `src/renderer/stores/category.js` - Pinia Store
- ✅ `src/renderer/pages/projects/CategoryManagePage.vue` - 分类管理页面
- ✅ `src/renderer/components/projects/CategorySelector.vue` - 分类选择器
- ✅ `src/renderer/components/projects/CategoryManageDialog.vue` - 分类管理对话框

---

## 🎯 效果演示

完成后，左侧菜单结构将是：

```
📁 项目管理 [核心]
  └─ 🗂️ 项目分类        ← 新增
  └─ 📂 我的项目
  └─ 🏷️ 模板管理
  └─ 🛒 项目市场
  └─ 👥 协作项目
  └─ 📥 已归档项目
```

点击"项目分类"后，将看到：
- 分类统计卡片（一级/二级分类数量）
- 可折叠的分类列表
- 添加、编辑、删除分类功能
- 图标、颜色、排序管理

---

## ⚠️ 常见问题

**Q: 找不到 AppstoreOutlined 图标？**

A: 在 MainLayout.vue 的 `<script setup>` 中添加导入：

```javascript
import {
  // ... 其他图标
  AppstoreOutlined,  // ← 添加这一行
  FolderOutlined,
  // ...
} from '@ant-design/icons-vue';
```

**Q: 点击菜单没有反应？**

A: 检查：
1. menuConfig 是否添加了 `'project-categories'` 配置
2. 路由是否正确添加
3. 浏览器控制台是否有错误

**Q: 分类列表为空？**

A: 点击页面上的"初始化默认分类"按钮，或在应用启动时会自动初始化。

---

## 📝 相关文档

- [CATEGORY_INTEGRATION_GUIDE.md](./CATEGORY_INTEGRATION_GUIDE.md) - 完整功能集成指南
- [ADD_CATEGORY_MENU.md](./ADD_CATEGORY_MENU.md) - 菜单添加详细说明
- [ROUTER_PATCH.md](./ROUTER_PATCH.md) - 路由配置补丁

---

完成这3个修改后，左侧菜单就会显示"项目分类"了！🎉
