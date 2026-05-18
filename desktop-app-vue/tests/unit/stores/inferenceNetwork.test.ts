import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

const { mockInvoke } = vi.hoisted(() => {
  const m = vi.fn();
  (globalThis as any).window = { electronAPI: { invoke: m } };
  (window as any).electronAPI = { invoke: m };
  return { mockInvoke: m };
});

import { useInferenceNetworkStore } from '../../../src/renderer/stores/inferenceNetwork';

describe('inferenceNetwork store', () => {
  beforeEach(() => { setActivePinia(createPinia()); mockInvoke.mockReset(); });

  it('should fetch nodes', async () => {
    mockInvoke.mockResolvedValueOnce({ success: true, nodes: [{ id: '1', status: 'online' }] });
    const store = useInferenceNetworkStore();
    await store.fetchNodes();
    expect(store.nodes).toHaveLength(1);
    expect(store.onlineNodes).toHaveLength(1);
  });

  it('should register node', async () => {
    mockInvoke.mockResolvedValueOnce({ success: true, node: { id: '1' } });
    mockInvoke.mockResolvedValueOnce({ success: true, nodes: [] });
    const store = useInferenceNetworkStore();
    const r = await store.registerNode({ name: 'gpu-1' });
    expect(r.success).toBe(true);
  });

  it('should fetch network stats', async () => {
    mockInvoke.mockResolvedValueOnce({ success: true, totalTasks: 5 });
    const store = useInferenceNetworkStore();
    await store.fetchNetworkStats();
    expect(store.networkStats).toBeDefined();
    expect(store.networkStats.totalTasks).toBe(5);
  });
});
