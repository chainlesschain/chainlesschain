/**
 * Pure helpers extracted from ContractDetail.vue (opportunistic split).
 * Contract status/type/escrow/condition/event label+color maps, term-key
 * labels, DID shortening, time formatting, and expiry check. No reactive state.
 *
 * NOTE: getEventIcon stays in the SFC — it returns Ant icon *components*.
 */

export const getStatusColor = (status) => {
  const colors = {
    draft: "default",
    active: "green",
    executing: "blue",
    completed: "cyan",
    cancelled: "red",
    disputed: "volcano",
    arbitrated: "purple",
  };
  return colors[status] || "default";
};

export const getStatusName = (status) => {
  const names = {
    draft: "草稿",
    active: "激活",
    executing: "执行中",
    completed: "已完成",
    cancelled: "已取消",
    disputed: "有争议",
    arbitrated: "已仲裁",
  };
  return names[status] || status;
};

export const getTypeColor = (type) => {
  const colors = {
    simple_trade: "blue",
    subscription: "purple",
    bounty: "orange",
    skill_exchange: "green",
    custom: "default",
  };
  return colors[type] || "default";
};

export const getTypeName = (type) => {
  const names = {
    simple_trade: "简单买卖",
    subscription: "订阅付费",
    bounty: "任务悬赏",
    skill_exchange: "技能交换",
    custom: "自定义",
  };
  return names[type] || type;
};

export const getEscrowTypeColor = (type) => {
  const colors = {
    simple: "cyan",
    multisig: "geekblue",
    timelock: "gold",
    conditional: "lime",
  };
  return colors[type] || "default";
};

export const getEscrowTypeName = (type) => {
  const names = {
    simple: "简单托管",
    multisig: "多重签名",
    timelock: "时间锁",
    conditional: "条件托管",
  };
  return names[type] || type;
};

export const getConditionTypeName = (type) => {
  const names = {
    payment_received: "收到付款",
    delivery_confirmed: "确认交付",
    time_elapsed: "时间到期",
    approval_count: "批准数量",
    custom_logic: "自定义逻辑",
  };
  return names[type] || type;
};

export const getEventTypeName = (type) => {
  const names = {
    created: "创建",
    activated: "激活",
    signed: "签名",
    condition_met: "条件满足",
    executed: "执行",
    completed: "完成",
    cancelled: "取消",
    arbitration_initiated: "发起仲裁",
    arbitration_resolved: "仲裁解决",
    delivery_confirmed: "确认交付",
    approved: "批准",
  };
  return names[type] || type;
};

export const getEventColor = (type) => {
  const colors = {
    created: "blue",
    activated: "green",
    signed: "cyan",
    condition_met: "lime",
    executed: "purple",
    completed: "green",
    cancelled: "red",
    arbitration_initiated: "volcano",
    arbitration_resolved: "purple",
  };
  return colors[type] || "blue";
};

export const formatTermKey = (key) => {
  const labels = {
    buyerDid: "买家",
    sellerDid: "卖家",
    assetId: "资产 ID",
    assetName: "资产名称",
    quantity: "数量",
    paymentAssetId: "支付资产",
    paymentAmount: "支付金额",
    deliveryDays: "交付天数",
    escrowAssetId: "托管资产",
    escrowAmount: "托管金额",
    subscriberDid: "订阅者",
    creatorDid: "创作者",
    serviceName: "服务名称",
    monthlyPrice: "月费",
    totalAmount: "总金额",
    durationMonths: "订阅月数",
    autoRenew: "自动续订",
    publisherDid: "发布者",
    taskTitle: "任务标题",
    taskDescription: "任务描述",
    rewardAmount: "赏金",
    deadlineDays: "截止天数",
    requiredApprovals: "所需批准数",
    completorDid: "完成者",
    party1Did: "甲方",
    party2Did: "乙方",
    party1Skill: "甲方技能",
    party2Skill: "乙方技能",
    party1Hours: "甲方工时",
    party2Hours: "乙方工时",
    durationDays: "有效天数",
    participants: "参与方",
    amount: "金额",
    requiredSignatures: "所需签名数",
    purpose: "用途",
    senderDid: "发送者",
    recipientDid: "接收者",
    unlockDate: "解锁日期",
    unlockTime: "解锁时间",
  };
  return labels[key] || key;
};

export const shortenDid = (did) => {
  if (!did) {
    return "";
  }
  return did.length > 20 ? `${did.slice(0, 10)}...${did.slice(-8)}` : did;
};

export const formatTime = (timestamp) => {
  const date = new Date(timestamp);
  return date.toLocaleString("zh-CN");
};

export const isExpired = (timestamp) => {
  return Date.now() > timestamp;
};
