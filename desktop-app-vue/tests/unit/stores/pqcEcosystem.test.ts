import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

const { mockInvoke } = vi.hoisted(() => {
  const m = vi.fn();
  (globalThis as any).window = { electronAPI: { invoke: m } };
  (window as any).electronAPI = { invoke: m };
  return { mockInvoke: m };
});

import { usePQCEcosystemStore } from '../../../src/renderer/stores/pqcEcosystem';

describe('pqcEcosystem store', () => {
  beforeEach(() => { setActivePinia(createPinia()); mockInvoke.mockReset(); });

  it('should fetch coverage', async () => {
    mockInvoke.mockResolvedValueOnce({ success: true, coverage: { percentage: 85, subsystems: 12 } });
    const store = usePQCEcosystemStore();
    await store.fetchCoverage();
    expect(store.coverage).toEqual({ percentage: 85, subsystems: 12 });
    expect(store.loading).toBe(false);
    expect(mockInvoke).toHaveBeenCalledWith('pqc-ecosystem:get-coverage');
  });

  it('should migrate subsystem and refresh coverage', async () => {
    mockInvoke.mockResolvedValueOnce({ success: true, migrated: true });
    mockInvoke.mockResolvedValueOnce({ success: true, coverage: { percentage: 90 } });
    const store = usePQCEcosystemStore();
    const r = await store.migrateSubsystem({ subsystem: 'auth', algorithm: 'ML-KEM' });
    expect(r.success).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith('pqc-ecosystem:migrate-subsystem', { subsystem: 'auth', algorithm: 'ML-KEM' });
  });

  it('should verify migration', async () => {
    mockInvoke.mockResolvedValueOnce({ success: true, allValid: true, results: [] });
    const store = usePQCEcosystemStore();
    const r = await store.verifyMigration();
    expect(r.success).toBe(true);
    expect(r.allValid).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith('pqc-ecosystem:verify-migration');
  });

  it('should handle coverage fetch error', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('Network error'));
    const store = usePQCEcosystemStore();
    const r = await store.fetchCoverage();
    expect(r.success).toBe(false);
    expect(store.error).toBe('Network error');
  });
});
