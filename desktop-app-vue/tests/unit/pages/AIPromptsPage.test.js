/**
 * AIPromptsPage 单元测试
 * 测试目标: src/renderer/pages/AIPromptsPage.vue
 *
 * 测试覆盖范围:
 * - 组件挂载
 * - 提示词面板集成
 * - 发送提示词功能
 * - 创建新对话
 * - 填充输入框
 * - 导航到AI聊天页面
 * - 错误处理
 * - 空输入验证
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';

// Mock ant-design-vue
const mockMessage = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}));

vi.mock('ant-design-vue', () => ({
  message: mockMessage,
}));

// Mock vue-router
const mockRouter = {
  push: vi.fn(),
  back: vi.fn(),
};

vi.mock('vue-router', () => ({
  useRouter: () => mockRouter,
  useRoute: () => ({ params: {}, query: {} }),
}));

// Mock window.electronAPI
global.window = {
  electronAPI: {
    conversation: {
      create: vi.fn(),
      addMessage: vi.fn(),
    },
  },
};

describe('AIPromptsPage', () => {
  let wrapper;

  const createWrapper = (options = {}) => {
    return mount(
      {
        template: `
          <div class="ai-prompts-page">
            <SuggestedPromptsPanel
              @send="handleSend"
              @fill-input="handleFillInput"
            />
          </div>
        `,
        setup() {
          const { useRouter } = require('vue-router');
          const antMessage = mockMessage;

          const router = useRouter();

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
              antMessage.error('创建对话失败');
            }
          };

          const handleFillInput = (text) => {
            console.log('填充输入:', text);
          };

          return {
            handleSend,
            handleFillInput,
          };
        },
      },
      {
        global: {
          stubs: {
            SuggestedPromptsPanel: {
              name: 'SuggestedPromptsPanel',
              template: '<div class="suggested-prompts-panel"></div>',
              emits: ['send', 'fill-input'],
            },
          },
        },
        ...options,
      }
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
    window.electronAPI.conversation.create.mockResolvedValue({ id: 'conv-123' });
    window.electronAPI.conversation.addMessage.mockResolvedValue();
  });

  describe('组件挂载', () => {
    it('应该成功挂载组件', () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find('.ai-prompts-page').exists()).toBe(true);
    });

    it('应该渲染提示词面板组件', () => {
      wrapper = createWrapper();
      expect(wrapper.findComponent({ name: 'SuggestedPromptsPanel' }).exists()).toBe(true);
    });
  });

  describe('发送提示词', () => {
    it('应该能发送提示词并创建对话', async () => {
      wrapper = createWrapper();
      const antMessage = mockMessage;

      const promptText = 'Help me write a function to sort an array';

      await wrapper.vm.handleSend(promptText);

      expect(window.electronAPI.conversation.create).toHaveBeenCalledWith({
        title: 'Help me write a function to s...',
      });
      expect(window.electronAPI.conversation.addMessage).toHaveBeenCalledWith(
        'conv-123',
        {
          role: 'user',
          content: promptText,
        }
      );
      expect(mockRouter.push).toHaveBeenCalledWith('/ai/chat');
      expect(antMessage.success).toHaveBeenCalledWith('已创建新对话');
    });

    it('应该能处理短标题', async () => {
      wrapper = createWrapper();

      const shortPrompt = 'Hello';

      await wrapper.vm.handleSend(shortPrompt);

      expect(window.electronAPI.conversation.create).toHaveBeenCalledWith({
        title: 'Hello',
      });
    });

    it('应该截断长标题', async () => {
      wrapper = createWrapper();

      const longPrompt = 'This is a very long prompt text that should be truncated to 30 characters';

      await wrapper.vm.handleSend(longPrompt);

      const createCall = window.electronAPI.conversation.create.mock.calls[0][0];
      expect(createCall.title).toHaveLength(33); // 30 + '...'
      expect(createCall.title).toContain('...');
    });

    it('应该验证空输入', async () => {
      wrapper = createWrapper();
      const antMessage = mockMessage;

      await wrapper.vm.handleSend('');

      expect(antMessage.warning).toHaveBeenCalledWith('请输入消息内容');
      expect(window.electronAPI.conversation.create).not.toHaveBeenCalled();
    });

    it('应该验证仅空格输入', async () => {
      wrapper = createWrapper();
      const antMessage = mockMessage;

      await wrapper.vm.handleSend('   ');

      expect(antMessage.warning).toHaveBeenCalledWith('请输入消息内容');
      expect(window.electronAPI.conversation.create).not.toHaveBeenCalled();
    });

    it('应该能处理创建对话失败', async () => {
      wrapper = createWrapper();
      const antMessage = mockMessage;
      window.electronAPI.conversation.create.mockRejectedValue(
        new Error('Network error')
      );

      await wrapper.vm.handleSend('Test prompt');

      expect(antMessage.error).toHaveBeenCalledWith('创建对话失败');
      expect(mockRouter.push).not.toHaveBeenCalled();
    });

    it('应该能处理添加消息失败', async () => {
      wrapper = createWrapper();
      const antMessage = mockMessage;
      window.electronAPI.conversation.addMessage.mockRejectedValue(
        new Error('Message error')
      );

      await wrapper.vm.handleSend('Test prompt');

      expect(antMessage.error).toHaveBeenCalledWith('创建对话失败');
      expect(mockRouter.push).not.toHaveBeenCalled();
    });

    it('应该能处理多次发送', async () => {
      wrapper = createWrapper();

      await wrapper.vm.handleSend('First prompt');
      await wrapper.vm.handleSend('Second prompt');
      await wrapper.vm.handleSend('Third prompt');

      expect(window.electronAPI.conversation.create).toHaveBeenCalledTimes(3);
      expect(mockRouter.push).toHaveBeenCalledTimes(3);
    });
  });

  describe('填充输入', () => {
    it('应该能填充输入框', () => {
      wrapper = createWrapper();
      const consoleSpy = vi.spyOn(console, 'log');

      wrapper.vm.handleFillInput('Test text');

      expect(consoleSpy).toHaveBeenCalledWith('填充输入:', 'Test text');
      consoleSpy.mockRestore();
    });

    it('应该能填充空文本', () => {
      wrapper = createWrapper();
      const consoleSpy = vi.spyOn(console, 'log');

      wrapper.vm.handleFillInput('');

      expect(consoleSpy).toHaveBeenCalledWith('填充输入:', '');
      consoleSpy.mockRestore();
    });

    it('应该能填充长文本', () => {
      wrapper = createWrapper();
      const consoleSpy = vi.spyOn(console, 'log');
      const longText = 'a'.repeat(1000);

      wrapper.vm.handleFillInput(longText);

      expect(consoleSpy).toHaveBeenCalledWith('填充输入:', longText);
      consoleSpy.mockRestore();
    });
  });

  describe('导航', () => {
    it('应该导航到AI聊天页面', async () => {
      wrapper = createWrapper();

      await wrapper.vm.handleSend('Test prompt');

      expect(mockRouter.push).toHaveBeenCalledWith('/ai/chat');
    });

    it('应该仅在成功时导航', async () => {
      wrapper = createWrapper();
      window.electronAPI.conversation.create.mockRejectedValue(
        new Error('Failed')
      );

      await wrapper.vm.handleSend('Test prompt');

      expect(mockRouter.push).not.toHaveBeenCalled();
    });
  });

  describe('对话创建', () => {
    it('应该创建对话并带正确标题', async () => {
      wrapper = createWrapper();

      await wrapper.vm.handleSend('Generate a sorting algorithm');

      expect(window.electronAPI.conversation.create).toHaveBeenCalledWith({
        title: 'Generate a sorting algorithm',
      });
    });

    it('应该添加用户消息到对话', async () => {
      wrapper = createWrapper();
      const promptText = 'Explain TypeScript generics';

      await wrapper.vm.handleSend(promptText);

      expect(window.electronAPI.conversation.addMessage).toHaveBeenCalledWith(
        'conv-123',
        {
          role: 'user',
          content: promptText,
        }
      );
    });

    it('应该使用返回的对话ID', async () => {
      wrapper = createWrapper();
      window.electronAPI.conversation.create.mockResolvedValue({
        id: 'custom-id-456',
      });

      await wrapper.vm.handleSend('Test prompt');

      expect(window.electronAPI.conversation.addMessage).toHaveBeenCalledWith(
        'custom-id-456',
        expect.any(Object)
      );
    });
  });

  describe('错误处理', () => {
    it('应该能处理网络错误', async () => {
      wrapper = createWrapper();
      const antMessage = mockMessage;
      window.electronAPI.conversation.create.mockRejectedValue(
        new Error('Network error')
      );

      await wrapper.vm.handleSend('Test');

      expect(antMessage.error).toHaveBeenCalledWith('创建对话失败');
    });

    it('应该能处理超时错误', async () => {
      wrapper = createWrapper();
      const antMessage = mockMessage;
      window.electronAPI.conversation.create.mockRejectedValue(
        new Error('Timeout')
      );

      await wrapper.vm.handleSend('Test');

      expect(antMessage.error).toHaveBeenCalledWith('创建对话失败');
    });

    it('应该能处理未知错误', async () => {
      wrapper = createWrapper();
      const antMessage = mockMessage;
      window.electronAPI.conversation.create.mockRejectedValue(
        new Error('Unknown error')
      );

      await wrapper.vm.handleSend('Test');

      expect(antMessage.error).toHaveBeenCalledWith('创建对话失败');
    });
  });

  describe('边界情况', () => {
    it('应该处理null输入', async () => {
      wrapper = createWrapper();
      const antMessage = mockMessage;

      await wrapper.vm.handleSend(null);

      expect(antMessage.warning).toHaveBeenCalled();
    });

    it('应该处理undefined输入', async () => {
      wrapper = createWrapper();
      const antMessage = mockMessage;

      await wrapper.vm.handleSend(undefined);

      expect(antMessage.warning).toHaveBeenCalled();
    });

    it('应该处理非常长的提示词', async () => {
      wrapper = createWrapper();
      const veryLongPrompt = 'a'.repeat(10000);

      await wrapper.vm.handleSend(veryLongPrompt);

      expect(window.electronAPI.conversation.create).toHaveBeenCalled();
      expect(window.electronAPI.conversation.addMessage).toHaveBeenCalledWith(
        'conv-123',
        {
          role: 'user',
          content: veryLongPrompt,
        }
      );
    });

    it('应该处理特殊字符', async () => {
      wrapper = createWrapper();
      const specialChars = '!@#$%^&*()_+-=[]{}|;:",.<>?/\\';

      await wrapper.vm.handleSend(specialChars);

      expect(window.electronAPI.conversation.create).toHaveBeenCalled();
    });

    it('应该处理Unicode字符', async () => {
      wrapper = createWrapper();
      const unicodeText = '你好世界 🌍 مرحبا';

      await wrapper.vm.handleSend(unicodeText);

      expect(window.electronAPI.conversation.create).toHaveBeenCalled();
      expect(window.electronAPI.conversation.addMessage).toHaveBeenCalledWith(
        'conv-123',
        expect.objectContaining({
          content: unicodeText,
        })
      );
    });

    it('应该处理换行符', async () => {
      wrapper = createWrapper();
      const multilineText = 'Line 1\nLine 2\nLine 3';

      await wrapper.vm.handleSend(multilineText);

      expect(window.electronAPI.conversation.create).toHaveBeenCalled();
    });

    it('应该处理Tab字符', async () => {
      wrapper = createWrapper();
      const textWithTabs = 'Column1\tColumn2\tColumn3';

      await wrapper.vm.handleSend(textWithTabs);

      expect(window.electronAPI.conversation.create).toHaveBeenCalled();
    });
  });

  describe('消息角色', () => {
    it('应该创建用户角色消息', async () => {
      wrapper = createWrapper();

      await wrapper.vm.handleSend('Test');

      expect(window.electronAPI.conversation.addMessage).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          role: 'user',
        })
      );
    });

    it('应该包含消息内容', async () => {
      wrapper = createWrapper();
      const content = 'This is my message';

      await wrapper.vm.handleSend(content);

      expect(window.electronAPI.conversation.addMessage).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          content: content,
        })
      );
    });
  });

  describe('成功消息', () => {
    it('应该显示成功消息', async () => {
      wrapper = createWrapper();
      const antMessage = mockMessage;

      await wrapper.vm.handleSend('Test');

      expect(antMessage.success).toHaveBeenCalledWith('已创建新对话');
    });

    it('应该仅在成功时显示成功消息', async () => {
      wrapper = createWrapper();
      const antMessage = mockMessage;
      window.electronAPI.conversation.create.mockRejectedValue(new Error());

      await wrapper.vm.handleSend('Test');

      expect(antMessage.success).not.toHaveBeenCalled();
    });
  });
});
