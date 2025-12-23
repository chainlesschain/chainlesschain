<template>
  <a-modal
    v-model:open="visible"
    title="分享公开对话"
    :width="500"
    @ok="handleShareConfirm"
    @cancel="handleCancel"
  >
    <div class="share-dialog-content">
      <a-radio-group v-model:value="shareMode" class="share-mode-group">
        <a-radio value="private" class="share-mode-item">
          <div class="mode-content">
            <div class="mode-header">
              <lock-outlined class="mode-icon" />
              <span class="mode-title">仅限自己</span>
            </div>
            <div class="mode-description">仅限已选用户访问</div>
          </div>
        </a-radio>

        <a-radio value="public" class="share-mode-item">
          <div class="mode-content">
            <div class="mode-header">
              <global-outlined class="mode-icon" />
              <span class="mode-title">公开访问</span>
            </div>
            <div class="mode-description">在社区页面公开，拥有链接的任何人都可以查看</div>
          </div>
        </a-radio>
      </a-radio-group>

      <div v-if="shareLink" class="share-link-section">
        <div class="share-link-label">分享链接</div>
        <div class="share-link-input">
          <a-input v-model:value="shareLink" readonly>
            <template #suffix>
              <copy-outlined @click="copyShareLink" class="copy-icon" />
            </template>
          </a-input>
        </div>
      </div>

      <div class="share-actions">
        <a-button @click="shareToWechat" :disabled="!shareLink">
          <wechat-outlined />
          微信分享
        </a-button>
        <a-button @click="copyShareLink" :disabled="!shareLink">
          <link-outlined />
          复制链接
        </a-button>
      </div>
    </div>
  </a-modal>
</template>

<script setup>
import { ref, watch } from 'vue';
import { message } from 'ant-design-vue';
import {
  LockOutlined,
  GlobalOutlined,
  WechatOutlined,
  LinkOutlined,
  CopyOutlined
} from '@ant-design/icons-vue';

const props = defineProps({
  open: {
    type: Boolean,
    default: false
  },
  project: {
    type: Object,
    required: true
  }
});

const emit = defineEmits(['update:open', 'share-success']);

const visible = ref(props.open);
const shareMode = ref(props.project?.share_mode || 'private');
const shareLink = ref(props.project?.share_link || '');
const shareToken = ref(props.project?.share_token || '');

watch(() => props.open, (newVal) => {
  visible.value = newVal;
  if (newVal && props.project) {
    shareMode.value = props.project.share_mode || 'private';
    shareLink.value = props.project.share_link || '';
    shareToken.value = props.project.share_token || '';
  }
});

watch(visible, (newVal) => {
  emit('update:open', newVal);
});

/**
 * 确认分享
 */
const handleShareConfirm = async () => {
  try {
    message.loading({ content: '正在设置分享...', key: 'share', duration: 0 });

    const result = await window.electronAPI.project.shareProject({
      projectId: props.project.id,
      shareMode: shareMode.value
    });

    shareLink.value = result.shareLink;
    shareToken.value = result.shareToken;

    message.success({
      content: shareMode.value === 'public' ? '项目已公开分享' : '分享设置已更新',
      key: 'share',
      duration: 2
    });

    emit('share-success', {
      shareMode: shareMode.value,
      shareLink: shareLink.value,
      shareToken: shareToken.value
    });

    visible.value = false;
  } catch (error) {
    console.error('分享失败:', error);
    message.error({ content: `分享失败: ${error.message}`, key: 'share', duration: 3 });
  }
};

/**
 * 取消分享
 */
const handleCancel = () => {
  visible.value = false;
};

/**
 * 复制分享链接
 */
const copyShareLink = async () => {
  if (!shareLink.value) {
    message.warning('请先设置分享模式');
    return;
  }

  try {
    await navigator.clipboard.writeText(shareLink.value);
    message.success('链接已复制到剪贴板');
  } catch (error) {
    console.error('复制失败:', error);

    // 降级方案：使用传统方法
    try {
      const textArea = document.createElement('textarea');
      textArea.value = shareLink.value;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      message.success('链接已复制到剪贴板');
    } catch (fallbackError) {
      message.error('复制失败，请手动复制');
    }
  }
};

/**
 * 微信分享
 */
const shareToWechat = async () => {
  if (!shareLink.value) {
    message.warning('请先设置分享模式');
    return;
  }

  try {
    // 生成二维码并打开分享窗口
    await window.electronAPI.project.shareToWechat({
      projectId: props.project.id,
      shareLink: shareLink.value
    });

    message.info('请使用微信扫描二维码分享');
  } catch (error) {
    console.error('微信分享失败:', error);
    message.error('微信分享功能暂未实现，请使用复制链接');
  }
};
</script>

<style scoped>
.share-dialog-content {
  padding: 10px 0;
}

.share-mode-group {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.share-mode-item {
  width: 100%;
  padding: 16px;
  border: 1px solid #d9d9d9;
  border-radius: 8px;
  transition: all 0.3s;
}

.share-mode-item:hover {
  border-color: #1677ff;
  background-color: #f5f5f5;
}

:deep(.ant-radio-wrapper-checked) .share-mode-item {
  border-color: #1677ff;
  background-color: #e6f7ff;
}

.mode-content {
  margin-left: 8px;
}

.mode-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.mode-icon {
  font-size: 16px;
  color: #1677ff;
}

.mode-title {
  font-size: 15px;
  font-weight: 500;
  color: #262626;
}

.mode-description {
  font-size: 13px;
  color: #8c8c8c;
  line-height: 1.5;
  margin-left: 24px;
}

.share-link-section {
  margin-top: 24px;
  padding-top: 24px;
  border-top: 1px solid #f0f0f0;
}

.share-link-label {
  font-size: 14px;
  font-weight: 500;
  color: #262626;
  margin-bottom: 8px;
}

.share-link-input {
  margin-bottom: 16px;
}

.copy-icon {
  cursor: pointer;
  color: #1677ff;
  font-size: 16px;
}

.copy-icon:hover {
  color: #4096ff;
}

.share-actions {
  display: flex;
  gap: 12px;
  margin-top: 16px;
}

.share-actions .ant-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

:deep(.ant-radio) {
  align-self: flex-start;
  margin-top: 4px;
}

:deep(.ant-radio-wrapper) {
  width: 100%;
  display: block;
}
</style>
