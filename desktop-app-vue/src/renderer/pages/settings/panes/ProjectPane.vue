<template>
  <a-card title="项目存储配置">
    <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }">
      <a-form-item label="项目根目录">
        <a-input
          v-model:value="config.project.rootPath"
          placeholder="项目文件存储的根目录路径"
        />
        <template #extra>
          <a-space>
            <a-button size="small" @click="handleSelectRootPath">
              <FolderOpenOutlined />
              选择目录
            </a-button>
            <span style="color: #999">修改后需重启应用生效</span>
          </a-space>
        </template>
      </a-form-item>

      <a-form-item label="最大项目大小">
        <a-input-number
          v-model:value="config.project.maxSizeMB"
          :min="100"
          :max="10000"
          :step="100"
          addon-after="MB"
          style="width: 200px"
        />
      </a-form-item>

      <a-form-item label="自动同步">
        <a-switch v-model:checked="config.project.autoSync" />
        <span style="margin-left: 8px">自动同步项目到后端服务器</span>
      </a-form-item>

      <a-form-item v-if="config.project.autoSync" label="同步间隔">
        <a-input-number
          v-model:value="config.project.syncIntervalSeconds"
          :min="60"
          :max="3600"
          :step="60"
          addon-after="秒"
          style="width: 200px"
        />
      </a-form-item>
    </a-form>
  </a-card>
</template>

<script setup>
import { logger } from "@/utils/logger";
import { message } from "ant-design-vue";
import { FolderOpenOutlined } from "@ant-design/icons-vue";

const config = defineModel("config", { type: Object, required: true });

const handleSelectRootPath = async () => {
  try {
    const selectedPath = await window.electronAPI.dialog.selectFolder({
      title: "选择文件夹",
      defaultPath: config.value.project.rootPath || undefined,
      buttonLabel: "选择",
    });

    if (selectedPath) {
      config.value.project.rootPath = selectedPath;
      message.success("文件夹已选择：" + selectedPath);
    }
  } catch (error) {
    logger.error("选择文件夹失败:", error);
    message.error("选择文件夹失败：" + error.message);
  }
};
</script>
