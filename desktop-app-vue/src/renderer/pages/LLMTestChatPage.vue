<template>
  <div class="llm-test-chat-page">
    <a-page-header
      title="LLM 测试聊天"
      @back="handleBack"
    >
      <template #extra>
        <a-select
          v-model:value="selectedProvider"
          style="width: 200px; margin-right: 12px"
          @change="handleProviderChange"
        >
          <a-select-option
            v-for="provider in availableProviders"
            :key="provider.value"
            :value="provider.value"
          >
            {{ provider.label }}
          </a-select-option>
        </a-select>
        <a-button
          type="default"
          @click="clearChat"
        >
          <DeleteOutlined />
          清空对话
        </a-button>
      </template>
    </a-page-header>

    <div class="chat-container">
      <div class="messages-container">
        <div
          v-if="messages.length === 0"
          class="empty-state"
        >
          <CommentOutlined style="font-size: 48px; color: #d9d9d9; margin-bottom: 16px" />
          <p style="color: #8c8c8c">
            发送消息以测试 {{ getCurrentProviderLabel() }} 服务
          </p>
        </div>

        <div
          v-for="(message, index) in messages"
          :key="index"
          :class="['message-item', message.role]"
        >
          <div class="message-avatar">
            <a-avatar
              v-if="message.role === 'user'"
              style="background-color: #1890ff"
            >
              <template #icon>
                <UserOutlined />
              </template>
            </a-avatar>
            <a-avatar
              v-else
              style="background-color: #52c41a"
            >
              <template #icon>
                <RobotOutlined />
              </template>
            </a-avatar>
          </div>
          <div class="message-content">
            <div class="message-bubble">
              <div
                v-if="message.content"
                class="message-text"
              >
                {{ message.content }}
              </div>
              <a-spin
                v-if="message.loading"
                size="small"
              />
            </div>
            <div
              v-if="message.timestamp"
              class="message-meta"
            >
              <span class="message-time">{{ formatTime(message.timestamp) }}</span>
              <span
                v-if="message.tokens"
                class="message-tokens"
              >
                Tokens: {{ message.tokens }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div class="input-container">
        <a-textarea
          v-model:value="inputMessage"
          :auto-size="{ minRows: 2, maxRows: 6 }"
          placeholder="输入测试消息..."
          :disabled="sending"
          @pressEnter="handleSend"
        />
        <a-button
          type="primary"
          :loading="sending"
          @click="handleSend"
        >
          <SendOutlined />
          发送
        </a-button>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { message } from 'ant-design-vue';
import {
  DeleteOutlined,
  SendOutlined,
  UserOutlined,
  RobotOutlined,
  CommentOutlined,
} from '@ant-design/icons-vue';

export default {
  name: 'LLMTestChatPage',
  components: {
    DeleteOutlined,
    SendOutlined,
    UserOutlined,
    RobotOutlined,
    CommentOutlined,
  },
  setup() {
    const router = useRouter();
    const inputMessage = ref('');
    const messages = ref([]);
    const sending = ref(false);
    const selectedProvider = ref('doubao');

    const availableProviders = ref([
      { value: 'doubao', label: '火山引擎 Doubao' },
      { value: 'qwen', label: '阿里云通义千问' },
      { value: 'deepseek', label: 'DeepSeek' },
      { value: 'openai', label: 'OpenAI' },
      { value: 'claude', label: 'Claude' },
      { value: 'ollama', label: 'Ollama (本地)' },
    ]);

    const handleBack = () => {
      router.back();
    };

    const getCurrentProviderLabel = () => {
      const provider = availableProviders.value.find(
        (p) => p.value === selectedProvider.value
      );
      return provider ? provider.label : '';
    };

    const handleProviderChange = () => {
      message.info(`已切换到 ${getCurrentProviderLabel()}`);
    };

    const clearChat = () => {
      messages.value = [];
      message.success('对话已清空');
    };

    const formatTime = (timestamp) => {
      const date = new Date(timestamp);
      return date.toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
      });
    };

    const handleSend = async (e) => {
      if (e && e.shiftKey) {
        return; // Shift+Enter for new line
      }

      if (e) {
        e.preventDefault();
      }

      const content = inputMessage.value.trim();
      if (!content) {
        return;
      }

      // Add user message
      const userMessage = {
        role: 'user',
        content,
        timestamp: Date.now(),
      };
      messages.value.push(userMessage);
      inputMessage.value = '';

      // Add assistant placeholder
      const assistantMessage = {
        role: 'assistant',
        content: '',
        loading: true,
        timestamp: Date.now(),
      };
      messages.value.push(assistantMessage);

      sending.value = true;

      try {
        // Call LLM API
        const response = await window.electron.invoke('llm:chat', {
          provider: selectedProvider.value,
          messages: [{ role: 'user', content }],
        });

        // Update assistant message
        const lastMessage = messages.value[messages.value.length - 1];
        lastMessage.content = response.content;
        lastMessage.loading = false;
        lastMessage.tokens = response.usage?.total_tokens || null;
      } catch (error) {
        console.error('LLM chat error:', error);
        const lastMessage = messages.value[messages.value.length - 1];
        lastMessage.content = `错误: ${error.message}`;
        lastMessage.loading = false;
        message.error('发送失败: ' + error.message);
      } finally {
        sending.value = false;
      }

      // Scroll to bottom
      setTimeout(() => {
        const container = document.querySelector('.messages-container');
        if (container) {
          container.scrollTop = container.scrollHeight;
        }
      }, 100);
    };

    onMounted(() => {
      // Load saved provider preference
      const savedProvider = localStorage.getItem('llm-test-provider');
      if (savedProvider) {
        selectedProvider.value = savedProvider;
      }
    });

    return {
      inputMessage,
      messages,
      sending,
      selectedProvider,
      availableProviders,
      handleBack,
      getCurrentProviderLabel,
      handleProviderChange,
      clearChat,
      formatTime,
      handleSend,
    };
  },
};
</script>

<style scoped lang="scss">
.llm-test-chat-page {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background-color: #f0f2f5;

  .chat-container {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    padding: 16px;

    .messages-container {
      flex: 1;
      overflow-y: auto;
      background: white;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 16px;

      .empty-state {
        height: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
      }

      .message-item {
        display: flex;
        margin-bottom: 24px;

        &.user {
          flex-direction: row-reverse;

          .message-content {
            align-items: flex-end;
          }

          .message-bubble {
            background-color: #1890ff;
            color: white;
          }

          .message-avatar {
            margin-left: 12px;
          }
        }

        &.assistant {
          .message-bubble {
            background-color: #f0f0f0;
            color: #262626;
          }

          .message-avatar {
            margin-right: 12px;
          }
        }

        .message-avatar {
          flex-shrink: 0;
        }

        .message-content {
          flex: 1;
          display: flex;
          flex-direction: column;
          max-width: 70%;

          .message-bubble {
            padding: 12px 16px;
            border-radius: 12px;
            word-wrap: break-word;

            .message-text {
              white-space: pre-wrap;
            }
          }

          .message-meta {
            margin-top: 4px;
            font-size: 12px;
            color: #8c8c8c;
            display: flex;
            gap: 12px;

            .message-time {
            }

            .message-tokens {
              font-family: monospace;
            }
          }
        }
      }
    }

    .input-container {
      background: white;
      border-radius: 8px;
      padding: 16px;
      display: flex;
      gap: 12px;
      align-items: flex-end;

      :deep(.ant-input) {
        flex: 1;
      }

      .ant-btn {
        flex-shrink: 0;
      }
    }
  }
}
</style>
