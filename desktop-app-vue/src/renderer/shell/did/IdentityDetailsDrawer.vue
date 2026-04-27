<template>
  <a-drawer
    :open="store.viewingDid !== null"
    :width="640"
    :mask-closable="true"
    :body-style="{ paddingBottom: '64px' }"
    :title="drawerTitle"
    placement="right"
    @close="store.closeDetails()"
  >
    <a-spin :spinning="store.detailsLoading">
      <div v-if="identity" class="details-body">
        <a-descriptions bordered :column="1" size="small">
          <a-descriptions-item label="DID 标识符">
            <a-typography-paragraph
              :copyable="{ text: String(identity.did) }"
              style="margin: 0; word-break: break-all"
            >
              <code>{{ identity.did }}</code>
            </a-typography-paragraph>
          </a-descriptions-item>

          <a-descriptions-item label="昵称">
            {{
              pickString(identity, ["nickname", "displayName"]) || "(未命名)"
            }}
          </a-descriptions-item>

          <a-descriptions-item label="个人简介">
            {{ pickString(identity, ["bio"]) || "无" }}
          </a-descriptions-item>

          <a-descriptions-item label="签名公钥">
            <a-typography-paragraph
              v-if="signKey"
              :copyable="{ text: signKey }"
              style="margin: 0; word-break: break-all"
            >
              <code>{{ signKey }}</code>
            </a-typography-paragraph>
            <span v-else class="muted">—</span>
          </a-descriptions-item>

          <a-descriptions-item label="加密公钥">
            <a-typography-paragraph
              v-if="encryptKey"
              :copyable="{ text: encryptKey }"
              style="margin: 0; word-break: break-all"
            >
              <code>{{ encryptKey }}</code>
            </a-typography-paragraph>
            <span v-else class="muted">—</span>
          </a-descriptions-item>

          <a-descriptions-item label="创建时间">
            {{ formatTimestamp(identity) }}
          </a-descriptions-item>

          <a-descriptions-item label="默认身份">
            <a-tag :color="isDefault ? 'green' : 'default'">
              {{ isDefault ? "是" : "否" }}
            </a-tag>
          </a-descriptions-item>

          <a-descriptions-item label="DHT 发布状态">
            <a-space wrap>
              <a-tag :color="isPublished ? 'success' : 'default'">
                {{ isPublished ? "已发布到 DHT 网络" : "未发布" }}
              </a-tag>
              <a-button
                v-if="!isPublished"
                type="primary"
                size="small"
                :loading="store.publishingDid === store.viewingDid"
                @click="onPublish"
              >
                发布到 DHT
              </a-button>
              <a-button
                v-else
                danger
                size="small"
                :loading="store.unpublishingDid === store.viewingDid"
                @click="onUnpublish"
              >
                取消发布
              </a-button>
            </a-space>
          </a-descriptions-item>
        </a-descriptions>

        <a-alert
          v-if="store.detailsError"
          class="details-error"
          :message="store.detailsError"
          type="error"
          show-icon
          closable
          @close="store.clearDetailsError()"
        />

        <a-divider>DID 文档</a-divider>

        <div class="document-block">
          <a-space>
            <a-button :loading="loadingDoc" @click="onViewDocument">
              <FileTextOutlined />
              {{ store.viewingDocument ? "重新加载" : "加载并查看" }}
            </a-button>
            <a-button v-if="store.viewingDocument" @click="onCopyDocument">
              <CopyOutlined /> 复制 JSON
            </a-button>
            <a-button v-if="store.viewingDocument" @click="onExportDocument">
              <DownloadOutlined /> 导出文件
            </a-button>
          </a-space>
          <pre v-if="store.viewingDocument" class="did-document">{{
            documentJson
          }}</pre>
        </div>

        <a-divider>二维码</a-divider>

        <div class="qr-block">
          <a-button type="primary" @click="onShowQR">
            <QrcodeOutlined /> 生成二维码
          </a-button>
          <p class="muted">扫描二维码可快速添加为联系人。</p>
        </div>
      </div>
    </a-spin>
  </a-drawer>

  <!-- QR sub-modal (canvas DOM op kept here, not in store) -->
  <a-modal
    v-model:open="qrOpen"
    :width="420"
    :footer="null"
    title="DID 身份二维码"
    @close="onCloseQR"
  >
    <div class="qr-modal-body">
      <div ref="qrcodeContainer" class="qr-canvas-host" />
      <p class="muted">扫描此二维码可快速添加为联系人</p>
      <a-button v-if="qrRendered" type="primary" block @click="onSaveQR">
        <DownloadOutlined /> 保存二维码
      </a-button>
    </div>
  </a-modal>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { Modal, message as antMessage } from "ant-design-vue";
import {
  CopyOutlined,
  DownloadOutlined,
  FileTextOutlined,
  QrcodeOutlined,
} from "@ant-design/icons-vue";
import QRCode from "qrcode";
import { useDIDManagementStore } from "../../stores/didManagement";

const store = useDIDManagementStore();

const loadingDoc = ref(false);
const qrOpen = ref(false);
const qrRendered = ref(false);
const qrcodeContainer = ref<HTMLDivElement | null>(null);

const identity = computed(() => store.viewingIdentity);

const drawerTitle = computed(() => {
  const nick = pickString(identity.value, ["nickname", "displayName"]);
  return nick ? `${nick} · 身份详情` : "身份详情";
});

const signKey = computed(() =>
  pickString(identity.value, ["public_key_sign", "publicKeySign", "publicKey"]),
);
const encryptKey = computed(() =>
  pickString(identity.value, ["public_key_encrypt", "publicKeyEncrypt"]),
);
const isDefault = computed(() => {
  const raw =
    identity.value &&
    (identity.value.is_default ?? identity.value.isDefault ?? false);
  return raw === true || raw === 1;
});
const isPublished = computed(() => {
  const did = store.viewingDid;
  return did ? store.publishStatus[did] === true : false;
});

const documentJson = computed(() =>
  store.viewingDocument == null
    ? ""
    : JSON.stringify(store.viewingDocument, null, 2),
);

watch(
  () => store.viewingDid,
  (did) => {
    if (!did) {
      qrOpen.value = false;
      qrRendered.value = false;
    }
  },
);

function pickString(
  obj: Record<string, unknown> | null | undefined,
  keys: string[],
): string {
  if (!obj) {
    return "";
  }
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.length > 0) {
      return v;
    }
  }
  return "";
}

function formatTimestamp(obj: Record<string, unknown> | null): string {
  if (!obj) {
    return "—";
  }
  const raw = obj.created_at ?? obj.createdAt;
  if (raw === undefined || raw === null) {
    return "—";
  }
  const d = new Date(raw as string | number);
  if (Number.isNaN(d.getTime())) {
    return String(raw);
  }
  return d.toLocaleString("zh-CN");
}

async function onPublish(): Promise<void> {
  if (!store.viewingDid) {
    return;
  }
  const ok = await store.publishToDHT(store.viewingDid);
  if (ok) {
    antMessage.success("DID 已发布到 DHT 网络");
  } else {
    antMessage.error(`发布失败: ${store.detailsError ?? "未知错误"}`);
  }
}

function onUnpublish(): void {
  if (!store.viewingDid) {
    return;
  }
  Modal.confirm({
    title: "确认取消发布",
    content: "取消发布后，其他节点将无法通过 DHT 解析您的 DID，确定要继续吗？",
    okText: "取消发布",
    okType: "danger",
    cancelText: "保留",
    async onOk() {
      const ok = await store.unpublishFromDHT(store.viewingDid!);
      if (ok) {
        antMessage.success("DID 已从 DHT 网络取消发布");
      } else {
        antMessage.error(`取消发布失败: ${store.detailsError ?? "未知错误"}`);
      }
    },
  });
}

async function onViewDocument(): Promise<void> {
  if (!store.viewingDid) {
    return;
  }
  loadingDoc.value = true;
  await store.loadDocument(store.viewingDid);
  loadingDoc.value = false;
}

async function onCopyDocument(): Promise<void> {
  if (!store.viewingDocument) {
    return;
  }
  try {
    await navigator.clipboard.writeText(documentJson.value);
    antMessage.success("DID 文档已复制");
  } catch (e) {
    antMessage.error(`复制失败: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function onExportDocument(): void {
  if (!store.viewingDocument) {
    return;
  }
  const nick =
    pickString(identity.value, ["nickname", "displayName"]) || "identity";
  const blob = new Blob([documentJson.value], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `did-document-${nick}.json`;
  a.click();
  URL.revokeObjectURL(url);
  antMessage.success("DID 文档已导出");
}

async function onShowQR(): Promise<void> {
  if (!store.viewingDid) {
    return;
  }
  qrOpen.value = true;
  qrRendered.value = false;
  const qrData = await store.generateQRData(store.viewingDid);
  if (!qrData) {
    qrOpen.value = false;
    antMessage.error(`生成二维码失败: ${store.detailsError ?? "未知错误"}`);
    return;
  }
  await nextTick();
  const host = qrcodeContainer.value;
  if (!host) {
    return;
  }
  host.replaceChildren();
  try {
    const canvas = await QRCode.toCanvas(qrData, {
      errorCorrectionLevel: "M",
      width: 260,
      margin: 2,
    });
    host.appendChild(canvas);
    qrRendered.value = true;
  } catch (e) {
    antMessage.error(
      `渲染二维码失败: ${e instanceof Error ? e.message : String(e)}`,
    );
    qrOpen.value = false;
  }
}

function onCloseQR(): void {
  qrRendered.value = false;
  if (qrcodeContainer.value) {
    qrcodeContainer.value.replaceChildren();
  }
}

function onSaveQR(): void {
  const canvas = qrcodeContainer.value?.querySelector("canvas");
  if (!canvas) {
    return;
  }
  canvas.toBlob((blob) => {
    if (!blob) {
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `did-qrcode-${Date.now()}.png`;
    a.click();
    URL.revokeObjectURL(url);
    antMessage.success("二维码已保存");
  });
}
</script>

<style scoped>
.details-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.details-error {
  margin-top: 8px;
}

.muted {
  color: var(--cc-shell-muted, #999);
  font-size: 12px;
}

.document-block {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.did-document {
  background: var(--cc-shell-sider-bg, #fafafa);
  padding: 12px 16px;
  border-radius: 4px;
  font-size: 12px;
  line-height: 1.6;
  max-height: 320px;
  overflow: auto;
  margin: 0;
  border: 1px solid var(--cc-shell-border, #e8e8e8);
}

.qr-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-start;
}

.qr-modal-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
}

.qr-canvas-host {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 260px;
}
</style>
