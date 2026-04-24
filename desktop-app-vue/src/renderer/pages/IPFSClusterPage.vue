<template>
  <div class="ipfs-cluster-page">
    <a-page-header
      title="IPFS Cluster"
      sub-title="Distributed pin management with automated replication and health monitoring"
      @back="() => router.back()"
    >
      <template #extra>
        <a-space>
          <a-button
            type="primary"
            :loading="clusterStore.loading"
            @click="showAddNodeModal = true"
          >
            <template #icon>
              <PlusOutlined />
            </template>
            Add Node
          </a-button>
          <a-button
            :loading="clusterStore.loading"
            @click="showPinModal = true"
          >
            <template #icon>
              <PushpinOutlined />
            </template>
            Pin Content
          </a-button>
          <a-button :loading="rebalancing" @click="handleRebalance">
            <template #icon>
              <SyncOutlined />
            </template>
            Rebalance
          </a-button>
        </a-space>
      </template>
    </a-page-header>

    <div class="cluster-content">
      <!-- Stats Row -->
      <a-row :gutter="16" class="stats-row">
        <a-col :span="6">
          <a-card :loading="statsLoading">
            <a-statistic
              title="Total Nodes"
              :value="clusterStore.stats?.totalNodes || 0"
              :value-style="{ color: '#1890ff' }"
            >
              <template #prefix>
                <ClusterOutlined />
              </template>
            </a-statistic>
          </a-card>
        </a-col>
        <a-col :span="6">
          <a-card :loading="statsLoading">
            <a-statistic
              title="Online Nodes"
              :value="clusterStore.stats?.onlineNodes || 0"
              :value-style="{ color: '#52c41a' }"
            >
              <template #prefix>
                <CheckCircleOutlined />
              </template>
            </a-statistic>
          </a-card>
        </a-col>
        <a-col :span="6">
          <a-card :loading="statsLoading">
            <a-statistic
              title="Total Pins"
              :value="clusterStore.stats?.totalPins || 0"
              :value-style="{ color: '#fa8c16' }"
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
              :value="formattedStorageUsed"
              :suffix="'/ ' + formattedStorageTotal"
              :value-style="{ color: '#722ed1' }"
            >
              <template #prefix>
                <DatabaseOutlined />
              </template>
            </a-statistic>
            <a-progress
              :percent="Number(clusterStore.storageUsedPercent.toFixed(1))"
              :status="
                clusterStore.storageUsedPercent > 90 ? 'exception' : 'active'
              "
              size="small"
              style="margin-top: 8px"
            />
          </a-card>
        </a-col>
      </a-row>

      <!-- Health Status Card -->
      <a-card
        title="Cluster Health"
        class="health-card"
        style="margin-top: 16px"
      >
        <a-row :gutter="24">
          <a-col :span="6">
            <a-statistic
              title="Healthy"
              :value="clusterStore.health?.healthy || 0"
              :value-style="{ color: '#52c41a' }"
            />
          </a-col>
          <a-col :span="6">
            <a-statistic
              title="Degraded"
              :value="clusterStore.health?.degraded || 0"
              :value-style="{ color: '#faad14' }"
            />
          </a-col>
          <a-col :span="6">
            <a-statistic
              title="Offline"
              :value="clusterStore.health?.offline || 0"
              :value-style="{ color: '#ff4d4f' }"
            />
          </a-col>
          <a-col :span="6">
            <a-statistic
              title="Under-Replicated Pins"
              :value="clusterStore.health?.underReplicatedPins || 0"
              :value-style="{
                color: clusterStore.health?.underReplicatedPins
                  ? '#ff4d4f'
                  : '#52c41a',
              }"
            />
          </a-col>
        </a-row>
      </a-card>

      <!-- Nodes Table -->
      <a-card title="Cluster Nodes" style="margin-top: 16px">
        <a-table
          :columns="nodeColumns"
          :data-source="clusterStore.nodes"
          :loading="clusterStore.loading"
          row-key="id"
          :pagination="{ pageSize: 10 }"
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
                title="Remove this node from the cluster?"
                ok-text="Yes"
                cancel-text="No"
                @confirm="handleRemoveNode(record.id)"
              >
                <a-button type="link" danger size="small"> Remove </a-button>
              </a-popconfirm>
            </template>
          </template>
        </a-table>
      </a-card>

      <!-- Pins Table -->
      <a-card title="Pinned Content" style="margin-top: 16px">
        <a-table
          :columns="pinColumns"
          :data-source="clusterStore.pins"
          :loading="clusterStore.loading"
          row-key="id"
          :pagination="{ pageSize: 10 }"
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
                title="Unpin this content?"
                ok-text="Yes"
                cancel-text="No"
                @confirm="handleUnpin(record.id)"
              >
                <a-button type="link" danger size="small"> Unpin </a-button>
              </a-popconfirm>
            </template>
          </template>
        </a-table>
      </a-card>
    </div>

    <!-- Add Node Modal -->
    <a-modal
      v-model:open="showAddNodeModal"
      title="Add Cluster Node"
      :confirm-loading="clusterStore.loading"
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
        <a-form-item label="Region">
          <a-input v-model:value="addNodeForm.region" placeholder="us-east" />
        </a-form-item>
        <a-form-item label="Storage Capacity (bytes)">
          <a-input-number
            v-model:value="addNodeForm.storageCapacity"
            :min="0"
            style="width: 100%"
          />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- Pin Content Modal -->
    <a-modal
      v-model:open="showPinModal"
      title="Pin Content"
      :confirm-loading="clusterStore.loading"
      @ok="handlePinContent"
    >
      <a-form layout="vertical">
        <a-form-item label="CID" required>
          <a-input v-model:value="pinForm.cid" placeholder="QmHash..." />
        </a-form-item>
        <a-form-item label="Name">
          <a-input v-model:value="pinForm.name" placeholder="my-file.txt" />
        </a-form-item>
        <a-form-item label="Replication Factor">
          <a-input-number
            v-model:value="pinForm.replicationFactor"
            :min="1"
            :max="10"
            style="width: 100%"
          />
        </a-form-item>
        <a-form-item label="Priority">
          <a-input-number
            v-model:value="pinForm.priority"
            :min="0"
            :max="100"
            style="width: 100%"
          />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from "vue";
import { useRouter } from "vue-router";
import { message } from "ant-design-vue";
import {
  PlusOutlined,
  PushpinOutlined,
  SyncOutlined,
  ClusterOutlined,
  CheckCircleOutlined,
  DatabaseOutlined,
} from "@ant-design/icons-vue";
import { useIPFSClusterStore } from "../stores/ipfsCluster";

const router = useRouter();
const clusterStore = useIPFSClusterStore();

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

const nodeColumns = [
  { title: "Peer ID", dataIndex: "peer_id", key: "peer_id", ellipsis: true },
  { title: "Endpoint", dataIndex: "endpoint", key: "endpoint", ellipsis: true },
  { title: "Region", dataIndex: "region", key: "region" },
  { title: "Status", key: "status" },
  {
    title: "Pin Count",
    dataIndex: "pin_count",
    key: "pin_count",
    sorter: (a: any, b: any) => a.pin_count - b.pin_count,
  },
  { title: "Storage", key: "storage" },
  { title: "Last Heartbeat", key: "lastHeartbeat" },
  { title: "Actions", key: "actions", width: 100 },
];

const pinColumns = [
  { title: "CID", key: "cid" },
  { title: "Name", dataIndex: "name", key: "name" },
  { title: "Replicas", key: "replicas" },
  { title: "Status", key: "pin_status" },
  {
    title: "Priority",
    dataIndex: "priority",
    key: "priority",
    sorter: (a: any, b: any) => a.priority - b.priority,
  },
  { title: "Actions", key: "actions", width: 100 },
];

const formattedStorageUsed = ref("0 B");
const formattedStorageTotal = ref("0 B");

function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

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

async function refreshAll() {
  statsLoading.value = true;
  try {
    await Promise.all([
      clusterStore.loadNodes(),
      clusterStore.loadPins(),
      clusterStore.loadStats(),
      clusterStore.loadHealth(),
    ]);
    formattedStorageUsed.value = formatBytes(
      clusterStore.stats?.usedStorage || 0,
    );
    formattedStorageTotal.value = formatBytes(
      clusterStore.stats?.totalStorage || 0,
    );
  } finally {
    statsLoading.value = false;
  }
}

async function handleAddNode() {
  if (!addNodeForm.peerId || !addNodeForm.endpoint) {
    message.warning("Peer ID and Endpoint are required");
    return;
  }
  const result = await clusterStore.addNode({
    peerId: addNodeForm.peerId,
    endpoint: addNodeForm.endpoint,
    region: addNodeForm.region || undefined,
    storageCapacity: addNodeForm.storageCapacity || 0,
  });
  if (result.success) {
    message.success("Node added successfully");
    showAddNodeModal.value = false;
    addNodeForm.peerId = "";
    addNodeForm.endpoint = "";
    addNodeForm.region = "";
    addNodeForm.storageCapacity = 0;
    await clusterStore.loadStats();
    await clusterStore.loadHealth();
  } else {
    message.error(result.error || "Failed to add node");
  }
}

async function handleRemoveNode(nodeId: string) {
  const result = await clusterStore.removeNode(nodeId);
  if (result.success) {
    message.success("Node removed");
    await clusterStore.loadStats();
    await clusterStore.loadHealth();
  } else {
    message.error(result.error || "Failed to remove node");
  }
}

async function handlePinContent() {
  if (!pinForm.cid) {
    message.warning("CID is required");
    return;
  }
  const result = await clusterStore.pinContent({
    cid: pinForm.cid,
    name: pinForm.name || undefined,
    replicationFactor: pinForm.replicationFactor,
    priority: pinForm.priority,
  });
  if (result.success) {
    message.success("Content pinned successfully");
    showPinModal.value = false;
    pinForm.cid = "";
    pinForm.name = "";
    pinForm.replicationFactor = 3;
    pinForm.priority = 0;
    await clusterStore.loadStats();
  } else {
    message.error(result.error || "Failed to pin content");
  }
}

async function handleUnpin(pinId: string) {
  const result = await clusterStore.unpinContent(pinId);
  if (result.success) {
    message.success("Content unpinned");
    await clusterStore.loadStats();
  } else {
    message.error(result.error || "Failed to unpin content");
  }
}

async function handleRebalance() {
  rebalancing.value = true;
  try {
    const result = await clusterStore.rebalance();
    if (result.success) {
      message.success(
        `Rebalance complete: ${result.data?.moved || 0} pins moved`,
      );
      await clusterStore.loadStats();
      await clusterStore.loadHealth();
    } else {
      message.error(result.error || "Rebalance failed");
    }
  } finally {
    rebalancing.value = false;
  }
}

onMounted(() => {
  refreshAll();
});
</script>

<style scoped>
.ipfs-cluster-page {
  padding: 0 24px 24px;
}

.stats-row {
  margin-top: 16px;
}

.health-card :deep(.ant-statistic-title) {
  font-size: 14px;
}
</style>
