<template>
  <a-modal
    :open="open"
    :width="1000"
    :footer="null"
    :mask-closable="true"
    :body-style="{ maxHeight: '82vh', overflowY: 'auto' }"
    title="家庭守护 · 孩子使用情况"
    @update:open="(v) => $emit('update:open', v)"
  >
    <div v-if="prefillText" class="prefill-banner">
      <SafetyCertificateOutlined />
      <span class="prefill-text">命令：{{ prefillText }}</span>
    </div>

    <div class="fg-toolbar">
      <span class="fg-subtitle">孩子端 telemetry 只读镜像</span>
      <a-button size="small" :loading="store.loading" @click="refresh">
        <template #icon><ReloadOutlined /></template>
        刷新
      </a-button>
    </div>

    <a-alert
      v-if="store.error"
      type="error"
      :message="store.error"
      banner
      closable
      style="margin-bottom: 12px"
    />

    <a-empty
      v-if="!store.loading && !store.hasChildren"
      description="还没有收到任何孩子端的使用数据"
    />

    <template v-else>
      <a-space style="margin-bottom: 12px" align="center">
        <span>孩子：</span>
        <a-select
          v-model:value="selectedChild"
          style="min-width: 280px"
          :options="childOptions"
          placeholder="选择孩子"
          @change="onSelectChild"
        />
        <a-select
          v-model:value="rangeKey"
          style="min-width: 140px"
          :options="rangeOptions"
          @change="refreshDetail"
        />
      </a-space>

      <a-row :gutter="12" style="margin-bottom: 12px">
        <a-col :span="8">
          <a-card size="small">
            <a-statistic title="总使用时长" :value="totalLabel" />
          </a-card>
        </a-col>
        <a-col :span="8">
          <a-card size="small">
            <a-statistic title="应用数" :value="store.summary.apps.length" />
          </a-card>
        </a-col>
        <a-col :span="8">
          <a-card size="small">
            <a-statistic title="事件数" :value="store.events.length" />
          </a-card>
        </a-col>
      </a-row>

      <a-card title="应用使用排行" size="small" style="margin-bottom: 12px">
        <a-table
          :data-source="store.summary.apps"
          :columns="appColumns"
          :pagination="false"
          row-key="package"
          size="small"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'totalMs'">
              {{ formatDuration(record.totalMs) }}
            </template>
          </template>
        </a-table>
      </a-card>

      <a-card title="最近事件" size="small">
        <a-table
          :data-source="store.events"
          :columns="eventColumns"
          :pagination="{ pageSize: 10 }"
          row-key="resourceId"
          size="small"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'timestampMs'">
              {{ formatTime(record.timestampMs) }}
            </template>
            <template v-else-if="column.key === 'durationMs'">
              {{ formatDuration(record.durationMs) }}
            </template>
            <template v-else-if="column.key === 'app'">
              {{ record.package || "—" }}
            </template>
          </template>
        </a-table>
      </a-card>
    </template>
  </a-modal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  ReloadOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons-vue";
import { useFamilyGuardStore } from "@/stores/family-guard";

const props = defineProps<{
  open: boolean;
  prefillText?: string;
}>();
defineEmits(["update:open"]);

const store = useFamilyGuardStore();

const selectedChild = ref<string | null>(null);
const rangeKey = ref<"all" | "24h" | "7d">("all");

const rangeOptions = [
  { label: "全部", value: "all" },
  { label: "近 24 小时", value: "24h" },
  { label: "近 7 天", value: "7d" },
];

const childOptions = computed(() =>
  store.children.map((c) => ({
    label: `${c.childDid}（${c.eventCount} 条）`,
    value: c.childDid,
  })),
);

const totalLabel = computed(() => formatDuration(store.summary.totalMs));

const appColumns = [
  {
    title: "应用 / 包名",
    dataIndex: "package",
    key: "package",
    ellipsis: true,
  },
  { title: "时长", dataIndex: "totalMs", key: "totalMs", width: 140 },
  { title: "次数", dataIndex: "count", key: "count", width: 100 },
];

const eventColumns = [
  { title: "时间", dataIndex: "timestampMs", key: "timestampMs", width: 180 },
  { title: "来源", dataIndex: "source", key: "source", width: 140 },
  { title: "应用", dataIndex: "package", key: "app", ellipsis: true },
  { title: "时长", dataIndex: "durationMs", key: "durationMs", width: 120 },
  { title: "级别", dataIndex: "level", key: "level", width: 80 },
];

function sinceMsForRange(): number {
  if (rangeKey.value === "24h") {
    return Date.now() - 24 * 60 * 60 * 1000;
  }
  if (rangeKey.value === "7d") {
    return Date.now() - 7 * 24 * 60 * 60 * 1000;
  }
  return 0;
}

function formatDuration(ms: number): string {
  const totalSec = Math.round((ms || 0) / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) {
    return `${h}h ${m}m`;
  }
  if (m > 0) {
    return `${m}m ${s}s`;
  }
  return `${s}s`;
}

function formatTime(ms: number): string {
  if (!ms) {
    return "—";
  }
  return new Date(ms).toLocaleString();
}

async function onSelectChild(childDid: string): Promise<void> {
  await store.selectChild(childDid, sinceMsForRange());
}

async function refreshDetail(): Promise<void> {
  if (!store.selectedChildDid) {
    return;
  }
  const since = sinceMsForRange();
  await Promise.all([store.fetchEvents(since), store.fetchSummary(since)]);
}

async function refresh(): Promise<void> {
  await store.fetchChildren();
  selectedChild.value = store.selectedChildDid;
}

watch(
  () => props.open,
  async (isOpen) => {
    if (isOpen) {
      await refresh();
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
.fg-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.fg-subtitle {
  color: rgba(0, 0, 0, 0.45);
  font-size: 13px;
}
</style>
