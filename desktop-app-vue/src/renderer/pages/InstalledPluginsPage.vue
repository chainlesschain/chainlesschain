<template>
  <div class="installed-plugins-page">
    <!-- 页面头部 -->
    <div class="page-header">
      <div class="header-left">
        <h1>
          <AppstoreOutlined />
          已安装插件
        </h1>
        <p class="page-description">管理已安装的插件，检查更新和配置</p>
      </div>
      <div class="header-right">
        <a-space>
          <a-button :loading="checkingUpdates" @click="handleCheckUpdates">
            <SyncOutlined />
            检查更新
          </a-button>
          <a-button @click="handleExportList">
            <ExportOutlined />
            导出列表
          </a-button>
        </a-space>
      </div>
    </div>

    <!-- 统计行 -->
    <a-row :gutter="16" class="stats-row">
      <a-col :span="8">
        <a-statistic title="已安装总数" :value="marketplaceStore.installedCount">
          <template #prefix>
            <AppstoreOutlined />
          </template>
        </a-statistic>
      </a-col>
      <a-col :span="8">
        <a-statistic title="已启用" :value="marketplaceStore.enabledPlugins.length">
          <template #prefix>
            <CheckCircleOutlined style="color: #52c41a" />
          </template>
        </a-statistic>
      </a-col>
      <a-col :span="8">
        <a-statistic title="可用更新" :value="marketplaceStore.updateCount">
          <template #prefix>
            <ArrowUpOutlined style="color: #faad14" />
          </template>
        </a-statistic>
      </a-col>
    </a-row>

    <!-- 插件列表 -->
    <a-spin :spinning="marketplaceStore.loading">
      <a-table
        :columns="columns"
        :data-source="marketplaceStore.installedPlugins"
        :pagination="{ pageSize: 15, showSizeChanger: true }"
        row-key="id"
        class="plugins-table"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'name'">
            <div class="plugin-name-cell">
              <strong>{{ record.name }}</strong>
              <a-tag v-if="hasUpdate(record as InstalledPlugin)" color="orange" size="small">有更新</a-tag>
            </div>
          </template>

          <template v-if="column.key === 'version'">
            <span>{{ record.version }}</span>
          </template>

          <template v-if="column.key === 'author'">
            <span>{{ record.author || '-' }}</span>
          </template>

          <template v-if="column.key === 'installed_at'">
            <span>{{ formatDate(record.installed_at) }}</span>
          </template>

          <template v-if="column.key === 'enabled'">
            <a-switch
              :checked="record.enabled"
              :loading="togglingId === record.plugin_id"
              @change="(checked: boolean) => handleToggleEnabled(record as InstalledPlugin, checked)"
            />
          </template>

          <template v-if="column.key === 'auto_update'">
            <a-switch
              :checked="record.auto_update"
              size="small"
              @change="(checked: boolean) => handleToggleAutoUpdate(record as InstalledPlugin, checked)"
            />
          </template>

          <template v-if="column.key === 'actions'">
            <a-space>
              <a-button
                v-if="hasUpdate(record as InstalledPlugin)"
                type="primary"
                size="small"
                @click="handleShowUpdate(record as InstalledPlugin)"
              >
                <ArrowUpOutlined />
                更新
              </a-button>
              <a-popconfirm
                :title="`确定要卸载插件 '${record.name}' 吗？`"
                ok-text="确定卸载"
                cancel-text="取消"
                @confirm="handleUninstall(record as InstalledPlugin)"
              >
                <a-button danger size="small">
                  <DeleteOutlined />
                  卸载
                </a-button>
              </a-popconfirm>
            </a-space>
          </template>
        </template>

        <template #emptyText>
          <a-empty description="暂无已安装的插件" />
        </template>
      </a-table>
    </a-spin>

    <!-- 更新模态框 -->
    <a-modal
      v-model:open="updateModalVisible"
      title="插件更新"
      :confirm-loading="updating"
      ok-text="确认更新"
      cancel-text="取消"
      @ok="handleConfirmUpdate"
    >
      <div v-if="updateTarget" class="update-modal-content">
        <h3>{{ updateTarget.name }}</h3>
        <a-descriptions :column="1" bordered size="small">
          <a-descriptions-item label="当前版本">
            <a-tag color="default">{{ updateTarget.version }}</a-tag>
          </a-descriptions-item>
          <a-descriptions-item label="最新版本">
            <a-tag color="green">{{ getUpdateVersion(updateTarget) }}</a-tag>
          </a-descriptions-item>
        </a-descriptions>
        <div class="update-changelog">
          <h4>更新说明</h4>
          <p>{{ getUpdateChangelog(updateTarget) || '暂无更新说明' }}</p>
        </div>
      </div>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { message } from 'ant-design-vue';
import {
  AppstoreOutlined,
  CheckCircleOutlined,
  ArrowUpOutlined,
  SyncOutlined,
  ExportOutlined,
  DeleteOutlined,
} from '@ant-design/icons-vue';
import { useMarketplaceStore, type InstalledPlugin } from '@/stores/marketplace';
import { logger, createLogger } from '@/utils/logger';

const pageLogger = createLogger('installed-plugins-page');

const marketplaceStore = useMarketplaceStore();

// ==================== 状态 ====================

const checkingUpdates = ref(false);
const togglingId = ref<string | null>(null);
const updateModalVisible = ref(false);
const updateTarget = ref<InstalledPlugin | null>(null);
const updating = ref(false);

// ==================== 表格列配置 ====================

const columns = [
  { title: '插件名称', key: 'name', dataIndex: 'name', sorter: true },
  { title: '版本', key: 'version', dataIndex: 'version', width: 100 },
  { title: '作者', key: 'author', dataIndex: 'author', width: 140 },
  { title: '安装时间', key: 'installed_at', dataIndex: 'installed_at', width: 140, sorter: true },
  { title: '启用', key: 'enabled', width: 80, align: 'center' as const },
  { title: '自动更新', key: 'auto_update', width: 100, align: 'center' as const },
  { title: '操作', key: 'actions', width: 180 },
];

// ==================== 方法 ====================

function hasUpdate(plugin: InstalledPlugin): boolean {
  return marketplaceStore.availableUpdates.some(
    (u) => u.pluginId === plugin.plugin_id
  );
}

function getUpdateVersion(plugin: InstalledPlugin): string {
  const update = marketplaceStore.availableUpdates.find(
    (u) => u.pluginId === plugin.plugin_id
  );
  return update?.newVersion || update?.version || '未知';
}

function getUpdateChangelog(plugin: InstalledPlugin): string {
  const update = marketplaceStore.availableUpdates.find(
    (u) => u.pluginId === plugin.plugin_id
  );
  return update?.changelog || '';
}

function formatDate(timestamp: number | undefined): string {
  if (!timestamp) return '-';
  return new Date(timestamp).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

async function handleCheckUpdates() {
  checkingUpdates.value = true;
  try {
    await marketplaceStore.checkUpdates();
    if (marketplaceStore.updateCount > 0) {
      message.info(`发现 ${marketplaceStore.updateCount} 个可用更新`);
    } else {
      message.success('所有插件已是最新版本');
    }
  } catch (error) {
    pageLogger.error('检查更新失败:', error);
    message.error('检查更新失败: ' + (error as Error).message);
  } finally {
    checkingUpdates.value = false;
  }
}

function handleExportList() {
  try {
    const exportData = marketplaceStore.installedPlugins.map((p) => ({
      name: p.name,
      version: p.version,
      author: p.author,
      enabled: p.enabled,
      installed_at: formatDate(p.installed_at),
    }));
    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `installed-plugins-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
    message.success('插件列表导出成功');
  } catch (error) {
    pageLogger.error('导出列表失败:', error);
    message.error('导出失败');
  }
}

async function handleToggleEnabled(plugin: InstalledPlugin, checked: boolean) {
  togglingId.value = plugin.plugin_id;
  try {
    if (checked) {
      await marketplaceStore.enablePlugin(plugin.plugin_id);
      message.success(`插件 "${plugin.name}" 已启用`);
    } else {
      await marketplaceStore.disablePlugin(plugin.plugin_id);
      message.success(`插件 "${plugin.name}" 已禁用`);
    }
  } catch (error) {
    pageLogger.error('切换插件状态失败:', error);
    message.error('操作失败: ' + (error as Error).message);
  } finally {
    togglingId.value = null;
  }
}

async function handleToggleAutoUpdate(plugin: InstalledPlugin, checked: boolean) {
  try {
    await (window as any).electronAPI.invoke('marketplace:set-auto-update', {
      pluginId: plugin.plugin_id,
      autoUpdate: checked,
    });
    plugin.auto_update = checked;
    message.success(checked ? '已开启自动更新' : '已关闭自动更新');
  } catch (error) {
    pageLogger.error('设置自动更新失败:', error);
    message.error('操作失败');
  }
}

function handleShowUpdate(plugin: InstalledPlugin) {
  updateTarget.value = plugin;
  updateModalVisible.value = true;
}

async function handleConfirmUpdate() {
  if (!updateTarget.value) return;
  updating.value = true;
  try {
    const newVersion = getUpdateVersion(updateTarget.value);
    await marketplaceStore.updatePlugin(updateTarget.value.plugin_id, newVersion);
    message.success(`插件 "${updateTarget.value.name}" 更新成功`);
    updateModalVisible.value = false;
    updateTarget.value = null;
  } catch (error) {
    pageLogger.error('更新插件失败:', error);
    message.error('更新失败: ' + (error as Error).message);
  } finally {
    updating.value = false;
  }
}

async function handleUninstall(plugin: InstalledPlugin) {
  try {
    await marketplaceStore.uninstallPlugin(plugin.plugin_id);
    message.success(`插件 "${plugin.name}" 已卸载`);
  } catch (error) {
    pageLogger.error('卸载插件失败:', error);
    message.error('卸载失败: ' + (error as Error).message);
  }
}

// ==================== 生命周期 ====================

onMounted(async () => {
  pageLogger.info('InstalledPluginsPage 挂载');
  await Promise.all([
    marketplaceStore.fetchInstalled(),
    marketplaceStore.checkUpdates(),
  ]);
});
</script>

<style scoped lang="scss">
.installed-plugins-page {
  padding: 24px;
  background: #f0f2f5;
  min-height: calc(100vh - 64px);

  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 24px;

    .header-left {
      h1 {
        font-size: 24px;
        font-weight: 600;
        color: #262626;
        margin: 0 0 8px 0;
        display: flex;
        align-items: center;
        gap: 12px;

        :deep(.anticon) {
          font-size: 28px;
          color: #1890ff;
        }
      }

      .page-description {
        color: #8c8c8c;
        margin: 0;
        font-size: 14px;
      }
    }
  }

  .stats-row {
    background: white;
    padding: 24px;
    border-radius: 8px;
    margin-bottom: 24px;
  }

  .plugins-table {
    background: white;
    border-radius: 8px;
    padding: 16px;

    .plugin-name-cell {
      display: flex;
      align-items: center;
      gap: 8px;
    }
  }
}

.update-modal-content {
  h3 {
    font-size: 18px;
    margin-bottom: 16px;
  }

  .update-changelog {
    margin-top: 16px;

    h4 {
      font-size: 14px;
      font-weight: 600;
      margin-bottom: 8px;
    }

    p {
      color: #595959;
      line-height: 1.6;
    }
  }
}
</style>
