<template>
  <div class="archive-preview">
    <!-- 压缩包信息 -->
    <div v-if="archiveInfo" class="archive-info">
      <div class="info-header">
        <FileZipOutlined class="archive-icon" />
        <div class="info-content">
          <h3>{{ archiveInfo.name }}</h3>
          <div class="info-details">
            <a-tag color="blue">
              {{ archiveInfo.type }}
            </a-tag>
            <span>大小: {{ formatSize(archiveInfo.size) }}</span>
            <span>文件: {{ archiveInfo.fileCount }}</span>
            <span>文件夹: {{ archiveInfo.folderCount }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 文件树 -->
    <div class="file-tree-container">
      <a-spin :spinning="loading" tip="加载中...">
        <a-tree
          v-if="treeData.length > 0"
          :tree-data="treeData"
          :show-icon="true"
          :selectable="true"
          @select="handleSelect"
        >
          <template #icon="{ dataRef }">
            <FolderOutlined v-if="dataRef.isDirectory" style="color: #faad14" />
            <FileOutlined
              v-else
              :style="{ color: getFileIconColor(dataRef.type) }"
            />
          </template>
          <template #title="{ dataRef }">
            <div class="tree-node-title">
              <span class="node-name">{{ dataRef.title }}</span>
              <span v-if="!dataRef.isDirectory" class="node-size">
                {{ formatSize(dataRef.size) }}
              </span>
            </div>
          </template>
        </a-tree>
        <a-empty v-else description="压缩包为空" />
      </a-spin>
    </div>

    <!-- 操作按钮 -->
    <div class="action-bar">
      <a-button type="primary" :disabled="!selectedFile" @click="handlePreview">
        <EyeOutlined />
        预览选中文件
      </a-button>
      <a-button :disabled="!selectedFile" @click="handleExtract">
        <ExportOutlined />
        提取到...
      </a-button>
    </div>

    <!-- 错误提示 -->
    <a-alert
      v-if="error"
      :message="error"
      type="error"
      show-icon
      closable
      style="margin-top: 16px"
      @close="error = null"
    />
  </div>
</template>

<script setup>
import { logger } from "@/utils/logger";

import { ref, onMounted } from "vue";
import { message } from "ant-design-vue";
import {
  FileZipOutlined,
  FolderOutlined,
  FileOutlined,
  EyeOutlined,
  ExportOutlined,
} from "@ant-design/icons-vue";

const props = defineProps({
  file: {
    type: Object,
    required: true,
  },
  projectId: {
    type: String,
    default: "",
  },
});

// 状态
const loading = ref(false);
const error = ref(null);
const archiveInfo = ref(null);
const treeData = ref([]);
const selectedFile = ref(null);

/**
 * 加载压缩包内容
 */
const loadArchiveContents = async () => {
  loading.value = true;
  error.value = null;

  try {
    // 构建完整路径
    let fullPath = props.file.file_path;
    if (
      !fullPath.startsWith("/data/projects/") &&
      props.projectId &&
      !fullPath.includes(props.projectId)
    ) {
      fullPath = `/data/projects/${props.projectId}/${fullPath}`;
    }

    const resolvedPath = await window.electronAPI.project.resolvePath(fullPath);

    // 获取压缩包信息
    const infoResult = await window.electronAPI.archive.getInfo(resolvedPath);
    if (infoResult.success) {
      archiveInfo.value = infoResult.data;
    }

    // 获取文件列表
    const listResult = await window.electronAPI.archive.list(resolvedPath);
    if (listResult.success) {
      treeData.value = listResult.data;
    } else {
      throw new Error(listResult.error || "加载压缩包内容失败");
    }
  } catch (err) {
    logger.error("[Archive Preview] 加载失败:", err);
    error.value = err.message || "加载压缩包内容失败";
    message.error(error.value);
  } finally {
    loading.value = false;
  }
};

/**
 * 选中文件
 */
const handleSelect = (selectedKeys, { node }) => {
  if (!node.dataRef.isDirectory) {
    selectedFile.value = node.dataRef;
  } else {
    selectedFile.value = null;
  }
};

/**
 * 预览文件
 */
const handlePreview = async () => {
  if (!selectedFile.value) {
    return;
  }

  loading.value = true;

  try {
    let fullPath = props.file.file_path;
    if (
      !fullPath.startsWith("/data/projects/") &&
      props.projectId &&
      !fullPath.includes(props.projectId)
    ) {
      fullPath = `/data/projects/${props.projectId}/${fullPath}`;
    }

    const resolvedPath = await window.electronAPI.project.resolvePath(fullPath);

    // 提取文件到临时目录
    const result = await window.electronAPI.archive.extract(
      resolvedPath,
      selectedFile.value.path,
    );

    if (result.success) {
      // 在系统中打开提取的文件
      await window.electronAPI.shell.openPath(result.data.path);
      message.success("文件已提取并打开");
    } else {
      throw new Error(result.error || "提取文件失败");
    }
  } catch (err) {
    logger.error("[Archive Preview] 预览失败:", err);
    message.error(err.message || "预览文件失败");
  } finally {
    loading.value = false;
  }
};

/**
 * 提取文件
 */
const handleExtract = async () => {
  if (!selectedFile.value) {
    return;
  }

  try {
    // 显示保存对话框
    const dialogResult = await window.electronAPI.dialog.showSaveDialog({
      title: "提取到",
      defaultPath: selectedFile.value.title,
    });

    if (dialogResult.canceled || !dialogResult.filePath) {
      return;
    }

    loading.value = true;

    let fullPath = props.file.file_path;
    if (
      !fullPath.startsWith("/data/projects/") &&
      props.projectId &&
      !fullPath.includes(props.projectId)
    ) {
      fullPath = `/data/projects/${props.projectId}/${fullPath}`;
    }

    const resolvedPath = await window.electronAPI.project.resolvePath(fullPath);

    // 提取文件
    const result = await window.electronAPI.archive.extractTo(
      resolvedPath,
      selectedFile.value.path,
      dialogResult.filePath,
    );

    if (result.success) {
      message.success("文件已成功提取");
    } else {
      throw new Error(result.error || "提取文件失败");
    }
  } catch (err) {
    logger.error("[Archive Preview] 提取失败:", err);
    message.error(err.message || "提取文件失败");
  } finally {
    loading.value = false;
  }
};

/**
 * 格式化文件大小
 */
const formatSize = (bytes) => {
  if (!bytes || bytes === 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
};

/**
 * 获取文件图标颜色
 */
const getFileIconColor = (type) => {
  const colorMap = {
    document: "#1890ff",
    spreadsheet: "#52c41a",
    image: "#faad14",
    video: "#eb2f96",
    audio: "#722ed1",
    code: "#13c2c2",
    file: "#8c8c8c",
  };
  return colorMap[type] || "#8c8c8c";
};

onMounted(() => {
  loadArchiveContents();
});
</script>

<style scoped>
.archive-preview {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 16px;
  background: #fff;
}

/* 压缩包信息 */
.archive-info {
  margin-bottom: 16px;
  padding: 16px;
  background: #f5f5f5;
  border-radius: 4px;
}

.info-header {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.archive-icon {
  font-size: 32px;
  color: #1890ff;
}

.info-content h3 {
  margin: 0 0 8px 0;
  font-size: 16px;
  font-weight: 500;
  color: #262626;
}

.info-details {
  display: flex;
  align-items: center;
  gap: 16px;
  font-size: 13px;
  color: #595959;
}

/* 文件树 */
.file-tree-container {
  flex: 1;
  overflow: auto;
  border: 1px solid #d9d9d9;
  border-radius: 4px;
  padding: 8px;
  background: #fff;
}

.tree-node-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  padding-right: 8px;
}

.node-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.node-size {
  font-size: 12px;
  color: #8c8c8c;
  margin-left: 8px;
}

/* 操作按钮 */
.action-bar {
  margin-top: 16px;
  display: flex;
  gap: 8px;
}
</style>
