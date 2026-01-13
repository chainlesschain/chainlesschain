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
        // 调用IPC获取本地资产列表
        const result = await window.electron.invoke('asset:list');
        localAssets.value = result.assets || [];
      } catch (error) {
        console.error('加载本地资产失败:', error);
        message.error('加载本地资产失败');
        localAssets.value = [];
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
        // 获取当前钱包地址作为owner地址
        const walletResult = await window.electron.invoke('wallet:get-current');
        if (!walletResult || !walletResult.address) {
          message.warning('请先选择一个钱包');
          return;
        }

        const balance = await window.electron.invoke(
          'blockchain-integration:sync-balance',
          record.local_asset_id,
          walletResult.address
        );
        message.success(`余额同步成功: ${balance}`);
        await loadOnChainAssets();
      } catch (error) {
        console.error('同步余额失败:', error);
        message.error(`同步余额失败: ${error.message}`);
      }
    };

    const handleViewOnExplorer = (record) => {
      // 根据chainId获取浏览器URL
      const explorerUrl = getBlockExplorerUrl(record.chain_id, 'address', record.contract_address);
      if (explorerUrl) {
        window.open(explorerUrl, '_blank');
      } else {
        message.warning('当前网络不支持区块链浏览器');
      }
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
      const explorerUrl = getBlockExplorerUrl(record.chain_id, 'tx', record.tx_hash);
      if (explorerUrl) {
        window.open(explorerUrl, '_blank');
      } else {
        message.warning('当前网络不支持区块链浏览器');
      }
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

    /**
     * 获取区块链浏览器URL
     * @param {number} chainId - 链ID
     * @param {string} type - 类型 ('address' | 'tx' | 'block')
     * @param {string} value - 地址/交易哈希/区块号
     * @returns {string|null} 浏览器URL
     */
    const getBlockExplorerUrl = (chainId, type, value) => {
      const explorers = {
        1: 'https://etherscan.io',           // 以太坊主网
        11155111: 'https://sepolia.etherscan.io', // Sepolia测试网
        137: 'https://polygonscan.com',      // Polygon主网
        80001: 'https://mumbai.polygonscan.com', // Mumbai测试网
        56: 'https://bscscan.com',           // BSC主网
        97: 'https://testnet.bscscan.com',   // BSC测试网
        42161: 'https://arbiscan.io',        // Arbitrum One
        421613: 'https://goerli.arbiscan.io', // Arbitrum Goerli
        10: 'https://optimistic.etherscan.io', // Optimism
        420: 'https://goerli-optimism.etherscan.io', // Optimism Goerli
        43114: 'https://snowtrace.io',       // Avalanche C-Chain
        43113: 'https://testnet.snowtrace.io', // Avalanche Fuji
        250: 'https://ftmscan.com',          // Fantom Opera
        4002: 'https://testnet.ftmscan.com', // Fantom Testnet
        100: 'https://gnosisscan.io',        // Gnosis Chain
        // Hardhat本地网络没有浏览器
        31337: null,
      };

      const baseUrl = explorers[chainId];
      if (!baseUrl) return null;

      const paths = {
        address: 'address',
        tx: 'tx',
        block: 'block',
      };

      return `${baseUrl}/${paths[type]}/${value}`;
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
