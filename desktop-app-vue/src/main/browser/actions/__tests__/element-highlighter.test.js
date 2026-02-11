/**
 * ElementHighlighter 单元测试
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

const { ElementHighlighter, HighlightStyle, getElementHighlighter } = require('../element-highlighter');

describe('ElementHighlighter', () => {
  let highlighter;
  let mockEngine;
  let mockPage;

  beforeEach(() => {
    vi.clearAllMocks();

    mockPage = {
      evaluate: vi.fn().mockResolvedValue({ success: true }),
      $: vi.fn().mockResolvedValue({
        boundingBox: vi.fn().mockResolvedValue({ x: 100, y: 100, width: 200, height: 50 })
      })
    };

    mockEngine = {
      getPage: vi.fn().mockReturnValue(mockPage),
      findElement: vi.fn().mockReturnValue({
        bounds: { x: 100, y: 100, width: 200, height: 50 }
      })
    };

    highlighter = new ElementHighlighter(mockEngine);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with engine', () => {
      expect(highlighter.browserEngine).toBe(mockEngine);
      expect(highlighter.activeHighlights).toBeDefined();
    });

    it('should work without engine', () => {
      const h = new ElementHighlighter();
      expect(h.browserEngine).toBeNull();
    });
  });

  describe('highlightBounds', () => {
    it('should highlight element by bounds', async () => {
      const bounds = { x: 100, y: 100, width: 200, height: 50 };
      const result = await highlighter.highlightBounds('tab1', bounds);

      expect(result.success).toBe(true);
      expect(result.highlightId).toBeDefined();
      expect(mockPage.evaluate).toHaveBeenCalled();
    });

    it('should support custom style', async () => {
      const bounds = { x: 100, y: 100, width: 200, height: 50 };
      const result = await highlighter.highlightBounds('tab1', bounds, {
        style: HighlightStyle.SUCCESS
      });

      expect(result.success).toBe(true);
    });

    it('should support custom duration', async () => {
      const bounds = { x: 100, y: 100, width: 200, height: 50 };
      const result = await highlighter.highlightBounds('tab1', bounds, {
        duration: 5000
      });

      expect(result.success).toBe(true);
    });

    it('should support label', async () => {
      const bounds = { x: 100, y: 100, width: 200, height: 50 };
      const result = await highlighter.highlightBounds('tab1', bounds, {
        label: 'Test Element'
      });

      expect(result.success).toBe(true);
    });

    it('should throw when engine not set', async () => {
      const h = new ElementHighlighter();
      await expect(h.highlightBounds('tab1', { x: 0, y: 0, width: 100, height: 100 }))
        .rejects.toThrow('Browser engine not set');
    });
  });

  describe('highlightSelector', () => {
    it('should highlight element by CSS selector', async () => {
      const mockBounds = { x: 100, y: 100, width: 200, height: 50 };
      mockPage.evaluate.mockResolvedValueOnce(mockBounds);

      const result = await highlighter.highlightSelector('tab1', '#myButton');

      expect(result.success).toBe(true);
    });

    it('should handle element not found', async () => {
      mockPage.evaluate.mockResolvedValueOnce(null);

      const result = await highlighter.highlightSelector('tab1', '#notFound');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('highlightRef', () => {
    it('should highlight element by ref', async () => {
      const result = await highlighter.highlightRef('tab1', 'button[1]');

      expect(result.success).toBe(true);
      expect(mockEngine.findElement).toHaveBeenCalledWith('tab1', 'button[1]');
    });

    it('should handle ref not found', async () => {
      mockEngine.findElement.mockReturnValueOnce(null);

      const result = await highlighter.highlightRef('tab1', 'unknown[1]');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('highlightClick', () => {
    it('should show click highlight at coordinates', async () => {
      const result = await highlighter.highlightClick('tab1', 150, 200);

      expect(result.success).toBe(true);
    });

    it('should support custom size', async () => {
      const result = await highlighter.highlightClick('tab1', 150, 200, {
        size: 60
      });

      expect(result.success).toBe(true);
    });
  });

  describe('showPath', () => {
    it('should draw path on page', async () => {
      const points = [
        { x: 100, y: 100 },
        { x: 200, y: 150 },
        { x: 300, y: 100 }
      ];

      const result = await highlighter.showPath('tab1', points);

      expect(result.success).toBe(true);
      expect(result.pointCount).toBe(3);
    });

    it('should handle insufficient points', async () => {
      const result = await highlighter.showPath('tab1', [{ x: 100, y: 100 }]);

      expect(result.success).toBe(false);
      expect(result.error).toContain('2 points');
    });

    it('should support custom color', async () => {
      const points = [{ x: 100, y: 100 }, { x: 200, y: 200 }];
      const result = await highlighter.showPath('tab1', points, {
        color: 'blue'
      });

      expect(result.success).toBe(true);
    });
  });

  describe('showAnnotation', () => {
    it('should show annotation at position', async () => {
      const result = await highlighter.showAnnotation('tab1', 150, 200, 'Click here');

      expect(result.success).toBe(true);
      expect(result.annotationId).toBeDefined();
    });

    it('should support custom styles', async () => {
      const result = await highlighter.showAnnotation('tab1', 100, 100, 'Important', {
        backgroundColor: '#ff0000',
        textColor: '#ffffff'
      });

      expect(result.success).toBe(true);
    });
  });

  describe('clearAll', () => {
    it('should clear all highlights for tab', async () => {
      // Add some highlights first
      await highlighter.highlightBounds('tab1', { x: 100, y: 100, width: 50, height: 50 });

      const result = await highlighter.clearAll('tab1');

      expect(result.success).toBe(true);
      expect(result.cleared).toBeDefined();
    });
  });

  describe('getActiveHighlights', () => {
    it('should return active highlights', async () => {
      await highlighter.highlightBounds('tab1', { x: 100, y: 100, width: 50, height: 50 });

      const highlights = highlighter.getActiveHighlights();

      expect(Array.isArray(highlights)).toBe(true);
      expect(highlights.length).toBe(1);
    });

    it('should return empty array when no highlights', () => {
      const h = new ElementHighlighter(mockEngine);
      const highlights = h.getActiveHighlights();

      expect(highlights).toEqual([]);
    });
  });

  describe('HighlightStyle constants', () => {
    it('should have all styles defined', () => {
      expect(HighlightStyle.DEFAULT).toBe('default');
      expect(HighlightStyle.SUCCESS).toBe('success');
      expect(HighlightStyle.ERROR).toBe('error');
      expect(HighlightStyle.WARNING).toBe('warning');
      expect(HighlightStyle.INFO).toBe('info');
      expect(HighlightStyle.PULSE).toBe('pulse');
      expect(HighlightStyle.OUTLINE).toBe('outline');
    });
  });

  describe('getElementHighlighter singleton', () => {
    it('should return singleton instance', () => {
      const h1 = getElementHighlighter(mockEngine);
      const h2 = getElementHighlighter();

      expect(h1).toBe(h2);
    });

    it('should create new instance with engine', () => {
      const h = getElementHighlighter(mockEngine);
      expect(h).toBeInstanceOf(ElementHighlighter);
    });
  });

  describe('execute method', () => {
    it('should execute bounds action', async () => {
      const result = await highlighter.execute('tab1', {
        action: 'bounds',
        bounds: { x: 100, y: 100, width: 50, height: 50 }
      });

      expect(result.success).toBe(true);
    });

    it('should execute click action', async () => {
      const result = await highlighter.execute('tab1', {
        action: 'click',
        x: 100,
        y: 200
      });

      expect(result.success).toBe(true);
    });

    it('should throw for unknown action', async () => {
      await expect(highlighter.execute('tab1', { action: 'unknown' }))
        .rejects.toThrow('Unknown action');
    });
  });

  describe('error handling', () => {
    it('should throw when page not found', async () => {
      mockEngine.getPage.mockReturnValueOnce(null);

      await expect(highlighter.highlightBounds('tab1', { x: 100, y: 100, width: 50, height: 50 }))
        .rejects.toThrow('Page not found');
    });

    it('should handle evaluate error', async () => {
      mockPage.evaluate.mockRejectedValueOnce(new Error('Script error'));

      await expect(highlighter.highlightBounds('tab1', { x: 100, y: 100, width: 50, height: 50 }))
        .rejects.toThrow('Script error');
    });
  });
});
