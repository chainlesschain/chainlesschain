<template>
  <a-modal
    :open="open"
    :width="1080"
    :footer="null"
    :mask-closable="true"
    :body-style="{ maxHeight: '80vh', overflowY: 'auto' }"
    title="视频剪辑 Agent"
    @update:open="(v) => $emit('update:open', v)"
  >
    <div v-if="prefillText" class="prefill-banner">
      <ScissorOutlined />
      <span class="prefill-text">命令：{{ prefillText }}</span>
    </div>

    <div class="ve-toolbar">
      <span class="ve-sub">CutClaw-inspired 音画同步剪辑</span>
      <a-space>
        <a-button size="small" @click="store.loadAssets()">刷新素材</a-button>
        <a-button
          v-if="store.isRunning"
          size="small"
          danger
          @click="store.cancel()"
        >
          取消
        </a-button>
      </a-space>
    </div>

    <a-row :gutter="16">
      <!-- config -->
      <a-col :span="8">
        <a-card title="剪辑配置" size="small">
          <a-form layout="vertical" :model="form">
            <a-form-item label="视频文件" required>
              <a-input
                v-model:value="form.videoPath"
                placeholder="/path/to/raw.mp4"
              />
            </a-form-item>
            <a-form-item label="背景音乐">
              <a-input
                v-model:value="form.audioPath"
                placeholder="/path/to/bgm.mp3"
              />
            </a-form-item>
            <a-form-item label="剪辑指令">
              <a-textarea
                v-model:value="form.instruction"
                :rows="3"
                placeholder="节奏感强的角色蒙太奇"
              />
            </a-form-item>
            <a-form-item label="输出路径">
              <a-input
                v-model:value="form.outputPath"
                placeholder="./output.mp4"
              />
            </a-form-item>
            <a-form-item label="主角名称">
              <a-input v-model:value="form.character" placeholder="可选" />
            </a-form-item>

            <a-divider>高级选项</a-divider>
            <a-form-item>
              <a-checkbox v-model:checked="form.parallel">并行剪辑</a-checkbox>
            </a-form-item>
            <a-form-item>
              <a-checkbox v-model:checked="form.review">质量审核</a-checkbox>
            </a-form-item>
            <a-form-item>
              <a-checkbox v-model:checked="form.useMadmom"
                >Madmom 节拍检测</a-checkbox
              >
            </a-form-item>
            <a-form-item>
              <a-checkbox v-model:checked="form.snapBeats">节拍对齐</a-checkbox>
            </a-form-item>
            <a-form-item>
              <a-checkbox v-model:checked="form.ducking"
                >对话闪避混音</a-checkbox
              >
            </a-form-item>

            <a-button
              type="primary"
              block
              :loading="store.isRunning"
              :disabled="!form.videoPath"
              @click="startPipeline"
            >
              开始剪辑
            </a-button>
          </a-form>
        </a-card>

        <a-card title="素材缓存" size="small" style="margin-top: 16px">
          <a-list :data-source="store.assets" size="small">
            <template #renderItem="{ item }">
              <a-list-item>
                <a-list-item-meta
                  :title="item.hash"
                  :description="item.videoPath || '—'"
                />
              </a-list-item>
            </template>
            <template v-if="!store.assets.length" #header>
              <a-empty description="暂无缓存素材" />
            </template>
          </a-list>
        </a-card>
      </a-col>

      <!-- progress -->
      <a-col :span="8">
        <a-card title="流水线进度" size="small">
          <a-steps :current="phaseIndex" direction="vertical" size="small">
            <a-step title="解构" :status="stepStatus('deconstruct')" />
            <a-step title="编排" :status="stepStatus('plan')" />
            <a-step title="剪辑" :status="stepStatus('assemble')" />
            <a-step title="审核" :status="stepStatus('review')" />
            <a-step title="渲染" :status="stepStatus('render')" />
          </a-steps>

          <a-progress
            v-if="store.isRunning"
            :percent="Math.round(store.progress * 100)"
            :status="store.phase === 'error' ? 'exception' : 'active'"
            style="margin-top: 16px"
          />
          <div v-if="store.progressMessage" class="progress-message">
            {{ store.progressMessage }}
          </div>

          <a-result
            v-if="store.phase === 'done'"
            status="success"
            title="剪辑完成"
            :sub-title="store.outputPath"
          />
          <a-result
            v-if="store.phase === 'error'"
            status="error"
            title="剪辑失败"
            :sub-title="store.error"
          />
        </a-card>

        <a-card
          v-if="store.shotPlan"
          title="镜头计划"
          size="small"
          style="margin-top: 16px"
        >
          <div
            v-for="section in store.shotPlan.sections"
            :key="section.section_idx"
            class="section-row"
          >
            <a-tag :color="sectionColor(section.section_idx)">
              S{{ section.section_idx }}
            </a-tag>
            <span class="section-time">
              {{ section.music_segment?.start?.toFixed(1) }}s —
              {{ section.music_segment?.end?.toFixed(1) }}s
            </span>
            <a-badge :count="section.shots?.length || 0" />
          </div>
        </a-card>
      </a-col>

      <!-- event log -->
      <a-col :span="8">
        <a-card title="事件日志" size="small">
          <div class="event-log">
            <a-empty v-if="!store.eventLog.length" description="暂无事件" />
            <div
              v-for="(ev, i) in store.eventLog"
              :key="i"
              class="event-line"
              :class="eventClass(ev)"
            >
              <span class="event-type">{{ ev.type }}</span>
              <span v-if="ev.message" class="event-msg">{{ ev.message }}</span>
            </div>
          </div>
        </a-card>
      </a-col>
    </a-row>
  </a-modal>
</template>

<script setup lang="ts">
import { reactive, computed, watch, onUnmounted } from "vue";
import { ScissorOutlined } from "@ant-design/icons-vue";
import {
  useVideoEditingStore,
  type PipelineEvent,
} from "../stores/videoEditing";

const props = defineProps<{ open: boolean; prefillText?: string }>();
defineEmits<{ (e: "update:open", value: boolean): void }>();

const store = useVideoEditingStore();

const form = reactive({
  videoPath: "",
  audioPath: "",
  instruction: "",
  outputPath: "./output.mp4",
  character: "",
  parallel: false,
  review: false,
  useMadmom: false,
  snapBeats: false,
  ducking: false,
});

const phases = ["deconstruct", "plan", "assemble", "review", "render"];

const phaseIndex = computed(() => {
  const idx = phases.indexOf(store.phase);
  return idx >= 0 ? idx : store.phase === "done" ? 5 : 0;
});

function stepStatus(phase: string): "error" | "finish" | "process" | "wait" {
  const idx = phases.indexOf(phase);
  const current = phaseIndex.value;
  if (store.phase === "error" && idx === current) {
    return "error";
  }
  if (idx < current) {
    return "finish";
  }
  if (idx === current && store.isRunning) {
    return "process";
  }
  return "wait";
}

const sectionColors = [
  "blue",
  "green",
  "orange",
  "purple",
  "cyan",
  "magenta",
  "red",
  "gold",
];
function sectionColor(idx: number): string {
  return sectionColors[idx % sectionColors.length];
}

function eventClass(ev: PipelineEvent): string {
  if (ev.type.includes("error") || ev.type.includes("fail")) {
    return "event-error";
  }
  if (ev.type.includes("end") || ev.type.includes("done")) {
    return "event-success";
  }
  return "";
}

async function startPipeline(): Promise<void> {
  await store.runFullPipeline({
    videoPath: form.videoPath,
    audioPath: form.audioPath || undefined,
    instruction: form.instruction || undefined,
    outputPath: form.outputPath || undefined,
    character: form.character || undefined,
    parallel: form.parallel,
    review: form.review,
    useMadmom: form.useMadmom,
    snapBeats: form.snapBeats,
    ducking: form.ducking,
  });
}

// Subscribe to pipeline events while the panel is open; clean up on close.
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      store.loadAssets();
      store.subscribeEvents();
    } else {
      store.unsubscribeEvents();
    }
  },
  { immediate: true },
);

onUnmounted(() => {
  store.unsubscribeEvents();
});
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
.ve-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.ve-sub {
  color: rgba(0, 0, 0, 0.45);
  font-size: 13px;
}
.progress-message {
  margin-top: 8px;
  color: #888;
  font-size: 12px;
}
.section-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.section-time {
  font-size: 12px;
  color: #666;
}
.event-log {
  max-height: 460px;
  overflow-y: auto;
  font-family: monospace;
  font-size: 11px;
}
.event-line {
  padding: 2px 0;
  border-bottom: 1px solid #f0f0f0;
}
.event-type {
  color: #1890ff;
  margin-right: 8px;
}
.event-msg {
  color: #333;
}
.event-error {
  color: #ff4d4f;
}
.event-success .event-type {
  color: #52c41a;
}
</style>
