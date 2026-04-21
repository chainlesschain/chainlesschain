<template>
  <!-- 助记词显示模态框（新创建身份后） -->
  <a-modal
    v-model:open="showDisplayModal"
    title="备份助记词"
    :width="700"
    :closable="false"
    :mask-closable="false"
    :keyboard="false"
  >
    <template #footer>
      <a-space>
        <a-button @click="handleDownloadMnemonic">
          <DownloadOutlined /> 下载备份
        </a-button>
        <a-button type="primary" @click="handleCopyMnemonic">
          <CopyOutlined /> 复制助记词
        </a-button>
        <a-button
          type="primary"
          danger
          :disabled="!mnemonicCopied"
          @click="handleConfirmMnemonicBackup"
        >
          我已安全备份
        </a-button>
      </a-space>
    </template>

    <a-alert
      message="请妥善保管助记词！"
      description="助记词是恢复身份的唯一凭证。任何人获得助记词都可以完全控制您的身份。请将其保存在安全的地方，不要截图或发送给他人。"
      type="warning"
      show-icon
      style="margin-bottom: 24px"
    />

    <div class="mnemonic-display">
      <div class="mnemonic-grid">
        <div
          v-for="(word, index) in mnemonicWords"
          :key="index"
          class="mnemonic-word"
        >
          <span class="word-number">{{ index + 1 }}</span>
          <span class="word-text">{{ word }}</span>
        </div>
      </div>

      <a-divider />

      <div class="mnemonic-full">
        <a-typography-paragraph :copyable="{ text: generatedMnemonic }">
          <code>{{ generatedMnemonic }}</code>
        </a-typography-paragraph>
      </div>

      <a-alert
        v-if="mnemonicCopied"
        message="已复制到剪贴板"
        type="success"
        show-icon
        style="margin-top: 16px"
      />
    </div>
  </a-modal>

  <!-- 助记词导出模态框（导出现有身份） -->
  <a-modal
    v-model:open="showExportModal"
    title="导出助记词"
    :width="700"
    :footer="null"
  >
    <a-alert
      message="请确保周围环境安全！"
      description="助记词一旦泄露，您的身份将面临安全风险。请确保没有人在旁边，也没有摄像头或录屏软件正在运行。"
      type="error"
      show-icon
      style="margin-bottom: 24px"
    />

    <div class="mnemonic-export">
      <div class="mnemonic-grid">
        <div
          v-for="(word, index) in exportingMnemonic.split(' ')"
          :key="index"
          class="mnemonic-word"
        >
          <span class="word-number">{{ index + 1 }}</span>
          <span class="word-text">{{ word }}</span>
        </div>
      </div>

      <a-divider />

      <div class="mnemonic-full">
        <a-typography-paragraph :copyable="{ text: exportingMnemonic }">
          <code>{{ exportingMnemonic }}</code>
        </a-typography-paragraph>
      </div>

      <a-space style="margin-top: 24px; width: 100%; justify-content: center">
        <a-button type="primary" @click="handleCopyExportedMnemonic">
          <CopyOutlined /> 复制助记词
        </a-button>
        <a-button @click="handleDownloadExportedMnemonic">
          <DownloadOutlined /> 下载备份
        </a-button>
        <a-button danger @click="showExportModal = false"> 关闭 </a-button>
      </a-space>
    </div>
  </a-modal>
</template>

<script setup>
import { ref, h } from "vue";
import { message, Modal } from "ant-design-vue";
import {
  CopyOutlined,
  DownloadOutlined,
  WarningOutlined,
} from "@ant-design/icons-vue";
import { logger } from "@/utils/logger";

const showDisplayModal = ref(false);
const showExportModal = ref(false);

const generatedMnemonic = ref("");
const mnemonicWords = ref([]);
const mnemonicCopied = ref(false);

const exportingMnemonic = ref("");
const exportingIdentity = ref({ did: "", nickname: "" });

function showDisplay(mnemonic) {
  generatedMnemonic.value = mnemonic;
  mnemonicWords.value = mnemonic.split(" ");
  mnemonicCopied.value = false;
  showDisplayModal.value = true;
}

function triggerExport(identity) {
  if (!identity) {
    return;
  }

  Modal.confirm({
    title: "导出助记词",
    content:
      "助记词是恢复身份的唯一凭证，请务必妥善保管！任何人获得助记词都可以完全控制您的身份。确定要导出吗？",
    icon: h(WarningOutlined),
    okText: "确定导出",
    okType: "danger",
    cancelText: "取消",
    async onOk() {
      try {
        const mnemonic = await window.electronAPI.did.exportMnemonic(
          identity.did,
        );

        if (!mnemonic) {
          message.warning("该身份没有助记词备份");
          return;
        }

        exportingMnemonic.value = mnemonic;
        exportingIdentity.value = identity;
        showExportModal.value = true;
      } catch (error) {
        logger.error("导出助记词失败:", error);
        message.error("导出助记词失败: " + error.message);
      }
    },
  });
}

async function handleCopyMnemonic() {
  try {
    await navigator.clipboard.writeText(generatedMnemonic.value);
    mnemonicCopied.value = true;
    message.success("助记词已复制到剪贴板");
  } catch (error) {
    message.error("复制失败: " + error.message);
  }
}

function handleConfirmMnemonicBackup() {
  if (!mnemonicCopied.value) {
    Modal.warning({
      title: "请先复制助记词",
      content: "请务必复制并安全保存助记词，这是恢复身份的唯一方式！",
    });
    return;
  }

  showDisplayModal.value = false;
  message.success("助记词备份确认完成");
}

function handleDownloadMnemonic() {
  const blob = new Blob([generatedMnemonic.value], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `mnemonic-backup-${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  mnemonicCopied.value = true;
  message.success("助记词已下载");
}

async function handleCopyExportedMnemonic() {
  try {
    await navigator.clipboard.writeText(exportingMnemonic.value);
    message.success("助记词已复制到剪贴板");
  } catch (error) {
    message.error("复制失败: " + error.message);
  }
}

function handleDownloadExportedMnemonic() {
  const blob = new Blob([exportingMnemonic.value], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `mnemonic-${exportingIdentity.value.nickname}-${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  message.success("助记词已下载");
}

defineExpose({ showDisplay, triggerExport });
</script>

<style scoped>
.mnemonic-display,
.mnemonic-export {
  padding: 20px 0;
}

.mnemonic-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 20px;
}

.mnemonic-word {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  background: #f5f5f5;
  border: 1px solid #e8e8e8;
  border-radius: 4px;
  transition: all 0.2s;
}

.mnemonic-word:hover {
  background: #e8f4ff;
  border-color: #1890ff;
}

.word-number {
  font-size: 12px;
  color: #999;
  font-weight: 600;
  min-width: 24px;
}

.word-text {
  font-size: 14px;
  font-family: "Courier New", monospace;
  font-weight: 500;
  color: #333;
}

.mnemonic-full {
  background: #fafafa;
  padding: 16px;
  border-radius: 4px;
  border: 1px dashed #d9d9d9;
}

.mnemonic-full code {
  word-break: break-all;
  font-size: 13px;
  line-height: 1.8;
}

@media (max-width: 768px) {
  .mnemonic-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
