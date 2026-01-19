<template>
  <div class="task-comments">
    <!-- 评论列表 -->
    <div
      ref="commentsContainer"
      class="comments-list"
    >
      <a-empty
        v-if="comments.length === 0"
        description="暂无评论"
        :image="Empty.PRESENTED_IMAGE_SIMPLE"
      />

      <div
        v-else
        class="comment-items"
      >
        <div
          v-for="comment in sortedComments"
          :key="comment.id"
          class="comment-item"
          :class="{ 'is-deleted': comment.is_deleted }"
        >
          <!-- 评论头像 -->
          <div class="comment-avatar">
            <a-avatar
              :size="32"
              :style="{ backgroundColor: getAvatarColor(comment.author_did) }"
            >
              {{ getAvatarText(comment.author_did) }}
            </a-avatar>
          </div>

          <!-- 评论内容 -->
          <div class="comment-content">
            <div class="comment-header">
              <span class="author-name">{{ getAuthorName(comment.author_did) }}</span>
              <span class="comment-time">{{ formatTime(comment.created_at) }}</span>
            </div>

            <div class="comment-body">
              <div
                v-if="comment.is_deleted"
                class="deleted-message"
              >
                该评论已被删除
              </div>
              <div v-else>
                <div
                  class="comment-text"
                  v-html="renderComment(comment.content)"
                />

                <!-- 附件 -->
                <div
                  v-if="comment.attachments && comment.attachments.length > 0"
                  class="comment-attachments"
                >
                  <a-space>
                    <a-tag
                      v-for="(attachment, index) in comment.attachments"
                      :key="index"
                      :icon="h(PaperclipOutlined)"
                    >
                      {{ attachment.name }}
                    </a-tag>
                  </a-space>
                </div>

                <!-- @提及 -->
                <div
                  v-if="comment.mentions && comment.mentions.length > 0"
                  class="comment-mentions"
                >
                  <a-tag
                    v-for="(mention, index) in comment.mentions"
                    :key="index"
                    color="blue"
                    size="small"
                  >
                    @{{ getMentionName(mention) }}
                  </a-tag>
                </div>
              </div>
            </div>

            <!-- 评论操作 -->
            <div
              v-if="!comment.is_deleted"
              class="comment-actions"
            >
              <a-button
                type="link"
                size="small"
                @click="handleReply(comment)"
              >
                回复
              </a-button>
              <a-button
                type="link"
                size="small"
                danger
                @click="handleDelete(comment)"
              >
                删除
              </a-button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 评论输入框 -->
    <div class="comment-input-area">
      <a-textarea
        v-model:value="newComment"
        :placeholder="replyingTo ? `回复 ${getAuthorName(replyingTo.author_did)}...` : '添加评论...'"
        :auto-size="{ minRows: 3, maxRows: 6 }"
        @keydown.ctrl.enter="handleSubmit"
        @keydown.meta.enter="handleSubmit"
      />

      <div class="input-actions">
        <div class="left-actions">
          <!-- @提及选择器 -->
          <a-dropdown :trigger="['click']">
            <a-button size="small">
              <at-outlined /> 提及
            </a-button>
            <template #overlay>
              <a-menu @click="handleMention">
                <a-menu-item
                  v-for="member in workspaceMembers"
                  :key="member.did"
                >
                  {{ member.name }}
                </a-menu-item>
              </a-menu>
            </template>
          </a-dropdown>

          <!-- 附件上传 -->
          <a-upload
            :show-upload-list="false"
            :before-upload="handleAttachmentUpload"
          >
            <a-button size="small">
              <paperclip-outlined /> 附件
            </a-button>
          </a-upload>

          <!-- 已选附件 -->
          <a-space
            v-if="attachments.length > 0"
            size="small"
          >
            <a-tag
              v-for="(file, index) in attachments"
              :key="index"
              closable
              @close="() => removeAttachment(index)"
            >
              {{ file.name }}
            </a-tag>
          </a-space>
        </div>

        <div class="right-actions">
          <a-button
            v-if="replyingTo"
            size="small"
            @click="cancelReply"
          >
            取消回复
          </a-button>
          <a-button
            type="primary"
            size="small"
            :loading="submitting"
            @click="handleSubmit"
          >
            <send-outlined /> 发送 (Ctrl+Enter)
          </a-button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { logger, createLogger } from '@/utils/logger';

import { ref, computed, h, nextTick, watch } from 'vue';
import { Modal, Empty } from 'ant-design-vue';
import {
  PaperclipOutlined,
  AtOutlined,
  SendOutlined
} from '@ant-design/icons-vue';
import { useTaskStore } from '../../stores/task';

// Props
const props = defineProps({
  taskId: {
    type: String,
    required: true
  },
  comments: {
    type: Array,
    default: () => []
  },
  workspaceMembers: {
    type: Array,
    default: () => []
  }
});

// Emits
const emit = defineEmits(['submit', 'delete', 'reply']);

// Stores
const taskStore = useTaskStore();

// State
const newComment = ref('');
const replyingTo = ref(null);
const submitting = ref(false);
const attachments = ref([]);
const mentions = ref([]);
const commentsContainer = ref(null);

// Computed
const sortedComments = computed(() => {
  return [...props.comments].sort((a, b) => a.created_at - b.created_at);
});

// Methods
function getAuthorName(authorDID) {
  // TODO: 从用户信息获取真实姓名
  return authorDID.substring(0, 10) + '...';
}

function getAvatarColor(did) {
  const colors = ['#1890ff', '#52c41a', '#faad14', '#f5222d', '#722ed1', '#13c2c2'];
  let hash = 0;
  for (let i = 0; i < did.length; i++) {
    hash = did.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

function getAvatarText(did) {
  return did.substring(0, 2).toUpperCase();
}

function getMentionName(did) {
  return did.substring(0, 10) + '...';
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) {return '刚刚';}
  if (minutes < 60) {return `${minutes}分钟前`;}
  if (hours < 24) {return `${hours}小时前`;}
  if (days < 7) {return `${days}天前`;}

  return date.toLocaleDateString('zh-CN');
}

function renderComment(content) {
  // 渲染 @ 提及
  let rendered = content.replace(/@(\w+)/g, '<span class="mention">@$1</span>');

  // 转换换行
  rendered = rendered.replace(/\n/g, '<br>');

  return rendered;
}

function handleMention({ key }) {
  const member = props.workspaceMembers.find(m => m.did === key);
  if (member) {
    newComment.value += `@${member.name} `;
    if (!mentions.value.includes(key)) {
      mentions.value.push(key);
    }
  }
}

function handleAttachmentUpload(file) {
  attachments.value.push(file);
  return false; // 阻止自动上传
}

function removeAttachment(index) {
  attachments.value.splice(index, 1);
}

function handleReply(comment) {
  replyingTo.value = comment;
  newComment.value = `@${getAuthorName(comment.author_did)} `;
}

function cancelReply() {
  replyingTo.value = null;
  newComment.value = '';
}

async function handleSubmit() {
  if (!newComment.value.trim()) {return;}

  submitting.value = true;

  try {
    const success = await taskStore.addComment(
      props.taskId,
      newComment.value,
      mentions.value
    );

    if (success) {
      newComment.value = '';
      mentions.value = [];
      attachments.value = [];
      replyingTo.value = null;
      emit('submit');

      // 滚动到底部
      await nextTick();
      if (commentsContainer.value) {
        commentsContainer.value.scrollTop = commentsContainer.value.scrollHeight;
      }
    }
  } catch (error) {
    logger.error('Submit comment failed:', error);
  } finally {
    submitting.value = false;
  }
}

function handleDelete(comment) {
  Modal.confirm({
    title: '确认删除',
    content: '确定要删除这条评论吗？',
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    onOk: async () => {
      const success = await taskStore.deleteComment(comment.id);
      if (success) {
        emit('delete', comment);
      }
    }
  });
}

// Watch comments to scroll to bottom when new comment added
watch(
  () => props.comments.length,
  async () => {
    await nextTick();
    if (commentsContainer.value) {
      commentsContainer.value.scrollTop = commentsContainer.value.scrollHeight;
    }
  }
);
</script>

<style scoped lang="less">
.task-comments {
  display: flex;
  flex-direction: column;
  height: 100%;

  .comments-list {
    flex: 1;
    overflow-y: auto;
    padding: 16px;

    .comment-items {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .comment-item {
      display: flex;
      gap: 12px;

      &.is-deleted {
        opacity: 0.5;
      }

      .comment-avatar {
        flex-shrink: 0;
      }

      .comment-content {
        flex: 1;
        min-width: 0;

        .comment-header {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 4px;

          .author-name {
            font-size: 14px;
            font-weight: 500;
            color: #262626;
          }

          .comment-time {
            font-size: 12px;
            color: #8c8c8c;
          }
        }

        .comment-body {
          .deleted-message {
            font-size: 13px;
            color: #8c8c8c;
            font-style: italic;
          }

          .comment-text {
            font-size: 14px;
            color: #262626;
            line-height: 1.6;
            word-break: break-word;

            :deep(.mention) {
              color: #1890ff;
              font-weight: 500;
            }
          }

          .comment-attachments,
          .comment-mentions {
            margin-top: 8px;
          }
        }

        .comment-actions {
          margin-top: 8px;
          display: flex;
          gap: 8px;
        }
      }
    }
  }

  .comment-input-area {
    border-top: 1px solid #e8e8e8;
    padding: 16px;
    background: #fafafa;

    .input-actions {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 8px;

      .left-actions,
      .right-actions {
        display: flex;
        gap: 8px;
        align-items: center;
      }
    }
  }
}
</style>
