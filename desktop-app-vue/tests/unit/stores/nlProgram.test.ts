/**
 * Unit tests for NL Programming Store
 * @module stores/nlProgram.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useNLProgramStore } from '../../../src/renderer/stores/nlProgram';

describe('NLProgram Store', () => {
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
      const store = useNLProgramStore();
      expect(store.currentSpec).toBeNull();
      expect(store.generatedCode).toBeNull();
      expect(store.history).toEqual([]);
      expect(store.conventions).toBeNull();
      expect(store.stats).toBeNull();
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  describe('getters', () => {
    it('specCompleteness should return spec completeness', () => {
      const store = useNLProgramStore();
      expect(store.specCompleteness).toBe(0);
      store.currentSpec = { completeness: 85 } as any;
      expect(store.specCompleteness).toBe(85);
    });

    it('hasSpec should return true when spec exists', () => {
      const store = useNLProgramStore();
      expect(store.hasSpec).toBe(false);
      store.currentSpec = { id: 's1' } as any;
      expect(store.hasSpec).toBe(true);
    });
  });

  describe('translate()', () => {
    it('should translate NL to spec', async () => {
      const spec = {
        id: 's1',
        intent: 'create-form',
        entities: [{ name: 'User', type: 'model' }],
        acceptanceCriteria: ['Form validates inputs'],
        completeness: 85,
      };
      mockInvoke.mockResolvedValue({ success: true, data: spec });

      const store = useNLProgramStore();
      const result = await store.translate('Create a user registration form');
      expect(result.success).toBe(true);
      expect(store.currentSpec).toEqual(spec);
      expect(mockInvoke).toHaveBeenCalledWith('nl-prog:translate', 'Create a user registration form');
    });

    it('should set error on failure', async () => {
      mockInvoke.mockResolvedValue({ success: false, error: 'LLM unavailable' });

      const store = useNLProgramStore();
      await store.translate('test');
      expect(store.error).toBe('LLM unavailable');
    });
  });

  describe('validate()', () => {
    it('should validate spec', async () => {
      mockInvoke.mockResolvedValue({ success: true, data: { valid: true } });

      const store = useNLProgramStore();
      const result = await store.validate({ id: 's1' });
      expect(result.success).toBe(true);
      expect(mockInvoke).toHaveBeenCalledWith('nl-prog:validate', { id: 's1' });
    });
  });

  describe('refine()', () => {
    it('should refine spec with feedback', async () => {
      const refinedSpec = { id: 's1', completeness: 95 };
      mockInvoke.mockResolvedValue({ success: true, data: refinedSpec });

      const store = useNLProgramStore();
      const result = await store.refine({ id: 's1' }, 'Add password strength validation');
      expect(result.success).toBe(true);
      expect(store.currentSpec).toEqual(refinedSpec);
    });
  });

  describe('getHistory()', () => {
    it('should load translation history', async () => {
      const history = [
        { id: 'h1', input: 'Create form', status: 'translated' },
        { id: 'h2', input: 'Add validation', status: 'generated' },
      ];
      mockInvoke.mockResolvedValue({ success: true, data: history });

      const store = useNLProgramStore();
      await store.getHistory();
      expect(store.history).toEqual(history);
    });
  });

  describe('generate()', () => {
    it('should generate code from spec', async () => {
      const code = 'export const UserForm = () => {...}';
      mockInvoke.mockResolvedValue({ success: true, data: { code } });

      const store = useNLProgramStore();
      const result = await store.generate({ id: 's1' });
      expect(result.success).toBe(true);
      expect(store.generatedCode).toBe(code);
    });

    it('should handle data without code wrapper', async () => {
      mockInvoke.mockResolvedValue({ success: true, data: 'const x = 1;' });

      const store = useNLProgramStore();
      await store.generate({ id: 's1' });
      expect(store.generatedCode).toBe('const x = 1;');
    });
  });

  describe('getConventions()', () => {
    it('should load project conventions', async () => {
      const conventions = {
        naming: 'camelCase',
        framework: 'Vue3 SFC',
        testFramework: 'Vitest',
        style: 'composition-api',
        patterns: ['pinia', 'typescript'],
      };
      mockInvoke.mockResolvedValue({ success: true, data: conventions });

      const store = useNLProgramStore();
      await store.getConventions();
      expect(store.conventions).toEqual(conventions);
    });
  });

  describe('analyzeProject()', () => {
    it('should analyze project and extract conventions', async () => {
      const conventions = { naming: 'kebab-case', framework: 'React' };
      mockInvoke.mockResolvedValue({ success: true, data: conventions });

      const store = useNLProgramStore();
      await store.analyzeProject('/path/to/project');
      expect(store.conventions).toEqual(conventions);
      expect(mockInvoke).toHaveBeenCalledWith('nl-prog:analyze-project', '/path/to/project');
    });
  });

  describe('getStats()', () => {
    it('should load statistics', async () => {
      const stats = {
        totalTranslations: 42,
        successRate: 0.88,
        avgCompleteness: 82,
        topIntents: [{ intent: 'create-component', count: 15 }],
      };
      mockInvoke.mockResolvedValue({ success: true, data: stats });

      const store = useNLProgramStore();
      await store.getStats();
      expect(store.stats).toEqual(stats);
    });
  });

  // ============================================================
  // Error handling
  // ============================================================

  describe('error handling', () => {
    it('translate should handle exception', async () => {
      mockInvoke.mockRejectedValue(new Error('Translation engine error'));

      const store = useNLProgramStore();
      const result = await store.translate('test');
      expect(result.success).toBe(false);
      expect(store.error).toBe('Translation engine error');
      expect(store.loading).toBe(false);
    });

    it('validate should handle exception', async () => {
      mockInvoke.mockRejectedValue(new Error('Validation failed'));

      const store = useNLProgramStore();
      const result = await store.validate({});
      expect(result.success).toBe(false);
      expect(store.loading).toBe(false);
    });

    it('refine should handle exception', async () => {
      mockInvoke.mockRejectedValue(new Error('Refine failed'));

      const store = useNLProgramStore();
      const result = await store.refine({}, 'feedback');
      expect(result.success).toBe(false);
      expect(store.error).toBe('Refine failed');
      expect(store.loading).toBe(false);
    });

    it('refine should handle API error response', async () => {
      mockInvoke.mockResolvedValue({ success: false, error: 'Invalid spec' });

      const store = useNLProgramStore();
      await store.refine({}, 'feedback');
      expect(store.error).toBe('Invalid spec');
    });

    it('getHistory should handle exception', async () => {
      mockInvoke.mockRejectedValue(new Error('History fetch failed'));

      const store = useNLProgramStore();
      const result = await store.getHistory();
      expect(result.success).toBe(false);
    });

    it('generate should handle exception', async () => {
      mockInvoke.mockRejectedValue(new Error('Code generation failed'));

      const store = useNLProgramStore();
      const result = await store.generate({});
      expect(result.success).toBe(false);
      expect(store.error).toBe('Code generation failed');
      expect(store.loading).toBe(false);
    });

    it('generate should handle API error response', async () => {
      mockInvoke.mockResolvedValue({ success: false, error: 'Incomplete spec' });

      const store = useNLProgramStore();
      await store.generate({});
      expect(store.error).toBe('Incomplete spec');
    });

    it('getConventions should handle exception', async () => {
      mockInvoke.mockRejectedValue(new Error('Conventions fetch failed'));

      const store = useNLProgramStore();
      const result = await store.getConventions();
      expect(result.success).toBe(false);
    });

    it('analyzeProject should handle exception', async () => {
      mockInvoke.mockRejectedValue(new Error('Analysis failed'));

      const store = useNLProgramStore();
      const result = await store.analyzeProject('/invalid');
      expect(result.success).toBe(false);
      expect(store.loading).toBe(false);
    });

    it('getStats should handle exception', async () => {
      mockInvoke.mockRejectedValue(new Error('Stats failed'));

      const store = useNLProgramStore();
      const result = await store.getStats();
      expect(result.success).toBe(false);
    });
  });

  // ============================================================
  // Loading state verification
  // ============================================================

  describe('loading state', () => {
    it('translate should toggle loading', async () => {
      mockInvoke.mockResolvedValue({ success: true, data: { id: 's1' } });

      const store = useNLProgramStore();
      const promise = store.translate('test');
      expect(store.loading).toBe(true);
      await promise;
      expect(store.loading).toBe(false);
    });

    it('validate should toggle loading', async () => {
      mockInvoke.mockResolvedValue({ success: true, data: {} });

      const store = useNLProgramStore();
      const promise = store.validate({});
      expect(store.loading).toBe(true);
      await promise;
      expect(store.loading).toBe(false);
    });

    it('refine should toggle loading', async () => {
      mockInvoke.mockResolvedValue({ success: true, data: { id: 's1' } });

      const store = useNLProgramStore();
      const promise = store.refine({}, 'feedback');
      expect(store.loading).toBe(true);
      await promise;
      expect(store.loading).toBe(false);
    });

    it('generate should toggle loading', async () => {
      mockInvoke.mockResolvedValue({ success: true, data: { code: 'test' } });

      const store = useNLProgramStore();
      const promise = store.generate({});
      expect(store.loading).toBe(true);
      await promise;
      expect(store.loading).toBe(false);
    });

    it('analyzeProject should toggle loading', async () => {
      mockInvoke.mockResolvedValue({ success: true, data: {} });

      const store = useNLProgramStore();
      const promise = store.analyzeProject('/path');
      expect(store.loading).toBe(true);
      await promise;
      expect(store.loading).toBe(false);
    });
  });

  describe('reset()', () => {
    it('should reset all state', () => {
      const store = useNLProgramStore();
      store.currentSpec = { id: 's1' } as any;
      store.generatedCode = 'code';
      store.history = [{ id: 'h1' }] as any;
      store.conventions = { naming: 'test' } as any;
      store.stats = { totalTranslations: 10 } as any;
      store.loading = true;
      store.error = 'error';

      store.reset();
      expect(store.currentSpec).toBeNull();
      expect(store.generatedCode).toBeNull();
      expect(store.history).toEqual([]);
      expect(store.conventions).toBeNull();
      expect(store.stats).toBeNull();
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });
  });
});
