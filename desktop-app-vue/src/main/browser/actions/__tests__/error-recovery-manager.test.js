/**
 * ErrorRecoveryManager 单元测试
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

const { ErrorRecoveryManager, ErrorType, RecoveryStrategy, getErrorRecoveryManager } = require('../error-recovery-manager');

describe('ErrorRecoveryManager', () => {
  let recovery;
  let mockEngine;
  let mockPage;

  beforeEach(() => {
    vi.clearAllMocks();

    mockPage = {
      reload: vi.fn().mockResolvedValue(undefined),
      waitForSelector: vi.fn().mockResolvedValue({}),
      evaluate: vi.fn().mockResolvedValue(undefined)
    };

    mockEngine = {
      getPage: vi.fn().mockReturnValue(mockPage)
    };

    recovery = new ErrorRecoveryManager(mockEngine, {
      maxRetries: 2,
      baseDelay: 100
    });

    // Add error event listener to prevent unhandled error exceptions
    recovery.on('error', () => {});
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with engine', () => {
      expect(recovery.browserEngine).toBe(mockEngine);
      expect(recovery.config.maxRetries).toBe(2);
    });

    it('should work without engine', () => {
      const r = new ErrorRecoveryManager();
      expect(r.browserEngine).toBeNull();
    });

    it('should have default strategies', () => {
      expect(recovery.config.strategies[ErrorType.ELEMENT_NOT_FOUND]).toBeDefined();
      expect(recovery.config.strategies[ErrorType.TIMEOUT]).toBeDefined();
    });
  });

  describe('executeWithRecovery', () => {
    it('should execute successful operation', async () => {
      const operation = vi.fn().mockResolvedValue({ data: 'success' });

      const result = await recovery.executeWithRecovery(operation, []);

      expect(result.success).toBe(true);
      expect(result.result.data).toBe('success');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure', async () => {
      const operation = vi.fn()
        .mockRejectedValueOnce(new Error('Element not found'))
        .mockResolvedValueOnce({ data: 'success' });

      const result = await recovery.executeWithRecovery(operation, []);

      expect(result.success).toBe(true);
      expect(result.recovered).toBe(true);
      expect(result.attempts).toBe(2);
    });

    it('should fail after max retries', async () => {
      // Use TIMEOUT error which has strategies without immediate ABORT
      const operation = vi.fn().mockRejectedValue(new Error('Timeout exceeded'));

      const result = await recovery.executeWithRecovery(operation, []);

      expect(result.success).toBe(false);
      // maxRetries: 2 means initial + 2 retries = 3 total attempts
      expect(result.attempts).toBe(3);
    });

    it('should classify errors correctly', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('Timeout exceeded'));

      const result = await recovery.executeWithRecovery(operation, []);

      expect(result.errorType).toBe(ErrorType.TIMEOUT);
    });

    it('should not retry when recovery disabled', async () => {
      const r = new ErrorRecoveryManager(mockEngine, { enableAutoRecovery: false });
      r.on('error', () => {}); // Prevent unhandled error exception
      const operation = vi.fn().mockRejectedValue(new Error('Test error'));

      await expect(r.executeWithRecovery(operation, []))
        .rejects.toThrow('Test error');
    });
  });

  describe('wrap', () => {
    it('should create wrapped function', async () => {
      const operation = vi.fn().mockResolvedValue({ data: 'success' });
      const wrapped = recovery.wrap(operation);

      const result = await wrapped('arg1', 'arg2');

      expect(result.success).toBe(true);
      expect(operation).toHaveBeenCalledWith('arg1', 'arg2');
    });
  });

  describe('manualRecover', () => {
    it('should execute recovery strategy manually', async () => {
      const result = await recovery.manualRecover('tab1', RecoveryStrategy.RETRY_WITH_DELAY, {});

      expect(result.success).toBe(true);
    });

    it('should handle recovery error', async () => {
      // Use ALTERNATIVE_ACTION with a failing alternative function
      // (REFRESH_AND_RETRY catches errors internally with .catch(() => {}))
      const result = await recovery.manualRecover('tab1', RecoveryStrategy.ALTERNATIVE_ACTION, {
        alternative: vi.fn().mockRejectedValue(new Error('Alternative failed'))
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Alternative failed');
    });
  });

  describe('setStrategies', () => {
    it('should set custom strategies', () => {
      recovery.setStrategies(ErrorType.TIMEOUT, [
        RecoveryStrategy.RETRY,
        RecoveryStrategy.ABORT
      ]);

      expect(recovery.config.strategies[ErrorType.TIMEOUT]).toEqual([
        RecoveryStrategy.RETRY,
        RecoveryStrategy.ABORT
      ]);
    });
  });

  describe('getStats', () => {
    it('should return statistics', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('Test error'));
      await recovery.executeWithRecovery(operation, []);

      const stats = recovery.getStats();

      expect(stats.totalErrors).toBeGreaterThan(0);
      expect(stats.recoveryRate).toBeDefined();
    });
  });

  describe('getHistory', () => {
    it('should return recovery history', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('Test error'));
      await recovery.executeWithRecovery(operation, []);

      const history = recovery.getHistory();

      expect(Array.isArray(history)).toBe(true);
    });
  });

  describe('reset', () => {
    it('should reset stats and history', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('Test'));
      await recovery.executeWithRecovery(operation, []);

      recovery.reset();

      const stats = recovery.getStats();
      expect(stats.totalErrors).toBe(0);
    });
  });

  describe('error classification', () => {
    it('should classify element not found errors', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('No element matching selector'));
      const result = await recovery.executeWithRecovery(operation, []);
      expect(result.errorType).toBe(ErrorType.ELEMENT_NOT_FOUND);
    });

    it('should classify network errors', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('Network connection failed'));
      const result = await recovery.executeWithRecovery(operation, []);
      expect(result.errorType).toBe(ErrorType.NETWORK_ERROR);
    });

    it('should classify permission errors', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('Permission denied'));
      const result = await recovery.executeWithRecovery(operation, []);
      expect(result.errorType).toBe(ErrorType.PERMISSION_DENIED);
    });
  });

  describe('ErrorType constants', () => {
    it('should have all error types defined', () => {
      expect(ErrorType.ELEMENT_NOT_FOUND).toBe('element_not_found');
      expect(ErrorType.TIMEOUT).toBe('timeout');
      expect(ErrorType.NETWORK_ERROR).toBe('network_error');
      expect(ErrorType.PERMISSION_DENIED).toBe('permission_denied');
    });
  });

  describe('RecoveryStrategy constants', () => {
    it('should have all strategies defined', () => {
      expect(RecoveryStrategy.RETRY).toBe('retry');
      expect(RecoveryStrategy.EXPONENTIAL_BACKOFF).toBe('exponential');
      expect(RecoveryStrategy.REFRESH_AND_RETRY).toBe('refresh');
      expect(RecoveryStrategy.ABORT).toBe('abort');
    });
  });

  describe('getErrorRecoveryManager singleton', () => {
    it('should return singleton instance', () => {
      const r1 = getErrorRecoveryManager(mockEngine);
      const r2 = getErrorRecoveryManager();

      expect(r1).toBe(r2);
    });
  });
});
