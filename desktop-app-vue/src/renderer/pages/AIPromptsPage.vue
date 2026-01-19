<template>
  <div class="ai-prompts-page">
    <SuggestedPromptsPanel
      @send="handleSend"
      @fill-input="handleFillInput"
    />
  </div>
</template>

<script setup>
import { logger, createLogger } from '@/utils/logger';

import { useRouter } from 'vue-router';
import { message as antMessage } from 'ant-design-vue';
import SuggestedPromptsPanel from '@/components/SuggestedPromptsPanel.vue';

const router = useRouter();

// Handle sending message from prompts panel
const handleSend = async (text) => {
  if (!text.trim()) {
    antMessage.warning('请输入消息内容');
    return;
  }

  try {
    // Create a new conversation
    const conversation = await window.electronAPI.conversation.create({
      title: text.substring(0, 30) + (text.length > 30 ? '...' : ''),
    });

    // Add the user's message to the conversation
    await window.electronAPI.conversation.addMessage(conversation.id, {
      role: 'user',
      content: text,
    });

    // Navigate to AI chat page to continue the conversation
    router.push('/ai/chat');

    antMessage.success('已创建新对话');
  } catch (error) {
    logger.error('创建对话失败:', error);
    antMessage.error('创建对话失败');
  }
};

// Handle filling input (just for UI feedback)
const handleFillInput = (text) => {
  logger.info('填充输入:', text);
};
</script>

<style lang="scss" scoped>
.ai-prompts-page {
  height: 100vh;
  width: 100%;
  overflow: auto;
}
</style>
