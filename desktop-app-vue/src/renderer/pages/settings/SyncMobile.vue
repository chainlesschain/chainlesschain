<template>
  <div class="mobile-settings">
    <a-page-header
      title="移动设备同步"
      sub-title="Android P2P 同步：好友 / 1:1 消息 / 朋友圈帖子+评论 / 通知"
    >
      <template #extra>
        <a-button @click="$router.push('/settings/sync')">
          <template #icon>
            <ArrowLeftOutlined />
          </template>
          返回同步设置
        </a-button>
      </template>
    </a-page-header>

    <a-alert type="info" show-icon class="hint-alert">
      <template #message>
        <div>v1 配对流程（QR + 6 位码 + DID 互信完整流程在 v1.1 上）：</div>
        <ol class="pair-steps">
          <li>
            Android 端启动并连接到 PC 的信令服务器（地址同
            <code>OLLAMA_HOST</code> 同网段）
          </li>
          <li>Android 端发起 P2P 连接，连上后会出现在下方「已配对设备」列表</li>
          <li>对每台设备点「立即同步」即可推拉一轮</li>
        </ol>
      </template>
    </a-alert>

    <!-- Bridge ready 状态 -->
    <a-alert
      v-if="status && !status.bridgeReady"
      type="warning"
      show-icon
      class="hint-alert"
      message="MobileBridgeSync 未就绪"
      description="主进程的 mobileBridgeSync 实例还未创建，可能是 P2P 初始化未完成。请等待几秒后刷新。"
    />

    <!-- 已配对设备列表 -->
    <a-card class="devices-card" title="已配对设备" size="small">
      <template #extra>
        <a-button :loading="loading" size="small" @click="loadDevices">
          <template #icon>
            <ReloadOutlined />
          </template>
          刷新
        </a-button>
      </template>

      <a-empty
        v-if="!loading && devices.length === 0"
        description="尚未发现移动设备。请在 Android 端连接到本机信令服务器。"
      />

      <a-list v-else :data-source="devices" item-layout="horizontal">
        <template #renderItem="{ item }">
          <a-list-item>
            <a-list-item-meta>
              <template #title>
                <a-space>
                  <span class="device-name">
                    {{ item.deviceName || item.deviceId }}
                  </span>
                  <a-tag :color="item.online ? 'green' : 'default'">
                    {{ item.online ? "在线" : "离线" }}
                  </a-tag>
                  <a-tag v-if="item.platform" color="blue">
                    {{ item.platform }}
                  </a-tag>
                </a-space>
              </template>
              <template #description>
                <div class="device-meta">
                  <div>
                    deviceId: <code>{{ item.deviceId }}</code>
                  </div>
                  <div v-if="item.did">
                    DID: <code class="did-code">{{ item.did }}</code>
                  </div>
                  <div v-if="cursorByDevice[item.deviceId]">
                    {{ formatCursor(cursorByDevice[item.deviceId]) }}
                  </div>
                </div>
              </template>
            </a-list-item-meta>
            <template #actions>
              <a-button
                size="small"
                type="primary"
                :loading="!!runningById[item.deviceId]"
                :disabled="!item.online || !status?.bridgeReady"
                @click="onRunOne(item.deviceId)"
              >
                <template #icon>
                  <SyncOutlined />
                </template>
                立即同步
              </a-button>
              <a-popconfirm
                :title="`确定解绑 ${item.deviceName || item.deviceId}？将清除该设备的同步游标和 tombstones（已推送的数据不会被删除）。`"
                ok-text="解绑"
                cancel-text="取消"
                @confirm="onUnpair(item.deviceId)"
              >
                <a-button size="small" danger>
                  <template #icon>
                    <DisconnectOutlined />
                  </template>
                  解绑
                </a-button>
              </a-popconfirm>
            </template>
          </a-list-item>
        </template>
      </a-list>
    </a-card>

    <!-- 总体状态卡 -->
    <a-card class="status-card" title="同步状态" size="small">
      <a-descriptions v-if="status" :column="2" size="small" bordered>
        <a-descriptions-item label="桥接就绪">
          <a-tag :color="status.bridgeReady ? 'green' : 'red'">
            {{ status.bridgeReady ? "就绪" : "未就绪" }}
          </a-tag>
        </a-descriptions-item>
        <a-descriptions-item label="待办 tombstones">
          <a-tag v-if="status.pendingTombstones" color="orange">
            有未完成删除
          </a-tag>
          <span v-else class="muted">无</span>
        </a-descriptions-item>
        <a-descriptions-item label="已配对设备" :span="2">
          {{ status.devices?.length ?? 0 }} 台
        </a-descriptions-item>
      </a-descriptions>
      <a-empty v-else description="尚未加载状态" />

      <a-divider />

      <a-space>
        <a-button
          type="primary"
          :loading="runningAll"
          :disabled="
            !status?.bridgeReady || devices.filter((d) => d.online).length === 0
          "
          @click="onRunAll"
        >
          <template #icon>
            <SyncOutlined />
          </template>
          同步所有在线设备
        </a-button>
      </a-space>
    </a-card>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onBeforeUnmount } from "vue";
import { message } from "ant-design-vue";
import {
  ArrowLeftOutlined,
  ReloadOutlined,
  SyncOutlined,
  DisconnectOutlined,
} from "@ant-design/icons-vue";
import { logger } from "@/utils/logger";

interface MobileDevice {
  deviceId: string;
  deviceName: string;
  platform: string | null;
  did: string | null;
  pairedAt: number | null;
  online: boolean;
}

interface DeviceCursor {
  deviceId: string;
  lastSyncAt: number | null;
  lastRunStatus: string | null;
  lastRunError: string | null;
  lastRunDurationMs: number | null;
  itemsPushed: number;
  itemsSkipped: number;
  itemsDeleted: number;
}

interface SyncMobileStatus {
  success: boolean;
  bridgeReady: boolean;
  pendingTombstones: boolean;
  devices: DeviceCursor[];
  error?: string;
}

const devices = ref<MobileDevice[]>([]);
const cursorByDevice = reactive<Record<string, DeviceCursor>>({});
const status = ref<SyncMobileStatus | null>(null);
const loading = ref(false);
const runningAll = ref(false);
const runningById = reactive<Record<string, boolean>>({});

let pollTimer: ReturnType<typeof setInterval> | null = null;

const api = (window as any).electronAPI?.sync?.mobile;

async function loadDevices() {
  if (!api) {
    return;
  }
  loading.value = true;
  try {
    const [listRes, statusRes] = await Promise.all([
      api.listPaired(),
      api.status(),
    ]);
    if (listRes?.success) {
      devices.value = listRes.devices || [];
    } else {
      message.error(`加载设备失败：${listRes?.error || "未知"}`);
      devices.value = [];
    }
    if (statusRes?.success) {
      status.value = statusRes;
      // 索引 cursor by deviceId
      for (const d of statusRes.devices || []) {
        cursorByDevice[d.deviceId] = d;
      }
    } else {
      status.value = null;
    }
  } catch (err: any) {
    logger.error("[SyncMobile] loadDevices:", err);
    message.error(err?.message || String(err));
  } finally {
    loading.value = false;
  }
}

async function onRunOne(deviceId: string) {
  if (!api) {
    return;
  }
  runningById[deviceId] = true;
  try {
    const res = await api.run(deviceId);
    if (res?.success) {
      const detail = `推送 ${res.pushed} / 拉取 ${res.pulled} / 跳过 ${res.conflicts}`;
      message.success(`${deviceId.slice(0, 8)}… 同步完成：${detail}`);
    } else {
      message.error(`同步失败：${res?.error || "未知错误"}`);
    }
    await loadDevices();
  } finally {
    runningById[deviceId] = false;
  }
}

async function onRunAll() {
  if (!api) {
    return;
  }
  runningAll.value = true;
  try {
    const res = await api.runAll();
    if (res?.success && res.devices?.length > 0) {
      const total = res.devices.reduce(
        (s: number, d: any) => s + (d.pushed || 0),
        0,
      );
      message.success(
        `同步完成：${res.devices.length} 台设备，共推送 ${total} 条`,
      );
    } else if (res?.devices?.length === 0) {
      message.warning(res.error || "无可同步的在线设备");
    } else {
      const failed = res?.devices?.filter((d: any) => d.error).length ?? 0;
      message.error(`部分设备同步失败：${failed}/${res?.devices?.length}`);
    }
    await loadDevices();
  } finally {
    runningAll.value = false;
  }
}

async function onUnpair(deviceId: string) {
  if (!api) {
    return;
  }
  try {
    const res = await api.unpair(deviceId);
    if (res?.success) {
      message.success("已解绑");
      delete cursorByDevice[deviceId];
      await loadDevices();
    } else {
      message.error(`解绑失败：${res?.error || "未知错误"}`);
    }
  } catch (err: any) {
    message.error(err?.message || String(err));
  }
}

function formatCursor(c: DeviceCursor): string {
  const parts: string[] = [];
  if (c.lastSyncAt) {
    const d = new Date(c.lastSyncAt);
    parts.push(`上次同步 ${d.toLocaleString()}`);
  }
  if (c.lastRunStatus) {
    parts.push(`状态 ${c.lastRunStatus}`);
  }
  parts.push(`累积推送 ${c.itemsPushed}`);
  if (c.itemsSkipped > 0) {
    parts.push(`跳过 ${c.itemsSkipped}`);
  }
  if (c.lastRunError) {
    parts.push(`错误 ${c.lastRunError}`);
  }
  return parts.join(" · ");
}

onMounted(() => {
  loadDevices();
  // 5s poll：捕获 Android 设备上线/离线状态
  pollTimer = setInterval(loadDevices, 5000);
});

onBeforeUnmount(() => {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
});
</script>

<style scoped>
.mobile-settings {
  padding: 16px 24px;
  max-width: 1080px;
  margin: 0 auto;
}
.hint-alert,
.devices-card,
.status-card {
  margin-top: 16px;
}
.pair-steps {
  margin: 8px 0 0 0;
  padding-left: 20px;
}
.pair-steps li {
  margin: 4px 0;
}
.muted {
  color: var(--cc-text-secondary, #999);
}
.device-name {
  font-weight: 500;
}
.device-meta {
  font-size: 12px;
  color: var(--cc-text-secondary, #888);
}
.device-meta code,
.did-code {
  font-family: ui-monospace, "SFMono-Regular", Menlo, monospace;
  font-size: 11px;
  background: var(--cc-bg-subtle, #f5f5f5);
  padding: 1px 4px;
  border-radius: 3px;
}
.did-code {
  word-break: break-all;
}
</style>
