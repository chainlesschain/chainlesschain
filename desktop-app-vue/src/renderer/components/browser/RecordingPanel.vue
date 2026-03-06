<template>
  <a-card
    title="📹 录制与回放"
    :bordered="false"
    class="recording-panel"
  >
    <a-tabs
      v-model:active-key="activeTab"
      type="card"
    >
      <!-- 录制控制 -->
      <a-tab-pane
        key="record"
        tab="录制操作"
      >
        <a-space
          direction="vertical"
          style="width: 100%"
          size="large"
        >
          <!-- 录制状态 -->
          <a-alert
            :type="recordingStatus.type"
            :message="recordingStatus.message"
            show-icon
          >
            <template #icon>
              <span
                v-if="isRecording && !isPaused"
                class="recording-dot-pulse"
              />
            </template>
            <template
              v-if="isRecording"
              #description
            >
              <a-space>
                <a-statistic
                  title="录制时长"
                  :value="formatDuration(recordingDuration)"
                  :value-style="{ fontSize: '14px' }"
                />
                <a-statistic
                  title="事件数"
                  :value="stats.eventCount"
                  :value-style="{ fontSize: '14px' }"
                />
                <a-statistic
                  title="点击"
                  :value="stats.clickCount"
                  :value-style="{ fontSize: '14px' }"
                />
                <a-statistic
                  title="输入"
                  :value="stats.inputCount"
                  :value-style="{ fontSize: '14px' }"
                />
              </a-space>
            </template>
          </a-alert>

          <!-- 录制配置（未录制时显示） -->
          <a-card
            v-if="!isRecording"
            title="录制配置"
            size="small"
          >
            <a-form layout="vertical">
              <a-form-item label="录制名称">
                <a-input
                  v-model:value="recordingConfig.name"
                  placeholder="我的录制 #1"
                />
              </a-form-item>
              <a-form-item label="捕获选项">
                <a-checkbox-group
                  v-model:value="recordingConfig.captureOptions"
                >
                  <a-checkbox value="clicks">
                    点击事件
                  </a-checkbox>
                  <a-checkbox value="typing">
                    键盘输入
                  </a-checkbox>
                  <a-checkbox value="scrolls">
                    滚动事件
                  </a-checkbox>
                  <a-checkbox value="navigation">
                    页面导航
                  </a-checkbox>
                  <a-checkbox value="screenshots">
                    自动截图
                  </a-checkbox>
                </a-checkbox-group>
              </a-form-item>
              <a-form-item label="事件合并延迟">
                <a-slider
                  v-model:value="recordingConfig.coalesceDelay"
                  :min="0"
                  :max="1000"
                  :step="100"
                  :marks="{ 0: '关闭', 300: '300ms', 500: '500ms', 1000: '1s' }"
                />
              </a-form-item>
            </a-form>
          </a-card>

          <!-- 控制按钮 -->
          <a-space>
            <a-button
              v-if="!isRecording"
              type="primary"
              size="large"
              danger
              :loading="loading.start"
              @click="handleStartRecording"
            >
              <template #icon>
                <PlayCircleOutlined />
              </template>
              开始录制
            </a-button>

            <template v-else>
              <a-button
                v-if="!isPaused"
                size="large"
                @click="handlePauseRecording"
              >
                <template #icon>
                  <PauseOutlined />
                </template>
                暂停
              </a-button>
              <a-button
                v-else
                type="primary"
                size="large"
                @click="handleResumeRecording"
              >
                <template #icon>
                  <CaretRightOutlined />
                </template>
                继续
              </a-button>

              <a-button
                danger
                size="large"
                :loading="loading.stop"
                @click="handleStopRecording"
              >
                <template #icon>
                  <StopOutlined />
                </template>
                停止并保存
              </a-button>
            </template>
          </a-space>

          <!-- 实时事件列表 -->
          <a-card
            v-if="isRecording && recentEvents.length > 0"
            title="最近事件"
            size="small"
          >
            <div class="recent-events-list">
              <div
                v-for="(event, index) in recentEvents.slice(0, 10)"
                :key="index"
                class="event-item"
              >
                <a-tag :color="getEventColor(event.type)">
                  {{ getEventTypeLabel(event.type) }}
                </a-tag>
                <span class="event-description">{{
                  getEventDescription(event)
                }}</span>
                <span class="event-time">{{
                  formatEventTime(event.timestamp)
                }}</span>
              </div>
            </div>
          </a-card>
        </a-space>
      </a-tab-pane>

      <!-- 录制历史 -->
      <a-tab-pane
        key="history"
        tab="录制历史"
      >
        <a-space
          direction="vertical"
          style="width: 100%"
          size="middle"
        >
          <a-space>
            <a-button
              type="primary"
              @click="handleRefreshRecordings"
            >
              <template #icon>
                <ReloadOutlined />
              </template>
              刷新列表
            </a-button>
            <a-input-search
              v-model:value="searchKeyword"
              placeholder="搜索录制..."
              style="width: 300px"
              @search="handleSearch"
            />
          </a-space>

          <a-table
            :columns="recordingsColumns"
            :data-source="filteredRecordings"
            :pagination="{ pageSize: 10 }"
            :loading="loading.list"
            row-key="id"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'name'">
                <a-tooltip :title="record.description || '无描述'">
                  <span>{{ record.name }}</span>
                </a-tooltip>
              </template>
              <template v-if="column.key === 'duration'">
                {{ formatDuration(record.duration) }}
              </template>
              <template v-if="column.key === 'eventCount'">
                <a-badge
                  :count="record.eventCount"
                  :overflow-count="999"
                />
              </template>
              <template v-if="column.key === 'createdAt'">
                {{ formatTimestamp(record.createdAt) }}
              </template>
              <template v-if="column.key === 'action'">
                <a-space>
                  <a-button
                    type="link"
                    size="small"
                    @click="handlePlayRecording(record)"
                  >
                    <template #icon>
                      <PlayCircleOutlined />
                    </template>
                    回放
                  </a-button>
                  <a-button
                    type="link"
                    size="small"
                    @click="handleConvertToWorkflow(record)"
                  >
                    <template #icon>
                      <BranchesOutlined />
                    </template>
                    转工作流
                  </a-button>
                  <a-button
                    type="link"
                    size="small"
                    @click="handleEditRecording(record)"
                  >
                    编辑
                  </a-button>
                  <a-popconfirm
                    title="确定删除这个录制吗？"
                    @confirm="handleDeleteRecording(record.id)"
                  >
                    <a-button
                      type="link"
                      size="small"
                      danger
                    >
                      删除
                    </a-button>
                  </a-popconfirm>
                </a-space>
              </template>
            </template>
          </a-table>
        </a-space>
      </a-tab-pane>

      <!-- 回放控制 -->
      <a-tab-pane
        key="playback"
        tab="回放控制"
      >
        <a-space
          direction="vertical"
          style="width: 100%"
          size="large"
        >
          <a-alert
            v-if="!playbackState.playbackId"
            type="info"
            message="当前没有正在回放的录制"
            description="请从「录制历史」标签页选择一个录制进行回放"
            show-icon
          />

          <template v-else>
            <!-- 回放状态 -->
            <a-card
              title="回放状态"
              size="small"
            >
              <a-descriptions
                :column="2"
                size="small"
              >
                <a-descriptions-item label="录制名称">
                  {{ playbackState.recordingName }}
                </a-descriptions-item>
                <a-descriptions-item label="状态">
                  <a-badge
                    :status="playbackState.isPaused ? 'warning' : 'processing'"
                    :text="playbackState.isPaused ? '已暂停' : '播放中'"
                  />
                </a-descriptions-item>
                <a-descriptions-item label="进度">
                  {{ playbackState.currentStep + 1 }} /
                  {{ playbackState.totalSteps }}
                </a-descriptions-item>
                <a-descriptions-item label="播放速度">
                  {{ playbackState.speed }}x
                </a-descriptions-item>
              </a-descriptions>

              <!-- 进度条 -->
              <a-progress
                :percent="playbackProgress"
                :stroke-color="{ '0%': '#108ee9', '100%': '#87d068' }"
              />
            </a-card>

            <!-- 播放控制 -->
            <a-space size="large">
              <a-button
                v-if="!playbackState.isPaused"
                @click="handlePausePlayback"
              >
                <template #icon>
                  <PauseOutlined />
                </template>
                暂停
              </a-button>
              <a-button
                v-else
                type="primary"
                @click="handleResumePlayback"
              >
                <template #icon>
                  <CaretRightOutlined />
                </template>
                继续
              </a-button>

              <a-button
                danger
                @click="handleStopPlayback"
              >
                <template #icon>
                  <StopOutlined />
                </template>
                停止
              </a-button>

              <a-divider type="vertical" />

              <span>播放速度：</span>
              <a-radio-group
                v-model:value="playbackState.speed"
                @change="handleSpeedChange"
              >
                <a-radio-button :value="0.5">
                  0.5x
                </a-radio-button>
                <a-radio-button :value="1">
                  1x
                </a-radio-button>
                <a-radio-button :value="1.5">
                  1.5x
                </a-radio-button>
                <a-radio-button :value="2">
                  2x
                </a-radio-button>
              </a-radio-group>
            </a-space>

            <!-- 步骤列表 -->
            <a-card
              title="回放步骤"
              size="small"
            >
              <a-timeline>
                <a-timeline-item
                  v-for="(step, index) in playbackState.steps"
                  :key="index"
                  :color="
                    index === playbackState.currentStep
                      ? 'blue'
                      : index < playbackState.currentStep
                        ? 'green'
                        : 'gray'
                  "
                >
                  <template #dot>
                    <span v-if="index === playbackState.currentStep">▶</span>
                  </template>
                  <div>
                    <strong>{{ getEventTypeLabel(step.type) }}</strong>
                    <span style="margin-left: 8px; color: #999">
                      {{ getEventDescription(step) }}
                    </span>
                  </div>
                </a-timeline-item>
              </a-timeline>
            </a-card>
          </template>
        </a-space>
      </a-tab-pane>
    </a-tabs>
  </a-card>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted } from "vue";
import { message } from "ant-design-vue";
import {
  PlayCircleOutlined,
  PauseOutlined,
  StopOutlined,
  CaretRightOutlined,
  ReloadOutlined,
  BranchesOutlined,
} from "@ant-design/icons-vue";

// Props
const props = defineProps({
  targetId: {
    type: String,
    required: true,
  },
});

// Emit
const emit = defineEmits(["recording-saved", "workflow-created"]);

// State
const activeTab = ref("record");
const loading = reactive({
  start: false,
  stop: false,
  list: false,
});

// Recording state
const isRecording = ref(false);
const isPaused = ref(false);
const recordingDuration = ref(0);
const stats = reactive({
  eventCount: 0,
  clickCount: 0,
  inputCount: 0,
  navigationCount: 0,
});
const recentEvents = ref([]);

const recordingConfig = reactive({
  name: "",
  captureOptions: ["clicks", "typing", "scrolls", "navigation"],
  coalesceDelay: 300,
});

// Recordings list
const recordings = ref([]);
const searchKeyword = ref("");

const recordingsColumns = [
  { title: "名称", dataIndex: "name", key: "name" },
  { title: "时长", dataIndex: "duration", key: "duration", width: 100 },
  { title: "事件数", dataIndex: "eventCount", key: "eventCount", width: 100 },
  { title: "创建时间", dataIndex: "createdAt", key: "createdAt", width: 180 },
  { title: "操作", key: "action", width: 300 },
];

const filteredRecordings = computed(() => {
  if (!searchKeyword.value) {
    return recordings.value;
  }
  const keyword = searchKeyword.value.toLowerCase();
  return recordings.value.filter(
    (r) =>
      r.name.toLowerCase().includes(keyword) ||
      (r.description && r.description.toLowerCase().includes(keyword)),
  );
});

// Playback state
const playbackState = reactive({
  playbackId: null,
  recordingName: "",
  currentStep: 0,
  totalSteps: 0,
  isPaused: false,
  speed: 1,
  steps: [],
});

const playbackProgress = computed(() => {
  if (playbackState.totalSteps === 0) {
    return 0;
  }
  return Math.round(
    (playbackState.currentStep / playbackState.totalSteps) * 100,
  );
});

const recordingStatus = computed(() => {
  if (!isRecording.value) {
    return { type: "info", message: "准备录制" };
  }
  if (isPaused.value) {
    return { type: "warning", message: "录制已暂停" };
  }
  return { type: "success", message: "正在录制..." };
});

// Timers
let durationInterval = null;
let statusPollInterval = null;

// Methods

/**
 * 开始录制
 */
const handleStartRecording = async () => {
  loading.start = true;
  try {
    await window.electron.ipcRenderer.invoke(
      "browser:recording:start",
      props.targetId,
      {
        name: recordingConfig.name || `Recording ${Date.now()}`,
        captureClicks: recordingConfig.captureOptions.includes("clicks"),
        captureTyping: recordingConfig.captureOptions.includes("typing"),
        captureScrolls: recordingConfig.captureOptions.includes("scrolls"),
        captureNavigation:
          recordingConfig.captureOptions.includes("navigation"),
        captureScreenshots:
          recordingConfig.captureOptions.includes("screenshots"),
        coalesceDelay: recordingConfig.coalesceDelay,
      },
    );

    isRecording.value = true;
    isPaused.value = false;
    recordingDuration.value = 0;
    resetStats();
    recentEvents.value = [];

    // Start duration timer
    durationInterval = setInterval(() => {
      if (!isPaused.value) {
        recordingDuration.value += 1000;
      }
    }, 1000);

    // Poll for status
    statusPollInterval = setInterval(pollRecordingStatus, 1000);

    message.success("录制已开始");
  } catch (error) {
    message.error("开始录制失败: " + error.message);
    console.error("Start recording error:", error);
  } finally {
    loading.start = false;
  }
};

/**
 * 停止录制
 */
const handleStopRecording = async () => {
  loading.stop = true;
  try {
    const result = await window.electron.ipcRenderer.invoke(
      "browser:recording:stop",
      props.targetId,
    );

    isRecording.value = false;
    isPaused.value = false;

    clearInterval(durationInterval);
    clearInterval(statusPollInterval);

    // Save the recording
    const saved = await window.electron.ipcRenderer.invoke(
      "browser:recording:save",
      result.recording,
    );

    message.success("录制已保存");
    emit("recording-saved", saved);

    // Refresh list
    await handleRefreshRecordings();

    // Switch to history tab
    activeTab.value = "history";
  } catch (error) {
    message.error("停止录制失败: " + error.message);
    console.error("Stop recording error:", error);
  } finally {
    loading.stop = false;
  }
};

/**
 * 暂停录制
 */
const handlePauseRecording = async () => {
  try {
    await window.electron.ipcRenderer.invoke(
      "browser:recording:pause",
      props.targetId,
    );
    isPaused.value = true;
    message.info("录制已暂停");
  } catch (error) {
    message.error("暂停失败: " + error.message);
  }
};

/**
 * 继续录制
 */
const handleResumeRecording = async () => {
  try {
    await window.electron.ipcRenderer.invoke(
      "browser:recording:resume",
      props.targetId,
    );
    isPaused.value = false;
    message.success("录制已继续");
  } catch (error) {
    message.error("继续失败: " + error.message);
  }
};

/**
 * 轮询录制状态
 */
const pollRecordingStatus = async () => {
  try {
    const status = await window.electron.ipcRenderer.invoke(
      "browser:recording:getStatus",
      props.targetId,
    );
    if (status && status.recording) {
      stats.eventCount = status.recording.events?.length || 0;
      stats.clickCount =
        status.recording.events?.filter((e) => e.type === "click").length || 0;
      stats.inputCount =
        status.recording.events?.filter((e) => e.type === "type").length || 0;
      stats.navigationCount =
        status.recording.events?.filter((e) => e.type === "navigate").length ||
        0;

      // Update recent events
      if (status.recording.events && status.recording.events.length > 0) {
        recentEvents.value = [...status.recording.events].reverse();
      }
    }
  } catch (error) {
    console.error("Poll recording status error:", error);
  }
};

/**
 * 刷新录制列表
 */
const handleRefreshRecordings = async () => {
  loading.list = true;
  try {
    const result = await window.electron.ipcRenderer.invoke(
      "browser:recording:list",
      {
        sortBy: "createdAt",
        sortOrder: "desc",
      },
    );
    recordings.value = result.recordings || [];
  } catch (error) {
    message.error("加载录制列表失败: " + error.message);
    console.error("Load recordings error:", error);
  } finally {
    loading.list = false;
  }
};

/**
 * 回放录制
 */
const handlePlayRecording = async (recording) => {
  try {
    const result = await window.electron.ipcRenderer.invoke(
      "browser:recording:play",
      recording,
      props.targetId,
      { speed: 1 },
    );

    playbackState.playbackId = result.playbackId;
    playbackState.recordingName = recording.name;
    playbackState.currentStep = 0;
    playbackState.totalSteps = recording.events?.length || 0;
    playbackState.isPaused = false;
    playbackState.speed = 1;
    playbackState.steps = recording.events || [];

    activeTab.value = "playback";
    message.success("开始回放");

    // Poll playback status
    const pollPlayback = setInterval(async () => {
      try {
        const status = await window.electron.ipcRenderer.invoke(
          "browser:recording:getPlaybackStatus",
          playbackState.playbackId,
        );
        if (status) {
          playbackState.currentStep = status.currentIndex || 0;
          playbackState.isPaused = status.isPaused || false;

          if (status.state === "completed" || status.state === "stopped") {
            clearInterval(pollPlayback);
            playbackState.playbackId = null;
            message.success("回放完成");
          }
        }
      } catch (error) {
        clearInterval(pollPlayback);
      }
    }, 500);
  } catch (error) {
    message.error("回放失败: " + error.message);
    console.error("Play recording error:", error);
  }
};

/**
 * 暂停回放
 */
const handlePausePlayback = async () => {
  try {
    await window.electron.ipcRenderer.invoke(
      "browser:recording:playPause",
      playbackState.playbackId,
    );
    playbackState.isPaused = true;
    message.info("回放已暂停");
  } catch (error) {
    message.error("暂停失败: " + error.message);
  }
};

/**
 * 继续回放
 */
const handleResumePlayback = async () => {
  try {
    await window.electron.ipcRenderer.invoke(
      "browser:recording:playResume",
      playbackState.playbackId,
    );
    playbackState.isPaused = false;
    message.success("回放已继续");
  } catch (error) {
    message.error("继续失败: " + error.message);
  }
};

/**
 * 停止回放
 */
const handleStopPlayback = async () => {
  try {
    await window.electron.ipcRenderer.invoke(
      "browser:recording:playStop",
      playbackState.playbackId,
    );
    playbackState.playbackId = null;
    message.success("回放已停止");
  } catch (error) {
    message.error("停止失败: " + error.message);
  }
};

/**
 * 修改播放速度
 */
const handleSpeedChange = () => {
  // Speed change is handled by the playback engine
  message.info(`播放速度已设置为 ${playbackState.speed}x`);
};

/**
 * 转换为工作流
 */
const handleConvertToWorkflow = async (recording) => {
  try {
    const workflow = await window.electron.ipcRenderer.invoke(
      "browser:recording:toWorkflow",
      recording,
    );
    message.success("已转换为工作流");
    emit("workflow-created", workflow);
  } catch (error) {
    message.error("转换失败: " + error.message);
    console.error("Convert to workflow error:", error);
  }
};

/**
 * 编辑录制
 */
const handleEditRecording = (recording) => {
  message.info("编辑功能开发中");
};

/**
 * 删除录制
 */
const handleDeleteRecording = async (id) => {
  try {
    await window.electron.ipcRenderer.invoke("browser:recording:delete", id);
    message.success("录制已删除");
    await handleRefreshRecordings();
  } catch (error) {
    message.error("删除失败: " + error.message);
  }
};

/**
 * 搜索
 */
const handleSearch = (value) => {
  searchKeyword.value = value;
};

// Helper methods
const resetStats = () => {
  stats.eventCount = 0;
  stats.clickCount = 0;
  stats.inputCount = 0;
  stats.navigationCount = 0;
};

const formatDuration = (ms) => {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}:${String(minutes % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  } else if (minutes > 0) {
    return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
  }
  return `${seconds}s`;
};

const formatTimestamp = (timestamp) => {
  return new Date(timestamp).toLocaleString("zh-CN");
};

const formatEventTime = (timestamp) => {
  return new Date(timestamp).toLocaleTimeString("zh-CN");
};

const getEventTypeLabel = (type) => {
  const labels = {
    click: "点击",
    type: "输入",
    navigate: "导航",
    scroll: "滚动",
    key: "按键",
    select: "选择",
    hover: "悬停",
    focus: "聚焦",
    blur: "失焦",
  };
  return labels[type] || type;
};

const getEventColor = (type) => {
  const colors = {
    click: "blue",
    type: "green",
    navigate: "purple",
    scroll: "orange",
    key: "cyan",
  };
  return colors[type] || "default";
};

const getEventDescription = (event) => {
  switch (event.type) {
    case "click":
      return `点击 ${event.selector || "元素"}`;
    case "type":
      return `输入 "${event.text || ""}"`;
    case "navigate":
      return `导航到 ${event.url || ""}`;
    case "scroll":
      return `滚动到 (${event.x}, ${event.y})`;
    case "key":
      return `按键 ${event.key || ""}`;
    default:
      return event.description || "";
  }
};

// Lifecycle
onMounted(async () => {
  await handleRefreshRecordings();
});

onUnmounted(() => {
  if (durationInterval) {
    clearInterval(durationInterval);
  }
  if (statusPollInterval) {
    clearInterval(statusPollInterval);
  }
});
</script>

<style scoped lang="less">
.recording-panel {
  :deep(.ant-card-body) {
    padding: 16px;
  }

  .recording-dot-pulse {
    display: inline-block;
    width: 8px;
    height: 8px;
    background-color: #ff4d4f;
    border-radius: 50%;
    animation: pulse 1.5s ease-in-out infinite;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
      transform: scale(1);
    }
    50% {
      opacity: 0.5;
      transform: scale(1.2);
    }
  }

  .recent-events-list {
    max-height: 300px;
    overflow-y: auto;

    .event-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 8px;
      border-bottom: 1px solid #f0f0f0;

      &:last-child {
        border-bottom: none;
      }

      .event-description {
        flex: 1;
        font-size: 14px;
      }

      .event-time {
        font-size: 12px;
        color: #999;
      }
    }
  }
}
</style>
