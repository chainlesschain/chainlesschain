<template>
  <a-modal
    :open="open"
    :width="640"
    :footer="null"
    :mask-closable="true"
    :body-style="{ maxHeight: '72vh', overflowY: 'auto' }"
    title="通话记录"
    @update:open="(v) => $emit('update:open', v)"
  >
    <div v-if="prefillText" class="prefill-banner">
      <PhoneOutlined />
      <span class="prefill-text">命令：{{ prefillText }}</span>
    </div>

    <div class="ch-toolbar">
      <a-select
        :value="store.filterType"
        style="width: 130px"
        size="small"
        @change="(v) => store.setFilter(v)"
      >
        <a-select-option value="all">全部</a-select-option>
        <a-select-option value="audio">语音通话</a-select-option>
        <a-select-option value="video">视频通话</a-select-option>
        <a-select-option value="screen">屏幕共享</a-select-option>
      </a-select>
      <a-space>
        <a-button
          size="small"
          :loading="store.loading"
          @click="store.loadAll()"
        >
          <template #icon><ReloadOutlined /></template>
          刷新
        </a-button>
        <a-button
          size="small"
          danger
          :loading="store.clearing"
          :disabled="store.records.length === 0"
          @click="confirmClearAll"
        >
          <template #icon><DeleteOutlined /></template>
          清空
        </a-button>
      </a-space>
    </div>

    <a-alert
      v-if="store.error"
      class="ch-error"
      type="error"
      :message="store.error"
      closable
      show-icon
      @close="store.clearError()"
    />

    <a-spin :spinning="store.loading">
      <a-empty
        v-if="store.filteredHistory.length === 0"
        description="暂无通话记录"
      />

      <ul v-else class="ch-list">
        <li
          v-for="record in store.filteredHistory"
          :key="record.id"
          class="ch-item"
          @click="store.openDetails(record)"
        >
          <span class="ch-icon" :class="`ch-icon-${record.type}`">
            <PhoneOutlined v-if="record.type === 'audio'" />
            <VideoCameraOutlined v-else-if="record.type === 'video'" />
            <DesktopOutlined v-else />
          </span>

          <div class="ch-meta">
            <div class="ch-line-1">
              <span class="ch-peer">{{ store.peerName(record.peerId) }}</span>
              <a-tag :color="typeColor(record.type)" :bordered="false">
                {{ typeText(record.type) }}
              </a-tag>
              <a-tag
                v-if="record.direction"
                :color="directionColor(record.direction)"
                :bordered="false"
              >
                {{ directionText(record.direction) }}
              </a-tag>
            </div>
            <div class="ch-line-2">
              <span class="ch-time">{{ formatTime(recordTime(record)) }}</span>
              <span v-if="record.duration != null" class="ch-dot">·</span>
              <span v-if="record.duration != null" class="ch-dur">{{
                formatDuration(record.duration)
              }}</span>
            </div>
          </div>

          <a-popconfirm
            title="确定删除这条通话记录吗？"
            ok-text="删除"
            cancel-text="取消"
            @confirm.stop="store.deleteRecord(record.id)"
          >
            <a-button
              type="text"
              danger
              size="small"
              :loading="store.deletingId === record.id"
              @click.stop
            >
              <template #icon><DeleteOutlined /></template>
            </a-button>
          </a-popconfirm>
        </li>
      </ul>
    </a-spin>

    <!-- detail drawer -->
    <a-drawer
      :open="store.detailsOpen"
      title="通话详情"
      placement="right"
      :width="360"
      @close="store.closeDetails()"
    >
      <a-descriptions
        v-if="store.selectedRecord"
        :column="1"
        size="small"
        bordered
      >
        <a-descriptions-item label="对方">
          {{ store.peerName(store.selectedRecord.peerId) }}
        </a-descriptions-item>
        <a-descriptions-item label="类型">
          {{ typeText(store.selectedRecord.type) }}
        </a-descriptions-item>
        <a-descriptions-item v-if="store.selectedRecord.direction" label="方向">
          {{ directionText(store.selectedRecord.direction) }}
        </a-descriptions-item>
        <a-descriptions-item label="时间">
          {{ formatTime(recordTime(store.selectedRecord)) }}
        </a-descriptions-item>
        <a-descriptions-item
          v-if="store.selectedRecord.duration != null"
          label="时长"
        >
          {{ formatDuration(store.selectedRecord.duration) }}
        </a-descriptions-item>
        <a-descriptions-item
          v-if="store.selectedRecord.peerId"
          label="对方 DID"
        >
          <span class="ch-did">{{ store.selectedRecord.peerId }}</span>
        </a-descriptions-item>
      </a-descriptions>
    </a-drawer>

    <p class="panel-desc">
      P2P 语音 / 视频 / 屏幕共享通话记录（完整管理请访问
      <code>/call-history</code>）。重新发起通话请在好友或聊天窗口中操作。
    </p>
  </a-modal>
</template>

<script setup lang="ts">
import { watch } from "vue";
import { Modal } from "ant-design-vue";
import {
  PhoneOutlined,
  VideoCameraOutlined,
  DesktopOutlined,
  ReloadOutlined,
  DeleteOutlined,
} from "@ant-design/icons-vue";
import { useCallHistoryStore, type CallRecord } from "../stores/callHistory";

const props = defineProps<{ open: boolean; prefillText?: string }>();
defineEmits<{ (e: "update:open", value: boolean): void }>();

const store = useCallHistoryStore();

// Load once whenever the panel is opened.
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen && !store.loading) {
      store.loadAll();
    }
  },
  { immediate: true },
);

function recordTime(record: CallRecord): number | undefined {
  return (
    (record.startTime as number | undefined) ??
    (record.created_at as number | undefined)
  );
}

function typeText(type?: string): string {
  return (
    { audio: "语音通话", video: "视频通话", screen: "屏幕共享" }[type ?? ""] ??
    type ??
    "通话"
  );
}

function typeColor(type?: string): string {
  return (
    { audio: "blue", video: "green", screen: "orange" }[type ?? ""] ?? "default"
  );
}

function directionText(direction?: string): string {
  return (
    { incoming: "呼入", outgoing: "呼出", missed: "未接" }[direction ?? ""] ??
    direction ??
    ""
  );
}

function directionColor(direction?: string): string {
  return direction === "missed" ? "red" : "default";
}

function formatTime(ts?: number): string {
  if (ts == null) {
    return "—";
  }
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) {
    return "—";
  }
  return d.toLocaleString();
}

function formatDuration(seconds?: number): string {
  if (seconds == null || seconds < 0) {
    return "—";
  }
  const s = Math.floor(seconds);
  if (s < 60) {
    return `${s} 秒`;
  }
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) {
    return rem ? `${m} 分 ${rem} 秒` : `${m} 分`;
  }
  const h = Math.floor(m / 60);
  return `${h} 时 ${m % 60} 分`;
}

function confirmClearAll(): void {
  Modal.confirm({
    title: "确认清空",
    content: "确定要清空所有通话记录吗？此操作不可恢复。",
    okText: "清空",
    okType: "danger",
    cancelText: "取消",
    onOk: () => store.clearAll(),
  });
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
.ch-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.ch-error {
  margin-bottom: 12px;
}
.ch-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.ch-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 6px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  cursor: pointer;
  transition: background 0.15s;
}
.ch-item:hover {
  background: rgba(0, 0, 0, 0.03);
}
.ch-icon {
  flex: none;
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  font-size: 16px;
  color: #fff;
  background: #999;
}
.ch-icon-audio {
  background: #1890ff;
}
.ch-icon-video {
  background: #52c41a;
}
.ch-icon-screen {
  background: #fa8c16;
}
.ch-meta {
  flex: 1;
  min-width: 0;
}
.ch-line-1 {
  display: flex;
  align-items: center;
  gap: 6px;
}
.ch-peer {
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ch-line-2 {
  margin-top: 2px;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
}
.ch-dot {
  margin: 0 6px;
}
.ch-did {
  font-family: monospace;
  font-size: 12px;
  word-break: break-all;
}
.panel-desc {
  margin-top: 16px;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
}
</style>
