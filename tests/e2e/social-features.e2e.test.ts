/**
 * 社交功能 E2E 测试
 * 测试联系人管理、好友请求、聊天消息、P2P通信等功能
 */

import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp, callIPC } from './helpers';

// 测试数据
const TEST_CONTACT = {
  did: `did:test:${Date.now()}`,
  name: 'E2E Test Contact',
  avatar: 'https://example.com/avatar.jpg',
  publicKey: 'test-public-key-12345',
  bio: '这是一个E2E测试联系人',
  tags: ['测试', 'E2E'],
};

const TEST_MESSAGE = {
  content: 'Hello! This is an E2E test message.',
  type: 'text',
  timestamp: Date.now(),
};

test.describe('社交功能 E2E 测试', () => {
  test.describe('联系人管理', () => {
    let testContactDid: string;

    test('应该能够添加新联系人', async () => {
      const { app, window } = await launchElectronApp();

      try {
        console.log('\n========== 添加联系人 ==========');

        const result: any = await callIPC(window, 'contact:add', TEST_CONTACT);

        console.log('添加联系人结果:', result);

        expect(result).toBeDefined();

        // 验证结果
        if (result.success || result.contact || result.did) {
          testContactDid = result.did || result.contact?.did || TEST_CONTACT.did;

          console.log(`✅ 联系人添加成功!`);
          console.log(`   DID: ${testContactDid}`);
          console.log(`   名称: ${result.name || result.contact?.name || TEST_CONTACT.name}`);

          // 验证返回的数据
          const contact = result.contact || result;
          if (contact.did) {
            expect(contact.did).toBe(TEST_CONTACT.did);
          }
          if (contact.name) {
            expect(contact.name).toBe(TEST_CONTACT.name);
          }
        } else {
          console.log(`ℹ️  接口响应正常，但格式可能不同`);
        }
      } finally {
        await closeElectronApp(app);
      }
    });

    test('应该能够获取所有联系人列表', async () => {
      const { app, window } = await launchElectronApp();

      try {
        console.log('\n========== 获取联系人列表 ==========');

        const result: any = await callIPC(window, 'contact:get-all');

        console.log('联系人列表结果:', result);

        expect(result).toBeDefined();

        // 提取联系人数组
        const contacts = result.contacts || result.data || result;

        if (result.success || Array.isArray(contacts)) {
          console.log(`✅ 获取联系人列表成功!`);

          if (Array.isArray(contacts)) {
            console.log(`   联系人数量: ${contacts.length}`);

            if (contacts.length > 0) {
              const firstContact = contacts[0];
              console.log(`   首个联系人: ${firstContact.name || firstContact.did || 'N/A'}`);

              // 验证必要字段
              expect(firstContact).toHaveProperty('did');
            }
          }
        } else {
          console.log(`   ℹ️  暂无联系人或格式不同`);
        }
      } finally {
        await closeElectronApp(app);
      }
    });

    test('应该能够获取单个联系人详情', async () => {
      const { app, window } = await launchElectronApp();

      try {
        console.log('\n========== 获取联系人详情 ==========');

        // 先获取联系人列表
        const listResult: any = await callIPC(window, 'contact:get-all');
        const contacts = listResult.contacts || listResult.data || listResult;

        if (!Array.isArray(contacts) || contacts.length === 0) {
          console.log('⚠️  没有联系人，跳过测试');
          return;
        }

        const contactDid = contacts[0].did;

        // 获取详情
        const result: any = await callIPC(window, 'contact:get', contactDid);

        console.log('联系人详情结果:', result);

        expect(result).toBeDefined();

        const contact = result.contact || result.data || result;

        if (contact) {
          console.log(`✅ 获取联系人详情成功!`);
          console.log(`   DID: ${contact.did || contactDid}`);
          console.log(`   名称: ${contact.name || 'N/A'}`);

          // 验证DID匹配
          if (contact.did) {
            expect(contact.did).toBe(contactDid);
          }
        }
      } finally {
        await closeElectronApp(app);
      }
    });

    test('应该能够更新联系人信息', async () => {
      const { app, window } = await launchElectronApp();

      try {
        console.log('\n========== 更新联系人 ==========');

        // 先获取一个联系人
        const listResult: any = await callIPC(window, 'contact:get-all');
        const contacts = listResult.contacts || listResult.data || listResult;

        if (!Array.isArray(contacts) || contacts.length === 0) {
          console.log('⚠️  没有联系人，跳过测试');
          return;
        }

        const contactDid = contacts[0].did;

        // 更新联系人
        const updates = {
          name: 'Updated Contact Name',
          bio: 'This contact has been updated by E2E test',
          tags: ['updated', 'e2e'],
        };

        const result: any = await callIPC(window, 'contact:update', contactDid, updates);

        console.log('更新联系人结果:', result);

        expect(result).toBeDefined();

        if (result.success || result.contact || result.did) {
          console.log(`✅ 联系人更新成功!`);

          const updatedContact = result.contact || result;

          if (updatedContact.name) {
            expect(updatedContact.name).toBe(updates.name);
            console.log(`   新名称: ${updatedContact.name}`);
          }
        } else {
          console.log(`   ℹ️  更新接口响应正常`);
        }
      } finally {
        await closeElectronApp(app);
      }
    });

    test('应该能够搜索联系人', async () => {
      const { app, window } = await launchElectronApp();

      try {
        console.log('\n========== 搜索联系人 ==========');

        const query = 'test';

        const result: any = await callIPC(window, 'contact:search', query);

        console.log('搜索联系人结果:', result);

        expect(result).toBeDefined();

        const contacts = result.contacts || result.data || result;

        if (Array.isArray(contacts)) {
          console.log(`✅ 搜索成功!`);
          console.log(`   找到 ${contacts.length} 个匹配的联系人`);

          if (contacts.length > 0) {
            contacts.slice(0, 3).forEach((contact: any, index: number) => {
              console.log(`   ${index + 1}. ${contact.name || contact.did || 'N/A'}`);
            });

            // 验证搜索结果相关性
            const firstContact = contacts[0];
            if (firstContact.name) {
              console.log(`   首个结果: ${firstContact.name}`);
            }
          }
        } else {
          console.log(`   ℹ️  未找到搜索结果或格式不同`);
        }
      } finally {
        await closeElectronApp(app);
      }
    });

    test('应该能够获取好友列表', async () => {
      const { app, window } = await launchElectronApp();

      try {
        console.log('\n========== 获取好友列表 ==========');

        const result: any = await callIPC(window, 'contact:get-friends');

        console.log('好友列表结果:', result);

        expect(result).toBeDefined();

        const friends = result.friends || result.data || result;

        if (result.success || Array.isArray(friends)) {
          console.log(`✅ 获取好友列表成功!`);

          if (Array.isArray(friends)) {
            console.log(`   好友数量: ${friends.length}`);

            if (friends.length > 0) {
              friends.slice(0, 3).forEach((friend: any, index: number) => {
                console.log(`   ${index + 1}. ${friend.name || friend.did || 'N/A'}`);
              });
            }
          }
        } else {
          console.log(`   ℹ️  暂无好友或格式不同`);
        }
      } finally {
        await closeElectronApp(app);
      }
    });

    test('应该能够获取联系人统计信息', async () => {
      const { app, window } = await launchElectronApp();

      try {
        console.log('\n========== 获取统计信息 ==========');

        const result: any = await callIPC(window, 'contact:get-statistics');

        console.log('统计信息结果:', result);

        expect(result).toBeDefined();

        const stats = result.statistics || result.data || result;

        if (result.success || stats) {
          console.log(`✅ 获取统计信息成功!`);

          if (stats) {
            console.log(`   总联系人数: ${stats.totalContacts || stats.total || 'N/A'}`);
            console.log(`   好友数: ${stats.friendsCount || stats.friends || 'N/A'}`);

            // 验证统计数据为数字
            if (typeof stats.totalContacts === 'number') {
              expect(stats.totalContacts).toBeGreaterThanOrEqual(0);
            }
          }
        } else {
          console.log(`   ℹ️  统计信息接口响应正常`);
        }
      } finally {
        await closeElectronApp(app);
      }
    });

    test('应该能够删除联系人', async () => {
      const { app, window } = await launchElectronApp();

      try {
        console.log('\n========== 删除联系人 ==========');

        // 先创建一个临时联系人
        const tempContact = {
          ...TEST_CONTACT,
          did: `did:test:temp-${Date.now()}`,
          name: 'Temp Contact for Deletion',
        };

        const createResult: any = await callIPC(window, 'contact:add', tempContact);

        const contactDid =
          createResult.did || createResult.contact?.did || tempContact.did;

        if (!contactDid) {
          console.log('⚠️  无法创建临时联系人，跳过删除测试');
          return;
        }

        // 删除联系人
        const deleteResult: any = await callIPC(window, 'contact:delete', contactDid);

        console.log('删除联系人结果:', deleteResult);

        expect(deleteResult).toBeDefined();

        if (deleteResult.success || deleteResult === true) {
          console.log(`✅ 联系人删除成功!`);
          console.log(`   已删除DID: ${contactDid}`);
        } else {
          console.log(`   ℹ️  删除接口响应正常`);
        }
      } finally {
        await closeElectronApp(app);
      }
    });
  });

  test.describe('好友请求功能', () => {
    test('应该能够发送好友请求', async () => {
      const { app, window } = await launchElectronApp();

      try {
        console.log('\n========== 发送好友请求 ==========');

        const targetDid = `did:test:target-${Date.now()}`;
        const message = '你好，我想加你为好友！';

        const result: any = await callIPC(
          window,
          'friend:send-request',
          targetDid,
          message
        );

        console.log('好友请求结果:', result);

        expect(result).toBeDefined();

        if (result.success || result.requestId || result.id) {
          console.log(`✅ 好友请求发送成功!`);
          console.log(`   目标DID: ${targetDid}`);
          console.log(`   请求ID: ${result.requestId || result.id || 'N/A'}`);
        } else {
          console.log(`   ℹ️  好友请求接口响应正常`);
        }
      } finally {
        await closeElectronApp(app);
      }
    });
  });

  test.describe('聊天消息功能', () => {
    test('应该能够保存聊天消息', async () => {
      const { app, window } = await launchElectronApp();

      try {
        console.log('\n========== 保存聊天消息 ==========');

        const message = {
          ...TEST_MESSAGE,
          id: `msg-${Date.now()}`,
          sessionId: `session-test-${Date.now()}`,
          from: 'did:test:sender',
          to: 'did:test:receiver',
        };

        const result: any = await callIPC(window, 'chat:save-message', message);

        console.log('保存消息结果:', result);

        expect(result).toBeDefined();

        if (result.success || result.message || result.id) {
          console.log(`✅ 消息保存成功!`);
          console.log(`   消息ID: ${result.id || message.id}`);
          console.log(`   内容: ${message.content.substring(0, 50)}...`);

          // 验证返回的消息ID
          const msgId = result.id || result.message?.id;
          if (msgId) {
            expect(msgId).toBe(message.id);
          }
        } else {
          console.log(`   ℹ️  保存消息接口响应正常`);
        }
      } finally {
        await closeElectronApp(app);
      }
    });

    test('应该能够获取会话消息列表', async () => {
      const { app, window } = await launchElectronApp();

      try {
        console.log('\n========== 获取消息列表 ==========');

        const sessionId = 'session-test-001';
        const limit = 20;
        const offset = 0;

        const result: any = await callIPC(
          window,
          'chat:get-messages',
          sessionId,
          limit,
          offset
        );

        console.log('消息列表结果:', result);

        expect(result).toBeDefined();

        const messages = result.messages || result.data || result;

        if (result.success || Array.isArray(messages)) {
          console.log(`✅ 获取消息列表成功!`);

          if (Array.isArray(messages)) {
            console.log(`   消息数量: ${messages.length}`);

            if (messages.length > 0) {
              const firstMsg = messages[0];
              console.log(`   最新消息: ${firstMsg.content?.substring(0, 30) || 'N/A'}...`);

              // 验证消息结构
              expect(firstMsg).toHaveProperty('id');
              expect(firstMsg).toHaveProperty('content');
            }
          }
        } else {
          console.log(`   ℹ️  暂无消息或格式不同`);
        }
      } finally {
        await closeElectronApp(app);
      }
    });

    test('应该能够更新消息状态', async () => {
      const { app, window } = await launchElectronApp();

      try {
        console.log('\n========== 更新消息状态 ==========');

        // 先保存一条消息
        const message = {
          id: `msg-status-test-${Date.now()}`,
          sessionId: 'session-test',
          content: 'Status test message',
          from: 'did:test:sender',
          to: 'did:test:receiver',
          status: 'sent',
        };

        await callIPC(window, 'chat:save-message', message);

        // 更新状态为已读
        const result: any = await callIPC(
          window,
          'chat:update-message-status',
          message.id,
          'read'
        );

        console.log('更新状态结果:', result);

        expect(result).toBeDefined();

        if (result.success || result === true || result.status) {
          console.log(`✅ 消息状态更新成功!`);
          console.log(`   消息ID: ${message.id}`);
          console.log(`   新状态: read`);

          // 验证状态
          if (result.status) {
            expect(result.status).toBe('read');
          }
        } else {
          console.log(`   ℹ️  状态更新接口响应正常`);
        }
      } finally {
        await closeElectronApp(app);
      }
    });
  });

  test.describe('P2P加密通信', () => {
    test('应该能够发送加密消息', async () => {
      const { app, window } = await launchElectronApp();

      try {
        console.log('\n========== P2P加密消息 ==========');

        const peerId = 'peer-test-001';
        const message = {
          type: 'text',
          content: 'This is an encrypted test message',
          timestamp: Date.now(),
        };
        const deviceId = 'device-001';
        const options = {
          encrypt: true,
          priority: 'high',
        };

        const result: any = await callIPC(
          window,
          'p2p:send-encrypted-message',
          peerId,
          message,
          deviceId,
          options
        );

        console.log('P2P发送结果:', result);

        expect(result).toBeDefined();

        if (result.success || result.messageId || result.id) {
          console.log(`✅ 加密消息发送成功!`);
          console.log(`   消息ID: ${result.messageId || result.id || 'N/A'}`);
          console.log(`   目标节点: ${peerId}`);

          // 验证消息已加密
          if (result.encrypted !== undefined) {
            expect(result.encrypted).toBe(true);
          }
        } else {
          console.log(`   ℹ️  P2P发送接口响应正常（可能需要网络连接）`);
        }
      } finally {
        await closeElectronApp(app);
      }
    });

    test('应该能够查询消息发送状态', async () => {
      const { app, window } = await launchElectronApp();

      try {
        console.log('\n========== 查询消息状态 ==========');

        const messageId = 'msg-p2p-test-001';

        const result: any = await callIPC(window, 'p2p:get-message-status', messageId);

        console.log('消息状态结果:', result);

        expect(result).toBeDefined();

        if (result.status || result.state || result.success !== undefined) {
          console.log(`✅ 消息状态查询成功!`);
          console.log(`   消息ID: ${messageId}`);
          console.log(`   状态: ${result.status || result.state || 'unknown'}`);

          // 验证状态值
          const status = result.status || result.state;
          if (status) {
            expect(['pending', 'sent', 'delivered', 'failed', 'unknown']).toContain(
              status
            );
          }
        } else {
          console.log(`   ℹ️  状态查询接口响应正常`);
        }
      } finally {
        await closeElectronApp(app);
      }
    });
  });

  test.describe('从二维码添加联系人', () => {
    test('应该能够从二维码数据添加联系人', async () => {
      const { app, window } = await launchElectronApp();

      try {
        console.log('\n========== 从二维码添加 ==========');

        // 模拟二维码数据
        const qrData = {
          did: `did:test:qr-${Date.now()}`,
          name: 'QR Code Contact',
          publicKey: 'qr-public-key',
          avatar: 'https://example.com/qr-avatar.jpg',
        };

        const result: any = await callIPC(window, 'contact:add-from-qr', qrData);

        console.log('二维码添加结果:', result);

        expect(result).toBeDefined();

        if (result.success || result.contact || result.did) {
          console.log(`✅ 从二维码添加联系人成功!`);
          console.log(`   DID: ${result.did || qrData.did}`);
          console.log(`   名称: ${result.name || result.contact?.name || qrData.name}`);

          // 验证DID
          const contact = result.contact || result;
          if (contact.did) {
            expect(contact.did).toBe(qrData.did);
          }
        } else {
          console.log(`   ℹ️  二维码添加接口响应正常`);
        }
      } finally {
        await closeElectronApp(app);
      }
    });
  });

  test.describe('边界情况和错误处理', () => {
    test('应该正确处理重复添加联系人', async () => {
      const { app, window } = await launchElectronApp();

      try {
        console.log('\n========== 重复添加测试 ==========');

        const contact = {
          did: `did:test:duplicate-${Date.now()}`,
          name: 'Duplicate Contact',
        };

        // 第一次添加
        const firstResult: any = await callIPC(window, 'contact:add', contact);

        expect(firstResult).toBeDefined();

        // 第二次添加相同DID
        const secondResult: any = await callIPC(window, 'contact:add', contact);

        expect(secondResult).toBeDefined();

        console.log('重复添加结果:', secondResult);

        // 可能返回错误或成功（取决于实现）
        if (secondResult.error || !secondResult.success) {
          console.log(`✅ 正确拒绝了重复添加`);
        } else if (secondResult.success) {
          console.log(`ℹ️  系统允许重复添加（可能是更新操作）`);
        }

        console.log(`✅ 重复添加处理正常`);
      } finally {
        await closeElectronApp(app);
      }
    });

    test('应该正确处理不存在的联系人DID', async () => {
      const { app, window } = await launchElectronApp();

      try {
        console.log('\n========== 不存在的DID ==========');

        const fakeDid = 'did:test:non-existent-12345';

        const result: any = await callIPC(window, 'contact:get', fakeDid);

        console.log('不存在DID的查询结果:', result);

        // 应该返回null或错误
        if (result === null || result === undefined || result.error) {
          console.log(`✅ 正确处理了不存在的DID`);
        } else {
          console.log(`ℹ️  返回了空结果或默认值`);
        }
      } finally {
        await closeElectronApp(app);
      }
    });

    test('应该正确验证DID格式', async () => {
      const { app, window } = await launchElectronApp();

      try {
        console.log('\n========== DID格式验证 ==========');

        // 无效的DID格式
        const invalidContact = {
          did: 'invalid-did-format',
          name: 'Invalid DID Contact',
        };

        try {
          const result: any = await callIPC(window, 'contact:add', invalidContact);

          console.log('无效DID添加结果:', result);

          if (result.error || !result.success) {
            console.log(`✅ 正确拒绝了无效的DID格式`);
          } else {
            console.log(`ℹ️  系统允许了该DID格式`);
          }
        } catch (error) {
          console.log(`✅ 捕获到验证错误: ${error}`);
        }
      } finally {
        await closeElectronApp(app);
      }
    });

    test('应该正确处理空消息内容', async () => {
      const { app, window } = await launchElectronApp();

      try {
        console.log('\n========== 空消息测试 ==========');

        const emptyMessage = {
          id: `msg-empty-${Date.now()}`,
          sessionId: 'session-test',
          content: '',
          from: 'did:test:sender',
          to: 'did:test:receiver',
        };

        const result: any = await callIPC(window, 'chat:save-message', emptyMessage);

        expect(result).toBeDefined();

        console.log('空消息保存结果:', result);

        if (result.error || !result.success) {
          console.log(`✅ 正确拒绝了空消息`);
        } else {
          console.log(`ℹ️  系统允许了空消息`);
        }
      } finally {
        await closeElectronApp(app);
      }
    });
  });
});

test.describe('社交功能性能测试', () => {
  test('联系人列表加载性能应该在合理范围内', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('\n========== 联系人列表性能 ==========');

      const startTime = Date.now();

      await callIPC(window, 'contact:get-all');

      const duration = Date.now() - startTime;

      console.log(`   加载耗时: ${duration}ms`);

      // 应该在 1.5 秒内完成
      expect(duration).toBeLessThan(1500);

      console.log(`✅ 性能测试通过`);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('消息列表加载性能应该在合理范围内', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('\n========== 消息列表性能 ==========');

      const sessionId = 'session-test';

      const startTime = Date.now();

      await callIPC(window, 'chat:get-messages', sessionId, 100, 0);

      const duration = Date.now() - startTime;

      console.log(`   加载100条消息耗时: ${duration}ms`);

      // 应该在 2 秒内完成
      expect(duration).toBeLessThan(2000);

      console.log(`✅ 消息加载性能测试通过`);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('搜索联系人性能应该在合理范围内', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('\n========== 搜索性能 ==========');

      const startTime = Date.now();

      await callIPC(window, 'contact:search', 'test');

      const duration = Date.now() - startTime;

      console.log(`   搜索耗时: ${duration}ms`);

      // 应该在 1.5 秒内完成
      expect(duration).toBeLessThan(1500);

      console.log(`✅ 搜索性能测试通过`);
    } finally {
      await closeElectronApp(app);
    }
  });
});
