<template>
  <div class="contract-create">
    <a-modal
      :open="open"
      title="创建智能合约"
      width="900px"
      :confirm-loading="creating"
      @ok="handleCreate"
      @cancel="handleCancel"
    >
      <a-steps
        :current="currentStep"
        style="margin-bottom: 24px"
      >
        <a-step title="选择模板" />
        <a-step title="填写参数" />
        <a-step title="确认创建" />
      </a-steps>

      <!-- 步骤 1: 选择模板 -->
      <div v-if="currentStep === 0">
        <a-row :gutter="[16, 16]">
          <a-col
            v-for="template in templates"
            :key="template.id"
            :span="12"
          >
            <a-card
              hoverable
              class="template-card"
              :class="{ 'selected': selectedTemplate?.id === template.id }"
              @click="selectTemplate(template)"
            >
              <template #title>
                <a-space>
                  <component :is="getIcon(template.icon)" />
                  <span>{{ template.name }}</span>
                </a-space>
              </template>
              <div class="template-description">
                {{ template.description }}
              </div>
              <a-tag
                :color="getCategoryColor(template.category)"
                style="margin-top: 8px"
              >
                {{ getCategoryName(template.category) }}
              </a-tag>
            </a-card>
          </a-col>
        </a-row>

        <div style="text-align: right; margin-top: 16px">
          <a-button
            type="primary"
            :disabled="!selectedTemplate"
            @click="nextStep"
          >
            下一步
          </a-button>
        </div>
      </div>

      <!-- 步骤 2: 填写参数 -->
      <div v-if="currentStep === 1 && selectedTemplate">
        <a-alert
          :message="selectedTemplate.name"
          :description="selectedTemplate.description"
          type="info"
          show-icon
          style="margin-bottom: 16px"
        />

        <a-form layout="vertical">
          <!-- 简单买卖合约 -->
          <template v-if="selectedTemplate.id === 'simple_trade'">
            <a-form-item
              label="买家 DID"
              required
            >
              <a-input
                v-model:value="formData.buyerDid"
                placeholder="输入买家 DID"
              />
            </a-form-item>
            <a-form-item
              label="卖家 DID"
              required
            >
              <a-input
                v-model:value="formData.sellerDid"
                placeholder="输入卖家 DID"
              />
            </a-form-item>
            <a-form-item
              label="资产 ID"
              required
            >
              <a-input
                v-model:value="formData.assetId"
                placeholder="输入资产 ID"
              />
            </a-form-item>
            <a-form-item
              label="资产名称"
              required
            >
              <a-input
                v-model:value="formData.assetName"
                placeholder="输入资产名称"
              />
            </a-form-item>
            <a-form-item
              label="数量"
              required
            >
              <a-input-number
                v-model:value="formData.quantity"
                :min="1"
                style="width: 100%"
              />
            </a-form-item>
            <a-form-item
              label="支付资产 ID"
              required
            >
              <a-input
                v-model:value="formData.paymentAssetId"
                placeholder="输入支付资产 ID"
              />
            </a-form-item>
            <a-form-item
              label="支付金额"
              required
            >
              <a-input-number
                v-model:value="formData.paymentAmount"
                :min="0"
                style="width: 100%"
              />
            </a-form-item>
            <a-form-item label="交付天数">
              <a-input-number
                v-model:value="formData.deliveryDays"
                :min="1"
                :max="365"
                style="width: 100%"
              />
            </a-form-item>
          </template>

          <!-- 订阅付费合约 -->
          <template v-if="selectedTemplate.id === 'subscription'">
            <a-form-item
              label="订阅者 DID"
              required
            >
              <a-input
                v-model:value="formData.subscriberDid"
                placeholder="输入订阅者 DID"
              />
            </a-form-item>
            <a-form-item
              label="创作者 DID"
              required
            >
              <a-input
                v-model:value="formData.creatorDid"
                placeholder="输入创作者 DID"
              />
            </a-form-item>
            <a-form-item
              label="服务名称"
              required
            >
              <a-input
                v-model:value="formData.serviceName"
                placeholder="输入服务名称"
              />
            </a-form-item>
            <a-form-item
              label="支付资产 ID"
              required
            >
              <a-input
                v-model:value="formData.paymentAssetId"
                placeholder="输入支付资产 ID"
              />
            </a-form-item>
            <a-form-item
              label="月费"
              required
            >
              <a-input-number
                v-model:value="formData.monthlyPrice"
                :min="0"
                style="width: 100%"
              />
            </a-form-item>
            <a-form-item label="订阅月数">
              <a-input-number
                v-model:value="formData.durationMonths"
                :min="1"
                :max="12"
                style="width: 100%"
              />
            </a-form-item>
            <a-form-item label="自动续订">
              <a-switch v-model:checked="formData.autoRenew" />
            </a-form-item>
          </template>

          <!-- 任务悬赏合约 -->
          <template v-if="selectedTemplate.id === 'bounty'">
            <a-form-item
              label="发布者 DID"
              required
            >
              <a-input
                v-model:value="formData.publisherDid"
                placeholder="输入发布者 DID"
              />
            </a-form-item>
            <a-form-item
              label="任务标题"
              required
            >
              <a-input
                v-model:value="formData.taskTitle"
                placeholder="输入任务标题"
              />
            </a-form-item>
            <a-form-item
              label="任务描述"
              required
            >
              <a-textarea
                v-model:value="formData.taskDescription"
                :rows="4"
                placeholder="详细描述任务要求..."
              />
            </a-form-item>
            <a-form-item
              label="支付资产 ID"
              required
            >
              <a-input
                v-model:value="formData.paymentAssetId"
                placeholder="输入支付资产 ID"
              />
            </a-form-item>
            <a-form-item
              label="赏金金额"
              required
            >
              <a-input-number
                v-model:value="formData.rewardAmount"
                :min="0"
                style="width: 100%"
              />
            </a-form-item>
            <a-form-item label="截止天数">
              <a-input-number
                v-model:value="formData.deadlineDays"
                :min="1"
                :max="365"
                style="width: 100%"
              />
            </a-form-item>
            <a-form-item label="所需批准数">
              <a-input-number
                v-model:value="formData.requiredApprovals"
                :min="1"
                :max="10"
                style="width: 100%"
              />
            </a-form-item>
          </template>

          <!-- 技能交换合约 -->
          <template v-if="selectedTemplate.id === 'skill_exchange'">
            <a-form-item
              label="甲方 DID"
              required
            >
              <a-input
                v-model:value="formData.party1Did"
                placeholder="输入甲方 DID"
              />
            </a-form-item>
            <a-form-item
              label="甲方技能"
              required
            >
              <a-input
                v-model:value="formData.party1Skill"
                placeholder="输入甲方提供的技能"
              />
            </a-form-item>
            <a-form-item
              label="甲方工时"
              required
            >
              <a-input-number
                v-model:value="formData.party1Hours"
                :min="1"
                style="width: 100%"
              />
            </a-form-item>
            <a-form-item
              label="乙方 DID"
              required
            >
              <a-input
                v-model:value="formData.party2Did"
                placeholder="输入乙方 DID"
              />
            </a-form-item>
            <a-form-item
              label="乙方技能"
              required
            >
              <a-input
                v-model:value="formData.party2Skill"
                placeholder="输入乙方提供的技能"
              />
            </a-form-item>
            <a-form-item
              label="乙方工时"
              required
            >
              <a-input-number
                v-model:value="formData.party2Hours"
                :min="1"
                style="width: 100%"
              />
            </a-form-item>
            <a-form-item label="有效天数">
              <a-input-number
                v-model:value="formData.durationDays"
                :min="1"
                :max="365"
                style="width: 100%"
              />
            </a-form-item>
          </template>

          <!-- 多重签名托管 -->
          <template v-if="selectedTemplate.id === 'multisig_escrow'">
            <a-form-item
              label="参与方 DIDs（每行一个）"
              required
            >
              <a-textarea
                v-model:value="participantsText"
                :rows="4"
                placeholder="输入参与方 DID，每行一个"
              />
            </a-form-item>
            <a-form-item
              label="资产 ID"
              required
            >
              <a-input
                v-model:value="formData.assetId"
                placeholder="输入资产 ID"
              />
            </a-form-item>
            <a-form-item
              label="金额"
              required
            >
              <a-input-number
                v-model:value="formData.amount"
                :min="0"
                style="width: 100%"
              />
            </a-form-item>
            <a-form-item
              label="所需签名数"
              required
            >
              <a-input-number
                v-model:value="formData.requiredSignatures"
                :min="2"
                style="width: 100%"
              />
            </a-form-item>
            <a-form-item
              label="用途说明"
              required
            >
              <a-input
                v-model:value="formData.purpose"
                placeholder="说明托管用途"
              />
            </a-form-item>
            <a-form-item label="有效天数">
              <a-input-number
                v-model:value="formData.durationDays"
                :min="1"
                :max="365"
                style="width: 100%"
              />
            </a-form-item>
          </template>

          <!-- 时间锁托管 -->
          <template v-if="selectedTemplate.id === 'timelock_escrow'">
            <a-form-item
              label="发送者 DID"
              required
            >
              <a-input
                v-model:value="formData.senderDid"
                placeholder="输入发送者 DID"
              />
            </a-form-item>
            <a-form-item
              label="接收者 DID"
              required
            >
              <a-input
                v-model:value="formData.recipientDid"
                placeholder="输入接收者 DID"
              />
            </a-form-item>
            <a-form-item
              label="资产 ID"
              required
            >
              <a-input
                v-model:value="formData.assetId"
                placeholder="输入资产 ID"
              />
            </a-form-item>
            <a-form-item
              label="金额"
              required
            >
              <a-input-number
                v-model:value="formData.amount"
                :min="0"
                style="width: 100%"
              />
            </a-form-item>
            <a-form-item
              label="解锁日期"
              required
            >
              <a-date-picker
                v-model:value="unlockDate"
                show-time
                format="YYYY-MM-DD HH:mm:ss"
                style="width: 100%"
                :disabled-date="disabledDate"
              />
            </a-form-item>
            <a-form-item
              label="用途说明"
              required
            >
              <a-input
                v-model:value="formData.purpose"
                placeholder="说明托管用途"
              />
            </a-form-item>
          </template>

          <!-- 区块链部署选项 -->
          <a-divider />
          <a-form-item>
            <template #label>
              <span>
                <rocket-outlined /> 部署到区块链
                <a-tooltip title="将合约部署为链上智能合约（需要先实现对应的 Solidity 合约）">
                  <question-circle-outlined style="margin-left: 4px; color: #8c8c8c" />
                </a-tooltip>
              </span>
            </template>
            <a-switch v-model:checked="formData.onChain">
              <template #checkedChildren>
                启用
              </template>
              <template #unCheckedChildren>
                禁用
              </template>
            </a-switch>
          </a-form-item>

          <!-- 链上部署配置（仅当启用时显示） -->
          <template v-if="formData.onChain">
            <a-alert
              message="链上部署"
              description="合约将部署到区块链网络。当前使用 ERC-20 作为占位合约，生产环境需要部署实际的托管/订阅/悬赏合约。"
              type="warning"
              show-icon
              :style="{ marginBottom: '16px' }"
            />

            <a-form-item
              label="选择钱包"
              required
            >
              <wallet-selector
                v-model="formData.walletId"
                :show-balance="true"
                :chain-id="formData.chainId"
                :show-quick-actions="true"
              />
            </a-form-item>

            <a-form-item
              label="选择网络"
              required
            >
              <chain-selector
                v-model="formData.chainId"
                :width="'100%'"
                :show-quick-info="true"
              />
            </a-form-item>

            <a-form-item
              label="钱包密码"
              required
            >
              <a-input-password
                v-model:value="formData.password"
                placeholder="用于签名交易的钱包密码"
                autocomplete="new-password"
              >
                <template #prefix>
                  <lock-outlined />
                </template>
              </a-input-password>
              <template #extra>
                此密码用于解密私钥并签名部署交易
              </template>
            </a-form-item>

            <!-- Gas 估算 -->
            <a-form-item
              v-if="estimatedGas"
              label="预估 Gas"
            >
              <a-statistic
                :value="estimatedGas"
                suffix="Gas"
                :value-style="{ fontSize: '14px' }"
              />
              <template #extra>
                <span class="gas-info">
                  预估费用: {{ formatGasFee(estimatedGas) }}
                  <a-button
                    type="link"
                    size="small"
                    @click="fetchGasEstimate"
                  >
                    刷新估算
                  </a-button>
                </span>
              </template>
            </a-form-item>
          </template>
        </a-form>

        <div style="text-align: right; margin-top: 16px">
          <a-space>
            <a-button @click="prevStep">
              上一步
            </a-button>
            <a-button
              type="primary"
              @click="nextStep"
            >
              下一步
            </a-button>
          </a-space>
        </div>
      </div>

      <!-- 步骤 3: 确认创建 -->
      <div v-if="currentStep === 2 && selectedTemplate">
        <a-alert
          message="请确认合约信息"
          description="确认无误后，点击创建按钮即可生成智能合约"
          type="warning"
          show-icon
          style="margin-bottom: 16px"
        />

        <a-descriptions
          :column="2"
          bordered
        >
          <a-descriptions-item
            label="合约模板"
            :span="2"
          >
            <a-tag :color="getCategoryColor(selectedTemplate.category)">
              {{ selectedTemplate.name }}
            </a-tag>
          </a-descriptions-item>
          <a-descriptions-item
            v-for="(value, key) in formData"
            :key="key"
            :label="getFieldLabel(key)"
          >
            <template v-if="typeof value === 'boolean'">
              {{ value ? '是' : '否' }}
            </template>
            <template v-else>
              {{ value }}
            </template>
          </a-descriptions-item>
        </a-descriptions>

        <div style="text-align: right; margin-top: 16px">
          <a-space>
            <a-button @click="prevStep">
              上一步
            </a-button>
            <a-button
              type="primary"
              @click="handleCreate"
            >
              创建合约
            </a-button>
          </a-space>
        </div>
      </div>
    </a-modal>
  </div>
</template>

<script setup>
import { logger, createLogger } from '@/utils/logger';

import { ref, reactive, computed, watch } from 'vue';
import { message as antMessage } from 'ant-design-vue';
import dayjs from 'dayjs';
import {
  ShoppingOutlined,
  CalendarOutlined,
  TrophyOutlined,
  SwapOutlined,
  SafetyOutlined,
  ClockCircleOutlined,
  RocketOutlined,
  QuestionCircleOutlined,
  LockOutlined,
} from '@ant-design/icons-vue';
import { useTradeStore } from '../../stores/trade';
import { useBlockchainStore } from '../../stores/blockchain';
import DIDSelector from './common/DIDSelector.vue';
import PriceInput from './common/PriceInput.vue';
import WalletSelector from '../blockchain/WalletSelector.vue';
import ChainSelector from '../blockchain/ChainSelector.vue';

// Store
const tradeStore = useTradeStore();
const blockchainStore = useBlockchainStore();

// Props
const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
});

// Emits
const emit = defineEmits(['created', 'cancel', 'update:open']);

// 状态
const currentStep = ref(0);
const selectedTemplate = ref(null);
const formData = reactive({
  // 区块链部署选项（初始值）
  onChain: false,
  walletId: '',
  chainId: 31337,
  password: '',
});
const participantsText = ref('');
const unlockDate = ref(null);
const estimatedGas = ref(null);

// 从 store 获取数据
const creating = computed(() => tradeStore.contract.creating);
const templates = computed(() => tradeStore.contract.templates);

// 加载模板
const loadTemplates = async () => {
  try {
    await tradeStore.loadContractTemplates();
  } catch (error) {
    logger.error('[ContractCreate] 加载合约模板失败:', error);
    antMessage.error(error.message || '加载合约模板失败');
  }
};

// 选择模板
const selectTemplate = (template) => {
  selectedTemplate.value = template;
  resetFormData();
};

// 重置表单数据
const resetFormData = () => {
  // 保留链上部署选项
  const blockchainOptions = {
    onChain: formData.onChain || false,
    walletId: formData.walletId || '',
    chainId: formData.chainId || 31337,
    password: formData.password || '',
  };

  // 清空所有字段
  Object.keys(formData).forEach(key => delete formData[key]);

  // 恢复链上部署选项
  Object.assign(formData, blockchainOptions);

  // 根据模板设置默认值
  if (selectedTemplate.value) {
    const template = selectedTemplate.value;

    // 通用默认值
    if (template.id === 'simple_trade') {
      formData.quantity = 1;
      formData.deliveryDays = 7;
    } else if (template.id === 'subscription') {
      formData.durationMonths = 1;
      formData.autoRenew = false;
    } else if (template.id === 'bounty') {
      formData.deadlineDays = 30;
      formData.requiredApprovals = 1;
    } else if (template.id === 'skill_exchange') {
      formData.party1Hours = 1;
      formData.party2Hours = 1;
      formData.durationDays = 30;
    } else if (template.id === 'multisig_escrow') {
      formData.requiredSignatures = 2;
      formData.durationDays = 30;
      participantsText.value = '';
    } else if (template.id === 'timelock_escrow') {
      unlockDate.value = null;
    }
  }
};

// 格式化 Gas 费用
const formatGasFee = (gas) => {
  if (!gas || !blockchainStore.gasPrice) {return '-';}

  const gasPriceWei = blockchainStore.gasPrice.gasPrice || '1000000000';
  const totalWei = BigInt(gas) * BigInt(gasPriceWei);
  const etherValue = Number(totalWei) / 1e18;

  const network = blockchainStore.currentNetwork;
  const symbol = network?.symbol || 'ETH';

  return `~${etherValue.toFixed(6)} ${symbol}`;
};

// 获取 Gas 估算
const fetchGasEstimate = async () => {
  try {
    // 合约部署 Gas 估算（简化版本）
    estimatedGas.value = 1000000; // 合约部署约 100 万 gas

    antMessage.success('Gas 估算已更新');
  } catch (error) {
    logger.error('[ContractCreate] Gas 估算失败:', error);
    antMessage.error('Gas 估算失败');
  }
};

// 下一步
const nextStep = () => {
  if (currentStep.value < 2) {
    currentStep.value++;
  }
};

// 上一步
const prevStep = () => {
  if (currentStep.value > 0) {
    currentStep.value--;
  }
};

// 创建合约
const handleCreate = async () => {
  try {
    // 验证链上部署选项
    if (formData.onChain) {
      if (!formData.walletId) {
        antMessage.warning('请选择钱包');
        return;
      }
      if (!formData.chainId) {
        antMessage.warning('请选择网络');
        return;
      }
      if (!formData.password || formData.password.length < 8) {
        antMessage.warning('请输入钱包密码（至少8位）');
        return;
      }
    }

    // 准备参数
    const params = { ...formData };

    // 特殊处理
    if (selectedTemplate.value.id === 'multisig_escrow') {
      // 解析参与方列表
      params.participants = participantsText.value
        .split('\n')
        .map(did => did.trim())
        .filter(did => did.length > 0);

      if (params.participants.length < 2) {
        antMessage.warning('至少需要 2 个参与方');
        return;
      }
    } else if (selectedTemplate.value.id === 'timelock_escrow') {
      // 转换解锁日期
      if (!unlockDate.value) {
        antMessage.warning('请选择解锁日期');
        return;
      }
      params.unlockDate = unlockDate.value.format('YYYY-MM-DD HH:mm:ss');
    }

    // 使用 store 创建合约
    const contract = await tradeStore.createContractFromTemplate(
      selectedTemplate.value.id,
      params
    );

    logger.info('[ContractCreate] 合约创建成功:', contract.id);

    if (formData.onChain) {
      antMessage.success('合约创建成功，正在部署到区块链...');
      // 注意：部署是异步的，成功/失败会通过事件通知
    } else {
      antMessage.success('合约创建成功！');
    }

    // 通知父组件
    emit('created', contract);

    // 关闭对话框
    emit('update:open', false);

    // 重置
    reset();
  } catch (error) {
    logger.error('[ContractCreate] 创建合约失败:', error);
    antMessage.error(error.message || '创建合约失败');
  }
};

// 取消
const handleCancel = () => {
  emit('cancel');
  emit('update:open', false);
  reset();
};

// 重置
const reset = () => {
  currentStep.value = 0;
  selectedTemplate.value = null;
  resetFormData();
  participantsText.value = '';
  unlockDate.value = null;
};

// 工具函数
const getIcon = (iconName) => {
  const icons = {
    shopping: ShoppingOutlined,
    calendar: CalendarOutlined,
    trophy: TrophyOutlined,
    swap: SwapOutlined,
    safety: SafetyOutlined,
    clock: ClockCircleOutlined,
  };
  return icons[iconName] || ShoppingOutlined;
};

const getCategoryColor = (category) => {
  const colors = {
    trade: 'blue',
    subscription: 'purple',
    bounty: 'orange',
    exchange: 'green',
    escrow: 'cyan',
  };
  return colors[category] || 'default';
};

const getCategoryName = (category) => {
  const names = {
    trade: '交易',
    subscription: '订阅',
    bounty: '悬赏',
    exchange: '交换',
    escrow: '托管',
  };
  return names[category] || category;
};

const getFieldLabel = (key) => {
  const labels = {
    buyerDid: '买家',
    sellerDid: '卖家',
    assetId: '资产 ID',
    assetName: '资产名称',
    quantity: '数量',
    paymentAssetId: '支付资产',
    paymentAmount: '支付金额',
    deliveryDays: '交付天数',
    subscriberDid: '订阅者',
    creatorDid: '创作者',
    serviceName: '服务名称',
    monthlyPrice: '月费',
    durationMonths: '订阅月数',
    autoRenew: '自动续订',
    publisherDid: '发布者',
    taskTitle: '任务标题',
    taskDescription: '任务描述',
    rewardAmount: '赏金',
    deadlineDays: '截止天数',
    requiredApprovals: '所需批准数',
    party1Did: '甲方',
    party1Skill: '甲方技能',
    party1Hours: '甲方工时',
    party2Did: '乙方',
    party2Skill: '乙方技能',
    party2Hours: '乙方工时',
    durationDays: '有效天数',
    amount: '金额',
    requiredSignatures: '所需签名数',
    purpose: '用途',
    senderDid: '发送者',
    recipientDid: '接收者',
  };
  return labels[key] || key;
};

const disabledDate = (current) => {
  // 禁用过去的日期
  return current && current < dayjs().startOf('day');
};

// 监听对话框打开
watch(() => props.open, (newVal) => {
  if (newVal) {
    loadTemplates();
    reset();
  }
});

// 监听链上部署开关
watch(() => formData.onChain, (enabled) => {
  if (enabled) {
    // 自动选择当前钱包和链
    if (blockchainStore.currentWallet) {
      formData.walletId = blockchainStore.currentWallet.id;
    }
    formData.chainId = blockchainStore.currentChainId;

    // 获取 Gas 估算
    fetchGasEstimate();

    // 获取 Gas 价格
    if (!blockchainStore.gasPrice) {
      blockchainStore.fetchGasPrice();
    }
  } else {
    // 禁用时清空相关字段
    estimatedGas.value = null;
  }
});
</script>

<style scoped>
.contract-create {
  /* 样式 */
}

.gas-info {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #595959;
}

.template-card {
  height: 100%;
  cursor: pointer;
  transition: all 0.3s;
}

.template-card:hover {
  border-color: #1890ff;
  box-shadow: 0 2px 8px rgba(24, 144, 255, 0.2);
}

.template-card.selected {
  border-color: #1890ff;
  background-color: #e6f7ff;
}

.template-description {
  font-size: 14px;
  color: #666;
  min-height: 60px;
}
</style>
