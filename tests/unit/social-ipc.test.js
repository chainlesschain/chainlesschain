/**
 * Social IPC 单元测试
 * 测试18个社交功能API方法
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ipcMain } from 'electron';

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
}));

describe('Social IPC', () => {
  let mockDatabase;
  let mockP2PManager;
  let handlers = {};

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = {};

    mockDatabase = {
      all: vi.fn(),
      get: vi.fn(),
      run: vi.fn(),
    };

    mockP2PManager = {
      sendMessage: vi.fn(),
      broadcast: vi.fn(),
    };

    ipcMain.handle.mockImplementation((channel, handler) => {
      handlers[channel] = handler;
    });

    const { registerSocialIPC } = require('../../desktop-app-vue/src/main/social/social-ipc');
    registerSocialIPC({ database: mockDatabase, p2pManager: mockP2PManager });
  });

  describe('Contact Management', () => {
    it('should add contact', async () => {
      mockDatabase.run.mockResolvedValue({ lastID: 1 });

      const result = await handlers['contact:add'](null, {
        did: 'did:example:123',
        name: 'John Doe',
        avatar: 'avatar.jpg',
      });

      expect(result.success).toBe(true);
      expect(result.contactId).toBe(1);
      expect(mockDatabase.run).toHaveBeenCalled();
    });

    it('should add contact from QR code', async () => {
      const qrData = {
        did: 'did:example:456',
        name: 'Jane Doe',
      };

      mockDatabase.run.mockResolvedValue({ lastID: 2 });

      const result = await handlers['contact:add-from-qr'](null, JSON.stringify(qrData));

      expect(result.success).toBe(true);
      expect(result.contactId).toBe(2);
    });

    it('should get all contacts', async () => {
      const mockContacts = [
        { id: 1, did: 'did:1', name: 'Contact 1' },
        { id: 2, did: 'did:2', name: 'Contact 2' },
      ];

      mockDatabase.all.mockResolvedValue(mockContacts);

      const result = await handlers['contact:get-all']();

      expect(result.success).toBe(true);
      expect(result.contacts).toEqual(mockContacts);
    });

    it('should get contact by DID', async () => {
      const mockContact = {
        id: 1,
        did: 'did:example:123',
        name: 'John Doe',
      };

      mockDatabase.get.mockResolvedValue(mockContact);

      const result = await handlers['contact:get'](null, 'did:example:123');

      expect(result.success).toBe(true);
      expect(result.contact).toEqual(mockContact);
    });

    it('should update contact', async () => {
      mockDatabase.run.mockResolvedValue({ changes: 1 });

      const result = await handlers['contact:update'](null, 'did:example:123', {
        name: 'Updated Name',
      });

      expect(result.success).toBe(true);
    });

    it('should delete contact', async () => {
      mockDatabase.run.mockResolvedValue({ changes: 1 });

      const result = await handlers['contact:delete'](null, 'did:example:123');

      expect(result.success).toBe(true);
    });

    it('should search contacts', async () => {
      const mockResults = [
        { id: 1, did: 'did:1', name: 'John' },
      ];

      mockDatabase.all.mockResolvedValue(mockResults);

      const result = await handlers['contact:search'](null, 'John');

      expect(result.success).toBe(true);
      expect(result.contacts).toEqual(mockResults);
    });

    it('should get friends list', async () => {
      const mockFriends = [
        { id: 1, did: 'did:1', name: 'Friend 1', isFriend: true },
      ];

      mockDatabase.all.mockResolvedValue(mockFriends);

      const result = await handlers['contact:get-friends']();

      expect(result.success).toBe(true);
      expect(result.friends).toEqual(mockFriends);
    });

    it('should get contact statistics', async () => {
      const mockStats = {
        totalContacts: 10,
        totalFriends: 5,
      };

      mockDatabase.get.mockResolvedValue(mockStats);

      const result = await handlers['contact:get-statistics']();

      expect(result.success).toBe(true);
      expect(result.statistics).toEqual(mockStats);
    });
  });

  describe('Friend Management', () => {
    it('should send friend request', async () => {
      mockDatabase.run.mockResolvedValue({ lastID: 1 });
      mockP2PManager.sendMessage.mockResolvedValue(true);

      const result = await handlers['friend:send-request'](null, 'did:target', 'Hello');

      expect(result.success).toBe(true);
      expect(result.requestId).toBe(1);
      expect(mockP2PManager.sendMessage).toHaveBeenCalled();
    });

    it('should accept friend request', async () => {
      mockDatabase.get.mockResolvedValue({
        id: 1,
        fromDid: 'did:from',
        toDid: 'did:to',
      });
      mockDatabase.run.mockResolvedValue({ changes: 1 });
      mockP2PManager.sendMessage.mockResolvedValue(true);

      const result = await handlers['friend:accept-request'](null, 1);

      expect(result.success).toBe(true);
      expect(mockDatabase.run).toHaveBeenCalledTimes(2); // Update request + Add friend
    });

    it('should reject friend request', async () => {
      mockDatabase.run.mockResolvedValue({ changes: 1 });
      mockP2PManager.sendMessage.mockResolvedValue(true);

      const result = await handlers['friend:reject-request'](null, 1);

      expect(result.success).toBe(true);
    });

    it('should get pending friend requests', async () => {
      const mockRequests = [
        { id: 1, fromDid: 'did:1', status: 'pending' },
      ];

      mockDatabase.all.mockResolvedValue(mockRequests);

      const result = await handlers['friend:get-pending-requests']();

      expect(result.success).toBe(true);
      expect(result.requests).toEqual(mockRequests);
    });

    it('should get friends by group', async () => {
      const mockFriends = [
        { did: 'did:1', name: 'Friend 1', group: 'work' },
      ];

      mockDatabase.all.mockResolvedValue(mockFriends);

      const result = await handlers['friend:get-friends'](null, 'work');

      expect(result.success).toBe(true);
      expect(result.friends).toEqual(mockFriends);
    });

    it('should remove friend', async () => {
      mockDatabase.run.mockResolvedValue({ changes: 1 });

      const result = await handlers['friend:remove'](null, 'did:friend');

      expect(result.success).toBe(true);
    });

    it('should update friend nickname', async () => {
      mockDatabase.run.mockResolvedValue({ changes: 1 });

      const result = await handlers['friend:update-nickname'](null, 'did:friend', 'NewNick');

      expect(result.success).toBe(true);
    });

    it('should update friend group', async () => {
      mockDatabase.run.mockResolvedValue({ changes: 1 });

      const result = await handlers['friend:update-group'](null, 'did:friend', 'family');

      expect(result.success).toBe(true);
    });

    it('should get friend statistics', async () => {
      const mockStats = {
        totalFriends: 20,
        pendingRequests: 3,
      };

      mockDatabase.get.mockResolvedValue(mockStats);

      const result = await handlers['friend:get-statistics']();

      expect(result.success).toBe(true);
      expect(result.statistics).toEqual(mockStats);
    });
  });

  describe('Post Management', () => {
    it('should create post', async () => {
      mockDatabase.run.mockResolvedValue({ lastID: 1 });
      mockP2PManager.broadcast.mockResolvedValue(true);

      const result = await handlers['post:create'](null, {
        content: 'Hello world',
        images: ['img1.jpg'],
      });

      expect(result.success).toBe(true);
      expect(result.postId).toBe(1);
      expect(mockP2PManager.broadcast).toHaveBeenCalled();
    });

    it('should get feed', async () => {
      const mockPosts = [
        { id: 1, content: 'Post 1', created_at: '2025-01-01' },
        { id: 2, content: 'Post 2', created_at: '2025-01-02' },
      ];

      mockDatabase.all.mockResolvedValue(mockPosts);

      const result = await handlers['post:get-feed'](null, { limit: 10 });

      expect(result.success).toBe(true);
      expect(result.posts).toEqual(mockPosts);
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors in contact operations', async () => {
      mockDatabase.run.mockRejectedValue(new Error('Database error'));

      const result = await handlers['contact:add'](null, {
        did: 'did:test',
        name: 'Test',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Database error');
    });

    it('should handle P2P errors in friend requests', async () => {
      mockDatabase.run.mockResolvedValue({ lastID: 1 });
      mockP2PManager.sendMessage.mockRejectedValue(new Error('Network error'));

      const result = await handlers['friend:send-request'](null, 'did:target', 'Hello');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Network error');
    });

    it('should handle invalid QR data', async () => {
      const result = await handlers['contact:add-from-qr'](null, 'invalid-json');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});
