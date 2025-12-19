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

      <!-- 筛选器 -->
      <a-space style="margin-bottom: 16px">
        <span>类型:</span>
        <a-radio-group v-model:value="filterType" button-style="solid" @change="handleFilterChange">
          <a-radio-button value="">全部</a-radio-button>
          <a-radio-button value="token">Token</a-radio-button>
          <a-radio-button value="nft">NFT</a-radio-button>
          <a-radio-button value="knowledge">知识产品</a-radio-button>
          <a-radio-button value="service">服务凭证</a-radio-button>
        </a-radio-group>
      </a-space>

      <!-- 资产列表 -->
      <a-spin :spinning="loading">
        <a-list
          :data-source="filteredAssets"
          :grid="{ gutter: 16, xs: 1, sm: 2, md: 2, lg: 3, xl: 4, xxl: 4 }"
        >
          <template #renderItem="{ item }">
            <a-list-item>
              <a-card hoverable class="asset-card">
                <!-- 资产图片或图标 -->
                <div class="asset-image">
                  <img v-if="item.metadata?.imageUrl" :src="item.metadata.imageUrl" alt="资产图片" />
                  <div v-else class="asset-icon" :style="{ backgroundColor: getAssetColor(item.asset_type) }">
                    <trophy-outlined v-if="item.asset_type === 'token'" />
                    <picture-outlined v-else-if="item.asset_type === 'nft'" />
                    <book-outlined v-else-if="item.asset_type === 'knowledge'" />
                    <tool-outlined v-else />
                  </div>
                </div>

                <!-- 资产信息 -->
                <a-card-meta>
                  <template #title>
                    <a-space>
                      <span>{{ item.name }}</span>
                      <a-tag v-if="item.symbol" color="blue">{{ item.symbol }}</a-tag>
                    </a-space>
                  </template>
                  <template #description>
                    <div class="asset-description">
                      <div class="asset-type">
                        <a-tag :color="getTypeColor(item.asset_type)">
                          {{ getTypeName(item.asset_type) }}
                        </a-tag>
                      </div>
                      <div class="asset-balance">
                        余额: <span class="balance-value">{{ formatAmount(item.amount, item.decimals) }}</span>
                      </div>
                      <div v-if="item.description" class="asset-desc-text">
                        {{ item.description }}
                      </div>
                    </div>
                  </template>
                </a-card-meta>

                <!-- 操作按钮 -->
                <template #actions>
                  <a-tooltip title="转账">
                    <send-outlined @click="handleTransfer(item)" />
                  </a-tooltip>
                  <a-tooltip title="查看详情">
                    <eye-outlined @click="handleViewDetail(item)" />
                  </a-tooltip>
                  <a-dropdown>
                    <ellipsis-outlined />
                    <template #overlay>
                      <a-menu>
                        <a-menu-item v-if="item.asset_type === 'token' && isCreator(item)" @click="handleMint(item)">
                          <plus-outlined /> 铸造
                        </a-menu-item>
                        <a-menu-item @click="handleViewHistory(item)">
                          <history-outlined /> 历史记录
                        </a-menu-item>
                        <a-menu-divider />
                        <a-menu-item danger @click="handleBurn(item)">
                          <fire-outlined /> 销毁
                        </a-menu-item>
                      </a-menu>
                    </template>
                  </a-dropdown>
                </template>
              </a-card>
            </a-list-item>
          </template>

          <template #empty>
            <a-empty description="暂无资产">
              <a-button type="primary" @click="showCreateModal = true">
                创建第一个资产
              </a-button>
            </a-empty>
          </template>
        </a-list>
      </a-spin>
    </a-card>

    <!-- 创建资产对话框 -->
    <asset-create
      v-model:visible="showCreateModal"
      @created="handleAssetCreated"
    />

    <!-- 转账对话框 -->
    <asset-transfer
      v-model:visible="showTransferModal"
      :asset="selectedAsset"
      @transferred="handleTransferred"
    />

    <!-- 资产详情对话框 -->
    <a-modal
      v-model:visible="showDetailModal"
      title="资产详情"
      width="600px"
      :footer="null"
    >
      <a-descriptions v-if="selectedAsset" bordered :column="1">
        <a-descriptions-item label="资产 ID">
          <a-typography-text copyable>{{ selectedAsset.asset_id }}</a-typography-text>
        </a-descriptions-item>
        <a-descriptions-item label="资产名称">
          {{ selectedAsset.name }}
        </a-descriptions-item>
        <a-descriptions-item v-if="selectedAsset.symbol" label="符号">
          {{ selectedAsset.symbol }}
        </a-descriptions-item>
        <a-descriptions-item label="类型">
          <a-tag :color="getTypeColor(selectedAsset.asset_type)">
            {{ getTypeName(selectedAsset.asset_type) }}
          </a-tag>
        </a-descriptions-item>
        <a-descriptions-item label="我的余额">
          {{ formatAmount(selectedAsset.amount, selectedAsset.decimals) }}
        </a-descriptions-item>
        <a-descriptions-item label="描述">
          {{ selectedAsset.description || '无' }}
        </a-descriptions-item>
        <a-descriptions-item label="创建时间">
          {{ formatTime(selectedAsset.acquired_at) }}
        </a-descriptions-item>
      </a-descriptions>
    </a-modal>

    <!-- 历史记录对话框 -->
    <a-modal
      v-model:visible="showHistoryModal"
      title="转账历史"
      width="800px"
      :footer="null"
    >
      <a-list
        :data-source="assetHistory"
        :loading="loadingHistory"
      >
        <template #renderItem="{ item }">
          <a-list-item>
            <a-list-item-meta>
              <template #title>
                <a-space>
                  <a-tag :color="getTransactionTypeColor(item.transaction_type)">
                    {{ getTransactionTypeName(item.transaction_type) }}
                  </a-tag>
                  <span>数量: {{ item.amount }}</span>
                </a-space>
              </template>
              <template #description>
                <div>发送者: {{ shortenDid(item.from_did) }}</div>
                <div>接收者: {{ shortenDid(item.to_did) }}</div>
                <div>时间: {{ formatTime(item.created_at) }}</div>
                <div v-if="item.memo">备注: {{ item.memo }}</div>
              </template>
            </a-list-item-meta>
          </a-list-item>
        </template>
      </a-list>
    </a-modal>
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
  BookOutlined,
  ToolOutlined,
  SendOutlined,
  EyeOutlined,
  EllipsisOutlined,
  HistoryOutlined,
  FireOutlined,
} from '@ant-design/icons-vue';
import AssetCreate from './AssetCreate.vue';
import AssetTransfer from './AssetTransfer.vue';

// 状态
const loading = ref(false);
const loadingHistory = ref(false);
const assets = ref([]);
const currentDid = ref('');
const filterType = ref('');
const showCreateModal = ref(false);
const showTransferModal = ref(false);
const showDetailModal = ref(false);
const showHistoryModal = ref(false);
const selectedAsset = ref(null);
const assetHistory = ref([]);

// 统计信息
const statistics = computed(() => {
  return {
    total: assets.value.length,
    token: assets.value.filter(a => a.asset_type === 'token').length,
    nft: assets.value.filter(a => a.asset_type === 'nft').length,
    other: assets.value.filter(a => !['token', 'nft'].includes(a.asset_type)).length,
  };
});

// 筛选后的资产
const filteredAssets = computed(() => {
  if (!filterType.value) {
    return assets.value;
  }
  return assets.value.filter(a => a.asset_type === filterType.value);
});

// 工具函数
const getAssetColor = (type) => {
  const colors = {
    token: '#1890ff',
    nft: '#52c41a',
    knowledge: '#faad14',
    service: '#722ed1',
  };
  return colors[type] || '#999';
};

const getTypeColor = (type) => {
  const colors = {
    token: 'blue',
    nft: 'green',
    knowledge: 'orange',
    service: 'purple',
  };
  return colors[type] || 'default';
};

const getTypeName = (type) => {
  const names = {
    token: 'Token',
    nft: 'NFT',
    knowledge: '知识产品',
    service: '服务凭证',
  };
  return names[type] || type;
};

const getTransactionTypeColor = (type) => {
  const colors = {
    transfer: 'blue',
    mint: 'green',
    burn: 'red',
    trade: 'orange',
  };
  return colors[type] || 'default';
};

const getTransactionTypeName = (type) => {
  const names = {
    transfer: '转账',
    mint: '铸造',
    burn: '销毁',
    trade: '交易',
  };
  return names[type] || type;
};

const formatAmount = (amount, decimals = 0) => {
  if (decimals === 0) {
    return amount.toString();
  }
  const divisor = Math.pow(10, decimals);
  return (amount / divisor).toFixed(decimals);
};

const shortenDid = (did) => {
  if (!did || did === 'SYSTEM' || did === 'BURNED') return did;
  return did.length > 20 ? `${did.slice(0, 10)}...${did.slice(-8)}` : did;
};

const formatTime = (timestamp) => {
  const date = new Date(timestamp);
  return date.toLocaleString('zh-CN');
};

const isCreator = (asset) => {
  // 这里需要从 asset 完整信息获取 creator_did
  return true; // 简化处理
};

// 加载资产列表
const loadAssets = async () => {
  try {
    loading.value = true;

    // 获取当前用户 DID
    if (!currentDid.value) {
      const identity = await window.electronAPI.did.getCurrentIdentity();
      if (identity) {
        currentDid.value = identity.did;
      }
    }

    if (!currentDid.value) {
      antMessage.warning('请先创建身份');
      return;
    }

    assets.value = await window.electronAPI.asset.getByOwner(currentDid.value);

    console.log('资产列表已加载:', assets.value.length);
  } catch (error) {
    console.error('加载资产列表失败:', error);
    antMessage.error('加载资产列表失败: ' + error.message);
  } finally {
    loading.value = false;
  }
};

// 筛选器变化
const handleFilterChange = () => {
  // 已通过 computed 自动处理
};

// 资产创建成功
const handleAssetCreated = (asset) => {
  assets.value.unshift({
    ...asset,
    amount: asset.total_supply || 0,
    asset_id: asset.id,
  });
  antMessage.success('资产创建成功');
};

// 转账
const handleTransfer = (asset) => {
  selectedAsset.value = asset;
  showTransferModal.value = true;
};

// 转账成功
const handleTransferred = () => {
  loadAssets();
};

// 查看详情
const handleViewDetail = (asset) => {
  selectedAsset.value = asset;
  showDetailModal.value = true;
};

// 查看历史
const handleViewHistory = async (asset) => {
  try {
    loadingHistory.value = true;
    showHistoryModal.value = true;
    assetHistory.value = await window.electronAPI.asset.getHistory(asset.asset_id);
  } catch (error) {
    console.error('加载历史记录失败:', error);
    antMessage.error('加载历史记录失败: ' + error.message);
  } finally {
    loadingHistory.value = false;
  }
};

// 铸造
const handleMint = (asset) => {
  Modal.confirm({
    title: '铸造资产',
    content: '确定要铸造更多资产吗？这将增加总供应量。',
    okText: '确定',
    cancelText: '取消',
    onOk() {
      // TODO: 打开铸造对话框
      antMessage.info('铸造功能即将开放');
    },
  });
};

// 销毁
const handleBurn = (asset) => {
  Modal.confirm({
    title: '销毁资产',
    content: `确定要销毁 ${asset.name} 吗？销毁后无法恢复！`,
    okText: '确定销毁',
    okType: 'danger',
    cancelText: '取消',
    async onOk() {
      try {
        // TODO: 打开销毁对话框，指定数量
        antMessage.info('销毁功能即将开放');
      } catch (error) {
        console.error('销毁资产失败:', error);
        antMessage.error('销毁资产失败: ' + error.message);
      }
    },
  });
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

.asset-card {
  height: 100%;
}

.asset-image {
  width: 100%;
  height: 150px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f5f5f5;
  border-radius: 8px;
  margin-bottom: 12px;
  overflow: hidden;
}

.asset-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.asset-icon {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 36px;
  color: white;
}

.asset-description {
  margin-top: 8px;
}

.asset-type {
  margin-bottom: 4px;
}

.asset-balance {
  font-size: 14px;
  color: #666;
  margin-bottom: 8px;
}

.balance-value {
  font-weight: bold;
  color: #1890ff;
  font-size: 16px;
}

.asset-desc-text {
  font-size: 12px;
  color: #999;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
</style>
