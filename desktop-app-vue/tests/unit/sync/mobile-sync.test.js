/**
 * 移动端同步功能测试
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
const MobileSyncManager = require("../../../src/main/sync/mobile-sync-manager");
const GroupChatSyncManager = require("../../../src/main/sync/group-chat-sync-manager");

describe("MobileSyncManager", () => {
  let syncManager;
  let mockDatabase;
  let mockP2PManager;

  beforeEach(() => {
    // 模拟数据库
    mockDatabase = {
      prepare: (sql) => ({
        all: () => [],
        run: () => {},
        get: () => null,
      }),
      execute: () => {},
      saveToFile: () => {},
    };

    // 模拟P2P管理器
    mockP2PManager = {
      sendMessage: async () => true,
      on: () => {},
      off: () => {},
    };

    syncManager = new MobileSyncManager(mockDatabase, mockP2PManager);
  });

  afterEach(() => {
    if (syncManager) {
      syncManager.cleanup();
    }
  });

  describe("设备注册", () => {
    it("应该成功注册移动设备", async () => {
      const deviceId = "mobile-001";
      const peerId = "peer-001";
      const deviceInfo = {
        name: "iPhone 13",
        platform: "ios",
        version: "0.22.0",
      };

      await syncManager.registerMobileDevice(deviceId, peerId, deviceInfo);

      const devices = syncManager.getMobileDevices();
      expect(devices).toHaveLength(1);
      expect(devices[0].deviceId).toBe(deviceId);
      expect(devices[0].peerId).toBe(peerId);
      expect(devices[0].status).toBe("online");
    });

    it("应该初始化同步时间", async () => {
      const deviceId = "mobile-001";
      const peerId = "peer-001";
      const deviceInfo = { name: "Test Device" };

      const beforeRegister = Date.now();
      await syncManager.registerMobileDevice(deviceId, peerId, deviceInfo);
      const afterRegister = Date.now();

      const syncTime = syncManager.lastSyncTime.get(deviceId);
      expect(syncTime).toBeDefined();
      // NOTE: Implementation now initializes sync times to current timestamp instead of 0
      expect(syncTime.knowledge).toBeGreaterThanOrEqual(beforeRegister);
      expect(syncTime.knowledge).toBeLessThanOrEqual(afterRegister);
      expect(syncTime.contacts).toBeGreaterThanOrEqual(beforeRegister);
      expect(syncTime.groupChats).toBeGreaterThanOrEqual(beforeRegister);
      expect(syncTime.messages).toBeGreaterThanOrEqual(beforeRegister);
    });
  });

  describe("知识库同步", () => {
    it("应该检测知识库变更", async () => {
      const since = Date.now() - 3600000; // 1小时前

      mockDatabase.prepare = (sql) => ({
        all: (timestamp) => [
          {
            id: "note-001",
            title: "测试笔记",
            content: "测试内容",
            tags: "test",
            category: "default",
            updated_at: Date.now(),
            deleted: 0,
          },
        ],
      });

      const changes = await syncManager.getKnowledgeChanges(since);

      expect(changes).toHaveLength(1);
      expect(changes[0].type).toBe("upsert");
      expect(changes[0].entity).toBe("note");
      expect(changes[0].id).toBe("note-001");
    });

    it("应该处理删除的笔记", async () => {
      const since = Date.now() - 3600000;

      mockDatabase.prepare = (sql) => ({
        all: (timestamp) => [
          {
            id: "note-002",
            title: "已删除笔记",
            updated_at: Date.now(),
            deleted: 1,
          },
        ],
      });

      const changes = await syncManager.getKnowledgeChanges(since);

      expect(changes).toHaveLength(1);
      expect(changes[0].type).toBe("delete");
      expect(changes[0].data).toBeNull();
    });
  });

  describe("联系人同步", () => {
    it("应该检测联系人变更", async () => {
      const since = Date.now() - 3600000;

      mockDatabase.prepare = (sql) => ({
        all: (timestamp) => [
          {
            did: "did:example:123",
            nickname: "测试用户",
            avatar: "avatar.jpg",
            status: "active",
            updated_at: Date.now(),
            deleted: 0,
          },
        ],
      });

      const changes = await syncManager.getContactsChanges(since);

      expect(changes).toHaveLength(1);
      expect(changes[0].type).toBe("upsert");
      expect(changes[0].entity).toBe("contact");
      expect(changes[0].id).toBe("did:example:123");
    });
  });

  describe("群聊同步", () => {
    it("应该检测群聊变更", async () => {
      const since = Date.now() - 3600000;

      mockDatabase.prepare = (sql) => {
        if (sql.includes("group_chats")) {
          return {
            all: (timestamp) => [
              {
                id: "group-001",
                name: "测试群聊",
                description: "测试描述",
                avatar: "group-avatar.jpg",
                creator_did: "did:example:creator",
                member_count: 5,
                updated_at: Date.now(),
              },
            ],
          };
        } else if (sql.includes("group_members")) {
          return {
            all: (groupId) => [
              {
                member_did: "did:example:member1",
                role: "owner",
                nickname: "群主",
                joined_at: Date.now(),
              },
            ],
          };
        }
      };

      const changes = await syncManager.getGroupChatsChanges(since);

      expect(changes).toHaveLength(1);
      expect(changes[0].type).toBe("upsert");
      expect(changes[0].entity).toBe("group");
      expect(changes[0].id).toBe("group-001");
      expect(changes[0].data.members).toHaveLength(1);
    });
  });

  describe("统计信息", () => {
    it("应该返回正确的统计信息", () => {
      const stats = syncManager.getStats();

      expect(stats).toHaveProperty("totalSyncs");
      expect(stats).toHaveProperty("knowledgeSynced");
      expect(stats).toHaveProperty("contactsSynced");
      expect(stats).toHaveProperty("groupChatsSynced");
      expect(stats).toHaveProperty("messagesSynced");
      expect(stats).toHaveProperty("isSyncing");
      expect(stats).toHaveProperty("mobileDevicesCount");
      expect(stats).toHaveProperty("onlineDevicesCount");
    });
  });
});

describe("GroupChatSyncManager", () => {
  let syncManager;
  let mockDatabase;
  let mockP2PManager;
  let mockGroupChatManager;

  beforeEach(() => {
    // 模拟数据库
    mockDatabase = {
      prepare: (sql) => ({
        all: () => [],
        run: () => {},
        get: () => null,
      }),
      execute: () => {},
      saveToFile: () => {},
    };

    // 模拟P2P管理器
    mockP2PManager = {
      sendMessage: async () => true,
    };

    // 模拟群聊管理器
    mockGroupChatManager = {
      on: () => {},
      off: () => {},
    };

    syncManager = new GroupChatSyncManager(
      mockDatabase,
      mockP2PManager,
      mockGroupChatManager,
    );
  });

  afterEach(() => {
    if (syncManager) {
      syncManager.cleanup();
    }
  });

  describe("消息同步", () => {
    it("应该同步群聊消息", async () => {
      const groupId = "group-001";
      const message = {
        id: "msg-001",
        sender_did: "did:example:sender",
        content: "测试消息",
        message_type: "text",
        created_at: Date.now(),
      };

      mockDatabase.prepare = (sql) => {
        if (sql.includes("group_members")) {
          return {
            all: () => [
              {
                member_did: "did:example:member1",
                role: "member",
                nickname: "成员1",
              },
            ],
          };
        } else if (sql.includes("INSERT")) {
          return {
            run: () => {},
          };
        }
      };

      await syncManager.syncMessage(groupId, message);

      expect(syncManager.stats.messagesSynced).toBe(1);
    });

    it("应该检测重复消息", async () => {
      const groupId = "group-001";
      const message = {
        id: "msg-001",
        sender_did: "did:example:sender",
        content: "测试消息",
        created_at: Date.now(),
      };

      mockDatabase.prepare = () => ({
        all: () => [],
        run: () => {},
      });

      // 第一次同步
      await syncManager.syncMessage(groupId, message);

      // 第二次同步（重复）
      await syncManager.syncMessage(groupId, message);

      expect(syncManager.stats.messagesDeduplicated).toBe(1);
    });
  });

  describe("成员变更同步", () => {
    it("应该同步成员变更", async () => {
      const groupId = "group-001";
      const change = {
        type: "member-added",
        memberDid: "did:example:newmember",
        timestamp: Date.now(),
      };

      mockDatabase.prepare = () => ({
        all: () => [
          {
            member_did: "did:example:member1",
            role: "member",
            nickname: "成员1",
          },
        ],
      });

      await syncManager.syncMemberChange(groupId, change);

      expect(syncManager.stats.memberChangesSynced).toBe(1);
    });
  });

  describe("群聊设置同步", () => {
    it("应该同步群聊设置", async () => {
      const groupId = "group-001";
      const settings = {
        name: "新群名称",
        description: "新描述",
        avatar: "new-avatar.jpg",
      };

      mockDatabase.prepare = () => ({
        all: () => [
          {
            member_did: "did:example:member1",
            role: "member",
            nickname: "成员1",
          },
        ],
        run: () => {},
      });

      await syncManager.syncGroupSettings(groupId, settings);

      expect(syncManager.stats.groupSettingsSynced).toBe(1);
    });
  });

  describe("消息队列", () => {
    it("应该将消息加入队列", () => {
      const groupId = "group-001";
      const memberDid = "did:example:member1";
      const message = {
        id: "msg-001",
        content: "测试消息",
      };

      syncManager.queueMessage(groupId, memberDid, message);

      expect(syncManager.stats.messagesQueued).toBe(1);
    });

    it("应该限制队列大小", () => {
      const groupId = "group-001";
      const memberDid = "did:example:member1";

      // 添加超过队列大小的消息
      for (let i = 0; i < syncManager.options.messageQueueSize + 10; i++) {
        syncManager.queueMessage(groupId, memberDid, {
          id: `msg-${i}`,
          content: `消息${i}`,
        });
      }

      const queueKey = `${groupId}:${memberDid}`;
      const queue = syncManager.messageQueues.get(queueKey);

      expect(queue.length).toBeLessThanOrEqual(
        syncManager.options.messageQueueSize,
      );
    });
  });

  describe("统计信息", () => {
    it("应该返回正确的统计信息", () => {
      const stats = syncManager.getStats();

      expect(stats).toHaveProperty("messagesSynced");
      expect(stats).toHaveProperty("messagesQueued");
      expect(stats).toHaveProperty("messagesDeduplicated");
      expect(stats).toHaveProperty("memberChangesSynced");
      expect(stats).toHaveProperty("groupSettingsSynced");
      expect(stats).toHaveProperty("messageQueuesCount");
      expect(stats).toHaveProperty("messageCacheSize");
      expect(stats).toHaveProperty("onlineMembersCount");
    });
  });
});
