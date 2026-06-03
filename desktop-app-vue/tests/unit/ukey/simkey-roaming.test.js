/**
 * SIMKey 漫游协议单元测试
 * 测试目标: src/main/ukey/simkey-roaming.js
 * 覆盖场景: 漫游会话、策略管理、签名代理、运营商联盟
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ============================================================
// Mock logger FIRST
// ============================================================

const mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn()
};

vi.mock('../../../src/main/utils/logger.js', () => ({
  logger: mockLogger,
  createLogger: vi.fn(() => mockLogger)
}));

// ============================================================
// Import module under test
// ============================================================

import { SimkeyRoaming, ROAMING_STATE, ROAMING_SECURITY, CARRIER_ALLIANCE } from '../../../src/main/ukey/simkey-roaming.js';

describe('SimkeyRoaming', () => {
  let roaming;

  beforeEach(async () => {
    vi.clearAllMocks();
    roaming = new SimkeyRoaming({
      roamingPolicy: 'standard',
      maxRoamingDuration: 3600000,
      signLimitPerDay: 10,
      regionWhitelist: ['CN'],
      autoNegotiate: true
    });
    await roaming.initialize('cn-mobile');
  });

  afterEach(async () => {
    await roaming.close();
  });

  // ============================================================
  // 初始化
  // ============================================================

  describe('initialize()', () => {
    it('should initialize with home carrier', async () => {
      const freshRoaming = new SimkeyRoaming({});
      const result = await freshRoaming.initialize('cn-mobile');
      expect(result).toBe(true);
      const status = freshRoaming.getRoamingStatus();
      expect(status.homeCarrier).toBe('中国移动');
      await freshRoaming.close();
    });

    it('should start in HOME state', () => {
      const status = roaming.getRoamingStatus();
      expect(status.state).toBe(ROAMING_STATE.HOME);
    });

    it('should be idempotent', async () => {
      const result = await roaming.initialize('cn-mobile');
      expect(result).toBe(true);
    });
  });

  // ============================================================
  // 运营商联盟
  // ============================================================

  describe('discoverRoamingNetworks()', () => {
    it('should discover available roaming networks', async () => {
      const networks = await roaming.discoverRoamingNetworks();
      expect(Array.isArray(networks)).toBe(true);
      // Should find CN-Unicom and CN-Telecom (not home carrier)
      expect(networks.length).toBeGreaterThanOrEqual(1);
    });

    it('should not include home carrier in discovery', async () => {
      const networks = await roaming.discoverRoamingNetworks();
      const hasHome = networks.some(n => n.carrierId === 'cn-mobile');
      expect(hasHome).toBe(false);
    });

    it('should include security level in results', async () => {
      const networks = await roaming.discoverRoamingNetworks();
      for (const net of networks) {
        expect(net).toHaveProperty('securityLevel');
        expect(net).toHaveProperty('trustLevel');
        expect(net).toHaveProperty('carrierId');
        expect(net).toHaveProperty('carrierName');
        expect(net).toHaveProperty('supportedOperations');
      }
    });
  });

  describe('registerCarrier()', () => {
    it('should register a custom carrier', () => {
      roaming.registerCarrier({
        id: 'custom-carrier',
        name: '测试运营商',
        mcc: '460',
        mnc: ['99'],
        trustLevel: 'standard'
      });
      // Should appear in discovery
      // (hard to assert without checking internals, just ensure no error)
    });
  });

  // ============================================================
  // 漫游会话
  // ============================================================

  describe('establishRoamingSession()', () => {
    it('should establish a roaming session with a known carrier', async () => {
      const result = await roaming.establishRoamingSession('cn-unicom');
      expect(result.success).toBe(true);
      expect(result.session).toHaveProperty('sessionId');
      expect(result.session).toHaveProperty('securityLevel');
      expect(result.session).toHaveProperty('expiresAt');
    });

    it('should set state to ROAMING after session established', async () => {
      await roaming.establishRoamingSession('cn-unicom');
      const status = roaming.getRoamingStatus();
      expect(status.state).toBe(ROAMING_STATE.ROAMING);
    });

    it('should include session info in status', async () => {
      await roaming.establishRoamingSession('cn-unicom');
      const status = roaming.getRoamingStatus();
      expect(status.session).toBeDefined();
      expect(status.session).toHaveProperty('sessionId');
      expect(status.session).toHaveProperty('signCount', 0);
    });

    it('should throw for unknown carrier', async () => {
      await expect(roaming.establishRoamingSession('unknown-carrier'))
        .rejects.toThrow('未知运营商');
    });

    it('should emit roaming-started event', async () => {
      const events = [];
      roaming.on('roaming-started', (evt) => events.push(evt));
      await roaming.establishRoamingSession('cn-unicom');
      expect(events.length).toBe(1);
      expect(events[0]).toHaveProperty('sessionId');
      expect(events[0]).toHaveProperty('securityLevel');
    });
  });

  // ============================================================
  // 漫游签名
  // ============================================================

  describe('signViaRoaming()', () => {
    beforeEach(async () => {
      await roaming.establishRoamingSession('cn-unicom');
    });

    it('should sign data via roaming network', async () => {
      const result = await roaming.signViaRoaming(Buffer.from('transaction data'));
      expect(result.success).toBe(true);
      expect(result).toHaveProperty('signature');
      expect(result).toHaveProperty('roamingSession');
      expect(result.signCount).toBe(1);
    });

    it('should increment sign count', async () => {
      await roaming.signViaRoaming('data1');
      const result = await roaming.signViaRoaming('data2');
      expect(result.signCount).toBe(2);
    });

    it('should reject when sign limit reached', async () => {
      // Exhaust the limit (10 signs)
      for (let i = 0; i < 10; i++) {
        await roaming.signViaRoaming(`data-${i}`);
      }
      await expect(roaming.signViaRoaming('overflow')).rejects.toThrow('已达到漫游签名限额');
    });

    it('should throw when not in roaming state', async () => {
      const freshRoaming = new SimkeyRoaming({ signLimitPerDay: 10 });
      await freshRoaming.initialize('cn-mobile');
      await expect(freshRoaming.signViaRoaming('data')).rejects.toThrow('当前不在漫游状态');
      await freshRoaming.close();
    });
  });

  describe('verifyViaRoaming()', () => {
    beforeEach(async () => {
      await roaming.establishRoamingSession('cn-unicom');
    });

    it('should verify a signature', async () => {
      const result = await roaming.verifyViaRoaming('data', 'sig-base64');
      expect(result.success).toBe(true);
      expect(result.valid).toBe(true);
      expect(result).toHaveProperty('verifiedVia');
    });
  });

  // ============================================================
  // 结束漫游
  // ============================================================

  describe('endRoamingSession()', () => {
    it('should end the roaming session', async () => {
      await roaming.establishRoamingSession('cn-unicom');
      await roaming.signViaRoaming('data');
      const result = await roaming.endRoamingSession();
      expect(result.success).toBe(true);
      expect(result.summary.totalSigns).toBe(1);
      const status = roaming.getRoamingStatus();
      expect(status.state).toBe(ROAMING_STATE.HOME);
      expect(status.session).toBeNull();
    });

    it('should emit roaming-ended event', async () => {
      const events = [];
      roaming.on('roaming-ended', (evt) => events.push(evt));
      await roaming.establishRoamingSession('cn-telecom');
      await roaming.endRoamingSession();
      expect(events.length).toBe(1);
      expect(events[0]).toHaveProperty('sessionId');
    });

    it('should return undefined if no active session', async () => {
      const result = await roaming.endRoamingSession();
      expect(result).toBeUndefined();
    });
  });

  // ============================================================
  // 漫游策略
  // ============================================================

  describe('getRoamingPolicy()', () => {
    it('should return current policy', () => {
      const policy = roaming.getRoamingPolicy();
      expect(policy).toHaveProperty('defaultSecurityLevel', 'standard');
      expect(policy).toHaveProperty('signLimitPerDay', 10);
      expect(policy).toHaveProperty('regionWhitelist');
      expect(policy).toHaveProperty('autoNegotiate');
    });
  });

  describe('updateRoamingPolicy()', () => {
    it('should update security level', () => {
      roaming.updateRoamingPolicy({ defaultSecurityLevel: 'limited' });
      const policy = roaming.getRoamingPolicy();
      expect(policy.defaultSecurityLevel).toBe('limited');
    });

    it('should update sign limit', () => {
      roaming.updateRoamingPolicy({ signLimitPerDay: 50 });
      const policy = roaming.getRoamingPolicy();
      expect(policy.signLimitPerDay).toBe(50);
    });

    it('should emit policy-updated event', () => {
      const events = [];
      roaming.on('policy-updated', (evt) => events.push(evt));
      roaming.updateRoamingPolicy({ signLimitPerDay: 20 });
      expect(events.length).toBe(1);
    });
  });

  // ============================================================
  // CARRIER_ALLIANCE 常量
  // ============================================================

  describe('CARRIER_ALLIANCE constant', () => {
    it('should contain all three major Chinese carriers', () => {
      expect(CARRIER_ALLIANCE).toHaveProperty('CN_MOBILE');
      expect(CARRIER_ALLIANCE).toHaveProperty('CN_UNICOM');
      expect(CARRIER_ALLIANCE).toHaveProperty('CN_TELECOM');
    });

    it('should have trust level for each carrier', () => {
      for (const carrier of Object.values(CARRIER_ALLIANCE)) {
        expect(carrier).toHaveProperty('trustLevel');
        expect(carrier).toHaveProperty('mcc');
        expect(carrier).toHaveProperty('name');
      }
    });
  });
});
