# 添加项目分类菜单到左侧导航栏

## 📍 需要修改的位置

### 1. 在 MainLayout.vue 中添加菜单项

**文件位置**: `src/renderer/components/MainLayout.vue`

**在第 36 行之前**（"我的项目"上方）添加以下代码：

```vue
<a-menu-item key="project-categories">
  <template #icon><AppstoreOutlined /></template>
  项目分类
</a-menu-item>
```

**完整示例**（第 30-42 行）：

```vue
<!-- 项目管理 ⭐核心模块 -->
<a-sub-menu key="project-management">
  <template #icon><FolderOutlined /></template>
  <template #title>
    <span>项目管理</span>
    <a-badge count="核心" :number-style="{ backgroundColor: '#52c41a', fontSize: '10px', padding: '0 4px' }" style="margin-left: 8px" />
  </template>

  <!-- ✨ 在这里添加项目分类菜单项 ✨ -->
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
  <!-- ... 其他菜单项 -->
</a-sub-menu>
```

### 2. 确保导入了 AppstoreOutlined 图标

在 `MainLayout.vue` 的 `<script setup>` 部分，确保导入了 `AppstoreOutlined`：

**查找位置**：大约在文件的 script setup 区域

```javascript
import {
  // ... 其他图标
  AppstoreOutlined,  // ✨ 确保这一行存在
  FolderOutlined,
  FolderOpenOutlined,
  // ... 其他图标
} from '@ant-design/icons-vue';
```

### 3. 在路由中添加分类管理页面路由

**文件位置**: `src/renderer/router/index.js` 或 `src/renderer/main.js`（取决于路由配置位置）

在路由配置中添加：

```javascript
{
  path: '/projects/categories',
  name: 'project-categories',
  component: () => import('@/pages/projects/CategoryManagePage.vue'),
  meta: {
    title: '项目分类',
  }
}
```

### 4. 在 MainLayout.vue 的菜单点击处理函数中添加路由跳转

在 `handleMenuClick` 函数中添加：

```javascript
const handleMenuClick = ({ key }) => {
  console.log('菜单点击:', key);

  const routes = {
    'home': '/',
    'projects': '/projects',
    'project-categories': '/projects/categories',  // ✨ 添加这一行
    'template-management': '/projects/templates',
    // ... 其他路由映射
  };

  const route = routes[key];
  if (route) {
    router.push(route);
  }
};
```

## ✅ 完成后的效果

点击左侧菜单"项目管理" → "项目分类"，将会打开项目分类管理页面，可以：

1. 查看所有一级和二级分类
2. 添加、编辑、删除分类
3. 查看分类统计信息
4. 管理分类的图标、颜色、排序等属性

## 🎯 快速测试

1. 启动应用：`npm run dev`
2. 点击左侧菜单"项目管理"
3. 点击"项目分类"菜单项
4. 如果首次使用，点击"初始化默认分类"按钮

## 📦 已创建的文件

- ✅ `CategoryManagePage.vue` - 分类管理页面（已创建）
- ✅ `CategorySelector.vue` - 分类选择器组件（已创建）
- ✅ `CategoryManageDialog.vue` - 分类管理对话框（已创建）
- ✅ `category.js` - Pinia Store（已创建）
- ✅ `category-manager.js` - 后端业务逻辑（已创建）
- ✅ `category-ipc.js` - IPC处理函数（已创建）

## 🔍 查找菜单相关代码的方法

如果不确定菜单代码位置，可以搜索以下关键字：

```bash
# 搜索"我的项目"菜单项
grep -r "我的项目" src/renderer/

# 搜索菜单配置
grep -r "project-management" src/renderer/

# 搜索 handleMenuClick 函数
grep -r "handleMenuClick" src/renderer/
```

---

完成以上 4 个步骤后，左侧菜单就会显示"项目分类"菜单项了！🎉
