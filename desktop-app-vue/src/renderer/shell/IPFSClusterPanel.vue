<template>
  <a-modal
    :open="open"
    :width="980"
    :footer="null"
    :mask-closable="true"
    :body-style="{ maxHeight: '80vh', overflowY: 'auto' }"
    title="IPFS Cluster"
    @update:open="(v) => $emit('update:open', v)"
  >
    <div v-if="prefillText" class="prefill-banner">
      <ClusterOutlined />
      <span class="prefill-text">命令：{{ prefillText }}</span>
    </div>

    <div class="ipfs-toolbar">
      <a-space>
        <a-button
          type="primary"
          size="small"
          :loading="store.loading"
          @click="showAddNodeModal = true"
        >
          <template #icon><PlusOutlined /></template>
          添加节点
        </a-button>
        <a-button
          size="small"
          :loading="store.loading"
          @click="showPinModal = true"
        >
          <template #icon><PushpinOutlined /></template>
          Pin 内容
        </a-button>
        <a-button size="small" :loading="rebalancing" @click="handleRebalance">
          <template #icon><SyncOutlined /></template>
          重新平衡
        </a-button>
        <a-button size="small" :loading="statsLoading" @click="refreshAll">
          <template #icon><ReloadOutlined /></template>
          刷新
        </a-button>
      </a-space>
    </div>

    <a-row :gutter="16" class="ipfs-stats">
      <a-col :span="6">
        <a-statistic
          title="总节点"
          :value="store.stats?.totalNodes || 0"
          :value-style="{ color: '#1890ff' }"
        />
      </a-col>
      <a-col :span="6">
        <a-statistic
          title="在线节点"
          :value="store.stats?.onlineNodes || 0"
          :value-style="{ color: '#52c41a' }"
        />
      </a-col>
      <a-col :span="6">
        <a-statistic
          title="总 Pin"
          :value="store.stats?.totalPins || 0"
          :value-style="{ color: '#fa8c16' }"
        />
      </a-col>
      <a-col :span="6">
        <a-statistic
          title="存储使用"
          :value="formattedStorageUsed"
          :suffix="'/ ' + formattedStorageTotal"
          :value-style="{ color: '#722ed1' }"
        />
        <a-progress
          :percent="Number(store.storageUsedPercent.toFixed(1))"
          :status="store.storageUsedPercent > 90 ? 'exception' : 'active'"
          size="small"
          style="margin-top: 4px"
        />
      </a-col>
    </a-row>

    <a-card size="small" title="集群健康" class="ipfs-section">
      <a-row :gutter="24">
        <a-col :span="6">
          <a-statistic
            title="健康"
            :value="store.health?.healthy || 0"
            :value-style="{ color: '#52c41a' }"
          />
        </a-col>
        <a-col :span="6">
          <a-statistic
            title="降级"
            :value="store.health?.degraded || 0"
            :value-style="{ color: '#faad14' }"
          />
        </a-col>
        <a-col :span="6">
          <a-statistic
            title="离线"
            :value="store.health?.offline || 0"
            :value-style="{ color: '#ff4d4f' }"
          />
        </a-col>
        <a-col :span="6">
          <a-statistic
            title="副本不足 Pin"
            :value="store.health?.underReplicatedPins || 0"
            :value-style="{
              color: store.health?.underReplicatedPins ? '#ff4d4f' : '#52c41a',
            }"
          />
        </a-col>
      </a-row>
    </a-card>

    <a-card size="small" title="集群节点" class="ipfs-section">
      <a-table
        :columns="nodeColumns"
        :data-source="store.nodes"
        :loading="store.loading"
        row-key="id"
        size="small"
        :pagination="{ pageSize: 6 }"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'status'">
            <a-tag :color="statusColor(record.status)">
              {{ record.status }}
            </a-tag>
          </template>
          <template v-if="column.key === 'storage'">
            {{ formatBytes(record.storage_used) }} /
            {{ formatBytes(record.storage_capacity) }}
          </template>
          <template v-if="column.key === 'lastHeartbeat'">
            {{ formatTime(record.last_heartbeat) }}
          </template>
          <template v-if="column.key === 'actions'">
            <a-popconfirm
              title="将该节点移出集群?"
              ok-text="移除"
              cancel-text="取消"
              @confirm="handleRemoveNode(record.id)"
            >
              <a-button type="link" danger size="small">移除</a-button>
            </a-popconfirm>
          </template>
        </template>
      </a-table>
    </a-card>

    <a-card size="small" title="已 Pin 内容" class="ipfs-section">
      <a-table
        :columns="pinColumns"
        :data-source="store.pins"
        :loading="store.loading"
        row-key="id"
        size="small"
        :pagination="{ pageSize: 6 }"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'cid'">
            <a-typography-text :copyable="{ text: record.cid }" code>
              {{ truncateCid(record.cid) }}
            </a-typography-text>
          </template>
          <template v-if="column.key === 'replicas'">
            {{ record.current_replicas }} / {{ record.replication_factor }}
          </template>
          <template v-if="column.key === 'pin_status'">
            <a-tag :color="pinStatusColor(record.pin_status)">
              {{ record.pin_status }}
            </a-tag>
          </template>
          <template v-if="column.key === 'actions'">
            <a-popconfirm
              v-if="record.pin_status !== 'unpinned'"
              title="取消 Pin 该内容?"
              ok-text="取消 Pin"
              cancel-text="取消"
              @confirm="handleUnpin(record.id)"
            >
              <a-button type="link" danger size="small">取消 Pin</a-button>
            </a-popconfirm>
          </template>
        </template>
      </a-table>
    </a-card>

    <!-- add node modal -->
    <a-modal
      v-model:open="showAddNodeModal"
      title="添加集群节点"
      :confirm-loading="store.loading"
      @ok="handleAddNode"
    >
      <a-form layout="vertical">
        <a-form-item label="Peer ID" required>
          <a-input v-model:value="addNodeForm.peerId" placeholder="QmPeer..." />
        </a-form-item>
        <a-form-item label="Endpoint" required>
          <a-input
            v-model:value="addNodeForm.endpoint"
            placeholder="http://node:5001"
          />
        </a-form-item>
        <a-form-item label="区域">
          <a-input v-model:value="addNodeForm.region" placeholder="us-east" />
        </a-form-item>
        <a-form-item label="存储容量 (bytes)">
          <a-input-number
            v-model:value="addNodeForm.storageCapacity"
            :min="0"
            style="width: 100%"
          />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- pin content modal -->
    <a-modal
      v-model:open="showPinModal"
      title="Pin 内容"
      :confirm-loading="store.loading"
      @ok="handlePinContent"
    >
      <a-form layout="vertical">
        <a-form-item label="CID" required>
          <a-input v-model:value="pinForm.cid" placeholder="QmHash..." />
        </a-form-item>
        <a-form-item label="名称">
          <a-input v-model:value="pinForm.name" placeholder="my-file.txt" />
        </a-form-item>
        <a-form-item label="副本因子">
          <a-input-number
            v-model:value="pinForm.replicationFactor"
            :min="1"
            :max="10"
            style="width: 100%"
          />
        </a-form-item>
        <a-form-item label="优先级">
          <a-input-number
            v-model:value="pinForm.priority"
            :min="0"
            :max="100"
            style="width: 100%"
          />
        </a-form-item>
      </a-form>
    </a-modal>
  </a-modal>
</template>

<script setup lang="ts">
import { ref, reactive, watch } from "vue";
import { message } from "ant-design-vue";
import {
  PlusOutlined,
  PushpinOutlined,
  SyncOutlined,
  ReloadOutlined,
  ClusterOutlined,
} from "@ant-design/icons-vue";
import { formatFileSize as formatBytes } from "@/utils/file-utils";
import { useIPFSClusterStore } from "../stores/ipfsCluster";

const props = defineProps<{ open: boolean; prefillText?: string }>();
defineEmits<{ (e: "update:open", value: boolean): void }>();

const store = useIPFSClusterStore();

const statsLoading = ref(false);
const rebalancing = ref(false);
const showAddNodeModal = ref(false);
const showPinModal = ref(false);

const addNodeForm = reactive({
  peerId: "",
  endpoint: "",
  region: "",
  storageCapacity: 0,
});

const pinForm = reactive({
  cid: "",
  name: "",
  replicationFactor: 3,
  priority: 0,
});

const formattedStorageUsed = ref("0 B");
const formattedStorageTotal = ref("0 B");

const nodeColumns = [
  { title: "Peer ID", dataIndex: "peer_id", key: "peer_id", ellipsis: true },
  { title: "Endpoint", dataIndex: "endpoint", key: "endpoint", ellipsis: true },
  { title: "区域", dataIndex: "region", key: "region" },
  { title: "状态", key: "status" },
  { title: "Pin 数", dataIndex: "pin_count", key: "pin_count" },
  { title: "存储", key: "storage" },
  { title: "最后心跳", key: "lastHeartbeat" },
  { title: "操作", key: "actions", width: 80 },
];

const pinColumns = [
  { title: "CID", key: "cid" },
  { title: "名称", dataIndex: "name", key: "name" },
  { title: "副本", key: "replicas" },
  { title: "状态", key: "pin_status" },
  { title: "优先级", dataIndex: "priority", key: "priority" },
  { title: "操作", key: "actions", width: 100 },
];

function formatTime(iso: string): string {
  if (!iso) {
    return "-";
  }
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function truncateCid(cid: string): string {
  if (!cid || cid.length <= 16) {
    return cid;
  }
  return `${cid.slice(0, 8)}...${cid.slice(-8)}`;
}

function statusColor(status: string): string {
  const colors: Record<string, string> = {
    online: "green",
    offline: "red",
    degraded: "orange",
    maintenance: "blue",
  };
  return colors[status] || "default";
}

function pinStatusColor(status: string): string {
  const colors: Record<string, string> = {
    pinned: "green",
    pinning: "blue",
    unpinning: "orange",
    unpinned: "default",
    failed: "red",
  };
  return colors[status] || "default";
}

async function refreshAll(): Promise<void> {
  statsLoading.value = true;
  try {
    await Promise.all([
      store.loadNodes(),
      store.loadPins(),
      store.loadStats(),
      store.loadHealth(),
    ]);
    formattedStorageUsed.value = formatBytes(store.stats?.usedStorage || 0);
    formattedStorageTotal.value = formatBytes(store.stats?.totalStorage || 0);
  } finally {
    statsLoading.value = false;
  }
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen && !store.loading) {
      refreshAll();
    }
  },
  { immediate: true },
);

async function handleAddNode(): Promise<void> {
  if (!addNodeForm.peerId || !addNodeForm.endpoint) {
    message.warning("Peer ID 和 Endpoint 必填");
    return;
  }
  const result = await store.addNode({
    peerId: addNodeForm.peerId,
    endpoint: addNodeForm.endpoint,
    region: addNodeForm.region || undefined,
    storageCapacity: addNodeForm.storageCapacity || 0,
  });
  if (result.success) {
    message.success("节点已添加");
    showAddNodeModal.value = false;
    addNodeForm.peerId = "";
    addNodeForm.endpoint = "";
    addNodeForm.region = "";
    addNodeForm.storageCapacity = 0;
    await Promise.all([store.loadStats(), store.loadHealth()]);
  } else {
    message.error(result.error || "添加节点失败");
  }
}

async function handleRemoveNode(nodeId: string): Promise<void> {
  const result = await store.removeNode(nodeId);
  if (result.success) {
    message.success("节点已移除");
    await Promise.all([store.loadStats(), store.loadHealth()]);
  } else {
    message.error(result.error || "移除节点失败");
  }
}

async function handlePinContent(): Promise<void> {
  if (!pinForm.cid) {
    message.warning("CID 必填");
    return;
  }
  const result = await store.pinContent({
    cid: pinForm.cid,
    name: pinForm.name || undefined,
    replicationFactor: pinForm.replicationFactor,
    priority: pinForm.priority,
  });
  if (result.success) {
    message.success("内容已 Pin");
    showPinModal.value = false;
    pinForm.cid = "";
    pinForm.name = "";
    pinForm.replicationFactor = 3;
    pinForm.priority = 0;
    await store.loadStats();
  } else {
    message.error(result.error || "Pin 内容失败");
  }
}

async function handleUnpin(pinId: string): Promise<void> {
  const result = await store.unpinContent(pinId);
  if (result.success) {
    message.success("已取消 Pin");
    await store.loadStats();
  } else {
    message.error(result.error || "取消 Pin 失败");
  }
}

async function handleRebalance(): Promise<void> {
  rebalancing.value = true;
  try {
    const result = await store.rebalance();
    if (result.success) {
      message.success(`重新平衡完成：移动 ${result.data?.moved || 0} 个 Pin`);
      await Promise.all([store.loadStats(), store.loadHealth()]);
    } else {
      message.error(result.error || "重新平衡失败");
    }
  } finally {
    rebalancing.value = false;
  }
}
</script>

<style scoped>
.prefill-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  margin-bottom: 12px;
  background: rgba(24, 144, 255, 0.08);
  border-radius: 6px;
  font-size: 13px;
}
.ipfs-toolbar {
  margin-bottom: 16px;
}
.ipfs-stats {
  margin-bottom: 16px;
}
.ipfs-section {
  margin-top: 16px;
}
</style>
