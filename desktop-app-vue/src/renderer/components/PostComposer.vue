<template>
  <div class="post-composer">
    <a-card :title="editing ? '编辑动态' : '发布动态'">
      <a-form layout="vertical">
        <!-- 内容输入 -->
        <a-form-item label="内容">
          <a-textarea
            v-model:value="content"
            placeholder="分享你的想法..."
            :rows="6"
            :maxlength="1000"
            show-count
          />
        </a-form-item>

        <!-- 图片上传 -->
        <a-form-item label="图片（最多9张）">
          <div class="image-upload-area">
            <div
              v-for="(image, index) in images"
              :key="index"
              class="image-preview"
            >
              <img
                :src="image"
                alt="预览图"
              >
              <a-button
                type="text"
                danger
                size="small"
                class="remove-btn"
                @click="removeImage(index)"
              >
                <template #icon>
                  <close-outlined />
                </template>
              </a-button>
            </div>
            <div
              v-if="images.length < 9"
              class="upload-btn"
              @click="selectImages"
            >
              <plus-outlined style="font-size: 24px" />
              <div>添加图片</div>
            </div>
          </div>
        </a-form-item>

        <!-- 链接分享 -->
        <a-collapse
          v-model:active-key="linkCollapse"
          ghost
        >
          <a-collapse-panel
            key="link"
            header="添加链接"
          >
            <a-form-item label="链接 URL">
              <a-input
                v-model:value="linkUrl"
                placeholder="https://..."
              />
            </a-form-item>
            <a-form-item label="链接标题">
              <a-input
                v-model:value="linkTitle"
                placeholder="链接标题（可选）"
              />
            </a-form-item>
            <a-form-item label="链接描述">
              <a-textarea
                v-model:value="linkDescription"
                placeholder="链接描述（可选）"
                :rows="2"
              />
            </a-form-item>
          </a-collapse-panel>
        </a-collapse>

        <!-- 可见性设置 -->
        <a-form-item label="可见性">
          <a-radio-group
            v-model:value="visibility"
            button-style="solid"
          >
            <a-radio-button value="public">
              <global-outlined /> 公开
            </a-radio-button>
            <a-radio-button value="friends">
              <team-outlined /> 仅好友
            </a-radio-button>
            <a-radio-button value="private">
              <lock-outlined /> 仅自己
            </a-radio-button>
          </a-radio-group>
        </a-form-item>

        <!-- 操作按钮 -->
        <a-form-item>
          <a-space>
            <a-button
              type="primary"
              :loading="publishing"
              @click="handlePublish"
            >
              <template #icon>
                <send-outlined />
              </template>
              {{ editing ? '保存' : '发布' }}
            </a-button>
            <a-button @click="handleCancel">
              取消
            </a-button>
            <a-button
              type="text"
              danger
              @click="handleClear"
            >
              清空
            </a-button>
          </a-space>
        </a-form-item>
      </a-form>
    </a-card>
  </div>
</template>

<script setup>
import { logger, createLogger } from '@/utils/logger';

import { ref, reactive, computed } from 'vue';
import { message as antMessage } from 'ant-design-vue';
import {
  PlusOutlined,
  CloseOutlined,
  SendOutlined,
  GlobalOutlined,
  TeamOutlined,
  LockOutlined,
} from '@ant-design/icons-vue';

// Props
const props = defineProps({
  initialContent: {
    type: String,
    default: '',
  },
  initialImages: {
    type: Array,
    default: () => [],
  },
  initialVisibility: {
    type: String,
    default: 'public',
  },
  editing: {
    type: Boolean,
    default: false,
  },
});

// Emits
const emit = defineEmits(['published', 'cancel']);

// 状态
const content = ref(props.initialContent);
const images = ref([...props.initialImages]);
const linkUrl = ref('');
const linkTitle = ref('');
const linkDescription = ref('');
const visibility = ref(props.initialVisibility);
const publishing = ref(false);
const linkCollapse = ref([]);

// 选择图片
const selectImages = async () => {
  try {
    const remainingSlots = 9 - images.value.length;

    if (remainingSlots <= 0) {
      antMessage.warning('最多只能添加 9 张图片');
      return;
    }

    // 使用 electronAPI 选择图片
    const result = await window.electronAPI.image.selectImages();

    if (!result.canceled && result.filePaths.length > 0) {
      const filesToAdd = result.filePaths.slice(0, remainingSlots);

      // 读取文件并转换为 base64（使用 File API）
      for (const filePath of filesToAdd) {
        try {
          // 使用 FileReader 读取本地文件
          const response = await fetch(`file://${filePath}`);
          const blob = await response.blob();
          const base64 = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });

          images.value.push(base64);
        } catch (error) {
          logger.error('读取图片失败:', filePath, error);
        }
      }

      if (result.filePaths.length > remainingSlots) {
        antMessage.warning(`最多只能添加 ${remainingSlots} 张图片`);
      }
    }
  } catch (error) {
    logger.error('选择图片失败:', error);
    antMessage.error('选择图片失败: ' + error.message);
  }
};

// 移除图片
const removeImage = (index) => {
  images.value.splice(index, 1);
};

// 发布动态
const handlePublish = async () => {
  try {
    if (!content.value || content.value.trim().length === 0) {
      antMessage.warning('请输入动态内容');
      return;
    }

    publishing.value = true;

    const options = {
      content: content.value.trim(),
      images: images.value,
      visibility: visibility.value,
    };

    // 添加链接信息
    if (linkUrl.value) {
      options.linkUrl = linkUrl.value;
      options.linkTitle = linkTitle.value;
      options.linkDescription = linkDescription.value;
    }

    const post = await window.electronAPI.post.create(options);

    antMessage.success(props.editing ? '动态已更新' : '动态已发布');

    // 通知父组件
    emit('published', post);

    // 清空表单
    if (!props.editing) {
      handleClear();
    }
  } catch (error) {
    logger.error('发布动态失败:', error);
    antMessage.error('发布动态失败: ' + error.message);
  } finally {
    publishing.value = false;
  }
};

// 取消
const handleCancel = () => {
  emit('cancel');
};

// 清空表单
const handleClear = () => {
  content.value = '';
  images.value = [];
  linkUrl.value = '';
  linkTitle.value = '';
  linkDescription.value = '';
  visibility.value = 'public';
  linkCollapse.value = [];
};
</script>

<style scoped>
.post-composer {
  max-width: 800px;
  margin: 0 auto;
}

.image-upload-area {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.image-preview {
  position: relative;
  width: 120px;
  height: 120px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid #d9d9d9;
}

.image-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.remove-btn {
  position: absolute;
  top: 4px;
  right: 4px;
  background: rgba(0, 0, 0, 0.6);
  color: white;
  border-radius: 50%;
  padding: 4px;
}

.remove-btn:hover {
  background: rgba(255, 0, 0, 0.8);
}

.upload-btn {
  width: 120px;
  height: 120px;
  border: 2px dashed #d9d9d9;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.3s;
  color: #999;
}

.upload-btn:hover {
  border-color: #1890ff;
  color: #1890ff;
}
</style>
