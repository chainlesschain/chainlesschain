/**
 * Contract Engine 单元测试
 * 测试订阅和技能交换合约执行逻辑
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { SmartContractEngine, ContractType } = require('../../../src/main/trade/contract-engine');

// Mock 依赖
const createMockDatabase = () => ({
  db: {
    prepare: vi.fn(),
    exec: vi.fn(),
  },
});

const createMockDIDManager = () => ({
  getCurrentIdentity: vi.fn(() => ({ did: 'did:example:user123' })),
});

const createMockEscrowManager = () => ({
  releaseEscrow: vi.fn(),
  refundEscrow: vi.fn(),
});

describe('SmartContractEngine - executeContractLogic', () => {
  let contractEngine;
  let mockDatabase;
  let mockDIDManager;
  let mockEscrowManager;

  beforeEach(() => {
    mockDatabase = createMockDatabase();
    mockDIDManager = createMockDIDManager();
    mockEscrowManager = createMockEscrowManager();

    contractEngine = new SmartContractEngine(
      mockDatabase,
      mockDIDManager,
      null, // assetManager
      mockEscrowManager
    );

    vi.clearAllMocks();
  });

  describe('订阅合约执行（SUBSCRIPTION）', () => {
    it('应该释放订阅费用给服务提供者', async () => {
      const contract = {
        id: 'contract123',
        contract_type: ContractType.SUBSCRIPTION,
        escrow_id: 'escrow456',
        terms: JSON.stringify({
          providerDid: 'did:example:provider789',
          periodDays: 30,
          amount: '10',
        }),
        metadata: null,
      };

      // Mock prepare 方法返回
      const mockPrepare = vi.fn().mockReturnValue({
        run: vi.fn(),
      });
      mockDatabase.db.prepare.mockImplementation(mockPrepare);

      await contractEngine.executeContractLogic(contract);

      // 验证托管释放
      expect(mockEscrowManager.releaseEscrow).toHaveBeenCalledWith(
        'escrow456',
        'did:example:provider789'
      );

      // 验证元数据更新
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE contracts SET metadata')
      );
    });

    it('应该正确记录已支付周期数', async () => {
      const existingMetadata = {
        paidPeriods: 2,
        lastPaymentAt: Date.now() - 1000 * 60 * 60 * 24 * 30, // 30天前
      };

      const contract = {
        id: 'contract123',
        contract_type: ContractType.SUBSCRIPTION,
        escrow_id: 'escrow456',
        terms: JSON.stringify({
          providerDid: 'did:example:provider789',
          periodDays: 30,
        }),
        metadata: JSON.stringify(existingMetadata),
      };

      let savedMetadata = null;
      const mockPrepare = vi.fn().mockReturnValue({
        run: vi.fn((metadata, contractId) => {
          if (metadata && typeof metadata === 'string') {
            savedMetadata = JSON.parse(metadata);
          }
        }),
      });
      mockDatabase.db.prepare.mockImplementation(mockPrepare);

      await contractEngine.executeContractLogic(contract);

      // 验证周期数增加
      expect(savedMetadata).toBeTruthy();
      expect(savedMetadata.paidPeriods).toBe(3); // 从 2 增加到 3
    });

    it('应该计算下次付款时间', async () => {
      const contract = {
        id: 'contract123',
        contract_type: ContractType.SUBSCRIPTION,
        escrow_id: 'escrow456',
        terms: JSON.stringify({
          providerDid: 'did:example:provider789',
          periodDays: 30,
        }),
        metadata: null,
      };

      let savedMetadata = null;
      const mockPrepare = vi.fn().mockReturnValue({
        run: vi.fn((metadata, contractId) => {
          if (metadata && typeof metadata === 'string') {
            savedMetadata = JSON.parse(metadata);
          }
        }),
      });
      mockDatabase.db.prepare.mockImplementation(mockPrepare);

      const beforeExecution = Date.now();
      await contractEngine.executeContractLogic(contract);
      const afterExecution = Date.now();

      expect(savedMetadata).toBeTruthy();
      expect(savedMetadata.nextPaymentAt).toBeDefined();

      // 下次付款时间应该是现在 + 30天
      const expectedTime = beforeExecution + 30 * 24 * 60 * 60 * 1000;
      const tolerance = afterExecution - beforeExecution + 1000; // 允许一些误差
      expect(savedMetadata.nextPaymentAt).toBeGreaterThanOrEqual(expectedTime - tolerance);
      expect(savedMetadata.nextPaymentAt).toBeLessThanOrEqual(expectedTime + tolerance);
    });

    it('没有托管ID时不应该报错', async () => {
      const contract = {
        id: 'contract123',
        contract_type: ContractType.SUBSCRIPTION,
        escrow_id: null, // 没有托管
        terms: JSON.stringify({
          providerDid: 'did:example:provider789',
        }),
        metadata: null,
      };

      await expect(contractEngine.executeContractLogic(contract)).resolves.not.toThrow();
      expect(mockEscrowManager.releaseEscrow).not.toHaveBeenCalled();
    });
  });

  describe('技能交换合约执行（SKILL_EXCHANGE）', () => {
    it('应该标记当前用户完成状态', async () => {
      const currentUserDID = 'did:example:user123';
      const contract = {
        id: 'contract123',
        contract_type: ContractType.SKILL_EXCHANGE,
        parties: JSON.stringify([currentUserDID, 'did:example:user456']),
        escrow_id: null,
        terms: JSON.stringify({}),
        metadata: null,
      };

      let savedMetadata = null;
      const mockPrepare = vi.fn().mockReturnValue({
        run: vi.fn((metadata, contractId) => {
          if (metadata && typeof metadata === 'string') {
            savedMetadata = JSON.parse(metadata);
          }
        }),
      });
      mockDatabase.db.prepare.mockImplementation(mockPrepare);

      mockDIDManager.getCurrentIdentity.mockReturnValue({ did: currentUserDID });

      await contractEngine.executeContractLogic(contract);

      expect(savedMetadata).toBeTruthy();
      expect(savedMetadata.completionStatus).toBeDefined();
      expect(savedMetadata.completionStatus[currentUserDID]).toEqual({
        completed: true,
        completedAt: expect.any(Number),
      });
    });

    it('双方都完成时应该设置交换完成时间', async () => {
      const user1DID = 'did:example:user123';
      const user2DID = 'did:example:user456';

      // 第一方已经完成
      const existingMetadata = {
        completionStatus: {
          [user2DID]: {
            completed: true,
            completedAt: Date.now() - 1000,
          },
        },
      };

      const contract = {
        id: 'contract123',
        contract_type: ContractType.SKILL_EXCHANGE,
        parties: JSON.stringify([user1DID, user2DID]),
        escrow_id: null,
        terms: JSON.stringify({}),
        metadata: JSON.stringify(existingMetadata),
      };

      let savedMetadata = null;
      const mockPrepare = vi.fn().mockReturnValue({
        run: vi.fn((metadata, contractId) => {
          if (metadata && typeof metadata === 'string') {
            savedMetadata = JSON.parse(metadata);
          }
        }),
      });
      mockDatabase.db.prepare.mockImplementation(mockPrepare);

      mockDIDManager.getCurrentIdentity.mockReturnValue({ did: user1DID });

      await contractEngine.executeContractLogic(contract);

      // 验证双方都已完成
      expect(savedMetadata.completionStatus[user1DID].completed).toBe(true);
      expect(savedMetadata.completionStatus[user2DID].completed).toBe(true);

      // 验证交换完成时间
      expect(savedMetadata.exchangeCompletedAt).toBeDefined();
      expect(savedMetadata.exchangeCompletedAt).toBeGreaterThan(0);
    });

    it('只有一方完成时不应该设置交换完成时间', async () => {
      const user1DID = 'did:example:user123';
      const user2DID = 'did:example:user456';

      const contract = {
        id: 'contract123',
        contract_type: ContractType.SKILL_EXCHANGE,
        parties: JSON.stringify([user1DID, user2DID]),
        escrow_id: null,
        terms: JSON.stringify({}),
        metadata: null,
      };

      let savedMetadata = null;
      const mockPrepare = vi.fn().mockReturnValue({
        run: vi.fn((metadata, contractId) => {
          if (metadata && typeof metadata === 'string') {
            savedMetadata = JSON.parse(metadata);
          }
        }),
      });
      mockDatabase.db.prepare.mockImplementation(mockPrepare);

      mockDIDManager.getCurrentIdentity.mockReturnValue({ did: user1DID });

      await contractEngine.executeContractLogic(contract);

      // 只有 user1 完成
      expect(savedMetadata.completionStatus[user1DID].completed).toBe(true);
      expect(savedMetadata.completionStatus[user2DID]).toBeUndefined();

      // 不应该有交换完成时间
      expect(savedMetadata.exchangeCompletedAt).toBeUndefined();
    });

    it('双方都完成时应该退回或释放托管', async () => {
      const user1DID = 'did:example:user123';
      const user2DID = 'did:example:user456';

      const existingMetadata = {
        completionStatus: {
          [user2DID]: {
            completed: true,
            completedAt: Date.now() - 1000,
          },
        },
      };

      const contract = {
        id: 'contract123',
        contract_type: ContractType.SKILL_EXCHANGE,
        parties: JSON.stringify([user1DID, user2DID]),
        escrow_id: 'escrow789',
        terms: JSON.stringify({}),
        metadata: JSON.stringify(existingMetadata),
      };

      const mockPrepare = vi.fn().mockReturnValue({
        run: vi.fn(),
      });
      mockDatabase.db.prepare.mockImplementation(mockPrepare);

      mockDIDManager.getCurrentIdentity.mockReturnValue({ did: user1DID });

      await contractEngine.executeContractLogic(contract);

      // 验证托管退回
      expect(mockEscrowManager.refundEscrow).toHaveBeenCalledWith(
        'escrow789',
        '技能交换完成'
      );
    });

    it('单方完成时不应该操作托管', async () => {
      const contract = {
        id: 'contract123',
        contract_type: ContractType.SKILL_EXCHANGE,
        parties: JSON.stringify(['did:example:user123', 'did:example:user456']),
        escrow_id: 'escrow789',
        terms: JSON.stringify({}),
        metadata: null,
      };

      const mockPrepare = vi.fn().mockReturnValue({
        run: vi.fn(),
      });
      mockDatabase.db.prepare.mockImplementation(mockPrepare);

      await contractEngine.executeContractLogic(contract);

      // 只有一方完成，不应该操作托管
      expect(mockEscrowManager.refundEscrow).not.toHaveBeenCalled();
      expect(mockEscrowManager.releaseEscrow).not.toHaveBeenCalled();
    });

    it('没有当前用户DID时应该优雅处理', async () => {
      const contract = {
        id: 'contract123',
        contract_type: ContractType.SKILL_EXCHANGE,
        parties: JSON.stringify(['did:example:user123', 'did:example:user456']),
        escrow_id: null,
        terms: JSON.stringify({}),
        metadata: null,
      };

      mockDIDManager.getCurrentIdentity.mockReturnValue(null);

      const mockPrepare = vi.fn().mockReturnValue({
        run: vi.fn(),
      });
      mockDatabase.db.prepare.mockImplementation(mockPrepare);

      await expect(contractEngine.executeContractLogic(contract)).resolves.not.toThrow();
    });
  });

  describe('边界情况', () => {
    it('未知合约类型应该正常处理', async () => {
      const contract = {
        id: 'contract123',
        contract_type: 'unknown_type',
        terms: JSON.stringify({}),
        metadata: null,
      };

      await expect(contractEngine.executeContractLogic(contract)).resolves.not.toThrow();
    });

    it('元数据为null时应该初始化为空对象', async () => {
      const contract = {
        id: 'contract123',
        contract_type: ContractType.SUBSCRIPTION,
        escrow_id: 'escrow456',
        terms: JSON.stringify({
          providerDid: 'did:example:provider789',
        }),
        metadata: null,
      };

      let savedMetadata = null;
      const mockPrepare = vi.fn().mockReturnValue({
        run: vi.fn((metadata, contractId) => {
          if (metadata && typeof metadata === 'string') {
            savedMetadata = JSON.parse(metadata);
          }
        }),
      });
      mockDatabase.db.prepare.mockImplementation(mockPrepare);

      await contractEngine.executeContractLogic(contract);

      expect(savedMetadata).toBeTruthy();
      expect(savedMetadata.paidPeriods).toBe(1);
    });

    it('元数据为空字符串时应该初始化为空对象', async () => {
      const contract = {
        id: 'contract123',
        contract_type: ContractType.SKILL_EXCHANGE,
        parties: JSON.stringify(['did:example:user123']),
        escrow_id: null,
        terms: JSON.stringify({}),
        metadata: '',
      };

      const mockPrepare = vi.fn().mockReturnValue({
        run: vi.fn(),
      });
      mockDatabase.db.prepare.mockImplementation(mockPrepare);

      await expect(contractEngine.executeContractLogic(contract)).resolves.not.toThrow();
    });
  });
});
