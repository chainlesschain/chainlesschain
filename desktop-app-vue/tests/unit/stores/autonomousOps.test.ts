/**
 * Unit tests for Autonomous Ops Store
 * @module stores/autonomousOps.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useAutonomousOpsStore } from '../../../src/renderer/stores/autonomousOps';

describe('AutonomousOps Store', () => {
  let mockInvoke: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setActivePinia(createPinia());
    mockInvoke = vi.fn();
    (window as any).electronAPI = { invoke: mockInvoke };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initial state', () => {
    it('should have correct defaults', () => {
      const store = useAutonomousOpsStore();
      expect(store.incidents).toEqual([]);
      expect(store.playbooks).toEqual([]);
      expect(store.alerts).toEqual([]);
      expect(store.baseline).toBeNull();
      expect(store.postmortems).toEqual([]);
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  describe('getters', () => {
    it('activeIncidents should filter non-closed incidents', () => {
      const store = useAutonomousOpsStore();
      store.incidents = [
        { id: 'i1', status: 'open' } as any,
        { id: 'i2', status: 'acknowledged' } as any,
        { id: 'i3', status: 'resolved' } as any,
        { id: 'i4', status: 'resolving' } as any,
        { id: 'i5', status: 'closed' } as any,
      ];
      expect(store.activeIncidents).toHaveLength(3);
      expect(store.activeIncidents.map((i) => i.id)).toEqual(['i1', 'i2', 'i4']);
    });

    it('incidentsByPriority should filter by priority', () => {
      const store = useAutonomousOpsStore();
      store.incidents = [
        { id: 'i1', priority: 'P0' } as any,
        { id: 'i2', priority: 'P1' } as any,
        { id: 'i3', priority: 'P0' } as any,
      ];
      expect(store.incidentsByPriority('P0')).toHaveLength(2);
    });

    it('alertCount should count unacknowledged alerts', () => {
      const store = useAutonomousOpsStore();
      store.alerts = [
        { id: 'a1', acknowledged: false } as any,
        { id: 'a2', acknowledged: true } as any,
        { id: 'a3', acknowledged: false } as any,
      ];
      expect(store.alertCount).toBe(2);
    });
  });

  describe('incident management', () => {
    it('getIncidents should load all incidents', async () => {
      const incidents = [
        { id: 'i1', title: 'CPU spike', priority: 'P0' },
        { id: 'i2', title: 'Memory leak', priority: 'P1' },
      ];
      mockInvoke.mockResolvedValue({ success: true, data: incidents });

      const store = useAutonomousOpsStore();
      await store.getIncidents();
      expect(store.incidents).toEqual(incidents);
    });

    it('getIncidentDetail should fetch details', async () => {
      mockInvoke.mockResolvedValue({ success: true, data: { id: 'i1', description: 'details' } });

      const store = useAutonomousOpsStore();
      const result = await store.getIncidentDetail('i1');
      expect(result.success).toBe(true);
    });

    it('acknowledge should acknowledge incident', async () => {
      mockInvoke.mockImplementation((channel) => {
        if (channel === 'ops:acknowledge') return { success: true };
        if (channel === 'ops:get-incidents') return { success: true, data: [] };
        return { success: true };
      });

      const store = useAutonomousOpsStore();
      await store.acknowledge('i1');
      expect(mockInvoke).toHaveBeenCalledWith('ops:acknowledge', 'i1');
    });

    it('resolve should resolve incident', async () => {
      mockInvoke.mockImplementation((channel) => {
        if (channel === 'ops:resolve') return { success: true };
        if (channel === 'ops:get-incidents') return { success: true, data: [] };
        return { success: true };
      });

      const store = useAutonomousOpsStore();
      await store.resolve('i1', 'Resolved by restarting service');
      expect(mockInvoke).toHaveBeenCalledWith('ops:resolve', 'i1', 'Resolved by restarting service');
    });
  });

  describe('playbook management', () => {
    it('getPlaybooks should load all playbooks', async () => {
      const playbooks = [
        { id: 'pb1', name: 'CPU fix', enabled: true },
        { id: 'pb2', name: 'Memory fix', enabled: false },
      ];
      mockInvoke.mockResolvedValue({ success: true, data: playbooks });

      const store = useAutonomousOpsStore();
      await store.getPlaybooks();
      expect(store.playbooks).toEqual(playbooks);
    });

    it('createPlaybook should create and refresh', async () => {
      mockInvoke.mockImplementation((channel) => {
        if (channel === 'ops:create-playbook') return { success: true, data: { id: 'pb1' } };
        if (channel === 'ops:get-playbooks') return { success: true, data: [{ id: 'pb1' }] };
        return { success: true };
      });

      const store = useAutonomousOpsStore();
      await store.createPlaybook({ name: 'New Playbook', steps: [] });
      expect(mockInvoke).toHaveBeenCalledWith('ops:create-playbook', { name: 'New Playbook', steps: [] });
    });

    it('triggerRemediation should trigger playbook', async () => {
      mockInvoke.mockImplementation((channel) => {
        if (channel === 'ops:trigger-remediation') return { success: true };
        if (channel === 'ops:get-incidents') return { success: true, data: [] };
        return { success: true };
      });

      const store = useAutonomousOpsStore();
      await store.triggerRemediation('i1', 'pb1');
      expect(mockInvoke).toHaveBeenCalledWith('ops:trigger-remediation', 'i1', 'pb1');
    });

    it('rollback should rollback changes', async () => {
      mockInvoke.mockImplementation((channel) => {
        if (channel === 'ops:rollback') return { success: true };
        if (channel === 'ops:get-incidents') return { success: true, data: [] };
        return { success: true };
      });

      const store = useAutonomousOpsStore();
      await store.rollback('i1');
      expect(mockInvoke).toHaveBeenCalledWith('ops:rollback', 'i1');
    });
  });

  describe('alert management', () => {
    it('getAlerts should load alerts', async () => {
      const alerts = [
        { id: 'a1', severity: 'critical', acknowledged: false },
        { id: 'a2', severity: 'warning', acknowledged: true },
      ];
      mockInvoke.mockResolvedValue({ success: true, data: alerts });

      const store = useAutonomousOpsStore();
      await store.getAlerts();
      expect(store.alerts).toEqual(alerts);
    });

    it('configureAlerts should update config', async () => {
      mockInvoke.mockResolvedValue({ success: true });

      const store = useAutonomousOpsStore();
      const result = await store.configureAlerts({ cpuThreshold: 85, memoryThreshold: 90 });
      expect(result.success).toBe(true);
      expect(mockInvoke).toHaveBeenCalledWith('ops:configure-alerts', { cpuThreshold: 85, memoryThreshold: 90 });
    });
  });

  describe('postmortem', () => {
    it('generatePostmortem should generate report', async () => {
      const postmortem = {
        id: 'pm1',
        incidentId: 'i1',
        rootCause: 'Memory leak in service X',
        improvements: ['Add memory limits', 'Improve monitoring'],
      };
      mockInvoke.mockResolvedValue({ success: true, data: postmortem });

      const store = useAutonomousOpsStore();
      await store.generatePostmortem('i1');
      expect(store.postmortems).toContainEqual(postmortem);
    });
  });

  describe('baseline', () => {
    it('getBaseline should load baseline', async () => {
      const baseline = {
        cpu: { avg: 45, p95: 75 },
        memory: { avg: 60, p95: 85 },
        responseTime: { avg: 150, p95: 300 },
        errorRate: { avg: 0.5, threshold: 5 },
        updatedAt: '2026-02-26T10:00:00Z',
      };
      mockInvoke.mockResolvedValue({ success: true, data: baseline });

      const store = useAutonomousOpsStore();
      await store.getBaseline();
      expect(store.baseline).toEqual(baseline);
    });

    it('updateBaseline should update and return baseline', async () => {
      const baseline = { cpu: { avg: 50, p95: 80 } };
      mockInvoke.mockResolvedValue({ success: true, data: baseline });

      const store = useAutonomousOpsStore();
      await store.updateBaseline({ cpu: { avg: 50, p95: 80 } });
      expect(store.baseline).toEqual(baseline);
    });
  });

  // ============================================================
  // Error handling
  // ============================================================

  describe('error handling', () => {
    it('getIncidents should handle exception', async () => {
      mockInvoke.mockRejectedValue(new Error('DB connection failed'));

      const store = useAutonomousOpsStore();
      const result = await store.getIncidents();
      expect(result.success).toBe(false);
      expect(result.error).toBe('DB connection failed');
      expect(store.loading).toBe(false);
    });

    it('getIncidentDetail should handle exception', async () => {
      mockInvoke.mockRejectedValue(new Error('Not found'));

      const store = useAutonomousOpsStore();
      const result = await store.getIncidentDetail('invalid');
      expect(result.success).toBe(false);
    });

    it('acknowledge should handle exception', async () => {
      mockInvoke.mockRejectedValue(new Error('Acknowledge failed'));

      const store = useAutonomousOpsStore();
      const result = await store.acknowledge('i1');
      expect(result.success).toBe(false);
    });

    it('resolve should handle exception', async () => {
      mockInvoke.mockRejectedValue(new Error('Resolve failed'));

      const store = useAutonomousOpsStore();
      const result = await store.resolve('i1', 'resolution');
      expect(result.success).toBe(false);
    });

    it('getPlaybooks should handle exception', async () => {
      mockInvoke.mockRejectedValue(new Error('Fetch failed'));

      const store = useAutonomousOpsStore();
      const result = await store.getPlaybooks();
      expect(result.success).toBe(false);
    });

    it('createPlaybook should handle exception', async () => {
      mockInvoke.mockRejectedValue(new Error('Create failed'));

      const store = useAutonomousOpsStore();
      const result = await store.createPlaybook({});
      expect(result.success).toBe(false);
      expect(store.loading).toBe(false);
    });

    it('triggerRemediation should handle exception', async () => {
      mockInvoke.mockRejectedValue(new Error('Trigger failed'));

      const store = useAutonomousOpsStore();
      const result = await store.triggerRemediation('i1', 'pb1');
      expect(result.success).toBe(false);
      expect(store.loading).toBe(false);
    });

    it('rollback should handle exception', async () => {
      mockInvoke.mockRejectedValue(new Error('Rollback failed'));

      const store = useAutonomousOpsStore();
      const result = await store.rollback('i1');
      expect(result.success).toBe(false);
      expect(store.loading).toBe(false);
    });

    it('getAlerts should handle exception', async () => {
      mockInvoke.mockRejectedValue(new Error('Alert fetch failed'));

      const store = useAutonomousOpsStore();
      const result = await store.getAlerts();
      expect(result.success).toBe(false);
    });

    it('configureAlerts should handle exception', async () => {
      mockInvoke.mockRejectedValue(new Error('Config failed'));

      const store = useAutonomousOpsStore();
      const result = await store.configureAlerts({});
      expect(result.success).toBe(false);
    });

    it('generatePostmortem should handle exception', async () => {
      mockInvoke.mockRejectedValue(new Error('Generate failed'));

      const store = useAutonomousOpsStore();
      const result = await store.generatePostmortem('i1');
      expect(result.success).toBe(false);
      expect(store.loading).toBe(false);
    });

    it('getBaseline should handle exception', async () => {
      mockInvoke.mockRejectedValue(new Error('Baseline fetch failed'));

      const store = useAutonomousOpsStore();
      const result = await store.getBaseline();
      expect(result.success).toBe(false);
    });

    it('updateBaseline should handle exception', async () => {
      mockInvoke.mockRejectedValue(new Error('Update failed'));

      const store = useAutonomousOpsStore();
      const result = await store.updateBaseline({});
      expect(result.success).toBe(false);
    });
  });

  // ============================================================
  // Loading state verification
  // ============================================================

  describe('loading state', () => {
    it('getIncidents should toggle loading', async () => {
      mockInvoke.mockResolvedValue({ success: true, data: [] });

      const store = useAutonomousOpsStore();
      const promise = store.getIncidents();
      expect(store.loading).toBe(true);
      await promise;
      expect(store.loading).toBe(false);
    });

    it('createPlaybook should toggle loading', async () => {
      mockInvoke.mockImplementation((channel) => {
        if (channel === 'ops:create-playbook') return { success: true, data: { id: 'pb1' } };
        if (channel === 'ops:get-playbooks') return { success: true, data: [] };
        return { success: true };
      });

      const store = useAutonomousOpsStore();
      const promise = store.createPlaybook({});
      expect(store.loading).toBe(true);
      await promise;
      expect(store.loading).toBe(false);
    });

    it('triggerRemediation should toggle loading', async () => {
      mockInvoke.mockImplementation((channel) => {
        if (channel === 'ops:trigger-remediation') return { success: true };
        if (channel === 'ops:get-incidents') return { success: true, data: [] };
        return { success: true };
      });

      const store = useAutonomousOpsStore();
      const promise = store.triggerRemediation('i1', 'pb1');
      expect(store.loading).toBe(true);
      await promise;
      expect(store.loading).toBe(false);
    });

    it('generatePostmortem should toggle loading', async () => {
      mockInvoke.mockResolvedValue({ success: true, data: { id: 'pm1' } });

      const store = useAutonomousOpsStore();
      const promise = store.generatePostmortem('i1');
      expect(store.loading).toBe(true);
      await promise;
      expect(store.loading).toBe(false);
    });
  });

  // ============================================================
  // Getter edge cases
  // ============================================================

  describe('getter edge cases', () => {
    it('activeIncidents should return empty for all-resolved', () => {
      const store = useAutonomousOpsStore();
      store.incidents = [
        { id: 'i1', status: 'resolved' } as any,
        { id: 'i2', status: 'closed' } as any,
      ];
      expect(store.activeIncidents).toHaveLength(0);
    });

    it('alertCount should be 0 when all acknowledged', () => {
      const store = useAutonomousOpsStore();
      store.alerts = [
        { id: 'a1', acknowledged: true } as any,
        { id: 'a2', acknowledged: true } as any,
      ];
      expect(store.alertCount).toBe(0);
    });

    it('alertCount should be 0 with empty alerts', () => {
      const store = useAutonomousOpsStore();
      expect(store.alertCount).toBe(0);
    });
  });

  describe('reset()', () => {
    it('should reset all state', () => {
      const store = useAutonomousOpsStore();
      store.incidents = [{ id: 'i1' }] as any;
      store.playbooks = [{ id: 'pb1' }] as any;
      store.alerts = [{ id: 'a1' }] as any;
      store.baseline = { cpu: { avg: 50 } } as any;
      store.postmortems = [{ id: 'pm1' }] as any;
      store.loading = true;
      store.error = 'error';

      store.reset();
      expect(store.incidents).toEqual([]);
      expect(store.playbooks).toEqual([]);
      expect(store.alerts).toEqual([]);
      expect(store.baseline).toBeNull();
      expect(store.postmortems).toEqual([]);
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });
  });
});
