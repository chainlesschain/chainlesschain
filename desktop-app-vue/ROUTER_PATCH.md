# 路由配置补丁

## 在 src/renderer/router/index.js 中添加项目分类路由

在第 137 行的 `// 项目管理模块` 注释下方，**在 `projects` 路由之前**添加以下路由配置：

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
```

## 完整上下文（第 137-149 行）

```javascript
      // 项目管理模块
      {
        path: 'projects/categories',  // ✨ 新增这个路由
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

**注意**: `projects/categories` 路由必须在 `projects` 路由之前，否则会被 `projects/:id` 匹配。
