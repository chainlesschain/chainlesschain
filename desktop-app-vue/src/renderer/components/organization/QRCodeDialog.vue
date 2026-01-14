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
      </a-space>

      <a-alert
        message="扫码加入"
        description="使用ChainlessChain移动应用扫描此二维码即可快速加入组织"
        type="info"
        show-icon
        style="margin-top: 16px"
      />
    </div>
  </a-modal>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue';
import { message } from 'ant-design-vue';
import { DownloadOutlined, CopyOutlined } from '@ant-design/icons-vue';
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
    default: '邀请链接二维码'
  }
});

const emit = defineEmits(['update:visible']);

const qrcodeRef = ref(null);

const visible = computed({
  get: () => props.visible,
  set: (val) => emit('update:visible', val)
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
    link.download = `invitation-qrcode-${Date.now()}.png`;
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
    const result = await window.electron.ipcRenderer.invoke(
      'org:copy-invitation-link',
      props.url
    );

    if (result.success) {
      message.success('链接已复制到剪贴板');
    } else {
      message.error('复制失败');
    }
  } catch (error) {
    console.error('复制链接失败:', error);
    message.error('复制链接失败');
  }
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
