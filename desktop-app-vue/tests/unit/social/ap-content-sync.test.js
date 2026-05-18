import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../../src/main/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'test-uuid-' + Math.random().toString(36).substr(2, 9))
}));

vi.mock('../../../src/main/social/activitypub-bridge', () => ({
  ACTIVITY_TYPES: {
    CREATE: 'Create',
    UPDATE: 'Update',
    DELETE: 'Delete',
    FOLLOW: 'Follow',
    ACCEPT: 'Accept',
    REJECT: 'Reject',
    LIKE: 'Like',
    ANNOUNCE: 'Announce',
    UNDO: 'Undo'
  },
  AP_CONTEXT: 'https://www.w3.org/ns/activitystreams'
}));

describe('APContentSync', () => {
  let APContentSync, getAPContentSync;
  let sync;
  let mockDatabase;
  let mockApBridge;
  let mockPostManager;
  let mockStmt;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.useFakeTimers();

    const mod = await import('../../../src/main/social/ap-content-sync.js');
    APContentSync = mod.APContentSync;
    getAPContentSync = mod.getAPContentSync;

    mockStmt = {
      run: vi.fn(),
      get: vi.fn(() => ({ count: 0 })),
      all: vi.fn(() => [])
    };

    mockDatabase = {
      db: {
        exec: vi.fn(),
        prepare: vi.fn(() => mockStmt)
      },
      saveToFile: vi.fn()
    };

    mockApBridge = {
      getActorByDid: vi.fn(),
      createActivity: vi.fn().mockResolvedValue({ id: 'activity-1', type: 'Create' }),
      processInboxActivity: vi.fn().mockResolvedValue({ accepted: true })
    };

    mockPostManager = {};
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // --- Constructor ---

  describe('constructor', () => {
    it('should set up database, apBridge, postManager', () => {
      sync = new APContentSync(mockDatabase, mockApBridge, mockPostManager);
      expect(sync.database).toBe(mockDatabase);
      expect(sync.apBridge).toBe(mockApBridge);
      expect(sync.postManager).toBe(mockPostManager);
      expect(sync.initialized).toBe(false);
      expect(sync._syncInterval).toBeNull();
    });
  });

  // --- initialize ---

  describe('initialize()', () => {
    it('should set initialized to true', async () => {
      sync = new APContentSync(mockDatabase, mockApBridge);
      await sync.initialize();
      expect(sync.initialized).toBe(true);
    });

    it('should create sync interval when autoSync is true', async () => {
      sync = new APContentSync(mockDatabase, mockApBridge);
      await sync.initialize({ autoSync: true, syncIntervalMs: 1000 });

      expect(sync._syncInterval).not.toBeNull();
    });

    it('should use default 5 min interval if syncIntervalMs not provided', async () => {
      sync = new APContentSync(mockDatabase, mockApBridge);
      await sync.initialize({ autoSync: true });

      expect(sync._syncInterval).not.toBeNull();
    });

    it('should not create interval without autoSync', async () => {
      sync = new APContentSync(mockDatabase, mockApBridge);
      await sync.initialize({});

      expect(sync._syncInterval).toBeNull();
    });
  });

  // --- publishPost ---

  describe('publishPost()', () => {
    it('should throw on missing content', async () => {
      sync = new APContentSync(mockDatabase, mockApBridge);
      await expect(sync.publishPost('did:user', {})).rejects.toThrow('Post content is required');
      await expect(sync.publishPost('did:user', null)).rejects.toThrow('Post content is required');
    });

    it('should create Note activity via apBridge', async () => {
      const actor = {
        id: 'https://test.local/users/alice',
        followers_url: 'https://test.local/users/alice/followers'
      };
      mockApBridge.getActorByDid.mockResolvedValue(actor);

      sync = new APContentSync(mockDatabase, mockApBridge);
      const emitSpy = vi.spyOn(sync, 'emit');

      const result = await sync.publishPost('did:alice', {
        id: 'post-1',
        content: 'Hello world!',
        created_at: 1700000000000
      });

      expect(mockApBridge.createActivity).toHaveBeenCalledWith(
        'did:alice',
        'Create',
        expect.objectContaining({
          type: 'Note',
          content: 'Hello world!',
          attributedTo: actor.id
        })
      );
      expect(emitSpy).toHaveBeenCalledWith('post:published', expect.any(Object));
      expect(result).toBeDefined();
    });

    it('should throw if actor not found', async () => {
      mockApBridge.getActorByDid.mockResolvedValue(null);
      sync = new APContentSync(mockDatabase, mockApBridge);
      await expect(sync.publishPost('did:unknown', { content: 'test' })).rejects.toThrow('Actor not found');
    });

    it('should include media attachments when present', async () => {
      const actor = { id: 'https://test.local/users/alice', followers_url: 'https://test.local/users/alice/followers' };
      mockApBridge.getActorByDid.mockResolvedValue(actor);

      sync = new APContentSync(mockDatabase, mockApBridge);
      await sync.publishPost('did:alice', {
        content: 'Photo post',
        media: [{ url: 'https://img.com/1.jpg', type: 'image/jpeg' }]
      });

      const createCall = mockApBridge.createActivity.mock.calls[0][2];
      expect(createCall.attachment).toBeDefined();
      expect(createCall.attachment.length).toBe(1);
      expect(createCall.attachment[0].type).toBe('Document');
    });
  });

  // --- publishLike ---

  describe('publishLike()', () => {
    it('should create Like activity', async () => {
      sync = new APContentSync(mockDatabase, mockApBridge);
      const result = await sync.publishLike('did:alice', 'https://remote.com/posts/1');

      expect(mockApBridge.createActivity).toHaveBeenCalledWith(
        'did:alice',
        'Like',
        'https://remote.com/posts/1'
      );
      expect(result).toBeDefined();
    });
  });

  // --- publishBoost ---

  describe('publishBoost()', () => {
    it('should create Announce activity', async () => {
      sync = new APContentSync(mockDatabase, mockApBridge);
      const result = await sync.publishBoost('did:alice', 'https://remote.com/posts/1');

      expect(mockApBridge.createActivity).toHaveBeenCalledWith(
        'did:alice',
        'Announce',
        'https://remote.com/posts/1'
      );
      expect(result).toBeDefined();
    });
  });

  // --- publishFollow ---

  describe('publishFollow()', () => {
    it('should create Follow activity', async () => {
      sync = new APContentSync(mockDatabase, mockApBridge);
      const result = await sync.publishFollow('did:alice', 'https://remote.com/users/bob');

      expect(mockApBridge.createActivity).toHaveBeenCalledWith(
        'did:alice',
        'Follow',
        'https://remote.com/users/bob'
      );
      expect(result).toBeDefined();
    });
  });

  // --- importNote ---

  describe('importNote()', () => {
    it('should throw on missing content', async () => {
      sync = new APContentSync(mockDatabase, mockApBridge);
      await expect(sync.importNote({}, 'did:owner')).rejects.toThrow('Note content is required');
      await expect(sync.importNote(null, 'did:owner')).rejects.toThrow('Note content is required');
    });

    it('should emit note:imported event', async () => {
      sync = new APContentSync(mockDatabase, mockApBridge);
      const emitSpy = vi.spyOn(sync, 'emit');

      const result = await sync.importNote(
        { id: 'remote-note-1', content: 'Hello from remote!', attributedTo: 'https://remote.com/users/bob', published: '2024-01-01T00:00:00Z' },
        'did:local'
      );

      expect(result.success).toBe(true);
      expect(result.post.content).toBe('Hello from remote!');
      expect(result.post.source).toBe('activitypub');
      expect(result.post.remote_actor).toBe('https://remote.com/users/bob');
      expect(emitSpy).toHaveBeenCalledWith('note:imported', expect.objectContaining({
        content: 'Hello from remote!',
        author_did: 'did:local'
      }));
    });

    it('should handle note without published date', async () => {
      sync = new APContentSync(mockDatabase, mockApBridge);
      const result = await sync.importNote({ content: 'No date' }, 'did:local');
      expect(result.success).toBe(true);
      expect(typeof result.post.created_at).toBe('number');
    });
  });

  // --- getSyncStatus ---

  describe('getSyncStatus()', () => {
    it('should return counts from DB', async () => {
      mockStmt.get
        .mockReturnValueOnce({ count: 10 })  // published
        .mockReturnValueOnce({ count: 5 })   // received
        .mockReturnValueOnce({ count: 3 });   // pending

      sync = new APContentSync(mockDatabase, mockApBridge);
      const status = await sync.getSyncStatus();

      expect(status.published).toBe(10);
      expect(status.received).toBe(5);
      expect(status.pending).toBe(3);
    });

    it('should return zeros when no DB', async () => {
      sync = new APContentSync(null, mockApBridge);
      const status = await sync.getSyncStatus();
      expect(status).toEqual({ published: 0, received: 0, pending: 0 });
    });

    it('should return zeros when database.db is null', async () => {
      sync = new APContentSync({ db: null }, mockApBridge);
      const status = await sync.getSyncStatus();
      expect(status).toEqual({ published: 0, received: 0, pending: 0 });
    });
  });

  // --- close ---

  describe('close()', () => {
    it('should clear interval if set', async () => {
      sync = new APContentSync(mockDatabase, mockApBridge);
      await sync.initialize({ autoSync: true, syncIntervalMs: 1000 });
      expect(sync._syncInterval).not.toBeNull();

      await sync.close();
      expect(sync._syncInterval).toBeNull();
      expect(sync.initialized).toBe(false);
    });

    it('should work even if no interval was set', async () => {
      sync = new APContentSync(mockDatabase, mockApBridge);
      await sync.initialize();
      await sync.close();
      expect(sync.initialized).toBe(false);
    });

    it('should remove all listeners', async () => {
      sync = new APContentSync(mockDatabase, mockApBridge);
      sync.on('test', () => {});
      await sync.close();
      expect(sync.listenerCount('test')).toBe(0);
    });
  });

  // --- singleton ---

  describe('getAPContentSync()', () => {
    it('should return same instance', () => {
      const a = getAPContentSync();
      const b = getAPContentSync();
      expect(a).toBe(b);
    });
  });
});
