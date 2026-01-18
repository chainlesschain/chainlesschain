/**
 * 图片引擎测试
 * 测试 AI文生图、图片处理、批量操作等功能
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies
vi.mock('sharp', () => {
  const mockSharp = vi.fn(() => ({
    metadata: vi.fn().mockResolvedValue({
      format: 'jpeg',
      width: 1920,
      height: 1080,
      channels: 3,
      hasAlpha: false,
      density: 72,
      space: 'srgb',
    }),
    resize: vi.fn().mockReturnThis(),
    extract: vi.fn().mockReturnThis(),
    modulate: vi.fn().mockReturnThis(),
    sharpen: vi.fn().mockReturnThis(),
    threshold: vi.fn().mockReturnThis(),
    toFormat: vi.fn().mockReturnThis(),
    toFile: vi.fn().mockResolvedValue(undefined),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('image data')),
    composite: vi.fn().mockReturnThis(),
    png: vi.fn().mockReturnThis(),
  }));

  mockSharp.kernel = {
    lanczos3: 'lanczos3',
  };

  return { default: mockSharp };
});

vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
    get: vi.fn(),
  },
  post: vi.fn(),
  get: vi.fn(),
}));

vi.mock('fs', () => ({
  default: {
    promises: {
      stat: vi.fn(),
    },
  },
  promises: {
    stat: vi.fn(),
  },
}));

describe('图片引擎测试', () => {
  let ImageEngine, getImageEngine;
  let imageEngine;
  let mockSharp;
  let mockAxios;
  let mockFs;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockSharp = (await import('sharp')).default;
    mockAxios = await import('axios');
    mockFs = await import('fs');

    // Import ImageEngine after mocks
    const module = await import('../../src/main/engines/image-engine.js');
    ImageEngine = module.ImageEngine;
    getImageEngine = module.getImageEngine;

    imageEngine = new ImageEngine();

    // Setup default mock behaviors
    mockFs.promises.stat.mockResolvedValue({ size: 1024 * 1024 });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('基础功能', () => {
    it('should create ImageEngine instance', () => {
      expect(imageEngine).toBeDefined();
      // Check for EventEmitter methods instead of instanceof (avoids ESM/CJS issues)
      expect(typeof imageEngine.emit).toBe('function');
      expect(typeof imageEngine.on).toBe('function');
      expect(typeof imageEngine.removeListener).toBe('function');
    });

    it('should have supported formats', () => {
      expect(imageEngine.supportedFormats).toEqual([
        'jpg', 'jpeg', 'png', 'webp', 'tiff', 'gif', 'svg'
      ]);
    });

    it('should have preset sizes', () => {
      expect(imageEngine.presetSizes.thumbnail).toEqual({ width: 150, height: 150 });
      expect(imageEngine.presetSizes.medium).toEqual({ width: 1024, height: 768 });
      expect(imageEngine.presetSizes.large).toEqual({ width: 1920, height: 1080 });
    });

    it('should have AI service configurations', () => {
      expect(imageEngine.aiImageServices['stable-diffusion']).toBeDefined();
      expect(imageEngine.aiImageServices['dalle']).toBeDefined();
    });

    it('should have all required methods', () => {
      expect(typeof imageEngine.handleProjectTask).toBe('function');
      expect(typeof imageEngine.generateImageFromText).toBe('function');
      expect(typeof imageEngine.resizeImage).toBe('function');
      expect(typeof imageEngine.cropImage).toBe('function');
      expect(typeof imageEngine.enhanceImage).toBe('function');
      expect(typeof imageEngine.upscaleImage).toBe('function');
      expect(typeof imageEngine.addWatermark).toBe('function');
      expect(typeof imageEngine.batchProcess).toBe('function');
      expect(typeof imageEngine.convertFormat).toBe('function');
      expect(typeof imageEngine.createCollage).toBe('function');
      expect(typeof imageEngine.getImageInfo).toBe('function');
    });
  });

  describe('generateImageFromText - AI文生图', () => {
    it('should generate image using Stable Diffusion', async () => {
      const mockImageData = Buffer.from('fake-image-data');

      mockAxios.default.post.mockResolvedValue({
        data: {
          images: [mockImageData.toString('base64')],
        },
      });

      const result = await imageEngine.generateImageFromText(
        'A beautiful sunset',
        '/output.png',
        { service: 'stable-diffusion' }
      );

      expect(mockAxios.default.post).toHaveBeenCalledWith(
        expect.stringContaining('/sdapi/v1/txt2img'),
        expect.objectContaining({
          prompt: 'A beautiful sunset',
        }),
        expect.any(Object)
      );

      expect(result.success).toBe(true);
      expect(result.outputPath).toBe('/output.png');
    });

    it('should generate image using DALL-E', async () => {
      process.env.OPENAI_API_KEY = 'test-key';

      mockAxios.default.post.mockResolvedValue({
        data: {
          data: [{ url: 'https://example.com/image.png' }],
        },
      });

      mockAxios.default.get.mockResolvedValue({
        data: Buffer.from('dalle-image'),
      });

      const result = await imageEngine.generateImageFromText(
        'A cat',
        '/output.png',
        { service: 'dalle' }
      );

      expect(mockAxios.default.post).toHaveBeenCalled();
      expect(mockAxios.default.get).toHaveBeenCalledWith(
        'https://example.com/image.png',
        { responseType: 'arraybuffer' }
      );

      expect(result.success).toBe(true);
    });

    it('should use specified size preset', async () => {
      mockAxios.default.post.mockResolvedValue({
        data: {
          images: [Buffer.from('img').toString('base64')],
        },
      });

      await imageEngine.generateImageFromText(
        'Test',
        '/output.png',
        { service: 'stable-diffusion', size: 'square_sm' }
      );

      expect(mockAxios.default.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          width: 512,
          height: 512,
        }),
        expect.any(Object)
      );
    });

    it('should include negative prompt for Stable Diffusion', async () => {
      mockAxios.default.post.mockResolvedValue({
        data: {
          images: [Buffer.from('img').toString('base64')],
        },
      });

      await imageEngine.generateImageFromText(
        'Beautiful landscape',
        '/output.png',
        {
          service: 'stable-diffusion',
          negativePrompt: 'ugly, distorted',
        }
      );

      expect(mockAxios.default.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          negative_prompt: 'ugly, distorted',
        }),
        expect.any(Object)
      );
    });

    it('should call progress callback', async () => {
      const onProgress = vi.fn();

      mockAxios.default.post.mockResolvedValue({
        data: {
          images: [Buffer.from('img').toString('base64')],
        },
      });

      await imageEngine.generateImageFromText(
        'Test',
        '/output.png',
        { service: 'stable-diffusion' },
        onProgress
      );

      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ percent: 10 })
      );
      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ percent: 100 })
      );
    });

    it('should generate placeholder on SD service failure', async () => {
      mockAxios.default.post.mockRejectedValue(new Error('SD unavailable'));

      const result = await imageEngine.generateImageFromText(
        'Test prompt',
        '/output.png',
        { service: 'stable-diffusion' }
      );

      expect(result.success).toBe(true);
      expect(mockSharp).toHaveBeenCalled();
    });

    it('should throw error for unsupported service', async () => {
      await expect(
        imageEngine.generateImageFromText('Test', '/output.png', {
          service: 'unknown-service',
        })
      ).rejects.toThrow('不支持的AI服务');
    });
  });

  describe('resizeImage', () => {
    it('should resize image to specified dimensions', async () => {
      const result = await imageEngine.resizeImage('/input.jpg', '/output.jpg', {
        width: 800,
        height: 600,
      });

      expect(mockSharp).toHaveBeenCalledWith('/input.jpg');

      const sharpInstance = mockSharp.mock.results[0].value;
      expect(sharpInstance.resize).toHaveBeenCalledWith(800, 600, { fit: 'cover' });
      expect(sharpInstance.toFile).toHaveBeenCalledWith('/output.jpg');

      expect(result.success).toBe(true);
      expect(result.width).toBe(800);
      expect(result.height).toBe(600);
    });

    it('should resize using preset', async () => {
      const result = await imageEngine.resizeImage('/input.jpg', '/output.jpg', {
        preset: 'thumbnail',
      });

      const sharpInstance = mockSharp.mock.results[0].value;
      expect(sharpInstance.resize).toHaveBeenCalledWith(150, 150, { fit: 'cover' });

      expect(result.success).toBe(true);
    });

    it('should support different fit options', async () => {
      await imageEngine.resizeImage('/input.jpg', '/output.jpg', {
        width: 500,
        height: 500,
        fit: 'contain',
      });

      const sharpInstance = mockSharp.mock.results[0].value;
      expect(sharpInstance.resize).toHaveBeenCalledWith(500, 500, { fit: 'contain' });
    });

    it('should handle resize errors', async () => {
      const sharpInstance = mockSharp.mock.results[0].value;
      sharpInstance.resize.mockImplementationOnce(() => {
        throw new Error('Resize failed');
      });

      await expect(
        imageEngine.resizeImage('/input.jpg', '/output.jpg', {
          width: 100,
          height: 100,
        })
      ).rejects.toThrow();
    });
  });

  describe('cropImage', () => {
    it('should crop image', async () => {
      const result = await imageEngine.cropImage('/input.jpg', '/output.jpg', {
        left: 100,
        top: 50,
        width: 400,
        height: 300,
      });

      const sharpInstance = mockSharp.mock.results[0].value;
      expect(sharpInstance.extract).toHaveBeenCalledWith({
        left: 100,
        top: 50,
        width: 400,
        height: 300,
      });

      expect(result.success).toBe(true);
    });

    it('should use default left/top if not provided', async () => {
      await imageEngine.cropImage('/input.jpg', '/output.jpg', {
        width: 200,
        height: 200,
      });

      const sharpInstance = mockSharp.mock.results[0].value;
      expect(sharpInstance.extract).toHaveBeenCalledWith({
        left: 0,
        top: 0,
        width: 200,
        height: 200,
      });
    });
  });

  describe('enhanceImage', () => {
    it('should enhance image with all options', async () => {
      const result = await imageEngine.enhanceImage('/input.jpg', '/output.jpg', {
        brightness: 1.2,
        saturation: 1.1,
        sharpen: true,
      });

      const sharpInstance = mockSharp.mock.results[0].value;
      expect(sharpInstance.modulate).toHaveBeenCalledWith({ brightness: 1.2 });
      expect(sharpInstance.modulate).toHaveBeenCalledWith({ saturation: 1.1 });
      expect(sharpInstance.sharpen).toHaveBeenCalled();

      expect(result.success).toBe(true);
    });

    it('should skip brightness if default value', async () => {
      await imageEngine.enhanceImage('/input.jpg', '/output.jpg', {
        brightness: 1.0,
      });

      const sharpInstance = mockSharp.mock.results[0].value;
      expect(sharpInstance.modulate).not.toHaveBeenCalledWith({ brightness: 1.0 });
    });

    it('should skip sharpen if not requested', async () => {
      await imageEngine.enhanceImage('/input.jpg', '/output.jpg', {
        sharpen: false,
      });

      const sharpInstance = mockSharp.mock.results[0].value;
      expect(sharpInstance.sharpen).not.toHaveBeenCalled();
    });
  });

  describe('upscaleImage', () => {
    it('should upscale image by specified factor', async () => {
      const onProgress = vi.fn();

      const mockMetadata = {
        width: 500,
        height: 400,
      };

      const sharpInstance = mockSharp.mock.results[0].value;
      sharpInstance.metadata.mockResolvedValue(mockMetadata);

      const result = await imageEngine.upscaleImage(
        '/input.jpg',
        '/output.jpg',
        { scale: 2 },
        onProgress
      );

      expect(sharpInstance.resize).toHaveBeenCalledWith(1000, 800, {
        kernel: 'lanczos3',
      });
      expect(sharpInstance.sharpen).toHaveBeenCalled();

      expect(result.success).toBe(true);
      expect(result.scale).toBe(2);
      expect(result.newSize).toEqual({ width: 1000, height: 800 });

      expect(onProgress).toHaveBeenCalled();
    });

    it('should use default scale factor', async () => {
      const mockMetadata = {
        width: 100,
        height: 100,
      };

      const sharpInstance = mockSharp.mock.results[0].value;
      sharpInstance.metadata.mockResolvedValue(mockMetadata);

      const result = await imageEngine.upscaleImage('/input.jpg', '/output.jpg');

      expect(sharpInstance.resize).toHaveBeenCalledWith(200, 200, {
        kernel: 'lanczos3',
      });
    });
  });

  describe('addWatermark', () => {
    it('should add watermark to image', async () => {
      const mockMetadata = {
        width: 1000,
        height: 800,
      };

      const sharpInstance = mockSharp.mock.results[0].value;
      sharpInstance.metadata.mockResolvedValue(mockMetadata);

      const result = await imageEngine.addWatermark('/input.jpg', '/output.jpg', {
        text: 'Copyright 2025',
        position: 'bottom-right',
      });

      expect(sharpInstance.composite).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('should support different watermark positions', async () => {
      const mockMetadata = { width: 1000, height: 800 };

      const sharpInstance = mockSharp.mock.results[0].value;
      sharpInstance.metadata.mockResolvedValue(mockMetadata);

      const positions = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

      for (const position of positions) {
        vi.clearAllMocks();
        await imageEngine.addWatermark('/input.jpg', '/output.jpg', {
          text: 'Test',
          position,
        });

        expect(sharpInstance.composite).toHaveBeenCalled();
      }
    });

    it('should use custom opacity and font size', async () => {
      const mockMetadata = { width: 1000, height: 800 };

      const sharpInstance = mockSharp.mock.results[0].value;
      sharpInstance.metadata.mockResolvedValue(mockMetadata);

      await imageEngine.addWatermark('/input.jpg', '/output.jpg', {
        text: 'Watermark',
        opacity: 0.3,
        fontSize: 32,
      });

      expect(sharpInstance.composite).toHaveBeenCalled();
    });
  });

  describe('batchProcess', () => {
    it('should process multiple images', async () => {
      const imageList = ['/img1.jpg', '/img2.jpg', '/img3.jpg'];
      const onProgress = vi.fn();

      const result = await imageEngine.batchProcess(
        imageList,
        '/output',
        { operation: 'resize', width: 500, height: 500 },
        onProgress
      );

      expect(result.success).toBe(true);
      expect(result.totalCount).toBe(3);
      expect(result.successCount).toBe(3);
      expect(result.errorCount).toBe(0);

      expect(onProgress).toHaveBeenCalled();
    });

    it('should support different operations', async () => {
      const imageList = ['/img.jpg'];

      const operations = ['resize', 'enhance', 'crop', 'convertFormat'];

      for (const operation of operations) {
        const result = await imageEngine.batchProcess(
          imageList,
          '/output',
          { operation, width: 100, height: 100 }
        );

        expect(result.success).toBe(true);
      }
    });

    it('should handle individual image errors', async () => {
      const imageList = ['/img1.jpg', '/img2.jpg'];

      // Make the first image fail
      let callCount = 0;
      mockSharp.mockImplementation((path) => {
        callCount++;
        if (callCount === 1) {
          throw new Error('Failed to process');
        }
        return {
          metadata: vi.fn().mockResolvedValue({ width: 100, height: 100 }),
          resize: vi.fn().mockReturnThis(),
          toFile: vi.fn().mockResolvedValue(undefined),
        };
      });

      const result = await imageEngine.batchProcess(
        imageList,
        '/output',
        { operation: 'resize', width: 100, height: 100 }
      );

      expect(result.successCount).toBe(1);
      expect(result.errorCount).toBe(1);
      expect(result.errors).toHaveLength(1);
    });

    it('should throw error for unsupported operation', async () => {
      const imageList = ['/img.jpg'];

      await expect(
        imageEngine.batchProcess(imageList, '/output', {
          operation: 'unknown-op',
        })
      ).rejects.toThrow();
    });
  });

  describe('convertFormat', () => {
    it('should convert image format', async () => {
      const result = await imageEngine.convertFormat('/input.jpg', '/output.png', {
        format: 'png',
        quality: 95,
      });

      const sharpInstance = mockSharp.mock.results[0].value;
      expect(sharpInstance.toFormat).toHaveBeenCalledWith('png', { quality: 95 });

      expect(result.success).toBe(true);
      expect(result.format).toBe('png');
    });

    it('should use default quality', async () => {
      await imageEngine.convertFormat('/input.jpg', '/output.webp', {
        format: 'webp',
      });

      const sharpInstance = mockSharp.mock.results[0].value;
      expect(sharpInstance.toFormat).toHaveBeenCalledWith('webp', { quality: 90 });
    });
  });

  describe('createCollage', () => {
    it('should create image collage', async () => {
      const imageList = ['/img1.jpg', '/img2.jpg', '/img3.jpg', '/img4.jpg'];

      const result = await imageEngine.createCollage(imageList, '/collage.png', {
        columns: 2,
        spacing: 10,
      });

      expect(mockSharp).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.imageCount).toBe(4);
    });

    it('should handle custom background color', async () => {
      const imageList = ['/img1.jpg', '/img2.jpg'];

      await imageEngine.createCollage(imageList, '/collage.png', {
        columns: 2,
        backgroundColor: '#FF0000',
      });

      expect(mockSharp).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            background: '#FF0000',
          }),
        })
      );
    });

    it('should calculate canvas size correctly', async () => {
      const imageList = ['/img1.jpg', '/img2.jpg', '/img3.jpg'];

      await imageEngine.createCollage(imageList, '/collage.png', {
        columns: 2,
        spacing: 20,
      });

      // 2 columns, 2 rows (3 images)
      // Canvas width = 2 * 300 + 3 * 20 = 660
      // Canvas height = 2 * 300 + 3 * 20 = 660

      expect(mockSharp).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            width: 660,
            height: 660,
          }),
        })
      );
    });
  });

  describe('getImageInfo', () => {
    it('should return image metadata', async () => {
      const mockMetadata = {
        format: 'jpeg',
        width: 1920,
        height: 1080,
        channels: 3,
        hasAlpha: false,
        density: 72,
        space: 'srgb',
      };

      const sharpInstance = mockSharp.mock.results[0].value;
      sharpInstance.metadata.mockResolvedValue(mockMetadata);

      mockFs.promises.stat.mockResolvedValue({ size: 2048576 });

      const info = await imageEngine.getImageInfo('/image.jpg');

      expect(info.format).toBe('jpeg');
      expect(info.width).toBe(1920);
      expect(info.height).toBe(1080);
      expect(info.size).toBe(2048576);
      expect(info.channels).toBe(3);
      expect(info.hasAlpha).toBe(false);
    });

    it('should handle metadata errors', async () => {
      const sharpInstance = mockSharp.mock.results[0].value;
      sharpInstance.metadata.mockRejectedValue(new Error('Invalid image'));

      await expect(imageEngine.getImageInfo('/bad-image.jpg')).rejects.toThrow();
    });
  });

  describe('handleProjectTask', () => {
    it('should route to correct handler', async () => {
      const tasks = [
        { taskType: 'generateFromText', prompt: 'Test', outputPath: '/out.png' },
        { taskType: 'resize', inputPath: '/in.jpg', outputPath: '/out.jpg', options: { width: 100, height: 100 } },
        { taskType: 'crop', inputPath: '/in.jpg', outputPath: '/out.jpg', options: { width: 50, height: 50 } },
        { taskType: 'enhance', inputPath: '/in.jpg', outputPath: '/out.jpg' },
        { taskType: 'convertFormat', inputPath: '/in.jpg', outputPath: '/out.png', options: { format: 'png' } },
      ];

      mockAxios.default.post.mockResolvedValue({
        data: { images: [Buffer.from('img').toString('base64')] },
      });

      for (const task of tasks) {
        const result = await imageEngine.handleProjectTask(task);
        expect(result).toBeDefined();
      }
    });

    it('should throw error for unsupported task type', async () => {
      await expect(
        imageEngine.handleProjectTask({
          taskType: 'unknown-task',
          inputPath: '/test.jpg',
          outputPath: '/out.jpg',
        })
      ).rejects.toThrow('不支持的任务类型');
    });
  });

  describe('getImageEngine - 单例模式', () => {
    it('should return singleton instance', () => {
      const instance1 = getImageEngine();
      const instance2 = getImageEngine();

      expect(instance1).toBe(instance2);
    });

    it('should set LLM manager if provided', () => {
      const mockLLMManager = { initialized: true };

      const instance = getImageEngine(mockLLMManager);

      expect(instance.llmManager).toBe(mockLLMManager);
    });

    it('should update LLM manager on subsequent calls', () => {
      const llm1 = { id: 1 };
      const llm2 = { id: 2 };

      const instance1 = getImageEngine(llm1);
      expect(instance1.llmManager).toBe(llm1);

      const instance2 = getImageEngine(llm2);
      expect(instance2.llmManager).toBe(llm2);
      expect(instance1).toBe(instance2);
    });
  });

  describe('边界条件和错误处理', () => {
    it('should handle empty image list in batch', async () => {
      const result = await imageEngine.batchProcess([], '/output');

      expect(result.totalCount).toBe(0);
      expect(result.successCount).toBe(0);
    });

    it('should handle single image in collage', async () => {
      const result = await imageEngine.createCollage(['/img.jpg'], '/collage.png');

      expect(result.success).toBe(true);
      expect(result.imageCount).toBe(1);
    });

    it('should handle Unicode in watermark text', async () => {
      const mockMetadata = { width: 1000, height: 800 };
      const sharpInstance = mockSharp.mock.results[0].value;
      sharpInstance.metadata.mockResolvedValue(mockMetadata);

      const result = await imageEngine.addWatermark('/input.jpg', '/output.jpg', {
        text: '版权所有 © 2025 🌍',
      });

      expect(result.success).toBe(true);
    });

    it('should handle very large scale factors', async () => {
      const mockMetadata = { width: 100, height: 100 };
      const sharpInstance = mockSharp.mock.results[0].value;
      sharpInstance.metadata.mockResolvedValue(mockMetadata);

      const result = await imageEngine.upscaleImage('/input.jpg', '/output.jpg', {
        scale: 10,
      });

      expect(result.newSize).toEqual({ width: 1000, height: 1000 });
    });
  });
});
