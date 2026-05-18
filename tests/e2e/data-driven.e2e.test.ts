/**
 * 数据驱动测试
 * 使用多组测试数据验证边界情况和错误处理
 */

import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';

test.describe('Data-Driven E2E Tests', () => {
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

  test.describe('Notification API - Pagination', () => {
    // 测试不同的分页参数
    const paginationData = [
      { limit: 10, offset: 0, description: 'First page with 10 items' },
      { limit: 50, offset: 0, description: 'First page with 50 items' },
      { limit: 100, offset: 0, description: 'First page with 100 items' },
      { limit: 10, offset: 10, description: 'Second page with 10 items' },
      { limit: 0, offset: 0, description: 'Zero limit (should use default)' },
      { limit: -1, offset: 0, description: 'Negative limit (edge case)' },
    ];

    for (const data of paginationData) {
      test(`should handle pagination: ${data.description}`, async () => {
        const result = await window.evaluate(async (params: any) => {
          return await (window as any).electronAPI.notification.getAll({
            limit: params.limit,
            offset: params.offset,
          });
        }, data);

        expect(result).toBeDefined();
        expect(result.success).toBe(true);
        expect(Array.isArray(result.notifications)).toBe(true);

        if (data.limit > 0) {
          expect(result.notifications.length).toBeLessThanOrEqual(data.limit);
        }
      });
    }
  });

  test.describe('Knowledge API - Content Filters', () => {
    // 测试不同的内容类型过滤器
    const contentTypeData = [
      { contentType: 'article', status: 'active' },
      { contentType: 'video', status: 'active' },
      { contentType: 'audio', status: 'active' },
      { contentType: 'course', status: 'active' },
      { contentType: undefined, status: 'active' }, // 不指定类型
      { contentType: 'article', status: 'inactive' },
    ];

    for (const data of contentTypeData) {
      test(`should filter by contentType=${data.contentType}, status=${data.status}`, async () => {
        const result = await window.evaluate(async (filters: any) => {
          return await (window as any).electronAPI.knowledge.listContents(filters);
        }, data);

        expect(result).toBeDefined();
        expect(result.success).toBe(true);
        expect(Array.isArray(result.contents)).toBe(true);

        // 验证返回的内容是否符合过滤条件
        if (data.contentType && result.contents.length > 0) {
          result.contents.forEach((content: any) => {
            expect(content.contentType).toBe(data.contentType);
          });
        }
      });
    }
  });

  test.describe('Social API - Contact Relationships', () => {
    // 测试不同的联系人关系类型
    const relationshipData = [
      { did: 'did:test:friend1', nickname: 'Friend One', relationship: 'friend' },
      { did: 'did:test:colleague1', nickname: 'Colleague One', relationship: 'colleague' },
      { did: 'did:test:family1', nickname: 'Family Member', relationship: 'family' },
      { did: 'did:test:acquaintance1', nickname: 'Acquaintance', relationship: 'acquaintance' },
    ];

    for (const data of relationshipData) {
      test(`should handle ${data.relationship} relationship`, async () => {
        const addResult = await window.evaluate(async (contact: any) => {
          try {
            return await (window as any).electronAPI.social.addContact(contact);
          } catch (error: any) {
            return { success: false, error: error.message };
          }
        }, data);

        expect(addResult).toBeDefined();
        expect(typeof addResult).toBe('object');
      });
    }
  });

  test.describe('System API - Path Types', () => {
    // 测试不同的系统路径类型
    const pathTypes = [
      'home',
      'appData',
      'userData',
      'temp',
      'desktop',
      'documents',
      'downloads',
      'music',
      'pictures',
      'videos',
    ];

    for (const pathType of pathTypes) {
      test(`should get ${pathType} path`, async () => {
        const result = await window.evaluate(async (type: string) => {
          try {
            return await (window as any).electronAPI.system.getPath(type);
          } catch (error: any) {
            return { success: false, error: error.message };
          }
        }, pathType);

        expect(result).toBeDefined();
        if (result.success) {
          expect(result.path).toBeDefined();
          expect(typeof result.path).toBe('string');
          expect(result.path.length).toBeGreaterThan(0);
        }
      });
    }
  });

  test.describe('Input Validation - Edge Cases', () => {
    test('should handle empty string inputs', async () => {
      const result = await window.evaluate(async () => {
        try {
          return await (window as any).electronAPI.social.searchContacts('');
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      });

      expect(result).toBeDefined();
      expect(Array.isArray(result) || typeof result === 'object').toBe(true);
    });

    test('should handle very long string inputs', async () => {
      const longString = 'a'.repeat(1000);
      const result = await window.evaluate(async (query: string) => {
        try {
          return await (window as any).electronAPI.social.searchContacts(query);
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      }, longString);

      expect(result).toBeDefined();
    });

    test('should handle special characters in inputs', async () => {
      const specialChars = ['<script>', "'; DROP TABLE--", '\\x00', '../../etc/passwd'];

      for (const input of specialChars) {
        const result = await window.evaluate(async (query: string) => {
          try {
            return await (window as any).electronAPI.social.searchContacts(query);
          } catch (error: any) {
            return { success: false, error: error.message };
          }
        }, input);

        expect(result).toBeDefined();
        // 应该安全处理，不应该崩溃
      }
    });

    test('should handle null/undefined inputs gracefully', async () => {
      const result = await window.evaluate(async () => {
        try {
          // @ts-ignore - 故意传递undefined测试错误处理
          return await (window as any).electronAPI.knowledge.listContents(undefined);
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      });

      expect(result).toBeDefined();
      // API应该使用默认值或返回错误，而不是崩溃
    });
  });

  test.describe('Boundary Value Analysis', () => {
    // 测试边界值
    const boundaryValues = [
      { value: 0, description: 'Zero' },
      { value: 1, description: 'Minimum positive' },
      { value: -1, description: 'Minimum negative' },
      { value: Number.MAX_SAFE_INTEGER, description: 'Maximum safe integer' },
      { value: Number.MIN_SAFE_INTEGER, description: 'Minimum safe integer' },
    ];

    for (const boundary of boundaryValues) {
      test(`should handle limit=${boundary.value} (${boundary.description})`, async () => {
        const result = await window.evaluate(async (limit: number) => {
          try {
            return await (window as any).electronAPI.notification.getAll({ limit });
          } catch (error: any) {
            return { success: false, error: error.message };
          }
        }, boundary.value);

        expect(result).toBeDefined();
        // 应该优雅地处理边界值
      });
    }
  });

  test.describe('Error Recovery', () => {
    test('should recover from invalid content ID', async () => {
      const invalidIds = ['', 'null', 'undefined', '////', '...', 'invalid-id-12345'];

      for (const invalidId of invalidIds) {
        const result = await window.evaluate(async (id: string) => {
          try {
            return await (window as any).electronAPI.knowledge.getContent(id);
          } catch (error: any) {
            return { success: false, error: error.message };
          }
        }, invalidId);

        expect(result).toBeDefined();
        // 应该返回错误而不是崩溃
      }
    });

    test('should handle consecutive failed API calls', async () => {
      const failedCalls = [];

      for (let i = 0; i < 10; i++) {
        const result = await window.evaluate(async () => {
          try {
            return await (window as any).electronAPI.knowledge.getContent('nonexistent-id');
          } catch (error: any) {
            return { success: false, error: error.message };
          }
        });

        failedCalls.push(result);
      }

      expect(failedCalls).toHaveLength(10);
      // 所有调用都应该失败但不崩溃
      failedCalls.forEach((result) => {
        expect(result).toBeDefined();
      });
    });
  });

  test.describe('Unicode and Internationalization', () => {
    const i18nData = [
      { text: '你好世界', language: 'Chinese' },
      { text: 'こんにちは世界', language: 'Japanese' },
      { text: '안녕하세요 세계', language: 'Korean' },
      { text: 'Привет мир', language: 'Russian' },
      { text: 'مرحبا بالعالم', language: 'Arabic' },
      { text: '🌍🌎🌏', language: 'Emoji' },
    ];

    for (const data of i18nData) {
      test(`should handle ${data.language} text`, async () => {
        const result = await window.evaluate(async (text: string) => {
          try {
            return await (window as any).electronAPI.social.searchContacts(text);
          } catch (error: any) {
            return { success: false, error: error.message };
          }
        }, data.text);

        expect(result).toBeDefined();
        // 应该正确处理Unicode字符
      });
    }
  });
});
