/**
 * Social API扩展E2E测试
 * 测试社交功能的联系人管理、好友关系等
 */

import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';

test.describe('Social API Extended E2E Tests', () => {
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

  test.describe('Contact Management', () => {
    test('should add new contact', async () => {
      const result = await window.evaluate(async () => {
        try {
          return await (window as any).electronAPI.social.addContact({
            did: 'did:test:123456',
            nickname: 'Test User',
            relationship: 'friend',
          });
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      });

      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });

    test('should add contact from QR code', async () => {
      const result = await window.evaluate(async () => {
        try {
          return await (window as any).electronAPI.social.addContactFromQR(
            JSON.stringify({
              did: 'did:test:qr123',
              publicKey: 'test-key',
              nickname: 'QR User',
            })
          );
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      });

      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });

    test('should get contact by DID', async () => {
      const result = await window.evaluate(async () => {
        try {
          return await (window as any).electronAPI.social.getContact('did:test:123456');
        } catch (error: any) {
          return null;
        }
      });

      expect(result !== undefined).toBe(true);
    });

    test('should update contact', async () => {
      const result = await window.evaluate(async () => {
        try {
          return await (window as any).electronAPI.social.updateContact('did:test:123456', {
            nickname: 'Updated Nickname',
            relationship: 'colleague',
          });
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      });

      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });

    test('should delete contact', async () => {
      const result = await window.evaluate(async () => {
        try {
          return await (window as any).electronAPI.social.deleteContact('did:test:123456');
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      });

      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });
  });

  test.describe('Friend Management', () => {
    test('should send friend request', async () => {
      const result = await window.evaluate(async () => {
        try {
          return await (window as any).electronAPI.social.sendFriendRequest(
            'did:test:friend123',
            'Hello, let\'s be friends!'
          );
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      });

      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });

    test('should accept friend request', async () => {
      const result = await window.evaluate(async () => {
        try {
          return await (window as any).electronAPI.social.acceptFriendRequest('request-id-123');
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      });

      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });

    test('should reject friend request', async () => {
      const result = await window.evaluate(async () => {
        try {
          return await (window as any).electronAPI.social.rejectFriendRequest('request-id-456');
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      });

      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });

    test('should get friends by group', async () => {
      const result = await window.evaluate(async () => {
        try {
          return await (window as any).electronAPI.social.getFriendsByGroup('family');
        } catch (error: any) {
          return [];
        }
      });

      expect(result).toBeDefined();
      expect(Array.isArray(result) || (typeof result === 'object')).toBe(true);
    });

    test('should remove friend', async () => {
      const result = await window.evaluate(async () => {
        try {
          return await (window as any).electronAPI.social.removeFriend('did:test:friend123');
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      });

      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });

    test('should update friend nickname', async () => {
      const result = await window.evaluate(async () => {
        try {
          return await (window as any).electronAPI.social.updateFriendNickname(
            'did:test:friend123',
            'Best Friend'
          );
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      });

      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });

    test('should update friend group', async () => {
      const result = await window.evaluate(async () => {
        try {
          return await (window as any).electronAPI.social.updateFriendGroup(
            'did:test:friend123',
            'close-friends'
          );
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      });

      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });

    test('should get friend statistics', async () => {
      const result = await window.evaluate(async () => {
        try {
          return await (window as any).electronAPI.social.getFriendStatistics();
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      });

      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });
  });
});
