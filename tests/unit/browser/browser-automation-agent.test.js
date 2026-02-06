/**
 * BrowserAutomationAgent 单元测试
 *
 * @author ChainlessChain Team
 * @since v0.27.0 Phase 3
 */

const { describe, it, expect, beforeEach, vi } = require('vitest');
const { BrowserAutomationAgent } = require('../../../desktop-app-vue/src/main/browser/browser-automation-agent');

describe('BrowserAutomationAgent', () => {
  let agent;
  let mockLLMService;
  let mockBrowserEngine;

  beforeEach(() => {
    // Mock LLM Service
    mockLLMService = {
      chat: vi.fn()
    };

    // Mock Browser Engine
    mockBrowserEngine = {
      takeSnapshot: vi.fn(),
      navigate: vi.fn(),
      act: vi.fn(),
      screenshot: vi.fn(),
      getPage: vi.fn()
    };

    agent = new BrowserAutomationAgent(mockLLMService, mockBrowserEngine);
  });

  describe('parseCommand', () => {
    it('should parse simple navigation command', async () => {
      const mockResponse = {
        content: JSON.stringify({
          steps: [
            {
              action: 'navigate',
              url: 'https://www.google.com',
              description: '打开 Google',
              critical: true
            }
          ]
        })
      };

      mockLLMService.chat.mockResolvedValue(mockResponse);

      const steps = await agent.parseCommand('打开 Google');

      expect(steps).toHaveLength(1);
      expect(steps[0].action).toBe('navigate');
      expect(steps[0].url).toBe('https://www.google.com');
      expect(mockLLMService.chat).toHaveBeenCalledOnce();
    });

    it('should parse search command with snapshot', async () => {
      const mockSnapshot = {
        url: 'https://www.google.com',
        title: 'Google',
        elementsCount: 10,
        elements: [
          { ref: 'e1', role: 'textbox', label: '搜索', tag: 'input' },
          { ref: 'e2', role: 'button', label: '搜索', tag: 'button' }
        ]
      };

      const mockResponse = {
        content: JSON.stringify({
          steps: [
            {
              action: 'type',
              ref: 'e1',
              text: 'ChainlessChain',
              description: '在搜索框输入文本',
              critical: true
            },
            {
              action: 'click',
              ref: 'e2',
              description: '点击搜索按钮',
              critical: true
            }
          ]
        })
      };

      mockLLMService.chat.mockResolvedValue(mockResponse);

      const steps = await agent.parseCommand('搜索 ChainlessChain', mockSnapshot);

      expect(steps).toHaveLength(2);
      expect(steps[0].action).toBe('type');
      expect(steps[0].ref).toBe('e1');
      expect(steps[1].action).toBe('click');
      expect(steps[1].ref).toBe('e2');
    });

    it('should handle LLM errors', async () => {
      mockLLMService.chat.mockRejectedValue(new Error('LLM service unavailable'));

      await expect(agent.parseCommand('打开 Google')).rejects.toThrow('Failed to parse command');
    });

    it('should handle invalid JSON response', async () => {
      mockLLMService.chat.mockResolvedValue({ content: 'invalid json' });

      await expect(agent.parseCommand('打开 Google')).rejects.toThrow('Failed to parse command');
    });

    it('should validate response format', async () => {
      const mockResponse = {
        content: JSON.stringify({
          // Missing 'steps' array
          result: 'ok'
        })
      };

      mockLLMService.chat.mockResolvedValue(mockResponse);

      await expect(agent.parseCommand('打开 Google')).rejects.toThrow(
        'Invalid response format: missing steps array'
      );
    });
  });

  describe('executeSteps', () => {
    it('should execute all steps successfully', async () => {
      const steps = [
        { action: 'navigate', url: 'https://example.com', description: '打开网站' },
        { action: 'snapshot', options: {}, description: '获取快照' }
      ];

      mockBrowserEngine.navigate.mockResolvedValue({ success: true });
      mockBrowserEngine.takeSnapshot.mockResolvedValue({ elementsCount: 5 });

      const results = await agent.executeSteps('target-1', steps);

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(true);
      expect(mockBrowserEngine.navigate).toHaveBeenCalledWith('target-1', 'https://example.com', undefined);
      expect(mockBrowserEngine.takeSnapshot).toHaveBeenCalledWith('target-1', {});
    });

    it('should retry failed steps', async () => {
      const steps = [
        { action: 'click', ref: 'e1', description: '点击按钮' }
      ];

      mockBrowserEngine.act
        .mockRejectedValueOnce(new Error('Element not found'))
        .mockResolvedValueOnce({ clicked: true });

      mockBrowserEngine.takeSnapshot.mockResolvedValue({ elementsCount: 5 });

      const results = await agent.executeSteps('target-1', steps, { maxRetries: 2 });

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
      expect(results[0].attempts).toBe(2);
      expect(mockBrowserEngine.act).toHaveBeenCalledTimes(2);
    });

    it('should stop on critical step failure', async () => {
      const steps = [
        { action: 'click', ref: 'e1', description: '点击按钮', critical: true },
        { action: 'type', ref: 'e2', text: 'test', description: '输入文本' }
      ];

      mockBrowserEngine.act.mockRejectedValue(new Error('Element not found'));

      await expect(
        agent.executeSteps('target-1', steps, { maxRetries: 0 })
      ).rejects.toThrow('Critical step failed');

      expect(mockBrowserEngine.act).toHaveBeenCalledOnce();
    });

    it('should continue on non-critical step failure', async () => {
      const steps = [
        { action: 'click', ref: 'e1', description: '点击按钮', critical: false },
        { action: 'type', ref: 'e2', text: 'test', description: '输入文本' }
      ];

      mockBrowserEngine.act
        .mockRejectedValueOnce(new Error('Element not found'))
        .mockResolvedValueOnce({ typed: true });

      const results = await agent.executeSteps('target-1', steps, { maxRetries: 0 });

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(false);
      expect(results[1].success).toBe(true);
    });

    it('should call onProgress callback', async () => {
      const steps = [
        { action: 'navigate', url: 'https://example.com', description: '打开网站' }
      ];

      mockBrowserEngine.navigate.mockResolvedValue({ success: true });

      const onProgress = vi.fn();
      await agent.executeSteps('target-1', steps, { onProgress });

      expect(onProgress).toHaveBeenCalledWith(steps[0], 0);
    });
  });

  describe('execute', () => {
    it('should execute complete command with auto snapshot', async () => {
      const mockSnapshot = {
        url: 'https://www.google.com',
        title: 'Google',
        elementsCount: 10,
        elements: []
      };

      const mockResponse = {
        content: JSON.stringify({
          steps: [
            { action: 'type', ref: 'e1', text: 'test', description: '输入文本' }
          ]
        })
      };

      mockBrowserEngine.takeSnapshot.mockResolvedValue(mockSnapshot);
      mockLLMService.chat.mockResolvedValue(mockResponse);
      mockBrowserEngine.act.mockResolvedValue({ typed: true });

      const result = await agent.execute('target-1', '搜索 test', {
        autoSnapshot: true,
        maxRetries: 2
      });

      expect(result.success).toBe(true);
      expect(result.steps).toHaveLength(1);
      expect(result.results).toHaveLength(1);
      expect(mockBrowserEngine.takeSnapshot).toHaveBeenCalledWith('target-1', {
        interactive: true,
        visible: true,
        roleRefs: true
      });
    });

    it('should skip auto snapshot when disabled', async () => {
      const mockResponse = {
        content: JSON.stringify({
          steps: [
            { action: 'navigate', url: 'https://example.com', description: '打开网站' }
          ]
        })
      };

      mockLLMService.chat.mockResolvedValue(mockResponse);
      mockBrowserEngine.navigate.mockResolvedValue({ success: true });

      await agent.execute('target-1', '打开网站', { autoSnapshot: false });

      expect(mockBrowserEngine.takeSnapshot).not.toHaveBeenCalled();
    });

    it('should emit events during execution', async () => {
      const mockResponse = {
        content: JSON.stringify({
          steps: [{ action: 'navigate', url: 'https://example.com', description: '打开网站' }]
        })
      };

      mockLLMService.chat.mockResolvedValue(mockResponse);
      mockBrowserEngine.navigate.mockResolvedValue({ success: true });

      const events = [];
      agent.on('execution:started', (data) => events.push({ type: 'started', data }));
      agent.on('steps:generated', (data) => events.push({ type: 'generated', data }));
      agent.on('execution:completed', (data) => events.push({ type: 'completed', data }));

      await agent.execute('target-1', '打开网站', { autoSnapshot: false });

      expect(events).toHaveLength(3);
      expect(events[0].type).toBe('started');
      expect(events[1].type).toBe('generated');
      expect(events[2].type).toBe('completed');
    });

    it('should record execution history', async () => {
      const mockResponse = {
        content: JSON.stringify({
          steps: [{ action: 'navigate', url: 'https://example.com', description: '打开网站' }]
        })
      };

      mockLLMService.chat.mockResolvedValue(mockResponse);
      mockBrowserEngine.navigate.mockResolvedValue({ success: true });

      await agent.execute('target-1', '打开网站', { autoSnapshot: false });

      const history = agent.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0].prompt).toBe('打开网站');
      expect(history[0].success).toBe(true);
    });

    it('should handle execution failure', async () => {
      mockLLMService.chat.mockRejectedValue(new Error('LLM error'));

      const onFailed = vi.fn();
      agent.on('execution:failed', onFailed);

      await expect(agent.execute('target-1', '打开网站')).rejects.toThrow('Failed to execute AI command');

      expect(onFailed).toHaveBeenCalled();
      const history = agent.getHistory();
      expect(history[0].success).toBe(false);
    });
  });

  describe('history management', () => {
    it('should get limited history', async () => {
      const mockResponse = {
        content: JSON.stringify({
          steps: [{ action: 'navigate', url: 'https://example.com', description: '打开网站' }]
        })
      };

      mockLLMService.chat.mockResolvedValue(mockResponse);
      mockBrowserEngine.navigate.mockResolvedValue({ success: true });

      // Execute 15 commands
      for (let i = 0; i < 15; i++) {
        await agent.execute('target-1', `命令 ${i}`, { autoSnapshot: false });
      }

      const history = agent.getHistory(10);
      expect(history).toHaveLength(10);
      expect(history[0].prompt).toBe('命令 5'); // Last 10 items
    });

    it('should clear history', async () => {
      const mockResponse = {
        content: JSON.stringify({
          steps: [{ action: 'navigate', url: 'https://example.com', description: '打开网站' }]
        })
      };

      mockLLMService.chat.mockResolvedValue(mockResponse);
      mockBrowserEngine.navigate.mockResolvedValue({ success: true });

      await agent.execute('target-1', '打开网站', { autoSnapshot: false });

      let history = agent.getHistory();
      expect(history).toHaveLength(1);

      agent.clearHistory();

      history = agent.getHistory();
      expect(history).toHaveLength(0);
    });
  });

  describe('_executeStep', () => {
    it('should execute navigate action', async () => {
      mockBrowserEngine.navigate.mockResolvedValue({ success: true });

      const result = await agent._executeStep('target-1', {
        action: 'navigate',
        url: 'https://example.com'
      });

      expect(result.success).toBe(true);
      expect(mockBrowserEngine.navigate).toHaveBeenCalledWith('target-1', 'https://example.com', undefined);
    });

    it('should execute click action', async () => {
      mockBrowserEngine.act.mockResolvedValue({ clicked: true });

      const result = await agent._executeStep('target-1', {
        action: 'click',
        ref: 'e1'
      });

      expect(result.clicked).toBe(true);
      expect(mockBrowserEngine.act).toHaveBeenCalledWith('target-1', 'click', 'e1', undefined);
    });

    it('should execute type action', async () => {
      mockBrowserEngine.act.mockResolvedValue({ typed: true });

      const result = await agent._executeStep('target-1', {
        action: 'type',
        ref: 'e1',
        text: 'hello'
      });

      expect(result.typed).toBe(true);
      expect(mockBrowserEngine.act).toHaveBeenCalledWith('target-1', 'type', 'e1', {
        text: 'hello'
      });
    });

    it('should execute wait action', async () => {
      const mockPage = {
        waitForLoadState: vi.fn().mockResolvedValue(undefined)
      };

      mockBrowserEngine.getPage.mockReturnValue(mockPage);

      const result = await agent._executeStep('target-1', {
        action: 'wait',
        state: 'networkidle'
      });

      expect(result.waited).toBe(true);
      expect(mockPage.waitForLoadState).toHaveBeenCalledWith('networkidle', { timeout: 30000 });
    });

    it('should throw error for unknown action', async () => {
      await expect(
        agent._executeStep('target-1', { action: 'unknown' })
      ).rejects.toThrow('Unknown action: unknown');
    });
  });

  describe('prompt building', () => {
    it('should build system prompt without snapshot', () => {
      const systemPrompt = agent._buildSystemPrompt(null);

      expect(systemPrompt).toContain('你是一个浏览器自动化 AI 助手');
      expect(systemPrompt).toContain('navigate');
      expect(systemPrompt).toContain('click');
      expect(systemPrompt).not.toContain('当前页面元素');
    });

    it('should build system prompt with snapshot', () => {
      const mockSnapshot = {
        elements: [
          { ref: 'e1', role: 'textbox', label: '搜索', tag: 'input' },
          { ref: 'e2', role: 'button', label: '搜索', tag: 'button' }
        ],
        elementsCount: 2
      };

      const systemPrompt = agent._buildSystemPrompt(mockSnapshot);

      expect(systemPrompt).toContain('当前页面元素');
      expect(systemPrompt).toContain('e1: textbox "搜索" (tag: input)');
      expect(systemPrompt).toContain('e2: button "搜索" (tag: button)');
    });

    it('should truncate large element lists', () => {
      const mockSnapshot = {
        elements: Array.from({ length: 100 }, (_, i) => ({
          ref: `e${i + 1}`,
          role: 'button',
          label: `Button ${i + 1}`,
          tag: 'button'
        })),
        elementsCount: 100
      };

      const systemPrompt = agent._buildSystemPrompt(mockSnapshot);

      expect(systemPrompt).toContain('还有 50 个元素');
    });

    it('should build user prompt with snapshot', () => {
      const mockSnapshot = {
        url: 'https://www.google.com',
        title: 'Google',
        elementsCount: 10
      };

      const userPrompt = agent._buildUserPrompt('搜索 test', mockSnapshot);

      expect(userPrompt).toContain('用户指令：搜索 test');
      expect(userPrompt).toContain('URL: https://www.google.com');
      expect(userPrompt).toContain('标题: Google');
      expect(userPrompt).toContain('元素数量: 10');
    });

    it('should build user prompt without snapshot', () => {
      const userPrompt = agent._buildUserPrompt('打开网站', null);

      expect(userPrompt).toContain('用户指令：打开网站');
      expect(userPrompt).toContain('当前没有页面快照');
      expect(userPrompt).toContain('请先包含 snapshot 步骤');
    });
  });
});
