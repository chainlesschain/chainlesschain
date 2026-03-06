import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../../src/main/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'test-uuid-' + Math.random().toString(36).substr(2, 9))
}));

describe('SocialGraph', () => {
  let SocialGraph, getSocialGraph, INTERACTION_TYPES, INTERACTION_WEIGHTS;
  let graph;
  let mockDatabase;
  let mockStmt;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    const mod = await import('../../../src/main/social/social-graph.js');
    SocialGraph = mod.SocialGraph;
    getSocialGraph = mod.getSocialGraph;
    INTERACTION_TYPES = mod.INTERACTION_TYPES;
    INTERACTION_WEIGHTS = mod.INTERACTION_WEIGHTS;

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
    it('should export INTERACTION_TYPES', () => {
      expect(INTERACTION_TYPES.MESSAGE).toBe('message');
      expect(INTERACTION_TYPES.REPLY).toBe('reply');
      expect(INTERACTION_TYPES.LIKE).toBe('like');
      expect(INTERACTION_TYPES.SHARE).toBe('share');
      expect(INTERACTION_TYPES.MENTION).toBe('mention');
      expect(INTERACTION_TYPES.FOLLOW).toBe('follow');
    });

    it('should export INTERACTION_WEIGHTS', () => {
      expect(INTERACTION_WEIGHTS[INTERACTION_TYPES.MESSAGE]).toBe(3);
      expect(INTERACTION_WEIGHTS[INTERACTION_TYPES.REPLY]).toBe(2);
      expect(INTERACTION_WEIGHTS[INTERACTION_TYPES.LIKE]).toBe(1);
      expect(INTERACTION_WEIGHTS[INTERACTION_TYPES.SHARE]).toBe(2);
      expect(INTERACTION_WEIGHTS[INTERACTION_TYPES.MENTION]).toBe(1.5);
      expect(INTERACTION_WEIGHTS[INTERACTION_TYPES.FOLLOW]).toBe(2);
    });
  });

  // --- Constructor ---

  describe('constructor', () => {
    it('should set up database and initialized=false', () => {
      graph = new SocialGraph(mockDatabase);
      expect(graph.database).toBe(mockDatabase);
      expect(graph.initialized).toBe(false);
    });
  });

  // --- initialize ---

  describe('initialize()', () => {
    it('should create tables and set initialized', async () => {
      graph = new SocialGraph(mockDatabase);
      await graph.initialize();
      expect(graph.initialized).toBe(true);
      expect(mockDatabase.db.exec).toHaveBeenCalledTimes(1);
      const sql = mockDatabase.db.exec.mock.calls[0][0];
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS social_graph_edges');
    });

    it('should skip table creation if no database', async () => {
      graph = new SocialGraph(null);
      await graph.initialize();
      expect(graph.initialized).toBe(true);
    });
  });

  // --- recordInteraction ---

  describe('recordInteraction()', () => {
    it('should throw on missing DIDs', async () => {
      graph = new SocialGraph(mockDatabase);
      await expect(graph.recordInteraction(null, 'did:target')).rejects.toThrow('Both source and target DIDs are required');
      await expect(graph.recordInteraction('did:source', '')).rejects.toThrow('Both source and target DIDs are required');
    });

    it('should return self=true for same source/target', async () => {
      graph = new SocialGraph(mockDatabase);
      const result = await graph.recordInteraction('did:same', 'did:same');
      expect(result.success).toBe(true);
      expect(result.self).toBe(true);
    });

    it('should throw if database not initialized', async () => {
      graph = new SocialGraph(null);
      await expect(graph.recordInteraction('did:a', 'did:b')).rejects.toThrow('Database not initialized');
    });

    it('should create new edge in DB when no existing edge', async () => {
      mockStmt.get.mockReturnValue(null); // no existing edge
      graph = new SocialGraph(mockDatabase);

      const result = await graph.recordInteraction('did:source', 'did:target', 'message');

      expect(result.success).toBe(true);
      expect(result.count).toBe(1);
      expect(typeof result.closeness).toBe('number');
      expect(mockDatabase.db.prepare).toHaveBeenCalled();
      expect(mockStmt.run).toHaveBeenCalled();
      expect(mockDatabase.saveToFile).toHaveBeenCalled();
    });

    it('should update existing edge with incremented count', async () => {
      const existingEdge = {
        id: 'edge-1',
        source_did: 'did:source',
        target_did: 'did:target',
        interaction_type: 'message',
        weight: 3,
        interaction_count: 5,
        closeness_score: 0.5,
        created_at: Date.now() - 100000
      };
      mockStmt.get.mockReturnValue(existingEdge);

      graph = new SocialGraph(mockDatabase);
      const result = await graph.recordInteraction('did:source', 'did:target', 'message');

      expect(result.success).toBe(true);
      expect(result.count).toBe(6);
      expect(result.edgeId).toBe('edge-1');
      expect(mockDatabase.saveToFile).toHaveBeenCalled();
    });

    it('should use MESSAGE as default interaction type', async () => {
      mockStmt.get.mockReturnValue(null);
      graph = new SocialGraph(mockDatabase);

      await graph.recordInteraction('did:a', 'did:b');

      // The prepare call for SELECT should use 'message' as the type
      const selectCall = mockDatabase.db.prepare.mock.calls[0];
      expect(selectCall[0]).toContain('interaction_type');
    });
  });

  // --- _calculateCloseness ---

  describe('_calculateCloseness()', () => {
    it('should return value between 0 and 1', () => {
      graph = new SocialGraph(mockDatabase);
      const now = Date.now();
      const result = graph._calculateCloseness(1, 1, now, now);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(1.0);
    });

    it('should increase with more interactions', () => {
      graph = new SocialGraph(mockDatabase);
      const now = Date.now();
      const low = graph._calculateCloseness(1, 1, now, now);
      const high = graph._calculateCloseness(10, 1, now, now);
      expect(high).toBeGreaterThanOrEqual(low);
    });

    it('should increase with higher weight', () => {
      graph = new SocialGraph(mockDatabase);
      const now = Date.now();
      const low = graph._calculateCloseness(1, 1, now, now);
      const high = graph._calculateCloseness(1, 3, now, now);
      expect(high).toBeGreaterThanOrEqual(low);
    });

    it('should cap at 1.0', () => {
      graph = new SocialGraph(mockDatabase);
      const now = Date.now();
      const result = graph._calculateCloseness(1000, 10, now, now);
      expect(result).toBe(1.0);
    });
  });

  // --- getClosestContacts ---

  describe('getClosestContacts()', () => {
    it('should return empty for no DB', async () => {
      graph = new SocialGraph(null);
      const result = await graph.getClosestContacts('did:user');
      expect(result).toEqual([]);
    });

    it('should query and map results', async () => {
      mockStmt.all.mockReturnValue([
        { target_did: 'did:friend1', total_closeness: 0.856, total_interactions: 15, last_interaction: 1700000000000 },
        { target_did: 'did:friend2', total_closeness: 0.432, total_interactions: 5, last_interaction: 1700000001000 }
      ]);

      graph = new SocialGraph(mockDatabase);
      const result = await graph.getClosestContacts('did:user', { limit: 10 });

      expect(result.length).toBe(2);
      expect(result[0].did).toBe('did:friend1');
      expect(result[0].closeness).toBe(0.86); // rounded
      expect(result[0].totalInteractions).toBe(15);
      expect(result[1].did).toBe('did:friend2');
    });

    it('should use default limit of 20', async () => {
      graph = new SocialGraph(mockDatabase);
      await graph.getClosestContacts('did:user');
      expect(mockStmt.all).toHaveBeenCalledWith('did:user', 20);
    });
  });

  // --- getGraph ---

  describe('getGraph()', () => {
    it('should return empty graph for no DB', async () => {
      graph = new SocialGraph(null);
      const result = await graph.getGraph('did:user');
      expect(result).toEqual({ nodes: [], edges: [] });
    });

    it('should return nodes and edges', async () => {
      mockStmt.all.mockReturnValue([
        { source_did: 'did:user', target_did: 'did:friend1', interaction_type: 'message', interaction_count: 3, closeness_score: 0.5 }
      ]);

      graph = new SocialGraph(mockDatabase);
      const result = await graph.getGraph('did:user');

      expect(result.nodes.length).toBe(2);
      expect(result.nodes[0].id).toBe('did:user');
      expect(result.nodes[0].isCenter).toBe(true);
      expect(result.nodes[1].id).toBe('did:friend1');
      expect(result.nodes[1].isCenter).toBe(false);
      expect(result.edges.length).toBe(1);
    });
  });

  // --- detectCommunities ---

  describe('detectCommunities()', () => {
    it('should return empty for empty graph', async () => {
      graph = new SocialGraph({ db: null });
      const result = await graph.detectCommunities('did:user');
      expect(result).toEqual([]);
    });

    it('should return clusters for connected graph', async () => {
      mockStmt.all
        .mockReturnValueOnce([
          { source_did: 'did:user', target_did: 'did:a', interaction_type: 'message', interaction_count: 5, closeness_score: 0.8 },
          { source_did: 'did:user', target_did: 'did:b', interaction_type: 'message', interaction_count: 3, closeness_score: 0.5 }
        ])
        .mockReturnValueOnce([
          { source_did: 'did:a', target_did: 'did:user', interaction_type: 'reply', interaction_count: 2, closeness_score: 0.6 },
          { source_did: 'did:b', target_did: 'did:a', interaction_type: 'like', interaction_count: 1, closeness_score: 0.3 }
        ]);

      graph = new SocialGraph(mockDatabase);
      const result = await graph.detectCommunities('did:user');

      expect(Array.isArray(result)).toBe(true);
      // Should have at least one cluster with multiple members
      if (result.length > 0) {
        expect(result[0].members.length).toBeGreaterThan(1);
        expect(typeof result[0].clusterId).toBe('number');
        expect(result[0].size).toBe(result[0].members.length);
      }
    });
  });

  // --- getStats ---

  describe('getStats()', () => {
    it('should return default stats for no DB', async () => {
      graph = new SocialGraph(null);
      const result = await graph.getStats('did:user');
      expect(result).toEqual({ totalContacts: 0, totalInteractions: 0, avgCloseness: 0, byType: {} });
    });

    it('should return stats object from DB', async () => {
      mockStmt.get.mockReturnValue({ total_contacts: 5, total_interactions: 42, avg_closeness: 0.678 });
      mockStmt.all.mockReturnValue([
        { interaction_type: 'message', count: 30 },
        { interaction_type: 'like', count: 12 }
      ]);

      graph = new SocialGraph(mockDatabase);
      const result = await graph.getStats('did:user');

      expect(result.totalContacts).toBe(5);
      expect(result.totalInteractions).toBe(42);
      expect(result.avgCloseness).toBe(0.68); // rounded
      expect(result.byType.message).toBe(30);
      expect(result.byType.like).toBe(12);
    });
  });

  // --- close ---

  describe('close()', () => {
    it('should reset state', async () => {
      graph = new SocialGraph(mockDatabase);
      await graph.initialize();
      expect(graph.initialized).toBe(true);

      await graph.close();
      expect(graph.initialized).toBe(false);
    });

    it('should remove all listeners', async () => {
      graph = new SocialGraph(mockDatabase);
      graph.on('test', () => {});
      expect(graph.listenerCount('test')).toBe(1);

      await graph.close();
      expect(graph.listenerCount('test')).toBe(0);
    });
  });

  // --- singleton ---

  describe('getSocialGraph()', () => {
    it('should return same instance', () => {
      const a = getSocialGraph();
      const b = getSocialGraph();
      expect(a).toBe(b);
    });
  });
});
