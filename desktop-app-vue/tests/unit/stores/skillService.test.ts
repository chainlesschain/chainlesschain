import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

const { mockInvoke } = vi.hoisted(() => {
  const m = vi.fn();
  (globalThis as any).window = { electronAPI: { invoke: m } };
  (window as any).electronAPI = { invoke: m };
  return { mockInvoke: m };
});

import { useSkillServiceStore } from '../../../src/renderer/stores/skillService';

describe('skillService store', () => {
  beforeEach(() => { setActivePinia(createPinia()); mockInvoke.mockReset(); });

  it('should fetch skills', async () => {
    mockInvoke.mockResolvedValueOnce({ success: true, skills: [{ id: '1', name: 'test' }] });
    const store = useSkillServiceStore();
    await store.fetchSkills();
    expect(store.skills).toHaveLength(1);
    expect(mockInvoke).toHaveBeenCalledWith('skill-service:list-skills', undefined);
  });

  it('should publish skill', async () => {
    mockInvoke.mockResolvedValueOnce({ success: true, skill: { id: '1' } });
    mockInvoke.mockResolvedValueOnce({ success: true, skills: [] });
    const store = useSkillServiceStore();
    const r = await store.publishSkill({ name: 'test' });
    expect(r.success).toBe(true);
  });

  it('should handle error', async () => {
    mockInvoke.mockResolvedValueOnce({ success: false, error: 'fail' });
    const store = useSkillServiceStore();
    await store.fetchSkills();
    expect(store.error).toBe('fail');
  });
});
