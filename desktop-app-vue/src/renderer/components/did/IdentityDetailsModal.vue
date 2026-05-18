<template>
  <!-- 身份详情模态框 -->
  <a-modal
    v-model:open="showDetailsModal"
    :title="currentIdentity?.nickname + ' - 身份详情'"
    :width="800"
    :footer="null"
  >
    <div v-if="currentIdentity" class="identity-details">
      <a-descriptions bordered :column="1">
        <a-descriptions-item label="DID 标识符">
          <a-typography-paragraph
            :copyable="{ text: currentIdentity.did }"
            style="margin: 0"
          >
            {{ currentIdentity.did }}
          </a-typography-paragraph>
        </a-descriptions-item>

        <a-descriptions-item label="昵称">
          {{ currentIdentity.nickname }}
        </a-descriptions-item>

        <a-descriptions-item label="个人简介">
          {{ currentIdentity.bio || "无" }}
        </a-descriptions-item>

        <a-descriptions-item label="签名公钥">
          <a-typography-paragraph
            :copyable="{ text: currentIdentity.public_key_sign }"
            style="margin: 0"
          >
            <code>{{ currentIdentity.public_key_sign }}</code>
          </a-typography-paragraph>
        </a-descriptions-item>

        <a-descriptions-item label="加密公钥">
          <a-typography-paragraph
            :copyable="{ text: currentIdentity.public_key_encrypt }"
            style="margin: 0"
          >
            <code>{{ currentIdentity.public_key_encrypt }}</code>
          </a-typography-paragraph>
        </a-descriptions-item>

        <a-descriptions-item label="创建时间">
          {{ formatDate(currentIdentity.created_at) }}
        </a-descriptions-item>

        <a-descriptions-item label="默认身份">
          <a-tag :color="currentIdentity.is_default ? 'green' : 'default'">
            {{ currentIdentity.is_default ? "是" : "否" }}
          </a-tag>
        </a-descriptions-item>

        <a-descriptions-item label="DHT 发布状态">
          <a-space>
            <a-tag
              :color="currentIdentity.dhtPublished ? 'success' : 'default'"
            >
              {{
                currentIdentity.dhtPublished ? "已发布到 DHT 网络" : "未发布"
              }}
            </a-tag>
            <a-button
              v-if="!currentIdentity.dhtPublished"
              type="primary"
              size="small"
              :loading="publishing"
              @click="handlePublishToDHT"
            >
              发布到 DHT
            </a-button>
            <a-button
              v-else
              danger
              size="small"
              :loading="unpublishing"
              @click="handleUnpublishFromDHT"
            >
              取消发布
            </a-button>
          </a-space>
        </a-descriptions-item>

        <a-descriptions-item label="助记词备份">
          <a-space>
            <a-tag
              :color="currentIdentity.hasMnemonicBackup ? 'success' : 'warning'"
            >
              <SafetyOutlined v-if="currentIdentity.hasMnemonicBackup" />
              <WarningOutlined v-else />
              {{ currentIdentity.hasMnemonicBackup ? "已备份" : "未备份" }}
            </a-tag>
            <a-button
              v-if="currentIdentity.hasMnemonicBackup"
              type="primary"
              danger
              size="small"
              @click="handleExportMnemonic"
            >
              <KeyOutlined /> 导出助记词
            </a-button>
            <a-alert
              v-else
              message="该身份没有助记词备份"
              type="warning"
              show-icon
              banner
              style="margin-top: 8px"
            />
          </a-space>
        </a-descriptions-item>
      </a-descriptions>

      <a-divider />

      <div class="actions-section">
        <a-space>
          <a-button @click="handleViewDIDDocument">
            <template #icon>
              <FileTextOutlined />
            </template>
            查看 DID 文档
          </a-button>
          <a-button @click="handleExportDocument">
            <template #icon>
              <DownloadOutlined />
            </template>
            导出 DID 文档
          </a-button>
          <a-button type="primary" @click="openQR(currentIdentity.did)">
            <template #icon>
              <QrcodeOutlined />
            </template>
            生成二维码
          </a-button>
        </a-space>
      </div>
    </div>
  </a-modal>

  <!-- DID 文档查看器 -->
  <a-modal
    v-model:open="showDocumentModal"
    title="DID 文档"
    :width="800"
    :footer="null"
  >
    <a-typography>
      <pre class="did-document">{{ JSON.stringify(didDocument, null, 2) }}</pre>
    </a-typography>
    <a-button type="primary" @click="handleCopyDocument">
      <template #icon>
        <CopyOutlined />
      </template>
      复制 JSON
    </a-button>
  </a-modal>

  <!-- 二维码模态框 -->
  <a-modal
    v-model:open="showQRModal"
    title="DID 身份二维码"
    :width="500"
    :footer="null"
  >
    <div class="qr-container">
      <div id="qrcode" ref="qrcodeContainer" />
      <p class="qr-hint">扫描此二维码可快速添加为联系人</p>
      <a-button type="primary" block @click="handleSaveQR">
        <template #icon>
          <DownloadOutlined />
        </template>
        保存二维码
      </a-button>
    </div>
  </a-modal>
</template>

<script setup>
import { ref } from "vue";
import { message, Modal } from "ant-design-vue";
import {
  CopyOutlined,
  DownloadOutlined,
  FileTextOutlined,
  KeyOutlined,
  QrcodeOutlined,
  SafetyOutlined,
  WarningOutlined,
} from "@ant-design/icons-vue";
import QRCode from "qrcode";
import { logger } from "@/utils/logger";

const emit = defineEmits(["identities-refreshed", "export-mnemonic"]);

const showDetailsModal = ref(false);
const showDocumentModal = ref(false);
const showQRModal = ref(false);

const currentIdentity = ref(null);
const didDocument = ref(null);
const qrcodeContainer = ref(null);

const publishing = ref(false);
const unpublishing = ref(false);

function open(identity) {
  currentIdentity.value = identity;
  showDetailsModal.value = true;
}

async function openQR(did) {
  try {
    const qrData = await window.electronAPI.did.generateQRCode(did);
    showQRModal.value = true;

    // 等待 DOM 更新
    setTimeout(async () => {
      const container = document.getElementById("qrcode");
      if (container) {
        container.replaceChildren();
        await QRCode.toCanvas(qrData, {
          errorCorrectionLevel: "M",
          width: 300,
          margin: 2,
        }).then((canvas) => {
          container.appendChild(canvas);
        });
      }
    }, 100);
  } catch (error) {
    message.error("生成二维码失败: " + error.message);
  }
}

async function handleViewDIDDocument() {
  try {
    const doc = await window.electronAPI.did.exportDocument(
      currentIdentity.value.did,
    );
    didDocument.value = doc;
    showDocumentModal.value = true;
  } catch (error) {
    message.error("获取 DID 文档失败: " + error.message);
  }
}

async function handleExportDocument() {
  try {
    const doc = await window.electronAPI.did.exportDocument(
      currentIdentity.value.did,
    );
    const blob = new Blob([JSON.stringify(doc, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `did-document-${currentIdentity.value.nickname}.json`;
    a.click();
    URL.revokeObjectURL(url);
    message.success("DID 文档已导出");
  } catch (error) {
    message.error("导出失败: " + error.message);
  }
}

function handleCopyDocument() {
  const text = JSON.stringify(didDocument.value, null, 2);
  navigator.clipboard.writeText(text);
  message.success("已复制到剪贴板");
}

function handleSaveQR() {
  const canvas = document.querySelector("#qrcode canvas");
  if (canvas) {
    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `did-qrcode-${Date.now()}.png`;
      a.click();
      URL.revokeObjectURL(url);
      message.success("二维码已保存");
    });
  }
}

async function handlePublishToDHT() {
  if (!currentIdentity.value) {
    return;
  }

  publishing.value = true;
  try {
    const result = await window.electronAPI.did.publishToDHT(
      currentIdentity.value.did,
    );
    message.success("DID 已成功发布到 DHT 网络");
    logger.info("发布结果:", result);

    currentIdentity.value.dhtPublished = true;
    emit("identities-refreshed");
  } catch (error) {
    logger.error("发布失败:", error);
    message.error("发布失败: " + error.message);
  } finally {
    publishing.value = false;
  }
}

async function handleUnpublishFromDHT() {
  if (!currentIdentity.value) {
    return;
  }

  Modal.confirm({
    title: "确认取消发布",
    content: "取消发布后，其他节点将无法通过 DHT 解析您的 DID，确定要继续吗？",
    okText: "确定",
    okType: "danger",
    cancelText: "取消",
    async onOk() {
      unpublishing.value = true;
      try {
        await window.electronAPI.did.unpublishFromDHT(
          currentIdentity.value.did,
        );
        message.success("DID 已从 DHT 网络取消发布");

        currentIdentity.value.dhtPublished = false;
        emit("identities-refreshed");
      } catch (error) {
        logger.error("取消发布失败:", error);
        message.error("取消发布失败: " + error.message);
      } finally {
        unpublishing.value = false;
      }
    },
  });
}

function handleExportMnemonic() {
  if (!currentIdentity.value) {
    return;
  }
  emit("export-mnemonic", currentIdentity.value);
}

function formatDate(timestamp) {
  if (!timestamp) {
    return "未知";
  }
  const date = new Date(timestamp);
  return date.toLocaleString("zh-CN");
}

defineExpose({ open, openQR });
</script>

<style scoped>
.identity-details {
  padding: 10px 0;
}

.actions-section {
  margin-top: 20px;
}

.did-document {
  background: #f5f5f5;
  padding: 16px;
  border-radius: 4px;
  font-size: 12px;
  line-height: 1.6;
  max-height: 500px;
  overflow: auto;
  margin-bottom: 16px;
}

.qr-container {
  text-align: center;
}

#qrcode {
  display: flex;
  justify-content: center;
  align-items: center;
}

.qr-hint {
  color: #999;
  font-size: 14px;
  margin: 16px 0;
}
</style>
