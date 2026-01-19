<template>
  <div class="chat-header" data-testid="chat-header">
    <h3 class="chat-title">
      <MessageOutlined />
      AI 助手
    </h3>

    <a-radio-group
      :value="contextMode"
      size="small"
      button-style="solid"
      data-testid="context-mode-selector"
      @update:value="$emit('update:contextMode', $event)"
    >
      <a-radio-button value="project" data-testid="context-mode-project">
        <FolderOutlined />
        项目
      </a-radio-button>
      <a-radio-button value="file" data-testid="context-mode-file">
        <FileTextOutlined />
        文件
      </a-radio-button>
      <a-radio-button value="global" data-testid="context-mode-global">
        <GlobalOutlined />
        全局
      </a-radio-button>
    </a-radio-group>
  </div>
</template>

<script setup>
import {
  MessageOutlined,
  FolderOutlined,
  FileTextOutlined,
  GlobalOutlined,
} from '@ant-design/icons-vue';

defineProps({
  contextMode: {
    type: String,
    default: 'project',
  },
});

defineEmits(['update:contextMode']);
</script>

<style scoped>
/* 头部 */
.chat-header {
  padding: 20px 24px;
  background: white;
  border-bottom: 1px solid #e5e7eb;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.chat-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #1f2937;
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
