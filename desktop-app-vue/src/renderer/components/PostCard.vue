<template>
  <a-card class="post-card">
    <!-- 头部：作者信息 -->
    <template #title>
      <div class="post-header">
        <a-avatar :style="{ backgroundColor: getAvatarColor(post.author_did) }">
          <template #icon><user-outlined /></template>
        </a-avatar>
        <div class="author-info">
          <div class="author-name">{{ shortenDid(post.author_did) }}</div>
          <div class="post-time">{{ formatTime(post.created_at) }}</div>
        </div>
        <a-tag v-if="post.visibility === 'friends'" color="blue" size="small">
          <team-outlined /> 仅好友
        </a-tag>
        <a-tag v-else-if="post.visibility === 'private'" color="orange" size="small">
          <lock-outlined /> 仅自己
        </a-tag>
      </div>
    </template>

    <!-- 操作菜单 -->
    <template #extra>
      <a-dropdown v-if="isAuthor">
        <a-button type="text" size="small">
          <template #icon><ellipsis-outlined /></template>
        </a-button>
        <template #overlay>
          <a-menu>
            <a-menu-item danger @click="handleDelete">
              <delete-outlined /> 删除
            </a-menu-item>
          </a-menu>
        </template>
      </a-dropdown>
    </template>

    <!-- 内容 -->
    <div class="post-content">
      {{ post.content }}
    </div>

    <!-- 图片 -->
    <div v-if="post.images && post.images.length > 0" class="post-images">
      <a-image-preview-group>
        <a-image
          v-for="(image, index) in post.images"
          :key="index"
          :src="image"
          :width="getImageWidth(post.images.length)"
          class="post-image"
        />
      </a-image-preview-group>
    </div>

    <!-- 链接卡片 -->
    <a-card
      v-if="post.link_url"
      class="link-card"
      size="small"
      hoverable
      @click="openLink"
    >
      <div class="link-info">
        <link-outlined class="link-icon" />
        <div class="link-text">
          <div v-if="post.link_title" class="link-title">{{ post.link_title }}</div>
          <div class="link-url">{{ post.link_url }}</div>
          <div v-if="post.link_description" class="link-description">
            {{ post.link_description }}
          </div>
        </div>
      </div>
    </a-card>

    <!-- 互动统计 -->
    <div class="post-stats">
      <span class="stat-item">
        <like-outlined /> {{ post.like_count }} 赞
      </span>
      <span class="stat-item">
        <comment-outlined /> {{ post.comment_count }} 评论
      </span>
    </div>

    <!-- 操作按钮 -->
    <div class="post-actions">
      <a-button
        type="text"
        :class="{ liked: post.liked }"
        @click="handleLike"
      >
        <template #icon>
          <like-filled v-if="post.liked" />
          <like-outlined v-else />
        </template>
        {{ post.liked ? '已赞' : '点赞' }}
      </a-button>
      <a-button type="text" @click="toggleComments">
        <template #icon><comment-outlined /></template>
        评论
      </a-button>
    </div>

    <!-- 评论区域 -->
    <div v-if="showComments" class="comments-section">
      <a-divider />

      <!-- 评论输入框 -->
      <div class="comment-input">
        <a-textarea
          v-model:value="commentContent"
          placeholder="写下你的评论..."
          :rows="2"
          :maxlength="500"
          show-count
        />
        <a-button
          type="primary"
          size="small"
          :loading="commenting"
          @click="handleComment"
          style="margin-top: 8px"
        >
          发表评论
        </a-button>
      </div>

      <!-- 评论列表 -->
      <a-list
        v-if="comments.length > 0"
        :data-source="comments"
        :loading="loadingComments"
        class="comments-list"
      >
        <template #renderItem="{ item }">
          <a-list-item>
            <a-comment>
              <template #avatar>
                <a-avatar :style="{ backgroundColor: getAvatarColor(item.author_did) }">
                  <template #icon><user-outlined /></template>
                </a-avatar>
              </template>
              <template #author>
                <span>{{ shortenDid(item.author_did) }}</span>
              </template>
              <template #content>
                <p>{{ item.content }}</p>
              </template>
              <template #datetime>
                <span>{{ formatTime(item.created_at) }}</span>
              </template>
              <template #actions>
                <span v-if="item.author_did === currentDid" @click="handleDeleteComment(item.id)">
                  <delete-outlined /> 删除
                </span>
              </template>
            </a-comment>
          </a-list-item>
        </template>
      </a-list>
    </div>
  </a-card>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { message as antMessage, Modal } from 'ant-design-vue';
import {
  UserOutlined,
  EllipsisOutlined,
  DeleteOutlined,
  LikeOutlined,
  LikeFilled,
  CommentOutlined,
  TeamOutlined,
  LockOutlined,
  LinkOutlined,
} from '@ant-design/icons-vue';

// Props
const props = defineProps({
  post: {
    type: Object,
    required: true,
  },
  currentDid: {
    type: String,
    required: true,
  },
});

// Emits
const emit = defineEmits(['deleted', 'liked', 'unliked', 'commented']);

// 状态
const showComments = ref(false);
const comments = ref([]);
const loadingComments = ref(false);
const commentContent = ref('');
const commenting = ref(false);

// 计算属性
const isAuthor = computed(() => props.post.author_did === props.currentDid);

// 工具函数
const shortenDid = (did) => {
  if (!did) return '';
  return did.length > 20 ? `${did.slice(0, 10)}...${did.slice(-8)}` : did;
};

const getAvatarColor = (did) => {
  const colors = ['#f56a00', '#7265e6', '#ffbf00', '#00a2ae', '#1890ff'];
  const hash = did.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return colors[hash % colors.length];
};

const formatTime = (timestamp) => {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  if (diff < 60 * 1000) {
    return '刚刚';
  }

  if (diff < 60 * 60 * 1000) {
    const minutes = Math.floor(diff / (60 * 1000));
    return `${minutes} 分钟前`;
  }

  if (diff < 24 * 60 * 60 * 1000) {
    const hours = Math.floor(diff / (60 * 60 * 1000));
    return `${hours} 小时前`;
  }

  if (diff < 7 * 24 * 60 * 60 * 1000) {
    const days = Math.floor(diff / (24 * 60 * 60 * 1000));
    return `${days} 天前`;
  }

  return date.toLocaleDateString('zh-CN');
};

const getImageWidth = (count) => {
  if (count === 1) return 400;
  if (count === 2 || count === 4) return 200;
  return 150;
};

// 打开链接
const openLink = () => {
  if (props.post.link_url) {
    window.open(props.post.link_url, '_blank');
  }
};

// 删除动态
const handleDelete = () => {
  Modal.confirm({
    title: '确认删除',
    content: '确定要删除这条动态吗？删除后无法恢复。',
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    async onOk() {
      try {
        await window.electronAPI.post.delete(props.post.id);
        antMessage.success('动态已删除');
        emit('deleted', props.post.id);
      } catch (error) {
        console.error('删除动态失败:', error);
        antMessage.error('删除动态失败: ' + error.message);
      }
    },
  });
};

// 点赞/取消点赞
const handleLike = async () => {
  try {
    if (props.post.liked) {
      await window.electronAPI.post.unlike(props.post.id);
      props.post.liked = false;
      props.post.like_count--;
      emit('unliked', props.post.id);
    } else {
      await window.electronAPI.post.like(props.post.id);
      props.post.liked = true;
      props.post.like_count++;
      emit('liked', props.post.id);
    }
  } catch (error) {
    console.error('点赞操作失败:', error);
    antMessage.error(error.message);
  }
};

// 切换评论显示
const toggleComments = async () => {
  showComments.value = !showComments.value;

  if (showComments.value && comments.value.length === 0) {
    await loadComments();
  }
};

// 加载评论
const loadComments = async () => {
  try {
    loadingComments.value = true;
    comments.value = await window.electronAPI.post.getComments(props.post.id);
  } catch (error) {
    console.error('加载评论失败:', error);
    antMessage.error('加载评论失败: ' + error.message);
  } finally {
    loadingComments.value = false;
  }
};

// 发表评论
const handleComment = async () => {
  if (!commentContent.value || commentContent.value.trim().length === 0) {
    antMessage.warning('请输入评论内容');
    return;
  }

  try {
    commenting.value = true;
    const comment = await window.electronAPI.post.addComment(
      props.post.id,
      commentContent.value.trim()
    );

    comments.value.unshift(comment);
    props.post.comment_count++;
    commentContent.value = '';

    antMessage.success('评论已发表');
    emit('commented', props.post.id);
  } catch (error) {
    console.error('发表评论失败:', error);
    antMessage.error('发表评论失败: ' + error.message);
  } finally {
    commenting.value = false;
  }
};

// 删除评论
const handleDeleteComment = async (commentId) => {
  Modal.confirm({
    title: '确认删除',
    content: '确定要删除这条评论吗？',
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    async onOk() {
      try {
        await window.electronAPI.post.deleteComment(commentId);
        comments.value = comments.value.filter(c => c.id !== commentId);
        props.post.comment_count--;
        antMessage.success('评论已删除');
      } catch (error) {
        console.error('删除评论失败:', error);
        antMessage.error('删除评论失败: ' + error.message);
      }
    },
  });
};
</script>

<style scoped>
.post-card {
  margin-bottom: 16px;
}

.post-header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.author-info {
  flex: 1;
}

.author-name {
  font-weight: 500;
  font-size: 14px;
}

.post-time {
  font-size: 12px;
  color: #999;
}

.post-content {
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  margin-bottom: 12px;
}

.post-images {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}

.post-image {
  border-radius: 8px;
  object-fit: cover;
}

.link-card {
  margin-bottom: 12px;
  cursor: pointer;
}

.link-info {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.link-icon {
  font-size: 24px;
  color: #1890ff;
  flex-shrink: 0;
}

.link-text {
  flex: 1;
  overflow: hidden;
}

.link-title {
  font-weight: 500;
  font-size: 14px;
  margin-bottom: 4px;
}

.link-url {
  font-size: 12px;
  color: #1890ff;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.link-description {
  font-size: 12px;
  color: #666;
  margin-top: 4px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.post-stats {
  display: flex;
  gap: 16px;
  padding: 12px 0;
  border-top: 1px solid #f0f0f0;
  border-bottom: 1px solid #f0f0f0;
  font-size: 13px;
  color: #666;
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.post-actions {
  display: flex;
  gap: 8px;
  padding: 8px 0;
}

.post-actions .ant-btn.liked {
  color: #1890ff;
}

.comments-section {
  margin-top: 16px;
}

.comment-input {
  margin-bottom: 16px;
}

.comments-list {
  margin-top: 16px;
}
</style>
