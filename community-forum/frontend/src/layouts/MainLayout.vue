<template>
  <div class="main-layout">
    <!-- 顶部导航栏 -->
    <header class="header">
      <div class="container">
        <div class="header-content">
          <!-- Logo -->
          <router-link to="/" class="logo">
            <img src="@/assets/logo.png" alt="ChainlessChain" class="logo-img">
            <span class="logo-text">ChainlessChain社区</span>
          </router-link>

          <!-- 搜索框 -->
          <div class="search-box">
            <el-input
              v-model="searchKeyword"
              placeholder="搜索帖子、用户、标签..."
              :prefix-icon="Search"
              @keyup.enter="handleSearch"
            />
          </div>

          <!-- 右侧菜单 -->
          <div class="header-actions">
            <el-button
              v-if="!userStore.isLoggedIn"
              type="primary"
              @click="router.push('/login')"
            >
              登录
            </el-button>

            <template v-else>
              <!-- 发帖按钮 -->
              <el-button
                type="primary"
                :icon="EditPen"
                @click="router.push('/create')"
              >
                发帖
              </el-button>

              <!-- 通知 -->
              <el-badge :value="unreadNotifications" :hidden="!unreadNotifications">
                <el-button
                  :icon="Bell"
                  circle
                  @click="router.push('/notifications')"
                />
              </el-badge>

              <!-- 用户菜单 -->
              <el-dropdown @command="handleCommand">
                <div class="user-avatar">
                  <el-avatar :src="userStore.user?.avatar" :size="36">
                    {{ userStore.user?.nickname?.[0] }}
                  </el-avatar>
                </div>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="profile">
                      <el-icon><User /></el-icon>
                      我的主页
                    </el-dropdown-item>
                    <el-dropdown-item command="favorites">
                      <el-icon><Star /></el-icon>
                      我的收藏
                    </el-dropdown-item>
                    <el-dropdown-item command="messages">
                      <el-icon><ChatDotRound /></el-icon>
                      私信
                    </el-dropdown-item>
                    <el-dropdown-item command="settings">
                      <el-icon><Setting /></el-icon>
                      设置
                    </el-dropdown-item>
                    <el-dropdown-item v-if="userStore.isAdmin" divided command="admin">
                      <el-icon><Tools /></el-icon>
                      管理后台
                    </el-dropdown-item>
                    <el-dropdown-item divided command="logout">
                      <el-icon><SwitchButton /></el-icon>
                      退出登录
                    </el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </template>

            <!-- 主题切换 -->
            <el-button
              :icon="isDark ? Sunny : Moon"
              circle
              @click="toggleDark"
            />
          </div>
        </div>
      </div>
    </header>

    <!-- 主要内容区域 -->
    <main class="main-content">
      <div class="container">
        <div class="content-wrapper">
          <!-- 左侧边栏 -->
          <aside class="sidebar-left">
            <el-menu
              :default-active="currentCategory"
              @select="handleCategorySelect"
            >
              <el-menu-item index="all">
                <el-icon><List /></el-icon>
                <span>全部</span>
              </el-menu-item>

              <el-menu-item
                v-for="category in categories"
                :key="category.id"
                :index="category.slug"
              >
                <el-icon>
                  <component :is="category.icon || 'Document'" />
                </el-icon>
                <span>{{ category.name }}</span>
                <el-tag size="small" style="margin-left: auto">
                  {{ category.postsCount }}
                </el-tag>
              </el-menu-item>
            </el-menu>

            <!-- 热门标签 -->
            <div class="hot-tags">
              <h3>热门标签</h3>
              <div class="tags-list">
                <el-tag
                  v-for="tag in hotTags"
                  :key="tag.id"
                  class="tag-item"
                  @click="router.push(`/tags/${tag.slug}`)"
                >
                  {{ tag.name }}
                </el-tag>
              </div>
            </div>
          </aside>

          <!-- 内容区域 -->
          <div class="content-main">
            <router-view />
          </div>

          <!-- 右侧边栏 -->
          <aside class="sidebar-right">
            <!-- 用户信息卡片 -->
            <div v-if="userStore.isLoggedIn" class="user-card">
              <div class="user-info">
                <el-avatar :src="userStore.user?.avatar" :size="60">
                  {{ userStore.user?.nickname?.[0] }}
                </el-avatar>
                <div class="user-meta">
                  <div class="username">{{ userStore.user?.nickname }}</div>
                  <div class="user-stats">
                    <span>积分: {{ userStore.user?.points }}</span>
                    <span>声望: {{ userStore.user?.reputation }}</span>
                  </div>
                </div>
              </div>
              <div class="user-actions">
                <el-button size="small" @click="router.push('/profile')">
                  查看主页
                </el-button>
              </div>
            </div>

            <!-- 社区统计 -->
            <div class="stats-card">
              <h3>社区统计</h3>
              <div class="stats-list">
                <div class="stat-item">
                  <span class="stat-label">帖子总数</span>
                  <span class="stat-value">{{ stats.postsCount }}</span>
                </div>
                <div class="stat-item">
                  <span class="stat-label">用户总数</span>
                  <span class="stat-value">{{ stats.usersCount }}</span>
                </div>
                <div class="stat-item">
                  <span class="stat-label">今日发帖</span>
                  <span class="stat-value">{{ stats.todayPosts }}</span>
                </div>
              </div>
            </div>

            <!-- 快捷链接 -->
            <div class="links-card">
              <h3>快捷链接</h3>
              <div class="links-list">
                <a href="https://www.chainlesschain.com" target="_blank">官方网站</a>
                <a href="https://docs.chainlesschain.com" target="_blank">帮助文档</a>
                <a href="https://github.com/chainlesschain" target="_blank">GitHub</a>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </main>

    <!-- 底部 -->
    <footer class="footer">
      <div class="container">
        <div class="footer-content">
          <div class="copyright">
            © 2024 ChainlessChain Team. All Rights Reserved.
          </div>
          <div class="footer-links">
            <a href="#">关于我们</a>
            <a href="#">隐私政策</a>
            <a href="#">服务条款</a>
            <a href="#">联系我们</a>
          </div>
        </div>
      </div>
    </footer>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { useDark, useToggle } from '@vueuse/core'
import {
  Search, Bell, EditPen, User, Star, ChatDotRound,
  Setting, Tools, SwitchButton, Sunny, Moon, List, Document
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'

const router = useRouter()
const userStore = useUserStore()

const searchKeyword = ref('')
const currentCategory = ref('all')
const unreadNotifications = ref(0)
const isDark = useDark()
const toggleDark = useToggle(isDark)

// 分类列表
const categories = ref([
  { id: 1, name: '问答', slug: 'qa', icon: 'QuestionFilled', postsCount: 125 },
  { id: 2, name: '讨论', slug: 'discussion', icon: 'ChatDotRound', postsCount: 342 },
  { id: 3, name: '反馈', slug: 'feedback', icon: 'MessageBox', postsCount: 68 },
  { id: 4, name: '公告', slug: 'announcement', icon: 'BellFilled', postsCount: 12 }
])

// 热门标签
const hotTags = ref([
  { id: 1, name: 'U盾', slug: 'ukey' },
  { id: 2, name: 'SIMKey', slug: 'simkey' },
  { id: 3, name: '安装', slug: 'installation' },
  { id: 4, name: 'Bug', slug: 'bug' },
  { id: 5, name: 'AI', slug: 'ai' }
])

// 社区统计
const stats = ref({
  postsCount: 547,
  usersCount: 1234,
  todayPosts: 23
})

// 处理搜索
const handleSearch = () => {
  if (searchKeyword.value.trim()) {
    router.push({ name: 'Search', query: { q: searchKeyword.value } })
  }
}

// 处理分类选择
const handleCategorySelect = (slug) => {
  if (slug === 'all') {
    router.push('/')
  } else {
    router.push(`/categories/${slug}`)
  }
}

// 处理用户菜单命令
const handleCommand = async (command) => {
  switch (command) {
    case 'profile':
      router.push('/profile')
      break
    case 'favorites':
      router.push('/favorites')
      break
    case 'messages':
      router.push('/messages')
      break
    case 'settings':
      router.push('/settings')
      break
    case 'admin':
      router.push('/admin')
      break
    case 'logout':
      try {
        await ElMessageBox.confirm('确定要退出登录吗？', '提示', {
          confirmButtonText: '确定',
          cancelButtonText: '取消',
          type: 'warning'
        })
        await userStore.logout()
        ElMessage.success('已退出登录')
        router.push('/')
      } catch (error) {
        // 用户取消
      }
      break
  }
}

onMounted(() => {
  // 加载未读通知数
  // TODO: 从API获取
})
</script>

<style scoped lang="scss">
.main-layout {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.header {
  background: var(--el-bg-color);
  border-bottom: 1px solid var(--el-border-color);
  position: sticky;
  top: 0;
  z-index: 1000;

  .header-content {
    display: flex;
    align-items: center;
    height: 60px;
    gap: 20px;
  }

  .logo {
    display: flex;
    align-items: center;
    gap: 10px;
    text-decoration: none;
    color: var(--el-text-color-primary);
    font-weight: 600;
    font-size: 18px;

    .logo-img {
      width: 32px;
      height: 32px;
    }
  }

  .search-box {
    flex: 1;
    max-width: 500px;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 12px;

    .user-avatar {
      cursor: pointer;
    }
  }
}

.main-content {
  flex: 1;
  padding: 20px 0;
}

.content-wrapper {
  display: grid;
  grid-template-columns: 200px 1fr 280px;
  gap: 20px;
}

.sidebar-left {
  .el-menu {
    border: none;
  }

  .hot-tags {
    margin-top: 20px;
    padding: 16px;
    background: var(--el-bg-color);
    border-radius: 8px;

    h3 {
      font-size: 14px;
      margin-bottom: 12px;
    }

    .tags-list {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;

      .tag-item {
        cursor: pointer;
      }
    }
  }
}

.content-main {
  min-height: 600px;
}

.sidebar-right {
  .user-card,
  .stats-card,
  .links-card {
    padding: 16px;
    background: var(--el-bg-color);
    border-radius: 8px;
    margin-bottom: 16px;

    h3 {
      font-size: 14px;
      margin-bottom: 12px;
    }
  }

  .user-card {
    .user-info {
      display: flex;
      gap: 12px;
      margin-bottom: 16px;

      .user-meta {
        flex: 1;

        .username {
          font-weight: 600;
          margin-bottom: 8px;
        }

        .user-stats {
          display: flex;
          gap: 12px;
          font-size: 12px;
          color: var(--el-text-color-secondary);
        }
      }
    }

    .user-actions {
      .el-button {
        width: 100%;
      }
    }
  }

  .stats-card {
    .stats-list {
      .stat-item {
        display: flex;
        justify-content: space-between;
        padding: 8px 0;
        border-bottom: 1px solid var(--el-border-color-lighter);

        &:last-child {
          border-bottom: none;
        }

        .stat-label {
          color: var(--el-text-color-secondary);
        }

        .stat-value {
          font-weight: 600;
          color: var(--el-color-primary);
        }
      }
    }
  }

  .links-card {
    .links-list {
      display: flex;
      flex-direction: column;
      gap: 8px;

      a {
        color: var(--el-text-color-regular);
        text-decoration: none;

        &:hover {
          color: var(--el-color-primary);
        }
      }
    }
  }
}

.footer {
  background: var(--el-bg-color);
  border-top: 1px solid var(--el-border-color);
  padding: 20px 0;
  margin-top: auto;

  .footer-content {
    display: flex;
    justify-content: space-between;
    align-items: center;

    .copyright {
      color: var(--el-text-color-secondary);
      font-size: 14px;
    }

    .footer-links {
      display: flex;
      gap: 20px;

      a {
        color: var(--el-text-color-secondary);
        text-decoration: none;
        font-size: 14px;

        &:hover {
          color: var(--el-color-primary);
        }
      }
    }
  }
}

.container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 20px;
}

@media (max-width: 1024px) {
  .content-wrapper {
    grid-template-columns: 1fr;
  }

  .sidebar-left,
  .sidebar-right {
    display: none;
  }
}
</style>
