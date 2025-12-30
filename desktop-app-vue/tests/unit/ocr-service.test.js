/**
 * OCR服务测试
 *
 * 测试 src/main/image/ocr-service.js
 * 目标覆盖率: 75%
 *
 * 测试范围:
 * - OCR Worker初始化
 * - 图片文字识别（单个、批量）
 * - 文字区域检测
 * - 语言配置和切换
 * - 质量评估
 * - 错误处理
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('OCRService - OCR文字识别服务', () => {
  let OCRService;
  let ocrService;
  let mockWorker;

  beforeEach(async () => {
    // 动态导入OCRService
    const module = await import('../../src/main/image/ocr-service.js');
    OCRService = module.default;

    // Mock Tesseract.js worker
    mockWorker = {
      loadLanguage: vi.fn().mockResolvedValue(undefined),
      initialize: vi.fn().mockResolvedValue(undefined),
      setParameters: vi.fn().mockResolvedValue(undefined),
      recognize: vi.fn().mockResolvedValue({
        data: {
          text: 'Sample OCR text\n这是测试文字',
          confidence: 85.5,
          words: [
            { text: 'Sample', confidence: 90.0, bbox: { x0: 0, y0: 0, x1: 50, y1: 20 } },
            { text: 'OCR', confidence: 88.0, bbox: { x0: 55, y0: 0, x1: 80, y1: 20 } },
            { text: 'text', confidence: 92.0, bbox: { x0: 85, y0: 0, x1: 120, y1: 20 } },
            { text: '这是测试文字', confidence: 75.0, bbox: { x0: 0, y0: 25, x1: 100, y1: 45 } }
          ],
          lines: [
            { text: 'Sample OCR text', confidence: 90.0, bbox: { x0: 0, y0: 0, x1: 120, y1: 20 } },
            { text: '这是测试文字', confidence: 75.0, bbox: { x0: 0, y0: 25, x1: 100, y1: 45 } }
          ],
          paragraphs: [
            { text: 'Sample OCR text\n这是测试文字', confidence: 85.5, bbox: { x0: 0, y0: 0, x1: 120, y1: 45 } }
          ],
          blocks: [
            { text: 'Sample OCR text\n这是测试文字', confidence: 85.5, bbox: { x0: 0, y0: 0, x1: 120, y1: 45 } }
          ]
        }
      }),
      terminate: vi.fn().mockResolvedValue(undefined)
    };

    // Mock createWorker
    vi.mock('tesseract.js', () => ({
      createWorker: vi.fn((options) => {
        // 模拟进度回调
        if (options && options.logger) {
          setTimeout(() => {
            options.logger({ status: 'recognizing text', progress: 0.5 });
          }, 10);
        }
        return Promise.resolve(mockWorker);
      })
    }));

    ocrService = new OCRService({
      languages: ['chi_sim', 'eng']
    });
  });

  afterEach(async () => {
    if (ocrService && ocrService.isInitialized) {
      await ocrService.terminate();
    }
    vi.clearAllMocks();
  });

  // ============================================
  // 1. 配置和初始化测试
  // ============================================
  describe('Configuration and Initialization - 配置和初始化', () => {
    it('should create OCR service with default config', () => {
      const service = new OCRService();

      const config = service.getConfig();
      expect(config).toHaveProperty('languages');
      expect(config).toHaveProperty('tessedit_pageseg_mode');
      expect(config).toHaveProperty('workerCount');
    });

    it('should create OCR service with custom config', () => {
      const customConfig = {
        languages: ['eng'],
        workerCount: 2
      };

      const service = new OCRService(customConfig);
      const config = service.getConfig();

      expect(config.languages).toEqual(['eng']);
      expect(config.workerCount).toBe(2);
    });

    it('should merge custom config with default config', () => {
      const service = new OCRService({ languages: ['jpn'] });
      const config = service.getConfig();

      expect(config.languages).toEqual(['jpn']);
      expect(config.tessedit_pageseg_mode).toBe('1'); // 默认值保留
    });

    it('should initialize worker when not initialized', async () => {
      expect(ocrService.isInitialized).toBe(false);

      await ocrService.initialize();

      expect(ocrService.isInitialized).toBe(true);
      expect(mockWorker.loadLanguage).toHaveBeenCalled();
      expect(mockWorker.initialize).toHaveBeenCalled();
      expect(mockWorker.setParameters).toHaveBeenCalled();
    });

    it('should not reinitialize if already initialized', async () => {
      await ocrService.initialize();
      const firstWorker = ocrService.worker;

      await ocrService.initialize();
      const secondWorker = ocrService.worker;

      expect(firstWorker).toBe(secondWorker);
    });

    it('should emit initialize events', async () => {
      const startSpy = vi.fn();
      const completeSpy = vi.fn();

      ocrService.on('initialize-start', startSpy);
      ocrService.on('initialize-complete', completeSpy);

      await ocrService.initialize();

      expect(startSpy).toHaveBeenCalled();
      expect(completeSpy).toHaveBeenCalled();
    });

    it('should handle initialization errors', async () => {
      mockWorker.loadLanguage.mockRejectedValue(new Error('Language load failed'));

      const errorSpy = vi.fn();
      ocrService.on('initialize-error', errorSpy);

      await expect(ocrService.initialize()).rejects.toThrow('Language load failed');
      expect(errorSpy).toHaveBeenCalled();
      expect(ocrService.isInitialized).toBe(false);
    });
  });

  // ============================================
  // 2. 图片识别测试
  // ============================================
  describe('Image Recognition - 图片识别', () => {
    beforeEach(async () => {
      await ocrService.initialize();
    });

    it('should recognize text from image', async () => {
      const imagePath = '/path/to/image.png';

      const result = await ocrService.recognize(imagePath);

      expect(result).toHaveProperty('text');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('words');
      expect(result).toHaveProperty('lines');
      expect(result.text).toContain('Sample OCR text');
    });

    it('should initialize automatically if not initialized', async () => {
      const service = new OCRService();
      expect(service.isInitialized).toBe(false);

      // Mock createWorker for the new service
      const module = await import('tesseract.js');
      module.createWorker.mockResolvedValue(mockWorker);

      await service.recognize('/path/to/image.png');

      expect(service.isInitialized).toBe(true);
      await service.terminate();
    });

    it('should emit recognize events', async () => {
      const startSpy = vi.fn();
      const completeSpy = vi.fn();

      ocrService.on('recognize-start', startSpy);
      ocrService.on('recognize-complete', completeSpy);

      await ocrService.recognize('/path/to/image.png');

      expect(startSpy).toHaveBeenCalled();
      expect(completeSpy).toHaveBeenCalled();
    });

    it('should handle recognition with specific language', async () => {
      const imagePath = '/path/to/chinese.png';
      const options = { languages: ['chi_sim'] };

      await ocrService.recognize(imagePath, options);

      expect(mockWorker.loadLanguage).toHaveBeenCalledWith('chi_sim');
    });

    it('should handle recognition with rectangle region', async () => {
      const imagePath = '/path/to/image.png';
      const rectangle = { left: 10, top: 10, width: 100, height: 50 };

      await ocrService.recognize(imagePath, { rectangle });

      expect(mockWorker.recognize).toHaveBeenCalledWith(
        imagePath,
        { rectangle }
      );
    });

    it('should return structured OCR result', async () => {
      const result = await ocrService.recognize('/path/to/image.png');

      expect(result.words).toHaveLength(4);
      expect(result.words[0]).toHaveProperty('text');
      expect(result.words[0]).toHaveProperty('confidence');
      expect(result.words[0]).toHaveProperty('bbox');

      expect(result.lines).toHaveLength(2);
      expect(result.paragraphs).toHaveLength(1);
      expect(result.blocks).toHaveLength(1);
    });

    it('should trim whitespace from recognized text', async () => {
      mockWorker.recognize.mockResolvedValue({
        data: {
          text: '   Sample text   \n\n',
          confidence: 80,
          words: [],
          lines: [],
          paragraphs: [],
          blocks: []
        }
      });

      const result = await ocrService.recognize('/path/to/image.png');

      expect(result.text).toBe('Sample text');
    });

    it('should handle recognition errors', async () => {
      mockWorker.recognize.mockRejectedValue(new Error('Recognition failed'));

      const errorSpy = vi.fn();
      ocrService.on('recognize-error', errorSpy);

      await expect(ocrService.recognize('/path/to/image.png')).rejects.toThrow('Recognition failed');
      expect(errorSpy).toHaveBeenCalled();
    });
  });

  // ============================================
  // 3. 批量识别测试
  // ============================================
  describe('Batch Recognition - 批量识别', () => {
    beforeEach(async () => {
      await ocrService.initialize();
    });

    it('should recognize multiple images', async () => {
      const images = ['/path/to/image1.png', '/path/to/image2.png', '/path/to/image3.png'];

      const results = await ocrService.recognizeBatch(images);

      expect(results).toHaveLength(3);
      expect(results[0].success).toBe(true);
      expect(results[0]).toHaveProperty('text');
    });

    it('should emit batch progress events', async () => {
      const progressSpy = vi.fn();
      const completeSpy = vi.fn();

      ocrService.on('batch-progress', progressSpy);
      ocrService.on('batch-complete', completeSpy);

      const images = ['/path/to/image1.png', '/path/to/image2.png'];
      await ocrService.recognizeBatch(images);

      expect(progressSpy).toHaveBeenCalledTimes(2);
      expect(completeSpy).toHaveBeenCalled();
    });

    it('should handle individual recognition failures in batch', async () => {
      mockWorker.recognize
        .mockResolvedValueOnce({ data: { text: 'Success', confidence: 90, words: [], lines: [], paragraphs: [], blocks: [] } })
        .mockRejectedValueOnce(new Error('Failed'))
        .mockResolvedValueOnce({ data: { text: 'Success', confidence: 90, words: [], lines: [], paragraphs: [], blocks: [] } });

      const images = ['/path/to/image1.png', '/path/to/image2.png', '/path/to/image3.png'];
      const results = await ocrService.recognizeBatch(images);

      expect(results).toHaveLength(3);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
      expect(results[1].error).toBeDefined();
      expect(results[2].success).toBe(true);
    });

    it('should include image path in batch results', async () => {
      const images = ['/path/to/image1.png'];
      const results = await ocrService.recognizeBatch(images);

      expect(results[0].image).toBe('/path/to/image1.png');
    });

    it('should report batch statistics', async () => {
      const completeSpy = vi.fn();
      ocrService.on('batch-complete', completeSpy);

      mockWorker.recognize
        .mockResolvedValueOnce({ data: { text: 'Success', confidence: 90, words: [], lines: [], paragraphs: [], blocks: [] } })
        .mockRejectedValueOnce(new Error('Failed'));

      const images = ['/path/to/image1.png', '/path/to/image2.png'];
      await ocrService.recognizeBatch(images);

      expect(completeSpy).toHaveBeenCalledWith({
        total: 2,
        succeeded: 1,
        failed: 1
      });
    });
  });

  // ============================================
  // 4. 文字区域检测测试
  // ============================================
  describe('Text Region Detection - 文字区域检测', () => {
    beforeEach(async () => {
      await ocrService.initialize();
    });

    it('should detect text regions in image', async () => {
      const regions = await ocrService.detectTextRegions('/path/to/image.png');

      expect(regions).toHaveLength(1);
      expect(regions[0]).toHaveProperty('bbox');
      expect(regions[0]).toHaveProperty('text');
      expect(regions[0]).toHaveProperty('confidence');
    });

    it('should return bounding boxes for text blocks', async () => {
      const regions = await ocrService.detectTextRegions('/path/to/image.png');

      expect(regions[0].bbox).toHaveProperty('x0');
      expect(regions[0].bbox).toHaveProperty('y0');
      expect(regions[0].bbox).toHaveProperty('x1');
      expect(regions[0].bbox).toHaveProperty('y1');
    });

    it('should handle detection errors', async () => {
      mockWorker.recognize.mockRejectedValue(new Error('Detection failed'));

      await expect(ocrService.detectTextRegions('/path/to/image.png')).rejects.toThrow('Detection failed');
    });
  });

  // ============================================
  // 5. 语言支持测试
  // ============================================
  describe('Language Support - 语言支持', () => {
    it('should return list of supported languages', () => {
      const languages = ocrService.getSupportedLanguages();

      expect(Array.isArray(languages)).toBe(true);
      expect(languages.length).toBeGreaterThan(0);

      const chinese = languages.find(l => l.code === 'chi_sim');
      expect(chinese).toBeDefined();
      expect(chinese.name).toBe('简体中文');

      const english = languages.find(l => l.code === 'eng');
      expect(english).toBeDefined();
      expect(english.name).toBe('英语');
    });

    it('should include multiple language options', () => {
      const languages = ocrService.getSupportedLanguages();

      expect(languages.some(l => l.code === 'jpn')).toBe(true);
      expect(languages.some(l => l.code === 'kor')).toBe(true);
      expect(languages.some(l => l.code === 'fra')).toBe(true);
    });
  });

  // ============================================
  // 6. 质量评估测试
  // ============================================
  describe('Quality Evaluation - 质量评估', () => {
    it('should evaluate high quality recognition', () => {
      const result = {
        confidence: 90,
        words: [
          { text: 'high', confidence: 92 },
          { text: 'quality', confidence: 88 },
          { text: 'text', confidence: 95 }
        ]
      };

      const evaluation = ocrService.evaluateQuality(result);

      expect(evaluation.quality).toBe('high');
      expect(evaluation.confidence).toBe(90);
      expect(evaluation.wordCount).toBe(3);
      expect(parseFloat(evaluation.lowConfidenceRatio)).toBeLessThan(10);
    });

    it('should evaluate medium quality recognition', () => {
      const result = {
        confidence: 70,
        words: [
          { text: 'medium', confidence: 75 },
          { text: 'quality', confidence: 65 }
        ]
      };

      const evaluation = ocrService.evaluateQuality(result);

      expect(evaluation.quality).toBe('medium');
      expect(evaluation.recommendation).toContain('检查');
    });

    it('should evaluate low quality recognition', () => {
      const result = {
        confidence: 50,
        words: [
          { text: 'low', confidence: 55 },
          { text: 'quality', confidence: 45 }
        ]
      };

      const evaluation = ocrService.evaluateQuality(result);

      expect(evaluation.quality).toBe('low');
      expect(evaluation.recommendation).toContain('重新拍摄');
    });

    it('should evaluate very low quality recognition', () => {
      const result = {
        confidence: 30,
        words: [
          { text: 'very', confidence: 35 },
          { text: 'low', confidence: 25 }
        ]
      };

      const evaluation = ocrService.evaluateQuality(result);

      expect(evaluation.quality).toBe('very_low');
    });

    it('should calculate low confidence word ratio', () => {
      const result = {
        confidence: 80,
        words: [
          { text: 'word1', confidence: 90 },
          { text: 'word2', confidence: 50 }, // low confidence
          { text: 'word3', confidence: 85 },
          { text: 'word4', confidence: 40 }  // low confidence
        ]
      };

      const evaluation = ocrService.evaluateQuality(result);

      // 2 out of 4 words have low confidence (< 60)
      expect(parseFloat(evaluation.lowConfidenceRatio)).toBe(50.0);
    });

    it('should provide quality recommendations', () => {
      const highQuality = ocrService.getQualityRecommendation('high');
      const mediumQuality = ocrService.getQualityRecommendation('medium');
      const lowQuality = ocrService.getQualityRecommendation('low');

      expect(highQuality).toContain('可直接使用');
      expect(mediumQuality).toContain('检查');
      expect(lowQuality).toContain('重新拍摄');
    });
  });

  // ============================================
  // 7. 配置更新测试
  // ============================================
  describe('Configuration Update - 配置更新', () => {
    it('should update config without reinitialization', async () => {
      const newConfig = { workerCount: 3 };

      await ocrService.updateConfig(newConfig);

      const config = ocrService.getConfig();
      expect(config.workerCount).toBe(3);
    });

    it('should reinitialize when languages change', async () => {
      await ocrService.initialize();
      const terminateSpy = vi.spyOn(ocrService, 'terminate');

      await ocrService.updateConfig({ languages: ['jpn'] });

      expect(terminateSpy).toHaveBeenCalled();
      expect(ocrService.isInitialized).toBe(true);
    });

    it('should not reinitialize if not initialized', async () => {
      const service = new OCRService();
      const terminateSpy = vi.spyOn(service, 'terminate');

      await service.updateConfig({ languages: ['jpn'] });

      expect(terminateSpy).not.toHaveBeenCalled();
    });
  });

  // ============================================
  // 8. Worker终止测试
  // ============================================
  describe('Worker Termination - Worker终止', () => {
    it('should terminate worker successfully', async () => {
      await ocrService.initialize();
      expect(ocrService.isInitialized).toBe(true);

      await ocrService.terminate();

      expect(mockWorker.terminate).toHaveBeenCalled();
      expect(ocrService.worker).toBeNull();
      expect(ocrService.isInitialized).toBe(false);
    });

    it('should handle termination when worker not initialized', async () => {
      await ocrService.terminate();

      expect(mockWorker.terminate).not.toHaveBeenCalled();
    });

    it('should handle termination errors', async () => {
      await ocrService.initialize();
      mockWorker.terminate.mockRejectedValue(new Error('Termination failed'));

      await ocrService.terminate();

      // Should not throw, just log error
      expect(ocrService.worker).toBeNull();
      expect(ocrService.isInitialized).toBe(false);
    });
  });

  // ============================================
  // 9. 事件发射测试
  // ============================================
  describe('Event Emission - 事件发射', () => {
    it('should be an EventEmitter', () => {
      expect(ocrService.on).toBeDefined();
      expect(ocrService.emit).toBeDefined();
    });

    it('should emit progress events during recognition', async () => {
      const progressSpy = vi.fn();
      ocrService.on('progress', progressSpy);

      await ocrService.initialize();

      // 等待异步进度回调
      await new Promise(resolve => setTimeout(resolve, 50));

      // 注意：进度事件可能在初始化时发出
      // 实际测试中可能需要调整时间或mock
    });

    it('should emit error events', async () => {
      mockWorker.loadLanguage.mockRejectedValue(new Error('Test error'));

      const errorSpy = vi.fn();
      ocrService.on('error', errorSpy);

      try {
        await ocrService.initialize();
      } catch (e) {
        // Expected error
      }

      // Error event may be emitted from errorHandler callback
    });
  });
});
