/**
 * AuditLogger 单元测试
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs/promises';

// Mock fs.promises
vi.mock('fs', () => ({
  promises: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    appendFile: vi.fn().mockResolvedValue(undefined),
    readdir: vi.fn().mockResolvedValue([]),
    readFile: vi.fn().mockResolvedValue('{}'),
    writeFile: vi.fn().mockResolvedValue(undefined)
  }
}));

const { AuditLogger, AuditEntry, OperationType, RiskLevel, getAuditLogger } = require('../audit-logger');

describe('AuditLogger', () => {
  let logger;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = new AuditLogger({
      enabled: true,
      logToFile: false,
      maxEntriesInMemory: 100
    });
  });

  afterEach(() => {
    logger.clear();
  });

  describe('AuditEntry', () => {
    it('should create entry with basic fields', () => {
      const entry = new AuditEntry({
        type: OperationType.MOUSE_CLICK,
        action: 'click',
        params: { x: 100, y: 200 },
        success: true,
        duration: 50
      });

      expect(entry.id).toMatch(/^audit_/);
      expect(entry.timestamp).toBeDefined();
      expect(entry.type).toBe(OperationType.MOUSE_CLICK);
      expect(entry.action).toBe('click');
      expect(entry.success).toBe(true);
      expect(entry.duration).toBe(50);
    });

    it('should sanitize sensitive params', () => {
      const entry = new AuditEntry({
        type: OperationType.KEYBOARD_TYPE,
        action: 'type',
        params: {
          text: 'hello',
          password: 'secret123',
          token: 'abc123'
        },
        success: true
      });

      expect(entry.params.text).toBe('hello');
      expect(entry.params.password).toBe('***REDACTED***');
      expect(entry.params.token).toBe('***REDACTED***');
    });

    it('should truncate long text', () => {
      const longText = 'a'.repeat(1000);
      const entry = new AuditEntry({
        type: OperationType.KEYBOARD_TYPE,
        action: 'type',
        params: { text: longText },
        success: true
      });

      expect(entry.params.text.length).toBeLessThan(600);
      expect(entry.params.text).toContain('[TRUNCATED]');
    });

    it('should replace screenshot data with placeholder', () => {
      const entry = new AuditEntry({
        type: OperationType.SCREENSHOT,
        action: 'screenshot',
        params: { screenshot: 'base64...'.repeat(1000) },
        success: true
      });

      expect(entry.params.screenshot).toContain('[BASE64_IMAGE:');
    });

    it('should assess low risk for normal operations', () => {
      const entry = new AuditEntry({
        type: OperationType.MOUSE_CLICK,
        action: 'click',
        params: { x: 100, y: 200 },
        success: true
      });

      expect(entry.riskLevel).toBe(RiskLevel.LOW);
    });

    it('should assess high risk for desktop operations', () => {
      const entry = new AuditEntry({
        type: OperationType.DESKTOP_CLICK,
        action: 'click',
        params: { x: 100, y: 200 },
        success: true
      });

      expect(entry.riskLevel).toBe(RiskLevel.HIGH);
    });

    it('should assess medium risk for sensitive keywords', () => {
      const entry = new AuditEntry({
        type: OperationType.KEYBOARD_TYPE,
        action: 'type',
        params: { text: 'enter password here' },
        success: true
      });

      expect(entry.riskLevel).toBe(RiskLevel.MEDIUM);
    });

    it('should convert to JSON correctly', () => {
      const entry = new AuditEntry({
        type: OperationType.MOUSE_CLICK,
        action: 'click',
        params: { x: 100, y: 200 },
        success: true,
        duration: 50
      });

      const json = entry.toJSON();

      expect(json.id).toBe(entry.id);
      expect(json.timestamp).toBe(entry.timestamp);
      expect(json.type).toBe(entry.type);
      expect(json.action).toBe(entry.action);
    });
  });

  describe('log', () => {
    it('should log operations when enabled', async () => {
      const entry = await logger.log({
        type: OperationType.MOUSE_CLICK,
        action: 'click',
        params: { x: 100, y: 200 },
        success: true,
        duration: 50
      });

      expect(entry).toBeDefined();
      expect(entry.type).toBe(OperationType.MOUSE_CLICK);
    });

    it('should not log when disabled', async () => {
      const disabledLogger = new AuditLogger({ enabled: false });
      const entry = await disabledLogger.log({
        type: OperationType.MOUSE_CLICK,
        action: 'click',
        success: true
      });

      expect(entry).toBeNull();
    });

    it('should update statistics', async () => {
      await logger.log({ type: OperationType.MOUSE_CLICK, success: true });
      await logger.log({ type: OperationType.KEYBOARD_TYPE, success: true });
      await logger.log({ type: OperationType.MOUSE_CLICK, success: false });

      const stats = logger.getStats();

      expect(stats.totalOperations).toBe(3);
      expect(stats.successfulOperations).toBe(2);
      expect(stats.failedOperations).toBe(1);
      expect(stats.byType[OperationType.MOUSE_CLICK]).toBe(2);
      expect(stats.byType[OperationType.KEYBOARD_TYPE]).toBe(1);
    });

    it('should emit logged event', async () => {
      const handler = vi.fn();
      logger.on('logged', handler);

      await logger.log({
        type: OperationType.MOUSE_CLICK,
        success: true
      });

      expect(handler).toHaveBeenCalled();
    });

    it('should emit highRiskOperation event for high risk', async () => {
      const handler = vi.fn();
      logger.on('highRiskOperation', handler);

      await logger.log({
        type: OperationType.DESKTOP_CLICK,
        success: true
      });

      expect(handler).toHaveBeenCalled();
    });

    it('should enforce max entries in memory', async () => {
      const smallLogger = new AuditLogger({
        enabled: true,
        logToFile: false,
        maxEntriesInMemory: 5
      });

      for (let i = 0; i < 10; i++) {
        await smallLogger.log({
          type: OperationType.MOUSE_CLICK,
          action: `click_${i}`,
          success: true
        });
      }

      expect(smallLogger.entries.length).toBe(5);
      expect(smallLogger.entries[0].action).toBe('click_5');
    });
  });

  describe('query', () => {
    beforeEach(async () => {
      await logger.log({ type: OperationType.MOUSE_CLICK, action: 'click1', success: true });
      await logger.log({ type: OperationType.KEYBOARD_TYPE, action: 'type1', success: false });
      await logger.log({ type: OperationType.DESKTOP_CLICK, action: 'desktop1', success: true });
      await logger.log({ type: OperationType.MOUSE_CLICK, action: 'click2', success: true });
    });

    it('should return all entries without filter', () => {
      const results = logger.query();
      expect(results.length).toBe(4);
    });

    it('should filter by type', () => {
      const results = logger.query({ type: OperationType.MOUSE_CLICK });
      expect(results.length).toBe(2);
      expect(results.every(e => e.type === OperationType.MOUSE_CLICK)).toBe(true);
    });

    it('should filter by success', () => {
      const results = logger.query({ success: false });
      expect(results.length).toBe(1);
      expect(results[0].action).toBe('type1');
    });

    it('should filter by risk level', () => {
      const results = logger.query({ riskLevel: RiskLevel.HIGH });
      expect(results.length).toBe(1);
      expect(results[0].type).toBe(OperationType.DESKTOP_CLICK);
    });

    it('should limit results', () => {
      const results = logger.query({ limit: 2 });
      expect(results.length).toBe(2);
    });
  });

  describe('getStats', () => {
    it('should return comprehensive statistics', async () => {
      await logger.log({ type: OperationType.MOUSE_CLICK, success: true });
      await logger.log({ type: OperationType.DESKTOP_CLICK, success: true });

      const stats = logger.getStats();

      expect(stats.totalOperations).toBe(2);
      expect(stats.successfulOperations).toBe(2);
      expect(stats.failedOperations).toBe(0);
      expect(stats.entriesInMemory).toBe(2);
      expect(stats.byRiskLevel[RiskLevel.LOW]).toBe(1);
      expect(stats.byRiskLevel[RiskLevel.HIGH]).toBe(1);
    });
  });

  describe('getHighRiskOperations', () => {
    it('should return high and critical risk operations', async () => {
      await logger.log({ type: OperationType.MOUSE_CLICK, success: true });
      await logger.log({ type: OperationType.DESKTOP_CLICK, success: true });
      await logger.log({ type: OperationType.DESKTOP_TYPE, success: true });

      const highRisk = logger.getHighRiskOperations();

      expect(highRisk.length).toBe(2);
    });
  });

  describe('getFailedOperations', () => {
    it('should return only failed operations', async () => {
      await logger.log({ type: OperationType.MOUSE_CLICK, success: true });
      await logger.log({ type: OperationType.KEYBOARD_TYPE, success: false, error: 'timeout' });
      await logger.log({ type: OperationType.SCROLL, success: false, error: 'element not found' });

      const failed = logger.getFailedOperations();

      expect(failed.length).toBe(2);
      expect(failed.every(e => e.success === false)).toBe(true);
    });
  });

  describe('export', () => {
    beforeEach(async () => {
      await logger.log({ type: OperationType.MOUSE_CLICK, action: 'click', success: true, duration: 50 });
      await logger.log({ type: OperationType.KEYBOARD_TYPE, action: 'type', success: true, duration: 100 });
    });

    it('should export as JSON', () => {
      const json = logger.export('json');
      const parsed = JSON.parse(json);

      expect(parsed.length).toBe(2);
      expect(parsed[0].type).toBe(OperationType.MOUSE_CLICK);
    });

    it('should export as CSV', () => {
      const csv = logger.export('csv');
      const lines = csv.split('\n');

      expect(lines.length).toBe(3); // header + 2 rows
      expect(lines[0]).toContain('id,timestamp,type,action,success,riskLevel,duration');
    });
  });

  describe('clear', () => {
    it('should clear all entries', async () => {
      await logger.log({ type: OperationType.MOUSE_CLICK, success: true });
      await logger.log({ type: OperationType.KEYBOARD_TYPE, success: true });

      expect(logger.entries.length).toBe(2);

      logger.clear();

      expect(logger.entries.length).toBe(0);
    });

    it('should emit cleared event', async () => {
      const handler = vi.fn();
      logger.on('cleared', handler);

      logger.clear();

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('wrap', () => {
    it('should wrap async function and log success', async () => {
      const operation = vi.fn().mockResolvedValue({ success: true, data: 'test' });
      const wrapped = logger.wrap(OperationType.MOUSE_CLICK, operation);

      const result = await wrapped({ x: 100, y: 200 });

      expect(result.success).toBe(true);
      expect(result.data).toBe('test');
      expect(logger.entries.length).toBe(1);
      expect(logger.entries[0].success).toBe(true);
    });

    it('should wrap async function and log failure', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('Test error'));
      const wrapped = logger.wrap(OperationType.MOUSE_CLICK, operation);

      await expect(wrapped({ x: 100, y: 200 })).rejects.toThrow('Test error');
      expect(logger.entries.length).toBe(1);
      expect(logger.entries[0].success).toBe(false);
      expect(logger.entries[0].error).toBe('Test error');
    });

    it('should record duration', async () => {
      const operation = vi.fn().mockImplementation(() =>
        new Promise(resolve => setTimeout(() => resolve({ success: true }), 50))
      );
      const wrapped = logger.wrap(OperationType.MOUSE_CLICK, operation);

      await wrapped({});

      expect(logger.entries[0].duration).toBeGreaterThanOrEqual(40);
    });
  });

  describe('getAuditLogger singleton', () => {
    it('should return same instance', () => {
      const logger1 = getAuditLogger();
      const logger2 = getAuditLogger();

      expect(logger1).toBe(logger2);
    });
  });

  describe('OperationType constants', () => {
    it('should have all operation types defined', () => {
      expect(OperationType.MOUSE_CLICK).toBe('mouse_click');
      expect(OperationType.MOUSE_MOVE).toBe('mouse_move');
      expect(OperationType.KEYBOARD_TYPE).toBe('keyboard_type');
      expect(OperationType.SCREENSHOT).toBe('screenshot');
      expect(OperationType.DESKTOP_CLICK).toBe('desktop_click');
      expect(OperationType.VISION_CLICK).toBe('vision_click');
    });
  });

  describe('RiskLevel constants', () => {
    it('should have all risk levels defined', () => {
      expect(RiskLevel.LOW).toBe('low');
      expect(RiskLevel.MEDIUM).toBe('medium');
      expect(RiskLevel.HIGH).toBe('high');
      expect(RiskLevel.CRITICAL).toBe('critical');
    });
  });
});
