<template>
  <div class="moments-timeline">
    <!-- 头部 -->
    <div class="moments-header">
      <h2>朋友圈</h2>
      <a-button
        type="primary"
        @click="showPublishModal"
      >
        <PlusOutlined /> 发布动态
      </a-button>
    </div>

    <!-- 发布动态模态框 -->
    <a-modal
      v-model:open="publishModalVisible"
      title="发布动态"
      :confirm-loading="publishing"
      @ok="handlePublish"
    >
      <a-form
        :model="publishForm"
        layout="vertical"
      >
        <a-form-item label="内容">
          <a-textarea
            v-model:value="publishForm.content"
            :rows="4"
            placeholder="分享你的想法..."
            :maxlength="500"
            show-count
          />
        </a-form-item>

        <a-form-item label="图片">
          <a-upload
            v-model:file-list="publishForm.images"
            list-type="picture-card"
            :before-upload="beforeUpload"
            :max-count="9"
          >
            <div v-if="publishForm.images.length < 9">
              <PlusOutlined />
              <div style="margin-top: 8px">
                上传
              </div>
            </div>
          </a-upload>
        </a-form-item>

        <a-form-item label="可见范围">
          <a-select
            v-model:value="publishForm.visibility"
            style="width: 100%"
          >
            <a-select-option value="public">
              公开
            </a-select-option>
            <a-select-option value="friends">
              仅好友
            </a-select-option>
            <a-select-option value="private">
              仅自己
            </a-select-option>
          </a-select>
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- 动态列表 -->
    <div class="moments-list">
      <a-spin :spinning="loading">
        <a-empty
          v-if="moments.length === 0 && !loading"
          description="暂无动态"
        />

        <div
          v-for="moment in moments"
          :key="moment.id"
          class="moment-item"
        >
          <!-- 用户信息 -->
          <div class="moment-header">
            <a-avatar :size="48">
              <template #icon>
                <UserOutlined />
              </template>
            </a-avatar>
            <div class="moment-user-info">
              <div class="moment-username">
                {{ moment.author_name || shortenDid(moment.author_did) }}
              </div>
              <div class="moment-time">
                {{ formatTime(moment.created_at) }}
              </div>
            </div>
            <a-dropdown v-if="moment.author_did === currentUserDid">
              <a-button
                type="text"
                size="small"
              >
                <MoreOutlined />
              </a-button>
              <template #overlay>
                <a-menu>
                  <a-menu-item @click="handleEdit(moment)">
                    <EditOutlined /> 编辑
                  </a-menu-item>
                  <a-menu-item
                    danger
                    @click="handleDelete(moment.id)"
                  >
                    <DeleteOutlined /> 删除
                  </a-menu-item>
                </a-menu>
              </template>
            </a-dropdown>
          </div>

          <!-- 内容 -->
          <div class="moment-content">
            <p>{{ moment.content }}</p>

            <!-- 图片网格 -->
            <div
              v-if="moment.images && moment.images.length > 0"
              class="moment-images"
            >
              <a-image-preview-group>
                <a-image
                  v-for="(image, index) in moment.images"
                  :key="index"
                  :src="image"
                  :width="getImageWidth(moment.images.length)"
                  class="moment-image"
                />
              </a-image-preview-group>
            </div>
          </div>

          <!-- 互动区域 -->
          <div class="moment-actions">
            <a-space>
              <a-button
                type="text"
                size="small"
                :class="{ liked: moment.liked }"
                @click="handleLike(moment)"
              >
                <LikeOutlined /> {{ moment.likes_count || 0 }}
              </a-button>
              <a-button
                type="text"
                size="small"
                @click="handleComment(moment)"
              >
                <CommentOutlined /> {{ moment.comments_count || 0 }}
              </a-button>
              <a-button
                type="text"
                size="small"
                @click="handleShare(moment)"
              >
                <ShareAltOutlined /> 分享
              </a-button>
            </a-space>
          </div>

          <!-- 评论列表 -->
          <div
            v-if="moment.comments && moment.comments.length > 0"
            class="moment-comments"
          >
            <div
              v-for="comment in moment.comments"
              :key="comment.id"
              class="comment-item"
            >
              <span class="comment-author">{{ comment.author_name }}:</span>
              <span class="comment-content">{{ comment.content }}</span>
              <span class="comment-time">{{ formatTime(comment.created_at) }}</span>
            </div>
          </div>

          <!-- 评论输入框 -->
          <div
            v-if="moment.showCommentInput"
            class="moment-comment-input"
          >
            <a-input
              v-model:value="moment.commentText"
              placeholder="写下你的评论..."
              @press-enter="handleSubmitComment(moment)"
            >
              <template #suffix>
                <a-button
                  type="link"
                  size="small"
                  @click="handleSubmitComment(moment)"
                >
                  发送
                </a-button>
              </template>
            </a-input>
          </div>
        </div>

        <!-- 加载更多 -->
        <div
          v-if="hasMore"
          class="load-more"
        >
          <a-button
            type="link"
            :loading="loadingMore"
            @click="loadMore"
          >
            加载更多
          </a-button>
        </div>
      </a-spin>
    </div>
  </div>
</template>

<script setup>
import { logger, createLogger } from '@/utils/logger';

import { ref, reactive, onMounted, computed } from 'vue';
import { message as antMessage } from 'ant-design-vue';
import {
  PlusOutlined,
  UserOutlined,
  MoreOutlined,
  EditOutlined,
  DeleteOutlined,
  LikeOutlined,
  CommentOutlined,
  ShareAltOutlined,
} from '@ant-design/icons-vue';
import { useSocialStore } from '../../stores/social';
import { useIdentityStore } from '../../stores/identity';

const socialStore = useSocialStore();
const identityStore = useIdentityStore();

const loading = ref(false);
const loadingMore = ref(false);
const publishing = ref(false);
const publishModalVisible = ref(false);
const moments = ref([]);
const hasMore = ref(true);
const currentPage = ref(1);
const pageSize = 20;

const currentUserDid = computed(() => identityStore.currentDid);

const publishForm = reactive({
  content: '',
  images: [],
  visibility: 'public',
});

// 加载动态列表
const loadMoments = async (page = 1) => {
  try {
    if (page === 1) {
      loading.value = true;
    } else {
      loadingMore.value = true;
    }

    const result = await window.electronAPI.social.getPosts({
      type: 'moments',
      page,
      pageSize,
    });

    if (result.success) {
      if (page === 1) {
        moments.value = result.data.posts || [];
      } else {
        moments.value.push(...(result.data.posts || []));
      }
      hasMore.value = result.data.hasMore || false;
      currentPage.value = page;
    } else {
      antMessage.error(result.error || '加载动态失败');
    }
  } catch (error) {
    logger.error('加载动态失败:', error);
    antMessage.error('加载动态失败');
  } finally {
    loading.value = false;
    loadingMore.value = false;
  }
};

// 显示发布模态框
const showPublishModal = () => {
  publishModalVisible.value = true;
  publishForm.content = '';
  publishForm.images = [];
  publishForm.visibility = 'public';
};

// 发布动态
const handlePublish = async () => {
  if (!publishForm.content.trim()) {
    antMessage.warning('请输入内容');
    return;
  }

  try {
    publishing.value = true;

    const result = await window.electronAPI.social.createPost({
      type: 'moments',
      content: publishForm.content,
      images: publishForm.images.map(img => img.url || img.response?.url),
      visibility: publishForm.visibility,
    });

    if (result.success) {
      antMessage.success('发布成功');
      publishModalVisible.value = false;
      loadMoments(1); // 重新加载
    } else {
      antMessage.error(result.error || '发布失败');
    }
  } catch (error) {
    logger.error('发布动态失败:', error);
    antMessage.error('发布失败');
  } finally {
    publishing.value = false;
  }
};

// 图片上传前处理
const beforeUpload = (file) => {
  const isImage = file.type.startsWith('image/');
  if (!isImage) {
    antMessage.error('只能上传图片文件');
    return false;
  }
  const isLt5M = file.size / 1024 / 1024 < 5;
  if (!isLt5M) {
    antMessage.error('图片大小不能超过5MB');
    return false;
  }
  return true;
};

// 点赞
const handleLike = async (moment) => {
  try {
    const result = await window.electronAPI.social.likePost(moment.id);
    if (result.success) {
      moment.liked = !moment.liked;
      moment.likes_count = (moment.likes_count || 0) + (moment.liked ? 1 : -1);
    }
  } catch (error) {
    logger.error('点赞失败:', error);
    antMessage.error('操作失败');
  }
};

// 评论
const handleComment = (moment) => {
  moment.showCommentInput = !moment.showCommentInput;
};

// 提交评论
const handleSubmitComment = async (moment) => {
  if (!moment.commentText?.trim()) {
    return;
  }

  try {
    const result = await window.electronAPI.social.commentPost({
      postId: moment.id,
      content: moment.commentText,
    });

    if (result.success) {
      if (!moment.comments) {
        moment.comments = [];
      }
      moment.comments.push(result.data);
      moment.comments_count = (moment.comments_count || 0) + 1;
      moment.commentText = '';
      moment.showCommentInput = false;
      antMessage.success('评论成功');
    }
  } catch (error) {
    logger.error('评论失败:', error);
    antMessage.error('评论失败');
  }
};

// 分享
const handleShare = (moment) => {
  antMessage.info('分享功能开发中');
};

// 编辑
const handleEdit = (moment) => {
  publishForm.content = moment.content;
  publishForm.images = moment.images?.map((url, index) => ({
    uid: index,
    name: `image${index}`,
    status: 'done',
    url,
  })) || [];
  publishForm.visibility = moment.visibility || 'public';
  publishModalVisible.value = true;
};

// 删除
const handleDelete = async (momentId) => {
  try {
    const result = await window.electronAPI.social.deletePost(momentId);
    if (result.success) {
      moments.value = moments.value.filter(m => m.id !== momentId);
      antMessage.success('删除成功');
    }
  } catch (error) {
    logger.error('删除失败:', error);
    antMessage.error('删除失败');
  }
};

// 加载更多
const loadMore = () => {
  loadMoments(currentPage.value + 1);
};

// 格式化时间
const formatTime = (timestamp) => {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  if (diff < 60000) {return '刚刚';}
  if (diff < 3600000) {return `${Math.floor(diff / 60000)}分钟前`;}
  if (diff < 86400000) {return `${Math.floor(diff / 3600000)}小时前`;}
  if (diff < 604800000) {return `${Math.floor(diff / 86400000)}天前`;}

  return date.toLocaleDateString();
};

// 缩短DID显示
const shortenDid = (did) => {
  if (!did) {return '';}
  return `${did.slice(0, 8)}...${did.slice(-6)}`;
};

// 计算图片宽度
const getImageWidth = (count) => {
  if (count === 1) {return 300;}
  if (count <= 4) {return 150;}
  return 100;
};

onMounted(() => {
  loadMoments(1);
});
</script>

<style scoped lang="scss">
.moments-timeline {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #f5f5f5;
}

.moments-header {
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

.moments-list {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.moment-item {
  background: white;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 16px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

.moment-header {
  display: flex;
  align-items: center;
  margin-bottom: 12px;
}

.moment-user-info {
  flex: 1;
  margin-left: 12px;
}

.moment-username {
  font-weight: 600;
  font-size: 14px;
}

.moment-time {
  font-size: 12px;
  color: #999;
  margin-top: 2px;
}

.moment-content {
  margin-bottom: 12px;

  p {
    margin: 0 0 12px 0;
    line-height: 1.6;
    white-space: pre-wrap;
  }
}

.moment-images {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.moment-image {
  border-radius: 4px;
  object-fit: cover;
}

.moment-actions {
  padding-top: 12px;
  border-top: 1px solid #f0f0f0;
}

.liked {
  color: #1890ff;
}

.moment-comments {
  margin-top: 12px;
  padding: 12px;
  background: #f5f5f5;
  border-radius: 4px;
}

.comment-item {
  margin-bottom: 8px;
  font-size: 13px;

  &:last-child {
    margin-bottom: 0;
  }
}

.comment-author {
  font-weight: 600;
  color: #1890ff;
  margin-right: 4px;
}

.comment-content {
  color: #333;
}

.comment-time {
  margin-left: 8px;
  color: #999;
  font-size: 12px;
}

.moment-comment-input {
  margin-top: 12px;
}

.load-more {
  text-align: center;
  padding: 16px 0;
}
</style>
