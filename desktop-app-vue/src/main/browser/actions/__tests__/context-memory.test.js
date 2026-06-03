/**
 * ContextMemory 单元测试
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

const { ContextMemory, MemoryType, PersistenceStrategy, getContextMemory } = require('../context-memory');

describe('ContextMemory', () => {
  let memory;

  beforeEach(() => {
    vi.clearAllMocks();
    memory = new ContextMemory({
      persistenceStrategy: PersistenceStrategy.MEMORY_ONLY
    });
  });

  afterEach(() => {
    memory.stop();
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with default config', () => {
      expect(memory.pageStates).toBeDefined();
      expect(memory.elementLocations).toBeDefined();
      expect(memory.operationSequences).toBeDefined();
    });

    it('should accept custom config', () => {
      const m = new ContextMemory({
        maxPageStates: 50,
        elementTTL: 1800000
      });

      expect(m.config.maxPageStates).toBe(50);
      expect(m.config.elementTTL).toBe(1800000);
      m.stop();
    });
  });

  describe('savePageState', () => {
    it('should save page state', () => {
      const result = memory.savePageState('https://example.com', {
        title: 'Example',
        scrollPosition: { x: 0, y: 100 }
      });

      expect(result.success).toBe(true);
      expect(result.key).toBe('https://example.com');
    });

    it('should generate fingerprint', () => {
      const result = memory.savePageState('https://example.com', {
        title: 'Example'
      });

      expect(result.fingerprint).toBeDefined();
    });

    it('should use custom key', () => {
      const result = memory.savePageState('https://example.com', {
        title: 'Example'
      }, { key: 'custom-key' });

      expect(result.key).toBe('custom-key');
    });
  });

  describe('getPageState', () => {
    it('should get saved page state', () => {
      memory.savePageState('https://example.com', {
        title: 'Example',
        scrollPosition: { x: 0, y: 100 }
      });

      const state = memory.getPageState('https://example.com');

      expect(state).toBeDefined();
      expect(state.state.title).toBe('Example');
    });

    it('should return null for unknown key', () => {
      const state = memory.getPageState('unknown');
      expect(state).toBeNull();
    });

    it('should respect TTL', async () => {
      memory.savePageState('https://example.com', {
        title: 'Example'
      }, { ttl: 50 });

      await new Promise(resolve => setTimeout(resolve, 100));

      const state = memory.getPageState('https://example.com');
      expect(state).toBeNull();
    });
  });

  describe('saveElementLocation', () => {
    it('should save element location', () => {
      const result = memory.saveElementLocation(
        { text: 'Submit' },
        { bounds: { x: 100, y: 200, width: 100, height: 40 } },
        { url: 'https://example.com' }
      );

      expect(result.success).toBe(true);
    });
  });

  describe('getElementLocation', () => {
    it('should get saved element location', () => {
      memory.saveElementLocation(
        { text: 'Submit' },
        { bounds: { x: 100, y: 200, width: 100, height: 40 } },
        { url: 'https://example.com' }
      );

      const location = memory.getElementLocation(
        { text: 'Submit' },
        { url: 'https://example.com' }
      );

      expect(location).toBeDefined();
      expect(location.location.bounds.x).toBe(100);
    });

    it('should track hits', () => {
      memory.saveElementLocation(
        { text: 'Submit' },
        { bounds: { x: 100, y: 200, width: 100, height: 40 } },
        { url: 'https://example.com' }
      );

      memory.getElementLocation({ text: 'Submit' }, { url: 'https://example.com' });
      memory.getElementLocation({ text: 'Submit' }, { url: 'https://example.com' });
      const location = memory.getElementLocation({ text: 'Submit' }, { url: 'https://example.com' });

      expect(location.hits).toBe(3);
    });
  });

  describe('recordOperation', () => {
    it('should record operation', () => {
      const result = memory.recordOperation('workflow-1', {
        type: 'click',
        target: 'button'
      });

      expect(result.success).toBe(true);
      expect(result.operationCount).toBe(1);
    });

    it('should append to existing sequence', () => {
      memory.recordOperation('workflow-1', { type: 'click' });
      memory.recordOperation('workflow-1', { type: 'type' });
      const result = memory.recordOperation('workflow-1', { type: 'submit' });

      expect(result.operationCount).toBe(3);
    });
  });

  describe('getOperationSequence', () => {
    it('should get operation sequence', () => {
      memory.recordOperation('workflow-1', { type: 'click' });
      memory.recordOperation('workflow-1', { type: 'type' });

      const ops = memory.getOperationSequence('workflow-1');

      expect(ops.length).toBe(2);
    });

    it('should filter by type', () => {
      memory.recordOperation('workflow-1', { type: 'click' });
      memory.recordOperation('workflow-1', { type: 'type' });
      memory.recordOperation('workflow-1', { type: 'click' });

      const ops = memory.getOperationSequence('workflow-1', { type: 'click' });

      expect(ops.length).toBe(2);
    });

    it('should limit results', () => {
      for (let i = 0; i < 10; i++) {
        memory.recordOperation('workflow-1', { type: 'click', index: i });
      }

      const ops = memory.getOperationSequence('workflow-1', { limit: 5 });

      expect(ops.length).toBe(5);
    });
  });

  describe('saveFormData', () => {
    it('should save form data', () => {
      const result = memory.saveFormData('login-form', {
        username: 'test@example.com',
        password: '***'
      });

      expect(result.success).toBe(true);
    });
  });

  describe('getFormData', () => {
    it('should get saved form data', () => {
      memory.saveFormData('login-form', {
        username: 'test@example.com'
      });

      const data = memory.getFormData('login-form');

      expect(data.data.username).toBe('test@example.com');
    });
  });

  describe('sessionContext', () => {
    it('should set and get session context', () => {
      memory.setSessionContext('user', { id: 1, name: 'Test' });

      const value = memory.getSessionContext('user');

      expect(value.id).toBe(1);
    });

    it('should return undefined for unknown key', () => {
      const value = memory.getSessionContext('unknown');
      expect(value).toBeUndefined();
    });
  });

  describe('findSimilarPageStates', () => {
    it('should find similar page states', () => {
      memory.savePageState('https://example.com/page1', { title: 'Page 1' });
      memory.savePageState('https://example.com/page1?q=test', { title: 'Page 1 Search' });
      memory.savePageState('https://other.com/page', { title: 'Other' });

      const similar = memory.findSimilarPageStates('https://example.com/page1');

      expect(similar.length).toBe(2);
    });
  });

  describe('getStats', () => {
    it('should return statistics', () => {
      memory.savePageState('https://example.com', { title: 'Test' });
      memory.saveElementLocation({ text: 'Button' }, { bounds: {} });

      const stats = memory.getStats();

      expect(stats.pageStates).toBe(1);
      expect(stats.elementLocations).toBe(1);
    });
  });

  describe('cleanup', () => {
    it('should remove expired entries', async () => {
      const m = new ContextMemory({
        persistenceStrategy: PersistenceStrategy.MEMORY_ONLY,
        elementTTL: 50
      });

      m.saveElementLocation({ text: 'Old' }, { bounds: {} });

      await new Promise(resolve => setTimeout(resolve, 100));

      const result = m.cleanup();

      expect(result.cleaned).toBeGreaterThan(0);
      m.stop();
    });
  });

  describe('clear', () => {
    it('should clear all data', () => {
      memory.savePageState('https://example.com', { title: 'Test' });
      memory.saveElementLocation({ text: 'Button' }, { bounds: {} });

      memory.clear();

      const stats = memory.getStats();
      expect(stats.pageStates).toBe(0);
      expect(stats.elementLocations).toBe(0);
    });
  });

  describe('export and import', () => {
    it('should export data', () => {
      memory.savePageState('https://example.com', { title: 'Test' });

      const data = memory.export();

      expect(data.pageStates.length).toBe(1);
    });

    it('should import data', () => {
      const data = {
        pageStates: [['https://example.com', {
          url: 'https://example.com',
          state: { title: 'Imported' },
          timestamp: Date.now()
        }]]
      };

      memory.import(data);

      const state = memory.getPageState('https://example.com');
      expect(state.state.title).toBe('Imported');
    });
  });

  describe('MemoryType constants', () => {
    it('should have all types defined', () => {
      expect(MemoryType.PAGE_STATE).toBe('page_state');
      expect(MemoryType.ELEMENT_LOCATION).toBe('element_location');
      expect(MemoryType.OPERATION_SEQUENCE).toBe('operation_sequence');
      expect(MemoryType.FORM_DATA).toBe('form_data');
    });
  });

  describe('PersistenceStrategy constants', () => {
    it('should have all strategies defined', () => {
      expect(PersistenceStrategy.MEMORY_ONLY).toBe('memory');
      expect(PersistenceStrategy.SESSION).toBe('session');
      expect(PersistenceStrategy.PERSISTENT).toBe('persistent');
    });
  });

  describe('getContextMemory singleton', () => {
    it('should return singleton instance', () => {
      const m1 = getContextMemory();
      const m2 = getContextMemory();

      expect(m1).toBe(m2);
    });
  });
});
