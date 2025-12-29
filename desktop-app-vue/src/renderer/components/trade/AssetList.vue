<template>
  <div class="asset-list-container">
    <a-card title="我的资产">
      <template #extra>
        <a-space>
          <a-button type="primary" @click="showCreateModal = true">
            <template #icon><plus-outlined /></template>
            创建资产
          </a-button>
          <a-button @click="loadAssets">
            <template #icon><reload-outlined /></template>
            刷新
          </a-button>
        </a-space>
      </template>

      <!-- 资产统计 -->
      <a-row :gutter="16" style="margin-bottom: 16px">
        <a-col :span="6">
          <a-statistic title="资产总数" :value="statistics.total">
            <template #prefix><wallet-outlined /></template>
          </a-statistic>
        </a-col>
        <a-col :span="6">
          <a-statistic title="Token" :value="statistics.token" :value-style="{ color: '#1890ff' }">
            <template #prefix><trophy-outlined /></template>
          </a-statistic>
        </a-col>
        <a-col :span="6">
          <a-statistic title="NFT" :value="statistics.nft" :value-style="{ color: '#52c41a' }">
            <template #prefix><picture-outlined /></template>
          </a-statistic>
        </a-col>
        <a-col :span="6">
          <a-statistic title="其他" :value="statistics.other">
            <template #prefix><appstore-outlined /></template>
          </a-statistic>
        </a-col>
      </a-row>

      <!-- 搜索和筛选器 -->
      <a-row :gutter="16" style="margin-bottom: 16px">
        <a-col :span="12">
          <a-input-search
            v-model:value="searchKeyword"
            placeholder="搜索资产名称、符号或描述..."
            allow-clear
          >
            <template #prefix><search-outlined /></template>
          </a-input-search>
        </a-col>
        <a-col :span="12">
          <a-space>
            <span>类型:</span>
            <a-radio-group v-model:value="filterType" button-style="solid" @change="handleFilterChange">
              <a-radio-button value="">全部</a-radio-button>
              <a-radio-button value="token">Token</a-radio-button>
              <a-radio-button value="nft">NFT</a-radio-button>
              <a-radio-button value="knowledge">知识产品</a-radio-button>
              <a-radio-button value="service">服务凭证</a-radio-button>
            </a-radio-group>
          </a-space>
        </a-col>
      </a-row>

      <!-- 资产列表 -->
      <a-spin :spinning="loading">
        <a-row :gutter="[16, 16]">
          <a-col
            v-for="asset in filteredAssets"
            :key="asset.id"
            :xs="24"
            :sm="12"
            :md="12"
            :lg="8"
            :xl="6"
          >
            <asset-card
              :asset="asset"
              :balance="balances[asset.id] || asset.total_supply || 0"
              :current-user-did="props.ownerDid || tradeStore.ui.selectedDid"
              @view="handleView"
              @transfer="handleTransfer"
              @mint="handleMint"
              @burn="handleBurn"
              @history="handleHistory"
              @show-qr="handleShowQR"
            />
          </a-col>
        </a-row>

        <!-- 空状态 -->
        <a-empty
          v-if="!loading && filteredAssets.length === 0"
          :description="searchKeyword || filterType ? '没有找到匹配的资产' : '暂无资产'"
        >
          <a-button v-if="!searchKeyword && !filterType" type="primary" @click="showCreateModal = true">
            创建第一个资产
          </a-button>
        </a-empty>
      </a-spin>
    </a-card>

    <!-- 创建资产对话框 -->
    <asset-create
      v-model:open="showCreateModal"
      @created="handleAssetCreated"
    />

    <!-- 转账对话框 -->
    <asset-transfer
      v-model:open="showTransferModal"
      :asset="selectedAsset"
      @transferred="handleTransferred"
    />

    <!-- 资产详情抽屉 -->
    <asset-detail
      :open="showDetailDrawer"
      :asset="selectedAsset"
      :balance="selectedAsset ? (balances[selectedAsset.id] || selectedAsset.total_supply || 0) : 0"
      :current-user-did="props.ownerDid || tradeStore.ui.selectedDid"
      @close="showDetailDrawer = false"
      @transfer="handleTransfer"
      @mint="handleMint"
      @burn="handleBurn"
      @view-history="handleHistory"
      @show-qr="handleShowQR"
    />

    <!-- 历史记录抽屉 -->
    <asset-history
      :open="showHistoryDrawer"
      :asset="selectedAsset"
      :current-user-did="props.ownerDid || tradeStore.ui.selectedDid"
      @close="showHistoryDrawer = false"
    />
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { message as antMessage, Modal } from 'ant-design-vue';
import {
  PlusOutlined,
  ReloadOutlined,
  WalletOutlined,
  TrophyOutlined,
  PictureOutlined,
  AppstoreOutlined,
  SearchOutlined,
} from '@ant-design/icons-vue';
import { useTradeStore } from '../../stores/trade';
import AssetCard from './common/AssetCard.vue';
import AssetCreate from './AssetCreate.vue';
import AssetTransfer from './AssetTransfer.vue';
import AssetDetail from './AssetDetail.vue';
import AssetHistory from './AssetHistory.vue';

// Props
const props = defineProps({
  ownerDid: {
    type: String,
    default: '',
  },
});

// Store
const tradeStore = useTradeStore();

// 本地状态
const searchKeyword = ref('');
const filterType = ref('');
const showCreateModal = ref(false);
const showTransferModal = ref(false);
const showDetailDrawer = ref(false);
const showHistoryDrawer = ref(false);
const selectedAsset = ref(null);

// 从 store 获取数据
const loading = computed(() => tradeStore.asset.loading);
const assets = computed(() => tradeStore.asset.myAssets);
const balances = computed(() => tradeStore.asset.balances);

// 统计信息
const statistics = computed(() => {
  const assetList = assets.value;
  return {
    total: assetList.length,
    token: assetList.filter(a => a.asset_type === 'token').length,
    nft: assetList.filter(a => a.asset_type === 'nft').length,
    other: assetList.filter(a => !['token', 'nft'].includes(a.asset_type)).length,
  };
});

// 筛选后的资产（带搜索）
const filteredAssets = computed(() => {
  let result = assets.value;

  // 类型筛选
  if (filterType.value) {
    result = result.filter(a => a.asset_type === filterType.value);
  }

  // 搜索筛选
  if (searchKeyword.value) {
    const keyword = searchKeyword.value.toLowerCase();
    result = result.filter(a =>
      a.name?.toLowerCase().includes(keyword) ||
      a.symbol?.toLowerCase().includes(keyword) ||
      a.description?.toLowerCase().includes(keyword)
    );
  }

  return result;
});


// 加载资产列表
const loadAssets = async () => {
  try {
    const ownerDid = props.ownerDid || tradeStore.ui.selectedDid;

    if (!ownerDid) {
      // 尝试获取当前身份
      const identity = await window.electronAPI.did.getCurrentIdentity();
      if (!identity) {
        antMessage.warning('请先创建或选择身份');
        return;
      }
      await tradeStore.loadMyAssets(identity.did);
    } else {
      await tradeStore.loadMyAssets(ownerDid);
    }

    console.log('[AssetList] 资产列表已加载:', assets.value.length);
  } catch (error) {
    console.error('[AssetList] 加载资产列表失败:', error);
    antMessage.error('加载资产列表失败: ' + error.message);
  }
};

// 筛选器变化
const handleFilterChange = () => {
  // 已通过 computed 自动处理
};

// 资产创建成功
const handleAssetCreated = async (asset) => {
  await loadAssets();
  antMessage.success('资产创建成功');
};

// AssetCard 事件处理
const handleView = (asset) => {
  selectedAsset.value = asset;
  showDetailDrawer.value = true;
};

const handleTransfer = (asset) => {
  selectedAsset.value = asset;
  showTransferModal.value = true;
};

const handleMint = (asset) => {
  Modal.confirm({
    title: '铸造资产',
    content: '确定要铸造更多资产吗？这将增加总供应量。',
    okText: '确定',
    cancelText: '取消',
    onOk() {
      antMessage.info('铸造功能即将开放');
    },
  });
};

const handleBurn = (asset) => {
  Modal.confirm({
    title: '销毁资产',
    content: `确定要销毁 ${asset.name} 吗？销毁后无法恢复！`,
    okText: '确定销毁',
    okType: 'danger',
    cancelText: '取消',
    async onOk() {
      antMessage.info('销毁功能即将开放');
    },
  });
};

const handleHistory = (asset) => {
  selectedAsset.value = asset;
  showHistoryDrawer.value = true;
};

const handleShowQR = (asset) => {
  // TODO: 显示资产二维码
  antMessage.info('二维码功能即将开放');
};

// 转账成功
const handleTransferred = async () => {
  await loadAssets();
  antMessage.success('转账成功');
};

// 生命周期
onMounted(async () => {
  await loadAssets();
});
</script>

<style scoped>
.asset-list-container {
  padding: 20px;
}
</style>
