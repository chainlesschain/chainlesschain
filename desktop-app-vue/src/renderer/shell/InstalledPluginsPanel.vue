<template>
  <a-modal
    :open="open"
    :width="920"
    :footer="null"
    :mask-closable="true"
    :body-style="{ maxHeight: '80vh', overflowY: 'auto' }"
    title="已安装插件"
    @update:open="(v) => $emit('update:open', v)"
  >
    <div v-if="prefillText" class="prefill-banner">
      <AppstoreOutlined />
      <span class="prefill-text">命令：{{ prefillText }}</span>
    </div>

    <div class="ip-toolbar">
      <span class="ip-sub">管理已安装的插件，检查更新和配置</span>
      <a-space>
        <a-button
          size="small"
          :loading="checkingUpdates"
          @click="handleCheckUpdates"
        >
          <template #icon><SyncOutlined /></template>
          检查更新
        </a-button>
        <a-button size="small" @click="handleExportList">
          <template #icon><ExportOutlined /></template>
          导出列表
        </a-button>
      </a-space>
    </div>

    <a-row :gutter="16" class="ip-stats">
      <a-col :span="8">
        <a-statistic title="已安装总数" :value="store.installedCount" />
      </a-col>
      <a-col :span="8">
        <a-statistic
          title="已启用"
          :value="store.enabledPlugins.length"
          :value-style="{ color: '#52c41a' }"
        />
      </a-col>
      <a-col :span="8">
        <a-statistic
          title="可用更新"
          :value="store.updateCount"
          :value-style="{ color: '#faad14' }"
        />
      </a-col>
    </a-row>

    <a-spin :spinning="store.loading">
      <a-table
        :columns="columns"
        :data-source="store.installedPlugins"
        :pagination="{ pageSize: 8 }"
        row-key="id"
        size="small"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'name'">
            <strong>{{ record.name }}</strong>
            <a-tag
              v-if="hasUpdate(record)"
              color="orange"
              style="margin-left: 6px"
            >
              有更新
            </a-tag>
          </template>
          <template v-else-if="column.key === 'installed_at'">
            {{ formatDate(record.installed_at) }}
          </template>
          <template v-else-if="column.key === 'enabled'">
            <a-switch
              :checked="record.enabled"
              :loading="togglingId === record.plugin_id"
              size="small"
              @change="(c) => handleToggleEnabled(record, c)"
            />
          </template>
          <template v-else-if="column.key === 'auto_update'">
            <a-switch
              :checked="record.auto_update"
              size="small"
              @change="(c) => handleToggleAutoUpdate(record, c)"
            />
          </template>
          <template v-else-if="column.key === 'actions'">
            <a-space>
              <a-button
                v-if="hasUpdate(record)"
                type="link"
                size="small"
                @click="handleShowUpdate(record)"
              >
                更新
              </a-button>
              <a-popconfirm
                :title="`确定卸载「${record.name}」?`"
                ok-text="卸载"
                cancel-text="取消"
                @confirm="handleUninstall(record)"
              >
                <a-button type="link" size="small" danger>卸载</a-button>
              </a-popconfirm>
            </a-space>
          </template>
        </template>
      </a-table>
    </a-spin>

    <!-- update modal -->
    <a-modal
      v-model:open="updateModalVisible"
      title="更新插件"
      :confirm-loading="updating"
      ok-text="确认更新"
      cancel-text="取消"
      @ok="handleConfirmUpdate"
    >
      <template v-if="updateTarget">
        <p>
          将
          <strong>{{ updateTarget.name }}</strong>
          更新到版本
          <a-tag color="orange">{{ getUpdateVersion(updateTarget) }}</a-tag>
        </p>
        <a-descriptions
          v-if="getUpdateChangelog(updateTarget)"
          :column="1"
          size="small"
          bordered
        >
          <a-descriptions-item label="更新日志">
            <pre class="ip-changelog">{{
              getUpdateChangelog(updateTarget)
            }}</pre>
          </a-descriptions-item>
        </a-descriptions>
      </template>
    </a-modal>
  </a-modal>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { message } from "ant-design-vue";
import {
  AppstoreOutlined,
  SyncOutlined,
  ExportOutlined,
} from "@ant-design/icons-vue";
import {
  useMarketplaceStore,
  type InstalledPlugin,
} from "../stores/marketplace";

const props = defineProps<{ open: boolean; prefillText?: string }>();
defineEmits<{ (e: "update:open", value: boolean): void }>();

const store = useMarketplaceStore();

const checkingUpdates = ref(false);
const togglingId = ref<string | null>(null);
const updateModalVisible = ref(false);
const updateTarget = ref<InstalledPlugin | null>(null);
const updating = ref(false);

const columns = [
  { title: "插件名称", key: "name", dataIndex: "name" },
  { title: "版本", key: "version", dataIndex: "version", width: 90 },
  { title: "作者", key: "author", dataIndex: "author", width: 130 },
  { title: "安装时间", key: "installed_at", width: 120 },
  { title: "启用", key: "enabled", width: 70, align: "center" as const },
  {
    title: "自动更新",
    key: "auto_update",
    width: 90,
    align: "center" as const,
  },
  { title: "操作", key: "actions", width: 130 },
];

function invoke(channel: string, ...args: unknown[]): Promise<any> {
  const w = window as unknown as {
    electronAPI?: { invoke?: (c: string, ...a: unknown[]) => Promise<unknown> };
  };
  return w.electronAPI?.invoke
    ? w.electronAPI.invoke(channel, ...args)
    : Promise.reject(new Error("IPC unavailable"));
}

function hasUpdate(plugin: InstalledPlugin): boolean {
  return store.availableUpdates.some((u) => u.pluginId === plugin.plugin_id);
}
function getUpdateVersion(plugin: InstalledPlugin): string {
  const u = store.availableUpdates.find((x) => x.pluginId === plugin.plugin_id);
  return u?.newVersion || u?.version || "未知";
}
function getUpdateChangelog(plugin: InstalledPlugin): string {
  const u = store.availableUpdates.find((x) => x.pluginId === plugin.plugin_id);
  return u?.changelog || "";
}
function formatDate(ts?: number): string {
  return ts
    ? new Date(ts).toLocaleDateString("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      })
    : "-";
}

async function handleCheckUpdates(): Promise<void> {
  checkingUpdates.value = true;
  try {
    await store.checkUpdates();
    if (store.updateCount > 0) {
      message.info(`发现 ${store.updateCount} 个可用更新`);
    } else {
      message.success("所有插件已是最新版本");
    }
  } catch (e: unknown) {
    message.error(
      "检查更新失败：" + (e instanceof Error ? e.message : String(e)),
    );
  } finally {
    checkingUpdates.value = false;
  }
}

function handleExportList(): void {
  try {
    const data = store.installedPlugins.map((p) => ({
      name: p.name,
      version: p.version,
      author: p.author,
      enabled: p.enabled,
      installed_at: formatDate(p.installed_at),
    }));
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `installed-plugins-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
    message.success("插件列表导出成功");
  } catch {
    message.error("导出失败");
  }
}

async function handleToggleEnabled(
  plugin: InstalledPlugin,
  checked: boolean,
): Promise<void> {
  togglingId.value = plugin.plugin_id;
  try {
    if (checked) {
      await store.enablePlugin(plugin.plugin_id);
      message.success(`插件 "${plugin.name}" 已启用`);
    } else {
      await store.disablePlugin(plugin.plugin_id);
      message.success(`插件 "${plugin.name}" 已禁用`);
    }
  } catch (e: unknown) {
    message.error("操作失败：" + (e instanceof Error ? e.message : String(e)));
  } finally {
    togglingId.value = null;
  }
}

async function handleToggleAutoUpdate(
  plugin: InstalledPlugin,
  checked: boolean,
): Promise<void> {
  try {
    await invoke("marketplace:set-auto-update", {
      pluginId: plugin.plugin_id,
      autoUpdate: checked,
    });
    plugin.auto_update = checked;
    message.success(checked ? "已开启自动更新" : "已关闭自动更新");
  } catch {
    message.error("操作失败");
  }
}

function handleShowUpdate(plugin: InstalledPlugin): void {
  updateTarget.value = plugin;
  updateModalVisible.value = true;
}

async function handleConfirmUpdate(): Promise<void> {
  if (!updateTarget.value) {
    return;
  }
  updating.value = true;
  try {
    await store.updatePlugin(
      updateTarget.value.plugin_id,
      getUpdateVersion(updateTarget.value),
    );
    message.success(`插件 "${updateTarget.value.name}" 更新成功`);
    updateModalVisible.value = false;
    updateTarget.value = null;
  } catch (e: unknown) {
    message.error("更新失败：" + (e instanceof Error ? e.message : String(e)));
  } finally {
    updating.value = false;
  }
}

async function handleUninstall(plugin: InstalledPlugin): Promise<void> {
  try {
    await store.uninstallPlugin(plugin.plugin_id);
    message.success(`插件 "${plugin.name}" 已卸载`);
  } catch (e: unknown) {
    message.error("卸载失败：" + (e instanceof Error ? e.message : String(e)));
  }
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen && !store.loading) {
      Promise.all([store.fetchInstalled(), store.checkUpdates()]);
    }
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
.ip-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.ip-sub {
  color: rgba(0, 0, 0, 0.45);
  font-size: 13px;
}
.ip-stats {
  margin-bottom: 16px;
}
.ip-changelog {
  margin: 0;
  font-size: 12px;
  white-space: pre-wrap;
  max-height: 200px;
  overflow: auto;
}
</style>
