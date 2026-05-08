<template>
  <transition name="cc-update-fade">
    <div
      v-if="visible"
      class="cc-update-notifier"
      role="status"
      aria-live="polite"
    >
      <div class="cc-update-card" :class="`cc-update--${state.status}`">
        <div class="cc-update-header">
          <span class="cc-update-title">{{ title }}</span>
          <a-button
            v-if="canDismiss"
            type="text"
            size="small"
            class="cc-update-close"
            :aria-label="$t('appUpdate.dismiss', '关闭')"
            @click="dismiss"
          >
            <CloseOutlined />
          </a-button>
        </div>

        <div class="cc-update-body">
          <p v-if="subtitle" class="cc-update-subtitle">
            {{ subtitle }}
          </p>

          <a-progress
            v-if="state.status === 'downloading'"
            :percent="progressPercent"
            :show-info="true"
            size="small"
          />

          <p v-if="downloadDetail" class="cc-update-detail">
            {{ downloadDetail }}
          </p>

          <p
            v-if="state.status === 'error' && errorMessage"
            class="cc-update-error"
          >
            {{ errorMessage }}
          </p>
        </div>

        <div v-if="actions.length > 0" class="cc-update-actions">
          <a-button
            v-for="action in actions"
            :key="action.key"
            :type="action.primary ? 'primary' : 'default'"
            :size="'small'"
            :loading="action.loading"
            :disabled="action.disabled"
            @click="action.handler"
          >
            {{ action.label }}
          </a-button>
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup>
import { logger } from "@/utils/logger";

import { ref, computed, onMounted, onUnmounted, reactive } from "vue";
import { message } from "ant-design-vue";
import { CloseOutlined } from "@ant-design/icons-vue";

const initialState = () => ({
  status: "idle",
  data: null,
  info: null,
  timestamp: null,
});

const state = reactive(initialState());
const dismissed = ref(false);
const downloading = ref(false);
const installing = ref(false);
let unsubscribe = null;
let notAvailableTimer = null;

const api = computed(() => {
  if (typeof window === "undefined") {
    return null;
  }
  return window.electronAPI?.appUpdate || null;
});

const visible = computed(() => {
  if (!api.value) {
    return false;
  }
  if (dismissed.value) {
    return false;
  }
  return state.status !== "idle";
});

const title = computed(() => {
  switch (state.status) {
    case "checking":
      return "正在检查更新…";
    case "available":
      return state.info?.version
        ? `发现新版本 v${state.info.version}`
        : "发现新版本";
    case "not-available":
      return "当前已是最新版本";
    case "downloading":
      return "正在下载更新";
    case "downloaded":
      return state.info?.version
        ? `更新已就绪 v${state.info.version}`
        : "更新已就绪";
    case "error":
      return "更新失败";
    default:
      return "";
  }
});

const subtitle = computed(() => {
  if (state.status === "available") {
    return "点击下载开始更新，下载在后台进行。";
  }
  if (state.status === "downloaded") {
    return "重启应用以完成安装。";
  }
  return "";
});

const progressPercent = computed(() => {
  const p = Number(state.data?.percent ?? 0);
  if (!Number.isFinite(p)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(p)));
});

const downloadDetail = computed(() => {
  if (state.status !== "downloading" || !state.data) {
    return "";
  }
  const { transferred, total, bytesPerSecond } = state.data;
  const t = formatBytes(transferred);
  const total_ = formatBytes(total);
  const speed = formatBytes(bytesPerSecond);
  return `${t} / ${total_} · ${speed}/s`;
});

const errorMessage = computed(() => {
  return state.info?.message || "未知错误，请稍后重试。";
});

const canDismiss = computed(() => {
  return ["not-available", "available", "error"].includes(state.status);
});

const actions = computed(() => {
  if (state.status === "available") {
    return [
      {
        key: "download",
        label: "立即下载",
        primary: true,
        loading: downloading.value,
        disabled: downloading.value,
        handler: handleDownload,
      },
      {
        key: "later",
        label: "稍后再说",
        primary: false,
        loading: false,
        disabled: false,
        handler: dismiss,
      },
    ];
  }
  if (state.status === "downloaded") {
    return [
      {
        key: "install",
        label: "立即重启",
        primary: true,
        loading: installing.value,
        disabled: installing.value,
        handler: handleInstall,
      },
      {
        key: "later-install",
        label: "下次启动",
        primary: false,
        loading: false,
        disabled: false,
        handler: dismiss,
      },
    ];
  }
  if (state.status === "error") {
    return [
      {
        key: "retry",
        label: "重试",
        primary: true,
        loading: false,
        disabled: false,
        handler: handleRetry,
      },
    ];
  }
  return [];
});

function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function applyPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return;
  }
  const next = payload.status;
  if (!next) {
    return;
  }

  // 任何新状态进来，先解除 dismiss（用户上次关掉的是旧状态卡片）。
  // 仅当状态实际跨越枚举切换才重置，否则下载进度高频更新会反复抢回 UI。
  if (next !== state.status) {
    dismissed.value = false;
    if (next === "downloading") {
      downloading.value = false;
    }
  }

  state.status = next;
  state.data = payload.data || null;
  state.info = payload.info || null;
  state.timestamp = payload.timestamp || null;

  // not-available 是瞬时态：3 秒后自动收起，省得占用屏幕角落
  if (notAvailableTimer) {
    clearTimeout(notAvailableTimer);
    notAvailableTimer = null;
  }
  if (next === "not-available") {
    notAvailableTimer = setTimeout(() => {
      if (state.status === "not-available") {
        dismiss();
      }
    }, 3000);
  }
}

async function handleDownload() {
  if (!api.value) {
    return;
  }
  downloading.value = true;
  try {
    const res = await api.value.download();
    if (res && res.ok === false) {
      message.error(`下载失败：${res.error || "未知错误"}`);
      downloading.value = false;
    }
  } catch (err) {
    logger.error("[AppUpdateNotifier] download failed:", err);
    message.error("下载请求失败");
    downloading.value = false;
  }
}

async function handleInstall() {
  if (!api.value) {
    return;
  }
  installing.value = true;
  try {
    const res = await api.value.install();
    if (res && res.ok === false) {
      message.error(`安装失败：${res.error || "未知错误"}`);
      installing.value = false;
    }
  } catch (err) {
    logger.error("[AppUpdateNotifier] install failed:", err);
    message.error("安装请求失败");
    installing.value = false;
  }
}

async function handleRetry() {
  if (!api.value) {
    return;
  }
  dismissed.value = false;
  state.status = "checking";
  state.data = null;
  state.info = null;
  try {
    const res = await api.value.check();
    if (res && res.ok === false && res.reason === "dev-mode") {
      message.info("开发模式下不会真的拉取更新");
      state.status = "idle";
    }
  } catch (err) {
    logger.error("[AppUpdateNotifier] retry failed:", err);
  }
}

function dismiss() {
  dismissed.value = true;
  if (notAvailableTimer) {
    clearTimeout(notAvailableTimer);
    notAvailableTimer = null;
  }
}

onMounted(async () => {
  if (!api.value) {
    // web-shell / pure-browser 模式或 preload 没暴露 — 静默退出，组件保持
    // visible=false。这里不打 warn，避免 web-panel 烟雾测试噪声。
    return;
  }
  try {
    const initial = await api.value.getStatus?.();
    if (initial) {
      applyPayload(initial);
    }
  } catch (err) {
    logger.warn("[AppUpdateNotifier] getStatus failed:", err && err.message);
  }
  unsubscribe = api.value.onStatus(applyPayload);
});

onUnmounted(() => {
  if (typeof unsubscribe === "function") {
    try {
      unsubscribe();
    } catch (err) {
      logger.warn(
        "[AppUpdateNotifier] unsubscribe failed:",
        err && err.message,
      );
    }
    unsubscribe = null;
  }
  if (notAvailableTimer) {
    clearTimeout(notAvailableTimer);
    notAvailableTimer = null;
  }
});
</script>

<style scoped>
.cc-update-notifier {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 1010;
  max-width: 360px;
  width: calc(100vw - 48px);
}

.cc-update-card {
  background: var(--cc-bg, #fff);
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 8px;
  box-shadow:
    0 6px 16px rgba(0, 0, 0, 0.08),
    0 3px 6px rgba(0, 0, 0, 0.04);
  padding: 12px 14px 10px;
}

.cc-update--error {
  border-color: rgba(255, 77, 79, 0.3);
}

.cc-update--downloaded {
  border-color: rgba(82, 196, 26, 0.3);
}

.cc-update-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.cc-update-title {
  font-weight: 600;
  font-size: 14px;
  line-height: 1.4;
}

.cc-update-close {
  flex-shrink: 0;
  margin: -4px -6px -4px 0;
}

.cc-update-body {
  font-size: 12.5px;
  color: rgba(0, 0, 0, 0.65);
}

.cc-update-subtitle {
  margin: 0 0 8px;
  line-height: 1.5;
}

.cc-update-detail {
  margin: 6px 0 0;
  font-size: 11.5px;
  color: rgba(0, 0, 0, 0.5);
  font-variant-numeric: tabular-nums;
}

.cc-update-error {
  margin: 4px 0 0;
  color: #ff4d4f;
  word-break: break-word;
}

.cc-update-actions {
  display: flex;
  gap: 8px;
  margin-top: 10px;
  justify-content: flex-end;
}

.cc-update-fade-enter-active,
.cc-update-fade-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.cc-update-fade-enter-from,
.cc-update-fade-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

@media (prefers-color-scheme: dark) {
  .cc-update-card {
    background: #1f1f1f;
    border-color: rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.85);
  }
  .cc-update-body {
    color: rgba(255, 255, 255, 0.65);
  }
  .cc-update-detail {
    color: rgba(255, 255, 255, 0.45);
  }
}
</style>
