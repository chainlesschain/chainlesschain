<template>
  <div class="time-machine-page">
    <!-- Header with date picker -->
    <a-card
      :bordered="false"
      class="header-card"
    >
      <div class="page-header">
        <div class="header-left">
          <ClockCircleOutlined class="header-icon" />
          <span class="header-title">Timeline Time Machine</span>
        </div>
        <div class="header-right">
          <a-date-picker
            v-model:value="selectedDate"
            :format="'YYYY-MM-DD'"
            placeholder="Select date"
            @change="handleDateChange"
          />
          <a-button
            type="primary"
            style="margin-left: 12px"
            @click="goToToday"
          >
            Today
          </a-button>
        </div>
      </div>
    </a-card>

    <!-- Main content tabs -->
    <a-card
      :bordered="false"
      class="content-card"
    >
      <a-tabs
        v-model:active-key="activeTab"
        @change="handleTabChange"
      >
        <!-- Timeline Tab -->
        <a-tab-pane
          key="timeline"
          tab="Timeline"
        >
          <a-spin :spinning="store.loading">
            <div
              v-if="store.hasTimelinePosts"
              class="timeline-list"
            >
              <a-list
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
                            <FileTextOutlined
                              v-if="item.source_type === 'post'"
                            />
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
                          {{ item.content_preview || "(No preview available)" }}
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
            </div>
            <a-empty
              v-else
              description="No timeline entries for this date"
            />
          </a-spin>
        </a-tab-pane>

        <!-- Memories Tab -->
        <a-tab-pane key="memories">
          <template #tab>
            <span>
              Memories
              <a-badge
                :count="store.unreadMemoriesCount"
                :number-style="{ backgroundColor: '#1890ff', fontSize: '10px' }"
              />
            </span>
          </template>

          <a-spin :spinning="store.loading">
            <div
              class="memories-actions"
              style="margin-bottom: 16px"
            >
              <a-space>
                <a-button @click="handleGenerateThrowback">
                  <HistoryOutlined />
                  Generate Throwback
                </a-button>
                <a-button @click="showAnnualReportModal = true">
                  <BarChartOutlined />
                  Generate Annual Report
                </a-button>
              </a-space>
            </div>

            <div
              v-if="store.memories.length > 0"
              class="memories-grid"
            >
              <MemoryCard
                v-for="memory in store.memories"
                :key="memory.id"
                :memory="memory"
                @mark-read="handleMarkRead"
              />
            </div>
            <a-empty
              v-else
              description="No memories yet. Generate your first throwback or annual report!"
            />
          </a-spin>
        </a-tab-pane>

        <!-- Stats Tab -->
        <a-tab-pane
          key="stats"
          tab="Stats"
        >
          <a-spin :spinning="statsLoading">
            <a-row :gutter="[16, 16]">
              <!-- Activity Overview -->
              <a-col :span="12">
                <a-card
                  title="Activity Overview"
                  size="small"
                >
                  <template v-if="store.activityStats">
                    <a-row :gutter="16">
                      <a-col :span="12">
                        <a-statistic
                          title="Total Posts"
                          :value="store.activityStats.totalPosts"
                        />
                      </a-col>
                      <a-col :span="12">
                        <a-statistic
                          title="Total Messages"
                          :value="store.activityStats.totalMessages"
                        />
                      </a-col>
                      <a-col
                        :span="12"
                        style="margin-top: 16px"
                      >
                        <a-statistic
                          title="Total Likes"
                          :value="store.activityStats.totalLikes"
                        />
                      </a-col>
                      <a-col
                        :span="12"
                        style="margin-top: 16px"
                      >
                        <a-statistic
                          title="Total Comments"
                          :value="store.activityStats.totalComments"
                        />
                      </a-col>
                    </a-row>
                  </template>
                  <a-empty
                    v-else
                    description="No activity data"
                  />
                </a-card>
              </a-col>

              <!-- Sentiment Trend -->
              <a-col :span="12">
                <a-card
                  title="Sentiment Trend"
                  size="small"
                >
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
                  <a-empty
                    v-else
                    description="No sentiment data"
                  />
                </a-card>
              </a-col>

              <!-- Word Cloud -->
              <a-col :span="12">
                <a-card
                  title="Word Cloud"
                  size="small"
                >
                  <template
                    v-if="store.wordCloud && store.wordCloud.length > 0"
                  >
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
                  <a-empty
                    v-else
                    description="No word cloud data"
                  />
                </a-card>
              </a-col>

              <!-- Heatmap Summary -->
              <a-col :span="12">
                <a-card
                  title="Activity Heatmap"
                  size="small"
                >
                  <template
                    v-if="store.heatmapData && store.heatmapData.length > 0"
                  >
                    <div class="heatmap-summary">
                      <a-statistic
                        title="Active Days"
                        :value="store.heatmapData.length"
                        style="margin-bottom: 12px"
                      />
                      <a-statistic
                        title="Total Interactions"
                        :value="totalHeatmapCount"
                        style="margin-bottom: 12px"
                      />
                      <a-statistic
                        title="Peak Day"
                        :value="peakHeatmapDay"
                      />
                    </div>
                  </template>
                  <a-empty
                    v-else
                    description="No heatmap data"
                  />
                </a-card>
              </a-col>
            </a-row>

            <!-- Stats Period Selector -->
            <div
              class="stats-controls"
              style="margin-top: 16px"
            >
              <a-space>
                <span>Period:</span>
                <a-radio-group
                  v-model:value="statsPeriod"
                  button-style="solid"
                  @change="loadStatsData"
                >
                  <a-radio-button value="week">
                    Week
                  </a-radio-button>
                  <a-radio-button value="month">
                    Month
                  </a-radio-button>
                  <a-radio-button value="year">
                    Year
                  </a-radio-button>
                </a-radio-group>
                <a-button @click="handleRefreshStats">
                  <ReloadOutlined />
                  Refresh
                </a-button>
              </a-space>
            </div>
          </a-spin>
        </a-tab-pane>
      </a-tabs>
    </a-card>

    <!-- Annual Report Modal -->
    <a-modal
      v-model:open="showAnnualReportModal"
      title="Generate Annual Report"
      :confirm-loading="generatingReport"
      @ok="handleGenerateAnnualReport"
      @cancel="showAnnualReportModal = false"
    >
      <a-form layout="vertical">
        <a-form-item label="Year">
          <a-input-number
            v-model:value="reportYear"
            :min="2020"
            :max="new Date().getFullYear()"
            style="width: 100%"
          />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from "vue";
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

const store = useTimeMachineStore();

// State
const selectedDate = ref(dayjs());
const activeTab = ref("timeline");
const statsPeriod = ref("month");
const statsLoading = ref(false);
const showAnnualReportModal = ref(false);
const generatingReport = ref(false);
const reportYear = ref(new Date().getFullYear() - 1);

// Computed
const totalHeatmapCount = computed(() => {
  return store.heatmapData.reduce((sum, d) => sum + d.count, 0);
});

const peakHeatmapDay = computed(() => {
  if (store.heatmapData.length === 0) {return "N/A";}
  const peak = store.heatmapData.reduce(
    (max, d) => (d.count > max.count ? d : max),
    store.heatmapData[0],
  );
  return `${peak.date} (${peak.count})`;
});

// Methods
function handleDateChange(date) {
  if (!date) {return;}

  const dateStr = date.format("YYYY-MM-DD");
  store.setCurrentDate(dateStr);

  const parts = store.currentDateParts;
  store.loadTimeline(parts.year, parts.month, parts.day);
}

function goToToday() {
  selectedDate.value = dayjs();
  handleDateChange(selectedDate.value);
}

function handleTabChange(key) {
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
    let startDate;

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
    console.error("Failed to load stats:", error);
  } finally {
    statsLoading.value = false;
  }
}

async function handleRefreshStats() {
  try {
    const ipc = window.electron?.ipcRenderer;
    if (ipc) {
      await ipc.invoke("stats:refresh");
      message.success("Stats refreshed");
      await loadStatsData();
    }
  } catch (error) {
    message.error("Failed to refresh stats");
  }
}

async function handleMarkRead(memoryId) {
  try {
    await store.markMemoryRead(memoryId);
  } catch (error) {
    message.error("Failed to mark as read");
  }
}

async function handleGenerateThrowback() {
  try {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) {return;}

    const memory = await ipc.invoke("memory:generate-throwback");
    if (memory) {
      store.memories.unshift(memory);
      message.success("Throwback memory generated!");
    } else {
      message.info("No past content available for throwback");
    }
  } catch (error) {
    message.error("Failed to generate throwback");
  }
}

async function handleGenerateAnnualReport() {
  generatingReport.value = true;
  try {
    await store.generateAnnualReport(reportYear.value);
    message.success(`Annual report for ${reportYear.value} generated!`);
    showAnnualReportModal.value = false;
  } catch (error) {
    message.error("Failed to generate annual report");
  } finally {
    generatingReport.value = false;
  }
}

function formatTimestamp(ts) {
  if (!ts) {return "";}
  const date = new Date(ts);
  return date.toLocaleString();
}

function getTypeColor(type) {
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

function sentimentToPercent(score) {
  // Convert -1..1 to 0..100
  return Math.round(((score + 1) / 2) * 100);
}

function sentimentColor(score) {
  if (score > 0.3) {return "#52c41a";}
  if (score > 0) {return "#a0d911";}
  if (score > -0.3) {return "#faad14";}
  return "#ff4d4f";
}

function getWordSize(count) {
  const maxWords = store.wordCloud.length > 0 ? store.wordCloud[0].count : 1;
  const minSize = 12;
  const maxSize = 24;
  return Math.max(
    minSize,
    Math.round((count / maxWords) * (maxSize - minSize) + minSize),
  );
}

function getWordColor(count) {
  const maxWords = store.wordCloud.length > 0 ? store.wordCloud[0].count : 1;
  const ratio = count / maxWords;
  if (ratio > 0.7) {return "blue";}
  if (ratio > 0.4) {return "geekblue";}
  if (ratio > 0.2) {return "cyan";}
  return "default";
}

// Lifecycle
onMounted(async () => {
  const parts = store.currentDateParts;
  await store.loadTimeline(parts.year, parts.month, parts.day);
});
</script>

<style scoped>
.time-machine-page {
  padding: 24px;
  height: 100%;
  overflow: auto;
}

.header-card {
  margin-bottom: 16px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.header-icon {
  font-size: 22px;
  color: #1890ff;
}

.header-title {
  font-size: 20px;
  font-weight: 600;
}

.header-right {
  display: flex;
  align-items: center;
}

.content-card {
  min-height: 400px;
}

/* Timeline styles */
.timeline-list {
  margin-top: 8px;
}

.timeline-item {
  padding: 12px;
  border-radius: 8px;
  transition: background-color 0.2s;
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

/* Memories styles */
.memories-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
}

/* Stats styles */
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
