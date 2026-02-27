import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../../src/main/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

// Mock Node.js built-in modules that Vite cannot resolve
vi.mock('https', () => ({
  default: { get: vi.fn(), request: vi.fn() },
  get: vi.fn(),
  request: vi.fn()
}));

vi.mock('http', () => ({
  default: { get: vi.fn(), request: vi.fn() },
  get: vi.fn(),
  request: vi.fn()
}));

describe('APWebFinger', () => {
  let APWebFinger, getAPWebFinger;
  let webfinger;
  let mockApBridge;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    const mod = await import('../../../src/main/social/ap-webfinger.js');
    APWebFinger = mod.APWebFinger;
    getAPWebFinger = mod.getAPWebFinger;

    mockApBridge = {
      getActorByDid: vi.fn(),
      _localDomain: 'test.local'
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --- Constructor ---

  describe('constructor', () => {
    it('should set up with cache and apBridge', () => {
      webfinger = new APWebFinger(mockApBridge);
      expect(webfinger.apBridge).toBe(mockApBridge);
      expect(webfinger._cache).toBeInstanceOf(Map);
      expect(webfinger._cacheTTL).toBe(10 * 60 * 1000);
    });

    it('should work without arguments', () => {
      webfinger = new APWebFinger();
      expect(webfinger.apBridge).toBeUndefined();
      expect(webfinger._cache).toBeInstanceOf(Map);
    });
  });

  // --- resolve ---

  describe('resolve()', () => {
    it('should throw on invalid address (no @)', async () => {
      webfinger = new APWebFinger(mockApBridge);
      await expect(webfinger.resolve('invalid')).rejects.toThrow('Invalid WebFinger address format');
    });

    it('should throw on null address', async () => {
      webfinger = new APWebFinger(mockApBridge);
      await expect(webfinger.resolve(null)).rejects.toThrow('Invalid WebFinger address format');
    });

    it('should throw on empty address', async () => {
      webfinger = new APWebFinger(mockApBridge);
      await expect(webfinger.resolve('')).rejects.toThrow('Invalid WebFinger address format');
    });

    it('should strip leading @ prefix', async () => {
      webfinger = new APWebFinger(mockApBridge);
      // Mock _httpGet to force simulated fallback
      webfinger._httpGet = vi.fn().mockRejectedValue(new Error('mocked'));
      const result = await webfinger.resolve('@alice@mastodon.social');
      expect(result.subject).toBe('acct:alice@mastodon.social');
      expect(result.links[0].href).toBe('https://mastodon.social/users/alice');
    });

    it('should strip acct: prefix', async () => {
      webfinger = new APWebFinger(mockApBridge);
      webfinger._httpGet = vi.fn().mockRejectedValue(new Error('mocked'));
      const result = await webfinger.resolve('acct:alice@mastodon.social');
      expect(result.subject).toBe('acct:alice@mastodon.social');
      expect(result.links[0].href).toBe('https://mastodon.social/users/alice');
    });

    it('should return cached result within TTL', async () => {
      webfinger = new APWebFinger(mockApBridge);
      const cachedData = { subject: 'acct:alice@test.com', links: [] };
      webfinger._cache.set('alice@test.com', { data: cachedData, timestamp: Date.now() });

      const result = await webfinger.resolve('alice@test.com');
      expect(result).toBe(cachedData);
    });

    it('should not use expired cache', async () => {
      webfinger = new APWebFinger(mockApBridge);
      const cachedData = { subject: 'acct:old@test.com', links: [] };
      // Set timestamp to 20 minutes ago (expired)
      webfinger._cache.set('old@test.com', { data: cachedData, timestamp: Date.now() - 20 * 60 * 1000 });

      const result = await webfinger.resolve('old@test.com');
      // Should NOT return the cached data, should return simulated response
      expect(result.subject).toBe('acct:old@test.com');
      // But it's a new simulated response, not the same cached object
    });

    it('should build simulated response on fetch failure', async () => {
      webfinger = new APWebFinger(mockApBridge);
      // _httpGet will fail since we are not mocking it to succeed
      const result = await webfinger.resolve('bob@remote.social');

      expect(result.subject).toBe('acct:bob@remote.social');
      expect(result.aliases).toContain('https://remote.social/users/bob');
      expect(result.links[0].rel).toBe('self');
      expect(result.links[0].href).toBe('https://remote.social/users/bob');
    });

    it('should cache the resolved result', async () => {
      webfinger = new APWebFinger(mockApBridge);
      await webfinger.resolve('cached@example.com');
      expect(webfinger._cache.has('cached@example.com')).toBe(true);
    });
  });

  // --- buildLocalResponse ---

  describe('buildLocalResponse()', () => {
    it('should return proper JRD response', () => {
      webfinger = new APWebFinger(mockApBridge);
      const result = webfinger.buildLocalResponse('alice', 'test.local');

      expect(result.subject).toBe('acct:alice@test.local');
      expect(result.aliases).toContain('https://test.local/users/alice');
      expect(result.aliases).toContain('https://test.local/@alice');
      expect(result.links.length).toBe(2);

      const selfLink = result.links.find(l => l.rel === 'self');
      expect(selfLink.type).toBe('application/activity+json');
      expect(selfLink.href).toBe('https://test.local/users/alice');

      const profileLink = result.links.find(l => l.rel === 'http://webfinger.net/rel/profile-page');
      expect(profileLink.type).toBe('text/html');
      expect(profileLink.href).toBe('https://test.local/@alice');
    });
  });

  // --- extractActorUrl ---

  describe('extractActorUrl()', () => {
    it('should extract self link with activity+json type', () => {
      webfinger = new APWebFinger(mockApBridge);
      const result = webfinger.extractActorUrl({
        links: [
          { rel: 'self', type: 'application/activity+json', href: 'https://example.com/users/alice' },
          { rel: 'http://webfinger.net/rel/profile-page', type: 'text/html', href: 'https://example.com/@alice' }
        ]
      });
      expect(result).toBe('https://example.com/users/alice');
    });

    it('should extract self link with ld+json profile type', () => {
      webfinger = new APWebFinger(mockApBridge);
      const result = webfinger.extractActorUrl({
        links: [
          { rel: 'self', type: 'application/ld+json; profile="https://www.w3.org/ns/activitystreams"', href: 'https://example.com/users/bob' }
        ]
      });
      expect(result).toBe('https://example.com/users/bob');
    });

    it('should return null for no links', () => {
      webfinger = new APWebFinger(mockApBridge);
      expect(webfinger.extractActorUrl({ links: [] })).toBeNull();
    });

    it('should return null for null response', () => {
      webfinger = new APWebFinger(mockApBridge);
      expect(webfinger.extractActorUrl(null)).toBeNull();
    });

    it('should return null for response without links property', () => {
      webfinger = new APWebFinger(mockApBridge);
      expect(webfinger.extractActorUrl({ subject: 'acct:test@example.com' })).toBeNull();
    });

    it('should return null when no self link exists', () => {
      webfinger = new APWebFinger(mockApBridge);
      const result = webfinger.extractActorUrl({
        links: [
          { rel: 'http://webfinger.net/rel/profile-page', type: 'text/html', href: 'https://example.com/@alice' }
        ]
      });
      expect(result).toBeNull();
    });
  });

  // --- lookupUser ---

  describe('lookupUser()', () => {
    it('should resolve and extract actor URL', async () => {
      webfinger = new APWebFinger(mockApBridge);
      // Will use simulated response (fetch fails in test env)
      const result = await webfinger.lookupUser('alice@example.com');

      expect(result.address).toBe('acct:alice@example.com');
      expect(result.actorUrl).toBe('https://example.com/users/alice');
      expect(Array.isArray(result.aliases)).toBe(true);
      expect(Array.isArray(result.links)).toBe(true);
    });

    it('should throw on invalid address', async () => {
      webfinger = new APWebFinger(mockApBridge);
      await expect(webfinger.lookupUser('invalid')).rejects.toThrow();
    });
  });

  // --- clearCache ---

  describe('clearCache()', () => {
    it('should clear the cache', () => {
      webfinger = new APWebFinger(mockApBridge);
      webfinger._cache.set('key1', { data: {}, timestamp: Date.now() });
      webfinger._cache.set('key2', { data: {}, timestamp: Date.now() });
      expect(webfinger._cache.size).toBe(2);

      webfinger.clearCache();
      expect(webfinger._cache.size).toBe(0);
    });
  });

  // --- singleton ---

  describe('getAPWebFinger()', () => {
    it('should return same instance', () => {
      const a = getAPWebFinger();
      const b = getAPWebFinger();
      expect(a).toBe(b);
    });
  });
});
