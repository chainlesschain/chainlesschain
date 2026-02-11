/**
 * AutomationPolicy 单元测试
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

const { AutomationPolicy, PolicyType, PolicyAction, getAutomationPolicy } = require('../automation-policy');

describe('AutomationPolicy', () => {
  let policy;

  beforeEach(() => {
    vi.clearAllMocks();
    policy = new AutomationPolicy({
      loadDefaults: false
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with default config', () => {
      expect(policy.config.enablePolicies).toBe(true);
      expect(policy.config.defaultAction).toBe(PolicyAction.ALLOW);
    });

    it('should load default policies when enabled', () => {
      const p = new AutomationPolicy({ loadDefaults: true });
      expect(p.policies.size).toBeGreaterThan(0);
    });

    it('should accept custom policies', () => {
      const p = new AutomationPolicy({
        loadDefaults: false,
        policies: [
          { id: 'custom-1', type: PolicyType.URL_BLACKLIST, config: { patterns: ['*test*'] } }
        ]
      });
      expect(p.policies.has('custom-1')).toBe(true);
    });
  });

  describe('addPolicy', () => {
    it('should add a policy', () => {
      const result = policy.addPolicy({
        id: 'test-policy',
        name: 'Test Policy',
        type: PolicyType.URL_BLACKLIST,
        config: { patterns: ['*blocked*'] }
      });

      expect(result.success).toBe(true);
      expect(result.policy.id).toBe('test-policy');
    });

    it('should generate ID if not provided', () => {
      const result = policy.addPolicy({
        name: 'No ID Policy',
        type: PolicyType.RATE_LIMIT
      });

      expect(result.success).toBe(true);
      expect(result.policy.id).toBeDefined();
    });
  });

  describe('removePolicy', () => {
    it('should remove existing policy', () => {
      policy.addPolicy({ id: 'to-remove', type: PolicyType.URL_BLACKLIST });
      const result = policy.removePolicy('to-remove');

      expect(result.success).toBe(true);
      expect(policy.policies.has('to-remove')).toBe(false);
    });

    it('should fail for non-existent policy', () => {
      const result = policy.removePolicy('non-existent');
      expect(result.success).toBe(false);
    });
  });

  describe('updatePolicy', () => {
    it('should update existing policy', () => {
      policy.addPolicy({ id: 'update-me', name: 'Original', type: PolicyType.URL_BLACKLIST });
      const result = policy.updatePolicy('update-me', { name: 'Updated' });

      expect(result.success).toBe(true);
      expect(result.policy.name).toBe('Updated');
    });

    it('should fail for non-existent policy', () => {
      const result = policy.updatePolicy('non-existent', { name: 'Test' });
      expect(result.success).toBe(false);
    });
  });

  describe('setEnabled', () => {
    it('should enable/disable policy', () => {
      policy.addPolicy({ id: 'toggle-me', type: PolicyType.URL_BLACKLIST });

      policy.setEnabled('toggle-me', false);
      expect(policy.get('toggle-me').enabled).toBe(false);

      policy.setEnabled('toggle-me', true);
      expect(policy.get('toggle-me').enabled).toBe(true);
    });
  });

  describe('check', () => {
    it('should allow when policies disabled', async () => {
      policy.config.enablePolicies = false;
      const result = await policy.check({ url: 'https://blocked.com' });

      expect(result.allowed).toBe(true);
    });

    it('should allow when no policies match', async () => {
      policy.addPolicy({
        id: 'blacklist',
        type: PolicyType.URL_BLACKLIST,
        config: { patterns: ['*blocked*'], action: PolicyAction.DENY }
      });

      const result = await policy.check({ url: 'https://allowed.com' });
      expect(result.allowed).toBe(true);
    });

    it('should deny when URL matches blacklist', async () => {
      policy.addPolicy({
        id: 'blacklist',
        type: PolicyType.URL_BLACKLIST,
        config: { patterns: ['*blocked*'], action: PolicyAction.DENY }
      });

      const result = await policy.check({ url: 'https://blocked.com/page' });
      expect(result.allowed).toBe(false);
    });

    it('should deny when domain matches blacklist', async () => {
      policy.addPolicy({
        id: 'domain-blacklist',
        type: PolicyType.DOMAIN_BLACKLIST,
        config: { patterns: ['*payment*'], action: PolicyAction.DENY }
      });

      const result = await policy.check({ url: 'https://payment.example.com' });
      expect(result.allowed).toBe(false);
    });

    it('should handle rate limiting', async () => {
      policy.addPolicy({
        id: 'rate-limit',
        type: PolicyType.RATE_LIMIT,
        config: { maxActions: 2, windowMs: 60000, action: PolicyAction.DENY }
      });

      await policy.check({ action: 'click' });
      await policy.check({ action: 'click' });
      const result = await policy.check({ action: 'click' });

      expect(result.allowed).toBe(false);
    });

    it('should handle content filter', async () => {
      policy.addPolicy({
        id: 'content-filter',
        type: PolicyType.CONTENT_FILTER,
        config: { patterns: ['password'], action: PolicyAction.DENY }
      });

      const result = await policy.check({
        url: 'https://example.com',
        content: 'Enter your password'
      });

      expect(result.allowed).toBe(false);
    });

    it('should handle action restrictions', async () => {
      policy.addPolicy({
        id: 'action-restrict',
        type: PolicyType.ACTION_RESTRICTION,
        config: { restrictedActions: ['delete'], action: PolicyAction.DENY }
      });

      const result = await policy.check({ action: 'delete' });
      expect(result.allowed).toBe(false);

      const result2 = await policy.check({ action: 'click' });
      expect(result2.allowed).toBe(true);
    });

    it('should handle region protection', async () => {
      policy.addPolicy({
        id: 'region-protect',
        type: PolicyType.REGION_PROTECTION,
        config: {
          protectedRegions: [
            { x: 0, y: 0, width: 100, height: 100, name: 'TopLeft' }
          ],
          action: PolicyAction.DENY
        }
      });

      const result = await policy.check({ target: { x: 50, y: 50 } });
      expect(result.allowed).toBe(false);

      const result2 = await policy.check({ target: { x: 200, y: 200 } });
      expect(result2.allowed).toBe(true);
    });
  });

  describe('list', () => {
    it('should return all policies sorted by priority', () => {
      policy.addPolicy({ id: 'low', priority: 900, type: PolicyType.URL_BLACKLIST });
      policy.addPolicy({ id: 'high', priority: 100, type: PolicyType.URL_BLACKLIST });
      policy.addPolicy({ id: 'medium', priority: 500, type: PolicyType.URL_BLACKLIST });

      const list = policy.list();

      expect(list[0].id).toBe('high');
      expect(list[1].id).toBe('medium');
      expect(list[2].id).toBe('low');
    });
  });

  describe('get', () => {
    it('should get policy by ID', () => {
      policy.addPolicy({ id: 'get-me', name: 'Get Me', type: PolicyType.URL_BLACKLIST });
      const result = policy.get('get-me');

      expect(result).toBeDefined();
      expect(result.name).toBe('Get Me');
    });

    it('should return null for non-existent policy', () => {
      const result = policy.get('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('getViolations', () => {
    it('should return violation history', async () => {
      policy.addPolicy({
        id: 'deny-all',
        type: PolicyType.URL_BLACKLIST,
        config: { patterns: ['*'], action: PolicyAction.DENY }
      });

      await policy.check({ url: 'https://example.com' });

      const violations = policy.getViolations();
      expect(violations.length).toBeGreaterThan(0);
    });
  });

  describe('getStats', () => {
    it('should return statistics', async () => {
      await policy.check({ url: 'https://example.com' });

      const stats = policy.getStats();

      expect(stats.totalChecks).toBe(1);
      expect(stats.allowed).toBeDefined();
    });
  });

  describe('resetStats', () => {
    it('should reset all statistics', async () => {
      await policy.check({ url: 'https://example.com' });

      policy.resetStats();

      const stats = policy.getStats();
      expect(stats.totalChecks).toBe(0);
    });
  });

  describe('export and import', () => {
    it('should export policies', () => {
      policy.addPolicy({ id: 'export-me', type: PolicyType.URL_BLACKLIST });

      const data = policy.export();

      expect(data.policies.length).toBe(1);
      expect(data.exportedAt).toBeDefined();
    });

    it('should import policies', () => {
      const data = {
        policies: [
          { id: 'imported-1', type: PolicyType.URL_BLACKLIST, config: {} },
          { id: 'imported-2', type: PolicyType.RATE_LIMIT, config: {} }
        ]
      };

      const result = policy.import(data);

      expect(result.success).toBe(true);
      expect(result.imported).toBe(2);
    });

    it('should merge when import with merge=true', () => {
      policy.addPolicy({ id: 'existing', type: PolicyType.URL_BLACKLIST });

      policy.import({ policies: [{ id: 'new', type: PolicyType.RATE_LIMIT }] }, true);

      expect(policy.policies.has('existing')).toBe(true);
      expect(policy.policies.has('new')).toBe(true);
    });
  });

  describe('PolicyType constants', () => {
    it('should have all types defined', () => {
      expect(PolicyType.URL_WHITELIST).toBe('url_whitelist');
      expect(PolicyType.URL_BLACKLIST).toBe('url_blacklist');
      expect(PolicyType.DOMAIN_WHITELIST).toBe('domain_whitelist');
      expect(PolicyType.DOMAIN_BLACKLIST).toBe('domain_blacklist');
      expect(PolicyType.ACTION_RESTRICTION).toBe('action_restriction');
      expect(PolicyType.TIME_WINDOW).toBe('time_window');
      expect(PolicyType.RATE_LIMIT).toBe('rate_limit');
      expect(PolicyType.REGION_PROTECTION).toBe('region_protection');
      expect(PolicyType.CONTENT_FILTER).toBe('content_filter');
    });
  });

  describe('PolicyAction constants', () => {
    it('should have all actions defined', () => {
      expect(PolicyAction.ALLOW).toBe('allow');
      expect(PolicyAction.DENY).toBe('deny');
      expect(PolicyAction.ASK).toBe('ask');
      expect(PolicyAction.LOG).toBe('log');
      expect(PolicyAction.DELAY).toBe('delay');
    });
  });

  describe('getAutomationPolicy singleton', () => {
    it('should return singleton instance', () => {
      const p1 = getAutomationPolicy();
      const p2 = getAutomationPolicy();

      expect(p1).toBe(p2);
    });
  });
});
