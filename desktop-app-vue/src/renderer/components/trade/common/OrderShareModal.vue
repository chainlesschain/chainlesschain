<template>
  <a-modal
    v-model:visible="visible"
    title="分享订单"
    width="600px"
    :footer="null"
  >
    <div class="share-container">
      <!-- 分享方式选择 -->
      <a-tabs v-model:activeKey="shareMethod">
        <a-tab-pane key="link" tab="链接分享">
          <a-space direction="vertical" style="width: 100%" :size="16">
            <a-alert
              message="生成分享链接"
              description="生成一个可以分享给他人的订单链接，任何人都可以通过此链接查看订单详情"
              type="info"
              show-icon
            />

            <a-input-group compact>
              <a-input
                v-model:value="shareLink"
                readonly
                style="width: calc(100% - 100px)"
                placeholder="点击生成链接按钮"
              />
              <a-button type="primary" @click="generateShareLink">
                <template #icon><LinkOutlined /></template>
                生成链接
              </a-button>
            </a-input-group>

            <a-space>
              <a-button @click="copyShareLink" :disabled="!shareLink">
                <template #icon><CopyOutlined /></template>
                复制链接
              </a-button>
              <a-button @click="showQRCode" :disabled="!shareLink">
                <template #icon><QrcodeOutlined /></template>
                显示二维码
              </a-button>
            </a-space>

            <!-- 链接设置 -->
            <a-card size="small" title="链接设置">
              <a-form layout="vertical">
                <a-form-item label="有效期">
                  <a-select v-model:value="linkExpiry" style="width: 100%">
                    <a-select-option value="1h">1小时</a-select-option>
                    <a-select-option value="24h">24小时</a-select-option>
                    <a-select-option value="7d">7天</a-select-option>
                    <a-select-option value="30d">30天</a-select-option>
                    <a-select-option value="never">永久</a-select-option>
                  </a-select>
                </a-form-item>
                <a-form-item label="访问权限">
                  <a-radio-group v-model:value="linkPermission">
                    <a-radio value="public">公开 - 任何人可访问</a-radio>
                    <a-radio value="private">私密 - 需要验证身份</a-radio>
                  </a-radio-group>
                </a-form-item>
              </a-form>
            </a-card>
          </a-space>
        </a-tab-pane>

        <a-tab-pane key="social" tab="社交分享">
          <a-space direction="vertical" style="width: 100%" :size="16">
            <a-alert
              message="分享到社交网络"
              description="将订单信息分享到ChainlessChain社交网络或其他平台"
              type="info"
              show-icon
            />

            <!-- 分享内容预览 -->
            <a-card size="small" title="分享内容预览">
              <div class="share-preview">
                <div class="preview-title">
                  {{ getOrderTypeLabel(order.order_type) }}: {{ order.asset_name }}
                </div>
                <div class="preview-content">
                  <p><strong>单价:</strong> {{ order.price_amount }} {{ order.price_asset_symbol || 'CC' }}</p>
                  <p><strong>数量:</strong> {{ order.quantity }}</p>
                  <p><strong>总价:</strong> {{ (order.price_amount * order.quantity).toFixed(2) }} {{ order.price_asset_symbol || 'CC' }}</p>
                  <p v-if="order.description"><strong>描述:</strong> {{ order.description }}</p>
                </div>
              </div>
            </a-card>

            <!-- 分享平台选择 -->
            <a-space wrap :size="12">
              <a-button @click="shareToInternalSocial" type="primary">
                <template #icon><TeamOutlined /></template>
                分享到社交网络
              </a-button>
              <a-button @click="shareToClipboard">
                <template #icon><CopyOutlined /></template>
                复制分享文本
              </a-button>
            </a-space>
          </a-space>
        </a-tab-pane>

        <a-tab-pane key="export" tab="导出订单">
          <a-space direction="vertical" style="width: 100%" :size="16">
            <a-alert
              message="导出订单数据"
              description="将订单信息导出为文件，方便保存和分享"
              type="info"
              show-icon
            />

            <a-space wrap :size="12}>
              <a-button @click="exportAsJSON">
                <template #icon><FileTextOutlined /></template>
                导出为 JSON
              </a-button>
              <a-button @click="exportAsCSV">
                <template #icon><FileExcelOutlined /></template>
                导出为 CSV
              </a-button>
              <a-button @click="exportAsPDF">
                <template #icon><FilePdfOutlined /></template>
                导出为 PDF
              </a-button>
              <a-button @click="exportAsImage">
                <template #icon><PictureOutlined /></template>
                导出为图片
              </a-button>
            </a-space>
          </a-space>
        </a-tab-pane>
      </a-tabs>
    </div>
  </a-modal>

  <!-- QR Code Dialog -->
  <order-qr-code-dialog
    v-model:visible="showQRCodeDialog"
    :url="shareLink"
    :order-data="order"
    title="订单二维码"
    type="order"
  />
</template>

<script setup>
import { ref, computed } from 'vue';
import { message } from 'ant-design-vue';
import {
  LinkOutlined,
  CopyOutlined,
  QrcodeOutlined,
  TeamOutlined,
  FileTextOutlined,
  FileExcelOutlined,
  FilePdfOutlined,
  PictureOutlined,
} from '@ant-design/icons-vue';
import OrderQRCodeDialog from './OrderQRCodeDialog.vue';

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  },
  order: {
    type: Object,
    required: true
  }
});

const emit = defineEmits(['update:visible', 'shared']);

const visible = computed({
  get: () => props.visible,
  set: (val) => emit('update:visible', val)
});

const shareMethod = ref('link');
const shareLink = ref('');
const linkExpiry = ref('7d');
const linkPermission = ref('public');
const showQRCodeDialog = ref(false);

// 生成分享链接
const generateShareLink = async () => {
  try {
    const result = await window.electron.ipcRenderer.invoke('trade:generate-share-link', {
      orderId: props.order.id,
      expiry: linkExpiry.value,
      permission: linkPermission.value
    });

    if (result.success) {
      shareLink.value = result.link;
      message.success('分享链接已生成');
    } else {
      message.error(result.error || '生成链接失败');
    }
  } catch (error) {
    console.error('生成分享链接失败:', error);
    // Fallback: generate local link
    const baseUrl = 'chainlesschain://order/';
    shareLink.value = `${baseUrl}${props.order.id}`;
    message.success('分享链接已生成（本地模式）');
  }
};

// 复制分享链接
const copyShareLink = async () => {
  try {
    await navigator.clipboard.writeText(shareLink.value);
    message.success('链接已复制到剪贴板');
  } catch (error) {
    console.error('复制链接失败:', error);
    message.error('复制链接失败');
  }
};

// 显示二维码
const showQRCode = () => {
  showQRCodeDialog.value = true;
};

// 分享到内部社交网络
const shareToInternalSocial = async () => {
  try {
    const shareContent = {
      type: 'order',
      orderId: props.order.id,
      title: `${getOrderTypeLabel(props.order.order_type)}: ${props.order.asset_name}`,
      content: `单价: ${props.order.price_amount} ${props.order.price_asset_symbol || 'CC'}\n` +
               `数量: ${props.order.quantity}\n` +
               `总价: ${(props.order.price_amount * props.order.quantity).toFixed(2)} ${props.order.price_asset_symbol || 'CC'}`,
      link: shareLink.value || `chainlesschain://order/${props.order.id}`
    };

    const result = await window.electron.ipcRenderer.invoke('social:share-post', shareContent);

    if (result.success) {
      message.success('已分享到社交网络');
      emit('shared', { method: 'social', data: shareContent });
    } else {
      message.error(result.error || '分享失败');
    }
  } catch (error) {
    console.error('分享到社交网络失败:', error);
    message.error('分享失败');
  }
};

// 复制分享文本
const shareToClipboard = async () => {
  try {
    const shareText = `【ChainlessChain订单分享】\n\n` +
      `${getOrderTypeLabel(props.order.order_type)}: ${props.order.asset_name}\n` +
      `单价: ${props.order.price_amount} ${props.order.price_asset_symbol || 'CC'}\n` +
      `数量: ${props.order.quantity}\n` +
      `总价: ${(props.order.price_amount * props.order.quantity).toFixed(2)} ${props.order.price_asset_symbol || 'CC'}\n` +
      (props.order.description ? `\n描述: ${props.order.description}\n` : '') +
      `\n查看详情: ${shareLink.value || `chainlesschain://order/${props.order.id}`}`;

    await navigator.clipboard.writeText(shareText);
    message.success('分享文本已复制到剪贴板');
  } catch (error) {
    console.error('复制分享文本失败:', error);
    message.error('复制失败');
  }
};

// 导出为 JSON
const exportAsJSON = () => {
  try {
    const data = JSON.stringify(props.order, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `order-${props.order.id}-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
    message.success('订单已导出为 JSON');
  } catch (error) {
    console.error('导出 JSON 失败:', error);
    message.error('导出失败');
  }
};

// 导出为 CSV
const exportAsCSV = () => {
  try {
    const headers = ['字段', '值'];
    const rows = [
      ['订单ID', props.order.id],
      ['订单类型', getOrderTypeLabel(props.order.order_type)],
      ['资产名称', props.order.asset_name],
      ['资产符号', props.order.asset_symbol || '-'],
      ['单价', props.order.price_amount],
      ['价格资产', props.order.price_asset_symbol || 'CC'],
      ['数量', props.order.quantity],
      ['总价', (props.order.price_amount * props.order.quantity).toFixed(2)],
      ['状态', props.order.status],
      ['卖家DID', props.order.seller_did],
      ['创建时间', new Date(props.order.created_at).toLocaleString('zh-CN')],
      ['描述', props.order.description || '-']
    ];

    const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `order-${props.order.id}-${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    message.success('订单已导出为 CSV');
  } catch (error) {
    console.error('导出 CSV 失败:', error);
    message.error('导出失败');
  }
};

// 导出为 PDF
const exportAsPDF = async () => {
  try {
    const result = await window.electron.ipcRenderer.invoke('trade:export-order-pdf', {
      order: props.order
    });

    if (result.success) {
      message.success('订单已导出为 PDF');
    } else {
      message.error(result.error || '导出失败');
    }
  } catch (error) {
    console.error('导出 PDF 失败:', error);
    message.warning('PDF导出功能需要后端支持，已复制订单信息到剪贴板');
    // Fallback: copy order info
    await shareToClipboard();
  }
};

// 导出为图片
const exportAsImage = async () => {
  try {
    const result = await window.electron.ipcRenderer.invoke('trade:export-order-image', {
      order: props.order
    });

    if (result.success) {
      message.success('订单已导出为图片');
    } else {
      message.error(result.error || '导出失败');
    }
  } catch (error) {
    console.error('导出图片失败:', error);
    message.warning('图片导出功能需要后端支持，请使用二维码功能');
  }
};

// 工具函数
const getOrderTypeLabel = (type) => {
  const labelMap = {
    sell: '出售',
    buy: '求购',
    auction: '拍卖',
    exchange: '交换',
  };
  return labelMap[type] || type;
};
</script>

<style scoped lang="scss">
.share-container {
  padding: 8px 0;
}

.share-preview {
  .preview-title {
    font-size: 16px;
    font-weight: 600;
    color: #262626;
    margin-bottom: 12px;
  }

  .preview-content {
    font-size: 14px;
    color: #595959;
    line-height: 1.8;

    p {
      margin-bottom: 8px;

      strong {
        color: #262626;
        margin-right: 8px;
      }
    }
  }
}
</style>
