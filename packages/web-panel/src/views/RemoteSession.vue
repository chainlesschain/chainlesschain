<template>
  <div>
    <div
      style="
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 24px;
      "
    >
      <div>
        <h2 class="page-title">远程会话</h2>
        <p class="page-sub">
          扫码或粘贴桌面端的配对链接，接管一个编码会话（观察 / 提示 / 审批 /
          中断）——支持中继 E2EE 链接与局域网直连链接
        </p>
      </div>
      <a-space>
        <a-tag v-if="transport" color="purple">{{
          transport === "direct" ? "直连" : "中继"
        }}</a-tag>
        <a-tag :color="statusColor">{{ statusLabel }}</a-tag>
      </a-space>
    </div>

    <a-alert
      v-if="error"
      type="error"
      show-icon
      style="margin-bottom: 16px"
      :message="error"
      closable
      @close="clearError"
    />

    <a-card
      v-if="!isActive"
      title="连接远程会话"
      style="
        background: var(--bg-card);
        border-color: var(--border-color);
        margin-bottom: 16px;
      "
    >
      <a-space direction="vertical" style="width: 100%" :size="12">
        <a-textarea
          v-model:value="pairingLink"
          :rows="3"
          placeholder="chainlesschain://remote-session/pair#…（中继）或 chainlesschain://remote-control/pair#…（局域网直连）"
          allow-clear
        />
        <a-space>
          <a-button
            type="primary"
            :disabled="!pairingLink.trim()"
            @click="connect"
          >
            <template #icon><LinkOutlined /></template>
            连接
          </a-button>
          <a-button @click="scannerOpen = true">
            <template #icon><ScanOutlined /></template>
            扫码
          </a-button>
        </a-space>
        <p class="page-sub" style="margin: 0">
          链接为一次性配对码，敏感载荷仅在片段（#）中，不会发往服务器。
        </p>
      </a-space>
    </a-card>

    <a-card
      v-else
      title="会话控制"
      style="
        background: var(--bg-card);
        border-color: var(--border-color);
        margin-bottom: 16px;
      "
    >
      <template #extra>
        <a-space>
          <a-button size="small" @click="interrupt">中断</a-button>
          <a-button size="small" danger @click="disconnect">断开</a-button>
        </a-space>
      </template>
      <a-space direction="vertical" style="width: 100%" :size="8">
        <a-input-search
          v-model:value="promptText"
          placeholder="发送提示到远程会话…"
          enter-button="发送"
          :disabled="status !== 'connected'"
          @search="send"
        />
        <a-spin v-if="status === 'reconnecting'" size="small">
          <template #tip>正在重连…</template>
        </a-spin>
      </a-space>
    </a-card>

    <a-card
      v-if="pendingApprovals.length"
      style="
        background: var(--bg-card);
        border-color: var(--warning-color, #faad14);
        margin-bottom: 16px;
      "
    >
      <template #title>
        待审批权限请求
        <a-badge :count="pendingApprovals.length" style="margin-left: 8px" />
      </template>
      <a-list
        size="small"
        :data-source="pendingApprovals"
        data-testid="approval-cards"
      >
        <template #renderItem="{ item }">
          <a-list-item>
            <a-list-item-meta>
              <template #title>
                <a-space>
                  <a-tag color="orange">{{ item.tool || "tool" }}</a-tag>
                  <span v-if="item.action" class="page-sub">{{
                    item.action
                  }}</span>
                </a-space>
              </template>
              <template #description>
                <code v-if="item.detail" style="word-break: break-all">{{
                  item.detail
                }}</code>
                <span v-else class="page-sub">（无详情）</span>
              </template>
            </a-list-item-meta>
            <template #actions>
              <a-button
                type="primary"
                size="small"
                @click="respondPermission(item, true)"
                >批准</a-button
              >
              <a-button
                size="small"
                danger
                @click="respondPermission(item, false)"
                >拒绝</a-button
              >
            </template>
          </a-list-item>
        </template>
      </a-list>
    </a-card>

    <a-card
      title="会话事件"
      style="background: var(--bg-card); border-color: var(--border-color)"
    >
      <a-empty v-if="!events.length" description="尚无事件" />
      <a-list v-else size="small" :data-source="orderedEvents">
        <template #renderItem="{ item }">
          <a-list-item>
            <a-list-item-meta :description="eventBody(item)">
              <template #title>
                <a-tag :color="isApproval(item) ? 'orange' : 'blue'">{{
                  item.type || "event"
                }}</a-tag>
              </template>
            </a-list-item-meta>
            <template v-if="isApproval(item)" #actions>
              <a-button type="link" size="small" @click="respond(item, true)"
                >批准</a-button
              >
              <a-button
                type="link"
                size="small"
                danger
                @click="respond(item, false)"
                >拒绝</a-button
              >
            </template>
          </a-list-item>
        </template>
      </a-list>
    </a-card>

    <QrScannerModal
      :open="scannerOpen"
      @scanned="onScanned"
      @cancel="scannerOpen = false"
    />
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import { storeToRefs } from "pinia";
import { LinkOutlined, ScanOutlined } from "@ant-design/icons-vue";
import QrScannerModal from "../components/QrScannerModal.vue";
import { useRemoteSessionStore } from "../stores/remoteSession.js";

const store = useRemoteSessionStore();
// The relay reconnect loop is attempt-capped so it can't churn forever after
// the user leaves this page; re-entering revives a given-up pairing.
onMounted(() => store.resumeReconnect());
const { status, events, error, transport, pendingApprovals } =
  storeToRefs(store);

const pairingLink = ref("");
const promptText = ref("");
const scannerOpen = ref(false);

const isActive = computed(() =>
  ["connecting", "pairing", "connected", "reconnecting"].includes(status.value),
);

const statusLabel = computed(() => {
  const map = {
    idle: "未连接",
    connecting: "连接中",
    pairing: "配对中",
    connected: "已连接",
    reconnecting: "重连中",
    disconnected: "已断开",
    revoked: "已被撤销",
    error: "错误",
  };
  return map[status.value] || status.value;
});

const statusColor = computed(() => {
  if (status.value === "connected") return "green";
  if (["connecting", "pairing", "reconnecting"].includes(status.value))
    return "blue";
  if (["revoked", "error"].includes(status.value)) return "red";
  return "default";
});

// Newest first for display.
const orderedEvents = computed(() => [...events.value].reverse());

function isApproval(item) {
  return String(item?.type || "").includes("approval");
}

function eventBody(item) {
  return item?.content || item?.payload?.content || item?.message || "";
}

function requestIdOf(item) {
  return item?.requestId || item?.approvalId || "";
}

function connect() {
  store.connect(pairingLink.value.trim());
}

function onScanned(data) {
  scannerOpen.value = false;
  if (data) {
    pairingLink.value = data;
    store.connect(data);
  }
}

function send(value) {
  const content = typeof value === "string" ? value : promptText.value;
  store.sendPrompt(content);
  promptText.value = "";
}

function respond(item, approved) {
  store.approve(requestIdOf(item), approved);
}

function respondPermission(card, approved) {
  store.approve(card.requestId, approved);
}

function interrupt() {
  store.interrupt();
}

function disconnect() {
  store.disconnect();
}

function clearError() {
  error.value = "";
}
</script>
