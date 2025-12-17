<template>
  <div class="admin-layout">
    <!-- 侧边栏 -->
    <el-aside :width="isCollapse ? '64px' : '240px'" class="admin-sidebar">
      <div class="sidebar-header">
        <router-link to="/" class="logo">
          <el-icon v-if="!isCollapse" :size="24"><Platform /></el-icon>
          <span v-if="!isCollapse">管理后台</span>
        </router-link>
      </div>

      <el-menu
        :default-active="activeMenu"
        :collapse="isCollapse"
        :collapse-transition="false"
        :router="true"
        class="sidebar-menu"
      >
        <el-menu-item index="/admin">
          <el-icon><DataAnalysis /></el-icon>
          <template #title>数据概览</template>
        </el-menu-item>
        <el-menu-item index="/admin/users">
          <el-icon><User /></el-icon>
          <template #title>用户管理</template>
        </el-menu-item>
        <el-menu-item index="/admin/posts">
          <el-icon><Document /></el-icon>
          <template #title>内容审核</template>
        </el-menu-item>
        <el-menu-item index="/admin/settings">
          <el-icon><Setting /></el-icon>
          <template #title>系统设置</template>
        </el-menu-item>
      </el-menu>

      <div class="sidebar-footer">
        <el-button
          :icon="isCollapse ? Expand : Fold"
          text
          @click="toggleCollapse"
        >
          <span v-if="!isCollapse">收起菜单</span>
        </el-button>
      </div>
    </el-aside>

    <!-- 主内容区 -->
    <el-container class="admin-main">
      <!-- 顶部栏 -->
      <el-header class="admin-header" height="60px">
        <div class="header-left">
          <el-breadcrumb separator="/">
            <el-breadcrumb-item :to="{ path: '/' }">首页</el-breadcrumb-item>
            <el-breadcrumb-item :to="{ path: '/admin' }">管理后台</el-breadcrumb-item>
            <el-breadcrumb-item v-if="breadcrumb">{{ breadcrumb }}</el-breadcrumb-item>
          </el-breadcrumb>
        </div>

        <div class="header-right">
          <el-button :icon="Monitor" text @click="goToFrontend">
            返回前台
          </el-button>
          <el-divider direction="vertical" />
          <el-dropdown @command="handleCommand">
            <div class="user-info">
              <el-avatar :size="32" :src="userStore.user?.avatar" />
              <span class="user-name">{{ userStore.user?.nickname || '管理员' }}</span>
            </div>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="profile">个人中心</el-dropdown-item>
                <el-dropdown-item command="settings">设置</el-dropdown-item>
                <el-dropdown-item divided command="logout">退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </el-header>

      <!-- 内容区 -->
      <el-main class="admin-content">
        <router-view v-slot="{ Component }">
          <transition name="fade-transform" mode="out-in">
            <component :is="Component" />
          </transition>
        </router-view>
      </el-main>
    </el-container>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Platform, DataAnalysis, User, Document, Setting,
  Expand, Fold, Monitor
} from '@element-plus/icons-vue'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

const isCollapse = ref(false)
const activeMenu = computed(() => route.path)

// 面包屑
const breadcrumb = computed(() => {
  const titles = {
    '/admin': '',
    '/admin/users': '用户管理',
    '/admin/posts': '内容审核',
    '/admin/settings': '系统设置'
  }
  return titles[route.path] || ''
})

// 切换侧边栏
const toggleCollapse = () => {
  isCollapse.value = !isCollapse.value
}

// 返回前台
const goToFrontend = () => {
  router.push('/')
}

// 用户操作
const handleCommand = async (command) => {
  switch (command) {
    case 'profile':
      router.push('/profile')
      break
    case 'settings':
      router.push('/settings')
      break
    case 'logout':
      try {
        await ElMessageBox.confirm('确定要退出登录吗？', '提示', {
          confirmButtonText: '确定',
          cancelButtonText: '取消',
          type: 'warning'
        })
        userStore.logout()
        router.push('/login')
        ElMessage.success('已退出登录')
      } catch {
        // 取消
      }
      break
  }
}
</script>

<style scoped lang="scss">
.admin-layout {
  display: flex;
  min-height: 100vh;
  background: var(--el-bg-color-page);
}

.admin-sidebar {
  display: flex;
  flex-direction: column;
  background: white;
  border-right: 1px solid var(--el-border-color);
  transition: width 0.3s;
  overflow: hidden;

  .sidebar-header {
    height: 60px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-bottom: 1px solid var(--el-border-color);
    padding: 0 16px;

    .logo {
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 18px;
      font-weight: 700;
      color: var(--el-text-color-primary);
      text-decoration: none;
      white-space: nowrap;
    }
  }

  .sidebar-menu {
    flex: 1;
    border: none;
    overflow-y: auto;

    :deep(.el-menu-item) {
      font-size: 14px;
    }
  }

  .sidebar-footer {
    padding: 16px;
    border-top: 1px solid var(--el-border-color);

    .el-button {
      width: 100%;
      justify-content: flex-start;
    }
  }
}

.admin-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.admin-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 24px;
  background: white;
  border-bottom: 1px solid var(--el-border-color);

  .header-left {
    flex: 1;
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 16px;

    .user-info {
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      padding: 4px 8px;
      border-radius: 4px;
      transition: background 0.3s;

      &:hover {
        background: var(--el-fill-color-light);
      }

      .user-name {
        font-size: 14px;
        color: var(--el-text-color-primary);
      }
    }
  }
}

.admin-content {
  flex: 1;
  overflow-y: auto;
  background: var(--el-bg-color-page);
  padding: 0;
}

// 过渡动画
.fade-transform-enter-active,
.fade-transform-leave-active {
  transition: all 0.3s;
}

.fade-transform-enter-from {
  opacity: 0;
  transform: translateX(-10px);
}

.fade-transform-leave-to {
  opacity: 0;
  transform: translateX(10px);
}

@media (max-width: 768px) {
  .admin-sidebar {
    position: fixed;
    left: 0;
    top: 0;
    bottom: 0;
    z-index: 1000;
  }

  .admin-main {
    margin-left: 64px;
  }
}
</style>
