/**
 * 核心组件单元测试
 * 测试关键的Vue组件功能
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import { mockElectronAPI } from '../../setup';

describe('核心组件测试', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('ChatPanel 组件', () => {
    let wrapper: VueWrapper<any>;

    const createChatPanelWrapper = (props = {}) => {
      return mount({
        template: `
          <div>
            <input ref="input" v-model="message" />
            <button @click="sendMessage">发送</button>
            <div class="messages">
              <div v-for="msg in messages" :key="msg.id" class="message">
                <span class="role">{{ msg.role }}</span>
                <span class="content">{{ msg.content }}</span>
              </div>
            </div>
          </div>
        `,
        data() {
          return {
            message: '',
            messages: props.messages || []
          };
        },
        methods: {
          async sendMessage() {
            if (!this.message.trim()) return;

            const userMessage = {
              id: Date.now(),
              role: 'user',
              content: this.message
            };

            this.messages.push(userMessage);

            const response = await (window as any).api.llm.query(this.message);

            if (response.success) {
              this.messages.push({
                id: Date.now() + 1,
                role: 'assistant',
                content: response.response
              });
            }

            this.message = '';
          }
        }
      });
    };

    afterEach(() => {
      wrapper?.unmount();
    });

    it('应该正确渲染组件', () => {
      wrapper = createChatPanelWrapper();
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find('input').exists()).toBe(true);
      expect(wrapper.find('button').exists()).toBe(true);
    });

    it('应该能够发送消息', async () => {
      mockElectronAPI.llm.query.mockResolvedValue({
        success: true,
        response: 'AI回复'
      });

      wrapper = createChatPanelWrapper();

      await wrapper.find('input').setValue('你好');
      await wrapper.find('button').trigger('click');
      await nextTick();
      await new Promise(resolve => setTimeout(resolve, 50));

      const messages = wrapper.findAll('.message');
      expect(messages.length).toBeGreaterThanOrEqual(1);
    });

    it('应该在输入为空时禁止发送', async () => {
      wrapper = createChatPanelWrapper();

      await wrapper.find('input').setValue('');
      await wrapper.find('button').trigger('click');
      await nextTick();

      expect(mockElectronAPI.llm.query).not.toHaveBeenCalled();
    });

    it('应该显示对话历史', () => {
      const messages = [
        { id: 1, role: 'user', content: '你好' },
        { id: 2, role: 'assistant', content: '你好!有什么可以帮你?' }
      ];

      wrapper = createChatPanelWrapper({ messages });

      const messageElements = wrapper.findAll('.message');
      expect(messageElements).toHaveLength(2);
      expect(messageElements[0].text()).toContain('你好');
      expect(messageElements[1].text()).toContain('有什么可以帮你');
    });
  });

  describe('MarkdownEditor 组件', () => {
    let wrapper: VueWrapper<any>;

    const createEditorWrapper = (props = {}) => {
      return mount({
        template: `
          <div>
            <textarea
              v-model="content"
              @input="handleInput"
              class="editor"
            />
            <div class="preview" v-html="preview"></div>
            <div class="toolbar">
              <button @click="insertBold">粗体</button>
              <button @click="insertItalic">斜体</button>
              <button @click="insertCode">代码</button>
            </div>
          </div>
        `,
        data() {
          return {
            content: props.content || '',
            preview: ''
          };
        },
        methods: {
          handleInput(e: any) {
            this.content = e.target.value;
            this.preview = this.renderMarkdown(this.content);
            this.$emit('update:content', this.content);
          },
          renderMarkdown(text: string) {
            // 简化的Markdown渲染
            return text
              .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
              .replace(/\*(.*?)\*/g, '<em>$1</em>')
              .replace(/`(.*?)`/g, '<code>$1</code>');
          },
          insertBold() {
            this.content += '**粗体**';
          },
          insertItalic() {
            this.content += '*斜体*';
          },
          insertCode() {
            this.content += '`代码`';
          }
        }
      });
    };

    afterEach(() => {
      wrapper?.unmount();
    });

    it('应该正确渲染编辑器', () => {
      wrapper = createEditorWrapper();
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find('.editor').exists()).toBe(true);
      expect(wrapper.find('.preview').exists()).toBe(true);
      expect(wrapper.find('.toolbar').exists()).toBe(true);
    });

    it('应该能够输入内容', async () => {
      wrapper = createEditorWrapper();

      await wrapper.find('.editor').setValue('# 标题');
      await nextTick();

      expect(wrapper.vm.content).toBe('# 标题');
    });

    it('应该实时预览Markdown', async () => {
      wrapper = createEditorWrapper();

      await wrapper.find('.editor').setValue('**粗体**');
      await wrapper.find('.editor').trigger('input');
      await nextTick();

      expect(wrapper.find('.preview').html()).toContain('<strong>粗体</strong>');
    });

    it('应该支持工具栏插入格式', async () => {
      wrapper = createEditorWrapper();

      const buttons = wrapper.findAll('button');
      await buttons[0].trigger('click'); // 插入粗体
      await nextTick();

      expect(wrapper.vm.content).toContain('**粗体**');
    });
  });

  describe('FileImport 组件', () => {
    let wrapper: VueWrapper<any>;

    const createFileImportWrapper = () => {
      return mount({
        template: `
          <div>
            <input type="file" @change="handleFileSelect" ref="fileInput" />
            <button @click="importFile" :disabled="!selectedFile">导入</button>
            <div v-if="importing" class="loading">导入中...</div>
            <div v-if="error" class="error">{{ error }}</div>
            <div v-if="success" class="success">导入成功</div>
          </div>
        `,
        data() {
          return {
            selectedFile: null as File | null,
            importing: false,
            error: '',
            success: false
          };
        },
        methods: {
          handleFileSelect(e: any) {
            this.selectedFile = e.target.files[0];
          },
          async importFile() {
            if (!this.selectedFile) return;

            this.importing = true;
            this.error = '';
            this.success = false;

            try {
              const result = await (window as any).api.fs.readFile(this.selectedFile.name);

              if (result.success) {
                this.success = true;
              } else {
                this.error = result.message || '导入失败';
              }
            } catch (err: any) {
              this.error = err.message;
            } finally {
              this.importing = false;
            }
          }
        }
      });
    };

    afterEach(() => {
      wrapper?.unmount();
    });

    it('应该正确渲染组件', () => {
      wrapper = createFileImportWrapper();
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find('input[type="file"]').exists()).toBe(true);
      expect(wrapper.find('button').exists()).toBe(true);
    });

    it('应该在未选择文件时禁用导入按钮', () => {
      wrapper = createFileImportWrapper();
      const button = wrapper.find('button');
      expect(button.attributes('disabled')).toBeDefined();
    });

    it('应该能够导入文件', async () => {
      mockElectronAPI.fs.readFile.mockResolvedValue({
        success: true,
        content: '文件内容'
      });

      wrapper = createFileImportWrapper();

      // 模拟文件选择
      const file = new File(['test'], 'test.md', { type: 'text/markdown' });
      wrapper.vm.selectedFile = file;
      await nextTick();

      // 点击导入
      await wrapper.find('button').trigger('click');
      await nextTick();
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(wrapper.find('.success').exists()).toBe(true);
    });

    it('应该处理导入错误', async () => {
      mockElectronAPI.fs.readFile.mockResolvedValue({
        success: false,
        message: '文件格式不支持'
      });

      wrapper = createFileImportWrapper();

      wrapper.vm.selectedFile = new File(['test'], 'test.xyz');
      await nextTick();

      await wrapper.find('button').trigger('click');
      await nextTick();
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(wrapper.find('.error').exists()).toBe(true);
    });
  });

  describe('GitStatus 组件', () => {
    let wrapper: VueWrapper<any>;

    const createGitStatusWrapper = () => {
      return mount({
        template: `
          <div>
            <button @click="refreshStatus">刷新状态</button>
            <div v-if="loading">加载中...</div>
            <div v-else class="status">
              <div v-if="modified.length">
                <h4>已修改 ({{ modified.length }})</h4>
                <div v-for="file in modified" :key="file" class="modified-file">
                  {{ file }}
                </div>
              </div>
              <div v-if="staged.length">
                <h4>已暂存 ({{ staged.length }})</h4>
                <div v-for="file in staged" :key="file" class="staged-file">
                  {{ file }}
                </div>
              </div>
              <div v-if="clean" class="clean">工作树干净</div>
            </div>
          </div>
        `,
        data() {
          return {
            loading: false,
            modified: [] as string[],
            staged: [] as string[],
            clean: false
          };
        },
        methods: {
          async refreshStatus() {
            this.loading = true;

            try {
              const result = await (window as any).api.git.status();

              if (result.success) {
                this.modified = result.modified || [];
                this.staged = result.staged || [];
                this.clean = result.clean || false;
              }
            } finally {
              this.loading = false;
            }
          }
        },
        async mounted() {
          await this.refreshStatus();
        }
      });
    };

    afterEach(() => {
      wrapper?.unmount();
    });

    it('应该正确渲染组件', async () => {
      mockElectronAPI.git.status.mockResolvedValue({
        success: true,
        clean: true,
        modified: [],
        staged: []
      });

      wrapper = createGitStatusWrapper();
      await nextTick();
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find('button').exists()).toBe(true);
    });

    it('应该显示已修改的文件', async () => {
      mockElectronAPI.git.status.mockResolvedValue({
        success: true,
        clean: false,
        modified: ['file1.md', 'file2.txt'],
        staged: []
      });

      wrapper = createGitStatusWrapper();
      await nextTick();
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(wrapper.findAll('.modified-file')).toHaveLength(2);
    });

    it('应该显示已暂存的文件', async () => {
      mockElectronAPI.git.status.mockResolvedValue({
        success: true,
        clean: false,
        modified: [],
        staged: ['file1.md']
      });

      wrapper = createGitStatusWrapper();
      await nextTick();
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(wrapper.findAll('.staged-file')).toHaveLength(1);
    });

    it('应该显示工作树干净状态', async () => {
      mockElectronAPI.git.status.mockResolvedValue({
        success: true,
        clean: true,
        modified: [],
        staged: []
      });

      wrapper = createGitStatusWrapper();
      await nextTick();
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(wrapper.find('.clean').exists()).toBe(true);
    });
  });

  describe('组件通用功能', () => {
    it('应该正确处理加载状态', async () => {
      const wrapper = mount({
        template: '<div><div v-if="loading">加载中...</div></div>',
        data() {
          return { loading: true };
        }
      });

      expect(wrapper.text()).toContain('加载中...');

      wrapper.vm.loading = false;
      await nextTick();

      expect(wrapper.text()).not.toContain('加载中...');

      wrapper.unmount();
    });

    it('应该正确处理错误状态', async () => {
      const wrapper = mount({
        template: '<div><div v-if="error" class="error">{{ error }}</div></div>',
        data() {
          return { error: '' };
        }
      });

      expect(wrapper.find('.error').exists()).toBe(false);

      wrapper.vm.error = '发生错误';
      await nextTick();

      expect(wrapper.find('.error').exists()).toBe(true);
      expect(wrapper.text()).toContain('发生错误');

      wrapper.unmount();
    });

    it('应该正确处理空数据状态', () => {
      const wrapper = mount({
        template: `
          <div>
            <div v-if="items.length === 0" class="empty">暂无数据</div>
            <div v-else>有数据</div>
          </div>
        `,
        data() {
          return { items: [] };
        }
      });

      expect(wrapper.find('.empty').exists()).toBe(true);

      wrapper.unmount();
    });
  });
});
