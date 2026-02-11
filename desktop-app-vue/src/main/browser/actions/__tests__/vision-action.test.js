/**
 * VisionAction 单元测试
 */

import { vi } from 'vitest';

const { VisionAction, VisionModel, VisionTaskType } = require('../vision-action');

describe('VisionAction', () => {
  let mockEngine;
  let mockPage;
  let mockLLMService;
  let visionAction;

  beforeEach(() => {
    mockPage = {
      screenshot: vi.fn().mockResolvedValue(Buffer.from('fake-image')),
      viewportSize: vi.fn().mockReturnValue({ width: 1280, height: 720 }),
      mouse: {
        click: vi.fn().mockResolvedValue(undefined)
      },
      keyboard: {
        type: vi.fn().mockResolvedValue(undefined)
      },
      waitForLoadState: vi.fn().mockResolvedValue(undefined)
    };

    mockEngine = {
      getPage: vi.fn().mockReturnValue(mockPage)
    };

    mockLLMService = {
      chat: vi.fn().mockResolvedValue({
        text: JSON.stringify({
          found: true,
          confidence: 0.95,
          element: { x: 100, y: 200, width: 50, height: 30, description: 'Test button' }
        })
      })
    };

    visionAction = new VisionAction(mockEngine, mockLLMService);
  });

  describe('constructor', () => {
    it('should initialize with default config', () => {
      expect(visionAction.config.defaultModel).toBe(VisionModel.CLAUDE_VISION);
      expect(visionAction.config.maxTokens).toBe(4096);
    });

    it('should work without LLM service', () => {
      const action = new VisionAction(mockEngine, null);
      expect(action.llmService).toBeNull();
    });
  });

  describe('setLLMService', () => {
    it('should update LLM service', () => {
      const newService = { chat: vi.fn() };
      visionAction.setLLMService(newService);
      expect(visionAction.llmService).toBe(newService);
    });
  });

  describe('analyze', () => {
    it('should analyze page screenshot', async () => {
      mockLLMService.chat.mockResolvedValue({
        text: 'This is a login page with username and password fields.'
      });

      const result = await visionAction.analyze('tab-1', 'What is this page?');

      expect(mockPage.screenshot).toHaveBeenCalled();
      expect(mockLLMService.chat).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.analysis).toContain('login page');
    });

    it('should use cache for repeated queries', async () => {
      mockLLMService.chat.mockResolvedValue({ text: 'Analysis result' });

      await visionAction.analyze('tab-1', 'Test query');
      await visionAction.analyze('tab-1', 'Test query');

      // Should only call LLM once due to caching
      expect(mockLLMService.chat).toHaveBeenCalledTimes(1);
    });

    it('should throw without LLM service', async () => {
      visionAction.llmService = null;

      await expect(
        visionAction.analyze('tab-1', 'What is this?')
      ).rejects.toThrow('LLM Service not configured');
    });
  });

  describe('locateElement', () => {
    it('should locate element by description', async () => {
      const result = await visionAction.locateElement('tab-1', 'red login button');

      expect(mockLLMService.chat).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.found).toBe(true);
      expect(result.confidence).toBe(0.95);
      expect(result.element.x).toBe(100);
      expect(result.element.y).toBe(200);
    });

    it('should handle element not found', async () => {
      mockLLMService.chat.mockResolvedValue({
        text: JSON.stringify({ found: false, confidence: 0 })
      });

      const result = await visionAction.locateElement('tab-1', 'nonexistent element');

      expect(result.success).toBe(false);
      expect(result.found).toBe(false);
    });

    it('should handle invalid JSON response', async () => {
      mockLLMService.chat.mockResolvedValue({ text: 'Invalid response' });

      const result = await visionAction.locateElement('tab-1', 'test element');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to parse');
    });
  });

  describe('visualClick', () => {
    it('should locate and click element', async () => {
      const result = await visionAction.visualClick('tab-1', 'submit button');

      expect(mockLLMService.chat).toHaveBeenCalled();
      expect(mockPage.mouse.click).toHaveBeenCalledWith(
        125, // x + width/2
        215, // y + height/2
        expect.any(Object)
      );
      expect(result.success).toBe(true);
      expect(result.clickedAt).toBeDefined();
    });

    it('should fail when element not found', async () => {
      mockLLMService.chat.mockResolvedValue({
        text: JSON.stringify({ found: false })
      });

      const result = await visionAction.visualClick('tab-1', 'nonexistent');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Could not locate');
    });
  });

  describe('describePage', () => {
    it('should describe page content', async () => {
      mockLLMService.chat.mockResolvedValue({
        text: 'This page contains a form with multiple input fields.'
      });

      const result = await visionAction.describePage('tab-1');

      expect(result.success).toBe(true);
      expect(result.analysis).toContain('form');
    });
  });

  describe('compareWithBaseline', () => {
    it('should compare screenshots', async () => {
      mockLLMService.chat.mockResolvedValue({
        text: JSON.stringify({
          similarity: 95,
          hasChanges: true,
          changes: [{ type: 'ui', description: 'Button color changed' }],
          summary: 'Minor UI changes detected'
        })
      });

      const baselineBase64 = Buffer.from('baseline').toString('base64');
      const result = await visionAction.compareWithBaseline('tab-1', baselineBase64);

      expect(result.success).toBe(true);
      expect(result.similarity).toBe(95);
      expect(result.hasChanges).toBe(true);
    });
  });

  describe('executeVisualTask', () => {
    it('should execute multi-step visual task', async () => {
      // First call: analyze and decide action
      mockLLMService.chat
        .mockResolvedValueOnce({
          text: JSON.stringify({
            completed: false,
            action: 'click',
            target: 'search box'
          })
        })
        // Second call: locate element
        .mockResolvedValueOnce({
          text: JSON.stringify({
            found: true,
            confidence: 0.9,
            element: { x: 100, y: 100, width: 200, height: 30 }
          })
        })
        // Third call: task completed
        .mockResolvedValueOnce({
          text: JSON.stringify({
            completed: true,
            action: 'done'
          })
        });

      const result = await visionAction.executeVisualTask(
        'tab-1',
        'Click the search box',
        { maxSteps: 5 }
      );

      expect(result.success).toBe(true);
      expect(result.steps.length).toBeGreaterThan(0);
    });
  });

  describe('clearCache', () => {
    it('should clear analysis cache', async () => {
      mockLLMService.chat.mockResolvedValue({ text: 'Result' });

      await visionAction.analyze('tab-1', 'Query');
      expect(visionAction.analysisCache.size).toBe(1);

      visionAction.clearCache();
      expect(visionAction.analysisCache.size).toBe(0);
    });
  });

  describe('execute', () => {
    it('should route to analyze', async () => {
      mockLLMService.chat.mockResolvedValue({ text: 'Analysis' });

      const result = await visionAction.execute('tab-1', {
        task: VisionTaskType.ANALYZE,
        prompt: 'What is this?'
      });

      expect(result.success).toBe(true);
    });

    it('should route to locate', async () => {
      const result = await visionAction.execute('tab-1', {
        task: VisionTaskType.LOCATE_ELEMENT,
        description: 'button'
      });

      expect(result.success).toBe(true);
    });

    it('should route to visual click', async () => {
      const result = await visionAction.execute('tab-1', {
        task: VisionTaskType.FIND_CLICK_TARGET,
        description: 'submit'
      });

      expect(result.success).toBe(true);
    });
  });

  describe('_buildVisionMessage', () => {
    it('should build Claude format message', () => {
      const message = visionAction._buildVisionMessage(
        'Describe this',
        'base64data',
        { model: 'claude-3-opus-20240229' }
      );

      expect(message.role).toBe('user');
      expect(message.content).toBeInstanceOf(Array);
      expect(message.content[0].type).toBe('image');
    });

    it('should build OpenAI format message', () => {
      const message = visionAction._buildVisionMessage(
        'Describe this',
        'base64data',
        { model: 'gpt-4-vision-preview' }
      );

      expect(message.content[0].type).toBe('image_url');
    });
  });
});
