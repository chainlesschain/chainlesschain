<template>
  <div class="trading-hub">
    <a-card
      :bordered="false"
      class="trading-hub-card"
    >
      <template #title>
        <a-space>
          <shop-outlined style="font-size: 20px" />
          <span class="page-title">交易中心</span>
        </a-space>
      </template>

      <template #extra>
        <a-space :size="16">
          <!-- 信用评分快捷入口 -->
          <a-tooltip title="我的信用评分">
            <a-badge
              :count="creditScore"
              show-zero
              :number-style="{ backgroundColor: creditLevelColor, fontWeight: 'bold' }"
              :overflow-count="1000"
            >
              <trophy-outlined
                class="credit-icon"
                :style="{ fontSize: '20px', cursor: 'pointer', color: creditLevelColor }"
                @click="handleViewCredit"
              />
            </a-badge>
          </a-tooltip>

          <!-- DID选择器 -->
          <a-select
            v-model:value="selectedDid"
            placeholder="选择DID身份"
            style="width: 200px"
            :loading="loadingDids"
            @change="handleDidChange"
          >
            <a-select-option
              v-for="did in availableDids"
              :key="did.did"
              :value="did.did"
            >
              <a-space>
                <user-outlined />
                <span>{{ did.profile?.name || did.did.slice(0, 12) + '...' }}</span>
              </a-space>
            </a-select-option>
          </a-select>

          <!-- 刷新按钮 -->
          <a-tooltip title="刷新当前Tab数据">
            <a-button
              type="text"
              :loading="isLoading"
              @click="handleRefresh"
            >
              <template #icon>
                <reload-outlined />
              </template>
            </a-button>
          </a-tooltip>
        </a-space>
      </template>

      <!-- 8个功能Tab -->
      <a-tabs
        v-model:active-key="activeTab"
        type="card"
        size="large"
        @change="handleTabChange"
      >
        <!-- 1. 我的资产 -->
        <a-tab-pane key="assets">
          <template #tab>
            <span class="tab-label">
              <wallet-outlined />
              我的资产
            </span>
          </template>
          <AssetList
            v-if="selectedDid"
            :owner-did="selectedDid"
          />
          <a-empty
            v-else
            description="请先选择DID身份"
          />
        </a-tab-pane>

        <!-- 2. 交易市场 -->
        <a-tab-pane key="marketplace">
          <template #tab>
            <span class="tab-label">
              <shop-outlined />
              交易市场
            </span>
          </template>
          <Marketplace />
        </a-tab-pane>

        <!-- 3. 托管管理 -->
        <a-tab-pane key="escrow">
          <template #tab>
            <span class="tab-label">
              <safety-outlined />
              托管管理
            </span>
          </template>
          <EscrowList v-if="selectedDid" />
          <a-empty
            v-else
            description="请先选择DID身份"
          />
        </a-tab-pane>

        <!-- 4. 智能合约 -->
        <a-tab-pane key="contracts">
          <template #tab>
            <span class="tab-label">
              <audit-outlined />
              智能合约
            </span>
          </template>
          <ContractList v-if="selectedDid" />
          <a-empty
            v-else
            description="请先选择DID身份"
          />
        </a-tab-pane>

        <!-- 5. 信用评分 -->
        <a-tab-pane key="credit">
          <template #tab>
            <span class="tab-label">
              <trophy-outlined />
              信用评分
            </span>
          </template>
          <CreditScore
            v-if="selectedDid"
            :user-did="selectedDid"
          />
          <a-empty
            v-else
            description="请先选择DID身份"
          />
        </a-tab-pane>

        <!-- 6. 评价管理 -->
        <a-tab-pane key="reviews">
          <template #tab>
            <span class="tab-label">
              <star-outlined />
              评价管理
            </span>
          </template>
          <ReviewList v-if="selectedDid" />
          <a-empty
            v-else
            description="请先选择DID身份"
          />
        </a-tab-pane>

        <!-- 7. 知识付费 -->
        <a-tab-pane key="knowledge">
          <template #tab>
            <span class="tab-label">
              <read-outlined />
              知识付费
            </span>
          </template>
          <ContentStore />
        </a-tab-pane>

        <!-- 8. 交易记录 -->
        <a-tab-pane key="transactions">
          <template #tab>
            <span class="tab-label">
              <history-outlined />
              交易记录
            </span>
          </template>
          <TransactionList v-if="selectedDid" />
          <a-empty
            v-else
            description="请先选择DID身份"
          />
        </a-tab-pane>

        <!-- 9. 统计面板 -->
        <a-tab-pane key="statistics">
          <template #tab>
            <span class="tab-label">
              <bar-chart-outlined />
              统计面板
            </span>
          </template>
          <a-row :gutter="[16, 16]">
            <a-col :span="24">
              <TransactionStatistics />
            </a-col>
            <a-col :span="24">
              <AssetStatistics />
            </a-col>
          </a-row>
        </a-tab-pane>
      </a-tabs>
    </a-card>
  </div>
</template>

<script setup>
import { logger, createLogger } from '@/utils/logger';

import { ref, computed, onMounted, watch } from 'vue';
import { message } from 'ant-design-vue';
import { useTradeStore } from '../stores/trade';
import {
  ShopOutlined,
  WalletOutlined,
  SafetyOutlined,
  AuditOutlined,
  TrophyOutlined,
  StarOutlined,
  ReadOutlined,
  HistoryOutlined,
  ReloadOutlined,
  UserOutlined,
  BarChartOutlined,
} from '@ant-design/icons-vue';

// 导入子组件（部分组件尚未创建，使用动态导入处理）
import { defineAsyncComponent } from 'vue';

const AssetList = defineAsyncComponent({
  loader: () => import('../components/trade/AssetList.vue'),
  loadingComponent: { template: '<a-spin />' },
  errorComponent: {
    template: '<a-result status="error" title="组件加载失败" />',
  },
});

const Marketplace = defineAsyncComponent({
  loader: () => import('../components/trade/Marketplace.vue'),
  loadingComponent: { template: '<a-spin />' },
  errorComponent: {
    template: '<a-result status="warning" title="市场组件加载失败" sub-title="请刷新页面重试" />',
  },
});

const EscrowList = defineAsyncComponent({
  loader: () => import('../components/trade/EscrowList.vue'),
  loadingComponent: { template: '<a-spin />' },
  errorComponent: {
    template: '<a-result status="warning" title="托管组件加载失败" sub-title="请刷新页面重试" />',
  },
});

const ContractList = defineAsyncComponent({
  loader: () => import('../components/trade/ContractList.vue'),
  loadingComponent: { template: '<a-spin />' },
  errorComponent: {
    template: '<a-result status="warning" title="合约组件加载失败" sub-title="请刷新页面重试" />',
  },
});

const CreditScore = defineAsyncComponent({
  loader: () => import('../components/trade/CreditScore.vue'),
  loadingComponent: { template: '<a-spin />' },
  errorComponent: {
    template: '<a-result status="warning" title="信用组件加载失败" sub-title="请刷新页面重试" />',
  },
});

const ReviewList = defineAsyncComponent({
  loader: () => import('../components/trade/ReviewList.vue'),
  loadingComponent: { template: '<a-spin />' },
  errorComponent: {
    template: '<a-result status="warning" title="评价组件加载失败" sub-title="请刷新页面重试" />',
  },
});

const ContentStore = defineAsyncComponent({
  loader: () => import('../components/knowledge/ContentStore.vue'),
  loadingComponent: { template: '<a-spin />' },
  errorComponent: {
    template: '<a-result status="warning" title="知识付费组件加载失败" sub-title="请刷新页面重试" />',
  },
});

const TransactionList = defineAsyncComponent({
  loader: () => import('../components/trade/TransactionList.vue'),
  loadingComponent: { template: '<a-spin />' },
  errorComponent: {
    template: '<a-result status="warning" title="交易记录组件加载失败" sub-title="请刷新页面重试" />',
  },
});

const TransactionStatistics = defineAsyncComponent({
  loader: () => import('../components/trade/TransactionStatistics.vue'),
  loadingComponent: { template: '<a-spin />' },
  errorComponent: {
    template: '<a-result status="warning" title="交易统计组件加载失败" sub-title="请刷新页面重试" />',
  },
});

const AssetStatistics = defineAsyncComponent({
  loader: () => import('../components/trade/AssetStatistics.vue'),
  loadingComponent: { template: '<a-spin />' },
  errorComponent: {
    template: '<a-result status="warning" title="资产统计组件加载失败" sub-title="请刷新页面重试" />',
  },
});

// Store
const tradeStore = useTradeStore();

// 状态
const availableDids = ref([]);
const loadingDids = ref(false);

// 计算属性 - 绑定到store
const activeTab = computed({
  get: () => tradeStore.ui.activeTab,
  set: (value) => tradeStore.setActiveTab(value),
});

const selectedDid = computed({
  get: () => tradeStore.ui.selectedDid,
  set: (value) => tradeStore.setSelectedDid(value),
});

const creditScore = computed(() => tradeStore.creditScore || 0);

const creditLevelColor = computed(() => tradeStore.creditLevelColor);

const isLoading = computed(() => {
  const tab = activeTab.value;
  switch (tab) {
    case 'assets':
      return tradeStore.asset.loading;
    case 'marketplace':
      return tradeStore.marketplace.loading;
    case 'escrow':
      return tradeStore.escrow.loading;
    case 'contracts':
      return tradeStore.contract.loading;
    case 'credit':
      return tradeStore.credit.loading;
    case 'reviews':
      return tradeStore.review.loading;
    case 'knowledge':
      return tradeStore.knowledge.loading;
    default:
      return false;
  }
});

// 方法

/**
 * 加载可用的DID列表
 */
const loadAvailableDids = async () => {
  loadingDids.value = true;
  try {
    const dids = await window.electronAPI.did.getAllIdentities();
    availableDids.value = dids || [];

    // 如果没有选中的DID，自动选择第一个
    if (!selectedDid.value && availableDids.value.length > 0) {
      selectedDid.value = availableDids.value[0].did;
    }
  } catch (error) {
    logger.error('加载DID列表失败:', error);
    message.error('加载DID列表失败: ' + error.message);
  } finally {
    loadingDids.value = false;
  }
};

/**
 * Tab切换处理
 */
const handleTabChange = (key) => {
  logger.info('Tab changed to:', key);

  // 根据Tab加载对应数据
  if (!selectedDid.value && key !== 'marketplace' && key !== 'knowledge') {
    message.warning('请先选择DID身份');
    return;
  }

  loadTabData(key);
};

/**
 * 加载Tab数据
 */
const loadTabData = async (tab) => {
  try {
    switch (tab) {
      case 'assets':
        if (selectedDid.value) {
          await tradeStore.loadMyAssets(selectedDid.value);
        }
        break;

      case 'marketplace':
        await tradeStore.loadOrders();
        break;

      case 'escrow':
        await tradeStore.loadEscrows();
        await tradeStore.loadEscrowStatistics();
        break;

      case 'contracts':
        await tradeStore.loadContracts();
        await tradeStore.loadContractTemplates();
        break;

      case 'credit':
        if (selectedDid.value) {
          await tradeStore.loadUserCredit(selectedDid.value);
          await tradeStore.loadScoreHistory(selectedDid.value, 20);
        }
        break;

      case 'reviews':
        if (selectedDid.value) {
          await tradeStore.loadMyReviews(selectedDid.value);
        }
        break;

      case 'knowledge':
        await tradeStore.loadKnowledgeContents();
        break;

      case 'transactions':
        await tradeStore.loadTransactions();
        break;

      default:
        logger.warn('未知的Tab:', tab);
    }
  } catch (error) {
    logger.error(`加载Tab数据失败 [${tab}]:`, error);
    message.error(`加载数据失败: ${error.message}`);
  }
};

/**
 * 刷新当前Tab数据
 */
const handleRefresh = () => {
  loadTabData(activeTab.value);
  message.success('刷新成功');
};

/**
 * 查看信用评分
 */
const handleViewCredit = () => {
  activeTab.value = 'credit';
};

/**
 * DID切换处理
 */
const handleDidChange = async (newDid) => {
  logger.info('DID changed to:', newDid);

  // 刷新当前Tab数据
  await loadTabData(activeTab.value);

  // 如果在信用评分Tab，加载新DID的信用信息
  if (activeTab.value === 'credit') {
    try {
      await tradeStore.loadUserCredit(newDid);
      await tradeStore.loadScoreHistory(newDid, 20);
    } catch (error) {
      logger.error('加载新DID信用信息失败:', error);
    }
  }
};

// 监听selectedDid变化
watch(selectedDid, (newDid) => {
  if (newDid && activeTab.value === 'credit') {
    tradeStore.loadUserCredit(newDid).catch((error) => {
      logger.error('加载信用信息失败:', error);
    });
  }
});

// 生命周期

onMounted(async () => {
  logger.info('[TradingHub] 组件挂载');

  // 初始化UI状态（从localStorage恢复）
  tradeStore.initUI();

  // 加载DID列表
  await loadAvailableDids();

  // 加载初始Tab数据
  if (availableDids.value.length > 0) {
    await loadTabData(activeTab.value);
  } else {
    message.warning('请先创建DID身份', 3);
  }
});
</script>

<style scoped>
.trading-hub {
  padding: 24px;
  background-color: #f0f2f5;
  min-height: calc(100vh - 64px);
}

.trading-hub-card {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  border-radius: 8px;
}

.page-title {
  font-size: 18px;
  font-weight: 600;
  color: #1890ff;
}

.tab-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
}

.credit-icon {
  transition: all 0.3s ease;
}

.credit-icon:hover {
  transform: scale(1.1);
}

/* Tab样式优化 */
:deep(.ant-tabs-nav) {
  margin-bottom: 24px;
}

:deep(.ant-tabs-card > .ant-tabs-nav .ant-tabs-tab) {
  border-radius: 8px 8px 0 0;
  transition: all 0.3s ease;
}

:deep(.ant-tabs-card > .ant-tabs-nav .ant-tabs-tab-active) {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}

:deep(.ant-tabs-card > .ant-tabs-nav .ant-tabs-tab:hover) {
  color: #1890ff;
}
</style>
