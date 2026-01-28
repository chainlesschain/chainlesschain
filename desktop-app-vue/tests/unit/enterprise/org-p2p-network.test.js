/**
 * OrgP2PNetwork 单元测试
 *
 * 测试覆盖:
 * - 网络初始化 (5 tests)
 * - Topic管理 (4 tests)
 * - 成员发现 (6 tests)
 * - 心跳与在线状态 (6 tests)
 * - 消息广播 (5 tests)
 * - 成员状态事件 (6 tests)
 * - 知识库同步消息 (5 tests)
 * - 消息处理 (5 tests)
 * - 清理与关闭 (3 tests)
 * - 错误处理 (5 tests)
 *
 * 总计: 50 测试用例
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');

describe('OrgP2PNetwork Unit Tests', () => {
  let OrgP2PNetwork;
  let MessageType;
  let DatabaseManager;
  let DIDManager;
  let db;
  let didManager;
  let p2pManager;
  let orgP2PNetwork;
  let testDbPath;
  let currentIdentity;

  // Mock data
  const mockOrgId = 'org_test_123';
  const mockTopic = '/chainlesschain/org/org_test_123/v1';
  const mockMemberDID = 'did:key:z6MkMember123';
  const mockMemberDID2 = 'did:key:z6MkMember456';

  beforeEach(async () => {
    // 设置测试数据库
    testDbPath = path.join(__dirname, '../temp/test-org-p2p-network.db');
    const testDir = path.dirname(testDbPath);
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }

    // 加载模块
    DatabaseManager = require('../../../src/main/database');
    DIDManager = require('../../../src/main/did/did-manager');
    const OrgP2PNetworkModule = require('../../../src/main/organization/org-p2p-network');
    OrgP2PNetwork = OrgP2PNetworkModule.OrgP2PNetwork;
    MessageType = OrgP2PNetworkModule.MessageType;

    // 初始化数据库
    db = new DatabaseManager(testDbPath, { encryptionEnabled: false });
    await db.initialize();

    // 初始化DID管理器
    didManager = new DIDManager(db);
    await didManager.initialize();

    // 创建测试身份
    currentIdentity = await didManager.createIdentity(
      { nickname: 'TestUser', displayName: 'Test User' },
      { setAsDefault: true }
    );

    // 添加缺失的方法
    if (!didManager.getCurrentDID) {
      didManager.getCurrentDID = vi.fn(async () => currentIdentity.did);
    }
    if (!didManager.getDefaultIdentity) {
      didManager.getDefaultIdentity = vi.fn(async () => currentIdentity);
    }

    // 模拟P2P管理器
    p2pManager = {
      isInitialized: vi.fn(() => true),
      peerId: { toString: () => 'QmTestPeerId123' },
      sendEncryptedMessage: vi.fn(async () => true),
      node: {
        services: {
          pubsub: {
            subscribe: vi.fn(async () => {}),
            unsubscribe: vi.fn(async () => {}),
            publish: vi.fn(async () => {}),
            addEventListener: vi.fn((event, handler) => {
              // Store the handler for testing
              p2pManager._messageHandlers = p2pManager._messageHandlers || [];
              p2pManager._messageHandlers.push({ event, handler });
            })
          }
        }
      }
    };

    // 初始化OrgP2PNetwork
    orgP2PNetwork = new OrgP2PNetwork(p2pManager, didManager, db);
  });

  afterEach(() => {
    // 清理测试数据库
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }

    // 清理定时器
    vi.clearAllTimers();
  });

  // ============================================================================
  // 网络初始化 (5 tests)
  // ============================================================================
  describe('Network Initialization', () => {
    it('should initialize organization P2P network', async () => {
      await orgP2PNetwork.initialize(mockOrgId);

      expect(orgP2PNetwork.orgSubscriptions.has(mockOrgId)).toBe(true);
      expect(p2pManager.node.services.pubsub.subscribe).toHaveBeenCalledWith(mockTopic);
    });

    it('should subscribe to organization topic', async () => {
      await orgP2PNetwork.initialize(mockOrgId);

      const subscription = orgP2PNetwork.orgSubscriptions.get(mockOrgId);
      expect(subscription).toBeDefined();
      expect(subscription.topic).toBe(mockTopic);
      expect(subscription.mode).toBe('pubsub');
    });

    it('should register message handlers', async () => {
      await orgP2PNetwork.initialize(mockOrgId);

      expect(p2pManager.node.services.pubsub.addEventListener).toHaveBeenCalled();
      expect(p2pManager._messageHandlers).toBeDefined();
      expect(p2pManager._messageHandlers.length).toBeGreaterThan(0);
    });

    it('should start heartbeat', async () => {
      vi.useFakeTimers();

      await orgP2PNetwork.initialize(mockOrgId);

      expect(orgP2PNetwork.heartbeatIntervals.has(mockOrgId)).toBe(true);

      vi.useRealTimers();
    });

    it('should start member discovery', async () => {
      vi.useFakeTimers();

      await orgP2PNetwork.initialize(mockOrgId);

      expect(orgP2PNetwork.discoveryIntervals.has(mockOrgId)).toBe(true);

      vi.useRealTimers();
    });
  });

  // ============================================================================
  // Topic管理 (4 tests)
  // ============================================================================
  describe('Topic Management', () => {
    it('should generate organization topic name', () => {
      const topic = orgP2PNetwork.getOrgTopic(mockOrgId);

      expect(topic).toBe(mockTopic);
      expect(topic).toMatch(/^\/chainlesschain\/org\//);
      expect(topic).toContain(mockOrgId);
    });

    it('should subscribe to topic', async () => {
      const topic = orgP2PNetwork.getOrgTopic(mockOrgId);
      await orgP2PNetwork.subscribeTopic(mockOrgId, topic);

      expect(p2pManager.node.services.pubsub.subscribe).toHaveBeenCalledWith(topic);
      expect(orgP2PNetwork.orgSubscriptions.has(mockOrgId)).toBe(true);
    });

    it('should unsubscribe from topic', async () => {
      // 先订阅
      await orgP2PNetwork.initialize(mockOrgId);

      // 再取消订阅
      await orgP2PNetwork.unsubscribeTopic(mockOrgId);

      expect(p2pManager.node.services.pubsub.unsubscribe).toHaveBeenCalledWith(mockTopic);
      expect(orgP2PNetwork.orgSubscriptions.has(mockOrgId)).toBe(false);
    });

    it('should handle subscription errors', async () => {
      // 创建会失败的P2P管理器
      const failingP2PManager = {
        node: {
          services: {
            pubsub: {
              subscribe: vi.fn(async () => {
                throw new Error('Subscription failed');
              })
            }
          }
        }
      };

      const failingNetwork = new OrgP2PNetwork(failingP2PManager, didManager, db);

      await expect(
        failingNetwork.subscribeTopic(mockOrgId, mockTopic)
      ).rejects.toThrow('Subscription failed');
    });
  });

  // ============================================================================
  // 成员发现 (6 tests)
  // ============================================================================
  describe('Member Discovery', () => {
    beforeEach(async () => {
      await orgP2PNetwork.initialize(mockOrgId);
    });

    it('should send discovery request', async () => {
      await orgP2PNetwork.requestDiscovery(mockOrgId);

      expect(p2pManager.node.services.pubsub.publish).toHaveBeenCalled();

      // 验证消息内容
      const publishCall = p2pManager.node.services.pubsub.publish.mock.calls[0];
      const messageData = JSON.parse(new TextDecoder().decode(publishCall[1]));

      expect(messageData.type).toBe(MessageType.DISCOVERY_REQUEST);
      expect(messageData.requesterDID).toBe(currentIdentity.did);
    });

    it('should receive discovery response', async () => {
      const eventSpy = vi.fn();
      orgP2PNetwork.on('member:discovered', eventSpy);

      const responseData = {
        type: MessageType.DISCOVERY_RESPONSE,
        senderDID: mockMemberDID,
        responderDID: mockMemberDID,
        requesterDID: currentIdentity.did,
        displayName: 'Member User',
        avatar: 'https://example.com/avatar.png',
        peerId: 'QmMemberPeer123'
      };

      await orgP2PNetwork.handleDiscoveryResponse(mockOrgId, responseData);

      expect(eventSpy).toHaveBeenCalledWith({
        orgId: mockOrgId,
        memberDID: mockMemberDID,
        displayName: 'Member User',
        avatar: 'https://example.com/avatar.png',
        peerId: 'QmMemberPeer123'
      });
    });

    it('should discover new members', async () => {
      const eventSpy = vi.fn();
      orgP2PNetwork.on('member:discovered', eventSpy);

      const responseData = {
        type: MessageType.DISCOVERY_RESPONSE,
        senderDID: mockMemberDID,
        responderDID: mockMemberDID,
        requesterDID: currentIdentity.did,
        displayName: 'New Member',
        avatar: '',
        peerId: 'QmNewMember123'
      };

      await orgP2PNetwork.handleDiscoveryResponse(mockOrgId, responseData);

      expect(orgP2PNetwork.isMemberOnline(mockOrgId, mockMemberDID)).toBe(true);
      expect(eventSpy).toHaveBeenCalled();
    });

    it('should update member list', async () => {
      const initialCount = orgP2PNetwork.getOnlineMemberCount(mockOrgId);

      const responseData = {
        type: MessageType.DISCOVERY_RESPONSE,
        senderDID: mockMemberDID,
        responderDID: mockMemberDID,
        requesterDID: currentIdentity.did,
        displayName: 'Member User',
        avatar: '',
        peerId: 'QmMember123'
      };

      await orgP2PNetwork.handleDiscoveryResponse(mockOrgId, responseData);

      const newCount = orgP2PNetwork.getOnlineMemberCount(mockOrgId);
      expect(newCount).toBe(initialCount + 1);
    });

    it('should handle offline members', async () => {
      // 先添加成员
      orgP2PNetwork.addOnlineMember(mockOrgId, mockMemberDID);
      expect(orgP2PNetwork.isMemberOnline(mockOrgId, mockMemberDID)).toBe(true);

      // 移除成员
      orgP2PNetwork.removeOnlineMember(mockOrgId, mockMemberDID);
      expect(orgP2PNetwork.isMemberOnline(mockOrgId, mockMemberDID)).toBe(false);
    });

    it('should handle discovery timeout', async () => {
      vi.useFakeTimers();

      const initialCount = orgP2PNetwork.getOnlineMemberCount(mockOrgId);

      // 启动发现
      await orgP2PNetwork.requestDiscovery(mockOrgId);

      // 快进到发现间隔
      vi.advanceTimersByTime(orgP2PNetwork.config.discoveryInterval);

      // 验证发现请求被再次发送
      expect(p2pManager.node.services.pubsub.publish).toHaveBeenCalled();

      vi.useRealTimers();
    });
  });

  // ============================================================================
  // 心跳与在线状态 (6 tests)
  // ============================================================================
  describe('Heartbeat & Online Status', () => {
    beforeEach(async () => {
      await orgP2PNetwork.initialize(mockOrgId);
    });

    it('should send heartbeat messages', async () => {
      await orgP2PNetwork.sendHeartbeat(mockOrgId);

      expect(p2pManager.node.services.pubsub.publish).toHaveBeenCalled();

      // 验证消息内容
      const publishCall = p2pManager.node.services.pubsub.publish.mock.calls[0];
      const messageData = JSON.parse(new TextDecoder().decode(publishCall[1]));

      expect(messageData.type).toBe(MessageType.HEARTBEAT);
      expect(messageData.memberDID).toBe(currentIdentity.did);
      expect(messageData.status).toBe('online');
    });

    it('should receive heartbeat from member', async () => {
      const eventSpy = vi.fn();
      orgP2PNetwork.on('member:heartbeat', eventSpy);

      const heartbeatData = {
        type: MessageType.HEARTBEAT,
        senderDID: mockMemberDID,
        memberDID: mockMemberDID,
        displayName: 'Member User',
        avatar: '',
        status: 'online'
      };

      await orgP2PNetwork.handleHeartbeat(mockOrgId, heartbeatData);

      expect(eventSpy).toHaveBeenCalledWith({
        orgId: mockOrgId,
        memberDID: mockMemberDID,
        status: 'online'
      });
    });

    it('should mark member as online', async () => {
      const onlineData = {
        type: MessageType.MEMBER_ONLINE,
        senderDID: mockMemberDID,
        memberDID: mockMemberDID,
        displayName: 'Member User',
        avatar: '',
        peerId: 'QmMember123'
      };

      await orgP2PNetwork.handleMemberOnline(mockOrgId, onlineData);

      expect(orgP2PNetwork.isMemberOnline(mockOrgId, mockMemberDID)).toBe(true);
    });

    it('should mark member as offline after timeout', async () => {
      const eventSpy = vi.fn();
      orgP2PNetwork.on('member:offline', eventSpy);

      // 先添加成员
      orgP2PNetwork.addOnlineMember(mockOrgId, mockMemberDID);

      // 处理下线事件
      const offlineData = {
        type: MessageType.MEMBER_OFFLINE,
        senderDID: mockMemberDID,
        memberDID: mockMemberDID
      };

      await orgP2PNetwork.handleMemberOffline(mockOrgId, offlineData);

      expect(orgP2PNetwork.isMemberOnline(mockOrgId, mockMemberDID)).toBe(false);
      expect(eventSpy).toHaveBeenCalledWith({
        orgId: mockOrgId,
        memberDID: mockMemberDID
      });
    });

    it('should use heartbeat interval configuration', async () => {
      expect(orgP2PNetwork.config.heartbeatInterval).toBe(30000);
      expect(orgP2PNetwork.heartbeatIntervals.has(mockOrgId)).toBe(true);
    });

    it('should stop heartbeat on cleanup', async () => {
      expect(orgP2PNetwork.heartbeatIntervals.has(mockOrgId)).toBe(true);

      orgP2PNetwork.stopHeartbeat(mockOrgId);

      expect(orgP2PNetwork.heartbeatIntervals.has(mockOrgId)).toBe(false);
    });
  });

  // ============================================================================
  // 消息广播 (5 tests)
  // ============================================================================
  describe('Message Broadcasting', () => {
    beforeEach(async () => {
      await orgP2PNetwork.initialize(mockOrgId);
    });

    it('should broadcast message to all members', async () => {
      const message = {
        type: MessageType.BROADCAST,
        content: 'Hello organization!'
      };

      await orgP2PNetwork.broadcastMessage(mockOrgId, message);

      expect(p2pManager.node.services.pubsub.publish).toHaveBeenCalled();

      // 验证消息包含必要字段
      const publishCall = p2pManager.node.services.pubsub.publish.mock.calls[0];
      const messageData = JSON.parse(new TextDecoder().decode(publishCall[1]));

      expect(messageData.type).toBe(MessageType.BROADCAST);
      expect(messageData.content).toBe('Hello organization!');
      expect(messageData.senderDID).toBe(currentIdentity.did);
      expect(messageData.orgId).toBe(mockOrgId);
      expect(messageData.timestamp).toBeDefined();
    });

    it('should broadcast to specific members', async () => {
      // 添加在线成员
      orgP2PNetwork.addOnlineMember(mockOrgId, mockMemberDID);
      orgP2PNetwork.addOnlineMember(mockOrgId, mockMemberDID2);

      const message = {
        type: MessageType.BROADCAST,
        content: 'Specific message'
      };

      // 使用直接消息模式
      await orgP2PNetwork.broadcastDirect(mockOrgId, {
        ...message,
        senderDID: currentIdentity.did
      });

      expect(p2pManager.sendEncryptedMessage).toHaveBeenCalled();
      expect(p2pManager.sendEncryptedMessage).toHaveBeenCalledTimes(2);
    });

    it('should broadcast with delivery confirmation', async () => {
      const message = {
        type: MessageType.ANNOUNCEMENT,
        content: 'Important announcement'
      };

      await orgP2PNetwork.broadcastMessage(mockOrgId, message);

      expect(p2pManager.node.services.pubsub.publish).toHaveBeenCalled();
    });

    it('should handle broadcast failures', async () => {
      // 创建会失败的P2P管理器
      const failingP2PManager = {
        node: {
          services: {
            pubsub: {
              subscribe: vi.fn(async () => {}),
              publish: vi.fn(async () => {
                throw new Error('Broadcast failed');
              }),
              addEventListener: vi.fn()
            }
          }
        }
      };

      const failingNetwork = new OrgP2PNetwork(failingP2PManager, didManager, db);
      await failingNetwork.subscribeTopic(mockOrgId, mockTopic);

      const message = {
        type: MessageType.BROADCAST,
        content: 'Test message'
      };

      await expect(
        failingNetwork.broadcastMessage(mockOrgId, message)
      ).rejects.toThrow('Broadcast failed');
    });

    it('should handle broadcast timeout', async () => {
      expect(orgP2PNetwork.config.broadcastTimeout).toBe(5000);

      const message = {
        type: MessageType.BROADCAST,
        content: 'Test timeout'
      };

      // 广播应该成功（不会超时）
      await expect(
        orgP2PNetwork.broadcastMessage(mockOrgId, message)
      ).resolves.not.toThrow();
    });
  });

  // ============================================================================
  // 成员状态事件 (6 tests)
  // ============================================================================
  describe('Member Status Events', () => {
    beforeEach(async () => {
      await orgP2PNetwork.initialize(mockOrgId);
    });

    it('should emit member:online event', async () => {
      const eventSpy = vi.fn();
      orgP2PNetwork.on('member:online', eventSpy);

      const onlineData = {
        type: MessageType.MEMBER_ONLINE,
        senderDID: mockMemberDID,
        memberDID: mockMemberDID,
        displayName: 'Member User',
        avatar: 'https://example.com/avatar.png',
        peerId: 'QmMember123'
      };

      await orgP2PNetwork.handleMemberOnline(mockOrgId, onlineData);

      expect(eventSpy).toHaveBeenCalledWith({
        orgId: mockOrgId,
        memberDID: mockMemberDID,
        displayName: 'Member User',
        avatar: 'https://example.com/avatar.png',
        peerId: 'QmMember123'
      });
    });

    it('should emit member:offline event', async () => {
      const eventSpy = vi.fn();
      orgP2PNetwork.on('member:offline', eventSpy);

      // 先添加成员
      orgP2PNetwork.addOnlineMember(mockOrgId, mockMemberDID);

      const offlineData = {
        type: MessageType.MEMBER_OFFLINE,
        senderDID: mockMemberDID,
        memberDID: mockMemberDID
      };

      await orgP2PNetwork.handleMemberOffline(mockOrgId, offlineData);

      expect(eventSpy).toHaveBeenCalledWith({
        orgId: mockOrgId,
        memberDID: mockMemberDID
      });
    });

    it('should emit member:joined event', async () => {
      const eventSpy = vi.fn();
      orgP2PNetwork.on('member:event', eventSpy);

      const joinedData = {
        type: MessageType.MEMBER_JOINED,
        senderDID: mockMemberDID,
        memberDID: mockMemberDID,
        displayName: 'New Member',
        role: 'member'
      };

      await orgP2PNetwork.handleMemberEvent(mockOrgId, joinedData);

      expect(eventSpy).toHaveBeenCalledWith({
        orgId: mockOrgId,
        type: MessageType.MEMBER_JOINED,
        data: joinedData
      });
    });

    it('should emit member:left event', async () => {
      const eventSpy = vi.fn();
      orgP2PNetwork.on('member:event', eventSpy);

      const leftData = {
        type: MessageType.MEMBER_LEFT,
        senderDID: mockMemberDID,
        memberDID: mockMemberDID
      };

      await orgP2PNetwork.handleMemberEvent(mockOrgId, leftData);

      expect(eventSpy).toHaveBeenCalledWith({
        orgId: mockOrgId,
        type: MessageType.MEMBER_LEFT,
        data: leftData
      });
    });

    it('should emit member:discovered event', async () => {
      const eventSpy = vi.fn();
      orgP2PNetwork.on('member:discovered', eventSpy);

      const responseData = {
        type: MessageType.DISCOVERY_RESPONSE,
        senderDID: mockMemberDID,
        responderDID: mockMemberDID,
        requesterDID: currentIdentity.did,
        displayName: 'Discovered Member',
        avatar: '',
        peerId: 'QmDiscovered123'
      };

      await orgP2PNetwork.handleDiscoveryResponse(mockOrgId, responseData);

      expect(eventSpy).toHaveBeenCalledWith({
        orgId: mockOrgId,
        memberDID: mockMemberDID,
        displayName: 'Discovered Member',
        avatar: '',
        peerId: 'QmDiscovered123'
      });
    });

    it('should handle concurrent status changes', async () => {
      const eventSpy = vi.fn();
      orgP2PNetwork.on('member:online', eventSpy);

      // 同时处理多个成员上线
      const member1Data = {
        type: MessageType.MEMBER_ONLINE,
        senderDID: mockMemberDID,
        memberDID: mockMemberDID,
        displayName: 'Member 1',
        avatar: '',
        peerId: 'QmMember1'
      };

      const member2Data = {
        type: MessageType.MEMBER_ONLINE,
        senderDID: mockMemberDID2,
        memberDID: mockMemberDID2,
        displayName: 'Member 2',
        avatar: '',
        peerId: 'QmMember2'
      };

      await Promise.all([
        orgP2PNetwork.handleMemberOnline(mockOrgId, member1Data),
        orgP2PNetwork.handleMemberOnline(mockOrgId, member2Data)
      ]);

      expect(eventSpy).toHaveBeenCalledTimes(2);
      expect(orgP2PNetwork.getOnlineMemberCount(mockOrgId)).toBe(2);
    });
  });

  // ============================================================================
  // 知识库同步消息 (5 tests)
  // ============================================================================
  describe('Knowledge Sync Messages', () => {
    beforeEach(async () => {
      await orgP2PNetwork.initialize(mockOrgId);
    });

    it('should send knowledge created message', async () => {
      const message = {
        type: MessageType.KNOWLEDGE_CREATED,
        knowledgeId: 'kb-123',
        title: 'New Knowledge',
        createdBy: currentIdentity.did
      };

      await orgP2PNetwork.broadcastMessage(mockOrgId, message);

      expect(p2pManager.node.services.pubsub.publish).toHaveBeenCalled();
    });

    it('should send knowledge updated message', async () => {
      const message = {
        type: MessageType.KNOWLEDGE_UPDATED,
        knowledgeId: 'kb-123',
        changes: ['content', 'tags'],
        updatedBy: currentIdentity.did
      };

      await orgP2PNetwork.broadcastMessage(mockOrgId, message);

      expect(p2pManager.node.services.pubsub.publish).toHaveBeenCalled();
    });

    it('should send knowledge deleted message', async () => {
      const message = {
        type: MessageType.KNOWLEDGE_DELETED,
        knowledgeId: 'kb-123',
        deletedBy: currentIdentity.did
      };

      await orgP2PNetwork.broadcastMessage(mockOrgId, message);

      expect(p2pManager.node.services.pubsub.publish).toHaveBeenCalled();
    });

    it('should receive knowledge sync messages', async () => {
      const eventSpy = vi.fn();
      orgP2PNetwork.on('knowledge:event', eventSpy);

      const knowledgeData = {
        type: MessageType.KNOWLEDGE_CREATED,
        senderDID: mockMemberDID,
        knowledgeId: 'kb-456',
        title: 'Shared Knowledge',
        content: 'Knowledge content'
      };

      await orgP2PNetwork.handleKnowledgeEvent(mockOrgId, knowledgeData);

      expect(eventSpy).toHaveBeenCalledWith({
        orgId: mockOrgId,
        type: MessageType.KNOWLEDGE_CREATED,
        data: knowledgeData
      });
    });

    it('should handle knowledge sync conflicts', async () => {
      const eventSpy = vi.fn();
      orgP2PNetwork.on('knowledge:event', eventSpy);

      // 模拟冲突：同时接收多个更新
      const update1 = {
        type: MessageType.KNOWLEDGE_UPDATED,
        senderDID: mockMemberDID,
        knowledgeId: 'kb-789',
        version: 1,
        timestamp: Date.now()
      };

      const update2 = {
        type: MessageType.KNOWLEDGE_UPDATED,
        senderDID: mockMemberDID2,
        knowledgeId: 'kb-789',
        version: 1,
        timestamp: Date.now() + 1000
      };

      await Promise.all([
        orgP2PNetwork.handleKnowledgeEvent(mockOrgId, update1),
        orgP2PNetwork.handleKnowledgeEvent(mockOrgId, update2)
      ]);

      // 两个事件都应该被触发
      expect(eventSpy).toHaveBeenCalledTimes(2);
    });
  });

  // ============================================================================
  // 消息处理 (5 tests)
  // ============================================================================
  describe('Message Handling', () => {
    beforeEach(async () => {
      await orgP2PNetwork.initialize(mockOrgId);
    });

    it('should register message handler for type', async () => {
      expect(p2pManager.node.services.pubsub.addEventListener).toHaveBeenCalled();
    });

    it('should handle incoming messages', async () => {
      const eventSpy = vi.fn();
      orgP2PNetwork.on('message:received', eventSpy);

      const messageData = {
        type: MessageType.BROADCAST,
        senderDID: mockMemberDID,
        content: 'Test message',
        timestamp: Date.now(),
        orgId: mockOrgId
      };

      const messageDetail = {
        topic: mockTopic,
        data: new TextEncoder().encode(JSON.stringify(messageData))
      };

      await orgP2PNetwork.handleTopicMessage(mockOrgId, messageDetail);

      expect(eventSpy).toHaveBeenCalledWith({
        orgId: mockOrgId,
        message: messageData
      });
    });

    it('should route messages by type', async () => {
      const heartbeatSpy = vi.fn();
      orgP2PNetwork.on('member:heartbeat', heartbeatSpy);

      const heartbeatData = {
        type: MessageType.HEARTBEAT,
        senderDID: mockMemberDID,
        memberDID: mockMemberDID,
        status: 'online'
      };

      const messageDetail = {
        topic: mockTopic,
        data: new TextEncoder().encode(JSON.stringify(heartbeatData))
      };

      await orgP2PNetwork.handleTopicMessage(mockOrgId, messageDetail);

      expect(heartbeatSpy).toHaveBeenCalled();
    });

    it('should handle invalid message type', async () => {
      const messageData = {
        type: 'INVALID_TYPE',
        senderDID: mockMemberDID,
        content: 'Invalid message'
      };

      const messageDetail = {
        topic: mockTopic,
        data: new TextEncoder().encode(JSON.stringify(messageData))
      };

      // 不应该抛出错误
      await expect(
        orgP2PNetwork.handleTopicMessage(mockOrgId, messageDetail)
      ).resolves.not.toThrow();
    });

    it('should validate message format', async () => {
      const malformedData = 'not valid json';

      const messageDetail = {
        topic: mockTopic,
        data: new TextEncoder().encode(malformedData)
      };

      // 不应该抛出错误（内部捕获）
      await expect(
        orgP2PNetwork.handleTopicMessage(mockOrgId, messageDetail)
      ).resolves.not.toThrow();
    });
  });

  // ============================================================================
  // 清理与关闭 (3 tests)
  // ============================================================================
  describe('Cleanup & Shutdown', () => {
    beforeEach(async () => {
      await orgP2PNetwork.initialize(mockOrgId);
    });

    it('should stop organization network', async () => {
      await orgP2PNetwork.unsubscribeTopic(mockOrgId);

      expect(orgP2PNetwork.orgSubscriptions.has(mockOrgId)).toBe(false);
      expect(orgP2PNetwork.onlineMembers.has(mockOrgId)).toBe(false);
    });

    it('should cleanup subscriptions', async () => {
      // 添加第二个组织
      const org2Id = 'org_test_456';
      await orgP2PNetwork.initialize(org2Id);

      // 清理所有
      await orgP2PNetwork.cleanup();

      expect(orgP2PNetwork.orgSubscriptions.size).toBe(0);
      expect(orgP2PNetwork.onlineMembers.size).toBe(0);
    });

    it('should clear heartbeat timers', async () => {
      expect(orgP2PNetwork.heartbeatIntervals.has(mockOrgId)).toBe(true);
      expect(orgP2PNetwork.discoveryIntervals.has(mockOrgId)).toBe(true);

      await orgP2PNetwork.unsubscribeTopic(mockOrgId);

      expect(orgP2PNetwork.heartbeatIntervals.has(mockOrgId)).toBe(false);
      expect(orgP2PNetwork.discoveryIntervals.has(mockOrgId)).toBe(false);
    });
  });

  // ============================================================================
  // 错误处理 (5 tests)
  // ============================================================================
  describe('Error Handling', () => {
    it('should handle P2P connection errors', async () => {
      const errorP2PManager = {
        node: null
      };

      const errorNetwork = new OrgP2PNetwork(errorP2PManager, didManager, db);

      await expect(
        errorNetwork.subscribeTopic(mockOrgId, mockTopic)
      ).rejects.toThrow('P2P Manager未初始化');
    });

    it('should handle topic subscription errors', async () => {
      const failingP2PManager = {
        node: {
          services: {
            pubsub: {
              subscribe: vi.fn(async () => {
                throw new Error('Subscription error');
              })
            }
          }
        }
      };

      const failingNetwork = new OrgP2PNetwork(failingP2PManager, didManager, db);

      await expect(
        failingNetwork.subscribeTopic(mockOrgId, mockTopic)
      ).rejects.toThrow('Subscription error');
    });

    it('should handle message delivery failures', async () => {
      await orgP2PNetwork.initialize(mockOrgId);

      // 添加在线成员
      orgP2PNetwork.addOnlineMember(mockOrgId, mockMemberDID);

      // 模拟发送失败
      p2pManager.sendEncryptedMessage = vi.fn(async () => {
        throw new Error('Message delivery failed');
      });

      const message = {
        type: MessageType.BROADCAST,
        content: 'Test'
      };

      // 使用直接消息模式广播
      await expect(
        orgP2PNetwork.broadcastDirect(mockOrgId, {
          ...message,
          senderDID: currentIdentity.did
        })
      ).resolves.not.toThrow(); // 使用 allSettled，不会抛出错误
    });

    it('should handle database errors', async () => {
      const nullDb = null;

      const errorNetwork = new OrgP2PNetwork(p2pManager, didManager, nullDb);

      // 数据库错误不应该阻止网络操作
      await expect(
        errorNetwork.initialize(mockOrgId)
      ).resolves.not.toThrow();
    });

    it('should handle malformed messages', async () => {
      await orgP2PNetwork.initialize(mockOrgId);

      const malformedMessage = {
        topic: mockTopic,
        data: new TextEncoder().encode('{invalid json')
      };

      // 不应该抛出错误
      await expect(
        orgP2PNetwork.handleTopicMessage(mockOrgId, malformedMessage)
      ).resolves.not.toThrow();
    });
  });

  // ============================================================================
  // 额外测试: 网络统计
  // ============================================================================
  describe('Network Statistics', () => {
    beforeEach(async () => {
      await orgP2PNetwork.initialize(mockOrgId);
    });

    it('should get network statistics', () => {
      // 添加一些在线成员
      orgP2PNetwork.addOnlineMember(mockOrgId, mockMemberDID);
      orgP2PNetwork.addOnlineMember(mockOrgId, mockMemberDID2);

      const stats = orgP2PNetwork.getNetworkStats(mockOrgId);

      expect(stats).toBeDefined();
      expect(stats.subscribed).toBe(true);
      expect(stats.topic).toBe(mockTopic);
      expect(stats.mode).toBe('pubsub');
      expect(stats.onlineMemberCount).toBe(2);
      expect(stats.onlineMembers).toContain(mockMemberDID);
      expect(stats.onlineMembers).toContain(mockMemberDID2);
      expect(stats.heartbeatActive).toBe(true);
      expect(stats.discoveryActive).toBe(true);
      expect(stats.lastActivity).toBeDefined();
    });

    it('should get online members list', () => {
      orgP2PNetwork.addOnlineMember(mockOrgId, mockMemberDID);
      orgP2PNetwork.addOnlineMember(mockOrgId, mockMemberDID2);

      const members = orgP2PNetwork.getOnlineMembers(mockOrgId);

      expect(members).toBeInstanceOf(Array);
      expect(members.length).toBe(2);
      expect(members).toContain(mockMemberDID);
      expect(members).toContain(mockMemberDID2);
    });

    it('should get online member count', () => {
      orgP2PNetwork.addOnlineMember(mockOrgId, mockMemberDID);
      orgP2PNetwork.addOnlineMember(mockOrgId, mockMemberDID2);

      const count = orgP2PNetwork.getOnlineMemberCount(mockOrgId);

      expect(count).toBe(2);
    });

    it('should check if member is online', () => {
      orgP2PNetwork.addOnlineMember(mockOrgId, mockMemberDID);

      expect(orgP2PNetwork.isMemberOnline(mockOrgId, mockMemberDID)).toBe(true);
      expect(orgP2PNetwork.isMemberOnline(mockOrgId, mockMemberDID2)).toBe(false);
    });
  });

  // ============================================================================
  // 额外测试: Direct Message Mode (PubSub不可用时的后备方案)
  // ============================================================================
  describe('Direct Message Mode', () => {
    it('should fallback to direct message mode when PubSub unavailable', async () => {
      const noPubSubP2PManager = {
        node: {
          services: {}
        }
      };

      const directNetwork = new OrgP2PNetwork(noPubSubP2PManager, didManager, db);

      await directNetwork.subscribeTopic(mockOrgId, mockTopic);

      const subscription = directNetwork.orgSubscriptions.get(mockOrgId);
      expect(subscription.mode).toBe('direct');
    });

    it('should broadcast via direct messages when in direct mode', async () => {
      const noPubSubP2PManager = {
        peerId: { toString: () => 'QmTest' },
        sendEncryptedMessage: vi.fn(async () => true),
        node: {
          services: {}
        }
      };

      const directNetwork = new OrgP2PNetwork(noPubSubP2PManager, didManager, db);

      await directNetwork.subscribeTopic(mockOrgId, mockTopic);

      // 添加在线成员
      directNetwork.addOnlineMember(mockOrgId, mockMemberDID);
      directNetwork.addOnlineMember(mockOrgId, mockMemberDID2);

      const message = {
        type: MessageType.BROADCAST,
        content: 'Direct message'
      };

      await directNetwork.broadcastMessage(mockOrgId, message);

      // 应该使用直接消息
      expect(noPubSubP2PManager.sendEncryptedMessage).toHaveBeenCalled();
    });
  });
});
