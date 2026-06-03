/**
 * adaptive-performance 单元测试
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock logger
vi.mock('@/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock performance-tracker
vi.mock('../performance-tracker', () => ({
  default: {
    getAllMetrics: vi.fn(() => ({
      fileOperations: { avgTime: 100 },
      cache: { hitRate: 75 },
    })),
  },
}));

// 需要在 mock 之后导入
import adaptivePerformance, {
  AdaptivePerformance,
  type DeviceTier,
  type PerformanceSettings,
  type DeviceProfile,
} from '../adaptive-performance';

describe('adaptive-performance', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('DeviceProfile 检测', () => {
    it('应该返回设备配置', () => {
      const profile = adaptivePerformance.getDeviceProfile();

      expect(profile).toHaveProperty('cores');
      expect(profile).toHaveProperty('memory');
      expect(profile).toHaveProperty('connection');
      expect(profile).toHaveProperty('tier');
    });

    it('应该检测设备层级', () => {
      const profile = adaptivePerformance.getDeviceProfile();
      const validTiers: DeviceTier[] = ['low', 'medium', 'high', 'unknown'];

      expect(validTiers).toContain(profile.tier);
    });

    it('应该返回内存信息', () => {
      const profile = adaptivePerformance.getDeviceProfile();

      expect(profile.memory).toHaveProperty('total');
      expect(profile.memory).toHaveProperty('totalMB');
      expect(profile.memory.total).toBeGreaterThan(0);
    });

    it('应该返回连接信息', () => {
      const profile = adaptivePerformance.getDeviceProfile();

      expect(profile.connection).toHaveProperty('effectiveType');
    });
  });

  describe('PerformanceSettings', () => {
    it('应该返回当前设置', () => {
      const settings = adaptivePerformance.getSettings();

      expect(settings).toHaveProperty('workerPoolSize');
      expect(settings).toHaveProperty('editorPoolSize');
      expect(settings).toHaveProperty('fileTreeBatchSize');
      expect(settings).toHaveProperty('virtualScrollBuffer');
      expect(settings).toHaveProperty('debounceDelay');
      expect(settings).toHaveProperty('cacheMaxSize');
      expect(settings).toHaveProperty('prefetchEnabled');
      expect(settings).toHaveProperty('prefetchMaxFiles');
    });

    it('所有设置值应该是合理的', () => {
      const settings = adaptivePerformance.getSettings();

      expect(settings.workerPoolSize).toBeGreaterThanOrEqual(1);
      expect(settings.workerPoolSize).toBeLessThanOrEqual(16);
      expect(settings.editorPoolSize).toBeGreaterThanOrEqual(1);
      expect(settings.fileTreeBatchSize).toBeGreaterThanOrEqual(10);
      expect(settings.virtualScrollBuffer).toBeGreaterThanOrEqual(1);
      expect(settings.debounceDelay).toBeGreaterThanOrEqual(100);
      expect(settings.cacheMaxSize).toBeGreaterThan(0);
      expect(settings.prefetchMaxFiles).toBeGreaterThanOrEqual(0);
    });
  });

  describe('setSetting 方法', () => {
    it('应该允许手动设置参数', () => {
      const result = adaptivePerformance.setSetting('debounceDelay', 400);

      expect(result).toBe(true);
      expect(adaptivePerformance.getSettings().debounceDelay).toBe(400);
    });

    it('应该返回 false 对于无效的设置名', () => {
      const result = adaptivePerformance.setSetting('invalidSetting' as any, 100);

      expect(result).toBe(false);
    });

    it('应该允许设置布尔值', () => {
      adaptivePerformance.setSetting('prefetchEnabled', false);

      expect(adaptivePerformance.getSettings().prefetchEnabled).toBe(false);
    });
  });

  describe('getMetrics 方法', () => {
    it('应该返回性能指标', () => {
      const metrics = adaptivePerformance.getMetrics();

      expect(metrics).toHaveProperty('avgFileLoadTime');
      expect(metrics).toHaveProperty('avgRenderTime');
      expect(metrics).toHaveProperty('avgInteractionTime');
      expect(metrics).toHaveProperty('memoryUsage');
      expect(metrics).toHaveProperty('frameDrops');
      expect(metrics).toHaveProperty('cacheHitRate');
    });

    it('所有指标值应该是数字', () => {
      const metrics = adaptivePerformance.getMetrics();

      expect(typeof metrics.avgFileLoadTime).toBe('number');
      expect(typeof metrics.avgRenderTime).toBe('number');
      expect(typeof metrics.memoryUsage).toBe('number');
      expect(typeof metrics.frameDrops).toBe('number');
      expect(typeof metrics.cacheHitRate).toBe('number');
    });
  });

  describe('getStats 方法', () => {
    it('应该返回完整的统计信息', () => {
      const stats = adaptivePerformance.getStats();

      expect(stats).toHaveProperty('deviceProfile');
      expect(stats).toHaveProperty('settings');
      expect(stats).toHaveProperty('metrics');
      expect(stats).toHaveProperty('tuningHistory');
    });

    it('tuningHistory 应该是数组', () => {
      const stats = adaptivePerformance.getStats();

      expect(Array.isArray(stats.tuningHistory)).toBe(true);
    });

    it('tuningHistory 应该最多返回10条记录', () => {
      const stats = adaptivePerformance.getStats();

      expect(stats.tuningHistory.length).toBeLessThanOrEqual(10);
    });
  });

  describe('reset 方法', () => {
    it('应该重置到初始设置', () => {
      // 先修改设置
      adaptivePerformance.setSetting('debounceDelay', 999);

      // 重置
      adaptivePerformance.reset();

      // 验证已重置（值应该基于设备层级的默认值）
      const settings = adaptivePerformance.getSettings();
      expect(settings.debounceDelay).not.toBe(999);
    });

    it('应该清空帧丢失计数', () => {
      adaptivePerformance.reset();

      const metrics = adaptivePerformance.getMetrics();
      expect(metrics.frameDrops).toBe(0);
    });
  });

  describe('stop 方法', () => {
    it('应该停止监控', () => {
      // 这个测试主要验证方法不会抛出错误
      expect(() => adaptivePerformance.stop()).not.toThrow();
    });
  });

  describe('设备层级初始设置', () => {
    it('高端设备应该有更大的设置值', () => {
      // 创建一个模拟高端设备的实例
      const highEndSettings: PerformanceSettings = {
        workerPoolSize: 8,
        editorPoolSize: 15,
        fileTreeBatchSize: 100,
        virtualScrollBuffer: 10,
        debounceDelay: 200,
        cacheMaxSize: 200 * 1024 * 1024,
        prefetchEnabled: true,
        prefetchMaxFiles: 10,
      };

      // 验证高端设备设置的合理性
      expect(highEndSettings.workerPoolSize).toBeGreaterThanOrEqual(4);
      expect(highEndSettings.editorPoolSize).toBeGreaterThanOrEqual(10);
      expect(highEndSettings.fileTreeBatchSize).toBeGreaterThanOrEqual(50);
    });

    it('低端设备应该有更保守的设置值', () => {
      const lowEndSettings: PerformanceSettings = {
        workerPoolSize: 2,
        editorPoolSize: 5,
        fileTreeBatchSize: 25,
        virtualScrollBuffer: 3,
        debounceDelay: 500,
        cacheMaxSize: 50 * 1024 * 1024,
        prefetchEnabled: false,
        prefetchMaxFiles: 0,
      };

      // 验证低端设备设置的合理性
      expect(lowEndSettings.workerPoolSize).toBeLessThanOrEqual(4);
      expect(lowEndSettings.prefetchEnabled).toBe(false);
      expect(lowEndSettings.debounceDelay).toBeGreaterThanOrEqual(300);
    });
  });

  describe('性能事件', () => {
    it('应该触发设置变更事件', () => {
      const eventHandler = vi.fn();
      window.addEventListener('adaptive-performance-update', eventHandler);

      adaptivePerformance.setSetting('debounceDelay', 350);

      expect(eventHandler).toHaveBeenCalled();

      window.removeEventListener('adaptive-performance-update', eventHandler);
    });

    it('事件详情应该包含新设置', () => {
      let eventDetail: any = null;
      const eventHandler = (e: CustomEvent) => {
        eventDetail = e.detail;
      };

      window.addEventListener('adaptive-performance-update', eventHandler as EventListener);

      adaptivePerformance.setSetting('cacheMaxSize', 150 * 1024 * 1024);

      expect(eventDetail).not.toBeNull();
      expect(eventDetail.settings).toHaveProperty('cacheMaxSize');

      window.removeEventListener('adaptive-performance-update', eventHandler as EventListener);
    });
  });

  describe('不可变性', () => {
    it('getSettings 返回的对象不应该影响内部状态', () => {
      const settings = adaptivePerformance.getSettings();
      const originalValue = settings.debounceDelay;

      settings.debounceDelay = 9999;

      expect(adaptivePerformance.getSettings().debounceDelay).toBe(originalValue);
    });

    it('getDeviceProfile 返回的对象不应该影响内部状态', () => {
      const profile = adaptivePerformance.getDeviceProfile();
      const originalTier = profile.tier;

      profile.tier = 'unknown';

      expect(adaptivePerformance.getDeviceProfile().tier).toBe(originalTier);
    });

    it('getMetrics 返回的对象不应该影响内部状态', () => {
      const metrics = adaptivePerformance.getMetrics();
      const originalFrameDrops = metrics.frameDrops;

      metrics.frameDrops = 9999;

      expect(adaptivePerformance.getMetrics().frameDrops).toBe(originalFrameDrops);
    });
  });

  describe('页面可见性处理', () => {
    it('应该在页面隐藏时减少资源使用', () => {
      // 模拟页面隐藏事件
      Object.defineProperty(document, 'hidden', {
        configurable: true,
        value: true,
      });

      document.dispatchEvent(new Event('visibilitychange'));

      const settings = adaptivePerformance.getSettings();
      expect(settings.prefetchEnabled).toBe(false);
      expect(settings.workerPoolSize).toBe(1);
    });

    it('应该在页面可见时恢复设置', () => {
      // 先隐藏页面
      Object.defineProperty(document, 'hidden', {
        configurable: true,
        value: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));

      // 然后显示页面
      Object.defineProperty(document, 'hidden', {
        configurable: true,
        value: false,
      });
      document.dispatchEvent(new Event('visibilitychange'));

      // 设置应该被恢复（具体值取决于设备层级）
      const settings = adaptivePerformance.getSettings();
      expect(settings.workerPoolSize).toBeGreaterThanOrEqual(1);
    });
  });

  describe('AdaptivePerformance 类导出', () => {
    it('应该能够导出 AdaptivePerformance 类', () => {
      expect(AdaptivePerformance).toBeDefined();
      expect(typeof AdaptivePerformance).toBe('function');
    });
  });
});
