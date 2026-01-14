<template>
  <a-modal
    v-model:open="visible"
    :title="title"
    width="500px"
    :footer="null"
  >
    <div class="qrcode-container">
      <div ref="qrcodeRef" class="qrcode-canvas"></div>

      <a-space direction="vertical" style="width: 100%; margin-top: 24px" :size="12">
        <a-button type="primary" block @click="downloadQRCode">
          <template #icon><DownloadOutlined /></template>
          下载二维码
        </a-button>
        <a-button block @click="copyLink">
          <template #icon><CopyOutlined /></template>
          复制链接
        </a-button>
        <a-button block @click="shareToSocial">
          <template #icon><ShareAltOutlined /></template>
          分享到社交网络
        </a-button>
      </a-space>

      <a-alert
        :message="alertMessage"
        :description="alertDescription"
        type="info"
        show-icon
        style="margin-top: 16px"
      />

      <!-- 订单详情预览 -->
      <a-card v-if="orderData" size="small" style="margin-top: 16px" title="订单信息">
        <a-descriptions :column="1" size="small">
          <a-descriptions-item label="订单类型">
            <a-tag :color="getOrderTypeColor(orderData.order_type)">
              {{ getOrderTypeLabel(orderData.order_type) }}
            </a-tag>
          </a-descriptions-item>
          <a-descriptions-item label="资产名称">
            {{ orderData.asset_name }}
          </a-descriptions-item>
          <a-descriptions-item label="单价">
            {{ orderData.price_amount }} {{ orderData.price_asset_symbol || 'CC' }}
          </a-descriptions-item>
          <a-descriptions-item label="数量">
            {{ orderData.quantity }}
          </a-descriptions-item>
          <a-descriptions-item label="总价">
            <strong style="color: #52c41a">
              {{ (orderData.price_amount * orderData.quantity).toFixed(2) }}
              {{ orderData.price_asset_symbol || 'CC' }}
            </strong>
          </a-descriptions-item>
        </a-descriptions>
      </a-card>
    </div>
  </a-modal>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue';
import { message } from 'ant-design-vue';
import { DownloadOutlined, CopyOutlined, ShareAltOutlined } from '@ant-design/icons-vue';
import QRCode from 'qrcode';

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  },
  url: {
    type: String,
    default: ''
  },
  title: {
    type: String,
    default: '订单二维码'
  },
  orderData: {
    type: Object,
    default: null
  },
  type: {
    type: String,
    default: 'order', // order, asset, contract
    validator: (value) => ['order', 'asset', 'contract'].includes(value)
  }
});

const emit = defineEmits(['update:visible']);

const qrcodeRef = ref(null);

const visible = computed({
  get: () => props.visible,
  set: (val) => emit('update:visible', val)
});

const alertMessage = computed(() => {
  const messages = {
    order: '扫码查看订单',
    asset: '扫码查看资产',
    contract: '扫码查看合约'
  };
  return messages[props.type] || '扫码查看详情';
});

const alertDescription = computed(() => {
  const descriptions = {
    order: '使用ChainlessChain移动应用扫描此二维码即可快速查看和购买订单',
    asset: '使用ChainlessChain移动应用扫描此二维码即可快速查看资产详情',
    contract: '使用ChainlessChain移动应用扫描此二维码即可快速查看合约详情'
  };
  return descriptions[props.type] || '使用ChainlessChain移动应用扫描此二维码';
});

const generateQRCode = async () => {
  if (!qrcodeRef.value || !props.url) return;

  try {
    // 清空之前的二维码
    qrcodeRef.value.innerHTML = '';

    // 生成新的二维码
    await QRCode.toCanvas(
      qrcodeRef.value,
      props.url,
      {
        width: 300,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      }
    );
  } catch (error) {
    console.error('生成二维码失败:', error);
    message.error('生成二维码失败');
  }
};

const downloadQRCode = () => {
  const canvas = qrcodeRef.value?.querySelector('canvas');
  if (!canvas) {
    message.error('二维码未生成');
    return;
  }

  try {
    const link = document.createElement('a');
    const filename = props.orderData
      ? `order-${props.orderData.id}-qrcode-${Date.now()}.png`
      : `qrcode-${Date.now()}.png`;
    link.download = filename;
    link.href = canvas.toDataURL('image/png');
    link.click();
    message.success('二维码已下载');
  } catch (error) {
    console.error('下载二维码失败:', error);
    message.error('下载二维码失败');
  }
};

const copyLink = async () => {
  try {
    await navigator.clipboard.writeText(props.url);
    message.success('链接已复制到剪贴板');
  } catch (error) {
    // Fallback to Electron IPC if clipboard API fails
    try {
      const result = await window.electron.ipcRenderer.invoke(
        'trade:copy-order-link',
        props.url
      );

      if (result.success) {
        message.success('链接已复制到剪贴板');
      } else {
        message.error('复制失败');
      }
    } catch (ipcError) {
      console.error('复制链接失败:', ipcError);
      message.error('复制链接失败');
    }
  }
};

const shareToSocial = async () => {
  try {
    if (!props.orderData) {
      message.warning('订单数据不完整');
      return;
    }

    const shareText = `【ChainlessChain订单分享】\n` +
      `${getOrderTypeLabel(props.orderData.order_type)}: ${props.orderData.asset_name}\n` +
      `单价: ${props.orderData.price_amount} ${props.orderData.price_asset_symbol || 'CC'}\n` +
      `数量: ${props.orderData.quantity}\n` +
      `总价: ${(props.orderData.price_amount * props.orderData.quantity).toFixed(2)} ${props.orderData.price_asset_symbol || 'CC'}\n` +
      `查看详情: ${props.url}`;

    // Try to use Web Share API if available
    if (navigator.share) {
      await navigator.share({
        title: '订单分享',
        text: shareText,
        url: props.url
      });
      message.success('分享成功');
    } else {
      // Fallback: copy to clipboard
      await navigator.clipboard.writeText(shareText);
      message.success('分享内容已复制到剪贴板');
    }
  } catch (error) {
    if (error.name !== 'AbortError') {
      console.error('分享失败:', error);
      message.error('分享失败');
    }
  }
};

// 工具函数
const getOrderTypeColor = (type) => {
  const colorMap = {
    sell: 'green',
    buy: 'blue',
    auction: 'purple',
    exchange: 'orange',
  };
  return colorMap[type] || 'default';
};

const getOrderTypeLabel = (type) => {
  const labelMap = {
    sell: '出售',
    buy: '求购',
    auction: '拍卖',
    exchange: '交换',
  };
  return labelMap[type] || type;
};

watch(() => props.visible, async (val) => {
  if (val) {
    await nextTick();
    await generateQRCode();
  }
});

watch(() => props.url, async () => {
  if (props.visible) {
    await nextTick();
    await generateQRCode();
  }
});
</script>

<style scoped lang="scss">
.qrcode-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 24px;

  .qrcode-canvas {
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 16px;
    background: white;
    border: 1px solid #d9d9d9;
    border-radius: 8px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }
}
</style>
