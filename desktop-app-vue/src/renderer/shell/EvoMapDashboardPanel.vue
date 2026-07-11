<template>
  <a-modal
    :open="open"
    :width="960"
    :footer="null"
    :mask-closable="true"
    :body-style="{ maxHeight: '82vh', overflowY: 'auto' }"
    title="EvoMap 仪表板"
    @update:open="(v) => $emit('update:open', v)"
  >
    <div v-if="prefillText" class="prefill-banner">
      <GlobalOutlined />
      <span class="prefill-text">命令：{{ prefillText }}</span>
    </div>

    <div class="em-toolbar">
      <span class="em-subtitle">GEP-A2A 协议 — 全球 Agent 知识网络</span>
      <a-space>
        <a-button
          v-if="!store.isRegistered"
          type="primary"
          size="small"
          :loading="store.loading"
          @click="handleRegister"
        >
          注册节点
        </a-button>
        <a-button
          v-else
          size="small"
          :loading="refreshing"
          @click="handleRefresh"
        >
          <template #icon><ReloadOutlined /></template>
          刷新
        </a-button>
      </a-space>
    </div>

    <a-row :gutter="[12, 12]" class="em-status-row">
      <a-col :span="6">
        <a-card class="em-stat-card" size="small">
          <a-statistic
            title="节点 ID"
            :value="
              store.nodeStatus.nodeId
                ? store.nodeStatus.nodeId.substring(0, 16) + '...'
                : '未注册'
            "
          />
          <div class="em-stat-footer">
            <a-tag :color="store.isRegistered ? 'green' : 'default'">
              {{ store.isRegistered ? "在线" : "离线" }}
            </a-tag>
          </div>
        </a-card>
      </a-col>
      <a-col :span="6">
        <a-card class="em-stat-card" size="small">
          <a-statistic
            title="信用"
            :value="store.creditBalance"
            :precision="2"
          />
          <div class="em-stat-footer">
            <a-button size="small" type="link" @click="handleRefreshCredits">
              刷新
            </a-button>
          </div>
        </a-card>
      </a-col>
      <a-col :span="6">
        <a-card class="em-stat-card" size="small">
          <a-statistic title="已发布" :value="store.publishedCount" />
          <div class="em-stat-footer">
            <span class="em-stat-label">共享资产</span>
          </div>
        </a-card>
      </a-col>
      <a-col :span="6">
        <a-card class="em-stat-card" size="small">
          <a-statistic title="已导入" :value="store.importedCount" />
          <div class="em-stat-footer">
            <span class="em-stat-label">社区资产</span>
          </div>
        </a-card>
      </a-col>
    </a-row>

    <a-row :gutter="[12, 12]" class="em-action-row">
      <a-col :span="12">
        <a-card title="快速操作" size="small">
          <a-button
            block
            :disabled="!store.isRegistered"
            :loading="store.loading"
            @click="handleAutoPublish"
          >
            自动发布符合条件的资产
          </a-button>
          <a-button
            block
            :disabled="!store.isRegistered"
            :loading="store.loading"
            style="margin-top: 8px"
            @click="handleFetchTrending"
          >
            获取热门资产
          </a-button>
        </a-card>
      </a-col>
      <a-col :span="12">
        <a-card title="配置" size="small">
          <div class="em-config-items">
            <div class="em-config-item">
              <span>自动发布</span>
              <a-switch
                :checked="config?.autoPublish || false"
                size="small"
                @change="
                  (val: boolean) => handleConfigChange('autoPublish', val)
                "
              />
            </div>
            <div class="em-config-item">
              <span>自动获取</span>
              <a-switch
                :checked="config?.autoFetch || false"
                size="small"
                @change="(val: boolean) => handleConfigChange('autoFetch', val)"
              />
            </div>
            <div class="em-config-item">
              <span>心跳</span>
              <a-switch
                :checked="config?.heartbeatEnabled !== false"
                size="small"
                @change="
                  (val: boolean) => handleConfigChange('heartbeatEnabled', val)
                "
              />
            </div>
            <div class="em-config-item">
              <span>发布前审查</span>
              <a-switch
                :checked="config?.privacyFilter?.requireReview !== false"
                size="small"
                @change="
                  (val: boolean) => handlePrivacyChange('requireReview', val)
                "
              />
            </div>
          </div>
        </a-card>
      </a-col>
    </a-row>

    <a-card title="最近同步日志" size="small" class="em-log-card">
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
      <a-empty v-if="store.syncLog.length === 0" description="暂无同步活动" />
    </a-card>
  </a-modal>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { message } from "ant-design-vue";
import { GlobalOutlined, ReloadOutlined } from "@ant-design/icons-vue";
import { useEvoMapStore } from "@/stores/evomap";

const props = defineProps<{
  open: boolean;
  prefillText?: string;
}>();
defineEmits(["update:open"]);

const store = useEvoMapStore();
const refreshing = ref(false);

const config = computed(() => store.config);

const logColumns = [
  { title: "操作", dataIndex: "action", key: "action", width: 100 },
  { title: "资产 ID", dataIndex: "asset_id", key: "asset_id", width: 200 },
  { title: "状态", dataIndex: "status", key: "status", width: 80 },
  { title: "时间", dataIndex: "created_at", key: "created_at", width: 150 },
];

function formatTime(iso: string | null | undefined): string {
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
    message.success("节点注册成功");
    await loadData();
  } else {
    message.error(result.error || "注册失败");
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
      `已发布: ${result.data?.published ?? 0}, 跳过: ${result.data?.skipped ?? 0}, 错误: ${result.data?.errors ?? 0}`,
    );
  } else {
    message.error(result.error || "自动发布失败");
  }
}

async function handleFetchTrending() {
  await store.fetchTrending();
  message.success(`已获取 ${store.trendingAssets.length} 个热门资产`);
}

async function handleConfigChange(key: string, value: boolean) {
  await store.updateConfig({ [key]: value });
}

async function handlePrivacyChange(key: string, value: boolean) {
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

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      loadData();
    }
  },
  { immediate: true },
);
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
.em-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.em-subtitle {
  color: rgba(0, 0, 0, 0.45);
  font-size: 13px;
}
.em-status-row {
  margin-bottom: 12px;
}
.em-stat-footer {
  margin-top: 8px;
}
.em-stat-label {
  font-size: 12px;
  color: #999;
}
.em-action-row {
  margin-bottom: 12px;
}
.em-config-items .em-config-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 0;
}
.em-config-items .em-config-item:not(:last-child) {
  border-bottom: 1px solid #f0f0f0;
}
.em-log-card {
  margin-top: 12px;
}
</style>
