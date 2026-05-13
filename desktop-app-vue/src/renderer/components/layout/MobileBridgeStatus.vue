<template>
  <a-tooltip :title="tooltip">
    <a-badge
      :count="onlineCount"
      :show-zero="false"
      :overflow-count="9"
      :offset="[-2, 4]"
    >
      <a-button type="text" class="mobile-bridge-btn" @click="handleClick">
        <MobileOutlined :style="{ color: iconColor, fontSize: '16px' }" />
      </a-button>
    </a-badge>
  </a-tooltip>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import { useRouter } from "vue-router";
import { MobileOutlined } from "@ant-design/icons-vue";
import { logger } from "@/utils/logger";

const router = useRouter();

const bridgeReady = ref(false);
const devices = ref([]);
let pollTimer = null;

const onlineCount = computed(
  () => devices.value.filter((d) => d.online).length,
);
const totalCount = computed(() => devices.value.length);

const iconColor = computed(() => {
  if (!bridgeReady.value) {
    return "#bfbfbf";
  }
  if (totalCount.value === 0) {
    return "#bfbfbf";
  }
  if (onlineCount.value === 0) {
    return "#faad14";
  }
  return "#52c41a";
});

const tooltip = computed(() => {
  if (!bridgeReady.value) {
    return "移动桥未启用 — 点击进入配对";
  }
  if (totalCount.value === 0) {
    return "尚未配对任何手机 — 点击进入配对";
  }
  if (onlineCount.value === 0) {
    return `已配对 ${totalCount.value} 台手机（当前离线） — 点击管理`;
  }
  return `${onlineCount.value}/${totalCount.value} 台手机在线 — 点击管理`;
});

async function refresh() {
  const api = window.electronAPI?.sync?.mobile;
  if (!api?.listPaired) {
    return;
  }
  try {
    const [paired, status] = await Promise.all([
      api.listPaired(),
      api.status?.() ?? Promise.resolve({ bridgeReady: false }),
    ]);
    if (paired?.success) {
      devices.value = paired.devices || [];
    }
    bridgeReady.value = !!status?.bridgeReady;
  } catch (err) {
    logger.error("[MobileBridgeStatus] refresh failed:", err);
  }
}

function handleClick() {
  router.push("/settings/sync-mobile");
}

onMounted(() => {
  refresh();
  pollTimer = setInterval(refresh, 5000);
});

onBeforeUnmount(() => {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
});
</script>

<style scoped>
.mobile-bridge-btn {
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
