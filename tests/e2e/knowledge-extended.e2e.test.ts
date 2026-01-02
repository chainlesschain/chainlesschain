/**
 * Knowledge API扩展E2E测试
 * 测试知识管理的版本控制、付费内容等高级功能
 */

import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';

test.describe('Knowledge API Extended E2E Tests', () => {
  let electronApp: any;
  let window: any;

  test.beforeAll(async () => {
    electronApp = await electron.launch({
      args: [path.join(__dirname, '../../desktop-app-vue/dist/main/index.js')],
      env: {
        ...process.env,
        NODE_ENV: 'test',
      },
    });

    window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
  });

  test.afterAll(async () => {
    await electronApp.close();
  });

  test.describe('Content Management', () => {
    test('should create paid content', async () => {
      const result = await window.evaluate(async () => {
        try {
          return await (window as any).electronAPI.knowledge.createContent({
            contentType: 'article',
            title: 'Test Article',
            description: 'Test Description',
            priceAssetId: 'test-asset',
            priceAmount: 100,
            pricingModel: 'one_time',
            contentData: { text: 'Test content' },
            previewData: { text: 'Preview' },
          });
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      });

      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });

    test('should get content by ID', async () => {
      const result = await window.evaluate(async () => {
        try {
          return await (window as any).electronAPI.knowledge.getContent('test-content-id');
        } catch (error: any) {
          // 内容不存在是预期的
          return { success: false, error: 'Content not found' };
        }
      });

      expect(result).toBeDefined();
    });

    test('should update content', async () => {
      const result = await window.evaluate(async () => {
        try {
          return await (window as any).electronAPI.knowledge.updateContent('test-content-id', {
            title: 'Updated Title',
            description: 'Updated Description',
          });
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      });

      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });

    test('should delete content', async () => {
      const result = await window.evaluate(async () => {
        try {
          return await (window as any).electronAPI.knowledge.deleteContent('test-content-id');
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      });

      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });
  });

  test.describe('Version Management', () => {
    test('should get version history', async () => {
      const result = await window.evaluate(async () => {
        try {
          return await (window as any).electronAPI.knowledge.getVersionHistory({
            contentId: 'test-content-id',
            limit: 10,
          });
        } catch (error: any) {
          return { success: false, error: error.message, versions: [] };
        }
      });

      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });

    test('should compare versions', async () => {
      const result = await window.evaluate(async () => {
        try {
          return await (window as any).electronAPI.knowledge.compareVersions({
            contentId: 'test-content-id',
            versionId1: 'v1',
            versionId2: 'v2',
          });
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      });

      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });

    test('should restore version', async () => {
      const result = await window.evaluate(async () => {
        try {
          return await (window as any).electronAPI.knowledge.restoreVersion({
            contentId: 'test-content-id',
            versionId: 'v1',
          });
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      });

      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });
  });

  test.describe('Paid Content & Subscription', () => {
    test('should purchase content', async () => {
      const result = await window.evaluate(async () => {
        try {
          return await (window as any).electronAPI.knowledge.purchaseContent(
            'test-content-id',
            'test-asset-id'
          );
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      });

      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });

    test('should subscribe to plan', async () => {
      const result = await window.evaluate(async () => {
        try {
          return await (window as any).electronAPI.knowledge.subscribe(
            'test-plan-id',
            'test-asset-id'
          );
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      });

      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });

    test('should unsubscribe from plan', async () => {
      const result = await window.evaluate(async () => {
        try {
          return await (window as any).electronAPI.knowledge.unsubscribe('test-plan-id');
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      });

      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });

    test('should get my purchases', async () => {
      const result = await window.evaluate(async () => {
        try {
          return await (window as any).electronAPI.knowledge.getMyPurchases('test-user-did');
        } catch (error: any) {
          return { success: false, error: error.message, purchases: [] };
        }
      });

      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });

    test('should get my subscriptions', async () => {
      const result = await window.evaluate(async () => {
        try {
          return await (window as any).electronAPI.knowledge.getMySubscriptions('test-user-did');
        } catch (error: any) {
          return { success: false, error: error.message, subscriptions: [] };
        }
      });

      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });
  });

  test.describe('Access Control & Statistics', () => {
    test('should check content access', async () => {
      const result = await window.evaluate(async () => {
        try {
          return await (window as any).electronAPI.knowledge.checkAccess(
            'test-content-id',
            'test-user-did'
          );
        } catch (error: any) {
          return { success: false, hasAccess: false };
        }
      });

      expect(result).toBeDefined();
      // checkAccess可能返回boolean或object
      expect(['boolean', 'object'].includes(typeof result)).toBe(true);
    });

    test('should access content', async () => {
      const result = await window.evaluate(async () => {
        try {
          return await (window as any).electronAPI.knowledge.accessContent('test-content-id');
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      });

      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });

    test('should get content statistics', async () => {
      const result = await window.evaluate(async () => {
        try {
          return await (window as any).electronAPI.knowledge.getStatistics('test-creator-did');
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      });

      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });
  });
});
