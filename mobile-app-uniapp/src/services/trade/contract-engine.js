/**
 * Contract Engine - 智能合约引擎
 *
 * 功能:
 * - 合约管理（创建、激活、取消、完成）
 * - 5种合约类型（简单交易、订阅、赏金、技能交换、自定义）
 * - 4种托管类型（简单、多签、时间锁、条件）
 * - 条件系统（自动检查和执行）
 * - 多方签名支持
 * - 事件日志（完整审计追踪）
 * - 仲裁系统（争议解决）
 *
 * 移动端增强:
 * - 软删除支持
 * - 三层缓存（合约、条件、事件）
 * - 简化的自动执行（移动友好）
 * - 优化的条件评估
 * - 无区块链部署（简化）
 *
 * @version 2.5.0
 * @author Claude Sonnet 4.5
 * @date 2024-01-02
 */

// 合约类型
const ContractType = {
  SIMPLE_TRADE: 'simple_trade',      // 简单交易
  SUBSCRIPTION: 'subscription',       // 订阅服务
  BOUNTY: 'bounty',                  // 赏金任务
  SKILL_EXCHANGE: 'skill_exchange',  // 技能交换
  CUSTOM: 'custom'                   // 自定义
}

// 托管类型
const EscrowType = {
  SIMPLE: 'simple',           // 简单托管
  MULTISIG: 'multisig',       // 多签托管
  TIMELOCK: 'timelock',       // 时间锁
  CONDITIONAL: 'conditional'  // 条件托管
}

// 合约状态
const ContractStatus = {
  DRAFT: 'draft',           // 草稿
  ACTIVE: 'active',         // 激活
  EXECUTING: 'executing',   // 执行中
  COMPLETED: 'completed',   // 已完成
  CANCELLED: 'cancelled',   // 已取消
  DISPUTED: 'disputed',     // 有争议
  ARBITRATED: 'arbitrated'  // 已仲裁
}

// 条件类型
const ConditionType = {
  PAYMENT_RECEIVED: 'payment_received',     // 收到付款
  DELIVERY_CONFIRMED: 'delivery_confirmed', // 确认交付
  TIME_ELAPSED: 'time_elapsed',             // 时间已过
  APPROVAL_COUNT: 'approval_count',         // 批准数量
  CUSTOM_LOGIC: 'custom_logic'              // 自定义逻辑
}

// 事件类型
const EventType = {
  CREATED: 'created',
  ACTIVATED: 'activated',
  CONDITION_MET: 'condition_met',
  SIGNATURE_ADDED: 'signature_added',
  EXECUTED: 'executed',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  DISPUTED: 'disputed',
  ARBITRATION_REQUESTED: 'arbitration_requested',
  ARBITRATION_RESOLVED: 'arbitration_resolved'
}

// 仲裁状态
const ArbitrationStatus = {
  PENDING: 'pending',       // 待处理
  IN_PROGRESS: 'in_progress', // 进行中
  RESOLVED: 'resolved'      // 已解决
}

class ContractEngine {
  constructor(db, didManager, assetManager) {
    this.db = db
    this.didManager = didManager
    this.assetManager = assetManager

    // 三层缓存
    this.contractCache = new Map()
    this.conditionCache = new Map()
    this.eventCache = new Map()
    this.cacheTTL = 5 * 60 * 1000 // 5分钟

    // 自动执行定时器
    this.autoExecuteTimer = null
    this.autoExecuteInterval = 60 * 1000 // 60秒
  }

  /**
   * 初始化
   */
  async initialize() {
    await this._createTables()
    this._startAutoExecute()
    console.log('[ContractEngine] 初始化完成')
  }

  /**
   * 创建数据库表
   */
  async _createTables() {
    // 合约表
    await this.db.executeSql(`
      CREATE TABLE IF NOT EXISTS contracts (
        id TEXT PRIMARY KEY,
        contract_type TEXT NOT NULL,
        escrow_type TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        parties TEXT NOT NULL,
        terms TEXT NOT NULL,
        asset_transfers TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        required_signatures INTEGER DEFAULT 0,
        current_signatures INTEGER DEFAULT 0,
        expires_at INTEGER,
        executed_at INTEGER,
        completed_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted INTEGER DEFAULT 0
      )
    `)

    // 合约条件表
    await this.db.executeSql(`
      CREATE TABLE IF NOT EXISTS contract_conditions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        contract_id TEXT NOT NULL,
        condition_type TEXT NOT NULL,
        condition_data TEXT NOT NULL,
        is_required BOOLEAN DEFAULT 1,
        is_met BOOLEAN DEFAULT 0,
        met_at INTEGER,
        met_by TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (contract_id) REFERENCES contracts(id)
      )
    `)

    // 合约签名表
    await this.db.executeSql(`
      CREATE TABLE IF NOT EXISTS contract_signatures (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        contract_id TEXT NOT NULL,
        signer_did TEXT NOT NULL,
        signature TEXT NOT NULL,
        signed_at INTEGER NOT NULL,
        FOREIGN KEY (contract_id) REFERENCES contracts(id)
      )
    `)

    // 合约事件表
    await this.db.executeSql(`
      CREATE TABLE IF NOT EXISTS contract_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        contract_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        event_data TEXT,
        actor_did TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (contract_id) REFERENCES contracts(id)
      )
    `)

    // 仲裁表
    await this.db.executeSql(`
      CREATE TABLE IF NOT EXISTS arbitrations (
        id TEXT PRIMARY KEY,
        contract_id TEXT NOT NULL,
        initiator_did TEXT NOT NULL,
        arbitrator_did TEXT,
        reason TEXT NOT NULL,
        evidence TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        resolution TEXT,
        resolved_at INTEGER,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (contract_id) REFERENCES contracts(id)
      )
    `)

    // 索引
    await this.db.executeSql('CREATE INDEX IF NOT EXISTS idx_contracts_status ON contracts(status)')
    await this.db.executeSql('CREATE INDEX IF NOT EXISTS idx_contract_conditions_contract ON contract_conditions(contract_id)')
    await this.db.executeSql('CREATE INDEX IF NOT EXISTS idx_contract_events_contract ON contract_events(contract_id)')
  }

  /**
   * 创建合约
   */
  async createContract(options) {
    const {
      type,
      escrowType,
      title,
      description,
      parties,
      terms,
      assetTransfers,
      requiredSignatures,
      expiresIn
    } = options

    // 验证参数
    this._validateContractParams({ type, escrowType, title, parties, terms })

    const currentDid = await this.didManager.getCurrentDid()
    const now = Date.now()

    const contract = {
      id: this._generateId(),
      contract_type: type,
      escrow_type: escrowType,
      title: title.trim(),
      description: description ? description.trim() : null,
      parties: JSON.stringify(parties),
      terms: JSON.stringify(terms),
      asset_transfers: assetTransfers ? JSON.stringify(assetTransfers) : null,
      status: ContractStatus.DRAFT,
      required_signatures: requiredSignatures || parties.length,
      current_signatures: 0,
      expires_at: expiresIn ? now + expiresIn : null,
      executed_at: null,
      completed_at: null,
      created_at: now,
      updated_at: now,
      deleted: 0
    }

    await this.db.executeSql(`
      INSERT INTO contracts (
        id, contract_type, escrow_type, title, description,
        parties, terms, asset_transfers, status, required_signatures,
        current_signatures, expires_at, executed_at, completed_at,
        created_at, updated_at, deleted
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      contract.id, contract.contract_type, contract.escrow_type,
      contract.title, contract.description, contract.parties,
      contract.terms, contract.asset_transfers, contract.status,
      contract.required_signatures, contract.current_signatures,
      contract.expires_at, contract.executed_at, contract.completed_at,
      contract.created_at, contract.updated_at, contract.deleted
    ])

    // 记录事件
    await this._addEvent(contract.id, EventType.CREATED, null, currentDid)

    // 清除缓存
    this.contractCache.clear()

    console.log(`[ContractEngine] 创建合约: ${contract.id}`)
    return contract
  }

  /**
   * 添加合约条件
   */
  async addCondition(contractId, condition) {
    const { type, data, required = true } = condition

    if (!Object.values(ConditionType).includes(type)) {
      throw new Error('无效的条件类型')
    }

    const now = Date.now()

    await this.db.executeSql(`
      INSERT INTO contract_conditions (
        contract_id, condition_type, condition_data,
        is_required, is_met, met_at, met_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      contractId, type, JSON.stringify(data),
      required ? 1 : 0, 0, null, null, now
    ])

    // 清除缓存
    this.conditionCache.delete(contractId)

    console.log(`[ContractEngine] 添加条件到合约 ${contractId}: ${type}`)
  }

  /**
   * 签署合约
   */
  async signContract(contractId, signature) {
    const contract = await this.getContract(contractId)
    const currentDid = await this.didManager.getCurrentDid()

    // 验证状态
    if (contract.status !== ContractStatus.DRAFT) {
      throw new Error('只能签署草稿状态的合约')
    }

    // 验证是否为参与方
    const parties = contract.parties  // 已由 getContract() 解析
    if (!parties.includes(currentDid)) {
      throw new Error('您不是合约参与方')
    }

    // 检查是否已签署
    const existingSig = await this.db.executeSql(
      'SELECT * FROM contract_signatures WHERE contract_id = ? AND signer_did = ?',
      [contractId, currentDid]
    )

    if (existingSig.length > 0) {
      throw new Error('您已经签署过此合约')
    }

    const now = Date.now()

    // 添加签名
    await this.db.executeSql(`
      INSERT INTO contract_signatures (
        contract_id, signer_did, signature, signed_at
      ) VALUES (?, ?, ?, ?)
    `, [contractId, currentDid, signature, now])

    // 更新签名数量
    const newSigCount = contract.current_signatures + 1
    await this.db.executeSql(
      'UPDATE contracts SET current_signatures = ?, updated_at = ? WHERE id = ?',
      [newSigCount, now, contractId]
    )

    // 记录事件
    await this._addEvent(contractId, EventType.SIGNATURE_ADDED, { signer: currentDid }, currentDid)

    // 清除缓存（在激活前清除，确保 activateContract 获取最新数据）
    this.contractCache.delete(contractId)

    // 如果签名已满，自动激活
    if (newSigCount >= contract.required_signatures) {
      await this.activateContract(contractId)
    }

    console.log(`[ContractEngine] 合约签署: ${contractId} by ${currentDid}`)
  }

  /**
   * 激活合约
   */
  async activateContract(contractId) {
    const contract = await this.getContract(contractId)
    const currentDid = await this.didManager.getCurrentDid()

    // 验证状态
    if (contract.status !== ContractStatus.DRAFT) {
      throw new Error('只能激活草稿状态的合约')
    }

    // 验证签名
    if (contract.current_signatures < contract.required_signatures) {
      throw new Error(`签名不足（需要 ${contract.required_signatures}，当前 ${contract.current_signatures}）`)
    }

    const now = Date.now()

    // 更新状态
    await this.db.executeSql(
      'UPDATE contracts SET status = ?, updated_at = ? WHERE id = ?',
      [ContractStatus.ACTIVE, now, contractId]
    )

    // 记录事件
    await this._addEvent(contractId, EventType.ACTIVATED, null, currentDid)

    // 清除缓存
    this.contractCache.delete(contractId)

    console.log(`[ContractEngine] 激活合约: ${contractId}`)
  }

  /**
   * 满足条件
   */
  async meetCondition(contractId, conditionId, proof = null) {
    const contract = await this.getContract(contractId)
    const currentDid = await this.didManager.getCurrentDid()

    // 验证状态
    if (![ContractStatus.ACTIVE, ContractStatus.EXECUTING].includes(contract.status)) {
      throw new Error('合约必须处于激活或执行中状态')
    }

    // 获取条件
    const conditions = await this.db.executeSql(
      'SELECT * FROM contract_conditions WHERE id = ? AND contract_id = ?',
      [conditionId, contractId]
    )

    if (conditions.length === 0) {
      throw new Error('条件不存在')
    }

    const condition = conditions[0]

    if (condition.is_met) {
      throw new Error('条件已满足')
    }

    const now = Date.now()

    // 更新条件状态
    await this.db.executeSql(
      'UPDATE contract_conditions SET is_met = 1, met_at = ?, met_by = ? WHERE id = ?',
      [now, currentDid, conditionId]
    )

    // 记录事件
    await this._addEvent(contractId, EventType.CONDITION_MET, {
      conditionId,
      conditionType: condition.condition_type,
      proof
    }, currentDid)

    // 清除缓存
    this.conditionCache.delete(contractId)

    // 检查是否所有条件已满足
    const allConditions = await this.getConditions(contractId)
    const requiredConditions = allConditions.filter(c => c.is_required)
    const metRequiredConditions = requiredConditions.filter(c => c.is_met)

    if (metRequiredConditions.length === requiredConditions.length) {
      // 所有必需条件已满足，执行合约
      await this.executeContract(contractId)
    }

    console.log(`[ContractEngine] 满足条件 ${conditionId} 在合约 ${contractId}`)
  }

  /**
   * 执行合约
   */
  async executeContract(contractId) {
    const contract = await this.getContract(contractId)
    const currentDid = await this.didManager.getCurrentDid()

    // 验证状态
    if (contract.status !== ContractStatus.ACTIVE) {
      throw new Error('只能执行激活状态的合约')
    }

    // 验证所有必需条件已满足
    const conditions = await this.getConditions(contractId)
    const requiredConditions = conditions.filter(c => c.is_required)
    const unmetRequired = requiredConditions.filter(c => !c.is_met)

    if (unmetRequired.length > 0) {
      throw new Error(`还有 ${unmetRequired.length} 个必需条件未满足`)
    }

    const now = Date.now()

    // 更新状态为执行中
    await this.db.executeSql(
      'UPDATE contracts SET status = ?, updated_at = ? WHERE id = ?',
      [ContractStatus.EXECUTING, now, contractId]
    )

    // 执行资产转移
    if (contract.asset_transfers) {
      const transfers = JSON.parse(contract.asset_transfers)
      for (const transfer of transfers) {
        await this.assetManager.transferAsset(
          transfer.assetId,
          transfer.toDid,
          transfer.amount,
          `合约执行: ${contract.title}`
        )
      }
    }

    // 更新状态为已执行
    await this.db.executeSql(
      'UPDATE contracts SET status = ?, executed_at = ?, updated_at = ? WHERE id = ?',
      [ContractStatus.EXECUTING, now, now, contractId]
    )

    // 记录事件
    await this._addEvent(contractId, EventType.EXECUTED, null, currentDid)

    // 清除缓存
    this.contractCache.delete(contractId)

    console.log(`[ContractEngine] 执行合约: ${contractId}`)
  }

  /**
   * 完成合约
   */
  async completeContract(contractId) {
    const contract = await this.getContract(contractId)
    const currentDid = await this.didManager.getCurrentDid()

    // 验证状态
    if (contract.status !== ContractStatus.EXECUTING) {
      throw new Error('只能完成执行中状态的合约')
    }

    const now = Date.now()

    // 更新状态
    await this.db.executeSql(
      'UPDATE contracts SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?',
      [ContractStatus.COMPLETED, now, now, contractId]
    )

    // 记录事件
    await this._addEvent(contractId, EventType.COMPLETED, null, currentDid)

    // 清除缓存
    this.contractCache.delete(contractId)

    console.log(`[ContractEngine] 完成合约: ${contractId}`)
  }

  /**
   * 取消合约
   */
  async cancelContract(contractId, reason) {
    const contract = await this.getContract(contractId)
    const currentDid = await this.didManager.getCurrentDid()

    // 验证状态
    if (![ContractStatus.DRAFT, ContractStatus.ACTIVE].includes(contract.status)) {
      throw new Error('只能取消草稿或激活状态的合约')
    }

    // 验证权限（必须是参与方）
    const parties = JSON.parse(contract.parties)
    if (!parties.includes(currentDid)) {
      throw new Error('只有参与方可以取消合约')
    }

    const now = Date.now()

    // 更新状态
    await this.db.executeSql(
      'UPDATE contracts SET status = ?, updated_at = ? WHERE id = ?',
      [ContractStatus.CANCELLED, now, contractId]
    )

    // 记录事件
    await this._addEvent(contractId, EventType.CANCELLED, { reason }, currentDid)

    // 清除缓存
    this.contractCache.delete(contractId)

    console.log(`[ContractEngine] 取消合约: ${contractId}`)
  }

  /**
   * 提出争议
   */
  async disputeContract(contractId, reason) {
    const contract = await this.getContract(contractId)
    const currentDid = await this.didManager.getCurrentDid()

    // 验证状态
    if (![ContractStatus.ACTIVE, ContractStatus.EXECUTING].includes(contract.status)) {
      throw new Error('只能对激活或执行中的合约提出争议')
    }

    // 验证权限
    const parties = JSON.parse(contract.parties)
    if (!parties.includes(currentDid)) {
      throw new Error('只有参与方可以提出争议')
    }

    const now = Date.now()

    // 更新状态
    await this.db.executeSql(
      'UPDATE contracts SET status = ?, updated_at = ? WHERE id = ?',
      [ContractStatus.DISPUTED, now, contractId]
    )

    // 记录事件
    await this._addEvent(contractId, EventType.DISPUTED, { reason }, currentDid)

    // 清除缓存
    this.contractCache.delete(contractId)

    console.log(`[ContractEngine] 合约争议: ${contractId}`)
  }

  /**
   * 请求仲裁
   */
  async requestArbitration(contractId, reason, evidence = null, arbitratorDid = null) {
    const contract = await this.getContract(contractId)
    const currentDid = await this.didManager.getCurrentDid()

    // 验证状态
    if (contract.status !== ContractStatus.DISPUTED) {
      throw new Error('只能为有争议的合约请求仲裁')
    }

    const now = Date.now()

    const arbitration = {
      id: this._generateId(),
      contract_id: contractId,
      initiator_did: currentDid,
      arbitrator_did: arbitratorDid,
      reason: reason.trim(),
      evidence: evidence ? JSON.stringify(evidence) : null,
      status: ArbitrationStatus.PENDING,
      resolution: null,
      resolved_at: null,
      created_at: now
    }

    await this.db.executeSql(`
      INSERT INTO arbitrations (
        id, contract_id, initiator_did, arbitrator_did,
        reason, evidence, status, resolution, resolved_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      arbitration.id, arbitration.contract_id, arbitration.initiator_did,
      arbitration.arbitrator_did, arbitration.reason, arbitration.evidence,
      arbitration.status, arbitration.resolution, arbitration.resolved_at,
      arbitration.created_at
    ])

    // 记录事件
    await this._addEvent(contractId, EventType.ARBITRATION_REQUESTED, {
      arbitrationId: arbitration.id,
      reason
    }, currentDid)

    console.log(`[ContractEngine] 请求仲裁: ${arbitration.id} for contract ${contractId}`)
    return arbitration
  }

  /**
   * 解决仲裁
   */
  async resolveArbitration(arbitrationId, resolution) {
    const arbitrations = await this.db.executeSql(
      'SELECT * FROM arbitrations WHERE id = ?',
      [arbitrationId]
    )

    if (arbitrations.length === 0) {
      throw new Error('仲裁不存在')
    }

    const arbitration = arbitrations[0]
    const currentDid = await this.didManager.getCurrentDid()

    // 验证权限（必须是仲裁员）
    if (arbitration.arbitrator_did && arbitration.arbitrator_did !== currentDid) {
      throw new Error('只有指定的仲裁员可以解决此仲裁')
    }

    const now = Date.now()

    // 更新仲裁状态
    await this.db.executeSql(
      'UPDATE arbitrations SET status = ?, resolution = ?, resolved_at = ? WHERE id = ?',
      [ArbitrationStatus.RESOLVED, JSON.stringify(resolution), now, arbitrationId]
    )

    // 更新合约状态
    await this.db.executeSql(
      'UPDATE contracts SET status = ?, updated_at = ? WHERE id = ?',
      [ContractStatus.ARBITRATED, now, arbitration.contract_id]
    )

    // 记录事件
    await this._addEvent(arbitration.contract_id, EventType.ARBITRATION_RESOLVED, {
      arbitrationId,
      resolution
    }, currentDid)

    // 清除缓存
    this.contractCache.delete(arbitration.contract_id)

    console.log(`[ContractEngine] 解决仲裁: ${arbitrationId}`)
  }

  /**
   * 获取合约
   */
  async getContract(contractId) {
    // 检查缓存
    const cached = this.contractCache.get(contractId)
    if (cached && (Date.now() - cached.timestamp < this.cacheTTL)) {
      return cached.data
    }

    const contracts = await this.db.executeSql(
      'SELECT * FROM contracts WHERE id = ? AND deleted = 0',
      [contractId]
    )

    if (contracts.length === 0) {
      throw new Error('合约不存在')
    }

    const contract = contracts[0]

    // 解析JSON字段
    contract.parties = JSON.parse(contract.parties)
    contract.terms = JSON.parse(contract.terms)
    if (contract.asset_transfers) {
      contract.asset_transfers = JSON.parse(contract.asset_transfers)
    }

    // 缓存
    this.contractCache.set(contractId, {
      data: contract,
      timestamp: Date.now()
    })

    return contract
  }

  /**
   * 获取合约条件
   */
  async getConditions(contractId) {
    // 检查缓存
    const cached = this.conditionCache.get(contractId)
    if (cached && (Date.now() - cached.timestamp < this.cacheTTL)) {
      return cached.data
    }

    const conditions = await this.db.executeSql(
      'SELECT * FROM contract_conditions WHERE contract_id = ? ORDER BY created_at ASC',
      [contractId]
    )

    // 解析JSON字段
    conditions.forEach(condition => {
      condition.condition_data = JSON.parse(condition.condition_data)
    })

    // 缓存
    this.conditionCache.set(contractId, {
      data: conditions,
      timestamp: Date.now()
    })

    return conditions
  }

  /**
   * 获取合约签名
   */
  async getSignatures(contractId) {
    return await this.db.executeSql(
      'SELECT * FROM contract_signatures WHERE contract_id = ? ORDER BY signed_at ASC',
      [contractId]
    )
  }

  /**
   * 获取合约事件
   */
  async getEvents(contractId, limit = 50) {
    const events = await this.db.executeSql(
      'SELECT * FROM contract_events WHERE contract_id = ? ORDER BY created_at DESC LIMIT ?',
      [contractId, limit]
    )

    // 解析JSON字段
    events.forEach(event => {
      if (event.event_data) {
        event.event_data = JSON.parse(event.event_data)
      }
    })

    return events
  }

  /**
   * 获取仲裁
   */
  async getArbitration(contractId) {
    const arbitrations = await this.db.executeSql(
      'SELECT * FROM arbitrations WHERE contract_id = ? ORDER BY created_at DESC LIMIT 1',
      [contractId]
    )

    if (arbitrations.length === 0) {
      return null
    }

    const arbitration = arbitrations[0]

    // 解析JSON字段
    if (arbitration.evidence) {
      arbitration.evidence = JSON.parse(arbitration.evidence)
    }
    if (arbitration.resolution) {
      arbitration.resolution = JSON.parse(arbitration.resolution)
    }

    return arbitration
  }

  /**
   * 获取所有合约
   */
  async getAllContracts(options = {}) {
    const { type, status, partyDid, limit = 100 } = options

    let query = 'SELECT * FROM contracts WHERE deleted = 0'
    const params = []

    if (type) {
      query += ' AND contract_type = ?'
      params.push(type)
    }

    if (status) {
      query += ' AND status = ?'
      params.push(status)
    }

    if (partyDid) {
      query += ' AND parties LIKE ?'
      params.push(`%${partyDid}%`)
    }

    query += ' ORDER BY created_at DESC LIMIT ?'
    params.push(limit)

    const contracts = await this.db.executeSql(query, params)

    // 解析JSON字段
    contracts.forEach(contract => {
      contract.parties = JSON.parse(contract.parties)
      contract.terms = JSON.parse(contract.terms)
      if (contract.asset_transfers) {
        contract.asset_transfers = JSON.parse(contract.asset_transfers)
      }
    })

    return contracts
  }

  /**
   * 获取我的合约
   */
  async getMyContracts(status = null) {
    const currentDid = await this.didManager.getCurrentDid()
    return await this.getAllContracts({
      partyDid: currentDid,
      status
    })
  }

  /**
   * 搜索合约
   */
  async searchContracts(query, limit = 50) {
    const contracts = await this.db.executeSql(`
      SELECT * FROM contracts
      WHERE deleted = 0
        AND (title LIKE ? OR description LIKE ?)
      ORDER BY created_at DESC
      LIMIT ?
    `, [`%${query}%`, `%${query}%`, limit])

    // 解析JSON字段
    contracts.forEach(contract => {
      contract.parties = JSON.parse(contract.parties)
      contract.terms = JSON.parse(contract.terms)
      if (contract.asset_transfers) {
        contract.asset_transfers = JSON.parse(contract.asset_transfers)
      }
    })

    return contracts
  }

  /**
   * 删除合约（软删除）
   */
  async deleteContract(contractId) {
    const contract = await this.getContract(contractId)
    const currentDid = await this.didManager.getCurrentDid()

    // 验证权限
    const parties = JSON.parse(contract.parties)
    if (!parties.includes(currentDid)) {
      throw new Error('只有参与方可以删除合约')
    }

    // 只能删除草稿、已完成、已取消、已仲裁的合约
    if (![
      ContractStatus.DRAFT,
      ContractStatus.COMPLETED,
      ContractStatus.CANCELLED,
      ContractStatus.ARBITRATED
    ].includes(contract.status)) {
      throw new Error('无法删除该状态的合约')
    }

    await this.db.executeSql(
      'UPDATE contracts SET deleted = 1, updated_at = ? WHERE id = ?',
      [Date.now(), contractId]
    )

    // 清除缓存
    this.contractCache.delete(contractId)

    console.log(`[ContractEngine] 删除合约: ${contractId}`)
  }

  /**
   * 获取统计信息
   */
  async getStatistics() {
    const currentDid = await this.didManager.getCurrentDid()

    // 总体统计
    const total = await this.db.executeSql(
      'SELECT COUNT(*) as count FROM contracts WHERE deleted = 0'
    )

    // 按状态统计
    const byStatus = {}
    for (const status of Object.values(ContractStatus)) {
      const result = await this.db.executeSql(
        'SELECT COUNT(*) as count FROM contracts WHERE status = ? AND deleted = 0',
        [status]
      )
      byStatus[status] = result[0].count
    }

    // 按类型统计
    const byType = {}
    for (const type of Object.values(ContractType)) {
      const result = await this.db.executeSql(
        'SELECT COUNT(*) as count FROM contracts WHERE contract_type = ? AND deleted = 0',
        [type]
      )
      byType[type] = result[0].count
    }

    // 我的统计
    const myContracts = await this.db.executeSql(
      'SELECT COUNT(*) as count FROM contracts WHERE parties LIKE ? AND deleted = 0',
      [`%${currentDid}%`]
    )

    return {
      total: total[0].count,
      byStatus,
      byType,
      myContracts: myContracts[0].count
    }
  }

  /**
   * 清除缓存
   */
  clearCache() {
    this.contractCache.clear()
    this.conditionCache.clear()
    this.eventCache.clear()
    console.log('[ContractEngine] 缓存已清除')
  }

  /**
   * 启动自动执行
   */
  _startAutoExecute() {
    if (this.autoExecuteTimer) {
      clearInterval(this.autoExecuteTimer)
    }

    this.autoExecuteTimer = setInterval(async () => {
      try {
        await this._checkAndExecuteContracts()
      } catch (error) {
        console.error('[ContractEngine] 自动执行错误:', error)
      }
    }, this.autoExecuteInterval)

    console.log('[ContractEngine] 自动执行已启动')
  }

  /**
   * 停止自动执行
   */
  stopAutoExecute() {
    if (this.autoExecuteTimer) {
      clearInterval(this.autoExecuteTimer)
      this.autoExecuteTimer = null
      console.log('[ContractEngine] 自动执行已停止')
    }
  }

  /**
   * 检查并执行合约
   */
  async _checkAndExecuteContracts() {
    // 获取所有激活状态的合约
    const activeContracts = await this.getAllContracts({
      status: ContractStatus.ACTIVE
    })

    for (const contract of activeContracts) {
      try {
        // 检查过期
        if (contract.expires_at && Date.now() > contract.expires_at) {
          await this.cancelContract(contract.id, '合约已过期')
          continue
        }

        // 检查条件
        const conditions = await this.getConditions(contract.id)
        const requiredConditions = conditions.filter(c => c.is_required)
        const metRequiredConditions = requiredConditions.filter(c => c.is_met)

        // 如果所有必需条件已满足，自动执行
        if (metRequiredConditions.length === requiredConditions.length) {
          await this.executeContract(contract.id)
        }
      } catch (error) {
        console.error(`[ContractEngine] 检查合约 ${contract.id} 错误:`, error)
      }
    }
  }

  /**
   * 添加事件
   */
  async _addEvent(contractId, eventType, eventData = null, actorDid = null) {
    await this.db.executeSql(`
      INSERT INTO contract_events (
        contract_id, event_type, event_data, actor_did, created_at
      ) VALUES (?, ?, ?, ?, ?)
    `, [
      contractId,
      eventType,
      eventData ? JSON.stringify(eventData) : null,
      actorDid,
      Date.now()
    ])

    // 清除事件缓存
    this.eventCache.delete(contractId)
  }

  /**
   * 验证合约参数
   */
  _validateContractParams({ type, escrowType, title, parties, terms }) {
    if (!Object.values(ContractType).includes(type)) {
      throw new Error('无效的合约类型')
    }

    if (!Object.values(EscrowType).includes(escrowType)) {
      throw new Error('无效的托管类型')
    }

    if (!title || title.trim().length === 0) {
      throw new Error('标题不能为空')
    }

    if (!Array.isArray(parties) || parties.length < 2) {
      throw new Error('至少需要2个参与方')
    }

    if (!terms || Object.keys(terms).length === 0) {
      throw new Error('条款不能为空')
    }
  }

  /**
   * 生成ID
   */
  _generateId() {
    return `contract_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * 销毁
   */
  destroy() {
    this.stopAutoExecute()
    this.clearCache()
    console.log('[ContractEngine] 已销毁')
  }
}

// 单例模式
let contractEngineInstance = null

/**
 * 创建 ContractEngine 实例
 */
export function createContractEngine(db, didManager, assetManager) {
  if (!contractEngineInstance) {
    contractEngineInstance = new ContractEngine(db, didManager, assetManager)
  }
  return contractEngineInstance
}

/**
 * 获取 ContractEngine 实例
 */
export function getContractEngine() {
  if (!contractEngineInstance) {
    throw new Error('ContractEngine 未初始化')
  }
  return contractEngineInstance
}

export {
  ContractType,
  EscrowType,
  ContractStatus,
  ConditionType,
  EventType,
  ArbitrationStatus
}
