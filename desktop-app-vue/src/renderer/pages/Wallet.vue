<template>
  <div class="wallet-page">
    <!-- 页面头部 -->
    <div class="page-header">
      <div class="header-left">
        <h1 class="page-title">
          <wallet-outlined />
          钱包管理
        </h1>
        <p class="page-subtitle">管理您的区块链钱包和查看交易记录</p>
      </div>
      <div class="header-right">
        <!-- 网络选择器 -->
        <chain-selector :width="'220px'" @switched="handleChainSwitched" />
      </div>
    </div>

    <!-- 主内容区 -->
    <div class="page-content">
      <a-row :gutter="[16, 16]">
        <!-- 左侧: 钱包列表 -->
        <a-col :span="10">
          <a-card title="我的钱包" :bordered="false">
            <template #extra>
              <a-space :size="8">
                <a-button
                  type="primary"
                  size="small"
                  @click="showCreateWalletModal"
                >
                  <template #icon>
                    <plus-outlined />
                  </template>
                  创建
                </a-button>
                <a-button size="small" @click="showImportWalletModal">
                  <template #icon>
                    <import-outlined />
                  </template>
                  导入
                </a-button>
              </a-space>
            </template>

            <!-- 内置钱包列表 -->
            <a-tabs v-model:active-key="activeTab">
              <a-tab-pane key="internal" tab="内置钱包">
                <a-list
                  :data-source="internalWallets"
                  :loading="walletsLoading"
                  :locale="{ emptyText: '暂无钱包，请创建或导入钱包' }"
                >
                  <template #renderItem="{ item }">
                    <a-list-item
                      class="wallet-list-item"
                      :class="{
                        'wallet-active': item.id === currentWallet?.id,
                      }"
                      @click="handleSelectWallet(item)"
                    >
                      <a-list-item-meta>
                        <template #avatar>
                          <a-avatar
                            :size="48"
                            :style="{
                              backgroundColor: getAvatarColor(item.address),
                            }"
                          >
                            <wallet-outlined />
                          </a-avatar>
                        </template>

                        <template #title>
                          <div class="wallet-title">
                            <span>{{ formatAddress(item.address) }}</span>
                            <a-tag
                              v-if="item.is_default"
                              color="blue"
                              size="small"
                            >
                              默认
                            </a-tag>
                            <a-tag
                              v-if="item.id === currentWallet?.id"
                              color="green"
                              size="small"
                            >
                              当前
                            </a-tag>
                          </div>
                        </template>

                        <template #description>
                          <div class="wallet-description">
                            <div class="wallet-balance">
                              <span class="balance-label">余额:</span>
                              <span class="balance-value">{{
                                getWalletBalance(item)
                              }}</span>
                            </div>
                            <div class="wallet-created">
                              创建于 {{ formatDate(item.created_at) }}
                            </div>
                          </div>
                        </template>
                      </a-list-item-meta>

                      <template #actions>
                        <a-dropdown>
                          <a-button type="text" size="small">
                            <more-outlined />
                          </a-button>
                          <template #overlay>
                            <a-menu
                              @click="
                                ({ key }) => handleWalletAction(key, item)
                              "
                            >
                              <a-menu-item
                                v-if="!item.is_default"
                                key="setDefault"
                              >
                                <star-outlined /> 设为默认
                              </a-menu-item>
                              <a-menu-item key="copyAddress">
                                <copy-outlined /> 复制地址
                              </a-menu-item>
                              <a-menu-item key="delete" danger>
                                <delete-outlined /> 删除钱包
                              </a-menu-item>
                            </a-menu>
                          </template>
                        </a-dropdown>
                      </template>
                    </a-list-item>
                  </template>
                </a-list>
              </a-tab-pane>

              <a-tab-pane key="external" tab="外部钱包">
                <div class="external-wallet-section">
                  <a-empty
                    v-if="!externalWalletConnected"
                    description="未连接外部钱包"
                    :image="Empty.PRESENTED_IMAGE_SIMPLE"
                  >
                    <a-space direction="vertical" :size="12">
                      <a-button
                        type="primary"
                        block
                        @click="handleConnectMetaMask"
                      >
                        <template #icon> 🦊 </template>
                        连接 MetaMask
                      </a-button>
                      <a-button block @click="handleConnectWalletConnect">
                        <template #icon> 🔗 </template>
                        连接 WalletConnect
                      </a-button>
                    </a-space>
                  </a-empty>

                  <div v-else class="external-wallet-info">
                    <a-result
                      status="success"
                      :title="`已连接 ${externalWalletProvider === 'metamask' ? 'MetaMask' : 'WalletConnect'}`"
                    >
                      <template #subTitle>
                        <div class="external-address">
                          {{ formatAddress(externalWalletAddress) }}
                          <copy-outlined
                            class="copy-icon"
                            @click="handleCopyAddress(externalWalletAddress)"
                          />
                        </div>
                      </template>
                      <template #extra>
                        <a-button
                          type="primary"
                          danger
                          @click="handleDisconnectExternal"
                        >
                          断开连接
                        </a-button>
                      </template>
                    </a-result>
                  </div>
                </div>
              </a-tab-pane>
            </a-tabs>
          </a-card>
        </a-col>

        <!-- 右侧: 钱包详情和交易历史 -->
        <a-col :span="14">
          <a-card v-if="currentAddress" title="钱包详情" :bordered="false">
            <!-- 钱包概览 -->
            <div class="wallet-overview">
              <a-statistic
                title="钱包地址"
                :value="currentAddress"
                :value-style="{ fontSize: '16px', fontFamily: 'monospace' }"
              >
                <template #suffix>
                  <copy-outlined
                    class="copy-icon"
                    @click="handleCopyAddress(currentAddress)"
                  />
                </template>
              </a-statistic>

              <a-divider />

              <a-row :gutter="16">
                <a-col :span="12">
                  <a-statistic
                    title="余额"
                    :value="currentBalance"
                    :precision="4"
                    :value-style="{ color: '#52c41a' }"
                    :suffix="currentNetwork?.symbol || 'ETH'"
                  />
                </a-col>
                <a-col :span="12">
                  <a-statistic
                    title="待确认交易"
                    :value="pendingTransactionCount"
                    :value-style="{
                      color:
                        pendingTransactionCount > 0 ? '#faad14' : '#8c8c8c',
                    }"
                  />
                </a-col>
              </a-row>
            </div>

            <a-divider />

            <!-- 交易历史 -->
            <h3 class="section-title">
              <history-outlined />
              交易历史
            </h3>
            <transaction-list
              :address="currentAddress"
              :chain-id="currentChainId"
              :page-size="5"
              @view-details="handleViewTransactionDetails"
            />
          </a-card>

          <a-empty
            v-else
            description="请选择一个钱包查看详情"
            :image="Empty.PRESENTED_IMAGE_SIMPLE"
            :style="{ marginTop: '40px' }"
          />
        </a-col>
      </a-row>
    </div>

    <!-- 创建钱包对话框 -->
    <create-wallet-modal
      v-model:open="createWalletModalVisible"
      @created="handleWalletCreated"
    />

    <!-- 导入钱包对话框 -->
    <import-wallet-modal
      v-model:open="importWalletModalVisible"
      @imported="handleWalletImported"
    />

    <!-- 交易详情对话框 -->
    <transaction-detail-modal
      v-model:open="transactionDetailVisible"
      :transaction="selectedTransaction"
      :chain-id="currentChainId"
      @refresh="handleRefreshTransaction"
    />
  </div>
</template>

<script setup>
defineOptions({ name: "WalletPage" });

import { logger } from "@/utils/logger";

import { ref, computed, onMounted } from "vue";
import { message, Modal, Empty } from "ant-design-vue";
import {
  WalletOutlined,
  PlusOutlined,
  ImportOutlined,
  MoreOutlined,
  StarOutlined,
  CopyOutlined,
  DeleteOutlined,
  HistoryOutlined,
} from "@ant-design/icons-vue";
import { useBlockchainStore } from "@/stores/blockchain";
import ChainSelector from "@/components/blockchain/ChainSelector.vue";
import CreateWalletModal from "@/components/blockchain/CreateWalletModal.vue";
import ImportWalletModal from "@/components/blockchain/ImportWalletModal.vue";
import TransactionList from "@/components/blockchain/TransactionList.vue";
import TransactionDetailModal from "@/components/blockchain/TransactionDetailModal.vue";

const blockchainStore = useBlockchainStore();

// 状态
const activeTab = ref("internal");
const createWalletModalVisible = ref(false);
const importWalletModalVisible = ref(false);
const transactionDetailVisible = ref(false);
const selectedTransaction = ref(null);

// 从 store 获取数据
const walletsLoading = computed(() => blockchainStore.walletLoading);
const internalWallets = computed(() => blockchainStore.internalWallets);
const currentWallet = computed(() => blockchainStore.currentWallet);
const currentAddress = computed(() => blockchainStore.currentAddress);
const currentChainId = computed(() => blockchainStore.currentChainId);
const currentNetwork = computed(() => blockchainStore.currentNetwork);
const externalWalletConnected = computed(
  () => blockchainStore.externalWalletConnected,
);
const externalWalletAddress = computed(
  () => blockchainStore.externalWalletAddress,
);
const externalWalletProvider = computed(
  () => blockchainStore.externalWalletProvider,
);
const pendingTransactionCount = computed(
  () => blockchainStore.pendingTransactionCount,
);

// 当前钱包余额
const currentBalance = computed(() => {
  if (!currentAddress.value) {
    return "0.00";
  }

  const balance = blockchainStore.getBalance(
    currentAddress.value,
    currentChainId.value,
  );

  if (!balance || balance === "0") {
    return "0.00";
  }

  // 将 wei 转换为 ether
  return (parseFloat(balance) / 1e18).toFixed(4);
});

/**
 * 获取头像颜色
 */
const getAvatarColor = (address) => {
  if (!address) {
    return "#1890ff";
  }

  let hash = 0;
  for (let i = 0; i < address.length; i++) {
    hash = address.charCodeAt(i) + ((hash << 5) - hash);
  }

  const colors = [
    "#f56a00",
    "#7265e6",
    "#ffbf00",
    "#00a2ae",
    "#1890ff",
    "#52c41a",
    "#fa8c16",
    "#eb2f96",
  ];

  return colors[Math.abs(hash) % colors.length];
};

/**
 * 格式化地址
 */
const formatAddress = (address) => {
  if (!address) {
    return "";
  }
  if (address.length <= 20) {
    return address;
  }
  return `${address.slice(0, 10)}...${address.slice(-8)}`;
};

/**
 * 格式化日期
 */
const formatDate = (timestamp) => {
  if (!timestamp) {
    return "";
  }
  const date = new Date(timestamp);
  return date.toLocaleDateString("zh-CN");
};

/**
 * 获取钱包余额
 */
const getWalletBalance = (wallet) => {
  if (!wallet.address) {
    return "0.00 ETH";
  }

  const balance = blockchainStore.getBalance(
    wallet.address,
    currentChainId.value,
  );

  if (!balance || balance === "0") {
    return `0.00 ${currentNetwork.value?.symbol || "ETH"}`;
  }

  const etherBalance = (parseFloat(balance) / 1e18).toFixed(4);
  return `${etherBalance} ${currentNetwork.value?.symbol || "ETH"}`;
};

/**
 * 选择钱包
 */
const handleSelectWallet = (wallet) => {
  blockchainStore.selectWallet(wallet);
  message.success("已切换钱包");
};

/**
 * 钱包操作
 */
const handleWalletAction = async (action, wallet) => {
  switch (action) {
    case "setDefault":
      await blockchainStore.setDefaultWallet(wallet.id);
      message.success("已设置为默认钱包");
      break;

    case "copyAddress":
      await handleCopyAddress(wallet.address);
      break;

    case "delete":
      Modal.confirm({
        title: "确认删除",
        content: "删除钱包后将无法恢复，请确保已备份助记词或私钥！",
        okText: "确认删除",
        okType: "danger",
        cancelText: "取消",
        onOk: async () => {
          await blockchainStore.deleteWallet(wallet.id);
          message.success("钱包已删除");
        },
      });
      break;
  }
};

/**
 * 复制地址
 */
const handleCopyAddress = async (address) => {
  try {
    await navigator.clipboard.writeText(address);
    message.success("地址已复制到剪贴板");
  } catch (error) {
    logger.error("[Wallet] 复制失败:", error);
    message.error("复制失败");
  }
};

/**
 * 显示创建钱包对话框
 */
const showCreateWalletModal = () => {
  createWalletModalVisible.value = true;
};

/**
 * 显示导入钱包对话框
 */
const showImportWalletModal = () => {
  importWalletModalVisible.value = true;
};

/**
 * 钱包创建成功
 */
const handleWalletCreated = (wallet) => {
  logger.info("[Wallet] 钱包创建成功:", wallet);
  // 刷新余额
  if (wallet.address) {
    blockchainStore.fetchBalance(wallet.address, currentChainId.value);
  }
};

/**
 * 钱包导入成功
 */
const handleWalletImported = (wallet) => {
  logger.info("[Wallet] 钱包导入成功:", wallet);
  // 刷新余额
  if (wallet.address) {
    blockchainStore.fetchBalance(wallet.address, currentChainId.value);
  }
};

/**
 * 连接 MetaMask
 */
const handleConnectMetaMask = async () => {
  try {
    await blockchainStore.connectMetaMask();
    activeTab.value = "external";
  } catch (error) {
    logger.error("[Wallet] 连接 MetaMask 失败:", error);
  }
};

/**
 * 连接 WalletConnect
 */
const handleConnectWalletConnect = async () => {
  try {
    await blockchainStore.connectWalletConnect();
    activeTab.value = "external";
  } catch (error) {
    logger.error("[Wallet] 连接 WalletConnect 失败:", error);
  }
};

/**
 * 断开外部钱包
 */
const handleDisconnectExternal = () => {
  Modal.confirm({
    title: "确认断开",
    content: "确定要断开外部钱包连接吗？",
    okText: "确认",
    cancelText: "取消",
    onOk: () => {
      blockchainStore.disconnectExternalWallet();
      message.success("已断开连接");
    },
  });
};

/**
 * 网络切换
 */
const handleChainSwitched = ({ chainId, network }) => {
  logger.info("[Wallet] 网络已切换:", chainId, network);
  // 刷新余额
  if (currentAddress.value) {
    blockchainStore.refreshCurrentBalance();
  }
};

/**
 * 查看交易详情
 */
const handleViewTransactionDetails = (transaction) => {
  logger.info("[Wallet] 查看交易详情:", transaction);
  selectedTransaction.value = transaction;
  transactionDetailVisible.value = true;
};

/**
 * 刷新交易状态
 */
const handleRefreshTransaction = async (transaction) => {
  try {
    // 刷新交易列表
    await blockchainStore.refreshTransactions(
      currentAddress.value,
      currentChainId.value,
    );
  } catch (error) {
    logger.error("[Wallet] 刷新交易失败:", error);
  }
};

// 生命周期
onMounted(async () => {
  // 初始化 blockchain store
  await blockchainStore.initialize();
});
</script>

<style scoped>
.wallet-page {
  min-height: 100%;
  padding: 24px;
  background-color: #f5f5f5;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 24px;
  padding: 16px 24px;
  background-color: white;
  border-radius: 8px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
}

.header-left {
  flex: 1;
}

.page-title {
  margin: 0;
  font-size: 24px;
  font-weight: 600;
  color: #262626;
  display: flex;
  align-items: center;
  gap: 12px;
}

.page-subtitle {
  margin: 4px 0 0 0;
  font-size: 14px;
  color: #8c8c8c;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 16px;
}

.page-content {
  margin-bottom: 24px;
}

.wallet-list-item {
  cursor: pointer;
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 8px;
  transition: all 0.3s;
  border: 2px solid transparent;
}

.wallet-list-item:hover {
  background-color: #fafafa;
}

.wallet-list-item.wallet-active {
  background-color: #e6f7ff;
  border-color: #1890ff;
}

.wallet-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: "Courier New", monospace;
  font-size: 14px;
}

.wallet-description {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.wallet-balance {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.balance-label {
  color: #8c8c8c;
}

.balance-value {
  color: #52c41a;
  font-weight: 500;
  font-family: "Courier New", monospace;
}

.wallet-created {
  font-size: 12px;
  color: #bfbfbf;
}

.external-wallet-section {
  padding: 24px;
}

.external-wallet-info {
  text-align: center;
}

.external-address {
  font-family: "Courier New", monospace;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.wallet-overview {
  padding: 16px 0;
}

.section-title {
  font-size: 16px;
  font-weight: 500;
  color: #262626;
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.copy-icon {
  color: #1890ff;
  cursor: pointer;
  transition: all 0.3s;
  font-size: 14px;
}

.copy-icon:hover {
  color: #40a9ff;
  transform: scale(1.1);
}

:deep(.ant-card-head) {
  border-bottom: 2px solid #f0f0f0;
}

:deep(.ant-card-body) {
  padding: 16px;
}

:deep(.ant-tabs-nav) {
  margin-bottom: 16px;
}

:deep(.ant-statistic-title) {
  margin-bottom: 8px;
  font-size: 13px;
  color: #8c8c8c;
}

:deep(.ant-result-title) {
  font-size: 16px;
}

:deep(.ant-result-subtitle) {
  font-size: 13px;
}
</style>
