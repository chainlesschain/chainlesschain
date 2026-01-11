<template>
  <div class="blockchain-integration-panel">
    <a-card title="区块链集成管理" :bordered="false">
      <a-tabs v-model:activeKey="activeTab">
        <!-- 链上资产 -->
        <a-tab-pane key="assets" tab="链上资产">
          <div class="section">
            <a-space direction="vertical" style="width: 100%" :size="16">
              <!-- 创建链上资产 -->
              <a-card title="创建链上资产" size="small">
                <a-form layout="vertical">
                  <a-form-item label="本地资产">
                    <a-select
                      v-model:value="createAssetForm.localAssetId"
                      placeholder="选择本地资产"
                      show-search
                      :filter-option="filterAsset"
                    >
                      <a-select-option
                        v-for="asset in localAssets"
                        :key="asset.id"
                        :value="asset.id"
                      >
                        {{ asset.name }} ({{ asset.asset_type }})
                      </a-select-option>
                    </a-select>
                  </a-form-item>

                  <a-form-item label="资产类型">
                    <a-radio-group v-model:value="createAssetForm.assetType">
                      <a-radio value="token">ERC-20 Token</a-radio>
                      <a-radio value="nft">ERC-721 NFT</a-radio>
                    </a-radio-group>
                  </a-form-item>

                  <a-form-item label="钱包">
                    <a-select
                      v-model:value="createAssetForm.walletId"
                      placeholder="选择钱包"
                    >
                      <a-select-option
                        v-for="wallet in wallets"
                        :key="wallet.id"
                        :value="wallet.id"
                      >
                        {{ wallet.name }} ({{ wallet.address }})
                      </a-select-option>
                    </a-select>
                  </a-form-item>

                  <a-form-item label="钱包密码">
                    <a-input-password
                      v-model:value="createAssetForm.password"
                      placeholder="输入钱包密码"
                    />
                  </a-form-item>

                  <a-form-item>
                    <a-button
                      type="primary"
                      :loading="creating"
                      @click="handleCreateAsset"
                    >
                      部署到链上
                    </a-button>
                  </a-form-item>
                </a-form>
              </a-card>

              <!-- 链上资产列表 -->
              <a-card title="链上资产列表" size="small">
                <a-table
                  :columns="assetColumns"
                  :data-source="onChainAssets"
                  :loading="loadingAssets"
                  :pagination="{ pageSize: 10 }"
                  row-key="id"
                >
                  <template #bodyCell="{ column, record }">
                    <template v-if="column.key === 'contract_address'">
                      <a-typography-text copyable>
                        {{ formatAddress(record.contract_address) }}
                      </a-typography-text>
                    </template>

                    <template v-if="column.key === 'sync_status'">
                      <a-tag :color="getSyncStatusColor(record.sync_status)">
                        {{ getSyncStatusText(record.sync_status) }}
                      </a-tag>
                    </template>

                    <template v-if="column.key === 'actions'">
                      <a-space>
                        <a-button
                          size="small"
                          @click="handleSyncBalance(record)"
                        >
                          同步余额
                        </a-button>
                        <a-button
                          size="small"
                          @click="handleViewOnExplorer(record)"
                        >
                          查看浏览器
                        </a-button>
                      </a-space>
                    </template>
                  </template>
                </a-table>
              </a-card>
            </a-space>
          </div>
        </a-tab-pane>

        <!-- 交易监控 -->
        <a-tab-pane key="transactions" tab="交易监控">
          <div class="section">
            <a-card title="待确认交易" size="small">
              <a-table
                :columns="txColumns"
                :data-source="pendingTransactions"
                :loading="loadingTxs"
                :pagination="{ pageSize: 10 }"
                row-key="id"
              >
                <template #bodyCell="{ column, record }">
                  <template v-if="column.key === 'tx_hash'">
                    <a-typography-text copyable>
                      {{ formatAddress(record.tx_hash) }}
                    </a-typography-text>
                  </template>

                  <template v-if="column.key === 'status'">
                    <a-tag :color="getTxStatusColor(record.status)">
                      {{ getTxStatusText(record.status) }}
                    </a-tag>
                  </template>

                  <template v-if="column.key === 'actions'">
                    <a-space>
                      <a-button
                        size="small"
                        @click="handleMonitorTransaction(record)"
                      >
                        监控
                      </a-button>
                      <a-button
                        size="small"
                        @click="handleViewTxOnExplorer(record)"
                      >
                        查看浏览器
                      </a-button>
                    </a-space>
                  </template>
                </template>
              </a-table>
            </a-card>
          </div>
        </a-tab-pane>

        <!-- 同步设置 -->
        <a-tab-pane key="sync" tab="同步设置">
          <div class="section">
            <a-space direction="vertical" style="width: 100%" :size="16">
              <a-card title="自动同步" size="small">
                <a-form layout="vertical">
                  <a-form-item label="同步间隔（分钟）">
                    <a-input-number
                      v-model:value="syncInterval"
                      :min="1"
                      :max="60"
                      style="width: 200px"
                    />
                  </a-form-item>

                  <a-form-item>
                    <a-space>
                      <a-button
                        type="primary"
                        @click="handleStartAutoSync"
                      >
                        启动自动同步
                      </a-button>
                      <a-button @click="handleStopAutoSync">
                        停止自动同步
                      </a-button>
                      <a-button
                        type="dashed"
                        :loading="syncing"
                        @click="handleManualSync"
                      >
                        立即同步
                      </a-button>
                    </a-space>
                  </a-form-item>
                </a-form>
              </a-card>

              <a-card title="同步统计" size="small">
                <a-descriptions :column="2" bordered>
                  <a-descriptions-item label="最后同步时间">
                    {{ lastSyncTime || '未同步' }}
                  </a-descriptions-item>
                  <a-descriptions-item label="同步项数">
                    {{ syncStats.itemsSynced || 0 }}
                  </a-descriptions-item>
                  <a-descriptions-item label="同步状态">
                    <a-tag :color="syncStats.status === 'completed' ? 'success' : 'processing'">
                      {{ syncStats.status || '未知' }}
                    </a-tag>
                  </a-descriptions-item>
                </a-descriptions>
              </a-card>
            </a-space>
          </div>
        </a-tab-pane>
      </a-tabs>
    </a-card>
  </div>
</template>

<script>
import { ref, reactive, onMounted, onUnmounted } from 'vue';
import { message } from 'ant-design-vue';

export default {
  name: 'BlockchainIntegrationPanel',

  setup() {
    const activeTab = ref('assets');
    const creating = ref(false);
    const loadingAssets = ref(false);
    const loadingTxs = ref(false);
    const syncing = ref(false);

    // 表单数据
    const createAssetForm = reactive({
      localAssetId: undefined,
      assetType: 'token',
      walletId: undefined,
      password: '',
    });

    const syncInterval = ref(5);
    const lastSyncTime = ref('');
    const syncStats = reactive({
      itemsSynced: 0,
      status: '',
    });

    // 数据列表
    const localAssets = ref([]);
    const wallets = ref([]);
    const onChainAssets = ref([]);
    const pendingTransactions = ref([]);

    // 表格列定义
    const assetColumns = [
      { title: '本地资产ID', dataIndex: 'local_asset_id', key: 'local_asset_id' },
      { title: '合约地址', dataIndex: 'contract_address', key: 'contract_address' },
      { title: '资产类型', dataIndex: 'asset_type', key: 'asset_type' },
      { title: '同步状态', dataIndex: 'sync_status', key: 'sync_status' },
      { title: '操作', key: 'actions' },
    ];

    const txColumns = [
      { title: '本地交易ID', dataIndex: 'local_tx_id', key: 'local_tx_id' },
      { title: '交易哈希', dataIndex: 'tx_hash', key: 'tx_hash' },
      { title: '交易类型', dataIndex: 'tx_type', key: 'tx_type' },
      { title: '状态', dataIndex: 'status', key: 'status' },
      { title: '操作', key: 'actions' },
    ];

    // 加载数据
    const loadLocalAssets = async () => {
      try {
        // TODO: 调用IPC获取本地资产列表
        localAssets.value = await window.electron.invoke('asset:list');
      } catch (error) {
        console.error('加载本地资产失败:', error);
      }
    };

    const loadWallets = async () => {
      try {
        wallets.value = await window.electron.invoke('wallet:list');
      } catch (error) {
        console.error('加载钱包列表失败:', error);
      }
    };

    const loadOnChainAssets = async () => {
      loadingAssets.value = true;
      try {
        onChainAssets.value = await window.electron.invoke('blockchain-integration:get-all-assets');
      } catch (error) {
        console.error('加载链上资产失败:', error);
        message.error('加载链上资产失败');
      } finally {
        loadingAssets.value = false;
      }
    };

    const loadPendingTransactions = async () => {
      loadingTxs.value = true;
      try {
        pendingTransactions.value = await window.electron.invoke('blockchain-integration:get-pending-transactions');
      } catch (error) {
        console.error('加载待确认交易失败:', error);
        message.error('加载待确认交易失败');
      } finally {
        loadingTxs.value = false;
      }
    };

    // 事件处理
    const handleCreateAsset = async () => {
      if (!createAssetForm.localAssetId || !createAssetForm.walletId || !createAssetForm.password) {
        message.warning('请填写完整信息');
        return;
      }

      creating.value = true;
      try {
        const method = createAssetForm.assetType === 'token'
          ? 'blockchain-integration:create-token'
          : 'blockchain-integration:create-nft';

        const result = await window.electron.invoke(method, createAssetForm.localAssetId, {
          walletId: createAssetForm.walletId,
          password: createAssetForm.password,
        });

        message.success(`资产部署成功！合约地址: ${result.address}`);

        // 重置表单
        createAssetForm.localAssetId = undefined;
        createAssetForm.password = '';

        // 刷新列表
        await loadOnChainAssets();
      } catch (error) {
        console.error('创建链上资产失败:', error);
        message.error(`创建失败: ${error.message}`);
      } finally {
        creating.value = false;
      }
    };

    const handleSyncBalance = async (record) => {
      try {
        // TODO: 需要获取owner地址
        const balance = await window.electron.invoke(
          'blockchain-integration:sync-balance',
          record.local_asset_id,
          'owner_address'
        );
        message.success(`余额同步成功: ${balance}`);
      } catch (error) {
        console.error('同步余额失败:', error);
        message.error('同步余额失败');
      }
    };

    const handleViewOnExplorer = (record) => {
      // TODO: 根据chainId获取浏览器URL
      const explorerUrl = `https://etherscan.io/address/${record.contract_address}`;
      window.open(explorerUrl, '_blank');
    };

    const handleMonitorTransaction = async (record) => {
      try {
        await window.electron.invoke('blockchain-integration:monitor-transaction', record.tx_hash, 1);
        message.success('交易监控已启动');
        await loadPendingTransactions();
      } catch (error) {
        console.error('监控交易失败:', error);
        message.error('监控交易失败');
      }
    };

    const handleViewTxOnExplorer = (record) => {
      const explorerUrl = `https://etherscan.io/tx/${record.tx_hash}`;
      window.open(explorerUrl, '_blank');
    };

    const handleStartAutoSync = async () => {
      try {
        await window.electron.invoke('blockchain-integration:start-auto-sync', syncInterval.value * 60 * 1000);
        message.success('自动同步已启动');
      } catch (error) {
        console.error('启动自动同步失败:', error);
        message.error('启动自动同步失败');
      }
    };

    const handleStopAutoSync = async () => {
      try {
        await window.electron.invoke('blockchain-integration:stop-auto-sync');
        message.success('自动同步已停止');
      } catch (error) {
        console.error('停止自动同步失败:', error);
        message.error('停止自动同步失败');
      }
    };

    const handleManualSync = async () => {
      syncing.value = true;
      try {
        await window.electron.invoke('blockchain-integration:sync-all');
        message.success('同步完成');
        lastSyncTime.value = new Date().toLocaleString();
        await loadOnChainAssets();
        await loadPendingTransactions();
      } catch (error) {
        console.error('手动同步失败:', error);
        message.error('同步失败');
      } finally {
        syncing.value = false;
      }
    };

    // 工具函数
    const filterAsset = (input, option) => {
      return option.children[0].children.toLowerCase().includes(input.toLowerCase());
    };

    const formatAddress = (address) => {
      if (!address) return '';
      return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
    };

    const getSyncStatusColor = (status) => {
      const colors = {
        synced: 'success',
        syncing: 'processing',
        failed: 'error',
      };
      return colors[status] || 'default';
    };

    const getSyncStatusText = (status) => {
      const texts = {
        synced: '已同步',
        syncing: '同步中',
        failed: '失败',
      };
      return texts[status] || status;
    };

    const getTxStatusColor = (status) => {
      const colors = {
        pending: 'processing',
        confirmed: 'success',
        failed: 'error',
      };
      return colors[status] || 'default';
    };

    const getTxStatusText = (status) => {
      const texts = {
        pending: '待确认',
        confirmed: '已确认',
        failed: '失败',
      };
      return texts[status] || status;
    };

    // 监听事件
    const setupEventListeners = () => {
      window.electron.on('blockchain-integration:asset-deployed', (data) => {
        message.success(`资产已部署: ${data.contractAddress}`);
        loadOnChainAssets();
      });

      window.electron.on('blockchain-integration:transaction-update', (data) => {
        if (data.status === 'success') {
          message.success(`交易已确认: ${data.txHash}`);
          loadPendingTransactions();
        }
      });

      window.electron.on('blockchain-integration:sync-completed', (data) => {
        syncStats.itemsSynced = data.itemsSynced;
        syncStats.status = 'completed';
        lastSyncTime.value = new Date().toLocaleString();
      });
    };

    // 生命周期
    onMounted(async () => {
      await loadLocalAssets();
      await loadWallets();
      await loadOnChainAssets();
      await loadPendingTransactions();
      setupEventListeners();
    });

    onUnmounted(() => {
      // 清理事件监听器
    });

    return {
      activeTab,
      creating,
      loadingAssets,
      loadingTxs,
      syncing,
      createAssetForm,
      syncInterval,
      lastSyncTime,
      syncStats,
      localAssets,
      wallets,
      onChainAssets,
      pendingTransactions,
      assetColumns,
      txColumns,
      handleCreateAsset,
      handleSyncBalance,
      handleViewOnExplorer,
      handleMonitorTransaction,
      handleViewTxOnExplorer,
      handleStartAutoSync,
      handleStopAutoSync,
      handleManualSync,
      filterAsset,
      formatAddress,
      getSyncStatusColor,
      getSyncStatusText,
      getTxStatusColor,
      getTxStatusText,
    };
  },
};
</script>

<style scoped>
.blockchain-integration-panel {
  padding: 24px;
}

.section {
  padding: 16px 0;
}
</style>
