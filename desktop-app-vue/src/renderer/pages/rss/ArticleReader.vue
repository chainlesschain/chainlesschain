<template>
  <div class="rss-article-reader">
    <a-row :gutter="16">
      <!-- 左侧：文章列表 -->
      <a-col :span="8">
        <a-card :bordered="false" style="height: calc(100vh - 100px); overflow-y: auto">
          <template #title>
            <a-space>
              <a-button type="link" @click="goBack">
                <ArrowLeftOutlined />
              </a-button>
              <span>{{ feedTitle }}</span>
            </a-space>
          </template>

          <template #extra>
            <a-space>
              <a-dropdown>
                <a-button size="small">
                  <FilterOutlined /> 筛选
                </a-button>
                <template #overlay>
                  <a-menu @click="handleFilterChange">
                    <a-menu-item key="all">全部</a-menu-item>
                    <a-menu-item key="unread">未读</a-menu-item>
                    <a-menu-item key="starred">收藏</a-menu-item>
                  </a-menu>
                </template>
              </a-dropdown>
              <a-button size="small" @click="loadArticles">
                <ReloadOutlined />
              </a-button>
            </a-space>
          </template>

          <a-list
            :data-source="articles"
            :loading="loading"
            item-layout="vertical"
            size="small"
          >
            <template #renderItem="{ item }">
              <a-list-item
                :class="{ 'article-item': true, 'article-read': item.is_read, 'article-selected': selectedArticle?.id === item.id }"
                @click="selectArticle(item)"
                style="cursor: pointer"
              >
                <a-list-item-meta>
                  <template #title>
                    <a-space>
                      <StarFilled v-if="item.is_starred" style="color: #faad14" />
                      <span :style="{ fontWeight: item.is_read ? 'normal' : 'bold' }">
                        {{ item.title }}
                      </span>
                    </a-space>
                  </template>
                  <template #description>
                    <div class="article-meta">
                      <span v-if="item.author">{{ item.author }}</span>
                      <span>{{ formatTime(item.pub_date) }}</span>
                    </div>
                    <div class="article-description">
                      {{ item.description }}
                    </div>
                  </template>
                </a-list-item-meta>
              </a-list-item>
            </template>
          </a-list>
        </a-card>
      </a-col>

      <!-- 右侧：文章内容 -->
      <a-col :span="16">
        <a-card
          v-if="selectedArticle"
          :bordered="false"
          style="height: calc(100vh - 100px); overflow-y: auto"
        >
          <template #title>
            <div class="article-header">
              <h2>{{ selectedArticle.title }}</h2>
              <div class="article-info">
                <a-space>
                  <span v-if="selectedArticle.author">
                    <UserOutlined /> {{ selectedArticle.author }}
                  </span>
                  <span>
                    <ClockCircleOutlined /> {{ formatTime(selectedArticle.pub_date) }}
                  </span>
                  <a-tag v-for="cat in selectedArticle.categories" :key="cat">
                    {{ cat }}
                  </a-tag>
                </a-space>
              </div>
            </div>
          </template>

          <template #extra>
            <a-space>
              <a-tooltip :title="selectedArticle.is_starred ? '取消收藏' : '收藏'">
                <a-button
                  type="text"
                  @click="toggleStar"
                  :style="{ color: selectedArticle.is_starred ? '#faad14' : undefined }"
                >
                  <StarFilled v-if="selectedArticle.is_starred" />
                  <StarOutlined v-else />
                </a-button>
              </a-tooltip>

              <a-tooltip title="保存到知识库">
                <a-button type="text" @click="saveToKnowledge">
                  <SaveOutlined />
                </a-button>
              </a-tooltip>

              <a-tooltip title="在浏览器中打开">
                <a-button type="text" @click="openInBrowser">
                  <LinkOutlined />
                </a-button>
              </a-tooltip>

              <a-dropdown>
                <a-button type="text">
                  <MoreOutlined />
                </a-button>
                <template #overlay>
                  <a-menu @click="handleMenuClick">
                    <a-menu-item key="markRead">
                      <CheckOutlined /> 标记为已读
                    </a-menu-item>
                    <a-menu-item key="markUnread">
                      <EyeInvisibleOutlined /> 标记为未读
                    </a-menu-item>
                    <a-menu-divider />
                    <a-menu-item key="archive">
                      <InboxOutlined /> 归档
                    </a-menu-item>
                  </a-menu>
                </template>
              </a-dropdown>
            </a-space>
          </template>

          <!-- 文章内容 -->
          <div class="article-content" v-html="sanitizedContent"></div>

          <!-- 原文链接 -->
          <a-divider />
          <div class="article-footer">
            <a :href="selectedArticle.link" target="_blank">
              查看原文 <LinkOutlined />
            </a>
          </div>
        </a-card>

        <a-empty
          v-else
          description="请选择一篇文章"
          style="margin-top: 100px"
        />
      </a-col>
    </a-row>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { message } from 'ant-design-vue';
import DOMPurify from 'dompurify';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';
import {
  ArrowLeftOutlined,
  FilterOutlined,
  ReloadOutlined,
  StarFilled,
  StarOutlined,
  SaveOutlined,
  LinkOutlined,
  MoreOutlined,
  CheckOutlined,
  EyeInvisibleOutlined,
  InboxOutlined,
  UserOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons-vue';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

const route = useRoute();
const router = useRouter();

// 状态
const loading = ref(false);
const feedId = ref(route.params.feedId);
const feedTitle = ref('');
const articles = ref([]);
const selectedArticle = ref(null);
const filter = ref('all');

// 计算属性
const sanitizedContent = computed(() => {
  if (!selectedArticle.value) return '';

  const content = selectedArticle.value.content || selectedArticle.value.description;
  return DOMPurify.sanitize(content, {
    ALLOWED_TAGS: [
      'p', 'br', 'strong', 'em', 'u', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'ul', 'ol', 'li', 'a', 'img', 'blockquote', 'code', 'pre',
      'table', 'thead', 'tbody', 'tr', 'th', 'td'
    ],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class']
  });
});

// 方法
const loadFeed = async () => {
  try {
    const result = await window.electron.ipcRenderer.invoke('rss:get-feed', feedId.value);
    if (result.success) {
      feedTitle.value = result.feed.title;
    }
  } catch (error) {
    message.error('加载订阅源失败: ' + error.message);
  }
};

const loadArticles = async () => {
  loading.value = true;
  try {
    const options = { feedId: feedId.value };

    if (filter.value === 'unread') {
      options.isRead = false;
    } else if (filter.value === 'starred') {
      options.isStarred = true;
    }

    const result = await window.electron.ipcRenderer.invoke('rss:get-items', options);
    if (result.success) {
      articles.value = result.items;
    }
  } catch (error) {
    message.error('加载文章失败: ' + error.message);
  } finally {
    loading.value = false;
  }
};

const selectArticle = async (article) => {
  selectedArticle.value = article;

  // 标记为已读
  if (!article.is_read) {
    try {
      await window.electron.ipcRenderer.invoke('rss:mark-as-read', article.id);
      article.is_read = 1;
    } catch (error) {
      console.error('标记已读失败:', error);
    }
  }
};

const toggleStar = async () => {
  if (!selectedArticle.value) return;

  const newStarred = !selectedArticle.value.is_starred;

  try {
    await window.electron.ipcRenderer.invoke(
      'rss:mark-as-starred',
      selectedArticle.value.id,
      newStarred
    );

    selectedArticle.value.is_starred = newStarred ? 1 : 0;

    // 更新列表中的状态
    const article = articles.value.find(a => a.id === selectedArticle.value.id);
    if (article) {
      article.is_starred = newStarred ? 1 : 0;
    }

    message.success(newStarred ? '已收藏' : '已取消收藏');
  } catch (error) {
    message.error('操作失败: ' + error.message);
  }
};

const saveToKnowledge = async () => {
  if (!selectedArticle.value) return;

  try {
    const result = await window.electron.ipcRenderer.invoke(
      'rss:save-to-knowledge',
      selectedArticle.value.id
    );

    if (result.success) {
      message.success('已保存到知识库');
    }
  } catch (error) {
    message.error('保存失败: ' + error.message);
  }
};

const openInBrowser = () => {
  if (selectedArticle.value?.link) {
    window.open(selectedArticle.value.link, '_blank');
  }
};

const handleMenuClick = async ({ key }) => {
  if (!selectedArticle.value) return;

  try {
    switch (key) {
      case 'markRead':
        await window.electron.ipcRenderer.invoke('rss:mark-as-read', selectedArticle.value.id);
        selectedArticle.value.is_read = 1;
        message.success('已标记为已读');
        break;

      case 'markUnread':
        // TODO: 实现标记未读
        message.info('功能开发中');
        break;

      case 'archive':
        await window.electron.ipcRenderer.invoke('rss:archive-item', selectedArticle.value.id);
        message.success('已归档');
        await loadArticles();
        selectedArticle.value = null;
        break;
    }
  } catch (error) {
    message.error('操作失败: ' + error.message);
  }
};

const handleFilterChange = ({ key }) => {
  filter.value = key;
  loadArticles();
};

const goBack = () => {
  router.back();
};

const formatTime = (timestamp) => {
  return dayjs(timestamp).fromNow();
};

// 生命周期
onMounted(() => {
  loadFeed();
  loadArticles();
});
</script>

<style scoped>
.rss-article-reader {
  padding: 24px;
}

.article-item {
  padding: 12px;
  border-radius: 4px;
  transition: background-color 0.3s;
}

.article-item:hover {
  background-color: #f5f5f5;
}

.article-item.article-selected {
  background-color: #e6f7ff;
}

.article-item.article-read {
  opacity: 0.7;
}

.article-meta {
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: #999;
  margin-bottom: 4px;
}

.article-description {
  font-size: 13px;
  color: #666;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.article-header h2 {
  margin: 0 0 8px 0;
  font-size: 24px;
}

.article-info {
  font-size: 14px;
  color: #666;
}

.article-content {
  font-size: 16px;
  line-height: 1.8;
  color: #333;
}

.article-content :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: 4px;
  margin: 16px 0;
}

.article-content :deep(pre) {
  background-color: #f5f5f5;
  padding: 12px;
  border-radius: 4px;
  overflow-x: auto;
}

.article-content :deep(code) {
  background-color: #f5f5f5;
  padding: 2px 6px;
  border-radius: 3px;
  font-family: 'Courier New', monospace;
}

.article-content :deep(blockquote) {
  border-left: 4px solid #1890ff;
  padding-left: 16px;
  margin: 16px 0;
  color: #666;
}

.article-content :deep(a) {
  color: #1890ff;
  text-decoration: none;
}

.article-content :deep(a:hover) {
  text-decoration: underline;
}

.article-footer {
  text-align: center;
  padding: 16px 0;
}
</style>
