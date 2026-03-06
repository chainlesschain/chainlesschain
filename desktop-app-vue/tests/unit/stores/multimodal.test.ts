/**
 * Unit tests for Multimodal Store
 * @module stores/multimodal.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useMultimodalStore } from '../../../src/renderer/stores/multimodal';

describe('Multimodal Store', () => {
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
      const store = useMultimodalStore();
      expect(store.currentSession).toBeNull();
      expect(store.artifacts).toEqual([]);
      expect(store.supportedModalities).toEqual([]);
      expect(store.stats).toBeNull();
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  describe('getters', () => {
    it('tokenBudgetUsed should return used tokens', () => {
      const store = useMultimodalStore();
      expect(store.tokenBudgetUsed).toBe(0);
      store.currentSession = { tokenBudget: { used: 4200, total: 8000 } } as any;
      expect(store.tokenBudgetUsed).toBe(4200);
    });

    it('tokenBudgetTotal should return total budget', () => {
      const store = useMultimodalStore();
      store.currentSession = { tokenBudget: { used: 4200, total: 8000 } } as any;
      expect(store.tokenBudgetTotal).toBe(8000);
    });

    it('tokenBudgetPercent should calculate percentage', () => {
      const store = useMultimodalStore();
      store.currentSession = { tokenBudget: { used: 4200, total: 8000 } } as any;
      expect(store.tokenBudgetPercent).toBe(53); // Math.round(4200/8000*100)
    });

    it('tokenBudgetPercent should handle zero total', () => {
      const store = useMultimodalStore();
      store.currentSession = { tokenBudget: { used: 100, total: 0 } } as any;
      expect(store.tokenBudgetPercent).toBe(0);
    });
  });

  describe('fuseInput()', () => {
    it('should fuse multiple modality inputs', async () => {
      const session = {
        id: 'session1',
        inputs: [
          { modality: 'text', content: 'test', tokenCost: 10 },
          { modality: 'image', content: 'img-data', tokenCost: 500 },
        ],
        tokenBudget: { used: 510, total: 8000 },
      };
      mockInvoke.mockResolvedValue({ success: true, data: session });

      const store = useMultimodalStore();
      const result = await store.fuseInput([{ modality: 'text' }, { modality: 'image' }]);
      expect(result.success).toBe(true);
      expect(store.currentSession).toEqual(session);
    });

    it('should set error on fusion failure', async () => {
      mockInvoke.mockResolvedValue({ success: false, error: 'Token budget exceeded' });

      const store = useMultimodalStore();
      await store.fuseInput([{}]);
      expect(store.error).toBe('Token budget exceeded');
    });
  });

  describe('parseDocument()', () => {
    it('should parse document file', async () => {
      mockInvoke.mockResolvedValue({ success: true, data: { text: 'parsed content' } });

      const store = useMultimodalStore();
      const result = await store.parseDocument({ name: 'test.pdf', path: '/path/test.pdf' });
      expect(result.success).toBe(true);
      expect(mockInvoke).toHaveBeenCalledWith('mm:parse-document', { name: 'test.pdf', path: '/path/test.pdf' });
    });
  });

  describe('buildContext()', () => {
    it('should build session context', async () => {
      const session = { id: 's1', context: { merged: true } };
      mockInvoke.mockResolvedValue({ success: true, data: session });

      const store = useMultimodalStore();
      await store.buildContext('s1');
      expect(store.currentSession).toEqual(session);
    });
  });

  describe('getSession()', () => {
    it('should retrieve session', async () => {
      const session = { id: 's1', inputs: [] };
      mockInvoke.mockResolvedValue({ success: true, data: session });

      const store = useMultimodalStore();
      await store.getSession('s1');
      expect(store.currentSession).toEqual(session);
    });
  });

  describe('getSupportedModalities()', () => {
    it('should load supported modalities', async () => {
      const modalities = ['text', 'document', 'image', 'screen'];
      mockInvoke.mockResolvedValue({ success: true, data: modalities });

      const store = useMultimodalStore();
      await store.getSupportedModalities();
      expect(store.supportedModalities).toEqual(modalities);
    });
  });

  describe('captureScreen()', () => {
    it('should capture screen with options', async () => {
      mockInvoke.mockResolvedValue({ success: true, data: { screenshot: 'base64-data' } });

      const store = useMultimodalStore();
      const result = await store.captureScreen({ type: 'fullscreen' });
      expect(result.success).toBe(true);
      expect(mockInvoke).toHaveBeenCalledWith('mm:capture-screen', { type: 'fullscreen' });
    });
  });

  describe('generateOutput()', () => {
    it('should generate output in specified format', async () => {
      const artifact = {
        id: 'a1',
        sessionId: 's1',
        format: 'markdown',
        content: '# Title\n\nContent',
        size: 1024,
        createdAt: '2026-02-26T10:00:00Z',
      };
      mockInvoke.mockResolvedValue({ success: true, data: artifact });

      const store = useMultimodalStore();
      const result = await store.generateOutput('s1', 'markdown');
      expect(result.success).toBe(true);
      expect(store.artifacts).toContainEqual(artifact);
    });

    it('should set error on generation failure', async () => {
      mockInvoke.mockResolvedValue({ success: false, error: 'Format not supported' });

      const store = useMultimodalStore();
      await store.generateOutput('s1', 'invalid-format');
      expect(store.error).toBe('Format not supported');
    });
  });

  describe('getArtifacts()', () => {
    it('should load session artifacts', async () => {
      const artifacts = [
        { id: 'a1', format: 'markdown' },
        { id: 'a2', format: 'html' },
      ];
      mockInvoke.mockResolvedValue({ success: true, data: artifacts });

      const store = useMultimodalStore();
      await store.getArtifacts('s1');
      expect(store.artifacts).toEqual(artifacts);
    });
  });

  describe('getStats()', () => {
    it('should load statistics', async () => {
      const stats = {
        totalSessions: 25,
        totalInputs: 150,
        avgTokensPerSession: 3500,
        modalityDistribution: { text: 80, document: 40, image: 20, screen: 10 },
      };
      mockInvoke.mockResolvedValue({ success: true, data: stats });

      const store = useMultimodalStore();
      await store.getStats();
      expect(store.stats).toEqual(stats);
    });
  });

  // ============================================================
  // Error handling
  // ============================================================

  describe('error handling', () => {
    it('fuseInput should handle exception', async () => {
      mockInvoke.mockRejectedValue(new Error('Fusion engine crash'));

      const store = useMultimodalStore();
      const result = await store.fuseInput([]);
      expect(result.success).toBe(false);
      expect(store.error).toBe('Fusion engine crash');
      expect(store.loading).toBe(false);
    });

    it('parseDocument should handle exception', async () => {
      mockInvoke.mockRejectedValue(new Error('Parse error'));

      const store = useMultimodalStore();
      const result = await store.parseDocument({});
      expect(result.success).toBe(false);
      expect(store.loading).toBe(false);
    });

    it('buildContext should handle exception', async () => {
      mockInvoke.mockRejectedValue(new Error('Context build failed'));

      const store = useMultimodalStore();
      const result = await store.buildContext('s1');
      expect(result.success).toBe(false);
      expect(store.loading).toBe(false);
    });

    it('getSession should handle exception', async () => {
      mockInvoke.mockRejectedValue(new Error('Session not found'));

      const store = useMultimodalStore();
      const result = await store.getSession('invalid');
      expect(result.success).toBe(false);
    });

    it('getSupportedModalities should handle exception', async () => {
      mockInvoke.mockRejectedValue(new Error('Fetch failed'));

      const store = useMultimodalStore();
      const result = await store.getSupportedModalities();
      expect(result.success).toBe(false);
    });

    it('captureScreen should handle exception', async () => {
      mockInvoke.mockRejectedValue(new Error('Screen capture failed'));

      const store = useMultimodalStore();
      const result = await store.captureScreen();
      expect(result.success).toBe(false);
      expect(store.loading).toBe(false);
    });

    it('generateOutput should handle exception', async () => {
      mockInvoke.mockRejectedValue(new Error('Output generation failed'));

      const store = useMultimodalStore();
      const result = await store.generateOutput('s1', 'markdown');
      expect(result.success).toBe(false);
      expect(store.error).toBe('Output generation failed');
      expect(store.loading).toBe(false);
    });

    it('getArtifacts should handle exception', async () => {
      mockInvoke.mockRejectedValue(new Error('Artifact fetch failed'));

      const store = useMultimodalStore();
      const result = await store.getArtifacts('s1');
      expect(result.success).toBe(false);
    });

    it('getStats should handle exception', async () => {
      mockInvoke.mockRejectedValue(new Error('Stats fetch failed'));

      const store = useMultimodalStore();
      const result = await store.getStats();
      expect(result.success).toBe(false);
    });
  });

  // ============================================================
  // Loading state verification
  // ============================================================

  describe('loading state', () => {
    it('fuseInput should toggle loading', async () => {
      mockInvoke.mockResolvedValue({ success: true, data: { id: 's1' } });

      const store = useMultimodalStore();
      const promise = store.fuseInput([]);
      expect(store.loading).toBe(true);
      await promise;
      expect(store.loading).toBe(false);
    });

    it('parseDocument should toggle loading', async () => {
      mockInvoke.mockResolvedValue({ success: true, data: {} });

      const store = useMultimodalStore();
      const promise = store.parseDocument({});
      expect(store.loading).toBe(true);
      await promise;
      expect(store.loading).toBe(false);
    });

    it('captureScreen should toggle loading', async () => {
      mockInvoke.mockResolvedValue({ success: true, data: {} });

      const store = useMultimodalStore();
      const promise = store.captureScreen();
      expect(store.loading).toBe(true);
      await promise;
      expect(store.loading).toBe(false);
    });
  });

  // ============================================================
  // Getter edge cases
  // ============================================================

  describe('getter edge cases', () => {
    it('tokenBudgetUsed should return 0 when no session', () => {
      const store = useMultimodalStore();
      expect(store.tokenBudgetUsed).toBe(0);
    });

    it('tokenBudgetTotal should return 0 when no session', () => {
      const store = useMultimodalStore();
      expect(store.tokenBudgetTotal).toBe(0);
    });

    it('tokenBudgetPercent should return 0 when no session', () => {
      const store = useMultimodalStore();
      expect(store.tokenBudgetPercent).toBe(0);
    });

    it('tokenBudgetPercent should handle 100% usage', () => {
      const store = useMultimodalStore();
      store.currentSession = { tokenBudget: { used: 8000, total: 8000 } } as any;
      expect(store.tokenBudgetPercent).toBe(100);
    });
  });

  describe('reset()', () => {
    it('should reset all state', () => {
      const store = useMultimodalStore();
      store.currentSession = { id: 's1' } as any;
      store.artifacts = [{ id: 'a1' }] as any;
      store.supportedModalities = ['text'];
      store.stats = { totalSessions: 10 } as any;
      store.loading = true;
      store.error = 'error';

      store.reset();
      expect(store.currentSession).toBeNull();
      expect(store.artifacts).toEqual([]);
      expect(store.supportedModalities).toEqual([]);
      expect(store.stats).toBeNull();
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });
  });
});
