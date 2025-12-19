/**
 * 智能合约模板系统
 *
 * 提供标准化的合约模板，简化合约创建流程
 */

const { ContractType, EscrowType, ConditionType } = require('./contract-engine');

/**
 * 合约模板类
 */
class ContractTemplates {
  /**
   * 简单买卖合约模板
   * @param {Object} params - 参数
   */
  static simpleTrade({
    buyerDid,
    sellerDid,
    assetId,
    assetName,
    quantity,
    paymentAssetId,
    paymentAmount,
    deliveryDays = 7,
  }) {
    const title = `${assetName} 买卖合约`;
    const description = `买方购买 ${quantity} 个 ${assetName}，总价 ${paymentAmount}，卖方需在 ${deliveryDays} 天内交付。`;

    const parties = [buyerDid, sellerDid];

    const terms = {
      buyerDid,
      sellerDid,
      assetId,
      assetName,
      quantity,
      paymentAssetId,
      paymentAmount,
      deliveryDays,
      escrowAssetId: paymentAssetId,
      escrowAmount: paymentAmount,
    };

    const conditions = [
      {
        type: ConditionType.PAYMENT_RECEIVED,
        data: {
          assetId: paymentAssetId,
          amount: paymentAmount,
        },
        required: true,
      },
      {
        type: ConditionType.DELIVERY_CONFIRMED,
        data: {},
        required: true,
      },
    ];

    const expiresIn = deliveryDays * 24 * 60 * 60 * 1000; // 转换为毫秒

    return {
      contractType: ContractType.SIMPLE_TRADE,
      escrowType: EscrowType.SIMPLE,
      title,
      description,
      parties,
      terms,
      conditions,
      expiresIn,
      metadata: {
        template: 'simple_trade',
        version: '1.0',
      },
    };
  }

  /**
   * 订阅付费合约模板
   * @param {Object} params - 参数
   */
  static subscription({
    subscriberDid,
    creatorDid,
    serviceName,
    paymentAssetId,
    monthlyPrice,
    durationMonths = 1,
    autoRenew = false,
  }) {
    const title = `${serviceName} 订阅合约`;
    const description = `订阅 ${serviceName}，月费 ${monthlyPrice}，订阅期限 ${durationMonths} 个月${autoRenew ? '，自动续订' : ''}。`;

    const parties = [subscriberDid, creatorDid];

    const totalAmount = monthlyPrice * durationMonths;
    const durationMs = durationMonths * 30 * 24 * 60 * 60 * 1000;

    const terms = {
      subscriberDid,
      creatorDid,
      serviceName,
      paymentAssetId,
      monthlyPrice,
      totalAmount,
      durationMonths,
      autoRenew,
      escrowAssetId: paymentAssetId,
      escrowAmount: totalAmount,
      startDate: null, // 将在激活时设置
      endDate: null,   // 将在激活时设置
    };

    const conditions = [
      {
        type: ConditionType.PAYMENT_RECEIVED,
        data: {
          assetId: paymentAssetId,
          amount: totalAmount,
        },
        required: true,
      },
    ];

    return {
      contractType: ContractType.SUBSCRIPTION,
      escrowType: EscrowType.TIMELOCK,
      title,
      description,
      parties,
      terms,
      conditions,
      expiresIn: durationMs,
      metadata: {
        template: 'subscription',
        version: '1.0',
        autoRenew,
      },
    };
  }

  /**
   * 任务悬赏合约模板
   * @param {Object} params - 参数
   */
  static bounty({
    publisherDid,
    taskTitle,
    taskDescription,
    paymentAssetId,
    rewardAmount,
    deadlineDays = 30,
    requiredApprovals = 1,
  }) {
    const title = `任务悬赏：${taskTitle}`;
    const description = `${taskDescription}\n\n赏金: ${rewardAmount}\n截止时间: ${deadlineDays} 天`;

    const parties = [publisherDid]; // 完成者将在任务被接受时添加

    const terms = {
      publisherDid,
      taskTitle,
      taskDescription,
      paymentAssetId,
      rewardAmount,
      deadlineDays,
      requiredApprovals,
      escrowAssetId: paymentAssetId,
      escrowAmount: rewardAmount,
      completorDid: null, // 将在任务被接受时设置
    };

    const conditions = [
      {
        type: ConditionType.PAYMENT_RECEIVED,
        data: {
          assetId: paymentAssetId,
          amount: rewardAmount,
        },
        required: true,
      },
      {
        type: ConditionType.APPROVAL_COUNT,
        data: {
          requiredCount: requiredApprovals,
        },
        required: true,
      },
    ];

    const expiresIn = deadlineDays * 24 * 60 * 60 * 1000;

    return {
      contractType: ContractType.BOUNTY,
      escrowType: EscrowType.CONDITIONAL,
      title,
      description,
      parties,
      terms,
      conditions,
      expiresIn,
      metadata: {
        template: 'bounty',
        version: '1.0',
        status: 'open', // open, claimed, completed
      },
    };
  }

  /**
   * 技能交换合约模板
   * @param {Object} params - 参数
   */
  static skillExchange({
    party1Did,
    party2Did,
    party1Skill,
    party2Skill,
    party1Hours,
    party2Hours,
    durationDays = 30,
  }) {
    const title = `技能交换：${party1Skill} ⇄ ${party2Skill}`;
    const description = `${party1Did} 提供 ${party1Hours} 小时的 ${party1Skill}，
${party2Did} 提供 ${party2Hours} 小时的 ${party2Skill}。
有效期: ${durationDays} 天`;

    const parties = [party1Did, party2Did];

    const terms = {
      party1Did,
      party2Did,
      party1Skill,
      party2Skill,
      party1Hours,
      party2Hours,
      durationDays,
      party1Completed: false,
      party2Completed: false,
    };

    const conditions = [
      {
        type: ConditionType.APPROVAL_COUNT,
        data: {
          requiredCount: 2, // 双方都需要确认完成
        },
        required: true,
      },
    ];

    const expiresIn = durationDays * 24 * 60 * 60 * 1000;

    return {
      contractType: ContractType.SKILL_EXCHANGE,
      escrowType: EscrowType.MULTISIG,
      title,
      description,
      parties,
      terms,
      conditions,
      expiresIn,
      metadata: {
        template: 'skill_exchange',
        version: '1.0',
      },
    };
  }

  /**
   * 多重签名托管合约模板
   * @param {Object} params - 参数
   */
  static multisigEscrow({
    participants,
    assetId,
    amount,
    requiredSignatures,
    purpose,
    durationDays = 30,
  }) {
    const title = `多重签名托管：${purpose}`;
    const description = `${participants.length} 方参与的多重签名托管，需要 ${requiredSignatures} 个签名才能释放资金。\n金额: ${amount}\n有效期: ${durationDays} 天`;

    const parties = [...participants];

    const terms = {
      participants,
      assetId,
      amount,
      requiredSignatures,
      purpose,
      durationDays,
      escrowAssetId: assetId,
      escrowAmount: amount,
    };

    const conditions = [
      {
        type: ConditionType.PAYMENT_RECEIVED,
        data: {
          assetId,
          amount,
        },
        required: true,
      },
      {
        type: ConditionType.APPROVAL_COUNT,
        data: {
          requiredCount: requiredSignatures,
        },
        required: true,
      },
    ];

    const expiresIn = durationDays * 24 * 60 * 60 * 1000;

    return {
      contractType: ContractType.CUSTOM,
      escrowType: EscrowType.MULTISIG,
      title,
      description,
      parties,
      terms,
      conditions,
      expiresIn,
      metadata: {
        template: 'multisig_escrow',
        version: '1.0',
        requiredSignatures,
      },
    };
  }

  /**
   * 时间锁托管合约模板
   * @param {Object} params - 参数
   */
  static timelockEscrow({
    senderDid,
    recipientDid,
    assetId,
    amount,
    unlockDate,
    purpose,
  }) {
    const unlockTime = new Date(unlockDate).getTime();
    const now = Date.now();
    const daysUntilUnlock = Math.ceil((unlockTime - now) / (24 * 60 * 60 * 1000));

    const title = `时间锁托管：${purpose}`;
    const description = `资金将在 ${unlockDate} 自动释放给接收者。\n金额: ${amount}\n距离解锁: ${daysUntilUnlock} 天`;

    const parties = [senderDid, recipientDid];

    const terms = {
      senderDid,
      recipientDid,
      assetId,
      amount,
      unlockDate,
      unlockTime,
      purpose,
      escrowAssetId: assetId,
      escrowAmount: amount,
    };

    const conditions = [
      {
        type: ConditionType.PAYMENT_RECEIVED,
        data: {
          assetId,
          amount,
        },
        required: true,
      },
      {
        type: ConditionType.TIME_ELAPSED,
        data: {
          timestamp: unlockTime,
        },
        required: true,
      },
    ];

    const expiresIn = unlockTime - now;

    return {
      contractType: ContractType.CUSTOM,
      escrowType: EscrowType.TIMELOCK,
      title,
      description,
      parties,
      terms,
      conditions,
      expiresIn,
      metadata: {
        template: 'timelock_escrow',
        version: '1.0',
        unlockDate,
      },
    };
  }

  /**
   * 获取所有模板列表
   */
  static getAllTemplates() {
    return [
      {
        id: 'simple_trade',
        name: '简单买卖合约',
        description: '标准的买卖交易合约，买方付款、卖方交付、买方确认',
        icon: 'shopping',
        category: 'trade',
        requiredFields: ['buyerDid', 'sellerDid', 'assetId', 'assetName', 'quantity', 'paymentAssetId', 'paymentAmount'],
        optionalFields: ['deliveryDays'],
      },
      {
        id: 'subscription',
        name: '订阅付费合约',
        description: '周期性订阅服务，支持自动续订',
        icon: 'calendar',
        category: 'subscription',
        requiredFields: ['subscriberDid', 'creatorDid', 'serviceName', 'paymentAssetId', 'monthlyPrice'],
        optionalFields: ['durationMonths', 'autoRenew'],
      },
      {
        id: 'bounty',
        name: '任务悬赏合约',
        description: '发布任务悬赏，完成任务后获得奖励',
        icon: 'trophy',
        category: 'bounty',
        requiredFields: ['publisherDid', 'taskTitle', 'taskDescription', 'paymentAssetId', 'rewardAmount'],
        optionalFields: ['deadlineDays', 'requiredApprovals'],
      },
      {
        id: 'skill_exchange',
        name: '技能交换合约',
        description: '双方交换技能服务，无需金钱支付',
        icon: 'swap',
        category: 'exchange',
        requiredFields: ['party1Did', 'party2Did', 'party1Skill', 'party2Skill', 'party1Hours', 'party2Hours'],
        optionalFields: ['durationDays'],
      },
      {
        id: 'multisig_escrow',
        name: '多重签名托管',
        description: '需要多方签名才能释放的托管合约',
        icon: 'safety',
        category: 'escrow',
        requiredFields: ['participants', 'assetId', 'amount', 'requiredSignatures', 'purpose'],
        optionalFields: ['durationDays'],
      },
      {
        id: 'timelock_escrow',
        name: '时间锁托管',
        description: '到期自动释放的时间锁托管合约',
        icon: 'clock',
        category: 'escrow',
        requiredFields: ['senderDid', 'recipientDid', 'assetId', 'amount', 'unlockDate', 'purpose'],
        optionalFields: [],
      },
    ];
  }

  /**
   * 根据模板 ID 创建合约
   * @param {string} templateId - 模板 ID
   * @param {Object} params - 参数
   */
  static createFromTemplate(templateId, params) {
    switch (templateId) {
      case 'simple_trade':
        return this.simpleTrade(params);

      case 'subscription':
        return this.subscription(params);

      case 'bounty':
        return this.bounty(params);

      case 'skill_exchange':
        return this.skillExchange(params);

      case 'multisig_escrow':
        return this.multisigEscrow(params);

      case 'timelock_escrow':
        return this.timelockEscrow(params);

      default:
        throw new Error(`未知的模板 ID: ${templateId}`);
    }
  }

  /**
   * 验证模板参数
   * @param {string} templateId - 模板 ID
   * @param {Object} params - 参数
   */
  static validateParams(templateId, params) {
    const template = this.getAllTemplates().find(t => t.id === templateId);

    if (!template) {
      throw new Error(`未知的模板 ID: ${templateId}`);
    }

    const errors = [];

    // 检查必填字段
    for (const field of template.requiredFields) {
      if (params[field] === undefined || params[field] === null || params[field] === '') {
        errors.push(`缺少必填字段: ${field}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}

module.exports = ContractTemplates;
