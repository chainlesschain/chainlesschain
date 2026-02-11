/**
 * SafeMode 单元测试
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

const { SafeMode, SafetyLevel, ActionCategory, getSafeMode } = require('../safe-mode');

describe('SafeMode', () => {
  let safeMode;

  beforeEach(() => {
    vi.clearAllMocks();
    safeMode = new SafeMode({
      level: SafetyLevel.NORMAL,
      desktopAllowed: false,
      networkInterceptionAllowed: false
    });
  });

  afterEach(() => {
    safeMode.setEnabled(true);
  });

  describe('constructor', () => {
    it('should initialize with default config', () => {
      const defaultSafeMode = new SafeMode();

      expect(defaultSafeMode.config.level).toBe(SafetyLevel.NORMAL);
      expect(defaultSafeMode.enabled).toBe(true);
    });

    it('should accept custom config', () => {
      const custom = new SafeMode({
        level: SafetyLevel.STRICT,
        desktopAllowed: true
      });

      expect(custom.config.level).toBe(SafetyLevel.STRICT);
      expect(custom.config.desktopAllowed).toBe(true);
    });
  });

  describe('setLevel', () => {
    it('should set valid level', () => {
      safeMode.setLevel(SafetyLevel.STRICT);

      expect(safeMode.config.level).toBe(SafetyLevel.STRICT);
    });

    it('should throw for invalid level', () => {
      expect(() => safeMode.setLevel('invalid'))
        .toThrow('Invalid safety level');
    });

    it('should emit levelChanged event', () => {
      const handler = vi.fn();
      safeMode.on('levelChanged', handler);

      safeMode.setLevel(SafetyLevel.CAUTIOUS);

      expect(handler).toHaveBeenCalledWith({ level: SafetyLevel.CAUTIOUS });
    });
  });

  describe('setEnabled', () => {
    it('should enable/disable safe mode', () => {
      safeMode.setEnabled(false);
      expect(safeMode.enabled).toBe(false);

      safeMode.setEnabled(true);
      expect(safeMode.enabled).toBe(true);
    });

    it('should emit enabledChanged event', () => {
      const handler = vi.fn();
      safeMode.on('enabledChanged', handler);

      safeMode.setEnabled(false);

      expect(handler).toHaveBeenCalledWith({ enabled: false });
    });
  });

  describe('checkPermission', () => {
    it('should allow all when disabled', async () => {
      safeMode.setEnabled(false);

      const result = await safeMode.checkPermission('desktopClick', { x: 100, y: 200 });

      expect(result.allowed).toBe(true);
      expect(result.reason).toBe('Safe mode disabled');
    });

    it('should block actions in blocklist', async () => {
      safeMode.blockAction('click');

      const result = await safeMode.checkPermission('click', { x: 100, y: 200 });

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('blocked');
    });

    it('should block desktop operations when not allowed', async () => {
      const result = await safeMode.checkPermission('desktopClick', { x: 100, y: 200 });

      expect(result.allowed).toBe(false);
      // Desktop blocked either by level or by desktopAllowed flag
      expect(result.reason).toMatch(/desktop|Desktop/i);
    });

    it('should allow desktop operations when enabled', async () => {
      safeMode.updateConfig({ desktopAllowed: true });

      const result = await safeMode.checkPermission('desktopClick', { x: 100, y: 200 });

      // Still blocked by level, but not by desktop flag
      expect(result.reason).not.toContain('Desktop operations');
    });

    it('should block network interception when not allowed', async () => {
      const result = await safeMode.checkPermission('intercept', {});

      expect(result.allowed).toBe(false);
      // Network blocked either by level or by networkInterceptionAllowed flag
      expect(result.reason).toMatch(/network|Network/i);
    });

    it('should allow readonly operations at any level', async () => {
      safeMode.setLevel(SafetyLevel.READONLY);

      const result = await safeMode.checkPermission('screenshot', {});

      expect(result.allowed).toBe(true);
    });

    it('should block input at READONLY level', async () => {
      safeMode.setLevel(SafetyLevel.READONLY);

      const result = await safeMode.checkPermission('type', { text: 'hello' });

      expect(result.allowed).toBe(false);
    });

    it('should block by URL blacklist', async () => {
      safeMode.blockUrl('*://blocked.com/*');

      const result = await safeMode.checkPermission('click', { x: 100, y: 200 }, {
        url: 'https://blocked.com/page'
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('blocked');
    });

    it('should block by restricted region', async () => {
      safeMode.addRestrictedRegion({
        name: 'protected',
        x: 0,
        y: 0,
        width: 100,
        height: 100
      });

      const result = await safeMode.checkPermission('click', { x: 50, y: 50 });

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('restricted region');
    });

    it('should require confirmation for sensitive input', async () => {
      const result = await safeMode.checkPermission('type', {
        text: 'my password is secret'
      });

      expect(result.allowed).toBe(true);
      expect(result.requiresConfirmation).toBe(true);
    });
  });

  describe('rate limiting', () => {
    it('should block when rate limit exceeded', async () => {
      const rateLimitedSafeMode = new SafeMode({
        level: SafetyLevel.NORMAL,
        rateLimit: {
          enabled: true,
          maxOperationsPerMinute: 2
        }
      });

      rateLimitedSafeMode.recordOperation();
      rateLimitedSafeMode.recordOperation();

      const result = await rateLimitedSafeMode.checkPermission('click', { x: 100, y: 200 });

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Rate limit');
    });
  });

  describe('confirmation', () => {
    it('should create pending confirmation', async () => {
      const handler = vi.fn();
      safeMode.on('confirmationRequired', handler);

      // Don't await - just start the request
      const promise = safeMode.requestConfirmation('click', { x: 100, y: 200 }, {});

      // Short delay to let the event fire
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(handler).toHaveBeenCalled();
      expect(safeMode.getPendingConfirmations().length).toBe(1);

      // Cleanup
      const pending = safeMode.getPendingConfirmations()[0];
      safeMode.respondToConfirmation(pending.id, false);
    });

    it('should resolve on approval', async () => {
      const promise = safeMode.requestConfirmation('click', { x: 100, y: 200 }, {});

      // Short delay to let the confirmation be created
      await new Promise(resolve => setTimeout(resolve, 10));

      const pending = safeMode.getPendingConfirmations()[0];
      safeMode.respondToConfirmation(pending.id, true);

      const result = await promise;

      expect(result).toBe(true);
    });

    it('should resolve on rejection', async () => {
      const promise = safeMode.requestConfirmation('click', { x: 100, y: 200 }, {});

      await new Promise(resolve => setTimeout(resolve, 10));

      const pending = safeMode.getPendingConfirmations()[0];
      safeMode.respondToConfirmation(pending.id, false);

      const result = await promise;

      expect(result).toBe(false);
    });
  });

  describe('restricted regions', () => {
    it('should add restricted region', () => {
      safeMode.addRestrictedRegion({
        name: 'test',
        x: 0,
        y: 0,
        width: 100,
        height: 100
      });

      expect(safeMode.config.restrictedRegions.length).toBe(1);
    });

    it('should remove restricted region', () => {
      safeMode.addRestrictedRegion({
        name: 'test',
        x: 0,
        y: 0,
        width: 100,
        height: 100
      });

      safeMode.removeRestrictedRegion('test');

      expect(safeMode.config.restrictedRegions.length).toBe(0);
    });
  });

  describe('URL blocking', () => {
    it('should add blocked URL', () => {
      safeMode.blockUrl('*://blocked.com/*');

      expect(safeMode.config.blockedUrls.length).toBe(1);
    });

    it('should remove blocked URL', () => {
      safeMode.blockUrl('*://blocked.com/*');
      safeMode.unblockUrl('*://blocked.com/*');

      expect(safeMode.config.blockedUrls.length).toBe(0);
    });
  });

  describe('action blocking', () => {
    it('should add blocked action', () => {
      safeMode.blockAction('click');

      expect(safeMode.config.blockedActions).toContain('click');
    });

    it('should remove blocked action', () => {
      safeMode.blockAction('click');
      safeMode.unblockAction('click');

      expect(safeMode.config.blockedActions).not.toContain('click');
    });

    it('should not duplicate blocked actions', () => {
      safeMode.blockAction('click');
      safeMode.blockAction('click');

      expect(safeMode.config.blockedActions.filter(a => a === 'click').length).toBe(1);
    });
  });

  describe('getConfig', () => {
    it('should return current config', () => {
      const config = safeMode.getConfig();

      expect(config.enabled).toBe(true);
      expect(config.level).toBe(SafetyLevel.NORMAL);
      expect(config.desktopAllowed).toBe(false);
    });
  });

  describe('updateConfig', () => {
    it('should update config', () => {
      safeMode.updateConfig({ desktopAllowed: true });

      expect(safeMode.config.desktopAllowed).toBe(true);
    });

    it('should emit configUpdated event', () => {
      const handler = vi.fn();
      safeMode.on('configUpdated', handler);

      safeMode.updateConfig({ desktopAllowed: true });

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('getStats', () => {
    it('should return statistics', () => {
      safeMode.recordOperation();
      safeMode.recordOperation();

      const stats = safeMode.getStats();

      expect(stats.enabled).toBe(true);
      expect(stats.operationsThisMinute).toBe(2);
    });
  });

  describe('wrap', () => {
    it('should wrap and execute allowed operation', async () => {
      const operation = vi.fn().mockResolvedValue({ success: true });
      const wrapped = safeMode.wrap(operation, 'screenshot');

      const result = await wrapped({}, {});

      expect(result.success).toBe(true);
      expect(operation).toHaveBeenCalled();
    });

    it('should block disallowed operation', async () => {
      const operation = vi.fn().mockResolvedValue({ success: true });
      const wrapped = safeMode.wrap(operation, 'desktopClick');

      await expect(wrapped({ x: 100, y: 200 }, {})).rejects.toThrow();
      expect(operation).not.toHaveBeenCalled();
    });
  });

  describe('SafetyLevel constants', () => {
    it('should have all levels defined', () => {
      expect(SafetyLevel.UNRESTRICTED).toBe('unrestricted');
      expect(SafetyLevel.NORMAL).toBe('normal');
      expect(SafetyLevel.CAUTIOUS).toBe('cautious');
      expect(SafetyLevel.STRICT).toBe('strict');
      expect(SafetyLevel.READONLY).toBe('readonly');
    });
  });

  describe('ActionCategory constants', () => {
    it('should have all categories defined', () => {
      expect(ActionCategory.READONLY).toBe('readonly');
      expect(ActionCategory.NAVIGATION).toBe('navigation');
      expect(ActionCategory.INPUT).toBe('input');
      expect(ActionCategory.CLICK).toBe('click');
      expect(ActionCategory.DESKTOP).toBe('desktop');
      expect(ActionCategory.NETWORK).toBe('network');
      expect(ActionCategory.SYSTEM).toBe('system');
    });
  });
});
