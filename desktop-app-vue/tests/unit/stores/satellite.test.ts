import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

const { mockInvoke } = vi.hoisted(() => {
  const m = vi.fn();
  (globalThis as any).window = { electronAPI: { invoke: m } };
  (window as any).electronAPI = { invoke: m };
  return { mockInvoke: m };
});

import { useSatelliteStore } from '../../../src/renderer/stores/satellite';

describe('satellite store', () => {
  beforeEach(() => { setActivePinia(createPinia()); mockInvoke.mockReset(); });

  it('should send message', async () => {
    mockInvoke.mockResolvedValueOnce({ success: true, messageId: 'msg-1' });
    const store = useSatelliteStore();
    const r = await store.sendMessage({ content: 'hello', recipient: 'node-2' });
    expect(r.success).toBe(true);
    expect(r.messageId).toBe('msg-1');
    expect(mockInvoke).toHaveBeenCalledWith('satellite:send-message', { content: 'hello', recipient: 'node-2' });
  });

  it('should fetch messages', async () => {
    mockInvoke.mockResolvedValueOnce({ success: true, messages: [{ id: '1', content: 'test' }, { id: '2', content: 'test2' }] });
    const store = useSatelliteStore();
    await store.fetchMessages();
    expect(store.messages).toHaveLength(2);
    expect(store.loading).toBe(false);
    expect(mockInvoke).toHaveBeenCalledWith('satellite:get-messages', undefined);
  });

  it('should fetch recovery status', async () => {
    mockInvoke.mockResolvedValueOnce({ success: true, status: { available: true, lastSync: '2026-01-01' } });
    const store = useSatelliteStore();
    await store.fetchRecoveryStatus();
    expect(store.recoveryStatus).toEqual({ available: true, lastSync: '2026-01-01' });
    expect(mockInvoke).toHaveBeenCalledWith('satellite:get-recovery-status');
  });
});
