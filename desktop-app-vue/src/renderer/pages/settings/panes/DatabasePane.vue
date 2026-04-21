<template>
  <div>
    <a-card title="数据库存储位置">
      <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }">
        <a-form-item label="当前路径">
          <a-input
            v-model:value="databaseConfig.path"
            readonly
            style="font-family: monospace"
          />
        </a-form-item>

        <a-form-item label="默认路径">
          <a-input
            :value="databaseConfig.defaultPath"
            readonly
            disabled
            style="font-family: monospace; font-size: 12px"
          />
        </a-form-item>

        <a-form-item label="新位置">
          <a-input
            v-model:value="newDatabasePath"
            placeholder="选择新的数据库存储位置"
            style="font-family: monospace"
          />
          <template #extra>
            <a-space>
              <a-button size="small" @click="handleSelectDatabasePath">
                <FolderOpenOutlined />
                选择位置
              </a-button>
              <a-button
                size="small"
                type="primary"
                :disabled="
                  !newDatabasePath || newDatabasePath === databaseConfig.path
                "
                :loading="migrating"
                @click="handleMigrateDatabase"
              >
                迁移数据库
              </a-button>
            </a-space>
          </template>
        </a-form-item>

        <a-form-item>
          <a-alert
            message="重要提示"
            description="迁移数据库会将当前数据库文件复制到新位置，并自动创建备份。迁移完成后需要重启应用。"
            type="info"
            show-icon
          />
        </a-form-item>
      </a-form>
    </a-card>

    <a-card title="数据库备份管理" style="margin-top: 16px">
      <a-space direction="vertical" style="width: 100%">
        <a-button type="primary" :loading="backing" @click="handleCreateBackup">
          <SaveOutlined />
          立即备份
        </a-button>

        <a-divider />

        <div>
          <div
            style="
              margin-bottom: 12px;
              display: flex;
              justify-content: space-between;
              align-items: center;
            "
          >
            <strong>备份列表</strong>
            <a-button size="small" @click="loadBackupList">
              <ReloadOutlined />
              刷新
            </a-button>
          </div>

          <a-list
            :data-source="backupList"
            :loading="loadingBackups"
            size="small"
            bordered
          >
            <template #renderItem="{ item }">
              <a-list-item>
                <template #actions>
                  <a-button
                    size="small"
                    type="link"
                    danger
                    @click="handleRestoreBackup(item.path)"
                  >
                    恢复
                  </a-button>
                </template>
                <a-list-item-meta>
                  <template #title>
                    {{ item.name }}
                  </template>
                  <template #description>
                    <a-space>
                      <span>大小: {{ formatFileSize(item.size) }}</span>
                      <span>时间: {{ formatDate(item.created) }}</span>
                    </a-space>
                  </template>
                </a-list-item-meta>
              </a-list-item>
            </template>

            <template #empty>
              <a-empty description="暂无备份" />
            </template>
          </a-list>
        </div>
      </a-space>
    </a-card>
  </div>
</template>

<script setup>
import { logger } from "@/utils/logger";
import { ref, onMounted } from "vue";
import { message, Modal } from "ant-design-vue";
import {
  FolderOpenOutlined,
  SaveOutlined,
  ReloadOutlined,
} from "@ant-design/icons-vue";

const databaseConfig = ref({
  path: "",
  defaultPath: "",
  exists: false,
  autoBackup: true,
  maxBackups: 7,
});
const newDatabasePath = ref("");
const migrating = ref(false);
const backing = ref(false);
const loadingBackups = ref(false);
const backupList = ref([]);

const loadDatabaseConfig = async () => {
  try {
    const dbConfig = await window.electronAPI.db.getConfig();
    databaseConfig.value = dbConfig;
  } catch (error) {
    logger.error("加载数据库配置失败:", error);
    message.error("加载数据库配置失败：" + error.message);
  }
};

const loadBackupList = async () => {
  loadingBackups.value = true;
  try {
    backupList.value = await window.electronAPI.db.listBackups();
  } catch (error) {
    logger.error("加载备份列表失败:", error);
    message.error("加载备份列表失败：" + error.message);
  } finally {
    loadingBackups.value = false;
  }
};

const handleSelectDatabasePath = async () => {
  try {
    const currentPath = databaseConfig.value.path || "";
    const lastSlash = Math.max(
      currentPath.lastIndexOf("/"),
      currentPath.lastIndexOf("\\"),
    );
    const defaultDir = lastSlash > 0 ? currentPath.substring(0, lastSlash) : "";

    const selectedPath = await window.electronAPI.dialog.selectFolder({
      title: "选择数据库存储位置",
      defaultPath: defaultDir,
      buttonLabel: "选择",
    });

    if (selectedPath) {
      const separator = selectedPath.includes("\\") ? "\\" : "/";
      newDatabasePath.value = selectedPath + separator + "chainlesschain.db";
      message.success("已选择新位置：" + newDatabasePath.value);
    }
  } catch (error) {
    logger.error("选择数据库路径失败:", error);
    message.error("选择数据库路径失败：" + error.message);
  }
};

const handleMigrateDatabase = async () => {
  if (!newDatabasePath.value) {
    message.warning("请先选择新的数据库位置");
    return;
  }

  Modal.confirm({
    title: "确认迁移数据库",
    content: `确定要将数据库迁移到新位置吗？\n新位置：${newDatabasePath.value}\n\n迁移完成后将自动重启应用。`,
    okText: "迁移",
    cancelText: "取消",
    async onOk() {
      migrating.value = true;
      try {
        await window.electronAPI.db.migrate(newDatabasePath.value);
        message.success("数据库迁移成功！应用即将重启...");
        setTimeout(async () => {
          await window.electronAPI.app.restart();
        }, 2000);
      } catch (error) {
        logger.error("迁移数据库失败:", error);
        message.error("迁移数据库失败：" + error.message);
        migrating.value = false;
      }
    },
  });
};

const handleCreateBackup = async () => {
  backing.value = true;
  try {
    const backupPath = await window.electronAPI.db.createBackup();
    message.success("备份创建成功：" + backupPath);
    await loadBackupList();
  } catch (error) {
    logger.error("创建备份失败:", error);
    message.error("创建备份失败：" + error.message);
  } finally {
    backing.value = false;
  }
};

const handleRestoreBackup = (backupPath) => {
  Modal.confirm({
    title: "确认恢复备份",
    content: `确定要从此备份恢复数据库吗？\n备份文件：${backupPath}\n\n当前数据将被覆盖，恢复后需要重启应用。`,
    okText: "恢复",
    okType: "danger",
    cancelText: "取消",
    async onOk() {
      try {
        await window.electronAPI.db.restoreBackup(backupPath);
        message.success("备份恢复成功！应用即将重启...");
        setTimeout(async () => {
          await window.electronAPI.app.restart();
        }, 2000);
      } catch (error) {
        logger.error("恢复备份失败:", error);
        message.error("恢复备份失败：" + error.message);
      }
    },
  });
};

const formatFileSize = (bytes) => {
  if (bytes === 0) {
    return "0 B";
  }
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
};

const formatDate = (date) => {
  const d = new Date(date);
  return d.toLocaleString("zh-CN");
};

onMounted(async () => {
  await loadDatabaseConfig();
  await loadBackupList();
});
</script>
