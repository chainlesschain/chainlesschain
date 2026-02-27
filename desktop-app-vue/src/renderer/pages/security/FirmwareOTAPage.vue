<template>
  <div class="firmware-ota-page">
    <a-page-header
      title="Firmware OTA"
      sub-title="Over-the-air firmware updates for U-Key devices"
    >
      <template #extra>
        <a-button
          type="primary"
          :loading="store.loading"
          @click="handleCheckUpdates"
        >
          Check for Updates
        </a-button>
      </template>
    </a-page-header>

    <a-row :gutter="16" style="margin-bottom: 16px">
      <a-col :span="8">
        <a-statistic
          title="Available Updates"
          :value="store.availableUpdates.length"
        />
      </a-col>
      <a-col :span="8">
        <a-statistic
          title="Critical Updates"
          :value="store.criticalUpdates.length"
        />
      </a-col>
      <a-col :span="8">
        <a-statistic
          title="Update History"
          :value="store.updateHistory.length"
        />
      </a-col>
    </a-row>

    <a-tabs v-model:active-key="activeTab">
      <a-tab-pane key="available" tab="Available Updates">
        <a-empty
          v-if="store.availableUpdates.length === 0"
          description="No updates available"
        />
        <a-list
          v-else
          :data-source="store.availableUpdates"
          item-layout="vertical"
        >
          <template #renderItem="{ item }">
            <a-list-item>
              <a-list-item-meta
                :title="`v${item.version} (${item.channel})`"
                :description="item.release_notes"
              />
              <template #actions>
                <a-button
                  type="primary"
                  size="small"
                  :loading="store.loading"
                  @click="handleStartUpdate(item.id)"
                >
                  Install
                </a-button>
              </template>
              <a-space>
                <a-tag v-if="item.is_critical" color="red"> Critical </a-tag>
                <span>Size: {{ formatSize(item.file_size) }}</span>
              </a-space>
            </a-list-item>
          </template>
        </a-list>
      </a-tab-pane>

      <a-tab-pane key="history" tab="Update History">
        <a-table
          :columns="historyColumns"
          :data-source="store.updateHistory"
          row-key="id"
          size="small"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'status'">
              <a-badge
                :status="statusColor(record.status)"
                :text="record.status"
              />
            </template>
            <template v-if="column.key === 'completed_at'">
              {{ formatDate(record.completed_at) }}
            </template>
          </template>
        </a-table>
      </a-tab-pane>
    </a-tabs>

    <a-alert
      v-if="store.error"
      type="error"
      :message="store.error"
      closable
      style="margin-top: 16px"
      @close="store.error = null"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { message } from "ant-design-vue";
import { useFirmwareOtaStore } from "../../stores/firmwareOta";

const store = useFirmwareOtaStore();
const activeTab = ref("available");

const historyColumns = [
  { title: "Version", dataIndex: "version", width: 120 },
  { title: "Status", key: "status", width: 120 },
  { title: "Progress", dataIndex: "progress", width: 100 },
  { title: "Completed", key: "completed_at", width: 180 },
];

function formatSize(bytes: number) {
  return bytes ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : "N/A";
}
function formatDate(ts: number | null) {
  return ts ? new Date(ts).toLocaleString() : "N/A";
}
function statusColor(
  s: string,
): "success" | "error" | "processing" | "default" {
  return (
    (
      {
        completed: "success",
        failed: "error",
        installing: "processing",
        downloading: "processing",
      } as Record<string, "success" | "error" | "processing" | "default">
    )[s] || "default"
  );
}

async function handleCheckUpdates() {
  const result = await store.checkUpdates();
  if (result.success && result.hasUpdate) {
    message.success("Update available!");
  } else if (result.success) {
    message.info("No updates available");
  } else {
    message.error(result.error || "Check failed");
  }
}

async function handleStartUpdate(versionId: string) {
  const result = await store.startUpdate(versionId);
  if (result.success) {
    message.success("Update completed");
  } else {
    message.error(result.error || "Update failed");
  }
}

onMounted(async () => {
  await store.fetchVersions();
  await store.fetchHistory();
});
</script>

<style lang="less" scoped>
.firmware-ota-page {
  padding: 24px;
}
</style>
