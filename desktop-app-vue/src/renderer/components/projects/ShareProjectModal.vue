<template>
  <a-modal
    :open="visible"
    title="分享公开对话"
    :width="520"
    :footer="null"
    @cancel="handleClose"
  >
    <div class="share-modal-content">
      <!-- 分享选项 -->
      <div class="share-options">
        <a-radio-group v-model:value="shareType" @change="handleShareTypeChange">
          <a-radio value="private" class="share-option">
            <div class="option-content">
              <div class="option-header">
                <LockOutlined class="option-icon" />
                <span class="option-title">仅限自己</span>
              </div>
              <div class="option-description">
                仅你已登录
              </div>
            </div>
          </a-radio>

          <a-radio value="public" class="share-option">
            <div class="option-content">
              <div class="option-header">
                <GlobalOutlined class="option-icon" />
                <span class="option-title">公开访问</span>
              </div>
              <div class="option-description">
                仅在联网时能进入对话,回退此按钮将完全部的对话关闭
              </div>
            </div>
          </a-radio>
        </a-radio-group>
      </div>

      <!-- 分享链接 (仅在公开访问时显示) -->
      <div v-if="shareType === 'public'" class="share-link-section">
        <div class="share-link-header">
          <LinkOutlined />
          <span>分享链接</span>
        </div>

        <div class="share-link-input">
          <a-input
            :value="shareLink"
            readonly
            :suffix="copyStatus === 'success' ? '已复制' : ''"
          >
            <template #addonAfter>
              <a-button
                type="link"
                @click="handleCopyLink"
              >
                <CopyOutlined v-if="copyStatus !== 'success'" />
                <CheckOutlined v-else />
              </a-button>
            </template>
          </a-input>
        </div>

        <div class="share-tips">
          <InfoCircleOutlined />
          <span>任何拥有此链接的人都可以访问该对话</span>
        </div>
      </div>

      <!-- 操作按钮 -->
      <div class="share-actions">
        <a-button @click="handleClose">
          取消
        </a-button>
        <a-button
          type="primary"
          :loading="saving"
          @click="handleConfirm"
        >
          {{ shareType === 'public' ? '复制链接' : '确定' }}
        </a-button>
      </div>
    </div>
  </a-modal>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { message } from 'ant-design-vue';
import {
  LockOutlined,
  GlobalOutlined,
  LinkOutlined,
  CopyOutlined,
  CheckOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons-vue';

const props = defineProps({
  visible: {
    type: Boolean,
    default: false,
  },
  projectId: {
    type: String,
    default: '',
  },
  projectName: {
    type: String,
    default: '',
  },
  currentShareType: {
    type: String,
    default: 'private', // 'private' | 'public'
  },
});

const emit = defineEmits(['close', 'update:shareType']);

const shareType = ref('private');
const saving = ref(false);
const copyStatus = ref(''); // '' | 'success'
const currentShareInfo = ref(null); // 当前分享信息

// 生成分享链接
const shareLink = computed(() => {
  if (currentShareInfo.value && currentShareInfo.value.share_link) {
    return currentShareInfo.value.share_link;
  }
  // 默认值（当还没加载时）
  if (!props.projectId) return '';
  const baseUrl = window.location.origin;
  return `${baseUrl}/share/project/${props.projectId}`;
});

// 监听props变化
watch(() => props.visible, async (val) => {
  if (val) {
    shareType.value = props.currentShareType || 'private';
    copyStatus.value = '';

    // 加载现有分享信息
    await loadShareInfo();
  }
});

// 加载分享信息
const loadShareInfo = async () => {
  if (!props.projectId) return;

  try {
    const result = await window.electronAPI.project.getShare(props.projectId);
    if (result.success && result.share) {
      currentShareInfo.value = result.share;
      shareType.value = result.share.share_mode;
    } else {
      currentShareInfo.value = null;
    }
  } catch (error) {
    console.error('加载分享信息失败:', error);
    currentShareInfo.value = null;
  }
};

// 处理分享类型变化
const handleShareTypeChange = () => {
  copyStatus.value = '';
};

// 复制链接
const handleCopyLink = async () => {
  try {
    await navigator.clipboard.writeText(shareLink.value);
    copyStatus.value = 'success';
    message.success('链接已复制到剪贴板');

    // 3秒后重置状态
    setTimeout(() => {
      copyStatus.value = '';
    }, 3000);
  } catch (error) {
    console.error('复制链接失败:', error);
    message.error('复制失败,请手动复制');
  }
};

// 确认
const handleConfirm = async () => {
  if (shareType.value === 'public') {
    // 如果是公开访问,复制链接
    await handleCopyLink();
  }

  saving.value = true;
  try {
    // 调用后端API保存分享设置
    const result = await window.electronAPI.project.shareProject({
      projectId: props.projectId,
      shareMode: shareType.value,
      expiresInDays: null, // 永不过期
      regenerateToken: false // 不重新生成token
    });

    if (result.success) {
      // 更新本地分享信息
      currentShareInfo.value = result.share;

      emit('update:shareType', shareType.value);
      message.success(shareType.value === 'public' ? '已设置为公开访问' : '已设置为私密访问');
      handleClose();
    } else {
      throw new Error('分享设置失败');
    }
  } catch (error) {
    console.error('保存分享设置失败:', error);
    message.error('保存失败: ' + error.message);
  } finally {
    saving.value = false;
  }
};

// 关闭
const handleClose = () => {
  emit('close');
};
</script>

<style scoped lang="scss">
.share-modal-content {
  .share-options {
    :deep(.ant-radio-group) {
      width: 100%;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .share-option {
      width: 100%;
      padding: 16px;
      border: 1px solid #d9d9d9;
      border-radius: 8px;
      transition: all 0.2s;

      &:hover {
        border-color: #1677ff;
      }

      :deep(.ant-radio) {
        align-self: flex-start;
        margin-top: 2px;
      }

      :deep(.ant-radio-wrapper) {
        width: 100%;
        display: flex;
        align-items: flex-start;
      }

      :deep(.ant-radio-checked + *) {
        .option-content {
          .option-header {
            color: #1677ff;
          }
        }
      }

      .option-content {
        flex: 1;
        margin-left: 12px;

        .option-header {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 6px;
          color: #333;

          .option-icon {
            font-size: 16px;
          }

          .option-title {
            font-size: 14px;
            font-weight: 500;
          }
        }

        .option-description {
          font-size: 12px;
          color: #666;
          line-height: 1.5;
        }
      }
    }

    :deep(.ant-radio-wrapper-checked) {
      .share-option {
        border-color: #1677ff;
        background: #f0f5ff;
      }
    }
  }

  .share-link-section {
    margin-top: 20px;
    padding: 16px;
    background: #f5f5f5;
    border-radius: 8px;

    .share-link-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 12px;
      font-size: 14px;
      font-weight: 500;
      color: #333;

      .anticon {
        font-size: 16px;
        color: #1677ff;
      }
    }

    .share-link-input {
      margin-bottom: 12px;

      :deep(.ant-input-group-wrapper) {
        .ant-input {
          font-size: 13px;
          color: #666;
        }

        .ant-input-group-addon {
          padding: 0;
          background: transparent;
          border: none;
        }

        .ant-btn-link {
          color: #1677ff;

          &:hover {
            color: #4096ff;
          }
        }
      }

      :deep(.ant-input-suffix) {
        color: #52c41a;
        font-size: 12px;
      }
    }

    .share-tips {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      font-size: 12px;
      color: #999;

      .anticon {
        margin-top: 2px;
        color: #faad14;
      }

      span {
        line-height: 1.5;
      }
    }
  }

  .share-actions {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    margin-top: 24px;
    padding-top: 16px;
    border-top: 1px solid #f0f0f0;
  }
}
</style>
