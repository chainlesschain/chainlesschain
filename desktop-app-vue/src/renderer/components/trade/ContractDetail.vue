<template>
  <div class="contract-detail">
    <a-modal
      :open="visible"
      title="合约详情"
      width="1000px"
      :footer="null"
      @cancel="handleCancel"
    >
      <div v-if="contract">
        <!-- 合约基本信息 -->
        <a-card title="基本信息" size="small" style="margin-bottom: 16px">
          <template #extra>
            <status-badge :status="contract.status" type="contract" show-icon />
          </template>

          <a-descriptions :column="2" bordered>
            <a-descriptions-item label="合约 ID" :span="2">
              <a-typography-text copyable>{{ contract.id }}</a-typography-text>
            </a-descriptions-item>
            <a-descriptions-item label="合约标题" :span="2">
              <strong>{{ contract.title }}</strong>
            </a-descriptions-item>
            <a-descriptions-item v-if="contract.description" label="合约描述" :span="2">
              {{ contract.description }}
            </a-descriptions-item>
            <a-descriptions-item label="合约类型">
              <a-tag :color="getTypeColor(contract.contract_type)">
                {{ getTypeName(contract.contract_type) }}
              </a-tag>
            </a-descriptions-item>
            <a-descriptions-item label="托管类型">
              <a-tag :color="getEscrowTypeColor(contract.escrow_type)">
                {{ getEscrowTypeName(contract.escrow_type) }}
              </a-tag>
            </a-descriptions-item>
            <a-descriptions-item label="创建者">
              <a-typography-text copyable style="font-size: 12px">
                {{ shortenDid(contract.creator_did) }}
              </a-typography-text>
            </a-descriptions-item>
            <a-descriptions-item label="创建时间">
              {{ formatTime(contract.created_at) }}
            </a-descriptions-item>
            <a-descriptions-item v-if="contract.activated_at" label="激活时间" :span="2">
              {{ formatTime(contract.activated_at) }}
            </a-descriptions-item>
            <a-descriptions-item v-if="contract.completed_at" label="完成时间" :span="2">
              {{ formatTime(contract.completed_at) }}
            </a-descriptions-item>
            <a-descriptions-item v-if="contract.expires_at" label="到期时间" :span="2">
              <span :style="{ color: isExpired(contract.expires_at) ? '#ff4d4f' : '#52c41a' }">
                {{ formatTime(contract.expires_at) }}
                {{ isExpired(contract.expires_at) ? '(已过期)' : '' }}
              </span>
            </a-descriptions-item>
          </a-descriptions>
        </a-card>

        <!-- 参与方 -->
        <a-card title="参与方" size="small" style="margin-bottom: 16px">
          <a-list
            :data-source="contract.parties"
            size="small"
          >
            <template #renderItem="{ item }">
              <a-list-item>
                <a-space>
                  <user-outlined />
                  <a-typography-text copyable style="font-size: 12px">
                    {{ item }}
                  </a-typography-text>
                </a-space>
              </a-list-item>
            </template>
          </a-list>
        </a-card>

        <!-- 合约条款 -->
        <a-card title="合约条款" size="small" style="margin-bottom: 16px">
          <a-descriptions :column="2" bordered size="small">
            <a-descriptions-item
              v-for="(value, key) in contract.terms"
              :key="key"
              :label="formatTermKey(key)"
            >
              <template v-if="typeof value === 'boolean'">
                {{ value ? '是' : '否' }}
              </template>
              <template v-else-if="key.includes('Did')">
                <a-typography-text copyable style="font-size: 11px">
                  {{ shortenDid(value) }}
                </a-typography-text>
              </template>
              <template v-else>
                {{ value }}
              </template>
            </a-descriptions-item>
          </a-descriptions>
        </a-card>

        <!-- 合约条件 -->
        <a-card title="合约条件" size="small" style="margin-bottom: 16px">
          <template #extra>
            <a-button size="small" @click="loadConditions">
              <reload-outlined /> 刷新
            </a-button>
          </template>

          <a-spin :spinning="loadingConditions">
            <a-list
              :data-source="conditions"
              size="small"
            >
              <template #renderItem="{ item }">
                <a-list-item>
                  <a-list-item-meta>
                    <template #title>
                      <a-space>
                        <component :is="item.is_met ? CheckCircleOutlined : CloseCircleOutlined" :style="{ color: item.is_met ? '#52c41a' : '#999' }" />
                        <span>{{ getConditionTypeName(item.condition_type) }}</span>
                        <a-tag v-if="item.is_required" color="red" size="small">必需</a-tag>
                      </a-space>
                    </template>
                    <template #description>
                      <div v-if="item.condition_data">
                        {{ JSON.stringify(item.condition_data) }}
                      </div>
                      <div v-if="item.met_at">
                        满足时间: {{ formatTime(item.met_at) }}
                      </div>
                    </template>
                  </a-list-item-meta>
                </a-list-item>
              </template>

              <template #empty>
                <a-empty description="无条件要求" :image="null" />
              </template>
            </a-list>
          </a-spin>
        </a-card>

        <!-- 合约事件 -->
        <a-card title="合约事件" size="small" style="margin-bottom: 16px">
          <template #extra>
            <a-button size="small" @click="loadEvents">
              <reload-outlined /> 刷新
            </a-button>
          </template>

          <a-spin :spinning="loadingEvents">
            <a-timeline>
              <a-timeline-item
                v-for="event in events"
                :key="event.id"
                :color="getEventColor(event.event_type)"
              >
                <template #dot>
                  <component :is="getEventIcon(event.event_type)" />
                </template>
                <div>
                  <strong>{{ getEventTypeName(event.event_type) }}</strong>
                  <div v-if="event.actor_did" style="font-size: 12px; color: #999">
                    操作者: {{ shortenDid(event.actor_did) }}
                  </div>
                  <div v-if="event.event_data" style="font-size: 11px; color: #666">
                    {{ JSON.stringify(event.event_data) }}
                  </div>
                  <div style="font-size: 11px; color: #999">
                    {{ formatTime(event.created_at) }}
                  </div>
                </div>
              </a-timeline-item>
            </a-timeline>
          </a-spin>
        </a-card>

        <!-- 托管信息 -->
        <a-card v-if="contract.escrow_id" title="托管信息" size="small" style="margin-bottom: 16px">
          <a-descriptions :column="2" bordered size="small">
            <a-descriptions-item label="托管 ID" :span="2">
              <a-typography-text copyable>{{ contract.escrow_id }}</a-typography-text>
            </a-descriptions-item>
          </a-descriptions>
        </a-card>

        <!-- 操作按钮 -->
        <div class="action-buttons">
          <a-space>
            <a-button v-if="contract.status === 'draft' && isParty" type="primary" @click="handleActivate">
              <check-circle-outlined /> 激活合约
            </a-button>
            <a-button v-if="contract.status === 'draft' && contract.escrow_type === 'multisig'" @click="handleSign">
              <edit-outlined /> 签名合约
            </a-button>
            <a-button v-if="contract.status === 'active'" @click="handleCheckConditions">
              <check-square-outlined /> 检查条件
            </a-button>
            <a-button v-if="contract.status === 'active' && isParty" type="primary" @click="handleExecute">
              <play-circle-outlined /> 执行合约
            </a-button>
            <a-button v-if="['draft', 'active'].includes(contract.status) && isParty" danger @click="handleCancel">
              <close-circle-outlined /> 取消合约
            </a-button>
            <a-button v-if="contract.status === 'active' && isParty" danger @click="handleInitiateArbitration">
              <warning-outlined /> 发起仲裁
            </a-button>
            <a-button @click="handleClose">
              关闭
            </a-button>
          </a-space>
        </div>
      </div>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { message as antMessage, Modal } from 'ant-design-vue';
import {
  UserOutlined,
  ReloadOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  EditOutlined,
  CheckSquareOutlined,
  PlayCircleOutlined,
  WarningOutlined,
  FileTextOutlined,
  AuditOutlined,
} from '@ant-design/icons-vue';
import { useTradeStore } from '../../stores/trade';
import StatusBadge from './common/StatusBadge.vue';

// Store
const tradeStore = useTradeStore();

// Props
const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  contract: {
    type: Object,
    default: null,
  },
});

// Emits
const emit = defineEmits(['activated', 'executed', 'cancelled', 'update:open']);

// 状态
const loadingConditions = ref(false);
const loadingEvents = ref(false);
const conditions = ref([]);
const events = ref([]);
const currentDid = ref('');

// 计算属性
const isParty = computed(() => {
  return props.contract && props.contract.parties.includes(currentDid.value);
});

// 工具函数
const getStatusColor = (status) => {
  const colors = {
    draft: 'default',
    active: 'green',
    executing: 'blue',
    completed: 'cyan',
    cancelled: 'red',
    disputed: 'volcano',
    arbitrated: 'purple',
  };
  return colors[status] || 'default';
};

const getStatusName = (status) => {
  const names = {
    draft: '草稿',
    active: '激活',
    executing: '执行中',
    completed: '已完成',
    cancelled: '已取消',
    disputed: '有争议',
    arbitrated: '已仲裁',
  };
  return names[status] || status;
};

const getTypeColor = (type) => {
  const colors = {
    simple_trade: 'blue',
    subscription: 'purple',
    bounty: 'orange',
    skill_exchange: 'green',
    custom: 'default',
  };
  return colors[type] || 'default';
};

const getTypeName = (type) => {
  const names = {
    simple_trade: '简单买卖',
    subscription: '订阅付费',
    bounty: '任务悬赏',
    skill_exchange: '技能交换',
    custom: '自定义',
  };
  return names[type] || type;
};

const getEscrowTypeColor = (type) => {
  const colors = {
    simple: 'cyan',
    multisig: 'geekblue',
    timelock: 'gold',
    conditional: 'lime',
  };
  return colors[type] || 'default';
};

const getEscrowTypeName = (type) => {
  const names = {
    simple: '简单托管',
    multisig: '多重签名',
    timelock: '时间锁',
    conditional: '条件托管',
  };
  return names[type] || type;
};

const getConditionTypeName = (type) => {
  const names = {
    payment_received: '收到付款',
    delivery_confirmed: '确认交付',
    time_elapsed: '时间到期',
    approval_count: '批准数量',
    custom_logic: '自定义逻辑',
  };
  return names[type] || type;
};

const getEventTypeName = (type) => {
  const names = {
    created: '创建',
    activated: '激活',
    signed: '签名',
    condition_met: '条件满足',
    executed: '执行',
    completed: '完成',
    cancelled: '取消',
    arbitration_initiated: '发起仲裁',
    arbitration_resolved: '仲裁解决',
    delivery_confirmed: '确认交付',
    approved: '批准',
  };
  return names[type] || type;
};

const getEventColor = (type) => {
  const colors = {
    created: 'blue',
    activated: 'green',
    signed: 'cyan',
    condition_met: 'lime',
    executed: 'purple',
    completed: 'green',
    cancelled: 'red',
    arbitration_initiated: 'volcano',
    arbitration_resolved: 'purple',
  };
  return colors[type] || 'blue';
};

const getEventIcon = (type) => {
  const icons = {
    created: FileTextOutlined,
    activated: CheckCircleOutlined,
    signed: EditOutlined,
    executed: PlayCircleOutlined,
    completed: CheckCircleOutlined,
    cancelled: CloseCircleOutlined,
    arbitration_initiated: WarningOutlined,
    arbitration_resolved: AuditOutlined,
  };
  return icons[type] || FileTextOutlined;
};

const formatTermKey = (key) => {
  const labels = {
    buyerDid: '买家',
    sellerDid: '卖家',
    assetId: '资产 ID',
    assetName: '资产名称',
    quantity: '数量',
    paymentAssetId: '支付资产',
    paymentAmount: '支付金额',
    deliveryDays: '交付天数',
    escrowAssetId: '托管资产',
    escrowAmount: '托管金额',
    subscriberDid: '订阅者',
    creatorDid: '创作者',
    serviceName: '服务名称',
    monthlyPrice: '月费',
    totalAmount: '总金额',
    durationMonths: '订阅月数',
    autoRenew: '自动续订',
    publisherDid: '发布者',
    taskTitle: '任务标题',
    taskDescription: '任务描述',
    rewardAmount: '赏金',
    deadlineDays: '截止天数',
    requiredApprovals: '所需批准数',
    completorDid: '完成者',
    party1Did: '甲方',
    party2Did: '乙方',
    party1Skill: '甲方技能',
    party2Skill: '乙方技能',
    party1Hours: '甲方工时',
    party2Hours: '乙方工时',
    durationDays: '有效天数',
    participants: '参与方',
    amount: '金额',
    requiredSignatures: '所需签名数',
    purpose: '用途',
    senderDid: '发送者',
    recipientDid: '接收者',
    unlockDate: '解锁日期',
    unlockTime: '解锁时间',
  };
  return labels[key] || key;
};

const shortenDid = (did) => {
  if (!did) return '';
  return did.length > 20 ? `${did.slice(0, 10)}...${did.slice(-8)}` : did;
};

const formatTime = (timestamp) => {
  const date = new Date(timestamp);
  return date.toLocaleString('zh-CN');
};

const isExpired = (timestamp) => {
  return Date.now() > timestamp;
};

// 加载合约条件
const loadConditions = async () => {
  if (!props.contract) return;

  try {
    loadingConditions.value = true;
    const result = await tradeStore.checkContractConditions(props.contract.id);
    conditions.value = result.conditions || [];
    console.log('[ContractDetail] 条件加载完成:', conditions.value.length);
  } catch (error) {
    console.error('[ContractDetail] 加载合约条件失败:', error);
    antMessage.error(error.message || '加载合约条件失败');
  } finally {
    loadingConditions.value = false;
  }
};

// 加载合约事件
const loadEvents = async () => {
  if (!props.contract) return;

  try {
    loadingEvents.value = true;
    events.value = await tradeStore.loadContractEvents(props.contract.id);
    console.log('[ContractDetail] 事件加载完成:', events.value.length);
  } catch (error) {
    console.error('[ContractDetail] 加载合约事件失败:', error);
    antMessage.error(error.message || '加载合约事件失败');
  } finally {
    loadingEvents.value = false;
  }
};

// 激活合约
const handleActivate = async () => {
  Modal.confirm({
    title: '激活合约',
    content: '确定要激活这个合约吗？激活后合约将开始生效。',
    okText: '确定',
    cancelText: '取消',
    async onOk() {
      try {
        await window.electronAPI.contract.activate(props.contract.id);
        antMessage.success('合约已激活');
        emit('activated');
        emit('update:open', false);
      } catch (error) {
        console.error('激活合约失败:', error);
        antMessage.error('激活合约失败: ' + error.message);
      }
    },
  });
};

// 签名合约
const handleSign = async () => {
  Modal.confirm({
    title: '签名合约',
    content: '确定要签名这个合约吗？',
    okText: '确定',
    cancelText: '取消',
    async onOk() {
      try {
        const signature = `signature_${currentDid.value}_${Date.now()}`;
        await tradeStore.signContract(props.contract.id, signature);

        console.log('[ContractDetail] 合约已签名:', props.contract.id);
        antMessage.success('合约已签名');

        await loadEvents();
      } catch (error) {
        console.error('[ContractDetail] 签名合约失败:', error);
        antMessage.error(error.message || '签名合约失败');
      }
    },
  });
};

// 检查条件
const handleCheckConditions = async () => {
  try {
    const result = await tradeStore.checkContractConditions(props.contract.id);

    console.log('[ContractDetail] 条件检查完成:', result);

    Modal.info({
      title: '合约条件检查',
      content: `所有条件${result.allMet ? '已' : '未'}满足`,
      okText: '确定',
      onOk() {
        loadConditions();
      },
    });
  } catch (error) {
    console.error('[ContractDetail] 检查条件失败:', error);
    antMessage.error(error.message || '检查条件失败');
  }
};

// 执行合约
const handleExecute = async () => {
  Modal.confirm({
    title: '执行合约',
    content: '确定要执行这个合约吗？执行前会检查所有条件是否满足。',
    okText: '确定执行',
    cancelText: '取消',
    async onOk() {
      try {
        await tradeStore.executeContract(props.contract.id);

        console.log('[ContractDetail] 合约执行成功:', props.contract.id);
        antMessage.success('合约执行成功');

        emit('executed');
        emit('update:open', false);
      } catch (error) {
        console.error('[ContractDetail] 执行合约失败:', error);
        antMessage.error(error.message || '执行合约失败');
      }
    },
  });
};

// 取消合约
const handleCancel = async () => {
  Modal.confirm({
    title: '取消合约',
    content: '确定要取消这个合约吗？取消后无法恢复。',
    okText: '确定取消',
    okType: 'danger',
    cancelText: '取消',
    async onOk() {
      try {
        await tradeStore.cancelContract(props.contract.id, '用户取消');

        console.log('[ContractDetail] 合约已取消:', props.contract.id);
        antMessage.success('合约已取消');

        emit('cancelled');
        emit('update:open', false);
      } catch (error) {
        console.error('[ContractDetail] 取消合约失败:', error);
        antMessage.error(error.message || '取消合约失败');
      }
    },
  });
};

// 发起仲裁
const handleInitiateArbitration = async () => {
  Modal.confirm({
    title: '发起仲裁',
    content: '确定要对这个合约发起仲裁吗？',
    okText: '确定',
    cancelText: '取消',
    async onOk() {
      try {
        await tradeStore.initiateArbitration(
          props.contract.id,
          '合约执行出现争议',
          null
        );

        console.log('[ContractDetail] 仲裁已发起:', props.contract.id);
        antMessage.success('仲裁已发起');

        await loadEvents();
      } catch (error) {
        console.error('[ContractDetail] 发起仲裁失败:', error);
        antMessage.error(error.message || '发起仲裁失败');
      }
    },
  });
};

// 关闭对话框
const handleClose = () => {
  emit('update:open', false);
};

// 监听对话框打开
watch(() => props.open, async (newVal) => {
  if (newVal && props.contract) {
    // 获取当前用户 DID
    const identity = await window.electronAPI.did.getCurrentIdentity();
    if (identity) {
      currentDid.value = identity.did;
    }

    await Promise.all([
      loadConditions(),
      loadEvents(),
    ]);
  }
});
</script>

<style scoped>
.contract-detail {
  /* 样式 */
}

.action-buttons {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid #f0f0f0;
}
</style>
