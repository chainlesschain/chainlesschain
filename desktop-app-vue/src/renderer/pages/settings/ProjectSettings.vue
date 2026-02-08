<template>
  <div class="project-settings">
    <a-card title="项目存储配置">
      <a-form layout="vertical">
        <a-form-item label="项目根目录">
          <a-input
            v-model:value="projectsRootPath"
            placeholder="项目文件存储的根目录路径"
            disabled
          />
          <template #extra>
            <div style="margin-top: 8px">
              当前项目存储位置。修改此配置需要重启应用生效。
            </div>
          </template>
        </a-form-item>

        <a-form-item>
          <a-space>
            <a-button type="primary" @click="handleOpenFolder">
              <FolderOpenOutlined />
              打开项目目录
            </a-button>
            <a-button @click="handleRefreshConfig">
              <ReloadOutlined />
              刷新配置
            </a-button>
          </a-space>
        </a-form-item>
      </a-form>
    </a-card>

    <a-card title="项目配置信息" style="margin-top: 16px">
      <a-descriptions bordered :column="1">
        <a-descriptions-item label="项目根目录">
          {{ config.projectsRootPath || "未配置" }}
        </a-descriptions-item>
        <a-descriptions-item label="最大项目大小">
          {{ config.maxProjectSizeMB || 1000 }} MB
        </a-descriptions-item>
        <a-descriptions-item label="自动同步">
          {{ config.autoSync ? "启用" : "禁用" }}
        </a-descriptions-item>
        <a-descriptions-item label="同步间隔">
          {{ config.syncIntervalSeconds || 300 }} 秒
        </a-descriptions-item>
      </a-descriptions>
    </a-card>
  </div>
</template>

<script setup>
import { logger } from "@/utils/logger";

import { ref, onMounted } from "vue";
import { message } from "ant-design-vue";
import { FolderOpenOutlined, ReloadOutlined } from "@ant-design/icons-vue";

const projectsRootPath = ref("");
const config = ref({});

// 加载配置
const loadConfig = async () => {
  try {
    const projectConfig = await window.electronAPI.project.getConfig();
    config.value = projectConfig;
    projectsRootPath.value = projectConfig.projectsRootPath;
  } catch (error) {
    logger.error("加载配置失败:", error);
    message.error("加载配置失败：" + error.message);
  }
};

// 刷新配置
const handleRefreshConfig = async () => {
  try {
    await loadConfig();
    message.success("配置已刷新");
  } catch (error) {
    logger.error("刷新配置失败:", error);
    message.error("刷新配置失败：" + error.message);
  }
};

// 打开项目目录
const handleOpenFolder = async () => {
  try {
    const { shell } = require("electron");
    await shell.openPath(projectsRootPath.value);
  } catch (error) {
    logger.error("打开目录失败:", error);
    message.error("打开目录失败：" + error.message);
  }
};

onMounted(() => {
  loadConfig();
});
</script>

<style scoped>
.project-settings {
  padding: 24px;
}
</style>
