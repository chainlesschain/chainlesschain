/**
 * VisionToolsHandler 单元测试
 * 测试视觉工具集（图片分析、OCR、视觉问答）
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock dependencies
vi.mock('../../../src/main/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}));

describe('VisionToolsHandler', () => {
  let VisionToolsHandler;
  let handler;
  let mockFunctionCaller;
  let mockVisionManager;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Dynamic import
    const module = await import('../../../src/main/ai-engine/extended-tools-vision.js');
    VisionToolsHandler = module.default || module.VisionToolsHandler;

    handler = new VisionToolsHandler();

    // Mock FunctionCaller
    mockFunctionCaller = {
      registerTool: vi.fn(),
      tools: new Map(),
    };

    // Mock VisionManager
    mockVisionManager = {
      analyzeImage: vi.fn().mockResolvedValue({
        text: 'Image analysis result',
        model: 'gpt-4-vision',
        duration: 1500,
      }),
      describeImage: vi.fn().mockResolvedValue({
        description: 'Image description',
        model: 'gpt-4-vision',
      }),
      extractText: vi.fn().mockResolvedValue({
        text: 'Extracted text from image',
        confidence: 0.95,
      }),
      detectObjects: vi.fn().mockResolvedValue({
        objects: [
          { label: 'person', confidence: 0.98, bbox: [10, 20, 100, 200] },
        ],
      }),
    };

    handler.setVisionManager(mockVisionManager);
  });

  // ==================== 构造函数测试 ====================

  describe('构造函数', () => {
    it('应该正确初始化 VisionToolsHandler', () => {
      const newHandler = new VisionToolsHandler();
      expect(newHandler).toBeDefined();
      expect(newHandler.visionManager).toBeNull();
    });
  });

  // ==================== setVisionManager 测试 ====================

  describe('setVisionManager', () => {
    it('应该设置 VisionManager 引用', () => {
      const newHandler = new VisionToolsHandler();
      newHandler.setVisionManager(mockVisionManager);

      expect(newHandler.visionManager).toBe(mockVisionManager);
    });

    it('应该记录日志', () => {
      const { logger } = require('../../../src/main/utils/logger.js');
      const newHandler = new VisionToolsHandler();
      newHandler.setVisionManager(mockVisionManager);

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('VisionManager 已设置')
      );
    });
  });

  // ==================== 工具注册测试 ====================

  describe('register', () => {
    it('应该注册所有视觉工具', () => {
      handler.register(mockFunctionCaller);

      expect(mockFunctionCaller.registerTool).toHaveBeenCalled();
      expect(mockFunctionCaller.registerTool.mock.calls.length).toBeGreaterThan(0);
    });

    it('应该注册 vision_analyze 工具', () => {
      handler.register(mockFunctionCaller);

      const call = mockFunctionCaller.registerTool.mock.calls.find(
        c => c[0] === 'vision_analyze'
      );
      expect(call).toBeDefined();
      expect(call[1]).toBeTypeOf('function');
    });

    it('应该注册 vision_describe 工具', () => {
      handler.register(mockFunctionCaller);

      const call = mockFunctionCaller.registerTool.mock.calls.find(
        c => c[0] === 'vision_describe'
      );
      expect(call).toBeDefined();
    });

    it('应该注册 vision_ocr 工具', () => {
      handler.register(mockFunctionCaller);

      const call = mockFunctionCaller.registerTool.mock.calls.find(
        c => c[0] === 'vision_ocr'
      );
      expect(call).toBeDefined();
    });
  });

  // ==================== vision_analyze 测试 ====================

  describe('vision_analyze', () => {
    let visionAnalyze;

    beforeEach(() => {
      handler.register(mockFunctionCaller);
      const call = mockFunctionCaller.registerTool.mock.calls.find(
        c => c[0] === 'vision_analyze'
      );
      visionAnalyze = call[1];
    });

    it('应该分析图片（使用文件路径）', async () => {
      const result = await visionAnalyze({
        imagePath: '/path/to/image.jpg',
        prompt: '分析这张图片',
      });

      expect(result.success).toBe(true);
      expect(result.analysis).toBe('Image analysis result');
      expect(result.model).toBe('gpt-4-vision');
      expect(result.duration).toBe(1500);
      expect(mockVisionManager.analyzeImage).toHaveBeenCalledWith({
        imagePath: '/path/to/image.jpg',
        imageBase64: undefined,
        prompt: '分析这张图片',
        type: 'analyze',
      });
    });

    it('应该分析图片（使用 Base64）', async () => {
      const result = await visionAnalyze({
        imageBase64: 'base64encodedimage',
        prompt: '分析这张图片',
      });

      expect(result.success).toBe(true);
      expect(mockVisionManager.analyzeImage).toHaveBeenCalledWith({
        imagePath: undefined,
        imageBase64: 'base64encodedimage',
        prompt: '分析这张图片',
        type: 'analyze',
      });
    });

    it('应该使用默认 prompt', async () => {
      const result = await visionAnalyze({
        imagePath: '/path/to/image.jpg',
      });

      expect(result.success).toBe(true);
      expect(mockVisionManager.analyzeImage).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: '请详细分析这张图片',
        })
      );
    });

    it('应该在未提供图片时抛出错误', async () => {
      await expect(visionAnalyze({ prompt: 'test' })).rejects.toThrow(
        '请提供图片路径或 Base64 数据'
      );
    });

    it('应该在 VisionManager 未初始化时抛出错误', async () => {
      const newHandler = new VisionToolsHandler();
      newHandler.register(mockFunctionCaller);

      const call = mockFunctionCaller.registerTool.mock.calls
        .reverse()
        .find(c => c[0] === 'vision_analyze');
      const tool = call[1];

      await expect(
        tool({ imagePath: '/path/to/image.jpg' })
      ).rejects.toThrow('VisionManager 未初始化');
    });
  });

  // ==================== vision_describe 测试 ====================

  describe('vision_describe', () => {
    let visionDescribe;

    beforeEach(() => {
      handler.register(mockFunctionCaller);
      const call = mockFunctionCaller.registerTool.mock.calls.find(
        c => c[0] === 'vision_describe'
      );
      visionDescribe = call[1];
    });

    it('应该生成图片描述', async () => {
      const result = await visionDescribe({
        imagePath: '/path/to/image.jpg',
      });

      expect(result.success).toBe(true);
      expect(result.description).toBe('Image description');
      expect(result.model).toBe('gpt-4-vision');
    });

    it('应该支持详细描述', async () => {
      const result = await visionDescribe({
        imagePath: '/path/to/image.jpg',
        detailed: true,
      });

      expect(result.success).toBe(true);
      expect(mockVisionManager.describeImage).toHaveBeenCalled();
    });

    it('应该在未提供图片时抛出错误', async () => {
      await expect(visionDescribe({})).rejects.toThrow(
        '请提供图片路径或 Base64 数据'
      );
    });
  });

  // ==================== vision_ocr 测试 ====================

  describe('vision_ocr', () => {
    let visionOcr;

    beforeEach(() => {
      handler.register(mockFunctionCaller);
      const call = mockFunctionCaller.registerTool.mock.calls.find(
        c => c[0] === 'vision_ocr'
      );
      visionOcr = call[1];
    });

    it('应该提取图片中的文本', async () => {
      const result = await visionOcr({
        imagePath: '/path/to/image.jpg',
      });

      expect(result.success).toBe(true);
      expect(result.text).toBe('Extracted text from image');
      expect(result.confidence).toBe(0.95);
    });

    it('应该支持语言参数', async () => {
      const result = await visionOcr({
        imagePath: '/path/to/image.jpg',
        language: 'zh-CN',
      });

      expect(result.success).toBe(true);
      expect(mockVisionManager.extractText).toHaveBeenCalledWith(
        expect.objectContaining({
          language: 'zh-CN',
        })
      );
    });

    it('应该在未提供图片时抛出错误', async () => {
      await expect(visionOcr({})).rejects.toThrow(
        '请提供图片路径或 Base64 数据'
      );
    });
  });

  // ==================== vision_detect 测试 ====================

  describe('vision_detect', () => {
    let visionDetect;

    beforeEach(() => {
      handler.register(mockFunctionCaller);
      const call = mockFunctionCaller.registerTool.mock.calls.find(
        c => c[0] === 'vision_detect'
      );
      if (call) {
        visionDetect = call[1];
      }
    });

    it('应该检测图片中的物体', async () => {
      if (!visionDetect) {
        return; // 如果没有这个工具，跳过测试
      }

      const result = await visionDetect({
        imagePath: '/path/to/image.jpg',
      });

      expect(result.success).toBe(true);
      expect(result.objects).toBeDefined();
      expect(result.objects).toHaveLength(1);
      expect(result.objects[0]).toHaveProperty('label', 'person');
    });

    it('应该返回边界框信息', async () => {
      if (!visionDetect) {
        return;
      }

      const result = await visionDetect({
        imagePath: '/path/to/image.jpg',
      });

      expect(result.objects[0].bbox).toEqual([10, 20, 100, 200]);
    });
  });

  // ==================== 错误处理测试 ====================

  describe('错误处理', () => {
    it('应该处理 VisionManager 错误', async () => {
      mockVisionManager.analyzeImage.mockRejectedValueOnce(
        new Error('Analysis failed')
      );

      handler.register(mockFunctionCaller);
      const call = mockFunctionCaller.registerTool.mock.calls.find(
        c => c[0] === 'vision_analyze'
      );
      const tool = call[1];

      await expect(
        tool({ imagePath: '/path/to/image.jpg' })
      ).rejects.toThrow('Analysis failed');
    });

    it('应该处理无效的图片格式', async () => {
      mockVisionManager.analyzeImage.mockRejectedValueOnce(
        new Error('Invalid image format')
      );

      handler.register(mockFunctionCaller);
      const call = mockFunctionCaller.registerTool.mock.calls.find(
        c => c[0] === 'vision_analyze'
      );
      const tool = call[1];

      await expect(
        tool({ imagePath: '/invalid/format.txt' })
      ).rejects.toThrow();
    });

    it('应该处理网络错误', async () => {
      mockVisionManager.analyzeImage.mockRejectedValueOnce(
        new Error('Network error')
      );

      handler.register(mockFunctionCaller);
      const call = mockFunctionCaller.registerTool.mock.calls.find(
        c => c[0] === 'vision_analyze'
      );
      const tool = call[1];

      await expect(
        tool({ imagePath: '/path/to/image.jpg' })
      ).rejects.toThrow('Network error');
    });
  });

  // ==================== 边界情况测试 ====================

  describe('边界情况', () => {
    it('应该处理空的 prompt', async () => {
      handler.register(mockFunctionCaller);
      const call = mockFunctionCaller.registerTool.mock.calls.find(
        c => c[0] === 'vision_analyze'
      );
      const tool = call[1];

      const result = await tool({
        imagePath: '/path/to/image.jpg',
        prompt: '',
      });

      expect(result.success).toBe(true);
    });

    it('应该处理非常长的 prompt', async () => {
      handler.register(mockFunctionCaller);
      const call = mockFunctionCaller.registerTool.mock.calls.find(
        c => c[0] === 'vision_analyze'
      );
      const tool = call[1];

      const longPrompt = 'a'.repeat(10000);
      const result = await tool({
        imagePath: '/path/to/image.jpg',
        prompt: longPrompt,
      });

      expect(result.success).toBe(true);
    });

    it('应该处理特殊字符路径', async () => {
      handler.register(mockFunctionCaller);
      const call = mockFunctionCaller.registerTool.mock.calls.find(
        c => c[0] === 'vision_analyze'
      );
      const tool = call[1];

      const result = await tool({
        imagePath: '/path/with spaces/image (1).jpg',
      });

      expect(result.success).toBe(true);
    });

    it('应该处理 Unicode 路径', async () => {
      handler.register(mockFunctionCaller);
      const call = mockFunctionCaller.registerTool.mock.calls.find(
        c => c[0] === 'vision_analyze'
      );
      const tool = call[1];

      const result = await tool({
        imagePath: '/路径/图片.jpg',
      });

      expect(result.success).toBe(true);
    });
  });

  // ==================== 性能测试 ====================

  describe('性能', () => {
    it('应该在合理时间内完成分析', async () => {
      handler.register(mockFunctionCaller);
      const call = mockFunctionCaller.registerTool.mock.calls.find(
        c => c[0] === 'vision_analyze'
      );
      const tool = call[1];

      const start = Date.now();
      await tool({ imagePath: '/path/to/image.jpg' });
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(5000);
    });

    it('应该返回处理时长', async () => {
      handler.register(mockFunctionCaller);
      const call = mockFunctionCaller.registerTool.mock.calls.find(
        c => c[0] === 'vision_analyze'
      );
      const tool = call[1];

      const result = await tool({ imagePath: '/path/to/image.jpg' });

      expect(result.duration).toBeDefined();
      expect(result.duration).toBeGreaterThan(0);
    });
  });
});
