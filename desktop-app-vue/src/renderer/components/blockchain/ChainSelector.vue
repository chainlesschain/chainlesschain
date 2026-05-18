<template>
  <div class="chain-selector">
    <a-select
      v-model:value="selectedChainId"
      :placeholder="placeholder"
      :loading="loading"
      :disabled="disabled"
      :size="size"
      :style="{ width: width }"
      @change="handleChange"
    >
      <template #suffixIcon>
        <global-outlined />
      </template>

      <!-- 主网选项组 -->
      <a-select-opt-group
        v-if="mainnetNetworks.length > 0"
        label="主网"
      >
        <a-select-option
          v-for="network in mainnetNetworks"
          :key="network.chainId"
          :value="network.chainId"
        >
          <div class="chain-option">
            <div class="chain-icon">
              <span class="chain-emoji">{{
                getChainEmoji(network.chainId)
              }}</span>
            </div>
            <div class="chain-info">
              <div class="chain-name">
                {{ network.name }}
                <a-tag
                  v-if="network.chainId === currentChainId"
                  color="green"
                  size="small"
                >
                  当前
                </a-tag>
              </div>
              <div class="chain-symbol">
                {{ network.symbol }}
              </div>
            </div>
          </div>
        </a-select-option>
      </a-select-opt-group>

      <!-- 测试网选项组 -->
      <a-select-opt-group
        v-if="testnetNetworks.length > 0"
        label="测试网"
      >
        <a-select-option
          v-for="network in testnetNetworks"
          :key="network.chainId"
          :value="network.chainId"
        >
          <div class="chain-option">
            <div class="chain-icon">
              <span class="chain-emoji">{{
                getChainEmoji(network.chainId)
              }}</span>
            </div>
            <div class="chain-info">
              <div class="chain-name">
                {{ network.name }}
                <a-tag
                  v-if="network.chainId === currentChainId"
                  color="green"
                  size="small"
                >
                  当前
                </a-tag>
              </div>
              <div class="chain-symbol">
                {{ network.symbol }}
              </div>
            </div>
          </div>
        </a-select-option>
      </a-select-opt-group>
    </a-select>

    <!-- 快捷操作 -->
    <div
      v-if="showQuickInfo"
      class="quick-info"
    >
      <a-space :size="8">
        <!-- 当前网络徽章 -->
        <a-badge
          :status="isTestnet ? 'warning' : 'success'"
          :text="currentNetworkName"
        />

        <!-- 区块浏览器链接 -->
        <a-button
          v-if="currentNetwork?.blockExplorer"
          type="link"
          size="small"
          @click="handleOpenBlockExplorer"
        >
          <link-outlined /> 浏览器
        </a-button>
      </a-space>
    </div>
  </div>
</template>

<script setup>
import { logger } from "@/utils/logger";

import { ref, computed, watch } from "vue";
import { message } from "ant-design-vue";
import { GlobalOutlined, LinkOutlined } from "@ant-design/icons-vue";
import { useBlockchainStore } from "@/stores/blockchain";

const props = defineProps({
  // v-model绑定值 (chainId)
  modelValue: {
    type: Number,
    default: null,
  },
  // 占位符
  placeholder: {
    type: String,
    default: "选择网络",
  },
  // 是否禁用
  disabled: {
    type: Boolean,
    default: false,
  },
  // 尺寸
  size: {
    type: String,
    default: "middle", // 'small' | 'middle' | 'large'
  },
  // 宽度
  width: {
    type: String,
    default: "200px",
  },
  // 是否显示快捷信息
  showQuickInfo: {
    type: Boolean,
    default: true,
  },
  // 是否只显示测试网
  testnetOnly: {
    type: Boolean,
    default: false,
  },
  // 是否只显示主网
  mainnetOnly: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["update:modelValue", "change", "switched"]);

const blockchainStore = useBlockchainStore();

// 状态
const loading = ref(false);

// 从 store 获取数据
const currentChainId = computed(() => blockchainStore.currentChainId);
const currentNetwork = computed(() => blockchainStore.currentNetwork);
const isTestnet = computed(() => blockchainStore.isTestnet);
const allNetworks = computed(() => blockchainStore.networks);

// 根据 props 过滤网络列表
const filteredNetworks = computed(() => {
  if (props.testnetOnly) {
    return allNetworks.value.filter((n) => n.testnet);
  }
  if (props.mainnetOnly) {
    return allNetworks.value.filter((n) => !n.testnet);
  }
  return allNetworks.value;
});

// 主网列表
const mainnetNetworks = computed(() => {
  return filteredNetworks.value.filter((n) => !n.testnet);
});

// 测试网列表
const testnetNetworks = computed(() => {
  return filteredNetworks.value.filter((n) => n.testnet);
});

// 当前网络名称
const currentNetworkName = computed(() => {
  return currentNetwork.value?.name || "未知网络";
});

// 双向绑定
const selectedChainId = computed({
  get: () => {
    return props.modelValue !== null ? props.modelValue : currentChainId.value;
  },
  set: (value) => {
    emit("update:modelValue", value);
  },
});

/**
 * 获取链图标 emoji
 */
const getChainEmoji = (chainId) => {
  const emojiMap = {
    1: "⟠", // 以太坊主网
    11155111: "🧪", // Sepolia 测试网
    137: "🟣", // Polygon 主网
    80001: "🟪", // Mumbai 测试网
    31337: "🏠", // Hardhat 本地网络
  };
  return emojiMap[chainId] || "🌐";
};

/**
 * 切换网络处理
 */
const handleChange = async (chainId) => {
  if (chainId === currentChainId.value) {
    return; // 已经在当前网络，不需要切换
  }

  loading.value = true;
  try {
    await blockchainStore.switchChain(chainId);

    const network = allNetworks.value.find((n) => n.chainId === chainId);
    message.success(`已切换到 ${network?.name || "未知网络"}`);

    emit("change", chainId);
    emit("switched", {
      chainId,
      network,
    });
  } catch (error) {
    logger.error("[ChainSelector] 切换网络失败:", error);
    message.error("切换网络失败: " + error.message);

    // 重置选择到当前网络
    selectedChainId.value = currentChainId.value;
  } finally {
    loading.value = false;
  }
};

/**
 * 打开区块浏览器
 */
const handleOpenBlockExplorer = () => {
  if (!currentNetwork.value?.blockExplorer) {
    message.warning("当前网络没有区块浏览器");
    return;
  }

  // 使用 Electron 的 shell.openExternal 打开外部链接
  if (window.electronAPI?.shell?.openExternal) {
    window.electronAPI.shell.openExternal(currentNetwork.value.blockExplorer);
  } else {
    // 降级方案：在新窗口打开
    window.open(currentNetwork.value.blockExplorer, "_blank");
  }
};

// 监听 store 中的 currentChainId 变化
watch(
  () => blockchainStore.currentChainId,
  (newChainId) => {
    if (props.modelValue === null) {
      // 如果没有外部控制，同步到 store 的值
      emit("update:modelValue", newChainId);
    }
  },
);
</script>

<style scoped>
.chain-selector {
  display: inline-flex;
  align-items: center;
  gap: 12px;
}

.chain-option {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 4px 0;
}

.chain-icon {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background-color: #f5f5f5;
}

.chain-emoji {
  font-size: 20px;
}

.chain-info {
  flex: 1;
  min-width: 0;
}

.chain-name {
  font-size: 14px;
  font-weight: 500;
  color: #262626;
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 2px;
}

.chain-symbol {
  font-size: 12px;
  color: #8c8c8c;
  font-family: "Courier New", monospace;
}

.quick-info {
  display: flex;
  align-items: center;
  padding-left: 12px;
  border-left: 1px solid #f0f0f0;
}

:deep(.ant-select-selector) {
  min-height: 36px;
}

:deep(.ant-select-selection-item) {
  display: flex;
  align-items: center;
}

:deep(.ant-select-item-group) {
  font-weight: 600;
  color: #262626;
}

:deep(.ant-badge-status-text) {
  font-size: 13px;
  color: #595959;
}
</style>
