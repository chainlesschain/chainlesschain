/**
 * Unit tests for Deployment Pipeline Store
 * @module stores/deployment.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useDeploymentStore } from '../../../src/renderer/stores/deployment';

describe('Deployment Store', () => {
  let mockInvoke: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setActivePinia(createPinia());
    mockInvoke = vi.fn();
    (window as any).electronAPI = { invoke: mockInvoke, on: vi.fn() };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ============================================================
  // Initial State
  // ============================================================

  describe('initial state', () => {
    it('should have correct defaults', () => {
      const store = useDeploymentStore();
      expect(store.currentPipeline).toBeNull();
      expect(store.pipelines).toEqual([]);
      expect(store.templates).toEqual([]);
      expect(store.metrics).toBeNull();
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  // ============================================================
  // Getters
  // ============================================================

  describe('getters', () => {
    it('activePipelines should filter running/paused', () => {
      const store = useDeploymentStore();
      store.pipelines = [
        { id: '1', status: 'running' } as any,
        { id: '2', status: 'paused' } as any,
        { id: '3', status: 'success' } as any,
        { id: '4', status: 'running' } as any,
      ];
      expect(store.activePipelines).toHaveLength(3);
      expect(store.activePipelines.map((p) => p.id)).toEqual(['1', '2', '4']);
    });

    it('pendingGates should find gate_pending stages', () => {
      const store = useDeploymentStore();
      store.pipelines = [
        {
          id: 'p1',
          name: 'Pipeline 1',
          stages: [
            { id: 's1', status: 'success' },
            { id: 's2', status: 'gate_pending' },
          ],
        } as any,
        {
          id: 'p2',
          name: 'Pipeline 2',
          stages: [{ id: 's3', status: 'running' }],
        } as any,
      ];
      expect(store.pendingGates).toHaveLength(1);
      expect(store.pendingGates[0].pipeline.id).toBe('p1');
      expect(store.pendingGates[0].stage.id).toBe('s2');
    });

    it('pipelineById should return correct pipeline', () => {
      const store = useDeploymentStore();
      store.pipelines = [
        { id: 'a', name: 'Pipeline A' } as any,
        { id: 'b', name: 'Pipeline B' } as any,
      ];
      expect(store.pipelineById('b')?.name).toBe('Pipeline B');
      expect(store.pipelineById('c')).toBeUndefined();
    });
  });

  // ============================================================
  // Actions - Pipeline Management
  // ============================================================

  describe('createPipeline()', () => {
    it('should create pipeline and refresh list', async () => {
      mockInvoke.mockImplementation((channel: string) => {
        if (channel === 'dev-pipeline:create') return { success: true, data: { id: 'p1' } };
        if (channel === 'dev-pipeline:get-all') return { success: true, data: [{ id: 'p1' }] };
        return { success: true };
      });

      const store = useDeploymentStore();
      const result = await store.createPipeline({ template: 'feature' });
      expect(result.success).toBe(true);
      expect(mockInvoke).toHaveBeenCalledWith('dev-pipeline:create', { template: 'feature' });
      expect(mockInvoke).toHaveBeenCalledWith('dev-pipeline:get-all');
    });

    it('should set error on failure', async () => {
      mockInvoke.mockResolvedValue({ success: false, error: 'Template not found' });

      const store = useDeploymentStore();
      await store.createPipeline({});
      expect(store.error).toBe('Template not found');
    });
  });

  describe('startPipeline()', () => {
    it('should start and update status', async () => {
      mockInvoke.mockImplementation((channel: string) => {
        if (channel === 'dev-pipeline:start') return { success: true };
        if (channel === 'dev-pipeline:get-status') return { success: true, data: { id: 'p1', status: 'running' } };
        return { success: true };
      });

      const store = useDeploymentStore();
      await store.startPipeline('p1');
      expect(mockInvoke).toHaveBeenCalledWith('dev-pipeline:start', 'p1');
    });
  });

  describe('pausePipeline()', () => {
    it('should pause pipeline', async () => {
      mockInvoke.mockResolvedValue({ success: true });

      const store = useDeploymentStore();
      const result = await store.pausePipeline('p1');
      expect(result.success).toBe(true);
      expect(mockInvoke).toHaveBeenCalledWith('dev-pipeline:pause', 'p1');
    });
  });

  describe('resumePipeline()', () => {
    it('should resume pipeline', async () => {
      mockInvoke.mockResolvedValue({ success: true });

      const store = useDeploymentStore();
      await store.resumePipeline('p1');
      expect(mockInvoke).toHaveBeenCalledWith('dev-pipeline:resume', 'p1');
    });
  });

  describe('cancelPipeline()', () => {
    it('should cancel pipeline', async () => {
      mockInvoke.mockResolvedValue({ success: true });

      const store = useDeploymentStore();
      await store.cancelPipeline('p1');
      expect(mockInvoke).toHaveBeenCalledWith('dev-pipeline:cancel', 'p1');
    });
  });

  describe('getStatus()', () => {
    it('should update currentPipeline and pipelines array', async () => {
      const pipeline = { id: 'p1', name: 'Test', status: 'running' };
      mockInvoke.mockResolvedValue({ success: true, data: pipeline });

      const store = useDeploymentStore();
      store.pipelines = [{ id: 'p1', name: 'Old', status: 'pending' } as any];
      await store.getStatus('p1');
      expect(store.currentPipeline).toEqual(pipeline);
      expect(store.pipelines[0].status).toBe('running');
    });
  });

  describe('getAllPipelines()', () => {
    it('should load all pipelines', async () => {
      const pipelines = [{ id: 'p1' }, { id: 'p2' }];
      mockInvoke.mockResolvedValue({ success: true, data: pipelines });

      const store = useDeploymentStore();
      await store.getAllPipelines();
      expect(store.pipelines).toEqual(pipelines);
    });
  });

  // ============================================================
  // Gate Approval
  // ============================================================

  describe('approveGate()', () => {
    it('should approve gate and refresh status', async () => {
      mockInvoke.mockImplementation((channel: string) => {
        if (channel === 'dev-pipeline:approve-gate') return { success: true };
        if (channel === 'dev-pipeline:get-status') return { success: true, data: {} };
        return { success: true };
      });

      const store = useDeploymentStore();
      await store.approveGate('p1', 's2');
      expect(mockInvoke).toHaveBeenCalledWith('dev-pipeline:approve-gate', 'p1', 's2');
    });
  });

  describe('rejectGate()', () => {
    it('should reject gate with reason', async () => {
      mockInvoke.mockResolvedValue({ success: true });

      const store = useDeploymentStore();
      await store.rejectGate('p1', 's2', 'security concern');
      expect(mockInvoke).toHaveBeenCalledWith('dev-pipeline:reject-gate', 'p1', 's2', 'security concern');
    });
  });

  // ============================================================
  // Details & Metrics
  // ============================================================

  describe('getArtifacts()', () => {
    it('should fetch artifacts', async () => {
      mockInvoke.mockResolvedValue({ success: true, data: [{ id: 'a1' }] });

      const store = useDeploymentStore();
      const result = await store.getArtifacts('p1');
      expect(result.success).toBe(true);
      expect(mockInvoke).toHaveBeenCalledWith('dev-pipeline:get-artifacts', 'p1');
    });
  });

  describe('getMetrics()', () => {
    it('should update metrics', async () => {
      const metrics = { totalRuns: 10, successRate: 0.85, avgDuration: 120000 };
      mockInvoke.mockResolvedValue({ success: true, data: metrics });

      const store = useDeploymentStore();
      await store.getMetrics('p1');
      expect(store.metrics).toEqual(metrics);
    });
  });

  describe('getTemplates()', () => {
    it('should load templates', async () => {
      const templates = [{ id: 'feature', name: 'Feature' }, { id: 'bugfix', name: 'Bugfix' }];
      mockInvoke.mockResolvedValue({ success: true, data: templates });

      const store = useDeploymentStore();
      await store.getTemplates();
      expect(store.templates).toEqual(templates);
    });
  });

  describe('configure()', () => {
    it('should update config', async () => {
      mockInvoke.mockResolvedValue({ success: true });

      const store = useDeploymentStore();
      const result = await store.configure({ parallelLimit: 5 });
      expect(result.success).toBe(true);
      expect(mockInvoke).toHaveBeenCalledWith('dev-pipeline:configure', { parallelLimit: 5 });
    });
  });

  // ============================================================
  // Event Listeners
  // ============================================================

  describe('initEventListeners()', () => {
    it('should register event listeners', () => {
      const mockOn = vi.fn();
      (window as any).electronAPI = { on: mockOn };

      const store = useDeploymentStore();
      store.initEventListeners();
      expect(mockOn).toHaveBeenCalledWith('dev-pipeline:stage-updated', expect.any(Function));
      expect(mockOn).toHaveBeenCalledWith('dev-pipeline:gate-pending', expect.any(Function));
    });

    it('should update stage on stage-updated event', () => {
      let stageUpdatedHandler: any;
      const mockOn = vi.fn((event, handler) => {
        if (event === 'dev-pipeline:stage-updated') stageUpdatedHandler = handler;
      });
      (window as any).electronAPI = { on: mockOn };

      const store = useDeploymentStore();
      store.currentPipeline = {
        id: 'p1',
        stages: [{ id: 's1', status: 'running' }] as any,
      } as any;

      store.initEventListeners();
      stageUpdatedHandler(null, { pipelineId: 'p1', stageId: 's1', status: 'success' });
      expect(store.currentPipeline.stages[0].status).toBe('success');
    });
  });

  // ============================================================
  // Stage Detail
  // ============================================================

  describe('getStageDetail()', () => {
    it('should fetch stage detail', async () => {
      const detail = { id: 's1', name: 'Build', status: 'success', output: 'logs...' };
      mockInvoke.mockResolvedValue({ success: true, data: detail });

      const store = useDeploymentStore();
      const result = await store.getStageDetail('p1', 's1');
      expect(result.success).toBe(true);
      expect(mockInvoke).toHaveBeenCalledWith('dev-pipeline:get-stage-detail', 'p1', 's1');
    });

    it('should handle error', async () => {
      mockInvoke.mockRejectedValue(new Error('Stage not found'));

      const store = useDeploymentStore();
      const result = await store.getStageDetail('p1', 'invalid');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Stage not found');
    });
  });

  // ============================================================
  // Error Handling for lifecycle actions
  // ============================================================

  describe('error handling', () => {
    it('createPipeline should handle exception', async () => {
      mockInvoke.mockRejectedValue(new Error('Network error'));

      const store = useDeploymentStore();
      const result = await store.createPipeline({});
      expect(result.success).toBe(false);
      expect(store.error).toBe('Network error');
      expect(store.loading).toBe(false);
    });

    it('startPipeline should handle exception', async () => {
      mockInvoke.mockRejectedValue(new Error('Start failed'));

      const store = useDeploymentStore();
      const result = await store.startPipeline('p1');
      expect(result.success).toBe(false);
      expect(store.error).toBe('Start failed');
      expect(store.loading).toBe(false);
    });

    it('pausePipeline should handle exception', async () => {
      mockInvoke.mockRejectedValue(new Error('Pause failed'));

      const store = useDeploymentStore();
      const result = await store.pausePipeline('p1');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Pause failed');
    });

    it('resumePipeline should handle exception', async () => {
      mockInvoke.mockRejectedValue(new Error('Resume failed'));

      const store = useDeploymentStore();
      const result = await store.resumePipeline('p1');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Resume failed');
    });

    it('cancelPipeline should handle exception', async () => {
      mockInvoke.mockRejectedValue(new Error('Cancel failed'));

      const store = useDeploymentStore();
      const result = await store.cancelPipeline('p1');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Cancel failed');
    });

    it('approveGate should handle exception', async () => {
      mockInvoke.mockRejectedValue(new Error('Approve failed'));

      const store = useDeploymentStore();
      const result = await store.approveGate('p1', 's1');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Approve failed');
    });

    it('rejectGate should handle exception', async () => {
      mockInvoke.mockRejectedValue(new Error('Reject failed'));

      const store = useDeploymentStore();
      const result = await store.rejectGate('p1', 's1', 'reason');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Reject failed');
    });

    it('getArtifacts should handle exception', async () => {
      mockInvoke.mockRejectedValue(new Error('Fetch failed'));

      const store = useDeploymentStore();
      const result = await store.getArtifacts('p1');
      expect(result.success).toBe(false);
    });

    it('getMetrics should handle exception', async () => {
      mockInvoke.mockRejectedValue(new Error('Metrics fetch failed'));

      const store = useDeploymentStore();
      const result = await store.getMetrics();
      expect(result.success).toBe(false);
    });

    it('getTemplates should handle exception', async () => {
      mockInvoke.mockRejectedValue(new Error('Templates fetch failed'));

      const store = useDeploymentStore();
      const result = await store.getTemplates();
      expect(result.success).toBe(false);
    });

    it('configure should handle exception', async () => {
      mockInvoke.mockRejectedValue(new Error('Config failed'));

      const store = useDeploymentStore();
      const result = await store.configure({});
      expect(result.success).toBe(false);
    });

    it('getStatus should handle exception', async () => {
      mockInvoke.mockRejectedValue(new Error('Status failed'));

      const store = useDeploymentStore();
      const result = await store.getStatus('p1');
      expect(result.success).toBe(false);
    });

    it('getAllPipelines should handle exception', async () => {
      mockInvoke.mockRejectedValue(new Error('Fetch failed'));

      const store = useDeploymentStore();
      const result = await store.getAllPipelines();
      expect(result.success).toBe(false);
      expect(store.loading).toBe(false);
    });
  });

  // ============================================================
  // Event Listener: gate-pending
  // ============================================================

  describe('gate-pending event handler', () => {
    it('should set stage status to gate_pending', () => {
      let gatePendingHandler: any;
      const mockOn = vi.fn((event, handler) => {
        if (event === 'dev-pipeline:gate-pending') gatePendingHandler = handler;
      });
      (window as any).electronAPI = { on: mockOn };

      const store = useDeploymentStore();
      store.currentPipeline = {
        id: 'p1',
        stages: [{ id: 's1', status: 'running' }, { id: 's2', status: 'pending' }] as any,
      } as any;

      store.initEventListeners();
      gatePendingHandler(null, { pipelineId: 'p1', stageId: 's2' });
      expect(store.currentPipeline.stages[1].status).toBe('gate_pending');
    });

    it('should ignore events for different pipelines', () => {
      let stageUpdatedHandler: any;
      const mockOn = vi.fn((event, handler) => {
        if (event === 'dev-pipeline:stage-updated') stageUpdatedHandler = handler;
      });
      (window as any).electronAPI = { on: mockOn };

      const store = useDeploymentStore();
      store.currentPipeline = {
        id: 'p1',
        stages: [{ id: 's1', status: 'running' }] as any,
      } as any;

      store.initEventListeners();
      stageUpdatedHandler(null, { pipelineId: 'p2', stageId: 's1', status: 'success' });
      expect(store.currentPipeline.stages[0].status).toBe('running');
    });
  });

  // ============================================================
  // Loading state verification
  // ============================================================

  describe('loading state', () => {
    it('createPipeline should toggle loading', async () => {
      mockInvoke.mockResolvedValue({ success: false, error: 'fail' });

      const store = useDeploymentStore();
      expect(store.loading).toBe(false);
      const promise = store.createPipeline({});
      expect(store.loading).toBe(true);
      await promise;
      expect(store.loading).toBe(false);
    });

    it('startPipeline should toggle loading', async () => {
      mockInvoke.mockResolvedValue({ success: false, error: 'fail' });

      const store = useDeploymentStore();
      const promise = store.startPipeline('p1');
      expect(store.loading).toBe(true);
      await promise;
      expect(store.loading).toBe(false);
    });
  });

  describe('reset()', () => {
    it('should reset all state', () => {
      const store = useDeploymentStore();
      store.currentPipeline = { id: 'p1' } as any;
      store.pipelines = [{ id: 'p1' }] as any;
      store.templates = [{ id: 't1' }] as any;
      store.metrics = { totalRuns: 10 } as any;
      store.loading = true;
      store.error = 'test error';

      store.reset();
      expect(store.currentPipeline).toBeNull();
      expect(store.pipelines).toEqual([]);
      expect(store.templates).toEqual([]);
      expect(store.metrics).toBeNull();
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });
  });
});
