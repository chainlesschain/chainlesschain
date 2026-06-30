<template>
  <a-modal
    :open="open"
    :width="960"
    :footer="null"
    :mask-closable="true"
    :body-style="{ maxHeight: '80vh', overflowY: 'auto' }"
    title="时光机"
    @update:open="(v) => $emit('update:open', v)"
  >
    <div v-if="prefillText" class="prefill-banner">
      <ClockCircleOutlined />
      <span class="prefill-text">命令：{{ prefillText }}</span>
    </div>

    <div class="tm-toolbar">
      <span class="tm-subtitle">Timeline Time Machine</span>
      <div>
        <a-date-picker
          v-model:value="selectedDate"
          :format="'YYYY-MM-DD'"
          placeholder="选择日期"
          @change="handleDateChange"
        />
        <a-button type="primary" style="margin-left: 12px" @click="goToToday">
          今天
        </a-button>
      </div>
    </div>

    <a-tabs v-model:active-key="activeTab" @change="handleTabChange">
      <a-tab-pane key="timeline" tab="时间线">
        <a-spin :spinning="store.loading">
          <a-list
            v-if="store.hasTimelinePosts"
            :data-source="store.timelinePosts"
            item-layout="vertical"
          >
            <template #renderItem="{ item }">
              <a-list-item class="timeline-item">
                <a-list-item-meta>
                  <template #avatar>
                    <a-avatar
                      :style="{
                        backgroundColor: getTypeColor(item.source_type),
                      }"
                    >
                      <template #icon>
                        <FileTextOutlined v-if="item.source_type === 'post'" />
                        <MessageOutlined
                          v-else-if="item.source_type === 'message'"
                        />
                        <CalendarOutlined v-else />
                      </template>
                    </a-avatar>
                  </template>
                  <template #title>
                    <div class="timeline-item-header">
                      <a-tag :color="getTypeColor(item.source_type)">
                        {{ item.source_type }}
                      </a-tag>
                      <span class="timeline-time">
                        {{ formatTimestamp(item.created_at) }}
                      </span>
                    </div>
                  </template>
                  <template #description>
                    <p class="timeline-content">
                      {{ item.content_preview || "(无预览)" }}
                    </p>
                    <div
                      v-if="item.media_urls && item.media_urls.length > 0"
                      class="timeline-media"
                    >
                      <a-image
                        v-for="(url, idx) in item.media_urls.slice(0, 4)"
                        :key="idx"
                        :src="url"
                        :width="80"
                        :height="80"
                        class="media-thumbnail"
                      />
                      <span
                        v-if="item.media_urls.length > 4"
                        class="media-more"
                      >
                        +{{ item.media_urls.length - 4 }}
                      </span>
                    </div>
                  </template>
                </a-list-item-meta>
              </a-list-item>
            </template>
          </a-list>
          <a-empty v-else description="该日期暂无时间线记录" />
        </a-spin>
      </a-tab-pane>

      <a-tab-pane key="memories">
        <template #tab>
          <span>
            回忆
            <a-badge
              :count="store.unreadMemoriesCount"
              :number-style="{ backgroundColor: '#1890ff', fontSize: '10px' }"
            />
          </span>
        </template>

        <a-spin :spinning="store.loading">
          <div class="memories-actions" style="margin-bottom: 16px">
            <a-space>
              <a-button @click="handleGenerateThrowback">
                <template #icon><HistoryOutlined /></template>
                生成回忆
              </a-button>
              <a-button @click="showAnnualReportModal = true">
                <template #icon><BarChartOutlined /></template>
                生成年度报告
              </a-button>
            </a-space>
          </div>

          <div v-if="store.memories.length > 0" class="memories-grid">
            <MemoryCard
              v-for="memory in store.memories"
              :key="memory.id"
              :memory="memory"
              @mark-read="handleMarkRead"
            />
          </div>
          <a-empty
            v-else
            description="暂无回忆，先生成一个回忆或年度报告吧！"
          />
        </a-spin>
      </a-tab-pane>

      <a-tab-pane key="stats" tab="统计">
        <a-spin :spinning="statsLoading">
          <a-row :gutter="[16, 16]">
            <a-col :span="12">
              <a-card title="活动概览" size="small">
                <template v-if="store.activityStats">
                  <a-row :gutter="16">
                    <a-col :span="12">
                      <a-statistic
                        title="帖子总数"
                        :value="store.activityStats.totalPosts"
                      />
                    </a-col>
                    <a-col :span="12">
                      <a-statistic
                        title="消息总数"
                        :value="store.activityStats.totalMessages"
                      />
                    </a-col>
                    <a-col :span="12" style="margin-top: 16px">
                      <a-statistic
                        title="点赞总数"
                        :value="store.activityStats.totalLikes"
                      />
                    </a-col>
                    <a-col :span="12" style="margin-top: 16px">
                      <a-statistic
                        title="评论总数"
                        :value="store.activityStats.totalComments"
                      />
                    </a-col>
                  </a-row>
                </template>
                <a-empty v-else description="暂无活动数据" />
              </a-card>
            </a-col>

            <a-col :span="12">
              <a-card title="情绪趋势" size="small">
                <template
                  v-if="store.sentimentTrend && store.sentimentTrend.length > 0"
                >
                  <div class="sentiment-list">
                    <div
                      v-for="point in store.sentimentTrend.slice(0, 7)"
                      :key="point.date"
                      class="sentiment-item"
                    >
                      <span class="sentiment-date">{{ point.date }}</span>
                      <a-progress
                        :percent="sentimentToPercent(point.avgScore)"
                        :stroke-color="sentimentColor(point.avgScore)"
                        :show-info="false"
                        size="small"
                        style="flex: 1; margin: 0 12px"
                      />
                      <span class="sentiment-score">
                        {{ point.avgScore.toFixed(2) }}
                      </span>
                    </div>
                  </div>
                </template>
                <a-empty v-else description="暂无情绪数据" />
              </a-card>
            </a-col>

            <a-col :span="12">
              <a-card title="词云" size="small">
                <template v-if="store.wordCloud && store.wordCloud.length > 0">
                  <div class="word-cloud">
                    <a-tag
                      v-for="item in store.wordCloud.slice(0, 30)"
                      :key="item.word"
                      :style="{
                        fontSize: getWordSize(item.count) + 'px',
                        margin: '4px',
                      }"
                      :color="getWordColor(item.count)"
                    >
                      {{ item.word }} ({{ item.count }})
                    </a-tag>
                  </div>
                </template>
                <a-empty v-else description="暂无词云数据" />
              </a-card>
            </a-col>

            <a-col :span="12">
              <a-card title="活动热力图" size="small">
                <template
                  v-if="store.heatmapData && store.heatmapData.length > 0"
                >
                  <div class="heatmap-summary">
                    <a-statistic
                      title="活跃天数"
                      :value="store.heatmapData.length"
                      style="margin-bottom: 12px"
                    />
                    <a-statistic
                      title="总互动数"
                      :value="totalHeatmapCount"
                      style="margin-bottom: 12px"
                    />
                    <a-statistic title="高峰日" :value="peakHeatmapDay" />
                  </div>
                </template>
                <a-empty v-else description="暂无热力图数据" />
              </a-card>
            </a-col>
          </a-row>

          <div class="stats-controls" style="margin-top: 16px">
            <a-space>
              <span>周期：</span>
              <a-radio-group
                v-model:value="statsPeriod"
                button-style="solid"
                @change="loadStatsData"
              >
                <a-radio-button value="week">周</a-radio-button>
                <a-radio-button value="month">月</a-radio-button>
                <a-radio-button value="year">年</a-radio-button>
              </a-radio-group>
              <a-button @click="handleRefreshStats">
                <template #icon><ReloadOutlined /></template>
                刷新
              </a-button>
            </a-space>
          </div>
        </a-spin>
      </a-tab-pane>
    </a-tabs>

    <a-modal
      v-model:open="showAnnualReportModal"
      title="生成年度报告"
      :confirm-loading="generatingReport"
      @ok="handleGenerateAnnualReport"
      @cancel="showAnnualReportModal = false"
    >
      <a-form layout="vertical">
        <a-form-item label="年份">
          <a-input-number
            v-model:value="reportYear"
            :min="2020"
            :max="maxYear"
            style="width: 100%"
          />
        </a-form-item>
      </a-form>
    </a-modal>
  </a-modal>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { message } from "ant-design-vue";
import {
  ClockCircleOutlined,
  FileTextOutlined,
  MessageOutlined,
  CalendarOutlined,
  HistoryOutlined,
  BarChartOutlined,
  ReloadOutlined,
} from "@ant-design/icons-vue";
import { useTimeMachineStore } from "../stores/timeMachine";
import MemoryCard from "../components/social/MemoryCard.vue";
import dayjs from "dayjs";

const props = defineProps<{ open: boolean; prefillText?: string }>();
defineEmits<{ (e: "update:open", value: boolean): void }>();

const store = useTimeMachineStore();

const selectedDate = ref(dayjs());
const activeTab = ref("timeline");
const statsPeriod = ref("month");
const statsLoading = ref(false);
const showAnnualReportModal = ref(false);
const generatingReport = ref(false);
const maxYear = new Date().getFullYear();
const reportYear = ref(maxYear - 1);

const totalHeatmapCount = computed(() =>
  store.heatmapData.reduce((sum: number, d: any) => sum + d.count, 0),
);

const peakHeatmapDay = computed(() => {
  if (store.heatmapData.length === 0) {
    return "N/A";
  }
  const peak = store.heatmapData.reduce(
    (max: any, d: any) => (d.count > max.count ? d : max),
    store.heatmapData[0],
  );
  return `${peak.date} (${peak.count})`;
});

function ipc(): any {
  return (window as any).electron?.ipcRenderer || null;
}

function handleDateChange(date: any) {
  if (!date) {
    return;
  }
  const dateStr = date.format("YYYY-MM-DD");
  store.setCurrentDate(dateStr);
  const parts = store.currentDateParts;
  store.loadTimeline(parts.year, parts.month, parts.day);
}

function goToToday() {
  selectedDate.value = dayjs();
  handleDateChange(selectedDate.value);
}

function handleTabChange(key: string) {
  activeTab.value = key;
  if (key === "memories" && store.memories.length === 0) {
    store.loadMemories();
  } else if (key === "stats") {
    loadStatsData();
  }
}

async function loadStatsData() {
  statsLoading.value = true;
  try {
    const now = new Date();
    const endDate = now.toISOString().split("T")[0];
    let startDate: string;
    switch (statsPeriod.value) {
      case "week":
        startDate = new Date(now.getTime() - 7 * 86400000)
          .toISOString()
          .split("T")[0];
        break;
      case "year":
        startDate = `${now.getFullYear()}-01-01`;
        break;
      default:
        startDate = new Date(now.getFullYear(), now.getMonth(), 1)
          .toISOString()
          .split("T")[0];
    }
    await Promise.all([
      store.loadActivityStats(statsPeriod.value),
      store.loadSentimentTrend(startDate, endDate),
      store.loadWordCloud(startDate, endDate),
      store.loadHeatmap(now.getFullYear()),
    ]);
  } catch (error) {
    console.error("[TimeMachinePanel] 加载统计失败:", error);
  } finally {
    statsLoading.value = false;
  }
}

async function handleRefreshStats() {
  try {
    const conn = ipc();
    if (conn) {
      await conn.invoke("stats:refresh");
      message.success("统计已刷新");
      await loadStatsData();
    }
  } catch (_error) {
    message.error("刷新统计失败");
  }
}

async function handleMarkRead(memoryId: string) {
  try {
    await store.markMemoryRead(memoryId);
  } catch (_error) {
    message.error("标记已读失败");
  }
}

async function handleGenerateThrowback() {
  try {
    const conn = ipc();
    if (!conn) {
      return;
    }
    const memory = await conn.invoke("memory:generate-throwback");
    if (memory) {
      store.memories.unshift(memory);
      message.success("已生成回忆！");
    } else {
      message.info("暂无可用于回忆的历史内容");
    }
  } catch (_error) {
    message.error("生成回忆失败");
  }
}

async function handleGenerateAnnualReport() {
  generatingReport.value = true;
  try {
    await store.generateAnnualReport(reportYear.value);
    message.success(`${reportYear.value} 年度报告已生成！`);
    showAnnualReportModal.value = false;
  } catch (_error) {
    message.error("生成年度报告失败");
  } finally {
    generatingReport.value = false;
  }
}

function formatTimestamp(ts: string | number) {
  if (!ts) {
    return "";
  }
  return new Date(ts).toLocaleString();
}

function getTypeColor(type: string) {
  switch (type) {
    case "post":
      return "#1890ff";
    case "message":
      return "#52c41a";
    case "event":
      return "#faad14";
    default:
      return "#d9d9d9";
  }
}

function sentimentToPercent(score: number) {
  return Math.round(((score + 1) / 2) * 100);
}

function sentimentColor(score: number) {
  if (score > 0.3) {
    return "#52c41a";
  }
  if (score > 0) {
    return "#a0d911";
  }
  if (score > -0.3) {
    return "#faad14";
  }
  return "#ff4d4f";
}

function getWordSize(count: number) {
  const maxWords = store.wordCloud.length > 0 ? store.wordCloud[0].count : 1;
  const minSize = 12;
  const maxSize = 24;
  return Math.max(
    minSize,
    Math.round((count / maxWords) * (maxSize - minSize) + minSize),
  );
}

function getWordColor(count: number) {
  const maxWords = store.wordCloud.length > 0 ? store.wordCloud[0].count : 1;
  const ratio = count / maxWords;
  if (ratio > 0.7) {
    return "blue";
  }
  if (ratio > 0.4) {
    return "geekblue";
  }
  if (ratio > 0.2) {
    return "cyan";
  }
  return "default";
}

// Load timeline for the current date on open.
watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) {
      return;
    }
    const parts = store.currentDateParts;
    store.loadTimeline(parts.year, parts.month, parts.day);
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
.tm-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.tm-subtitle {
  color: rgba(0, 0, 0, 0.45);
  font-size: 13px;
}
.timeline-item {
  padding: 12px;
  border-radius: 8px;
}
.timeline-item:hover {
  background-color: #fafafa;
}
.timeline-item-header {
  display: flex;
  align-items: center;
  gap: 8px;
}
.timeline-time {
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
}
.timeline-content {
  margin: 8px 0 0 0;
  line-height: 1.6;
  color: rgba(0, 0, 0, 0.75);
  white-space: pre-wrap;
}
.timeline-media {
  display: flex;
  gap: 8px;
  margin-top: 8px;
  align-items: center;
}
.media-thumbnail {
  border-radius: 4px;
  object-fit: cover;
}
.media-more {
  font-size: 14px;
  color: rgba(0, 0, 0, 0.45);
  padding-left: 4px;
}
.memories-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}
.sentiment-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.sentiment-item {
  display: flex;
  align-items: center;
  gap: 8px;
}
.sentiment-date {
  font-size: 12px;
  color: rgba(0, 0, 0, 0.65);
  min-width: 80px;
}
.sentiment-score {
  font-size: 12px;
  font-weight: 500;
  min-width: 40px;
  text-align: right;
}
.word-cloud {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  padding: 8px;
}
.heatmap-summary {
  text-align: center;
}
.stats-controls {
  text-align: center;
}
</style>
