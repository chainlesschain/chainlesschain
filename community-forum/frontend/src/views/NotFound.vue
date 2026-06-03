<template>
  <div class="not-found-page">
    <div class="not-found-content">
      <!-- 404图标 -->
      <div class="error-icon">
        <el-icon :size="120" color="var(--el-color-primary)">
          <WarningFilled />
        </el-icon>
      </div>

      <!-- 错误信息 -->
      <h1 class="error-code">404</h1>
      <h2 class="error-title">页面未找到</h2>
      <p class="error-message">
        抱歉，您访问的页面不存在或已被删除。
      </p>

      <!-- 操作按钮 -->
      <div class="actions">
        <el-button
          type="primary"
          size="large"
          :icon="HomeFilled"
          @click="router.push('/')"
        >
          返回首页
        </el-button>
        <el-button
          size="large"
          :icon="Back"
          @click="router.back()"
        >
          返回上页
        </el-button>
      </div>

      <!-- 建议链接 -->
      <div class="suggestions">
        <p class="suggestions-title">您可能想要：</p>
        <div class="suggestion-links">
          <router-link to="/">
            <el-icon><HomeFilled /></el-icon>
            访问首页
          </router-link>
          <router-link to="/search">
            <el-icon><Search /></el-icon>
            搜索内容
          </router-link>
          <router-link to="/categories/qa">
            <el-icon><QuestionFilled /></el-icon>
            浏览问答
          </router-link>
          <router-link to="/create" v-if="userStore.isLoggedIn">
            <el-icon><EditPen /></el-icon>
            发布帖子
          </router-link>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'
import {
  WarningFilled, HomeFilled, Back, Search, QuestionFilled, EditPen
} from '@element-plus/icons-vue'

const router = useRouter()
const userStore = useUserStore()
</script>

<style scoped lang="scss">
.not-found-page {
  min-height: calc(100vh - 200px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
}

.not-found-content {
  max-width: 600px;
  text-align: center;

  .error-icon {
    margin-bottom: 24px;
    animation: bounce 2s infinite;
  }

  .error-code {
    margin: 0 0 16px;
    font-size: 96px;
    font-weight: 700;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .error-title {
    margin: 0 0 12px;
    font-size: 32px;
    font-weight: 600;
    color: var(--el-text-color-primary);
  }

  .error-message {
    margin: 0 0 32px;
    font-size: 16px;
    color: var(--el-text-color-secondary);
    line-height: 1.6;
  }

  .actions {
    display: flex;
    justify-content: center;
    gap: 16px;
    margin-bottom: 48px;
    flex-wrap: wrap;
  }

  .suggestions {
    padding-top: 32px;
    border-top: 1px solid var(--el-border-color);

    .suggestions-title {
      margin: 0 0 20px;
      font-size: 14px;
      color: var(--el-text-color-secondary);
    }

    .suggestion-links {
      display: flex;
      justify-content: center;
      gap: 24px;
      flex-wrap: wrap;

      a {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 16px;
        border-radius: 6px;
        color: var(--el-text-color-regular);
        text-decoration: none;
        transition: all 0.2s;

        &:hover {
          background: var(--el-fill-color-light);
          color: var(--el-color-primary);
        }

        .el-icon {
          font-size: 16px;
        }
      }
    }
  }
}

@keyframes bounce {
  0%, 20%, 50%, 80%, 100% {
    transform: translateY(0);
  }
  40% {
    transform: translateY(-20px);
  }
  60% {
    transform: translateY(-10px);
  }
}

@media (max-width: 768px) {
  .not-found-content {
    .error-code {
      font-size: 72px;
    }

    .error-title {
      font-size: 24px;
    }

    .actions {
      flex-direction: column;

      .el-button {
        width: 100%;
      }
    }

    .suggestions {
      .suggestion-links {
        flex-direction: column;
        align-items: stretch;

        a {
          justify-content: center;
        }
      }
    }
  }
}
</style>
