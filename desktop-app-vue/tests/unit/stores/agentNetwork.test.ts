/**
 * Unit tests for Agent Network Store
 * @module stores/agentNetwork.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useAgentNetworkStore } from '../../../src/renderer/stores/agentNetwork';

describe('AgentNetwork Store', () => {
  let mockInvoke: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setActivePinia(createPinia());
    mockInvoke = vi.fn();
    (window as any).electronAPI = { invoke: mockInvoke, on: vi.fn() };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initial state', () => {
    it('should have correct defaults', () => {
      const store = useAgentNetworkStore();
      expect(store.myDID).toBeNull();
      expect(store.allDIDs).toEqual([]);
      expect(store.discoveredAgents).toEqual([]);
      expect(store.remoteTasks).toEqual([]);
      expect(store.networkStats).toBeNull();
      expect(store.reputationScores).toEqual([]);
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  describe('getters', () => {
    it('onlineAgents should filter online agents', () => {
      const store = useAgentNetworkStore();
      store.discoveredAgents = [
        { did: 'a1', online: true } as any,
        { did: 'a2', online: false } as any,
        { did: 'a3', online: true } as any,
      ];
      expect(store.onlineAgents).toHaveLength(2);
    });

    it('agentsBySkill should filter by skill', () => {
      const store = useAgentNetworkStore();
      store.discoveredAgents = [
        { did: 'a1', skills: ['code-review'] } as any,
        { did: 'a2', skills: ['translate'] } as any,
        { did: 'a3', skills: ['code-review', 'translate'] } as any,
      ];
      expect(store.agentsBySkill('code-review')).toHaveLength(2);
    });

    it('myReputation should return my score', () => {
      const store = useAgentNetworkStore();
      store.myDID = { did: 'my-did' } as any;
      store.reputationScores = [
        { did: 'my-did', score: 0.92 } as any,
        { did: 'other-did', score: 0.75 } as any,
      ];
      expect(store.myReputation).toBe(0.92);
    });

    it('tasksByStatus should filter tasks', () => {
      const store = useAgentNetworkStore();
      store.remoteTasks = [
        { id: 't1', status: 'running' } as any,
        { id: 't2', status: 'completed' } as any,
        { id: 't3', status: 'running' } as any,
      ];
      expect(store.tasksByStatus('running')).toHaveLength(2);
    });
  });

  describe('DID management', () => {
    it('createDID should create and store DID', async () => {
      const did = { did: 'did:cc:test', publicKey: 'key123' };
      mockInvoke.mockResolvedValue({ success: true, data: did });

      const store = useAgentNetworkStore();
      const result = await store.createDID({ skills: ['test'] });
      expect(result.success).toBe(true);
      expect(store.myDID).toEqual(did);
      expect(mockInvoke).toHaveBeenCalledWith('agent-did:create', { skills: ['test'] });
    });

    it('resolveDID should resolve DID', async () => {
      mockInvoke.mockResolvedValue({ success: true, data: { did: 'did:cc:test' } });

      const store = useAgentNetworkStore();
      const result = await store.resolveDID('did:cc:test');
      expect(result.success).toBe(true);
    });

    it('getAllDIDs should load all DIDs', async () => {
      const dids = [{ did: 'd1' }, { did: 'd2' }];
      mockInvoke.mockResolvedValue({ success: true, data: dids });

      const store = useAgentNetworkStore();
      await store.getAllDIDs();
      expect(store.allDIDs).toEqual(dids);
    });

    it('revokeDID should revoke and refresh', async () => {
      mockInvoke.mockImplementation((channel) => {
        if (channel === 'agent-did:revoke') return { success: true };
        if (channel === 'agent-did:get-all') return { success: true, data: [] };
        return { success: true };
      });

      const store = useAgentNetworkStore();
      await store.revokeDID('did:cc:test');
      expect(mockInvoke).toHaveBeenCalledWith('agent-did:revoke', 'did:cc:test');
    });
  });

  describe('agent discovery', () => {
    it('discoverAgents should find agents', async () => {
      const agents = [{ did: 'a1', name: 'Agent 1' }, { did: 'a2', name: 'Agent 2' }];
      mockInvoke.mockResolvedValue({ success: true, data: agents });

      const store = useAgentNetworkStore();
      await store.discoverAgents({ skill: 'test' });
      expect(store.discoveredAgents).toEqual(agents);
    });

    it('registerAgent should register to federation', async () => {
      mockInvoke.mockResolvedValue({ success: true });

      const store = useAgentNetworkStore();
      const result = await store.registerAgent({ skills: ['test'] });
      expect(result.success).toBe(true);
      expect(mockInvoke).toHaveBeenCalledWith('fed-registry:register', { skills: ['test'] });
    });

    it('querySkills should query by skill', async () => {
      mockInvoke.mockResolvedValue({ success: true, data: [] });

      const store = useAgentNetworkStore();
      await store.querySkills({ skill: 'code-review' });
      expect(mockInvoke).toHaveBeenCalledWith('fed-registry:query-skills', { skill: 'code-review' });
    });

    it('getNetworkStats should load stats', async () => {
      const stats = { totalNodes: 50, onlineNodes: 30, totalSkills: 120 };
      mockInvoke.mockResolvedValue({ success: true, data: stats });

      const store = useAgentNetworkStore();
      await store.getNetworkStats();
      expect(store.networkStats).toEqual(stats);
    });
  });

  describe('credential management', () => {
    it('issueCredential should issue credential', async () => {
      mockInvoke.mockResolvedValue({ success: true, data: { id: 'vc1' } });

      const store = useAgentNetworkStore();
      const result = await store.issueCredential({ type: 'skill', claims: {} });
      expect(result.success).toBe(true);
    });

    it('verifyCredential should verify credential', async () => {
      mockInvoke.mockResolvedValue({ success: true, data: { valid: true } });

      const store = useAgentNetworkStore();
      const result = await store.verifyCredential({ id: 'vc1' });
      expect(result.success).toBe(true);
    });

    it('revokeCredential should revoke credential', async () => {
      mockInvoke.mockResolvedValue({ success: true });

      const store = useAgentNetworkStore();
      await store.revokeCredential('vc1');
      expect(mockInvoke).toHaveBeenCalledWith('agent-cred:revoke', 'vc1');
    });
  });

  describe('cross-org tasks', () => {
    it('routeTask should route and refresh log', async () => {
      mockInvoke.mockImplementation((channel) => {
        if (channel === 'cross-org:route-task') return { success: true, data: { id: 't1' } };
        if (channel === 'cross-org:get-log') return { success: true, data: [{ id: 't1' }] };
        return { success: true };
      });

      const store = useAgentNetworkStore();
      await store.routeTask({ type: 'test', targetAgent: 'a1' });
      expect(mockInvoke).toHaveBeenCalledWith('cross-org:route-task', { type: 'test', targetAgent: 'a1' });
    });

    it('getTaskStatus should get status', async () => {
      mockInvoke.mockResolvedValue({ success: true, data: { status: 'running' } });

      const store = useAgentNetworkStore();
      const result = await store.getTaskStatus('t1');
      expect(result.success).toBe(true);
    });

    it('cancelTask should cancel and refresh', async () => {
      mockInvoke.mockImplementation((channel) => {
        if (channel === 'cross-org:cancel-task') return { success: true };
        if (channel === 'cross-org:get-log') return { success: true, data: [] };
        return { success: true };
      });

      const store = useAgentNetworkStore();
      await store.cancelTask('t1');
      expect(mockInvoke).toHaveBeenCalledWith('cross-org:cancel-task', 't1');
    });

    it('getTaskLog should load tasks', async () => {
      const tasks = [{ id: 't1' }, { id: 't2' }];
      mockInvoke.mockResolvedValue({ success: true, data: tasks });

      const store = useAgentNetworkStore();
      await store.getTaskLog();
      expect(store.remoteTasks).toEqual(tasks);
    });
  });

  describe('reputation system', () => {
    it('getReputation should get score', async () => {
      mockInvoke.mockResolvedValue({ success: true, data: { score: 0.85 } });

      const store = useAgentNetworkStore();
      const result = await store.getReputation('did:cc:test');
      expect(result.success).toBe(true);
    });

    it('getRanking should load ranking', async () => {
      const ranking = [{ did: 'd1', score: 0.95, rank: 1 }, { did: 'd2', score: 0.88, rank: 2 }];
      mockInvoke.mockResolvedValue({ success: true, data: ranking });

      const store = useAgentNetworkStore();
      await store.getRanking({ limit: 10 });
      expect(store.reputationScores).toEqual(ranking);
    });

    it('updateReputation should update score', async () => {
      mockInvoke.mockResolvedValue({ success: true });

      const store = useAgentNetworkStore();
      await store.updateReputation('did:cc:test', { quality: 5 });
      expect(mockInvoke).toHaveBeenCalledWith('reputation:update', 'did:cc:test', { quality: 5 });
    });

    it('getReputationHistory should get history', async () => {
      mockInvoke.mockResolvedValue({ success: true, data: [] });

      const store = useAgentNetworkStore();
      const result = await store.getReputationHistory('did:cc:test');
      expect(result.success).toBe(true);
    });
  });

  // ============================================================
  // getConfig
  // ============================================================

  describe('getConfig()', () => {
    it('should get decentralized config', async () => {
      const config = { networkId: 'mainnet', maxNodes: 100 };
      mockInvoke.mockResolvedValue({ success: true, data: config });

      const store = useAgentNetworkStore();
      const result = await store.getConfig();
      expect(result.success).toBe(true);
      expect(mockInvoke).toHaveBeenCalledWith('decentralized:get-config');
    });

    it('should handle config fetch error', async () => {
      mockInvoke.mockRejectedValue(new Error('Config unavailable'));

      const store = useAgentNetworkStore();
      const result = await store.getConfig();
      expect(result.success).toBe(false);
      expect(result.error).toBe('Config unavailable');
    });
  });

  // ============================================================
  // Event Listeners
  // ============================================================

  describe('initEventListeners()', () => {
    it('should register event listeners', () => {
      const mockOn = vi.fn();
      (window as any).electronAPI = { on: mockOn };

      const store = useAgentNetworkStore();
      store.initEventListeners();
      expect(mockOn).toHaveBeenCalledWith('agent-network:agent-discovered', expect.any(Function));
      expect(mockOn).toHaveBeenCalledWith('agent-network:task-updated', expect.any(Function));
    });

    it('should add new agent on agent-discovered event', () => {
      let discoveredHandler: any;
      const mockOn = vi.fn((event, handler) => {
        if (event === 'agent-network:agent-discovered') discoveredHandler = handler;
      });
      (window as any).electronAPI = { on: mockOn };

      const store = useAgentNetworkStore();
      store.discoveredAgents = [];
      store.initEventListeners();

      discoveredHandler(null, { did: 'did:cc:new', name: 'New Agent', skills: ['test'], online: true });
      expect(store.discoveredAgents).toHaveLength(1);
      expect(store.discoveredAgents[0].did).toBe('did:cc:new');
    });

    it('should not duplicate agent on agent-discovered event', () => {
      let discoveredHandler: any;
      const mockOn = vi.fn((event, handler) => {
        if (event === 'agent-network:agent-discovered') discoveredHandler = handler;
      });
      (window as any).electronAPI = { on: mockOn };

      const store = useAgentNetworkStore();
      store.discoveredAgents = [{ did: 'did:cc:existing', name: 'Existing' } as any];
      store.initEventListeners();

      discoveredHandler(null, { did: 'did:cc:existing', name: 'Existing Updated' });
      expect(store.discoveredAgents).toHaveLength(1);
    });

    it('should update task on task-updated event', () => {
      let taskUpdatedHandler: any;
      const mockOn = vi.fn((event, handler) => {
        if (event === 'agent-network:task-updated') taskUpdatedHandler = handler;
      });
      (window as any).electronAPI = { on: mockOn };

      const store = useAgentNetworkStore();
      store.remoteTasks = [{ id: 't1', status: 'running' } as any];
      store.initEventListeners();

      taskUpdatedHandler(null, { id: 't1', status: 'completed', output: 'done' });
      expect(store.remoteTasks[0].status).toBe('completed');
      expect(store.remoteTasks[0].output).toBe('done');
    });

    it('should ignore task-updated for unknown tasks', () => {
      let taskUpdatedHandler: any;
      const mockOn = vi.fn((event, handler) => {
        if (event === 'agent-network:task-updated') taskUpdatedHandler = handler;
      });
      (window as any).electronAPI = { on: mockOn };

      const store = useAgentNetworkStore();
      store.remoteTasks = [{ id: 't1', status: 'running' } as any];
      store.initEventListeners();

      taskUpdatedHandler(null, { id: 't999', status: 'completed' });
      expect(store.remoteTasks[0].status).toBe('running');
    });
  });

  // ============================================================
  // Error handling
  // ============================================================

  describe('error handling', () => {
    it('createDID should handle exception', async () => {
      mockInvoke.mockRejectedValue(new Error('DID creation failed'));

      const store = useAgentNetworkStore();
      const result = await store.createDID();
      expect(result.success).toBe(false);
      expect(store.error).toBe('DID creation failed');
      expect(store.loading).toBe(false);
    });

    it('createDID should handle API error response', async () => {
      mockInvoke.mockResolvedValue({ success: false, error: 'Key generation failed' });

      const store = useAgentNetworkStore();
      await store.createDID();
      expect(store.error).toBe('Key generation failed');
      expect(store.myDID).toBeNull();
    });

    it('discoverAgents should handle exception', async () => {
      mockInvoke.mockRejectedValue(new Error('Network unreachable'));

      const store = useAgentNetworkStore();
      const result = await store.discoverAgents();
      expect(result.success).toBe(false);
      expect(store.error).toBe('Network unreachable');
      expect(store.loading).toBe(false);
    });

    it('discoverAgents should handle API error response', async () => {
      mockInvoke.mockResolvedValue({ success: false, error: 'DHT timeout' });

      const store = useAgentNetworkStore();
      await store.discoverAgents();
      expect(store.error).toBe('DHT timeout');
    });

    it('registerAgent should handle exception', async () => {
      mockInvoke.mockRejectedValue(new Error('Registration failed'));

      const store = useAgentNetworkStore();
      const result = await store.registerAgent({});
      expect(result.success).toBe(false);
      expect(store.error).toBe('Registration failed');
    });

    it('registerAgent should set error on API failure', async () => {
      mockInvoke.mockResolvedValue({ success: false, error: 'Duplicate agent' });

      const store = useAgentNetworkStore();
      await store.registerAgent({});
      expect(store.error).toBe('Duplicate agent');
    });

    it('routeTask should handle exception', async () => {
      mockInvoke.mockRejectedValue(new Error('Routing failed'));

      const store = useAgentNetworkStore();
      const result = await store.routeTask({});
      expect(result.success).toBe(false);
      expect(store.loading).toBe(false);
    });

    it('resolveDID should handle exception', async () => {
      mockInvoke.mockRejectedValue(new Error('Resolve error'));

      const store = useAgentNetworkStore();
      const result = await store.resolveDID('invalid');
      expect(result.success).toBe(false);
    });

    it('querySkills should handle exception', async () => {
      mockInvoke.mockRejectedValue(new Error('Query error'));

      const store = useAgentNetworkStore();
      const result = await store.querySkills({});
      expect(result.success).toBe(false);
    });

    it('issueCredential should handle exception', async () => {
      mockInvoke.mockRejectedValue(new Error('Issue error'));

      const store = useAgentNetworkStore();
      const result = await store.issueCredential({});
      expect(result.success).toBe(false);
    });

    it('verifyCredential should handle exception', async () => {
      mockInvoke.mockRejectedValue(new Error('Verify error'));

      const store = useAgentNetworkStore();
      const result = await store.verifyCredential({});
      expect(result.success).toBe(false);
    });
  });

  // ============================================================
  // Getters edge cases
  // ============================================================

  describe('getter edge cases', () => {
    it('myReputation should return 0 when no DID', () => {
      const store = useAgentNetworkStore();
      expect(store.myReputation).toBe(0);
    });

    it('myReputation should return 0 when DID not in scores', () => {
      const store = useAgentNetworkStore();
      store.myDID = { did: 'unknown-did' } as any;
      store.reputationScores = [{ did: 'other-did', score: 0.9 } as any];
      expect(store.myReputation).toBe(0);
    });

    it('tasksByStatus should return empty array for no matches', () => {
      const store = useAgentNetworkStore();
      store.remoteTasks = [{ id: 't1', status: 'running' } as any];
      expect(store.tasksByStatus('failed')).toEqual([]);
    });

    it('agentsBySkill should return empty for unknown skill', () => {
      const store = useAgentNetworkStore();
      store.discoveredAgents = [{ did: 'a1', skills: ['coding'] } as any];
      expect(store.agentsBySkill('unknown-skill')).toEqual([]);
    });
  });

  describe('reset()', () => {
    it('should reset all state', () => {
      const store = useAgentNetworkStore();
      store.myDID = { did: 'd1' } as any;
      store.allDIDs = [{ did: 'd1' }] as any;
      store.discoveredAgents = [{ did: 'a1' }] as any;
      store.remoteTasks = [{ id: 't1' }] as any;
      store.networkStats = { totalNodes: 50 } as any;
      store.reputationScores = [{ did: 'd1', score: 0.9 }] as any;
      store.loading = true;
      store.error = 'some error';

      store.reset();
      expect(store.myDID).toBeNull();
      expect(store.allDIDs).toEqual([]);
      expect(store.discoveredAgents).toEqual([]);
      expect(store.remoteTasks).toEqual([]);
      expect(store.networkStats).toBeNull();
      expect(store.reputationScores).toEqual([]);
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });
  });
});
