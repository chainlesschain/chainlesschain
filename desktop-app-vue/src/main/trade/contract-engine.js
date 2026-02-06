/**
 * 智能合约引擎
 *
 * 负责智能合约的管理和执行，包括：
 * - 创建和管理合约
 * - 多种托管类型（简单、多重签名、时间锁、条件）
 * - 自动条件检查和执行
 * - 仲裁机制
 * - 合约模板系统
 */

const { logger, createLogger } = require('../utils/logger.js');
const EventEmitter = require('events');
const { v4: uuidv4 } = require('uuid');

/**
 * 合约类型
 */
const ContractType = {
  SIMPLE_TRADE: 'simple_trade',       // 简单买卖合约
  SUBSCRIPTION: 'subscription',        // 订阅付费合约
  BOUNTY: 'bounty',                   // 任务悬赏合约
  SKILL_EXCHANGE: 'skill_exchange',   // 技能交换合约
  CUSTOM: 'custom',                   // 自定义合约
};

/**
 * 托管类型
 */
const EscrowType = {
  SIMPLE: 'simple',           // 简单托管
  MULTISIG: 'multisig',       // 多重签名托管
  TIMELOCK: 'timelock',       // 时间锁托管
  CONDITIONAL: 'conditional', // 条件托管
};

/**
 * 合约状态
 */
const ContractStatus = {
  DRAFT: 'draft',             // 草稿
  ACTIVE: 'active',           // 激活
  EXECUTING: 'executing',     // 执行中
  COMPLETED: 'completed',     // 已完成
  CANCELLED: 'cancelled',     // 已取消
  DISPUTED: 'disputed',       // 有争议
  ARBITRATED: 'arbitrated',   // 已仲裁
};

/**
 * 条件类型
 */
const ConditionType = {
  PAYMENT_RECEIVED: 'payment_received',       // 收到付款
  DELIVERY_CONFIRMED: 'delivery_confirmed',   // 确认交付
  TIME_ELAPSED: 'time_elapsed',               // 时间到期
  APPROVAL_COUNT: 'approval_count',           // 批准数量
  CUSTOM_LOGIC: 'custom_logic',               // 自定义逻辑
};

/**
 * 智能合约引擎类
 */
class SmartContractEngine extends EventEmitter {
  constructor(database, didManager, assetManager, escrowManager, blockchainAdapter = null) {
    super();

    this.database = database;
    this.didManager = didManager;
    this.assetManager = assetManager;
    this.escrowManager = escrowManager;
    this.blockchainAdapter = blockchainAdapter;

    this.initialized = false;
    this.checkTimer = null; // 条件检查定时器
  }

  /**
   * 初始化合约引擎
   */
  async initialize() {
    logger.info('[ContractEngine] 初始化智能合约引擎...');

    try {
      // 初始化数据库表
      await this.initializeTables();

      // 启动自动检查定时器（每分钟检查一次）
      this.startAutoCheck(60000);

      this.initialized = true;
      logger.info('[ContractEngine] 智能合约引擎初始化成功');
    } catch (error) {
      logger.error('[ContractEngine] 初始化失败:', error);
      throw error;
    }
  }

  /**
   * 初始化数据库表
   */
  async initializeTables() {
    const db = this.database.db;

    // 合约表
    db.exec(`
      CREATE TABLE IF NOT EXISTS contracts (
        id TEXT PRIMARY KEY,
        contract_type TEXT NOT NULL,
        escrow_type TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        creator_did TEXT NOT NULL,
        parties TEXT NOT NULL,
        terms TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        escrow_id TEXT,
        transaction_id TEXT,
        created_at INTEGER NOT NULL,
        activated_at INTEGER,
        completed_at INTEGER,
        expires_at INTEGER,
        metadata TEXT
      )
    `);

    // 合约条件表
    db.exec(`
      CREATE TABLE IF NOT EXISTS contract_conditions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        contract_id TEXT NOT NULL,
        condition_type TEXT NOT NULL,
        condition_data TEXT NOT NULL,
        is_required BOOLEAN DEFAULT 1,
        is_met BOOLEAN DEFAULT 0,
        met_at INTEGER,
        created_at INTEGER NOT NULL
      )
    `);

    // 合约事件表（记录合约的所有操作）
    db.exec(`
      CREATE TABLE IF NOT EXISTS contract_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        contract_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        event_data TEXT,
        actor_did TEXT,
        created_at INTEGER NOT NULL
      )
    `);

    // 合约签名表（多重签名）
    db.exec(`
      CREATE TABLE IF NOT EXISTS contract_signatures (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        contract_id TEXT NOT NULL,
        signer_did TEXT NOT NULL,
        signature TEXT,
        signed_at INTEGER,
        created_at INTEGER NOT NULL
      )
    `);

    // 仲裁表
    db.exec(`
      CREATE TABLE IF NOT EXISTS arbitrations (
        id TEXT PRIMARY KEY,
        contract_id TEXT NOT NULL,
        initiator_did TEXT NOT NULL,
        reason TEXT NOT NULL,
        evidence TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        resolution TEXT,
        arbitrator_did TEXT,
        created_at INTEGER NOT NULL,
        resolved_at INTEGER
      )
    `);

    // 区块链合约部署记录表
    db.exec(`
      CREATE TABLE IF NOT EXISTS deployed_contracts (
        id TEXT PRIMARY KEY,
        local_contract_id TEXT NOT NULL,
        contract_name TEXT NOT NULL,
        contract_type TEXT,
        contract_address TEXT NOT NULL,
        chain_id INTEGER NOT NULL,
        deployment_tx TEXT,
        deployer_address TEXT,
        abi_json TEXT,
        deployed_at INTEGER NOT NULL,
        UNIQUE(contract_address, chain_id),
        FOREIGN KEY (local_contract_id) REFERENCES contracts(id)
      )
    `);

    // 创建索引
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_contracts_creator ON contracts(creator_did);
      CREATE INDEX IF NOT EXISTS idx_contracts_status ON contracts(status);
      CREATE INDEX IF NOT EXISTS idx_contracts_type ON contracts(contract_type);
      CREATE INDEX IF NOT EXISTS idx_contract_conditions_contract ON contract_conditions(contract_id);
      CREATE INDEX IF NOT EXISTS idx_contract_events_contract ON contract_events(contract_id);
      CREATE INDEX IF NOT EXISTS idx_contract_signatures_contract ON contract_signatures(contract_id);
      CREATE INDEX IF NOT EXISTS idx_arbitrations_contract ON arbitrations(contract_id);
      CREATE INDEX IF NOT EXISTS idx_deployed_contracts_local ON deployed_contracts(local_contract_id);
      CREATE INDEX IF NOT EXISTS idx_deployed_contracts_address ON deployed_contracts(contract_address, chain_id);
    `);

    logger.info('[ContractEngine] 数据库表初始化完成');
  }

  /**
   * 创建合约
   * @param {Object} options - 合约选项
   */
  async createContract({
    contractType,
    escrowType,
    title,
    description,
    parties,
    terms,
    conditions = [],
    expiresIn = null,
    metadata = {},
    onChain = false,
    chainId = null,
    walletId = null,
    password = null,
  }) {
    try {
      const currentDid = this.didManager?.getCurrentIdentity()?.did;

      if (!currentDid) {
        throw new Error('未登录，无法创建合约');
      }

      if (!Object.values(ContractType).includes(contractType)) {
        throw new Error('无效的合约类型');
      }

      if (!Object.values(EscrowType).includes(escrowType)) {
        throw new Error('无效的托管类型');
      }

      if (!title || title.trim().length === 0) {
        throw new Error('合约标题不能为空');
      }

      if (!parties || parties.length < 2) {
        throw new Error('合约至少需要两方参与');
      }

      // 验证所有参与方
      if (!parties.includes(currentDid)) {
        parties.push(currentDid);
      }

      const contractId = uuidv4();
      const now = Date.now();
      const expiresAt = expiresIn ? now + expiresIn : null;

      const db = this.database.db;

      // 插入合约记录
      db.prepare(`
        INSERT INTO contracts
        (id, contract_type, escrow_type, title, description, creator_did, parties, terms, status, created_at, expires_at, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        contractId,
        contractType,
        escrowType,
        title.trim(),
        description || null,
        currentDid,
        JSON.stringify(parties),
        JSON.stringify(terms),
        ContractStatus.DRAFT,
        now,
        expiresAt,
        JSON.stringify(metadata)
      );

      // 插入条件
      for (const condition of conditions) {
        db.prepare(`
          INSERT INTO contract_conditions
          (contract_id, condition_type, condition_data, is_required, created_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(
          contractId,
          condition.type,
          JSON.stringify(condition.data),
          condition.required !== false ? 1 : 0,
          now
        );
      }

      // 记录事件
      this.recordEvent(contractId, 'created', { creator: currentDid }, currentDid);

      const contract = {
        id: contractId,
        contract_type: contractType,
        escrow_type: escrowType,
        title: title.trim(),
        description,
        creator_did: currentDid,
        parties,
        terms,
        status: ContractStatus.DRAFT,
        created_at: now,
        expires_at: expiresAt,
        metadata,
      };

      logger.info('[ContractEngine] 已创建合约:', contractId);

      // 如果需要部署到区块链
      if (onChain && this.blockchainAdapter) {
        try {
          await this._deployContractToBlockchain(contractId, {
            contractType,
            title,
            terms,
            chainId,
            walletId,
            password
          });

          logger.info('[ContractEngine] 合约已成功部署到区块链');
          this.emit('contract:deployed', { contract });
        } catch (error) {
          logger.error('[ContractEngine] 区块链部署失败:', error);
          // 部署失败不影响本地合约创建，只记录错误
          this.emit('contract:deployment-failed', { contractId, error: error.message });
        }
      }

      this.emit('contract:created', { contract });

      return contract;
    } catch (error) {
      logger.error('[ContractEngine] 创建合约失败:', error);
      throw error;
    }
  }

  /**
   * 激活合约
   * @param {string} contractId - 合约 ID
   */
  async activateContract(contractId) {
    try {
      const currentDid = this.didManager?.getCurrentIdentity()?.did;

      if (!currentDid) {
        throw new Error('未登录');
      }

      const db = this.database.db;

      // 查询合约
      const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(contractId);

      if (!contract) {
        throw new Error('合约不存在');
      }

      if (contract.status !== ContractStatus.DRAFT) {
        throw new Error('只能激活草稿状态的合约');
      }

      const parties = JSON.parse(contract.parties);
      if (!parties.includes(currentDid)) {
        throw new Error('只有合约参与方才能激活合约');
      }

      // 检查多重签名要求
      if (contract.escrow_type === EscrowType.MULTISIG) {
        const signatures = db.prepare(
          'SELECT COUNT(*) as count FROM contract_signatures WHERE contract_id = ? AND signed_at IS NOT NULL'
        ).get(contractId);

        const requiredSignatures = parties.length;
        if (signatures.count < requiredSignatures) {
          throw new Error(`需要 ${requiredSignatures} 个签名才能激活合约`);
        }
      }

      const now = Date.now();

      // 更新合约状态
      db.prepare('UPDATE contracts SET status = ?, activated_at = ? WHERE id = ?')
        .run(ContractStatus.ACTIVE, now, contractId);

      // 如果合约有关联的交易，创建托管
      if (contract.transaction_id) {
        const terms = JSON.parse(contract.terms);
        if (terms.escrowAmount && terms.escrowAssetId) {
          const escrow = await this.escrowManager.createEscrow({
            transactionId: contract.transaction_id,
            buyerDid: terms.buyerDid,
            sellerDid: terms.sellerDid,
            assetId: terms.escrowAssetId,
            amount: terms.escrowAmount,
            metadata: {
              contractId,
              escrowType: contract.escrow_type,
            },
          });

          // 更新合约的托管 ID
          db.prepare('UPDATE contracts SET escrow_id = ? WHERE id = ?')
            .run(escrow.id, contractId);
        }
      }

      // 记录事件
      this.recordEvent(contractId, 'activated', {}, currentDid);

      logger.info('[ContractEngine] 合约已激活:', contractId);

      this.emit('contract:activated', { contractId });

      return { success: true };
    } catch (error) {
      logger.error('[ContractEngine] 激活合约失败:', error);
      throw error;
    }
  }

  /**
   * 签名合约（多重签名）
   * @param {string} contractId - 合约 ID
   * @param {string} signature - 签名
   */
  async signContract(contractId, signature) {
    try {
      const currentDid = this.didManager?.getCurrentIdentity()?.did;

      if (!currentDid) {
        throw new Error('未登录');
      }

      const db = this.database.db;

      // 查询合约
      const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(contractId);

      if (!contract) {
        throw new Error('合约不存在');
      }

      const parties = JSON.parse(contract.parties);
      if (!parties.includes(currentDid)) {
        throw new Error('只有合约参与方才能签名');
      }

      // 检查是否已签名
      const existingSignature = db.prepare(
        'SELECT * FROM contract_signatures WHERE contract_id = ? AND signer_did = ?'
      ).get(contractId, currentDid);

      const now = Date.now();

      if (existingSignature) {
        // 更新签名
        db.prepare('UPDATE contract_signatures SET signature = ?, signed_at = ? WHERE id = ?')
          .run(signature, now, existingSignature.id);
      } else {
        // 插入新签名
        db.prepare(`
          INSERT INTO contract_signatures
          (contract_id, signer_did, signature, signed_at, created_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(contractId, currentDid, signature, now, now);
      }

      // 记录事件
      this.recordEvent(contractId, 'signed', { signer: currentDid }, currentDid);

      logger.info('[ContractEngine] 合约已签名:', contractId);

      this.emit('contract:signed', { contractId, signer: currentDid });

      return { success: true };
    } catch (error) {
      logger.error('[ContractEngine] 签名合约失败:', error);
      throw error;
    }
  }

  /**
   * 检查合约条件
   * @param {string} contractId - 合约 ID
   */
  async checkConditions(contractId) {
    try {
      const db = this.database.db;

      // 查询合约
      const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(contractId);

      if (!contract) {
        return { allMet: false, conditions: [] };
      }

      // 查询所有条件
      const conditions = db.prepare(
        'SELECT * FROM contract_conditions WHERE contract_id = ?'
      ).all(contractId);

      const results = [];
      let allMet = true;

      for (const condition of conditions) {
        const conditionData = JSON.parse(condition.condition_data);
        const isMet = await this.evaluateCondition(
          contractId,
          condition.condition_type,
          conditionData
        );

        results.push({
          id: condition.id,
          type: condition.condition_type,
          data: conditionData,
          required: Boolean(condition.is_required),
          met: isMet,
        });

        // 如果条件已满足但数据库中未标记，更新数据库
        if (isMet && !condition.is_met) {
          const now = Date.now();
          db.prepare('UPDATE contract_conditions SET is_met = 1, met_at = ? WHERE id = ?')
            .run(now, condition.id);

          // 记录事件
          this.recordEvent(contractId, 'condition_met', {
            conditionId: condition.id,
            type: condition.condition_type,
          });
        }

        if (condition.is_required && !isMet) {
          allMet = false;
        }
      }

      return { allMet, conditions: results };
    } catch (error) {
      logger.error('[ContractEngine] 检查条件失败:', error);
      throw error;
    }
  }

  /**
   * 评估单个条件
   * @param {string} contractId - 合约 ID
   * @param {string} conditionType - 条件类型
   * @param {Object} conditionData - 条件数据
   */
  async evaluateCondition(contractId, conditionType, conditionData) {
    const db = this.database.db;
    const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(contractId);

    if (!contract) {
      return false;
    }

    switch (conditionType) {
      case ConditionType.PAYMENT_RECEIVED:
        // 检查是否收到付款（托管已锁定）
        if (contract.escrow_id) {
          const escrow = await this.escrowManager.getEscrow(contract.escrow_id);
          return escrow && escrow.status === 'locked';
        }
        return false;

      case ConditionType.DELIVERY_CONFIRMED: {
        // 检查是否确认交付
        const deliveryEvent = db.prepare(
          'SELECT * FROM contract_events WHERE contract_id = ? AND event_type = ? LIMIT 1'
        ).get(contractId, 'delivery_confirmed');
        return !!deliveryEvent;
      }

      case ConditionType.TIME_ELAPSED: {
        // 检查时间是否到期
        const targetTime = conditionData.timestamp;
        return Date.now() >= targetTime;
      }

      case ConditionType.APPROVAL_COUNT: {
        // 检查批准数量
        const approvalCount = db.prepare(
          'SELECT COUNT(*) as count FROM contract_events WHERE contract_id = ? AND event_type = ?'
        ).get(contractId, 'approved');
        return approvalCount.count >= conditionData.requiredCount;
      }

      case ConditionType.CUSTOM_LOGIC:
        // 自定义逻辑（待扩展）
        return false;

      default:
        return false;
    }
  }

  /**
   * 执行合约
   * @param {string} contractId - 合约 ID
   */
  async executeContract(contractId) {
    try {
      const currentDid = this.didManager?.getCurrentIdentity()?.did;

      if (!currentDid) {
        throw new Error('未登录');
      }

      const db = this.database.db;

      // 查询合约
      const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(contractId);

      if (!contract) {
        throw new Error('合约不存在');
      }

      if (contract.status !== ContractStatus.ACTIVE) {
        throw new Error('只能执行激活状态的合约');
      }

      // 检查条件
      const { allMet } = await this.checkConditions(contractId);

      if (!allMet) {
        throw new Error('合约条件未全部满足');
      }

      const now = Date.now();

      // 更新合约状态
      db.prepare('UPDATE contracts SET status = ? WHERE id = ?')
        .run(ContractStatus.EXECUTING, contractId);

      // 执行合约逻辑（根据合约类型）
      await this.executeContractLogic(contract);

      // 完成合约
      db.prepare('UPDATE contracts SET status = ?, completed_at = ? WHERE id = ?')
        .run(ContractStatus.COMPLETED, now, contractId);

      // 记录事件
      this.recordEvent(contractId, 'executed', {}, currentDid);
      this.recordEvent(contractId, 'completed', {}, currentDid);

      logger.info('[ContractEngine] 合约已执行:', contractId);

      this.emit('contract:executed', { contractId });
      this.emit('contract:completed', { contractId });

      return { success: true };
    } catch (error) {
      logger.error('[ContractEngine] 执行合约失败:', error);
      throw error;
    }
  }

  /**
   * 执行合约具体逻辑
   * @param {Object} contract - 合约对象
   */
  async executeContractLogic(contract) {
    const terms = JSON.parse(contract.terms);

    switch (contract.contract_type) {
      case ContractType.SIMPLE_TRADE:
        // 简单买卖：释放托管资金给卖家
        if (contract.escrow_id && terms.sellerDid) {
          await this.escrowManager.releaseEscrow(contract.escrow_id, terms.sellerDid);
        }
        break;

      case ContractType.SUBSCRIPTION:
        // 订阅：处理订阅周期付费
        if (contract.escrow_id && terms.providerDid) {
          // 释放当前周期的订阅费用给服务提供者
          await this.escrowManager.releaseEscrow(contract.escrow_id, terms.providerDid);

          // 记录订阅支付事件
          const db = this.database.db;
          const now = Date.now();
          const metadata = contract.metadata ? JSON.parse(contract.metadata) : {};

          // 更新订阅元数据（记录已支付周期数）
          metadata.paidPeriods = (metadata.paidPeriods || 0) + 1;
          metadata.lastPaymentAt = now;

          // 如果有周期信息，计算下次付款时间
          if (terms.periodDays) {
            metadata.nextPaymentAt = now + (terms.periodDays * 24 * 60 * 60 * 1000);
          }

          db.prepare('UPDATE contracts SET metadata = ? WHERE id = ?')
            .run(JSON.stringify(metadata), contract.id);

          logger.info(`[ContractEngine] 订阅合约已支付第 ${metadata.paidPeriods} 期`);
        }
        break;

      case ContractType.BOUNTY:
        // 悬赏：释放赏金给完成者
        if (contract.escrow_id && terms.completorDid) {
          await this.escrowManager.releaseEscrow(contract.escrow_id, terms.completorDid);
        }
        break;

      case ContractType.SKILL_EXCHANGE: {
        // 技能交换：标记双方完成状态
        const db = this.database.db;
        const metadata = contract.metadata ? JSON.parse(contract.metadata) : {};

        // 初始化双方完成状态
        if (!metadata.completionStatus) {
          metadata.completionStatus = {};
        }

        // 获取当前执行者的DID
        const currentDid = this.didManager?.getCurrentIdentity()?.did;

        // 标记当前用户已完成自己的部分
        if (currentDid) {
          metadata.completionStatus[currentDid] = {
            completed: true,
            completedAt: Date.now()
          };

          logger.info(`[ContractEngine] 技能交换: ${currentDid} 已完成`);
        }

        // 检查是否双方都已完成
        const parties = JSON.parse(contract.parties);
        const allCompleted = parties.every(partyDid =>
          metadata.completionStatus[partyDid]?.completed
        );

        if (allCompleted) {
          metadata.exchangeCompletedAt = Date.now();
          logger.info('[ContractEngine] 技能交换: 双方均已完成');
        }

        // 更新元数据
        db.prepare('UPDATE contracts SET metadata = ? WHERE id = ?')
          .run(JSON.stringify(metadata), contract.id);

        // 如果有托管费用（象征性），释放给双方
        if (contract.escrow_id && allCompleted) {
          // 技能交换通常不涉及金钱交易，如果有托管，可以退回或平分
          await this.escrowManager.refundEscrow(contract.escrow_id, '技能交换完成');
        }
        break;
      }

      default:
        break;
    }
  }

  /**
   * 取消合约
   * @param {string} contractId - 合约 ID
   * @param {string} reason - 取消原因
   */
  async cancelContract(contractId, reason) {
    try {
      const currentDid = this.didManager?.getCurrentIdentity()?.did;

      if (!currentDid) {
        throw new Error('未登录');
      }

      const db = this.database.db;

      // 查询合约
      const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(contractId);

      if (!contract) {
        throw new Error('合约不存在');
      }

      const parties = JSON.parse(contract.parties);
      if (!parties.includes(currentDid)) {
        throw new Error('只有合约参与方才能取消合约');
      }

      if (![ContractStatus.DRAFT, ContractStatus.ACTIVE].includes(contract.status)) {
        throw new Error('只能取消草稿或激活状态的合约');
      }

      // 如果有托管，退款
      if (contract.escrow_id) {
        await this.escrowManager.refundEscrow(contract.escrow_id, reason);
      }

      // 更新合约状态
      db.prepare('UPDATE contracts SET status = ? WHERE id = ?')
        .run(ContractStatus.CANCELLED, contractId);

      // 记录事件
      this.recordEvent(contractId, 'cancelled', { reason }, currentDid);

      logger.info('[ContractEngine] 合约已取消:', contractId);

      this.emit('contract:cancelled', { contractId, reason });

      return { success: true };
    } catch (error) {
      logger.error('[ContractEngine] 取消合约失败:', error);
      throw error;
    }
  }

  /**
   * 发起仲裁
   * @param {string} contractId - 合约 ID
   * @param {string} reason - 仲裁原因
   * @param {string} evidence - 证据
   */
  async initiateArbitration(contractId, reason, evidence = null) {
    try {
      const currentDid = this.didManager?.getCurrentIdentity()?.did;

      if (!currentDid) {
        throw new Error('未登录');
      }

      const db = this.database.db;

      // 查询合约
      const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(contractId);

      if (!contract) {
        throw new Error('合约不存在');
      }

      const parties = JSON.parse(contract.parties);
      if (!parties.includes(currentDid)) {
        throw new Error('只有合约参与方才能发起仲裁');
      }

      const arbitrationId = uuidv4();
      const now = Date.now();

      // 插入仲裁记录
      db.prepare(`
        INSERT INTO arbitrations
        (id, contract_id, initiator_did, reason, evidence, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        arbitrationId,
        contractId,
        currentDid,
        reason,
        evidence || null,
        'pending',
        now
      );

      // 更新合约状态
      db.prepare('UPDATE contracts SET status = ? WHERE id = ?')
        .run(ContractStatus.DISPUTED, contractId);

      // 如果有托管，标记为争议
      if (contract.escrow_id) {
        await this.escrowManager.disputeEscrow(contract.escrow_id, reason);
      }

      // 记录事件
      this.recordEvent(contractId, 'arbitration_initiated', {
        arbitrationId,
        reason,
      }, currentDid);

      logger.info('[ContractEngine] 已发起仲裁:', arbitrationId);

      this.emit('arbitration:initiated', { contractId, arbitrationId });

      return { arbitrationId };
    } catch (error) {
      logger.error('[ContractEngine] 发起仲裁失败:', error);
      throw error;
    }
  }

  /**
   * 解决仲裁
   * @param {string} arbitrationId - 仲裁 ID
   * @param {string} resolution - 解决方案
   */
  async resolveArbitration(arbitrationId, resolution) {
    try {
      const currentDid = this.didManager?.getCurrentIdentity()?.did;

      if (!currentDid) {
        throw new Error('未登录');
      }

      const db = this.database.db;

      // 查询仲裁
      const arbitration = db.prepare('SELECT * FROM arbitrations WHERE id = ?').get(arbitrationId);

      if (!arbitration) {
        throw new Error('仲裁不存在');
      }

      if (arbitration.status !== 'pending') {
        throw new Error('仲裁已处理');
      }

      const now = Date.now();

      // 更新仲裁记录
      db.prepare('UPDATE arbitrations SET status = ?, resolution = ?, arbitrator_did = ?, resolved_at = ? WHERE id = ?')
        .run('resolved', resolution, currentDid, now, arbitrationId);

      // 更新合约状态
      db.prepare('UPDATE contracts SET status = ? WHERE id = ?')
        .run(ContractStatus.ARBITRATED, arbitration.contract_id);

      // 根据解决方案执行相应操作
      const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(arbitration.contract_id);
      if (contract && contract.escrow_id) {
        const resolutionData = JSON.parse(resolution);
        if (resolutionData.action === 'release') {
          await this.escrowManager.releaseEscrow(contract.escrow_id, resolutionData.toDid);
        } else if (resolutionData.action === 'refund') {
          await this.escrowManager.refundEscrow(contract.escrow_id, resolutionData.reason);
        }
      }

      // 记录事件
      this.recordEvent(arbitration.contract_id, 'arbitration_resolved', {
        arbitrationId,
        resolution,
      }, currentDid);

      logger.info('[ContractEngine] 仲裁已解决:', arbitrationId);

      this.emit('arbitration:resolved', { arbitrationId, resolution });

      return { success: true };
    } catch (error) {
      logger.error('[ContractEngine] 解决仲裁失败:', error);
      throw error;
    }
  }

  /**
   * 获取合约详情
   * @param {string} contractId - 合约 ID
   */
  async getContract(contractId) {
    try {
      const db = this.database.db;
      const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(contractId);

      if (!contract) {
        return null;
      }

      return {
        ...contract,
        parties: JSON.parse(contract.parties),
        terms: JSON.parse(contract.terms),
        metadata: contract.metadata ? JSON.parse(contract.metadata) : {},
      };
    } catch (error) {
      logger.error('[ContractEngine] 获取合约详情失败:', error);
      throw error;
    }
  }

  /**
   * 获取合约列表
   * @param {Object} filters - 筛选条件
   */
  async getContracts(filters = {}) {
    try {
      const db = this.database.db;

      let query = 'SELECT * FROM contracts WHERE 1=1';
      const params = [];

      if (filters.contractType) {
        query += ' AND contract_type = ?';
        params.push(filters.contractType);
      }

      if (filters.status) {
        query += ' AND status = ?';
        params.push(filters.status);
      }

      if (filters.creatorDid) {
        query += ' AND creator_did = ?';
        params.push(filters.creatorDid);
      }

      if (filters.partyDid) {
        query += ' AND parties LIKE ?';
        params.push(`%${filters.partyDid}%`);
      }

      query += ' ORDER BY created_at DESC';

      if (filters.limit) {
        query += ' LIMIT ?';
        params.push(filters.limit);
      }

      const contracts = db.prepare(query).all(...params);

      return contracts.map(c => ({
        ...c,
        parties: JSON.parse(c.parties),
        terms: JSON.parse(c.terms),
        metadata: c.metadata ? JSON.parse(c.metadata) : {},
      }));
    } catch (error) {
      logger.error('[ContractEngine] 获取合约列表失败:', error);
      throw error;
    }
  }

  /**
   * 获取合约条件
   * @param {string} contractId - 合约 ID
   */
  async getContractConditions(contractId) {
    try {
      const db = this.database.db;

      const conditions = db.prepare(
        'SELECT * FROM contract_conditions WHERE contract_id = ? ORDER BY created_at ASC'
      ).all(contractId);

      return conditions.map(c => ({
        ...c,
        condition_data: JSON.parse(c.condition_data),
        is_required: Boolean(c.is_required),
        is_met: Boolean(c.is_met),
      }));
    } catch (error) {
      logger.error('[ContractEngine] 获取合约条件失败:', error);
      throw error;
    }
  }

  /**
   * 获取合约事件
   * @param {string} contractId - 合约 ID
   */
  async getContractEvents(contractId) {
    try {
      const db = this.database.db;

      const events = db.prepare(
        'SELECT * FROM contract_events WHERE contract_id = ? ORDER BY created_at DESC'
      ).all(contractId);

      return events.map(e => ({
        ...e,
        event_data: e.event_data ? JSON.parse(e.event_data) : null,
      }));
    } catch (error) {
      logger.error('[ContractEngine] 获取合约事件失败:', error);
      throw error;
    }
  }

  /**
   * 记录合约事件
   * @param {string} contractId - 合约 ID
   * @param {string} eventType - 事件类型
   * @param {Object} eventData - 事件数据
   * @param {string} actorDid - 操作者 DID
   */
  recordEvent(contractId, eventType, eventData = null, actorDid = null) {
    try {
      const db = this.database.db;
      const now = Date.now();

      db.prepare(`
        INSERT INTO contract_events
        (contract_id, event_type, event_data, actor_did, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        contractId,
        eventType,
        eventData ? JSON.stringify(eventData) : null,
        actorDid,
        now
      );
    } catch (error) {
      logger.error('[ContractEngine] 记录事件失败:', error);
      // 不抛出错误，避免影响主流程
    }
  }

  /**
   * 启动自动检查
   * @param {number} interval - 检查间隔（毫秒）
   */
  startAutoCheck(interval = 60000) {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
    }

    this.checkTimer = setInterval(async () => {
      try {
        await this.autoCheckAndExecute();
      } catch (error) {
        logger.error('[ContractEngine] 自动检查失败:', error);
      }
    }, interval);

    logger.info('[ContractEngine] 自动检查已启动，间隔:', interval, 'ms');
  }

  /**
   * 自动检查并执行合约
   */
  async autoCheckAndExecute() {
    try {
      const db = this.database.db;

      // 查询所有激活状态的合约
      const activeContracts = db.prepare(
        'SELECT id FROM contracts WHERE status = ?'
      ).all(ContractStatus.ACTIVE);

      for (const contract of activeContracts) {
        // 检查条件
        const { allMet } = await this.checkConditions(contract.id);

        // 如果所有条件满足，尝试执行
        if (allMet) {
          logger.info('[ContractEngine] 合约条件已满足，自动执行:', contract.id);
          try {
            await this.executeContract(contract.id);
          } catch (error) {
            logger.error('[ContractEngine] 自动执行合约失败:', contract.id, error);
          }
        }
      }

      // 检查时间锁合约
      const now = Date.now();
      const expiredContracts = db.prepare(
        'SELECT id FROM contracts WHERE status = ? AND expires_at IS NOT NULL AND expires_at <= ?'
      ).all([ContractStatus.ACTIVE, now]);

      for (const contract of expiredContracts) {
        logger.info('[ContractEngine] 合约已过期，自动处理:', contract.id);
        try {
          // 时间锁到期，执行退款
          await this.cancelContract(contract.id, '合约已过期');
        } catch (error) {
          logger.error('[ContractEngine] 处理过期合约失败:', contract.id, error);
        }
      }
    } catch (error) {
      logger.error('[ContractEngine] 自动检查执行失败:', error);
    }
  }

  /**
   * 停止自动检查
   */
  stopAutoCheck() {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
      logger.info('[ContractEngine] 自动检查已停止');
    }
  }

  /**
   * 部署合约到区块链（私有方法）
   * @param {string} contractId - 合约 ID
   * @param {Object} options - 部署选项
   */
  async _deployContractToBlockchain(contractId, options) {
    const { contractType, title, terms, chainId, walletId, password } = options;

    if (!this.blockchainAdapter) {
      throw new Error('区块链适配器未初始化');
    }

    if (!chainId || !walletId || !password) {
      throw new Error('缺少必要参数: chainId, walletId, password');
    }

    // 切换到目标链
    await this.blockchainAdapter.switchChain(chainId);

    let contractAddress, deploymentTx, contractName, abiJson;

    // 根据合约类型部署不同的智能合约
    switch (contractType) {
      case ContractType.SIMPLE_TRADE: {
        // 部署托管合约 (EscrowContract)
        logger.info('[ContractEngine] 部署托管合约 (EscrowContract)');
        const escrowResult = await this.blockchainAdapter.deployEscrowContract(walletId, password);
        contractAddress = escrowResult.address;
        deploymentTx = escrowResult.txHash;
        contractName = `Escrow: ${title}`;
        abiJson = JSON.stringify(escrowResult.abi);
        break;
      }

      case ContractType.SUBSCRIPTION: {
        // 部署订阅合约 (SubscriptionContract)
        logger.info('[ContractEngine] 部署订阅合约 (SubscriptionContract)');
        const subResult = await this.blockchainAdapter.deploySubscriptionContract(walletId, password);
        contractAddress = subResult.address;
        deploymentTx = subResult.txHash;
        contractName = `Subscription: ${title}`;
        abiJson = JSON.stringify(subResult.abi);
        break;
      }

      case ContractType.BOUNTY: {
        // 部署悬赏合约 (BountyContract)
        logger.info('[ContractEngine] 部署悬赏合约 (BountyContract)');
        const bountyResult = await this.blockchainAdapter.deployBountyContract(walletId, password);
        contractAddress = bountyResult.address;
        deploymentTx = bountyResult.txHash;
        contractName = `Bounty: ${title}`;
        abiJson = JSON.stringify(bountyResult.abi);
        break;
      }

      case ContractType.SKILL_EXCHANGE:
      case ContractType.CUSTOM: {
        // 技能交换和自定义合约使用通用托管合约
        logger.info('[ContractEngine] 部署通用托管合约');
        const genericResult = await this.blockchainAdapter.deployEscrowContract(walletId, password);
        contractAddress = genericResult.address;
        deploymentTx = genericResult.txHash;
        contractName = `${contractType}: ${title}`;
        abiJson = JSON.stringify(genericResult.abi);
        break;
      }

      default:
        throw new Error(`不支持的合约类型: ${contractType}`);
    }

    logger.info(`[ContractEngine] 合约已部署到区块链: ${contractAddress}`);

    // 保存部署记录
    await this._saveDeployedContract({
      localContractId: contractId,
      contractName,
      contractType,
      contractAddress,
      chainId,
      deploymentTx,
      abiJson
    });

    return { contractAddress, deploymentTx };
  }

  /**
   * 保存合约部署记录（私有方法）
   * @param {Object} options - 部署信息
   */
  async _saveDeployedContract(options) {
    const {
      localContractId,
      contractName,
      contractType,
      contractAddress,
      chainId,
      deploymentTx,
      deployerAddress = null,
      abiJson = null
    } = options;

    const db = this.database.db;
    const now = Date.now();
    const id = uuidv4();

    db.prepare(`
      INSERT INTO deployed_contracts
      (id, local_contract_id, contract_name, contract_type, contract_address, chain_id, deployment_tx, deployer_address, abi_json, deployed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, localContractId, contractName, contractType, contractAddress, chainId, deploymentTx, deployerAddress, abiJson, now);

    logger.info(`[ContractEngine] 已保存合约部署记录: ${id}`);

    return id;
  }

  /**
   * 获取合约的区块链部署信息（私有方法）
   * @param {string} contractId - 合约 ID
   */
  async _getDeployedContract(contractId) {
    try {
      const db = this.database.db;

      const deployedContract = db.prepare(`
        SELECT * FROM deployed_contracts
        WHERE local_contract_id = ?
      `).get(contractId);

      return deployedContract || null;
    } catch (error) {
      logger.error('[ContractEngine] 获取合约部署信息失败:', error);
      return null;
    }
  }

  /**
   * 关闭合约引擎
   */
  async close() {
    logger.info('[ContractEngine] 关闭智能合约引擎');

    this.stopAutoCheck();
    this.removeAllListeners();
    this.initialized = false;
  }
}

module.exports = {
  SmartContractEngine,
  ContractType,
  EscrowType,
  ContractStatus,
  ConditionType,
};
