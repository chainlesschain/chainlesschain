<template>
  <div class="evomap-dashboard-page">
    <!-- 页面头部 -->
    <div class="page-header">
      <div class="header-left">
        <h2>EvoMap Dashboard</h2>
        <span class="subtitle">GEP-A2A Protocol — Global Agent Knowledge Network</span>
      </div>
      <div class="header-right">
        <a-button
          v-if="!store.isRegistered"
          type="primary"
          :loading="store.loading"
          @click="handleRegister"
        >
          Register Node
        </a-button>
        <a-button
          v-else
          :loading="refreshing"
          @click="handleRefresh"
        >
          Refresh
        </a-button>
      </div>
    </div>

    <!-- 节点状态卡片 -->
    <a-row
      :gutter="[16, 16]"
      class="status-row"
    >
      <a-col
        :xs="24"
        :sm="12"
        :md="6"
      >
        <a-card class="stat-card">
          <a-statistic
            title="Node ID"
            :value="
              store.nodeStatus.nodeId
                ? store.nodeStatus.nodeId.substring(0, 16) + '...'
                : 'Not Registered'
            "
          />
          <div class="stat-footer">
            <a-tag :color="store.isRegistered ? 'green' : 'default'">
              {{ store.isRegistered ? "Online" : "Offline" }}
            </a-tag>
          </div>
        </a-card>
      </a-col>
      <a-col
        :xs="24"
        :sm="12"
        :md="6"
      >
        <a-card class="stat-card">
          <a-statistic
            title="Credits"
            :value="store.creditBalance"
            :precision="2"
          />
          <div class="stat-footer">
            <a-button
              size="small"
              type="link"
              @click="handleRefreshCredits"
            >
              Refresh
            </a-button>
          </div>
        </a-card>
      </a-col>
      <a-col
        :xs="24"
        :sm="12"
        :md="6"
      >
        <a-card class="stat-card">
          <a-statistic
            title="Published"
            :value="store.publishedCount"
          />
          <div class="stat-footer">
            <span class="stat-label">assets shared</span>
          </div>
        </a-card>
      </a-col>
      <a-col
        :xs="24"
        :sm="12"
        :md="6"
      >
        <a-card class="stat-card">
          <a-statistic
            title="Imported"
            :value="store.importedCount"
          />
          <div class="stat-footer">
            <span class="stat-label">community assets</span>
          </div>
        </a-card>
      </a-col>
    </a-row>

    <!-- 快速操作 -->
    <a-row
      :gutter="[16, 16]"
      class="action-row"
    >
      <a-col
        :xs="24"
        :md="12"
      >
        <a-card
          title="Quick Actions"
          size="small"
        >
          <div class="action-list">
            <a-button
              block
              :disabled="!store.isRegistered"
              :loading="store.loading"
              @click="handleAutoPublish"
            >
              Auto-Publish Eligible Assets
            </a-button>
            <a-button
              block
              :disabled="!store.isRegistered"
              :loading="store.loading"
              style="margin-top: 8px"
              @click="handleFetchTrending"
            >
              Fetch Trending Assets
            </a-button>
          </div>
        </a-card>
      </a-col>
      <a-col
        :xs="24"
        :md="12"
      >
        <a-card
          title="Configuration"
          size="small"
        >
          <div class="config-items">
            <div class="config-item">
              <span>Auto-Publish</span>
              <a-switch
                :checked="config?.autoPublish || false"
                size="small"
                @change="(val) => handleConfigChange('autoPublish', val)"
              />
            </div>
            <div class="config-item">
              <span>Auto-Fetch</span>
              <a-switch
                :checked="config?.autoFetch || false"
                size="small"
                @change="(val) => handleConfigChange('autoFetch', val)"
              />
            </div>
            <div class="config-item">
              <span>Heartbeat</span>
              <a-switch
                :checked="config?.heartbeatEnabled !== false"
                size="small"
                @change="(val) => handleConfigChange('heartbeatEnabled', val)"
              />
            </div>
            <div class="config-item">
              <span>Require Review</span>
              <a-switch
                :checked="config?.privacyFilter?.requireReview !== false"
                size="small"
                @change="(val) => handlePrivacyChange('requireReview', val)"
              />
            </div>
          </div>
        </a-card>
      </a-col>
    </a-row>

    <!-- 同步日志 -->
    <a-card
      title="Recent Sync Log"
      size="small"
      class="log-card"
    >
      <a-table
        :data-source="store.syncLog.slice(0, 15)"
        :columns="logColumns"
        size="small"
        :pagination="false"
        row-key="id"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'status'">
            <a-tag :color="record.status === 'success' ? 'green' : 'red'">
              {{ record.status }}
            </a-tag>
          </template>
          <template v-if="column.key === 'created_at'">
            {{ formatTime(record.created_at) }}
          </template>
          <template v-if="column.key === 'asset_id'">
            {{
              record.asset_id ? record.asset_id.substring(0, 20) + "..." : "-"
            }}
          </template>
        </template>
      </a-table>
      <a-empty
        v-if="store.syncLog.length === 0"
        description="No sync activity yet"
      />
    </a-card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import { message } from "ant-design-vue";
import { useEvoMapStore } from "../../stores/evomap";

const store = useEvoMapStore();
const refreshing = ref(false);

const config = computed(() => store.config);

const logColumns = [
  { title: "Action", dataIndex: "action", key: "action", width: 100 },
  { title: "Asset ID", dataIndex: "asset_id", key: "asset_id", width: 200 },
  { title: "Status", dataIndex: "status", key: "status", width: 80 },
  { title: "Time", dataIndex: "created_at", key: "created_at", width: 150 },
];

function formatTime(iso) {
  if (!iso) {
    return "-";
  }
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

async function handleRegister() {
  const result = await store.register();
  if (result.success) {
    message.success("Node registered successfully");
    await loadData();
  } else {
    message.error(result.error || "Registration failed");
  }
}

async function handleRefresh() {
  refreshing.value = true;
  await loadData();
  refreshing.value = false;
}

async function handleRefreshCredits() {
  await store.refreshCredits();
}

async function handleAutoPublish() {
  const result = await store.autoPublish();
  if (result.success && result.data) {
    message.success(
      `Published: ${result.data?.published ?? 0}, Skipped: ${result.data?.skipped ?? 0}, Errors: ${result.data?.errors ?? 0}`,
    );
  } else {
    message.error(result.error || "Auto-publish failed");
  }
}

async function handleFetchTrending() {
  await store.fetchTrending();
  message.success(`Fetched ${store.trendingAssets.length} trending assets`);
}

async function handleConfigChange(key, value) {
  await store.updateConfig({ [key]: value });
}

async function handlePrivacyChange(key, value) {
  const currentFilter = config.value?.privacyFilter || {
    excludePatterns: [],
    anonymize: true,
    requireReview: true,
  };
  await store.updateConfig({
    privacyFilter: { ...currentFilter, [key]: value },
  });
}

async function loadData() {
  await Promise.all([
    store.getStatus(),
    store.getConfig(),
    store.getLocalAssets(),
    store.getSyncLog(15),
  ]);
}

onMounted(() => {
  loadData();
});
</script>

<style lang="less" scoped>
.evomap-dashboard-page {
  padding: 24px;

  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 24px;

    .header-left {
      h2 {
        margin: 0;
        font-size: 20px;
      }
      .subtitle {
        font-size: 12px;
        color: #999;
      }
    }
  }

  .status-row {
    margin-bottom: 16px;
  }

  .stat-card {
    .stat-footer {
      margin-top: 8px;
      .stat-label {
        font-size: 12px;
        color: #999;
      }
    }
  }

  .action-row {
    margin-bottom: 16px;
  }

  .action-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .config-items {
    .config-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 6px 0;

      &:not(:last-child) {
        border-bottom: 1px solid #f0f0f0;
      }
    }
  }

  .log-card {
    margin-top: 16px;
  }
}

@media (max-width: 767px) {
  .evomap-dashboard-page {
    padding: 12px;
  }
}
</style>
