/**
 * TemplateActions 单元测试
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

const { TemplateActions, TemplateCategory, getTemplateActions } = require('../template-actions');

describe('TemplateActions', () => {
  let templates;
  let mockEngine;
  let mockPage;

  beforeEach(() => {
    vi.clearAllMocks();

    mockPage = {
      evaluate: vi.fn().mockResolvedValue({ success: true }),
      $: vi.fn().mockResolvedValue({
        click: vi.fn().mockResolvedValue(undefined),
        type: vi.fn().mockResolvedValue(undefined),
        screenshot: vi.fn().mockResolvedValue(Buffer.from('image')),
        textContent: vi.fn().mockResolvedValue('text'),
        getAttribute: vi.fn().mockResolvedValue('attr')
      }),
      $$: vi.fn().mockResolvedValue([]),
      fill: vi.fn().mockResolvedValue(undefined),
      click: vi.fn().mockResolvedValue(undefined),
      press: vi.fn().mockResolvedValue(undefined),
      selectOption: vi.fn().mockResolvedValue(undefined),
      check: vi.fn().mockResolvedValue(undefined),
      uncheck: vi.fn().mockResolvedValue(undefined),
      setInputFiles: vi.fn().mockResolvedValue(undefined),
      waitForSelector: vi.fn().mockResolvedValue({}),
      waitForNavigation: vi.fn().mockResolvedValue(undefined),
      waitForEvent: vi.fn().mockResolvedValue({ path: vi.fn().mockResolvedValue('/tmp/file'), suggestedFilename: vi.fn().mockReturnValue('file.pdf') }),
      url: vi.fn().mockReturnValue('https://example.com')
    };

    mockEngine = {
      getPage: vi.fn().mockReturnValue(mockPage),
      screenshot: vi.fn().mockResolvedValue(Buffer.from('screenshot')),
      navigate: vi.fn().mockResolvedValue({ success: true })
    };

    templates = new TemplateActions(mockEngine);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with engine and built-in templates', () => {
      expect(templates.browserEngine).toBe(mockEngine);
      expect(templates.templates.size).toBeGreaterThan(0);
    });

    it('should work without engine', () => {
      const t = new TemplateActions();
      expect(t.browserEngine).toBeNull();
    });
  });

  describe('list', () => {
    it('should list all templates', () => {
      const list = templates.list();

      expect(Array.isArray(list)).toBe(true);
      expect(list.length).toBeGreaterThan(0);
    });

    it('should filter by category', () => {
      const formTemplates = templates.list(TemplateCategory.FORM);

      expect(formTemplates.every(t => t.category === TemplateCategory.FORM)).toBe(true);
    });

    it('should return empty for unknown category', () => {
      const list = templates.list('unknown');

      expect(list).toEqual([]);
    });
  });

  describe('get', () => {
    it('should get template by ID', () => {
      const template = templates.get('form:fill');

      expect(template).toBeDefined();
      expect(template.id).toBe('form:fill');
    });

    it('should return undefined for unknown template', () => {
      const template = templates.get('unknown:template');

      expect(template).toBeUndefined();
    });
  });

  describe('register', () => {
    it('should register custom template', () => {
      templates.register('custom:test', {
        name: 'Custom Test',
        category: TemplateCategory.UTILITY,
        description: 'A custom test template',
        execute: vi.fn().mockResolvedValue({ success: true })
      });

      expect(templates.get('custom:test')).toBeDefined();
    });

    it('should not override builtin template', () => {
      expect(() => templates.register('form:fill', {
        name: 'Override',
        execute: vi.fn()
      })).toThrow('Cannot override builtin');
    });
  });

  describe('unregister', () => {
    it('should unregister template', () => {
      templates.register('temp:remove', {
        name: 'To Remove',
        category: TemplateCategory.UTILITY,
        execute: vi.fn()
      });

      const result = templates.unregister('temp:remove');

      expect(result.success).toBe(true);
      expect(templates.get('temp:remove')).toBeUndefined();
    });

    it('should not unregister built-in templates', () => {
      expect(() => templates.unregister('form:fill'))
        .toThrow('Cannot unregister builtin');
    });

    it('should handle unknown template', () => {
      const result = templates.unregister('unknown:id');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('execute', () => {
    it('should execute form:fill template', async () => {
      const result = await templates.execute('tab1', 'form:fill', {
        fields: [
          { selector: '#name', value: 'John Doe' },
          { selector: '#email', value: 'john@example.com' }
        ]
      });

      expect(result.success).toBe(true);
      expect(result.fieldsProcessed).toBe(2);
    });

    it('should execute utility:screenshot template', async () => {
      const result = await templates.execute('tab1', 'utility:screenshot', {});

      expect(result.success).toBe(true);
      expect(result.screenshot).toBeDefined();
    });

    it('should handle template not found', async () => {
      await expect(templates.execute('tab1', 'unknown:template', {}))
        .rejects.toThrow('Template not found');
    });

    it('should handle missing required params', async () => {
      await expect(templates.execute('tab1', 'form:fill', {}))
        .rejects.toThrow('Missing required parameter');
    });

    it('should handle execution error', async () => {
      mockPage.fill.mockRejectedValueOnce(new Error('Element not found'));

      const result = await templates.execute('tab1', 'form:fill', {
        fields: [{ selector: '#notfound', value: 'test' }]
      });

      // The template catches errors per field
      expect(result.results[0].success).toBe(false);
    });
  });

  describe('built-in templates', () => {
    it('should have form:fill template', () => {
      const template = templates.get('form:fill');
      expect(template).toBeDefined();
      expect(template.category).toBe(TemplateCategory.FORM);
    });

    it('should have auth:login template', () => {
      const template = templates.get('auth:login');
      expect(template).toBeDefined();
      expect(template.category).toBe(TemplateCategory.AUTH);
    });

    it('should have search:query template', () => {
      const template = templates.get('search:query');
      expect(template).toBeDefined();
      expect(template.category).toBe(TemplateCategory.SEARCH);
    });

    it('should have utility:screenshot template', () => {
      const template = templates.get('utility:screenshot');
      expect(template).toBeDefined();
      expect(template.category).toBe(TemplateCategory.UTILITY);
    });

    it('should have utility:waitFor template', () => {
      const template = templates.get('utility:waitFor');
      expect(template).toBeDefined();
      expect(template.category).toBe(TemplateCategory.UTILITY);
    });

    it('should have data:extract template', () => {
      const template = templates.get('data:extract');
      expect(template).toBeDefined();
      expect(template.category).toBe(TemplateCategory.DATA);
    });

    it('should have navigation:scrollToBottom template', () => {
      const template = templates.get('navigation:scrollToBottom');
      expect(template).toBeDefined();
      expect(template.category).toBe(TemplateCategory.NAVIGATION);
    });
  });

  describe('TemplateCategory constants', () => {
    it('should have all categories defined', () => {
      expect(TemplateCategory.FORM).toBe('form');
      expect(TemplateCategory.AUTH).toBe('auth');
      expect(TemplateCategory.SEARCH).toBe('search');
      expect(TemplateCategory.NAVIGATION).toBe('navigation');
      expect(TemplateCategory.DATA).toBe('data');
      expect(TemplateCategory.UTILITY).toBe('utility');
    });
  });

  describe('getTemplateActions singleton', () => {
    it('should return singleton instance', () => {
      const t1 = getTemplateActions(mockEngine);
      const t2 = getTemplateActions();

      expect(t1).toBe(t2);
    });

    it('should create instance with engine', () => {
      const t = getTemplateActions(mockEngine);
      expect(t).toBeInstanceOf(TemplateActions);
    });
  });

  describe('createInstance', () => {
    it('should create template instance with default params', async () => {
      const fillForm = templates.createInstance('form:fill', {
        submit: false
      });

      const result = await fillForm('tab1', {
        fields: [{ selector: '#name', value: 'test' }]
      });

      expect(result.success).toBe(true);
    });
  });

  describe('executeBatch', () => {
    it('should execute multiple templates in sequence', async () => {
      const result = await templates.executeBatch('tab1', [
        { templateId: 'utility:screenshot', params: {} },
        { templateId: 'utility:screenshot', params: {} }
      ]);

      expect(result.success).toBe(true);
      expect(result.stepsExecuted).toBe(2);
    });

    it('should stop on error when configured', async () => {
      const result = await templates.executeBatch('tab1', [
        { templateId: 'form:fill', params: {} }, // Will fail - missing fields
        { templateId: 'utility:screenshot', params: {} }
      ], { stopOnError: true });

      expect(result.success).toBe(false);
      expect(result.stepsExecuted).toBe(1);
    });
  });

  describe('getParameterSpec', () => {
    it('should return parameter spec for template', () => {
      const spec = templates.getParameterSpec('form:fill');

      expect(spec).toBeDefined();
      expect(spec.fields).toBeDefined();
    });

    it('should return null for unknown template', () => {
      const spec = templates.getParameterSpec('unknown:template');

      expect(spec).toBeNull();
    });
  });

  describe('error handling', () => {
    it('should handle missing engine', async () => {
      const t = new TemplateActions();

      await expect(t.execute('tab1', 'form:fill', {
        fields: [{ selector: '#name', value: 'test' }]
      })).rejects.toThrow('Browser engine not set');
    });
  });
});
