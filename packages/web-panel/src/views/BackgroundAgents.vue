<template>
  <div>
    <div class="page-header">
      <div>
        <h2 class="page-title">后台 Agent</h2>
        <p class="page-sub">
          查看 cc agent --bg 后台会话，实时跟随日志并交互接管（follow-up prompt
          / 停止本轮）。
        </p>
      </div>
      <a-space>
        <a-switch
          v-model:checked="store.showAll"
          checked-children="全部"
          un-checked-children="运行中"
          @change="store.fetchSessions()"
        />
        <a-button ghost :loading="store.loading" @click="store.fetchSessions()">
          <template #icon><ReloadOutlined /></template>
          刷新
        </a-button>
      </a-space>
    </div>

    <a-table
      :data-source="store.sessions"
      :columns="columns"
      row-key="id"
      size="small"
      :pagination="{ pageSize: 8, hideOnSinglePage: true }"
      class="bg-table"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'status'">
          <a-tag :color="store.getStatusColor(record.status)">{{
            record.status
          }}</a-tag>
          <a-tag v-if="record.phase" color="default">{{ record.phase }}</a-tag>
        </template>
        <template v-else-if="column.key === 'elapsed'">
          {{ store.formatElapsed(record) }}
        </template>
        <template v-else-if="column.key === 'actions'">
          <a-space>
            <a-button
              size="small"
              type="primary"
              :disabled="record.status !== 'running' || !record.interactive"
              @click="onAttach(record.id)"
            >
              {{ store.attachedId === record.id ? "已连接" : "接管" }}
            </a-button>
            <a-button size="small" @click="openRename(record)">重命名</a-button>
            <a-button
              v-if="record.status !== 'running' && record.sessionId"
              size="small"
              @click="openResume(record)"
            >
              续跑
            </a-button>
            <a-popconfirm
              v-if="record.status === 'running'"
              title="终止整个后台会话？"
              @confirm="store.stopSession(record.id)"
            >
              <a-button size="small" danger>终止</a-button>
            </a-popconfirm>
          </a-space>
        </template>
      </template>
    </a-table>

    <a-card v-if="store.attachedId" size="small" class="attach-card">
      <template #title>
        <a-space>
          <span>{{ store.attachedId }}</span>
          <a-tag v-if="store.attachedHello" color="processing">
            turn {{ store.attachedHello.turn }} ·
            {{ store.attachedHello.phase }}
          </a-tag>
          <a-tag v-if="store.transportClosed" color="warning">会话已结束</a-tag>
        </a-space>
      </template>
      <template #extra>
        <a-space>
          <a-button
            size="small"
            :disabled="store.transportClosed"
            @click="store.stopTurn()"
            >停止本轮</a-button
          >
          <a-button size="small" @click="store.detach()">断开</a-button>
        </a-space>
      </template>

      <pre ref="logPane" class="log-pane">{{
        store.logText || "（暂无输出）"
      }}</pre>

      <div v-if="lastEvent" class="event-line">
        — {{ describeEvent(lastEvent) }}
      </div>

      <div class="prompt-row">
        <a-input
          v-model:value="promptText"
          placeholder="输入 follow-up prompt，回车发送到该后台会话"
          :disabled="store.transportClosed"
          @press-enter="onSendPrompt"
        />
        <a-button
          type="primary"
          :disabled="store.transportClosed || !promptText.trim()"
          @click="onSendPrompt"
        >
          发送
        </a-button>
      </div>
    </a-card>

    <a-modal
      v-model:open="renameOpen"
      title="重命名后台会话"
      :confirm-loading="renameBusy"
      @ok="onRenameOk"
    >
      <a-input v-model:value="renameText" placeholder="新标题" @press-enter="onRenameOk" />
    </a-modal>

    <a-modal
      v-model:open="resumeOpen"
      title="续跑该会话（新的后台运行，续接同一对话）"
      :confirm-loading="resumeBusy"
      @ok="onResumeOk"
    >
      <a-input
        v-model:value="resumeText"
        placeholder="输入要继续执行的 prompt"
        @press-enter="onResumeOk"
      />
    </a-modal>
  </div>
</template>

<script setup>
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import { ReloadOutlined } from "@ant-design/icons-vue";
import { message } from "ant-design-vue";
import { useBackgroundAgentsStore } from "../stores/backgroundAgents";

const store = useBackgroundAgentsStore();
const promptText = ref("");
const logPane = ref(null);

const columns = [
  { title: "ID", dataIndex: "id", key: "id", ellipsis: true },
  { title: "状态", key: "status", width: 160 },
  { title: "标题", dataIndex: "title", key: "title", ellipsis: true },
  { title: "轮次", dataIndex: "turnCount", key: "turnCount", width: 70 },
  { title: "耗时", key: "elapsed", width: 100 },
  { title: "操作", key: "actions", width: 170 },
];

const lastEvent = computed(() =>
  store.events.length ? store.events[store.events.length - 1] : null,
);

function describeEvent(event) {
  switch (event.type) {
    case "turn-started":
      return `第 ${event.turn} 轮开始${event.prompt ? `：${event.prompt}` : ""}`;
    case "turn-ended":
      return `第 ${event.turn} 轮结束（exit ${event.exitCode}）`;
    case "idle":
      return "会话空闲，等待 follow-up prompt";
    case "accepted":
      return `prompt 已排队（#${event.queued}）`;
    case "stopping":
      return "正在停止当前轮";
    case "transport-closed":
      return "会话已收尾，连接关闭";
    case "error":
      return `错误：${event.message}`;
    default:
      return event.type;
  }
}

async function onAttach(bgId) {
  try {
    await store.attach(bgId);
  } catch (err) {
    message.error(`接管失败：${err.message}`);
  }
}

async function onSendPrompt() {
  const text = promptText.value;
  if (!text.trim()) return;
  try {
    await store.sendPrompt(text);
    promptText.value = "";
  } catch (err) {
    message.error(`发送失败：${err.message}`);
  }
}

const renameOpen = ref(false);
const renameBusy = ref(false);
const renameText = ref("");
let renameTarget = null;
function openRename(record) {
  renameTarget = record.id;
  renameText.value = record.title || "";
  renameOpen.value = true;
}
async function onRenameOk() {
  if (!renameText.value.trim()) return;
  renameBusy.value = true;
  try {
    await store.renameSession(renameTarget, renameText.value);
    renameOpen.value = false;
  } catch (err) {
    message.error(`重命名失败：${err.message}`);
  } finally {
    renameBusy.value = false;
  }
}

const resumeOpen = ref(false);
const resumeBusy = ref(false);
const resumeText = ref("");
let resumeTarget = null;
function openResume(record) {
  resumeTarget = record.id;
  resumeText.value = "";
  resumeOpen.value = true;
}
async function onResumeOk() {
  if (!resumeText.value.trim()) return;
  resumeBusy.value = true;
  try {
    const session = await store.resumeSession(resumeTarget, resumeText.value);
    resumeOpen.value = false;
    if (session) message.success(`已续跑为 ${session.id}`);
  } catch (err) {
    message.error(`续跑失败：${err.message}`);
  } finally {
    resumeBusy.value = false;
  }
}

watch(
  () => store.logText,
  async () => {
    await nextTick();
    if (logPane.value) logPane.value.scrollTop = logPane.value.scrollHeight;
  },
);

onMounted(() => store.startPolling(5000));
onBeforeUnmount(() => store.teardown());
</script>

<style scoped>
.bg-table {
  margin-bottom: 16px;
}
.attach-card {
  margin-top: 8px;
}
.log-pane {
  max-height: 360px;
  overflow: auto;
  background: rgba(0, 0, 0, 0.04);
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
}
.event-line {
  color: rgba(0, 0, 0, 0.45);
  font-size: 12px;
  margin: 4px 0;
}
.prompt-row {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
</style>
