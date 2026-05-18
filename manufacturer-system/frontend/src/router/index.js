import { createRouter, createWebHistory } from 'vue-router'
import Layout from '@/layout/MainLayout.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/login',
      name: 'Login',
      component: () => import('@/views/Login.vue')
    },
    {
      path: '/',
      component: Layout,
      redirect: '/dashboard',
      children: [
        {
          path: 'dashboard',
          name: 'Dashboard',
          component: () => import('@/views/Dashboard.vue'),
          meta: { title: '控制台' }
        },
        {
          path: 'devices',
          name: 'Devices',
          component: () => import('@/views/device/DeviceList.vue'),
          meta: { title: '设备管理' }
        },
        {
          path: 'devices/register',
          name: 'DeviceRegister',
          component: () => import('@/views/device/DeviceRegister.vue'),
          meta: { title: '注册设备' }
        },
        {
          path: 'app-versions',
          name: 'AppVersions',
          component: () => import('@/views/app/AppVersionList.vue'),
          meta: { title: 'APP版本管理' }
        },
        {
          path: 'app-versions/upload',
          name: 'AppVersionUpload',
          component: () => import('@/views/app/AppVersionUpload.vue'),
          meta: { title: '上传版本' }
        },
        {
          path: 'backups',
          name: 'Backups',
          component: () => import('@/views/backup/BackupList.vue'),
          meta: { title: '备份管理' }
        },
        {
          path: 'users',
          name: 'Users',
          component: () => import('@/views/user/UserList.vue'),
          meta: { title: '用户管理' }
        },
        {
          path: 'logs',
          name: 'Logs',
          component: () => import('@/views/log/LogList.vue'),
          meta: { title: '操作日志' }
        }
      ]
    }
  ]
})

// 路由守卫
router.beforeEach((to, from, next) => {
  const token = localStorage.getItem('token')
  if (to.path !== '/login' && !token) {
    next('/login')
  } else {
    next()
  }
})

export default router
