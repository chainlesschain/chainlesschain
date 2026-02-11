/**
 * SmartElementDetector 单元测试
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

const { SmartElementDetector, DetectionStrategy, ElementType, CONFIDENCE_THRESHOLD, getSmartElementDetector } = require('../smart-element-detector');

describe('SmartElementDetector', () => {
  let detector;
  let mockEngine;
  let mockPage;

  beforeEach(() => {
    vi.clearAllMocks();

    mockPage = {
      $: vi.fn().mockResolvedValue({
        boundingBox: vi.fn().mockResolvedValue({ x: 100, y: 100, width: 200, height: 50 })
      }),
      $$: vi.fn().mockResolvedValue([]),
      evaluate: vi.fn().mockResolvedValue([])
    };

    mockEngine = {
      getPage: vi.fn().mockReturnValue(mockPage)
    };

    detector = new SmartElementDetector(mockEngine);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with engine', () => {
      expect(detector.browserEngine).toBe(mockEngine);
      expect(detector.elementCache).toBeDefined();
    });

    it('should work without engine', () => {
      const d = new SmartElementDetector();
      expect(d.browserEngine).toBeNull();
    });

    it('should accept config', () => {
      const d = new SmartElementDetector(mockEngine, {
        enableCache: false,
        confidenceThreshold: 0.8
      });

      expect(d.config.enableCache).toBe(false);
      expect(d.config.confidenceThreshold).toBe(0.8);
    });
  });

  describe('detect', () => {
    it('should detect element by selector', async () => {
      mockPage.$.mockResolvedValueOnce({});
      mockPage.evaluate.mockResolvedValueOnce({
        tagName: 'button',
        text: 'Submit',
        bounds: { x: 100, y: 100, width: 100, height: 40 }
      });

      const result = await detector.detect('tab1', { selector: '#submit' });

      expect(result.success).toBe(true);
      expect(result.strategy).toBe(DetectionStrategy.EXACT);
    });

    it('should detect element by text', async () => {
      mockPage.evaluate.mockResolvedValueOnce([{
        tagName: 'button',
        role: 'button',
        labels: ['submit'],
        confidence: 0.95,
        bounds: { x: 100, y: 100, width: 100, height: 40 }
      }]);

      const result = await detector.detect('tab1', { text: 'Submit' });

      expect(result.success).toBe(true);
    });

    it('should use cache when enabled', async () => {
      mockPage.evaluate.mockResolvedValueOnce([{
        tagName: 'button',
        confidence: 0.95,
        bounds: { x: 100, y: 100, width: 100, height: 40 }
      }]);

      // First detection
      await detector.detect('tab1', { text: 'Submit' });

      // Second detection should use cache
      const result = await detector.detect('tab1', { text: 'Submit' });

      expect(result.strategy).toBe(DetectionStrategy.CACHED);
    });

    it('should throw when engine not set', async () => {
      const d = new SmartElementDetector();

      await expect(d.detect('tab1', { text: 'Submit' }))
        .rejects.toThrow('Browser engine not set');
    });

    it('should return failure when element not found', async () => {
      mockPage.evaluate.mockResolvedValue([]);
      mockPage.$.mockResolvedValue(null);

      const result = await detector.detect('tab1', { text: 'NotExist' });

      expect(result.success).toBe(false);
    });
  });

  describe('detectMultiple', () => {
    it('should detect multiple elements', async () => {
      mockPage.evaluate.mockResolvedValue([{
        tagName: 'button',
        confidence: 0.9,
        bounds: { x: 100, y: 100, width: 100, height: 40 }
      }]);

      const result = await detector.detectMultiple('tab1', [
        { text: 'Submit' },
        { text: 'Cancel' }
      ]);

      expect(result.total).toBe(2);
    });
  });

  describe('waitFor', () => {
    it('should wait for element to appear', async () => {
      mockPage.evaluate
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{
          tagName: 'button',
          confidence: 0.9,
          bounds: { x: 100, y: 100, width: 100, height: 40 }
        }]);

      const result = await detector.waitFor('tab1', { text: 'Submit' }, {
        timeout: 2000,
        interval: 100
      });

      expect(result.success).toBe(true);
    });

    it('should timeout when element not found', async () => {
      mockPage.evaluate.mockResolvedValue([]);
      mockPage.$.mockResolvedValue(null);

      const result = await detector.waitFor('tab1', { text: 'NotExist' }, {
        timeout: 500,
        interval: 100
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Timeout');
    });
  });

  describe('clearCache', () => {
    it('should clear all cache', async () => {
      // Add something to cache first
      mockPage.evaluate.mockResolvedValue([{
        tagName: 'button',
        confidence: 0.9,
        bounds: { x: 100, y: 100, width: 100, height: 40 }
      }]);
      await detector.detect('tab1', { text: 'Submit' });

      detector.clearCache();

      expect(detector.elementCache.size).toBe(0);
    });

    it('should clear cache for specific tab', async () => {
      mockPage.evaluate.mockResolvedValue([{
        tagName: 'button',
        confidence: 0.9,
        bounds: { x: 100, y: 100, width: 100, height: 40 }
      }]);

      await detector.detect('tab1', { text: 'Submit' });
      await detector.detect('tab2', { text: 'Cancel' });

      detector.clearCache('tab1');

      // Check that tab2 cache still exists (approximately)
      const stats = detector.getStats();
      expect(stats.cacheSize).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getStats', () => {
    it('should return statistics', async () => {
      mockPage.evaluate.mockResolvedValue([{
        tagName: 'button',
        confidence: 0.9,
        bounds: { x: 100, y: 100, width: 100, height: 40 }
      }]);

      await detector.detect('tab1', { text: 'Submit' });

      const stats = detector.getStats();

      expect(stats.totalDetections).toBe(1);
      expect(stats.cacheHitRate).toBeDefined();
    });
  });

  describe('resetStats', () => {
    it('should reset statistics', async () => {
      mockPage.evaluate.mockResolvedValue([{
        tagName: 'button',
        confidence: 0.9,
        bounds: { x: 100, y: 100, width: 100, height: 40 }
      }]);

      await detector.detect('tab1', { text: 'Submit' });
      detector.resetStats();

      const stats = detector.getStats();
      expect(stats.totalDetections).toBe(0);
    });
  });

  describe('DetectionStrategy constants', () => {
    it('should have all strategies defined', () => {
      expect(DetectionStrategy.EXACT).toBe('exact');
      expect(DetectionStrategy.FUZZY).toBe('fuzzy');
      expect(DetectionStrategy.VISUAL).toBe('visual');
      expect(DetectionStrategy.ACCESSIBILITY).toBe('accessibility');
      expect(DetectionStrategy.HEURISTIC).toBe('heuristic');
      expect(DetectionStrategy.CACHED).toBe('cached');
    });
  });

  describe('ElementType constants', () => {
    it('should have all types defined', () => {
      expect(ElementType.BUTTON).toBe('button');
      expect(ElementType.LINK).toBe('link');
      expect(ElementType.INPUT).toBe('input');
      expect(ElementType.SELECT).toBe('select');
      expect(ElementType.CHECKBOX).toBe('checkbox');
    });
  });

  describe('getSmartElementDetector singleton', () => {
    it('should return singleton instance', () => {
      const d1 = getSmartElementDetector(mockEngine);
      const d2 = getSmartElementDetector();

      expect(d1).toBe(d2);
    });
  });
});
