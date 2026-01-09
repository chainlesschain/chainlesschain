<template>
  <div class="forum-list">
    <!-- 头部 -->
    <div class="forum-header">
      <h2>社区论坛</h2>
      <a-button type="primary" @click="showCreateTopicModal">
        <PlusOutlined /> 发帖
      </a-button>
    </div>

    <!-- 分类标签 -->
    <div class="forum-categories">
      <a-space wrap>
        <a-tag
          v-for="category in categories"
          :key="category.id"
          :color="selectedCategory === category.id ? 'blue' : 'default'"
          style="cursor: pointer"
          @click="selectCategory(category.id)"
        >
          {{ category.name }}
        </a-tag>
      </a-space>
    </div>

    <!-- 发帖模态框 -->
    <a-modal
      v-model:open="createTopicModalVisible"
      title="发布帖子"
      width="700px"
      :confirm-loading="publishing"
      @ok="handleCreateTopic"
    >
      <a-form :model="topicForm" layout="vertical">
        <a-form-item label="标题" required>
          <a-input
            v-model:value="topicForm.title"
            placeholder="请输入标题"
            :maxlength="100"
            show-count
          />
        </a-form-item>

        <a-form-item label="分类" required>
          <a-select v-model:value="topicForm.category" style="width: 100%">
            <a-select-option v-for="cat in categories" :key="cat.id" :value="cat.id">
              {{ cat.name }}
            </a-select-option>
          </a-select>
        </a-form-item>

        <a-form-item label="内容" required>
          <a-textarea
            v-model:value="topicForm.content"
            :rows="8"
            placeholder="请输入内容，支持Markdown格式"
            :maxlength="5000"
            show-count
          />
        </a-form-item>

        <a-form-item label="标签">
          <a-select
            v-model:value="topicForm.tags"
            mode="tags"
            style="width: 100%"
            placeholder="添加标签"
            :max-tag-count="5"
          />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- 帖子列表 -->
    <div class="forum-topics">
      <a-spin :spinning="loading">
        <a-empty v-if="topics.length === 0 && !loading" description="暂无帖子" />

        <div v-for="topic in topics" :key="topic.id" class="topic-item" @click="viewTopic(topic)">
          <!-- 左侧：统计信息 -->
          <div class="topic-stats">
            <div class="stat-item">
              <div class="stat-value">{{ topic.views_count || 0 }}</div>
              <div class="stat-label">浏览</div>
            </div>
            <div class="stat-item">
              <div class="stat-value">{{ topic.replies_count || 0 }}</div>
              <div class="stat-label">回复</div>
            </div>
            <div class="stat-item">
              <div class="stat-value">{{ topic.likes_count || 0 }}</div>
              <div class="stat-label">点赞</div>
            </div>
          </div>

          <!-- 中间：帖子信息 -->
          <div class="topic-content">
            <div class="topic-title">
              <a-tag v-if="topic.is_pinned" color="red">置顶</a-tag>
              <a-tag v-if="topic.is_hot" color="orange">热门</a-tag>
              <span>{{ topic.title }}</span>
            </div>

            <div class="topic-meta">
              <a-space>
                <a-tag color="blue">{{ getCategoryName(topic.category_id) }}</a-tag>
                <a-tag v-for="tag in topic.tags" :key="tag">{{ tag }}</a-tag>
              </a-space>
            </div>

            <div class="topic-info">
              <a-avatar :size="24">
                <template #icon><UserOutlined /></template>
              </a-avatar>
              <span class="topic-author">{{ topic.author_name || shortenDid(topic.author_did) }}</span>
              <span class="topic-time">{{ formatTime(topic.created_at) }}</span>
            </div>
          </div>

          <!-- 右侧：最新回复 -->
          <div v-if="topic.last_reply" class="topic-last-reply">
            <div class="last-reply-author">
              {{ topic.last_reply.author_name || shortenDid(topic.last_reply.author_did) }}
            </div>
            <div class="last-reply-time">{{ formatTime(topic.last_reply.created_at) }}</div>
          </div>
        </div>

        <!-- 加载更多 -->
        <div v-if="hasMore" class="load-more">
          <a-button type="link" :loading="loadingMore" @click="loadMore">
            加载更多
          </a-button>
        </div>
      </a-spin>
    </div>

    <!-- 帖子详情模态框 -->
    <a-modal
      v-model:open="topicDetailVisible"
      :title="currentTopic?.title"
      width="900px"
      :footer="null"
    >
      <div v-if="currentTopic" class="topic-detail">
        <!-- 帖子内容 -->
        <div class="topic-detail-content">
          <div class="topic-detail-header">
            <a-avatar :size="48">
              <template #icon><UserOutlined /></template>
            </a-avatar>
            <div class="topic-detail-author-info">
              <div class="topic-detail-author">
                {{ currentTopic.author_name || shortenDid(currentTopic.author_did) }}
              </div>
              <div class="topic-detail-time">{{ formatTime(currentTopic.created_at) }}</div>
            </div>
            <a-space>
              <a-button type="text" @click="handleLikeTopic(currentTopic)">
                <LikeOutlined :style="{ color: currentTopic.liked ? '#1890ff' : undefined }" />
                {{ currentTopic.likes_count || 0 }}
              </a-button>
              <a-button type="text">
                <StarOutlined /> 收藏
              </a-button>
              <a-button type="text">
                <ShareAltOutlined /> 分享
              </a-button>
            </a-space>
          </div>

          <div class="topic-detail-body">
            <div v-html="renderMarkdown(currentTopic.content)"></div>
          </div>

          <div class="topic-detail-tags">
            <a-space>
              <a-tag v-for="tag in currentTopic.tags" :key="tag">{{ tag }}</a-tag>
            </a-space>
          </div>
        </div>

        <!-- 回复列表 -->
        <div class="topic-replies">
          <h3>回复 ({{ currentTopic.replies_count || 0 }})</h3>

          <div v-for="reply in replies" :key="reply.id" class="reply-item">
            <a-avatar :size="36">
              <template #icon><UserOutlined /></template>
            </a-avatar>
            <div class="reply-content">
              <div class="reply-header">
                <span class="reply-author">
                  {{ reply.author_name || shortenDid(reply.author_did) }}
                </span>
                <span class="reply-time">{{ formatTime(reply.created_at) }}</span>
              </div>
              <div class="reply-body">{{ reply.content }}</div>
              <div class="reply-actions">
                <a-button type="text" size="small" @click="handleLikeReply(reply)">
                  <LikeOutlined :style="{ color: reply.liked ? '#1890ff' : undefined }" />
                  {{ reply.likes_count || 0 }}
                </a-button>
                <a-button type="text" size="small" @click="handleReplyToReply(reply)">
                  <CommentOutlined /> 回复
                </a-button>
              </div>
            </div>
          </div>

          <!-- 回复输入框 -->
          <div class="reply-input">
            <a-textarea
              v-model:value="replyContent"
              :rows="4"
              placeholder="写下你的回复..."
              :maxlength="1000"
              show-count
            />
            <div class="reply-input-actions">
              <a-button type="primary" :loading="replying" @click="handleReply">
                发表回复
              </a-button>
            </div>
          </div>
        </div>
      </div>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, computed } from 'vue';
import { message as antMessage } from 'ant-design-vue';
import {
  PlusOutlined,
  UserOutlined,
  LikeOutlined,
  StarOutlined,
  ShareAltOutlined,
  CommentOutlined,
} from '@ant-design/icons-vue';
import { marked } from 'marked';
import { useSocialStore } from '../../stores/social';
import { useIdentityStore } from '../../stores/identity';

const socialStore = useSocialStore();
const identityStore = useIdentityStore();

const loading = ref(false);
const loadingMore = ref(false);
const publishing = ref(false);
const replying = ref(false);
const createTopicModalVisible = ref(false);
const topicDetailVisible = ref(false);
const topics = ref([]);
const replies = ref([]);
const currentTopic = ref(null);
const replyContent = ref('');
const hasMore = ref(true);
const currentPage = ref(1);
const pageSize = 20;
const selectedCategory = ref('all');

const currentUserDid = computed(() => identityStore.currentDid);

// 分类列表
const categories = ref([
  { id: 'all', name: '全部' },
  { id: 'general', name: '综合讨论' },
  { id: 'tech', name: '技术交流' },
  { id: 'knowledge', name: '知识分享' },
  { id: 'qa', name: '问答求助' },
  { id: 'announcement', name: '公告通知' },
]);

const topicForm = reactive({
  title: '',
  category: 'general',
  content: '',
  tags: [],
});

// 加载帖子列表
const loadTopics = async (page = 1) => {
  try {
    if (page === 1) {
      loading.value = true;
    } else {
      loadingMore.value = true;
    }

    const result = await window.electronAPI.social.getForumTopics({
      category: selectedCategory.value === 'all' ? undefined : selectedCategory.value,
      page,
      pageSize,
    });

    if (result.success) {
      if (page === 1) {
        topics.value = result.data.topics || [];
      } else {
        topics.value.push(...(result.data.topics || []));
      }
      hasMore.value = result.data.hasMore || false;
      currentPage.value = page;
    } else {
      antMessage.error(result.error || '加载帖子失败');
    }
  } catch (error) {
    console.error('加载帖子失败:', error);
    antMessage.error('加载帖子失败');
  } finally {
    loading.value = false;
    loadingMore.value = false;
  }
};

// 选择分类
const selectCategory = (categoryId) => {
  selectedCategory.value = categoryId;
  loadTopics(1);
};

// 显示发帖模态框
const showCreateTopicModal = () => {
  createTopicModalVisible.value = true;
  topicForm.title = '';
  topicForm.category = 'general';
  topicForm.content = '';
  topicForm.tags = [];
};

// 发布帖子
const handleCreateTopic = async () => {
  if (!topicForm.title.trim()) {
    antMessage.warning('请输入标题');
    return;
  }
  if (!topicForm.content.trim()) {
    antMessage.warning('请输入内容');
    return;
  }

  try {
    publishing.value = true;

    const result = await window.electronAPI.social.createForumTopic({
      title: topicForm.title,
      category: topicForm.category,
      content: topicForm.content,
      tags: topicForm.tags,
    });

    if (result.success) {
      antMessage.success('发布成功');
      createTopicModalVisible.value = false;
      loadTopics(1);
    } else {
      antMessage.error(result.error || '发布失败');
    }
  } catch (error) {
    console.error('发布帖子失败:', error);
    antMessage.error('发布失败');
  } finally {
    publishing.value = false;
  }
};

// 查看帖子详情
const viewTopic = async (topic) => {
  currentTopic.value = topic;
  topicDetailVisible.value = true;

  // 加载回复
  try {
    const result = await window.electronAPI.social.getForumReplies(topic.id);
    if (result.success) {
      replies.value = result.data.replies || [];
    }
  } catch (error) {
    console.error('加载回复失败:', error);
  }

  // 增加浏览量
  window.electronAPI.social.incrementTopicViews(topic.id);
};

// 点赞帖子
const handleLikeTopic = async (topic) => {
  try {
    const result = await window.electronAPI.social.likeForumTopic(topic.id);
    if (result.success) {
      topic.liked = !topic.liked;
      topic.likes_count = (topic.likes_count || 0) + (topic.liked ? 1 : -1);
    }
  } catch (error) {
    console.error('点赞失败:', error);
    antMessage.error('操作失败');
  }
};

// 点赞回复
const handleLikeReply = async (reply) => {
  try {
    const result = await window.electronAPI.social.likeForumReply(reply.id);
    if (result.success) {
      reply.liked = !reply.liked;
      reply.likes_count = (reply.likes_count || 0) + (reply.liked ? 1 : -1);
    }
  } catch (error) {
    console.error('点赞失败:', error);
    antMessage.error('操作失败');
  }
};

// 回复帖子
const handleReply = async () => {
  if (!replyContent.value.trim()) {
    antMessage.warning('请输入回复内容');
    return;
  }

  try {
    replying.value = true;

    const result = await window.electronAPI.social.replyForumTopic({
      topicId: currentTopic.value.id,
      content: replyContent.value,
    });

    if (result.success) {
      replies.value.push(result.data);
      currentTopic.value.replies_count = (currentTopic.value.replies_count || 0) + 1;
      replyContent.value = '';
      antMessage.success('回复成功');
    } else {
      antMessage.error(result.error || '回复失败');
    }
  } catch (error) {
    console.error('回复失败:', error);
    antMessage.error('回复失败');
  } finally {
    replying.value = false;
  }
};

// 回复某条回复
const handleReplyToReply = (reply) => {
  replyContent.value = `@${reply.author_name || shortenDid(reply.author_did)} `;
};

// 加载更多
const loadMore = () => {
  loadTopics(currentPage.value + 1);
};

// 获取分类名称
const getCategoryName = (categoryId) => {
  const category = categories.value.find(c => c.id === categoryId);
  return category ? category.name : '未知';
};

// 渲染Markdown
const renderMarkdown = (content) => {
  return marked(content || '');
};

// 格式化时间
const formatTime = (timestamp) => {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}天前`;

  return date.toLocaleDateString();
};

// 缩短DID显示
const shortenDid = (did) => {
  if (!did) return '';
  return `${did.slice(0, 8)}...${did.slice(-6)}`;
};

onMounted(() => {
  loadTopics(1);
});
</script>

<style scoped lang="scss">
.forum-list {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #f5f5f5;
}

.forum-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 24px;
  background: white;
  border-bottom: 1px solid #e8e8e8;

  h2 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
  }
}

.forum-categories {
  padding: 12px 24px;
  background: white;
  border-bottom: 1px solid #e8e8e8;
}

.forum-topics {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.topic-item {
  display: flex;
  background: white;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 12px;
  cursor: pointer;
  transition: all 0.3s;

  &:hover {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }
}

.topic-stats {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-right: 16px;
  min-width: 80px;
}

.stat-item {
  text-align: center;
}

.stat-value {
  font-size: 18px;
  font-weight: 600;
  color: #1890ff;
}

.stat-label {
  font-size: 12px;
  color: #999;
}

.topic-content {
  flex: 1;
}

.topic-title {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.topic-meta {
  margin-bottom: 8px;
}

.topic-info {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #666;
}

.topic-author {
  font-weight: 500;
}

.topic-time {
  color: #999;
}

.topic-last-reply {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: flex-end;
  min-width: 120px;
  font-size: 12px;
}

.last-reply-author {
  color: #666;
  margin-bottom: 4px;
}

.last-reply-time {
  color: #999;
}

.topic-detail {
  max-height: 70vh;
  overflow-y: auto;
}

.topic-detail-content {
  padding-bottom: 24px;
  border-bottom: 1px solid #e8e8e8;
}

.topic-detail-header {
  display: flex;
  align-items: center;
  margin-bottom: 16px;
}

.topic-detail-author-info {
  flex: 1;
  margin-left: 12px;
}

.topic-detail-author {
  font-weight: 600;
}

.topic-detail-time {
  font-size: 12px;
  color: #999;
  margin-top: 2px;
}

.topic-detail-body {
  margin-bottom: 16px;
  line-height: 1.8;
}

.topic-detail-tags {
  margin-top: 16px;
}

.topic-replies {
  margin-top: 24px;

  h3 {
    margin-bottom: 16px;
  }
}

.reply-item {
  display: flex;
  gap: 12px;
  padding: 16px 0;
  border-bottom: 1px solid #f0f0f0;
}

.reply-content {
  flex: 1;
}

.reply-header {
  margin-bottom: 8px;
}

.reply-author {
  font-weight: 600;
  margin-right: 8px;
}

.reply-time {
  font-size: 12px;
  color: #999;
}

.reply-body {
  margin-bottom: 8px;
  line-height: 1.6;
}

.reply-actions {
  display: flex;
  gap: 8px;
}

.reply-input {
  margin-top: 24px;
}

.reply-input-actions {
  margin-top: 12px;
  text-align: right;
}

.load-more {
  text-align: center;
  padding: 16px 0;
}
</style>
