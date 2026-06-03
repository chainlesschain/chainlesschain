import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../../src/main/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'test-uuid-' + Math.random().toString(36).substr(2, 9))
}));

// Generate a real RSA key pair for signature tests
import crypto from 'crypto';
const testKeyPair = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});

describe('ActivityPubBridge', () => {
  let ActivityPubBridge, getActivityPubBridge, ACTIVITY_TYPES, OBJECT_TYPES, AP_CONTEXT;
  let bridge;
  let mockDatabase;
  let mockStmt;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    const mod = await import('../../../src/main/social/activitypub-bridge.js');
    ActivityPubBridge = mod.ActivityPubBridge;
    getActivityPubBridge = mod.getActivityPubBridge;
    ACTIVITY_TYPES = mod.ACTIVITY_TYPES;
    OBJECT_TYPES = mod.OBJECT_TYPES;
    AP_CONTEXT = mod.AP_CONTEXT;

    mockStmt = {
      run: vi.fn(),
      get: vi.fn(),
      all: vi.fn(() => [])
    };

    mockDatabase = {
      db: {
        exec: vi.fn(),
        prepare: vi.fn(() => mockStmt)
      },
      saveToFile: vi.fn()
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --- Constants ---

  describe('Constants', () => {
    it('should export ACTIVITY_TYPES', () => {
      expect(ACTIVITY_TYPES.CREATE).toBe('Create');
      expect(ACTIVITY_TYPES.FOLLOW).toBe('Follow');
      expect(ACTIVITY_TYPES.LIKE).toBe('Like');
      expect(ACTIVITY_TYPES.ANNOUNCE).toBe('Announce');
      expect(ACTIVITY_TYPES.UNDO).toBe('Undo');
    });

    it('should export OBJECT_TYPES', () => {
      expect(OBJECT_TYPES.NOTE).toBe('Note');
      expect(OBJECT_TYPES.ARTICLE).toBe('Article');
      expect(OBJECT_TYPES.PERSON).toBe('Person');
      expect(OBJECT_TYPES.IMAGE).toBe('Image');
    });

    it('should export AP_CONTEXT', () => {
      expect(AP_CONTEXT).toBe('https://www.w3.org/ns/activitystreams');
    });
  });

  // --- Constructor ---

  describe('constructor', () => {
    it('should set up database, didManager, cache', () => {
      const mockDid = { resolve: vi.fn() };
      bridge = new ActivityPubBridge(mockDatabase, mockDid);
      expect(bridge.database).toBe(mockDatabase);
      expect(bridge.didManager).toBe(mockDid);
      expect(bridge.initialized).toBe(false);
      expect(bridge._actorCache).toBeInstanceOf(Map);
      expect(bridge._localDomain).toBeNull();
    });
  });

  // --- initialize ---

  describe('initialize()', () => {
    it('should set domain and create tables', async () => {
      bridge = new ActivityPubBridge(mockDatabase);
      await bridge.initialize({ domain: 'example.com' });

      expect(bridge._localDomain).toBe('example.com');
      expect(bridge.initialized).toBe(true);
      expect(mockDatabase.db.exec).toHaveBeenCalledTimes(1);
      const sql = mockDatabase.db.exec.mock.calls[0][0];
      expect(sql).toContain('activitypub_actors');
      expect(sql).toContain('activitypub_activities');
    });

    it('should use localhost as default domain', async () => {
      bridge = new ActivityPubBridge(mockDatabase);
      await bridge.initialize();
      expect(bridge._localDomain).toBe('localhost');
    });
  });

  // --- createLocalActor ---

  describe('createLocalActor()', () => {
    it('should generate keys, store in DB, and emit event', async () => {
      bridge = new ActivityPubBridge(mockDatabase);
      await bridge.initialize({ domain: 'test.local' });

      const emitSpy = vi.spyOn(bridge, 'emit');

      const actor = await bridge.createLocalActor('did:test:123', {
        username: 'alice',
        displayName: 'Alice',
        bio: 'Hello!'
      });

      expect(actor.id).toBe('https://test.local/users/alice');
      expect(actor.did).toBe('did:test:123');
      expect(actor.preferredUsername).toBe('alice');
      expect(actor.displayName).toBe('Alice');
      expect(actor.inboxUrl).toContain('/inbox');
      expect(actor.outboxUrl).toContain('/outbox');

      expect(mockStmt.run).toHaveBeenCalled();
      expect(mockDatabase.saveToFile).toHaveBeenCalled();
      expect(emitSpy).toHaveBeenCalledWith('actor:created', expect.objectContaining({ did: 'did:test:123' }));
    });

    it('should derive username from DID if not provided', async () => {
      bridge = new ActivityPubBridge(mockDatabase);
      await bridge.initialize({ domain: 'test.local' });

      const actor = await bridge.createLocalActor('did:key:abc123def456');
      expect(actor.preferredUsername).toBe('abc123def456');
    });

    it('should cache the created actor', async () => {
      bridge = new ActivityPubBridge(mockDatabase);
      await bridge.initialize({ domain: 'test.local' });

      await bridge.createLocalActor('did:test:cache', { username: 'cached' });
      expect(bridge._actorCache.has('did:test:cache')).toBe(true);
    });
  });

  // --- getActorByDid ---

  describe('getActorByDid()', () => {
    it('should return cached actor', async () => {
      bridge = new ActivityPubBridge(mockDatabase);
      const cachedActor = { id: 'cached-actor', did: 'did:cached' };
      bridge._actorCache.set('did:cached', cachedActor);

      const result = await bridge.getActorByDid('did:cached');
      expect(result).toBe(cachedActor);
      // DB should NOT be queried
      expect(mockDatabase.db.prepare).not.toHaveBeenCalled();
    });

    it('should query DB when not cached', async () => {
      const dbActor = { id: 'db-actor', did: 'did:fromdb', preferred_username: 'bob' };
      mockStmt.get.mockReturnValue(dbActor);

      bridge = new ActivityPubBridge(mockDatabase);
      const result = await bridge.getActorByDid('did:fromdb');

      expect(result).toBe(dbActor);
      expect(bridge._actorCache.get('did:fromdb')).toBe(dbActor);
    });

    it('should return null if actor not found', async () => {
      mockStmt.get.mockReturnValue(undefined);
      bridge = new ActivityPubBridge(mockDatabase);
      const result = await bridge.getActorByDid('did:nonexistent');
      expect(result).toBeNull();
    });

    it('should return null if no database', async () => {
      bridge = new ActivityPubBridge(null);
      const result = await bridge.getActorByDid('did:test');
      expect(result).toBeNull();
    });
  });

  // --- buildActorDocument ---

  describe('buildActorDocument()', () => {
    it('should return proper AS2 document', async () => {
      bridge = new ActivityPubBridge(mockDatabase);
      const actor = {
        id: 'https://example.com/users/alice',
        preferred_username: 'alice',
        display_name: 'Alice',
        summary: 'Hello',
        inbox_url: 'https://example.com/users/alice/inbox',
        outbox_url: 'https://example.com/users/alice/outbox',
        followers_url: 'https://example.com/users/alice/followers',
        following_url: 'https://example.com/users/alice/following',
        public_key_pem: 'PEM_KEY',
        icon_url: null
      };
      bridge._actorCache.set('did:alice', actor);

      const doc = await bridge.buildActorDocument('did:alice');

      expect(doc['@context']).toEqual([AP_CONTEXT, 'https://w3id.org/security/v1']);
      expect(doc.type).toBe('Person');
      expect(doc.preferredUsername).toBe('alice');
      expect(doc.name).toBe('Alice');
      expect(doc.inbox).toContain('/inbox');
      expect(doc.outbox).toContain('/outbox');
      expect(doc.publicKey.publicKeyPem).toBe('PEM_KEY');
      expect(doc.icon).toBeUndefined();
    });

    it('should throw if actor not found', async () => {
      mockStmt.get.mockReturnValue(undefined);
      bridge = new ActivityPubBridge(mockDatabase);
      await expect(bridge.buildActorDocument('did:nonexistent')).rejects.toThrow('Actor not found');
    });

    it('should include icon when icon_url present', async () => {
      bridge = new ActivityPubBridge(mockDatabase);
      const actor = {
        id: 'https://example.com/users/bob',
        preferred_username: 'bob',
        display_name: 'Bob',
        summary: '',
        inbox_url: 'https://example.com/users/bob/inbox',
        outbox_url: 'https://example.com/users/bob/outbox',
        followers_url: 'https://example.com/users/bob/followers',
        following_url: 'https://example.com/users/bob/following',
        public_key_pem: 'PEM',
        icon_url: 'https://example.com/avatar.png'
      };
      bridge._actorCache.set('did:bob', actor);

      const doc = await bridge.buildActorDocument('did:bob');
      expect(doc.icon).toEqual({ type: 'Image', url: 'https://example.com/avatar.png' });
    });
  });

  // --- createActivity ---

  describe('createActivity()', () => {
    it('should store activity and emit event', async () => {
      bridge = new ActivityPubBridge(mockDatabase);
      bridge._localDomain = 'test.local';
      const actor = { id: 'https://test.local/users/alice', did: 'did:alice' };
      bridge._actorCache.set('did:alice', actor);

      const emitSpy = vi.spyOn(bridge, 'emit');
      const objData = { type: 'Note', id: 'note-1', content: 'Hello!' };

      const activity = await bridge.createActivity('did:alice', 'Create', objData);

      expect(activity['@context']).toBe(AP_CONTEXT);
      expect(activity.type).toBe('Create');
      expect(activity.actor).toBe('https://test.local/users/alice');
      expect(activity.object).toBe(objData);
      expect(mockStmt.run).toHaveBeenCalled();
      expect(mockDatabase.saveToFile).toHaveBeenCalled();
      expect(emitSpy).toHaveBeenCalledWith('activity:created', expect.any(Object));
    });

    it('should throw if actor not found', async () => {
      mockStmt.get.mockReturnValue(undefined);
      bridge = new ActivityPubBridge(mockDatabase);
      bridge._localDomain = 'test.local';
      await expect(bridge.createActivity('did:nonexistent', 'Create', {})).rejects.toThrow('Actor not found');
    });
  });

  // --- processInboxActivity ---

  describe('processInboxActivity()', () => {
    beforeEach(() => {
      bridge = new ActivityPubBridge(mockDatabase);
      bridge._localDomain = 'test.local';
    });

    it('should throw on invalid activity (null)', async () => {
      await expect(bridge.processInboxActivity(null)).rejects.toThrow('Invalid activity');
    });

    it('should throw on activity without type', async () => {
      await expect(bridge.processInboxActivity({ actor: 'someone' })).rejects.toThrow('Invalid activity');
    });

    it('should handle Follow activity', async () => {
      const localActor = { id: 'https://test.local/users/alice', is_local: 1 };
      mockStmt.get.mockReturnValue(localActor);

      const emitSpy = vi.spyOn(bridge, 'emit');
      const result = await bridge.processInboxActivity({
        id: 'follow-1',
        type: 'Follow',
        actor: 'https://remote.com/users/bob',
        object: 'https://test.local/users/alice'
      });

      expect(result.accepted).toBe(true);
      expect(result.type).toBe('follow');
      expect(emitSpy).toHaveBeenCalledWith('inbox:received', expect.any(Object));
    });

    it('should handle Create activity', async () => {
      const emitSpy = vi.spyOn(bridge, 'emit');
      const result = await bridge.processInboxActivity({
        id: 'create-1',
        type: 'Create',
        actor: 'https://remote.com/users/bob',
        object: { type: 'Note', content: 'Hello!' }
      });

      expect(result.accepted).toBe(true);
      expect(result.type).toBe('create');
      expect(emitSpy).toHaveBeenCalledWith('content:received', expect.objectContaining({ content: 'Hello!' }));
    });

    it('should handle Like activity', async () => {
      const emitSpy = vi.spyOn(bridge, 'emit');
      await bridge.processInboxActivity({
        id: 'like-1',
        type: 'Like',
        actor: 'https://remote.com/users/bob',
        object: 'https://test.local/posts/1'
      });
      expect(emitSpy).toHaveBeenCalledWith('like:received', expect.any(Object));
    });

    it('should handle Announce activity', async () => {
      const emitSpy = vi.spyOn(bridge, 'emit');
      await bridge.processInboxActivity({
        id: 'announce-1',
        type: 'Announce',
        actor: 'https://remote.com/users/bob',
        object: 'https://test.local/posts/1'
      });
      expect(emitSpy).toHaveBeenCalledWith('boost:received', expect.any(Object));
    });

    it('should mark activity as processed', async () => {
      await bridge.processInboxActivity({
        id: 'undo-1',
        type: 'Undo',
        actor: 'https://remote.com/users/bob',
        object: { type: 'Follow' }
      });

      // Check that UPDATE processed = 1 was called
      const prepareCalls = mockDatabase.db.prepare.mock.calls;
      const updateCall = prepareCalls.find(c => c[0].includes('processed = 1'));
      expect(updateCall).toBeDefined();
    });
  });

  // --- signRequest ---

  describe('signRequest()', () => {
    it('should create HTTP signature headers', async () => {
      bridge = new ActivityPubBridge(mockDatabase);
      const actor = {
        id: 'https://test.local/users/alice',
        private_key_pem: testKeyPair.privateKey
      };
      bridge._actorCache.set('did:alice', actor);

      const headers = await bridge.signRequest('did:alice', 'https://remote.com/inbox', { content: 'test' });

      expect(headers.Host).toBe('remote.com');
      expect(headers.Date).toBeDefined();
      expect(headers.Signature).toContain('keyId=');
      expect(headers.Signature).toContain('signature=');
      expect(headers.Digest).toContain('SHA-256=');
    });

    it('should throw if actor not found', async () => {
      mockStmt.get.mockReturnValue(undefined);
      bridge = new ActivityPubBridge(mockDatabase);
      await expect(bridge.signRequest('did:nonexistent', 'https://remote.com/inbox', {})).rejects.toThrow('Actor or private key not found');
    });

    it('should omit Digest header when no body', async () => {
      bridge = new ActivityPubBridge(mockDatabase);
      const actor = {
        id: 'https://test.local/users/alice',
        private_key_pem: testKeyPair.privateKey
      };
      bridge._actorCache.set('did:alice', actor);

      const headers = await bridge.signRequest('did:alice', 'https://remote.com/inbox', null);
      expect(headers.Digest).toBeUndefined();
    });
  });

  // --- getOutbox ---

  describe('getOutbox()', () => {
    it('should return OrderedCollection', async () => {
      bridge = new ActivityPubBridge(mockDatabase);
      bridge._localDomain = 'test.local';
      const actor = { id: 'https://test.local/users/alice' };
      bridge._actorCache.set('did:alice', actor);

      mockStmt.all.mockReturnValue([
        { id: 'act-1', activity_type: 'Create', raw_json: JSON.stringify({ id: 'act-1', type: 'Create' }) }
      ]);
      mockStmt.get.mockReturnValue({ count: 1 });

      const outbox = await bridge.getOutbox('did:alice');

      expect(outbox['@context']).toBe(AP_CONTEXT);
      expect(outbox.type).toBe('OrderedCollection');
      expect(outbox.totalItems).toBe(1);
      expect(outbox.orderedItems.length).toBe(1);
      expect(outbox.orderedItems[0].type).toBe('Create');
    });

    it('should throw if actor not found', async () => {
      mockStmt.get.mockReturnValue(undefined);
      bridge = new ActivityPubBridge(mockDatabase);
      await expect(bridge.getOutbox('did:nonexistent')).rejects.toThrow('Actor not found');
    });
  });

  // --- getStatus ---

  describe('getStatus()', () => {
    it('should return bridge status', async () => {
      bridge = new ActivityPubBridge(mockDatabase);
      bridge._localDomain = 'test.local';
      bridge.initialized = true;

      mockStmt.get
        .mockReturnValueOnce({ count: 3 })  // actor count
        .mockReturnValueOnce({ count: 15 }); // activity count

      const status = await bridge.getStatus();

      expect(status.initialized).toBe(true);
      expect(status.domain).toBe('test.local');
      expect(status.actorCount).toBe(3);
      expect(status.activityCount).toBe(15);
    });

    it('should return basic status when no DB', async () => {
      bridge = new ActivityPubBridge(null);
      bridge._localDomain = 'test.local';
      bridge.initialized = true;

      const status = await bridge.getStatus();
      expect(status.actorCount).toBe(0);
      expect(status.activityCount).toBe(0);
    });
  });

  // --- close ---

  describe('close()', () => {
    it('should clear cache and reset state', async () => {
      bridge = new ActivityPubBridge(mockDatabase);
      await bridge.initialize();
      bridge._actorCache.set('did:test', { id: 'actor' });
      bridge.on('test', () => {});

      await bridge.close();

      expect(bridge._actorCache.size).toBe(0);
      expect(bridge.initialized).toBe(false);
      expect(bridge.listenerCount('test')).toBe(0);
    });
  });

  // --- singleton ---

  describe('getActivityPubBridge()', () => {
    it('should return same instance', () => {
      const a = getActivityPubBridge();
      const b = getActivityPubBridge();
      expect(a).toBe(b);
    });
  });
});
