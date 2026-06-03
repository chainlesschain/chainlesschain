import { createRouter, createWebHistory } from 'vue-router'
import { useUserStore } from '@/stores/user'

const routes = [
  {
    path: '/',
    component: () => import('@/layouts/MainLayout.vue'),
    children: [
      {
        path: '',
        name: 'Home',
        component: () => import('@/views/Home.vue'),
        meta: { title: '首页' }
      },
      {
        path: 'categories/:slug',
        name: 'Category',
        component: () => import('@/views/Category.vue'),
        meta: { title: '分类' }
      },
      {
        path: 'tags/:slug',
        name: 'Tag',
        component: () => import('@/views/Tag.vue'),
        meta: { title: '标签' }
      },
      {
        path: 'posts/:id',
        name: 'PostDetail',
        component: () => import('@/views/PostDetail.vue'),
        meta: { title: '帖子详情' }
      },
      {
        path: 'create',
        name: 'CreatePost',
        component: () => import('@/views/CreatePost.vue'),
        meta: { title: '发帖', requiresAuth: true }
      },
      {
        path: 'edit/:id',
        name: 'EditPost',
        component: () => import('@/views/EditPost.vue'),
        meta: { title: '编辑帖子', requiresAuth: true }
      },
      {
        path: 'users/:id',
        name: 'UserProfile',
        component: () => import('@/views/UserProfile.vue'),
        meta: { title: '用户主页' }
      },
      {
        path: 'profile',
        name: 'MyProfile',
        component: () => import('@/views/MyProfile.vue'),
        meta: { title: '我的主页', requiresAuth: true }
      },
      {
        path: 'notifications',
        name: 'Notifications',
        component: () => import('@/views/Notifications.vue'),
        meta: { title: '通知', requiresAuth: true }
      },
      {
        path: 'messages',
        name: 'Messages',
        component: () => import('@/views/Messages.vue'),
        meta: { title: '私信', requiresAuth: true }
      },
      {
        path: 'favorites',
        name: 'Favorites',
        component: () => import('@/views/Favorites.vue'),
        meta: { title: '我的收藏', requiresAuth: true }
      },
      {
        path: 'settings',
        name: 'Settings',
        component: () => import('@/views/Settings.vue'),
        meta: { title: '设置', requiresAuth: true }
      },
      {
        path: 'search',
        name: 'Search',
        component: () => import('@/views/Search.vue'),
        meta: { title: '搜索' }
      }
    ]
  },
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/Login.vue'),
    meta: { title: '登录' }
  },
  {
    path: '/admin',
    component: () => import('@/layouts/AdminLayout.vue'),
    meta: { requiresAuth: true, requiresAdmin: true },
    children: [
      {
        path: '',
        name: 'AdminDashboard',
        component: () => import('@/views/admin/AdminDashboard.vue'),
        meta: { title: '数据概览' }
      },
      {
        path: 'users',
        name: 'AdminUsers',
        component: () => import('@/views/admin/AdminUsers.vue'),
        meta: { title: '用户管理' }
      },
      {
        path: 'posts',
        name: 'AdminPosts',
        component: () => import('@/views/admin/AdminPosts.vue'),
        meta: { title: '内容审核' }
      },
      {
        path: 'settings',
        name: 'AdminSettings',
        component: () => import('@/views/admin/AdminSettings.vue'),
        meta: { title: '系统设置' }
      }
    ]
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'NotFound',
    component: () => import('@/views/NotFound.vue'),
    meta: { title: '404' }
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior(to, from, savedPosition) {
    if (savedPosition) {
      return savedPosition
    } else {
      return { top: 0 }
    }
  }
})

// 路由守卫
router.beforeEach((to, from, next) => {
  const userStore = useUserStore()

  // 设置页面标题
  document.title = to.meta.title
    ? `${to.meta.title} - ChainlessChain社区`
    : 'ChainlessChain社区'

  // 需要登录
  if (to.meta.requiresAuth && !userStore.isLoggedIn) {
    next({ name: 'Login', query: { redirect: to.fullPath } })
    return
  }

  // 需要管理员权限
  if (to.meta.requiresAdmin && userStore.user?.role !== 'ADMIN') {
    next({ name: 'Home' })
    return
  }

  next()
})

export default router
