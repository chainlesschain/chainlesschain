<template>
  <a-modal
    :open="open"
    title="资产二维码"
    :footer="null"
    width="500px"
    @cancel="handleClose"
  >
    <div class="asset-qr-modal">
      <!-- 资产信息 -->
      <a-card :bordered="false" class="asset-info-card">
        <a-descriptions :column="1" size="small">
          <a-descriptions-item label="资产名称">
            <a-typography-text strong>{{ asset?.name }}</a-typography-text>
          </a-descriptions-item>
          <a-descriptions-item label="资产类型">
            <a-tag :color="getAssetTypeColor(asset?.asset_type)">
              {{ getAssetTypeText(asset?.asset_type) }}
            </a-tag>
          </a-descriptions-item>
          <a-descriptions-item label="资产ID">
            <a-typography-text copyable>{{ asset?.id }}</a-typography-text>
          </a-descriptions-item>
          <a-descriptions-item label="合约地址" v-if="asset?.contract_address">
            <a-typography-text copyable>
              {{ formatAddress(asset.contract_address) }}
            </a-typography-text>
          </a-descriptions-item>
        </a-descriptions>
      </a-card>

      <a-divider />

      <!-- 二维码显示 -->
      <div class="qr-code-container">
        <div class="qr-code-wrapper">
          <canvas ref="qrCanvas" class="qr-canvas"></canvas>
        </div>
        <p class="qr-hint">扫描二维码查看资产详情</p>
      </div>

      <!-- 操作按钮 -->
      <div class="action-buttons">
        <a-space :size="12">
          <a-button type="primary" @click="handleDownloadQR">
            <template #icon><download-outlined /></template>
            下载二维码
          </a-button>
          <a-button @click="handleCopyLink">
            <template #icon><copy-outlined /></template>
            复制链接
          </a-button>
          <a-button @click="handleShare">
            <template #icon><share-alt-outlined /></template>
            分享
          </a-button>
        </a-space>
      </div>
    </div>
  </a-modal>
</template>

<script setup>
import { ref, watch, nextTick } from 'vue';
import { message } from 'ant-design-vue';
import {
  DownloadOutlined,
  CopyOutlined,
  ShareAltOutlined,
} from '@ant-design/icons-vue';
import QRCode from 'qrcode';

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  asset: {
    type: Object,
    default: null,
  },
});

const emit = defineEmits(['update:open']);

const qrCanvas = ref(null);

/**
 * 生成二维码
 */
const generateQRCode = async () => {
  if (!props.asset || !qrCanvas.value) return;

  try {
    // 构建资产信息JSON
    const assetData = {
      id: props.asset.id,
      name: props.asset.name,
      type: props.asset.asset_type,
      contractAddress: props.asset.contract_address,
      chainId: props.asset.chain_id,
      // 可以添加更多信息
      timestamp: Date.now(),
    };

    // 生成资产链接（可以是应用内部链接或Web链接）
    const assetLink = `chainlesschain://asset/${props.asset.id}`;

    // 或者使用JSON字符串
    const qrData = JSON.stringify(assetData);

    // 生成二维码
    await QRCode.toCanvas(qrCanvas.value, assetLink, {
      width: 300,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#FFFFFF',
      },
      errorCorrectionLevel: 'H',
    });
  } catch (error) {
    console.error('生成二维码失败:', error);
    message.error('生成二维码失败');
  }
};

/**
 * 下载二维码
 */
const handleDownloadQR = () => {
  if (!qrCanvas.value) return;

  try {
    const link = document.createElement('a');
    link.download = `asset-${props.asset.id}-qr.png`;
    link.href = qrCanvas.value.toDataURL('image/png');
    link.click();
    message.success('二维码已下载');
  } catch (error) {
    console.error('下载二维码失败:', error);
    message.error('下载失败');
  }
};

/**
 * 复制链接
 */
const handleCopyLink = async () => {
  try {
    const assetLink = `chainlesschain://asset/${props.asset.id}`;
    await navigator.clipboard.writeText(assetLink);
    message.success('链接已复制到剪贴板');
  } catch (error) {
    console.error('复制链接失败:', error);
    message.error('复制失败');
  }
};

/**
 * 分享
 */
const handleShare = async () => {
  try {
    const assetData = {
      title: `资产: ${props.asset.name}`,
      text: `查看我的数字资产 - ${props.asset.name}`,
      url: `chainlesschain://asset/${props.asset.id}`,
    };

    if (navigator.share) {
      await navigator.share(assetData);
      message.success('分享成功');
    } else {
      // 降级方案：复制链接
      await handleCopyLink();
    }
  } catch (error) {
    if (error.name !== 'AbortError') {
      console.error('分享失败:', error);
      message.error('分享失败');
    }
  }
};

/**
 * 关闭对话框
 */
const handleClose = () => {
  emit('update:open', false);
};

/**
 * 格式化地址
 */
const formatAddress = (address) => {
  if (!address) return '';
  if (address.length <= 20) return address;
  return `${address.slice(0, 10)}...${address.slice(-8)}`;
};

/**
 * 获取资产类型颜色
 */
const getAssetTypeColor = (type) => {
  const colors = {
    token: 'blue',
    nft: 'purple',
    currency: 'green',
    commodity: 'orange',
    security: 'red',
  };
  return colors[type] || 'default';
};

/**
 * 获取资产类型文本
 */
const getAssetTypeText = (type) => {
  const texts = {
    token: '代币',
    nft: 'NFT',
    currency: '货币',
    commodity: '商品',
    security: '证券',
  };
  return texts[type] || type;
};

// 监听对话框打开状态
watch(
  () => props.open,
  async (newVal) => {
    if (newVal && props.asset) {
      await nextTick();
      await generateQRCode();
    }
  },
  { immediate: true }
);
</script>

<style scoped>
.asset-qr-modal {
  padding: 12px 0;
}

.asset-info-card {
  background: #fafafa;
  border-radius: 8px;
}

.qr-code-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 24px 0;
}

.qr-code-wrapper {
  padding: 20px;
  background: white;
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.qr-canvas {
  display: block;
  border-radius: 8px;
}

.qr-hint {
  margin-top: 16px;
  color: #8c8c8c;
  font-size: 14px;
  text-align: center;
}

.action-buttons {
  display: flex;
  justify-content: center;
  margin-top: 24px;
}
</style>
