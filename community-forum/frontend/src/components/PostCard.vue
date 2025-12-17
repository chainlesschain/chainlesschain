<template>
  <div :class="['post-card', `view-${viewMode}`]" @click="handleClick">
    <!-- 列表视图 -->
    <template v-if="viewMode === 'list'">
      <div class="post-avatar">
        <el-avatar :src="post.author?.avatar" :size="48">
          {{ post.author?.nickname?.[0] || 'U' }}
        </el-avatar>
      </div>

      <div class="post-content">
        <div class="post-header">
          <h3 class="post-title">
            {{ post.title }}
            <el-tag v-if="post.isPinned" type="danger" size="small">置顶</el-tag>
            <el-tag v-if="post.isResolved" type="success" size="small">已解决</el-tag>
          </h3>
          <div class="post-meta">
            <span class="author">{{ post.author?.nickname || '匿名用户' }}</span>
            <span class="separator">·</span>
            <span class="time">{{ formatTime(post.createdAt) }}</span>
            <span class="separator">·</span>
            <router-link :to="`/categories/${post.category?.slug}`" class="category" @click.stop>
              {{ post.category?.name }}
            </router-link>
          </div>
        </div>

        <div class="post-excerpt" v-if="post.excerpt">
          {{ post.excerpt }}
        </div>

        <div class="post-tags" v-if="post.tags && post.tags.length > 0">
          <el-tag
            v-for="tag in post.tags.slice(0, 5)"
            :key="tag.id"
            size="small"
            @click.stop="handleTagClick(tag.slug)"
          >
            {{ tag.name }}
          </el-tag>
        </div>
      </div>

      <div class="post-stats">
        <div class="stat-item">
          <el-icon><View /></el-icon>
          <span>{{ formatNumber(post.viewsCount || 0) }}</span>
        </div>
        <div class="stat-item">
          <el-icon><ChatDotRound /></el-icon>
          <span>{{ formatNumber(post.repliesCount || 0) }}</span>
        </div>
        <div class="stat-item">
          <el-icon><Star /></el-icon>
          <span>{{ formatNumber(post.likesCount || 0) }}</span>
        </div>
      </div>
    </template>

    <!-- 网格视图 -->
    <template v-else>
      <div class="grid-header">
        <el-avatar :src="post.author?.avatar" :size="32">
          {{ post.author?.nickname?.[0] || 'U' }}
        </el-avatar>
        <div class="grid-meta">
          <span class="author">{{ post.author?.nickname || '匿名用户' }}</span>
          <span class="time">{{ formatTime(post.createdAt) }}</span>
        </div>
      </div>

      <h3 class="grid-title">
        {{ post.title }}
      </h3>

      <div class="grid-excerpt" v-if="post.excerpt">
        {{ post.excerpt }}
      </div>

      <div class="grid-footer">
        <div class="grid-category">
          <router-link :to="`/categories/${post.category?.slug}`" @click.stop>
            {{ post.category?.name }}
          </router-link>
        </div>
        <div class="grid-stats">
          <span><el-icon><View /></el-icon>{{ formatNumber(post.viewsCount || 0) }}</span>
          <span><el-icon><ChatDotRound /></el-icon>{{ formatNumber(post.repliesCount || 0) }}</span>
          <span><el-icon><Star /></el-icon>{{ formatNumber(post.likesCount || 0) }}</span>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { useRouter } from 'vue-router'
import { View, ChatDotRound, Star } from '@element-plus/icons-vue'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/zh-cn'

dayjs.extend(relativeTime)
dayjs.locale('zh-cn')

const props = defineProps({
  post: {
    type: Object,
    required: true
  },
  viewMode: {
    type: String,
    default: 'list'
  }
})

const router = useRouter()

// 格式化时间
const formatTime = (time) => {
  if (!time) return ''
  try {
    return dayjs(time).fromNow()
  } catch {
    return ''
  }
}

// 格式化数字
const formatNumber = (num) => {
  if (num >= 10000) {
    return (num / 10000).toFixed(1) + 'w'
  } else if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'k'
  }
  return num.toString()
}

// 点击帖子
const handleClick = () => {
  router.push(`/posts/${props.post.id}`)
}

// 点击标签
const handleTagClick = (slug) => {
  router.push(`/tags/${slug}`)
}
</script>

<style scoped lang="scss">
.post-card {
  cursor: pointer;
  transition: background-color 0.2s;

  &:hover {
    background-color: var(--el-fill-color-light);
  }

  &.view-list {
    display: flex;
    gap: 16px;
    padding: 16px;

    .post-avatar {
      flex-shrink: 0;
    }

    .post-content {
      flex: 1;
      min-width: 0;

      .post-header {
        margin-bottom: 8px;

        .post-title {
          margin: 0 0 4px;
          font-size: 16px;
          font-weight: 600;
          color: var(--el-text-color-primary);
          display: flex;
          align-items: center;
          gap: 8px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;

          .el-tag {
            flex-shrink: 0;
          }
        }

        .post-meta {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 13px;
          color: var(--el-text-color-secondary);

          .author {
            font-weight: 500;
          }

          .separator {
            color: var(--el-text-color-disabled);
          }

          .category {
            color: var(--el-color-primary);
            text-decoration: none;

            &:hover {
              text-decoration: underline;
            }
          }
        }
      }

      .post-excerpt {
        margin-bottom: 8px;
        font-size: 14px;
        color: var(--el-text-color-regular);
        line-height: 1.5;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      .post-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
    }

    .post-stats {
      display: flex;
      flex-direction: column;
      gap: 8px;
      align-items: flex-end;
      justify-content: center;
      flex-shrink: 0;

      .stat-item {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 13px;
        color: var(--el-text-color-secondary);
        white-space: nowrap;

        .el-icon {
          font-size: 16px;
        }
      }
    }
  }

  &.view-grid {
    display: flex;
    flex-direction: column;
    padding: 16px;
    border: 1px solid var(--el-border-color);
    border-radius: 8px;

    .grid-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 12px;

      .grid-meta {
        display: flex;
        flex-direction: column;
        font-size: 12px;

        .author {
          font-weight: 500;
          color: var(--el-text-color-primary);
        }

        .time {
          color: var(--el-text-color-secondary);
        }
      }
    }

    .grid-title {
      margin: 0 0 8px;
      font-size: 16px;
      font-weight: 600;
      color: var(--el-text-color-primary);
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .grid-excerpt {
      margin-bottom: 12px;
      font-size: 14px;
      color: var(--el-text-color-regular);
      line-height: 1.5;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
      flex: 1;
    }

    .grid-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-top: 12px;
      border-top: 1px solid var(--el-border-color-lighter);

      .grid-category {
        a {
          font-size: 12px;
          color: var(--el-color-primary);
          text-decoration: none;

          &:hover {
            text-decoration: underline;
          }
        }
      }

      .grid-stats {
        display: flex;
        gap: 12px;
        font-size: 12px;
        color: var(--el-text-color-secondary);

        span {
          display: flex;
          align-items: center;
          gap: 2px;

          .el-icon {
            font-size: 14px;
          }
        }
      }
    }
  }
}

@media (max-width: 768px) {
  .post-card.view-list {
    flex-direction: column;

    .post-stats {
      flex-direction: row;
      align-items: center;
      justify-content: flex-start;
    }
  }
}
</style>
