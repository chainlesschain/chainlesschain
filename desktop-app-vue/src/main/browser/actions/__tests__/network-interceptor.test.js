/**
 * NetworkInterceptor 单元测试
 */

import { vi } from 'vitest';

// Alias jest to vi for compatibility
const jest = { fn: vi.fn };

const { NetworkInterceptor, NetworkCondition, InterceptType } = require('../network-interceptor');

describe('NetworkInterceptor', () => {
  let mockEngine;
  let mockPage;
  let mockContext;
  let mockCDPSession;
  let interceptor;

  beforeEach(() => {
    vi.clearAllMocks();

    mockCDPSession = {
      send: vi.fn().mockResolvedValue(undefined),
      detach: vi.fn().mockResolvedValue(undefined)
    };

    mockContext = {
      newCDPSession: vi.fn().mockResolvedValue(mockCDPSession)
    };

    mockPage = {
      route: vi.fn().mockResolvedValue(undefined),
      unroute: vi.fn().mockResolvedValue(undefined),
      context: vi.fn().mockReturnValue(mockContext),
      on: vi.fn(),
      off: vi.fn()
    };

    mockEngine = {
      getPage: vi.fn().mockReturnValue(mockPage)
    };

    interceptor = new NetworkInterceptor(mockEngine);
  });

  describe('addRule', () => {
    it('should add rule with string pattern', () => {
      const ruleId = interceptor.addRule({
        urlPattern: '**/api/users',
        type: InterceptType.MOCK,
        response: { status: 200, body: '{}' }
      });

      expect(ruleId).toMatch(/^rule_/);
      expect(interceptor.interceptRules.size).toBe(1);
    });

    it('should add rule with regex pattern', () => {
      const ruleId = interceptor.addRule({
        urlPattern: /\/api\/v\d+\/users/,
        type: InterceptType.ABORT
      });

      expect(ruleId).toBeDefined();
      const rule = interceptor.interceptRules.get(ruleId);
      expect(rule.urlMatcher).toBeInstanceOf(RegExp);
    });

    it('should emit ruleAdded event', () => {
      const listener = vi.fn();
      interceptor.on('ruleAdded', listener);

      interceptor.addRule({ urlPattern: '**/test', type: InterceptType.CONTINUE });

      expect(listener).toHaveBeenCalled();
    });
  });

  describe('removeRule', () => {
    it('should remove existing rule', () => {
      const ruleId = interceptor.addRule({
        urlPattern: '**/test',
        type: InterceptType.ABORT
      });

      const removed = interceptor.removeRule(ruleId);

      expect(removed).toBe(true);
      expect(interceptor.interceptRules.size).toBe(0);
    });

    it('should return false for non-existent rule', () => {
      const removed = interceptor.removeRule('non-existent');
      expect(removed).toBe(false);
    });
  });

  describe('clearRules', () => {
    it('should clear all rules', () => {
      interceptor.addRule({ urlPattern: '**/a', type: InterceptType.ABORT });
      interceptor.addRule({ urlPattern: '**/b', type: InterceptType.ABORT });

      interceptor.clearRules();

      expect(interceptor.interceptRules.size).toBe(0);
    });
  });

  describe('enableInterception', () => {
    it('should set up route handler', async () => {
      await interceptor.enableInterception('tab-1');

      expect(mockPage.route).toHaveBeenCalledWith('**/*', expect.any(Function));
      expect(interceptor.activeInterceptors.has('tab-1')).toBe(true);
    });

    it('should not duplicate interceptor', async () => {
      await interceptor.enableInterception('tab-1');
      await interceptor.enableInterception('tab-1');

      expect(mockPage.route).toHaveBeenCalledTimes(1);
    });
  });

  describe('disableInterception', () => {
    it('should remove route handler', async () => {
      await interceptor.enableInterception('tab-1');
      await interceptor.disableInterception('tab-1');

      expect(mockPage.unroute).toHaveBeenCalledWith('**/*');
      expect(interceptor.activeInterceptors.has('tab-1')).toBe(false);
    });
  });

  describe('mockAPI', () => {
    it('should create mock rule for API', () => {
      const ruleId = interceptor.mockAPI('**/api/login', {
        status: 200,
        body: { success: true, token: 'test-token' }
      });

      expect(ruleId).toBeDefined();
      const rule = interceptor.interceptRules.get(ruleId);
      expect(rule.type).toBe(InterceptType.MOCK);
      expect(rule.response.status).toBe(200);
    });
  });

  describe('blockResourceTypes', () => {
    it('should create block rule for resource types', () => {
      const ruleId = interceptor.blockResourceTypes('tab-1', ['image', 'media']);

      expect(ruleId).toBeDefined();
      const rule = interceptor.interceptRules.get(ruleId);
      expect(rule.type).toBe(InterceptType.ABORT);
    });
  });

  describe('setNetworkCondition', () => {
    it('should set network condition by preset name', async () => {
      await interceptor.setNetworkCondition('tab-1', 'SLOW_3G');

      expect(mockContext.newCDPSession).toHaveBeenCalled();
      expect(mockCDPSession.send).toHaveBeenCalledWith(
        'Network.emulateNetworkConditions',
        expect.objectContaining({
          offline: false,
          latency: 400
        })
      );
    });

    it('should set network condition by object', async () => {
      await interceptor.setNetworkCondition('tab-1', NetworkCondition.WIFI);

      expect(mockCDPSession.send).toHaveBeenCalledWith(
        'Network.emulateNetworkConditions',
        expect.objectContaining({
          latency: 10
        })
      );
    });

    it('should throw for unknown preset', async () => {
      await expect(
        interceptor.setNetworkCondition('tab-1', 'UNKNOWN_PRESET')
      ).rejects.toThrow('Unknown network condition');
    });
  });

  describe('resetNetworkCondition', () => {
    it('should reset to no throttle', async () => {
      await interceptor.resetNetworkCondition('tab-1');

      expect(mockCDPSession.send).toHaveBeenCalledWith(
        'Network.emulateNetworkConditions',
        expect.objectContaining({
          downloadThroughput: -1,
          uploadThroughput: -1
        })
      );
    });
  });

  describe('waitForRequest', () => {
    it('should resolve when matching request found', async () => {
      const mockRequest = {
        url: () => 'https://api.example.com/users',
        method: () => 'GET',
        headers: () => ({}),
        postData: () => null
      };

      mockPage.on.mockImplementation((event, handler) => {
        if (event === 'request') {
          setTimeout(() => handler(mockRequest), 10);
        }
      });

      const result = await interceptor.waitForRequest('tab-1', '/users', { timeout: 1000 });

      expect(result.url).toContain('/users');
      expect(result.method).toBe('GET');
    });

    it('should timeout if no matching request', async () => {
      await expect(
        interceptor.waitForRequest('tab-1', '/nonexistent', { timeout: 100 })
      ).rejects.toThrow('Timeout waiting for request');
    });
  });

  describe('waitForResponse', () => {
    it('should resolve when matching response found', async () => {
      const mockResponse = {
        url: () => 'https://api.example.com/data',
        status: () => 200,
        headers: () => ({}),
        text: () => Promise.resolve('{"data": []}')
      };

      mockPage.on.mockImplementation((event, handler) => {
        if (event === 'response') {
          setTimeout(() => handler(mockResponse), 10);
        }
      });

      const result = await interceptor.waitForResponse('tab-1', '/data', { timeout: 1000 });

      expect(result.url).toContain('/data');
      expect(result.status).toBe(200);
    });
  });

  describe('getRequestLog', () => {
    beforeEach(() => {
      interceptor.requestLog = [
        { id: '1', targetId: 'tab-1', url: 'https://a.com/api/1', method: 'GET', timestamp: 1000 },
        { id: '2', targetId: 'tab-1', url: 'https://b.com/api/2', method: 'POST', timestamp: 2000, intercepted: true },
        { id: '3', targetId: 'tab-2', url: 'https://c.com/api/3', method: 'GET', timestamp: 3000 }
      ];
    });

    it('should return all logs without filter', () => {
      const logs = interceptor.getRequestLog();
      expect(logs.length).toBe(3);
    });

    it('should filter by targetId', () => {
      const logs = interceptor.getRequestLog({ targetId: 'tab-1' });
      expect(logs.length).toBe(2);
    });

    it('should filter by method', () => {
      const logs = interceptor.getRequestLog({ method: 'POST' });
      expect(logs.length).toBe(1);
    });

    it('should filter by urlPattern', () => {
      const logs = interceptor.getRequestLog({ urlPattern: 'b\\.com' });
      expect(logs.length).toBe(1);
    });

    it('should filter intercepted only', () => {
      const logs = interceptor.getRequestLog({ interceptedOnly: true });
      expect(logs.length).toBe(1);
    });

    it('should limit results', () => {
      const logs = interceptor.getRequestLog({ limit: 2 });
      expect(logs.length).toBe(2);
    });
  });

  describe('clearRequestLog', () => {
    it('should clear all logs', () => {
      interceptor.requestLog = [{ id: '1' }, { id: '2' }];
      interceptor.clearRequestLog();
      expect(interceptor.requestLog.length).toBe(0);
    });

    it('should clear logs for specific target', () => {
      interceptor.requestLog = [
        { id: '1', targetId: 'tab-1' },
        { id: '2', targetId: 'tab-2' }
      ];
      interceptor.clearRequestLog('tab-1');
      expect(interceptor.requestLog.length).toBe(1);
      expect(interceptor.requestLog[0].targetId).toBe('tab-2');
    });
  });

  describe('getStatus', () => {
    it('should return current status', async () => {
      interceptor.addRule({ urlPattern: '**/test', type: InterceptType.ABORT });
      await interceptor.enableInterception('tab-1');

      const status = interceptor.getStatus();

      expect(status.rulesCount).toBe(1);
      expect(status.activeInterceptors).toContain('tab-1');
      expect(status.logSize).toBe(0);
    });
  });

  describe('execute', () => {
    it('should route to enable', async () => {
      const result = await interceptor.execute('tab-1', { action: 'enable' });
      expect(result.success).toBe(true);
      expect(result.action).toBe('enabled');
    });

    it('should route to disable', async () => {
      await interceptor.enableInterception('tab-1');
      const result = await interceptor.execute('tab-1', { action: 'disable' });
      expect(result.success).toBe(true);
      expect(result.action).toBe('disabled');
    });

    it('should route to addRule', async () => {
      const result = await interceptor.execute('tab-1', {
        action: 'addRule',
        rule: { urlPattern: '**/test', type: InterceptType.ABORT }
      });
      expect(result.success).toBe(true);
      expect(result.ruleId).toBeDefined();
    });

    it('should route to mockAPI', async () => {
      const result = await interceptor.execute('tab-1', {
        action: 'mockAPI',
        urlPattern: '**/api/test',
        response: { status: 200, body: '{}' }
      });
      expect(result.success).toBe(true);
      expect(result.ruleId).toBeDefined();
    });

    it('should route to getStatus', async () => {
      const result = await interceptor.execute('tab-1', { action: 'getStatus' });
      expect(result.success).toBe(true);
      expect(result.rulesCount).toBeDefined();
    });

    it('should throw for unknown action', async () => {
      await expect(
        interceptor.execute('tab-1', { action: 'unknown' })
      ).rejects.toThrow('Unknown network action');
    });
  });
});
