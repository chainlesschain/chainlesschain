<template>
  <div class="contract-list-container">
    <a-card>
      <template #title>
        <a-space>
          <file-protect-outlined />
          <span>智能合约</span>
        </a-space>
      </template>
      <template #extra>
        <a-space>
          <a-button
            type="primary"
            @click="showCreateModal = true"
          >
            <template #icon>
              <plus-outlined />
            </template>
            创建合约
          </a-button>
          <a-button @click="loadContracts">
            <template #icon>
              <reload-outlined />
            </template>
            刷新
          </a-button>
        </a-space>
      </template>

      <!-- 筛选器 -->
      <a-space
        style="margin-bottom: 16px"
        wrap
      >
        <span>合约状态:</span>
        <a-radio-group
          v-model:value="filterStatus"
          button-style="solid"
          @change="handleFilterChange"
        >
          <a-radio-button value="">
            全部
          </a-radio-button>
          <a-radio-button value="draft">
            草稿
          </a-radio-button>
          <a-radio-button value="active">
            激活
          </a-radio-button>
          <a-radio-button value="executing">
            执行中
          </a-radio-button>
          <a-radio-button value="completed">
            已完成
          </a-radio-button>
          <a-radio-button value="cancelled">
            已取消
          </a-radio-button>
          <a-radio-button value="disputed">
            有争议
          </a-radio-button>
        </a-radio-group>

        <span style="margin-left: 16px">合约类型:</span>
        <a-select
          v-model:value="filterType"
          style="width: 180px"
          @change="handleFilterChange"
        >
          <a-select-option value="">
            全部类型
          </a-select-option>
          <a-select-option value="simple_trade">
            简单买卖
          </a-select-option>
          <a-select-option value="subscription">
            订阅付费
          </a-select-option>
          <a-select-option value="bounty">
            任务悬赏
          </a-select-option>
          <a-select-option value="skill_exchange">
            技能交换
          </a-select-option>
          <a-select-option value="custom">
            自定义
          </a-select-option>
        </a-select>
      </a-space>

      <!-- 合约列表 -->
      <a-spin :spinning="loading">
        <a-row :gutter="[16, 16]">
          <a-col
            v-for="contract in filteredContracts"
            :key="contract.id"
            :xs="24"
            :sm="12"
            :md="12"
            :lg="8"
            :xl="8"
          >
            <contract-card
              :contract="contract"
              :current-user-did="currentDid"
              @view="handleViewContract"
              @sign="handleSign"
              @execute="handleExecute"
              @cancel="handleCancel"
            />
          </a-col>
        </a-row>

        <!-- 空状态 -->
        <a-empty
          v-if="!loading && filteredContracts.length === 0"
          description="暂无合约"
        >
          <a-button
            type="primary"
            @click="showCreateModal = true"
          >
            创建第一个合约
          </a-button>
        </a-empty>
      </a-spin>
    </a-card>

    <!-- 创建合约对话框 -->
    <contract-create
      v-model:open="showCreateModal"
      @created="handleContractCreated"
    />

    <!-- 合约详情对话框 -->
    <contract-detail
      v-model:open="showDetailModal"
      :contract="selectedContract"
      @activated="handleContractUpdated"
      @executed="handleContractUpdated"
      @cancelled="handleContractUpdated"
    />

    <!-- 合约签名对话框 -->
    <contract-sign
      v-model:open="showSignModal"
      :contract="selectedContract"
      @signed="handleContractUpdated"
    />

    <!-- 合约执行对话框 -->
    <contract-execute
      v-model:open="showExecuteModal"
      :contract="selectedContract"
      @executed="handleContractUpdated"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { message as antMessage, Modal } from 'ant-design-vue';
import {
  FileProtectOutlined,
  PlusOutlined,
  ReloadOutlined,
  EyeOutlined,
  EllipsisOutlined,
  CheckCircleOutlined,
  EditOutlined,
  CheckSquareOutlined,
  PlayCircleOutlined,
  CloseCircleOutlined,
  WarningOutlined,
  UserOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons-vue';
import { useTradeStore } from '../../stores/trade';
import ContractCard from './common/ContractCard.vue';
import ContractCreate from './ContractCreate.vue';
import ContractDetail from './ContractDetail.vue';
import ContractSign from './ContractSign.vue';
import ContractExecute from './ContractExecute.vue';

// Store
const tradeStore = useTradeStore();

// 状态
const filterStatus = ref('');
const filterType = ref('');
const currentDid = ref('');
const showCreateModal = ref(false);
const showDetailModal = ref(false);
const showSignModal = ref(false);
const showExecuteModal = ref(false);
const selectedContract = ref(null);

// 从 store 获取数据
const loading = computed(() => tradeStore.contract.loading);
const contracts = computed(() => tradeStore.contract.contracts);

// 筛选后的合约
const filteredContracts = computed(() => {
  let result = contracts.value;

  // 状态筛选
  if (filterStatus.value) {
    result = result.filter(c => c.status === filterStatus.value);
  }

  // 类型筛选
  if (filterType.value) {
    result = result.filter(c => c.contract_type === filterType.value);
  }

  return result;
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

const formatTime = (timestamp) => {
  const date = new Date(timestamp);
  return date.toLocaleString('zh-CN');
};

const isParty = (contract) => {
  return contract.parties.includes(currentDid.value);
};

const canOperate = (contract) => {
  return isParty(contract);
};

// 加载合约列表
const loadContracts = async () => {
  try {
    // 获取当前用户 DID
    if (!currentDid.value) {
      const identity = await window.electronAPI.did.getCurrentIdentity();
      if (identity) {
        currentDid.value = identity.did;
      }
    }

    // 使用 store 加载合约
    await tradeStore.loadContracts({});
    console.log('[ContractList] 合约列表已加载:', contracts.value.length);
  } catch (error) {
    console.error('[ContractList] 加载合约列表失败:', error);
    antMessage.error('加载合约列表失败: ' + error.message);
  }
};

// 筛选变化
const handleFilterChange = () => {
  // computed 自动处理
};

// 合约创建成功
const handleContractCreated = () => {
  loadContracts();
};

// 合约更新
const handleContractUpdated = () => {
  loadContracts();
};

// 查看合约详情
const handleViewContract = (contract) => {
  selectedContract.value = contract;
  showDetailModal.value = true;
};

// 激活合约
const handleActivate = (contract) => {
  Modal.confirm({
    title: '激活合约',
    content: '确定要激活这个合约吗？激活后合约将开始生效。',
    okText: '确定',
    cancelText: '取消',
    async onOk() {
      try {
        await window.electronAPI.contract.activate(contract.id);
        antMessage.success('合约已激活');
        loadContracts();
      } catch (error) {
        console.error('激活合约失败:', error);
        antMessage.error('激活合约失败: ' + error.message);
      }
    },
  });
};

// 签名合约
const handleSign = (contract) => {
  selectedContract.value = contract;
  showSignModal.value = true;
};

// 检查条件
const handleCheckConditions = async (contract) => {
  try {
    const result = await window.electronAPI.contract.checkConditions(contract.id);

    const content = result.conditions.map(c => ({
      type: c.type,
      met: c.met,
      required: c.required,
    }));

    Modal.info({
      title: '合约条件检查',
      content: `所有条件${result.allMet ? '已' : '未'}满足\n\n${content.map(c => `- ${c.type}: ${c.met ? '✅' : '❌'} ${c.required ? '(必需)' : ''}`).join('\n')}`,
      okText: '确定',
    });
  } catch (error) {
    console.error('检查条件失败:', error);
    antMessage.error('检查条件失败: ' + error.message);
  }
};

// 执行合约
const handleExecute = (contract) => {
  selectedContract.value = contract;
  showExecuteModal.value = true;
};

// 取消合约
const handleCancel = (contract) => {
  Modal.confirm({
    title: '取消合约',
    content: '确定要取消这个合约吗？取消后无法恢复。',
    okText: '确定取消',
    okType: 'danger',
    cancelText: '取消',
    async onOk() {
      try {
        // 使用 store 取消合约
        await tradeStore.cancelContract(contract.id, '用户取消');

        console.log('[ContractList] 合约已取消:', contract.id);
        antMessage.success('合约已取消');
        await loadContracts();
      } catch (error) {
        console.error('[ContractList] 取消合约失败:', error);
        antMessage.error(error.message || '取消合约失败');
      }
    },
  });
};

// 发起仲裁
const handleInitiateArbitration = (contract) => {
  Modal.confirm({
    title: '发起仲裁',
    content: '确定要对这个合约发起仲裁吗？',
    okText: '确定',
    cancelText: '取消',
    async onOk() {
      try {
        await window.electronAPI.contract.initiateArbitration(
          contract.id,
          '合约执行出现争议',
          null
        );
        antMessage.success('仲裁已发起');
        loadContracts();
      } catch (error) {
        console.error('发起仲裁失败:', error);
        antMessage.error('发起仲裁失败: ' + error.message);
      }
    },
  });
};

// 生命周期
onMounted(async () => {
  await loadContracts();
});
</script>

<style scoped>
.contract-list-container {
  padding: 20px;
}

.contract-card {
  height: 100%;
  position: relative;
  cursor: pointer;
}

.contract-title {
  font-size: 16px;
  font-weight: bold;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-bottom: 8px;
}

.contract-info {
  margin-top: 8px;
}

.contract-type {
  margin-bottom: 8px;
}

.contract-description {
  font-size: 12px;
  color: #999;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  margin-bottom: 8px;
}

.contract-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  color: #999;
  padding-top: 8px;
  border-top: 1px solid #f0f0f0;
}

.contract-parties {
  display: flex;
  align-items: center;
  gap: 4px;
}

.contract-time {
  font-size: 11px;
}

.contract-expires {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #faad14;
  margin-top: 4px;
}
</style>
