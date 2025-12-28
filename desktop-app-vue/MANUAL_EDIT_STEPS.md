# 手动添加项目分类菜单 - 详细步骤

## ⚠️ 重要提示
请先**停止应用**（Ctrl+C），然后再修改文件，修改完成后重新启动应用。

---

## 📝 需要修改的文件

### 文件 1: `src/renderer/components/MainLayout.vue`

#### 步骤 1: 添加菜单项

**位置**: 找到第 36 行 `<a-menu-item key="projects">`

**在它的前面添加**（第 36-40 行）：

```vue
          <a-menu-item key="project-categories">
            <template #icon><AppstoreOutlined /></template>
            项目分类
          </a-menu-item>
```

**修改后的完整代码（第 32-44 行）**:

```vue
          <template #title>
            <span>项目管理</span>
            <a-badge count="核心" :number-style="{ backgroundColor: '#52c41a', fontSize: '10px', padding: '0 4px' }" style="margin-left: 8px" />
          </template>
          <a-menu-item key="project-categories">
            <template #icon><AppstoreOutlined /></template>
            项目分类
          </a-menu-item>
          <a-menu-item key="projects">
            <template #icon><FolderOpenOutlined /></template>
            我的项目
          </a-menu-item>
          <a-menu-item key="template-management">
            <template #icon><TagsOutlined /></template>
            模板管理
          </a-menu-item>
```

---

#### 步骤 2: 添加图标导入

**位置**: 找到第 337 行 `ArrowLeftOutlined,`

**在它的后面添加**：

```javascript
  AppstoreOutlined,
```

**修改后的完整代码（第 335-340 行）**:

```javascript
  ExclamationCircleOutlined,
  CloudSyncOutlined,
  ArrowLeftOutlined,
  AppstoreOutlined,
} from '@ant-design/icons-vue';
```

---

#### 步骤 3: 添加 menuConfig 配置

**位置**: 找到第 365-367 行

```javascript
const menuConfig = {
  // 项目管理模块
  projects: { path: '/projects', title: '我的项目' },
```

**在 `projects` 这一行的前面添加**：

```javascript
  'project-categories': { path: '/projects/categories', title: '项目分类' },
```

**修改后的完整代码（第 365-370 行）**:

```javascript
const menuConfig = {
  // 项目管理模块
  'project-categories': { path: '/projects/categories', title: '项目分类' },
  projects: { path: '/projects', title: '我的项目' },
  'template-management': { path: '/template-management', title: '模板管理' },
  'project-market': { path: '/projects/market', title: '项目市场' },
```

---

### 文件 2: `src/renderer/router/index.js`

#### 步骤 4: 添加路由配置

**位置**: 找到第 137-143 行

```javascript
      // 项目管理模块
      {
        path: 'projects',
        name: 'Projects',
        component: () => import('../pages/projects/ProjectsPage.vue'),
        meta: { title: '我的项目' },
      },
```

**在 `projects` 路由的前面添加**：

```javascript
      {
        path: 'projects/categories',
        name: 'ProjectCategories',
        component: () => import('../pages/projects/CategoryManagePage.vue'),
        meta: { title: '项目分类' },
      },
```

**修改后的完整代码（第 137-149 行）**:

```javascript
      // 项目管理模块
      {
        path: 'projects/categories',
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
      {
        path: 'projects/new',
        name: 'NewProject',
        component: () => import('../pages/projects/NewProjectPage.vue'),
        meta: { title: '新建项目' },
      },
```

---

## ✅ 完成后

1. 保存所有修改的文件
2. 重新启动应用：`npm run dev`
3. 点击左侧菜单"项目管理"
4. 应该能看到"项目分类"菜单项出现在"我的项目"上方

---

## 🔍 验证修改

修改完成后，可以用以下命令验证：

```bash
# 验证菜单项
grep -n "project-categories" src/renderer/components/MainLayout.vue

# 应该显示3行：
# - 菜单项 <a-menu-item key="project-categories">
# - menuConfig 配置
# - 可能还有其他地方

# 验证图标导入
grep "AppstoreOutlined" src/renderer/components/MainLayout.vue

# 验证路由
grep "ProjectCategories" src/renderer/router/index.js
```

---

## 📸 预期效果

左侧菜单应该显示为：

```
📁 项目管理 [核心]
  ├─ 🗂️ 项目分类  ← 新增
  ├─ 📂 我的项目
  ├─ 🏷️ 模板管理
  ├─ 🛒 项目市场
  ├─ 👥 协作项目
  └─ 📥 已归档项目
```

点击"项目分类"后会打开分类管理页面。

---

## ❓ 常见问题

**Q: 修改后没有生效？**
A: 确保先停止应用，修改文件后重新启动。

**Q: 显示 AppstoreOutlined is not defined？**
A: 检查步骤2的图标导入是否正确添加。

**Q: 点击菜单没有反应？**
A: 检查步骤3的menuConfig和步骤4的路由配置是否正确添加。

---

**如果遇到问题，可以随时询问！**
