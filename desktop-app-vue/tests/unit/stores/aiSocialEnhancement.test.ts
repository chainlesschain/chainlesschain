import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

const { mockInvoke } = vi.hoisted(() => {
  const m = vi.fn();
  (globalThis as any).window = { electronAPI: { invoke: m } };
  (window as any).electronAPI = { invoke: m };
  return { mockInvoke: m };
});

import { useAISocialEnhancementStore } from '../../../src/renderer/stores/aiSocialEnhancement';

describe('aiSocialEnhancement store', () => {
  beforeEach(() => { setActivePinia(createPinia()); mockInvoke.mockReset(); });

  it('should translate message', async () => {
    mockInvoke.mockResolvedValueOnce({ success: true, translated: 'Hello world', targetLang: 'en' });
    const store = useAISocialEnhancementStore();
    const r = await store.translateMessage({ text: 'Bonjour le monde', targetLang: 'en' });
    expect(r.success).toBe(true);
    expect(r.translated).toBe('Hello world');
    expect(mockInvoke).toHaveBeenCalledWith('ai-social:translate-message', { text: 'Bonjour le monde', targetLang: 'en' });
  });

  it('should assess quality', async () => {
    mockInvoke.mockResolvedValueOnce({ success: true, score: 0.85, flags: [] });
    const store = useAISocialEnhancementStore();
    const r = await store.assessQuality({ content: 'A thoughtful discussion', context: 'forum' });
    expect(r.success).toBe(true);
    expect(r.score).toBe(0.85);
    expect(mockInvoke).toHaveBeenCalledWith('ai-social:assess-quality', { content: 'A thoughtful discussion', context: 'forum' });
  });

  it('should fetch quality report', async () => {
    mockInvoke.mockResolvedValueOnce({ success: true, report: { avgScore: 0.78, totalAssessed: 150 } });
    const store = useAISocialEnhancementStore();
    await store.fetchQualityReport();
    expect(store.qualityReport).toEqual({ avgScore: 0.78, totalAssessed: 150 });
    expect(mockInvoke).toHaveBeenCalledWith('ai-social:get-quality-report', undefined);
  });

  it('should handle translation error', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('Translation service unavailable'));
    const store = useAISocialEnhancementStore();
    const r = await store.translateMessage({ text: 'test', targetLang: 'zh' });
    expect(r.success).toBe(false);
    expect(r.error).toBe('Translation service unavailable');
  });
});
