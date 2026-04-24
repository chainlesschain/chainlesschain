<template>
  <div class="ipfs-storage-page">
    <a-page-header
      title="IPFS Decentralized Storage"
      sub-title="Content-addressed storage with pinning, encryption, and knowledge base integration"
      @back="() => router.back()"
    >
      <template #extra>
        <a-space>
          <a-badge
            :status="ipfsStore.isNodeRunning ? 'processing' : 'error'"
            :text="ipfsStore.isNodeRunning ? 'Node Online' : 'Node Offline'"
          />
          <a-button
            v-if="!ipfsStore.isNodeRunning"
            type="primary"
            :loading="startingNode"
            @click="handleStartNode"
          >
            <template #icon>
              <PlayCircleOutlined />
            </template>
            Start Node
          </a-button>
          <a-button
            v-else
            danger
            :loading="stoppingNode"
            @click="handleStopNode"
          >
            <template #icon>
              <PauseCircleOutlined />
            </template>
            Stop Node
          </a-button>
          <a-select
            :value="ipfsStore.currentMode"
            style="width: 140px"
            @change="handleModeChange"
          >
            <a-select-option value="embedded"> Embedded </a-select-option>
            <a-select-option value="external"> External Kubo </a-select-option>
          </a-select>
        </a-space>
      </template>
    </a-page-header>

    <div class="ipfs-content">
      <!-- Row 1: Statistics Cards -->
      <a-row :gutter="16" class="stats-row">
        <a-col :span="6">
          <a-card :loading="statsLoading">
            <a-statistic
              title="Connected Peers"
              :value="ipfsStore.connectedPeers"
              :value-style="{ color: '#1890ff' }"
            >
              <template #prefix>
                <TeamOutlined />
              </template>
            </a-statistic>
          </a-card>
        </a-col>
        <a-col :span="6">
          <a-card :loading="statsLoading">
            <a-statistic
              title="Pinned Items"
              :value="ipfsStore.pinnedCount"
              :value-style="{ color: '#52c41a' }"
            >
              <template #prefix>
                <PushpinOutlined />
              </template>
            </a-statistic>
          </a-card>
        </a-col>
        <a-col :span="6">
          <a-card :loading="statsLoading">
            <a-statistic
              title="Storage Used"
              :value="ipfsStore.formattedTotalSize"
              :value-style="{ color: '#fa8c16' }"
            >
              <template #prefix>
                <DatabaseOutlined />
              </template>
            </a-statistic>
            <a-progress
              :percent="Number(ipfsStore.usagePercent.toFixed(1))"
              :status="ipfsStore.usagePercent > 90 ? 'exception' : 'active'"
              size="small"
              style="margin-top: 8px"
            />
            <div class="quota-label">Quota: {{ ipfsStore.formattedQuota }}</div>
          </a-card>
        </a-col>
        <a-col :span="6">
          <a-card :loading="statsLoading">
            <a-statistic
              title="Total CIDs"
              :value="ipfsStore.pinnedTotal"
              :value-style="{ color: '#722ed1' }"
            >
              <template #prefix>
                <LinkOutlined />
              </template>
            </a-statistic>
            <div v-if="ipfsStore.nodeStatus.peerId" class="peer-id-label">
              <a-tooltip :title="ipfsStore.nodeStatus.peerId">
                PeerID: {{ truncate(ipfsStore.nodeStatus.peerId, 16) }}
              </a-tooltip>
            </div>
          </a-card>
        </a-col>
      </a-row>

      <!-- Row 2: Pinned Content Table -->
      <a-card title="Pinned Content" :bordered="false" class="table-card">
        <template #extra>
          <a-space>
            <a-button :loading="gcLoading" @click="handleGarbageCollect">
              <template #icon>
                <ClearOutlined />
              </template>
              Garbage Collect
            </a-button>
            <a-button @click="handleRefresh">
              <template #icon>
                <ReloadOutlined />
              </template>
              Refresh
            </a-button>
          </a-space>
        </template>

        <a-table
          :columns="columns"
          :data-source="ipfsStore.pinnedContent"
          :loading="ipfsStore.loading"
          :pagination="tablePagination"
          row-key="id"
          :scroll="{ x: 1000 }"
          @change="handleTableChange"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'filename'">
              {{ record.filename || "(unnamed)" }}
            </template>

            <template v-else-if="column.key === 'cid'">
              <a-tooltip :title="record.cid">
                <a-typography-text
                  copyable
                  :content="record.cid"
                  class="cid-text"
                >
                  {{ truncate(record.cid, 20) }}
                </a-typography-text>
              </a-tooltip>
            </template>

            <template v-else-if="column.key === 'size'">
              {{ ipfsStore.formatBytes(record.size) }}
            </template>

            <template v-else-if="column.key === 'createdAt'">
              {{ formatDate(record.createdAt) }}
            </template>

            <template v-else-if="column.key === 'encrypted'">
              <a-tag v-if="record.encrypted" color="blue">
                <LockOutlined /> Encrypted
              </a-tag>
              <a-tag v-else color="default"> Plain </a-tag>
            </template>

            <template v-else-if="column.key === 'actions'">
              <a-space>
                <a-tooltip title="Download">
                  <a-button
                    type="link"
                    size="small"
                    @click="handleDownload(record)"
                  >
                    <DownloadOutlined />
                  </a-button>
                </a-tooltip>
                <a-tooltip title="Copy CID">
                  <a-button
                    type="link"
                    size="small"
                    @click="handleCopyCID(record.cid)"
                  >
                    <CopyOutlined />
                  </a-button>
                </a-tooltip>
                <a-popconfirm
                  title="Are you sure you want to unpin this content?"
                  ok-text="Yes"
                  cancel-text="No"
                  @confirm="handleUnpin(record.cid)"
                >
                  <a-tooltip title="Unpin">
                    <a-button type="link" danger size="small">
                      <DeleteOutlined />
                    </a-button>
                  </a-tooltip>
                </a-popconfirm>
              </a-space>
            </template>
          </template>
        </a-table>
      </a-card>

      <!-- Row 3: Upload + Configuration -->
      <a-row :gutter="16" class="bottom-row">
        <!-- Upload Zone -->
        <a-col :span="14">
          <a-card title="Upload Content" :bordered="false">
            <a-upload-dragger
              :before-upload="handleBeforeUpload"
              :show-upload-list="false"
              :disabled="!ipfsStore.isNodeRunning"
              multiple
            >
              <p class="ant-upload-drag-icon">
                <InboxOutlined />
              </p>
              <p class="ant-upload-text">
                Click or drag files here to upload to IPFS
              </p>
              <p class="ant-upload-hint">
                Files are content-addressed and stored on the decentralized
                network.
              </p>
            </a-upload-dragger>

            <div class="upload-options">
              <a-space align="center" style="margin-top: 12px">
                <a-switch
                  v-model:checked="uploadEncrypt"
                  :disabled="!ipfsStore.isNodeRunning"
                />
                <span>Encrypt with AES-256-GCM</span>
              </a-space>
            </div>

            <a-progress
              v-if="ipfsStore.uploadProgress > 0"
              :percent="ipfsStore.uploadProgress"
              status="active"
              style="margin-top: 12px"
            />

            <!-- Text content upload -->
            <a-divider>Or paste text content</a-divider>
            <a-textarea
              v-model:value="textContent"
              placeholder="Paste text content to store on IPFS..."
              :rows="3"
              :disabled="!ipfsStore.isNodeRunning"
            />
            <a-button
              type="primary"
              style="margin-top: 8px"
              :loading="textUploading"
              :disabled="!textContent || !ipfsStore.isNodeRunning"
              @click="handleUploadText"
            >
              <template #icon>
                <CloudUploadOutlined />
              </template>
              Upload Text
            </a-button>
          </a-card>
        </a-col>

        <!-- Configuration Panel -->
        <a-col :span="10">
          <a-card title="Configuration" :bordered="false">
            <a-form layout="vertical">
              <a-form-item label="Operating Mode">
                <a-select
                  :value="ipfsStore.currentMode"
                  @change="handleModeChange"
                >
                  <a-select-option value="embedded">
                    Embedded (Helia in-process)
                  </a-select-option>
                  <a-select-option value="external">
                    External (Kubo daemon)
                  </a-select-option>
                </a-select>
              </a-form-item>

              <a-form-item label="Storage Quota">
                <a-slider
                  v-model:value="quotaGB"
                  :min="1"
                  :max="100"
                  :marks="quotaMarks"
                  :tip-formatter="(val: number) => `${val} GB`"
                  @after-change="handleQuotaChange"
                />
              </a-form-item>

              <a-form-item label="IPFS Gateway URL">
                <a-input
                  v-model:value="gatewayUrl"
                  placeholder="https://ipfs.io"
                  disabled
                >
                  <template #prefix>
                    <GlobalOutlined />
                  </template>
                </a-input>
              </a-form-item>

              <a-form-item
                v-if="ipfsStore.currentMode === 'external'"
                label="External API URL"
              >
                <a-input
                  v-model:value="externalApiUrl"
                  placeholder="http://127.0.0.1:5001"
                  disabled
                >
                  <template #prefix>
                    <ApiOutlined />
                  </template>
                </a-input>
              </a-form-item>

              <a-form-item label="Default Encryption">
                <a-switch
                  :checked="ipfsStore.config?.encryptionEnabled ?? false"
                  disabled
                />
                <span style="margin-left: 8px; color: rgba(0, 0, 0, 0.45)">
                  AES-256-GCM (per-file toggle available at upload)
                </span>
              </a-form-item>
            </a-form>
          </a-card>
        </a-col>
      </a-row>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { message } from "ant-design-vue";
import {
  PlayCircleOutlined,
  PauseCircleOutlined,
  TeamOutlined,
  PushpinOutlined,
  DatabaseOutlined,
  LinkOutlined,
  LockOutlined,
  ClearOutlined,
  ReloadOutlined,
  DownloadOutlined,
  CopyOutlined,
  DeleteOutlined,
  InboxOutlined,
  CloudUploadOutlined,
  GlobalOutlined,
  ApiOutlined,
} from "@ant-design/icons-vue";
import { useIPFSStorageStore } from "../stores/ipfs-storage";
import dayjs from "dayjs";

const router = useRouter();
const ipfsStore = useIPFSStorageStore();

// ==================== Local State ====================

const startingNode = ref(false);
const stoppingNode = ref(false);
const statsLoading = ref(false);
const gcLoading = ref(false);
const textUploading = ref(false);
const uploadEncrypt = ref(false);
const textContent = ref("");
const gatewayUrl = ref("https://ipfs.io");
const externalApiUrl = ref("http://127.0.0.1:5001");
const quotaGB = ref(1);
const currentPage = ref(1);
const pageSize = ref(20);

const quotaMarks = reactive({
  1: "1 GB",
  10: "10 GB",
  50: "50 GB",
  100: "100 GB",
});

// ==================== Computed ====================

const tablePagination = computed(() => ({
  current: currentPage.value,
  pageSize: pageSize.value,
  total: ipfsStore.pinnedTotal,
  showSizeChanger: true,
  showQuickJumper: true,
  showTotal: (total: number) => `${total} items`,
}));

// ==================== Table Columns ====================

const columns = [
  {
    title: "Filename",
    key: "filename",
    dataIndex: "filename",
    width: 200,
    ellipsis: true,
  },
  {
    title: "CID",
    key: "cid",
    dataIndex: "cid",
    width: 220,
  },
  {
    title: "Size",
    key: "size",
    dataIndex: "size",
    width: 100,
    sorter: (a: any, b: any) => a.size - b.size,
  },
  {
    title: "Date",
    key: "createdAt",
    dataIndex: "createdAt",
    width: 170,
    sorter: (a: any, b: any) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  },
  {
    title: "Encryption",
    key: "encrypted",
    dataIndex: "encrypted",
    width: 120,
  },
  {
    title: "Actions",
    key: "actions",
    width: 140,
    fixed: "right" as const,
  },
];

// ==================== Node Control ====================

async function handleStartNode() {
  startingNode.value = true;
  try {
    const result = await ipfsStore.initializeIPFS();
    if (result.success) {
      message.success("IPFS node started successfully");
      await refreshData();
    } else {
      message.error(result.error || "Failed to start IPFS node");
    }
  } catch (error) {
    message.error("Failed to start IPFS node");
  } finally {
    startingNode.value = false;
  }
}

async function handleStopNode() {
  stoppingNode.value = true;
  try {
    const result = await ipfsStore.stopNode();
    if (result.success) {
      message.success("IPFS node stopped");
    } else {
      message.error(result.error || "Failed to stop IPFS node");
    }
  } catch (error) {
    message.error("Failed to stop IPFS node");
  } finally {
    stoppingNode.value = false;
  }
}

async function handleModeChange(mode: "embedded" | "external") {
  try {
    const result = await ipfsStore.setMode(mode);
    if (result.success) {
      message.success(`Mode changed to ${mode}`);
    } else {
      message.error(result.error || "Failed to change mode");
    }
  } catch (error) {
    message.error("Failed to change mode");
  }
}

// ==================== Content Operations ====================

function handleBeforeUpload(file: File) {
  // Prevent default upload behavior; handle via IPC
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const result = await ipfsStore.addContent(reader.result as string, {
        encrypt: uploadEncrypt.value,
        filename: file.name,
        metadata: {
          originalName: file.name,
          mimeType: file.type,
          lastModified: file.lastModified,
        },
      });
      if (result.success) {
        message.success(`${file.name} uploaded to IPFS`);
      } else {
        message.error(result.error || "Upload failed");
      }
    } catch (error) {
      message.error(`Failed to upload ${file.name}`);
    }
  };
  reader.readAsDataURL(file);
  return false; // prevent default upload
}

async function handleUploadText() {
  if (!textContent.value) {
    return;
  }

  textUploading.value = true;
  try {
    const result = await ipfsStore.addContent(textContent.value, {
      encrypt: uploadEncrypt.value,
      filename: `text-${Date.now()}.txt`,
    });
    if (result.success) {
      message.success("Text content uploaded to IPFS");
      textContent.value = "";
    } else {
      message.error(result.error || "Upload failed");
    }
  } catch (error) {
    message.error("Failed to upload text content");
  } finally {
    textUploading.value = false;
  }
}

async function handleDownload(record: any) {
  try {
    const result = await ipfsStore.getContent(record.cid);
    if (result.success && result.data) {
      // Create a download from the base64 content
      const link = document.createElement("a");
      link.href = `data:application/octet-stream;base64,${result.data.content}`;
      link.download = record.filename || `ipfs-${record.cid.substring(0, 8)}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      message.success("Download started");
    } else {
      message.error(result.error || "Download failed");
    }
  } catch (error) {
    message.error("Failed to download content");
  }
}

function handleCopyCID(cid: string) {
  navigator.clipboard
    .writeText(cid)
    .then(() => {
      message.success("CID copied to clipboard");
    })
    .catch(() => {
      message.error("Failed to copy CID");
    });
}

async function handleUnpin(cid: string) {
  try {
    const result = await ipfsStore.unpinContent(cid);
    if (result.success) {
      message.success("Content unpinned");
    } else {
      message.error(result.error || "Unpin failed");
    }
  } catch (error) {
    message.error("Failed to unpin content");
  }
}

// ==================== Table & Pagination ====================

function handleTableChange(pagination: any) {
  currentPage.value = pagination.current;
  pageSize.value = pagination.pageSize;
  ipfsStore.fetchPinnedContent({
    offset: (pagination.current - 1) * pagination.pageSize,
    limit: pagination.pageSize,
  });
}

// ==================== Storage Management ====================

async function handleGarbageCollect() {
  gcLoading.value = true;
  try {
    const result = await ipfsStore.garbageCollect();
    if (result.success && result.data) {
      message.success(
        `GC complete: freed ${ipfsStore.formatBytes(result.data.freedBytes)}, removed ${result.data.removedItems} items`,
      );
    } else {
      message.error(result.error || "Garbage collection failed");
    }
  } catch (error) {
    message.error("Garbage collection failed");
  } finally {
    gcLoading.value = false;
  }
}

async function handleQuotaChange(value: number) {
  const quotaBytes = value * 1024 * 1024 * 1024; // GB to bytes
  try {
    const result = await ipfsStore.setQuota(quotaBytes);
    if (result.success) {
      message.success(`Storage quota set to ${value} GB`);
    } else {
      message.error(result.error || "Failed to set quota");
    }
  } catch (error) {
    message.error("Failed to set storage quota");
  }
}

// ==================== Refresh ====================

async function refreshData() {
  statsLoading.value = true;
  try {
    await Promise.all([
      ipfsStore.fetchNodeStatus(),
      ipfsStore.fetchStorageStats(),
      ipfsStore.fetchPinnedContent(),
      ipfsStore.fetchConfig(),
    ]);
  } catch (error) {
    console.error("[IPFSStoragePage] Failed to refresh data:", error);
  } finally {
    statsLoading.value = false;
  }
}

async function handleRefresh() {
  await refreshData();
  message.success("Data refreshed");
}

// ==================== Helpers ====================

function truncate(str: string, maxLen: number): string {
  if (!str) {
    return "-";
  }
  if (str.length <= maxLen) {
    return str;
  }
  return (
    str.substring(0, Math.floor(maxLen / 2)) +
    "..." +
    str.substring(str.length - Math.floor(maxLen / 2))
  );
}

function formatDate(dateStr: string) {
  return dayjs(dateStr).format("YYYY-MM-DD HH:mm:ss");
}

// ==================== Lifecycle ====================

onMounted(async () => {
  try {
    await ipfsStore.fetchNodeStatus();
    await ipfsStore.fetchConfig();

    if (ipfsStore.isNodeRunning) {
      await refreshData();
    }

    // Sync config to local refs
    if (ipfsStore.config) {
      gatewayUrl.value = ipfsStore.config.gatewayUrl || "https://ipfs.io";
      externalApiUrl.value =
        ipfsStore.config.externalApiUrl || "http://127.0.0.1:5001";
      quotaGB.value = Math.round(
        (ipfsStore.config.storageQuotaBytes || 1073741824) /
          (1024 * 1024 * 1024),
      );
    }
  } catch (error) {
    console.error("[IPFSStoragePage] Mount error:", error);
  }
});
</script>

<style scoped lang="less">
.ipfs-storage-page {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #f0f2f5;
}

.ipfs-content {
  flex: 1;
  padding: 0 24px 24px;
  overflow: auto;
}

.stats-row {
  margin-bottom: 16px;

  .quota-label {
    font-size: 12px;
    color: rgba(0, 0, 0, 0.45);
    margin-top: 4px;
  }

  .peer-id-label {
    font-size: 12px;
    color: rgba(0, 0, 0, 0.45);
    margin-top: 8px;
    word-break: break-all;
  }
}

.table-card {
  margin-bottom: 16px;

  .cid-text {
    font-family: "Courier New", monospace;
    font-size: 12px;
  }
}

.bottom-row {
  margin-bottom: 24px;

  .upload-options {
    display: flex;
    align-items: center;
  }
}
</style>
