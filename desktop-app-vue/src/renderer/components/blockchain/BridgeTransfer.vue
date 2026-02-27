<template>
  <div class="bridge-transfer">
    <a-card
      title="跨链资产转移"
      :bordered="false"
    >
      <template #extra>
        <a-tag color="warning">
          <experiment-outlined /> 测试功能
        </a-tag>
      </template>

      <a-alert
        message="跨链桥功能"
        description="使用锁定-铸造模式在不同区块链网络间转移资产。请注意：这是简化版本的实现，生产环境建议使用 Chainlink CCIP 或 LayerZero 等成熟方案。"
        type="info"
        show-icon
        :style="{ marginBottom: '24px' }"
      />

      <a-form layout="vertical">
        <!-- 选择资产 -->
        <a-form-item
          label="选择资产"
          required
        >
          <a-select
            v-model:value="form.assetId"
            placeholder="请选择要桥接的资产"
            show-search
            @change="handleAssetChange"
          >
            <a-select-option
              v-for="asset in bridgeableAssets"
              :key="asset.id"
              :value="asset.id"
            >
              <div class="asset-option">
                <span class="asset-name">{{ asset.name }}</span>
                <a-tag
                  size="small"
                  :color="getAssetTypeColor(asset.asset_type)"
                >
                  {{ getAssetTypeName(asset.asset_type) }}
                </a-tag>
              </div>
            </a-select-option>
          </a-select>
          <template
            v-if="selectedAsset"
            #extra
          >
            <div class="asset-info">
              <span>合约地址:
                {{ formatAddress(selectedAsset.contract_address) }}</span>
              <span style="margin-left: 16px">部署链: {{ getNetworkName(selectedAsset.chain_id) }}</span>
            </div>
          </template>
        </a-form-item>

        <!-- 源链和目标链 -->
        <a-row :gutter="16">
          <a-col :span="12">
            <a-form-item
              label="源链"
              required
            >
              <chain-selector
                v-model="form.fromChainId"
                :width="'100%'"
                :disabled="!form.assetId"
                @switched="handleFromChainChange"
              />
            </a-form-item>
          </a-col>

          <a-col :span="12">
            <a-form-item
              label="目标链"
              required
            >
              <chain-selector
                v-model="form.toChainId"
                :width="'100%'"
                :disabled="!form.assetId"
                @switched="handleToChainChange"
              />
            </a-form-item>
          </a-col>
        </a-row>

        <!-- 转移数量 -->
        <a-form-item
          label="转移数量"
          required
        >
          <a-input-number
            v-model:value="form.amount"
            :min="0"
            :max="availableBalance"
            :precision="selectedAsset?.decimals || 0"
            :style="{ width: '100%' }"
            placeholder="输入转移数量"
          >
            <template #addonAfter>
              <a-button
                type="link"
                size="small"
                @click="handleMaxAmount"
              >
                最大值
              </a-button>
            </template>
          </a-input-number>
          <template
            v-if="availableBalance !== null"
            #extra
          >
            可用余额: {{ availableBalance }} {{ selectedAsset?.symbol || "" }}
          </template>
        </a-form-item>

        <!-- 接收地址（可选） -->
        <a-form-item label="接收地址（可选）">
          <a-input
            v-model:value="form.recipientAddress"
            placeholder="默认使用相同地址，如需不同地址请输入"
            :maxlength="42"
          >
            <template #prefix>
              <user-outlined />
            </template>
          </a-input>
          <template #extra>
            留空则在目标链上使用相同的钱包地址接收
          </template>
        </a-form-item>

        <!-- 钱包选择 -->
        <a-form-item
          label="选择钱包"
          required
        >
          <wallet-selector
            v-model="form.walletId"
            :show-balance="true"
            :chain-id="form.fromChainId"
            :show-quick-actions="false"
          />
        </a-form-item>

        <!-- 钱包密码 -->
        <a-form-item
          label="钱包密码"
          required
        >
          <a-input-password
            v-model:value="form.password"
            placeholder="输入钱包密码以授权交易"
            autocomplete="new-password"
          >
            <template #prefix>
              <lock-outlined />
            </template>
          </a-input-password>
        </a-form-item>

        <!-- 费用预估 -->
        <a-divider />
        <div class="fee-summary">
          <h4>费用预估</h4>
          <a-descriptions
            :column="2"
            size="small"
            bordered
          >
            <a-descriptions-item label="源链 Gas">
              ~0.002 ETH
            </a-descriptions-item>
            <a-descriptions-item label="目标链 Gas">
              ~0.003 ETH
            </a-descriptions-item>
            <a-descriptions-item
              label="预计时间"
              :span="2"
            >
              2-5 分钟
            </a-descriptions-item>
          </a-descriptions>
        </div>
      </a-form>

      <!-- 操作按钮 -->
      <div class="actions">
        <a-space>
          <a-button @click="handleReset">
            重置
          </a-button>
          <a-button
            type="primary"
            size="large"
            :loading="transferring"
            :disabled="!canTransfer"
            @click="handleTransfer"
          >
            <template #icon>
              <swap-outlined />
            </template>
            开始跨链转移
          </a-button>
        </a-space>
      </div>
    </a-card>

    <!-- 进度对话框 -->
    <a-modal
      v-model:open="showProgressModal"
      title="跨链转移进度"
      :closable="false"
      :mask-closable="false"
      :footer="progressStep === 3 ? undefined : null"
    >
      <a-steps
        :current="progressStep"
        direction="vertical"
      >
        <a-step title="锁定资产">
          <template #description>
            <div v-if="progressStep >= 0">
              {{
                progressStep > 0 ? "✅ 已在源链锁定资产" : "正在源链锁定资产..."
              }}
              <div
                v-if="lockTxHash"
                class="tx-hash"
              >
                交易哈希: {{ formatAddress(lockTxHash) }}
              </div>
            </div>
          </template>
        </a-step>

        <a-step title="等待确认">
          <template #description>
            <div v-if="progressStep >= 1">
              {{ progressStep > 1 ? "✅ 交易已确认" : "等待区块确认..." }}
            </div>
          </template>
        </a-step>

        <a-step title="铸造资产">
          <template #description>
            <div v-if="progressStep >= 2">
              {{
                progressStep > 2
                  ? "✅ 已在目标链铸造资产"
                  : "正在目标链铸造资产..."
              }}
              <div
                v-if="mintTxHash"
                class="tx-hash"
              >
                交易哈希: {{ formatAddress(mintTxHash) }}
              </div>
            </div>
          </template>
        </a-step>

        <a-step
          title="完成"
          :status="progressStep === 3 ? 'finish' : 'wait'"
        >
          <template #description>
            <div v-if="progressStep === 3">
              🎉 跨链转移成功完成！
            </div>
          </template>
        </a-step>
      </a-steps>

      <template
        v-if="progressStep === 3"
        #footer
      >
        <a-button
          type="primary"
          @click="handleCloseProgress"
        >
          完成
        </a-button>
      </template>
    </a-modal>
  </div>
</template>

<script setup>
import { logger } from "@/utils/logger";

import { ref, computed, onMounted, watch } from "vue";
import { message } from "ant-design-vue";
import {
  SwapOutlined,
  ExperimentOutlined,
  UserOutlined,
  LockOutlined,
} from "@ant-design/icons-vue";
import { useBlockchainStore } from "@/stores/blockchain";
import WalletSelector from "./WalletSelector.vue";
import ChainSelector from "./ChainSelector.vue";

const blockchainStore = useBlockchainStore();

// 状态
const transferring = ref(false);
const showProgressModal = ref(false);
const progressStep = ref(0);
const lockTxHash = ref("");
const mintTxHash = ref("");
const availableBalance = ref(null);
const bridgeableAssets = ref([]);
const selectedAsset = ref(null);

// 表单数据
const form = ref({
  assetId: "",
  fromChainId: 31337,
  toChainId: 137,
  amount: 0,
  recipientAddress: "",
  walletId: "",
  password: "",
});

// 是否可以转移
const canTransfer = computed(() => {
  return (
    form.value.assetId &&
    form.value.fromChainId &&
    form.value.toChainId &&
    form.value.fromChainId !== form.value.toChainId &&
    form.value.amount > 0 &&
    form.value.walletId &&
    form.value.password.length >= 8
  );
});

/**
 * 加载可桥接的资产
 */
const loadBridgeableAssets = async () => {
  try {
    // 加载已部署到区块链的资产
    const assets = await window.electronAPI.blockchain.getDeployedAssets();

    // 过滤出支持桥接的资产（Token 和 NFT）
    bridgeableAssets.value = assets.filter(
      (asset) => asset.token_type === "ERC20" || asset.token_type === "ERC721",
    );
  } catch (error) {
    logger.error("[BridgeTransfer] 加载资产失败:", error);
  }
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
 * 获取资产类型名称
 */
const getAssetTypeName = (type) => {
  const names = {
    token: "Token",
    nft: "NFT",
    ERC20: "ERC-20",
    ERC721: "ERC-721",
  };
  return names[type] || type;
};

/**
 * 获取资产类型颜色
 */
const getAssetTypeColor = (type) => {
  const colors = {
    token: "blue",
    nft: "purple",
    ERC20: "blue",
    ERC721: "purple",
  };
  return colors[type] || "default";
};

/**
 * 获取网络名称
 */
const getNetworkName = (chainId) => {
  const network = blockchainStore.networks.find((n) => n.chainId === chainId);
  return network?.name || `Chain ${chainId}`;
};

/**
 * 资产变化处理
 */
const handleAssetChange = async (assetId) => {
  const asset = bridgeableAssets.value.find((a) => a.id === assetId);
  if (asset) {
    selectedAsset.value = asset;

    // 设置源链为资产部署的链
    form.value.fromChainId = asset.chain_id;

    // 查询可用余额
    await fetchAssetBalance();
  }
};

/**
 * 查询资产余额
 */
const fetchAssetBalance = async () => {
  if (!selectedAsset.value || !form.value.fromChainId || !form.value.walletId) {
    availableBalance.value = null;
    return;
  }

  try {
    // 获取钱包地址
    const wallet = blockchainStore.wallets.find(
      (w) => w.id === form.value.walletId,
    );
    if (!wallet) {
      availableBalance.value = null;
      return;
    }

    // 调用后端查询余额
    const balance = await window.electronAPI.bridge.getBalance({
      address: wallet.address,
      tokenAddress: selectedAsset.value.contract_address,
      chainId: form.value.fromChainId,
    });

    availableBalance.value = parseFloat(balance);
    logger.info("[BridgeTransfer] 余额查询成功:", availableBalance.value);
  } catch (error) {
    logger.error("[BridgeTransfer] 查询余额失败:", error);
    availableBalance.value = 1000; // 回退到模拟值
  }
};

/**
 * 源链变化处理
 */
const handleFromChainChange = async () => {
  // 重新查询余额
  await fetchAssetBalance();
};

/**
 * 目标链变化处理
 */
const handleToChainChange = () => {
  // 验证源链和目标链不相同
  if (form.value.fromChainId === form.value.toChainId) {
    message.warning("源链和目标链不能相同");
    form.value.toChainId = null;
  }
};

/**
 * 最大值处理
 */
const handleMaxAmount = () => {
  if (availableBalance.value !== null) {
    form.value.amount = availableBalance.value;
  }
};

/**
 * 重置表单
 */
const handleReset = () => {
  form.value = {
    assetId: "",
    fromChainId: 31337,
    toChainId: 137,
    amount: 0,
    recipientAddress: "",
    walletId: "",
    password: "",
  };
  selectedAsset.value = null;
  availableBalance.value = null;
};

/**
 * 执行跨链转移
 */
const handleTransfer = async () => {
  if (!canTransfer.value) {
    message.warning("请完善表单信息");
    return;
  }

  transferring.value = true;
  showProgressModal.value = true;
  progressStep.value = 0;
  lockTxHash.value = "";
  mintTxHash.value = "";

  try {
    const options = {
      assetId: form.value.assetId,
      fromChainId: form.value.fromChainId,
      toChainId: form.value.toChainId,
      amount: form.value.amount.toString(),
      walletId: form.value.walletId,
      password: form.value.password,
      recipientAddress: form.value.recipientAddress || null,
    };

    // 调用后端桥接功能
    const result = await window.electronAPI.bridge.transfer(options);

    // 更新进度
    if (result.from_tx_hash) {
      lockTxHash.value = result.from_tx_hash;
      progressStep.value = 1;
    }

    // 模拟等待确认
    await new Promise((resolve) => setTimeout(resolve, 2000));
    progressStep.value = 2;

    if (result.to_tx_hash) {
      mintTxHash.value = result.to_tx_hash;
      progressStep.value = 3;
    }

    message.success("跨链转移成功！");
  } catch (error) {
    logger.error("[BridgeTransfer] 转移失败:", error);
    message.error("跨链转移失败: " + error.message);
    showProgressModal.value = false;
  } finally {
    transferring.value = false;
  }
};

/**
 * 关闭进度对话框
 */
const handleCloseProgress = () => {
  showProgressModal.value = false;
  progressStep.value = 0;
  handleReset();
};

// 监听钱包变化
watch(
  () => form.value.walletId,
  () => {
    if (selectedAsset.value && form.value.fromChainId) {
      fetchAssetBalance();
    }
  },
);

// 生命周期
onMounted(() => {
  loadBridgeableAssets();

  // 自动选择当前钱包
  if (blockchainStore.currentWallet) {
    form.value.walletId = blockchainStore.currentWallet.id;
  }
});
</script>

<style scoped>
.bridge-transfer {
  max-width: 800px;
  margin: 0 auto;
}

.asset-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.asset-name {
  font-weight: 500;
}

.asset-info {
  font-size: 12px;
  color: #8c8c8c;
  margin-top: 4px;
}

.fee-summary {
  margin: 16px 0;
}

.fee-summary h4 {
  margin-bottom: 12px;
  font-weight: 500;
}

.actions {
  margin-top: 24px;
  text-align: right;
}

.tx-hash {
  font-family: "Courier New", monospace;
  font-size: 12px;
  color: #1890ff;
  margin-top: 4px;
}

:deep(.ant-descriptions-item-label) {
  font-weight: 500;
}
</style>
