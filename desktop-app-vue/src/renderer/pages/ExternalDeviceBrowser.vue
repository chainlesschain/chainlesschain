<template>
  <div class="external-device-browser">
    <!-- 头部：设备选择和同步按钮 -->
    <div class="browser-header">
      <div class="header-left">
        <a-select
          v-model:value="selectedDeviceId"
          placeholder="选择设备"
          style="width: 250px"
          :loading="devicesLoading"
          @change="handleDeviceChange"
        >
          <a-select-option
            v-for="device in devices"
            :key="device.deviceId"
            :value="device.deviceId"
          >
            <mobile-outlined />
            {{ device.deviceName || device.deviceId }}
            <a-tag
              v-if="device.status === 'online'"
              color="success"
              style="margin-left: 8px"
            >
              在线
            </a-tag>
          </a-select-option>
        </a-select>

        <a-button
          type="primary"
          :loading="syncing"
          :disabled="!selectedDeviceId"
          style="margin-left: 12px"
          @click="syncDeviceIndex"
        >
          <sync-outlined />
          同步索引
        </a-button>

        <a-button
          :disabled="!selectedDeviceId"
          style="margin-left: 12px"
          @click="showCacheStats"
        >
          <database-outlined />
          缓存统计
        </a-button>
      </div>

      <div class="header-right">
        <a-input-search
          v-model:value="searchQuery"
          placeholder="搜索文件"
          style="width: 300px"
          @search="handleSearch"
        >
          <template #enterButton>
            <search-outlined />
          </template>
        </a-input-search>
      </div>
    </div>

    <!-- 文件分类过滤 -->
    <div class="category-filter">
      <a-radio-group
        v-model:value="selectedCategory"
        button-style="solid"
        @change="handleCategoryChange"
      >
        <a-radio-button value=""> 全部 </a-radio-button>
        <a-radio-button value="DOCUMENT">
          <file-text-outlined />
          文档
        </a-radio-button>
        <a-radio-button value="IMAGE">
          <picture-outlined />
          图片
        </a-radio-button>
        <a-radio-button value="VIDEO">
          <video-camera-outlined />
          视频
        </a-radio-button>
        <a-radio-button value="AUDIO">
          <sound-outlined />
          音频
        </a-radio-button>
        <a-radio-button value="CODE">
          <code-outlined />
          代码
        </a-radio-button>
      </a-radio-group>

      <div class="file-count">共 {{ pagination.total }} 个文件</div>
    </div>

    <!-- 文件列表表格（小于100个文件时使用普通表格） -->
    <a-table
      v-if="!shouldUseVirtualScroll"
      :columns="columns"
      :data-source="files"
      :loading="loading"
      :pagination="pagination"
      :row-key="(record) => record.id"
      class="files-table"
      @change="handleTableChange"
    >
      <!-- 文件名列 -->
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'displayName'">
          <div class="file-name">
            <component :is="getFileIcon(record.category)" />
            <span class="name">{{ record.display_name }}</span>
            <star-filled v-if="record.is_favorite" class="favorite-icon" />
          </div>
        </template>

        <!-- 大小列 -->
        <template v-else-if="column.key === 'fileSize'">
          {{ formatFileSize(record.file_size) }}
        </template>

        <!-- 类型列 -->
        <template v-else-if="column.key === 'category'">
          <a-tag :color="getCategoryColor(record.category)">
            {{ getCategoryLabel(record.category) }}
          </a-tag>
        </template>

        <!-- 修改时间列 -->
        <template v-else-if="column.key === 'lastModified'">
          {{ formatDate(record.last_modified) }}
        </template>

        <!-- 缓存状态列 -->
        <template v-else-if="column.key === 'isCached'">
          <a-tag :color="record.is_cached ? 'success' : 'default'">
            {{ record.is_cached ? "已缓存" : "未缓存" }}
          </a-tag>
        </template>

        <!-- 操作列 -->
        <template v-else-if="column.key === 'actions'">
          <a-space>
            <a-button
              v-if="!record.is_cached"
              type="link"
              size="small"
              @click="pullFile(record)"
            >
              <download-outlined />
              拉取
            </a-button>

            <a-button
              v-if="record.is_cached"
              type="link"
              size="small"
              @click="importToRAG(record)"
            >
              <rocket-outlined />
              导入RAG
            </a-button>

            <a-button
              v-if="record.is_cached"
              type="link"
              size="small"
              @click="showProjectSelector(record)"
            >
              <folder-add-outlined />
              导入项目
            </a-button>

            <a-dropdown>
              <a-button type="link" size="small">
                <more-outlined />
              </a-button>
              <template #overlay>
                <a-menu @click="({ key }) => handleMoreAction(key, record)">
                  <a-menu-item key="favorite">
                    <star-outlined />
                    {{ record.is_favorite ? "取消收藏" : "收藏" }}
                  </a-menu-item>
                  <a-menu-item key="info">
                    <info-circle-outlined />
                    查看详情
                  </a-menu-item>
                  <a-menu-item key="copyPath">
                    <copy-outlined />
                    复制路径
                  </a-menu-item>
                </a-menu>
              </template>
            </a-dropdown>
          </a-space>
        </template>
      </template>
    </a-table>

    <!-- 文件列表虚拟滚动表格（大于等于100个文件时使用） -->
    <div v-if="shouldUseVirtualScroll" class="virtual-table-container">
      <VirtualTable
        :columns="columns"
        :data-source="files"
        :row-key="(record) => record.id"
        :row-height="54"
        container-height="calc(100vh - 360px)"
        :loading="loading"
      >
        <!-- 文件名列 -->
        <template #cell-displayName="{ record }">
          <div class="file-name">
            <component :is="getFileIcon(record.category)" />
            <span class="name">{{ record.display_name }}</span>
            <star-filled v-if="record.is_favorite" class="favorite-icon" />
          </div>
        </template>

        <!-- 大小列 -->
        <template #cell-fileSize="{ record }">
          {{ formatFileSize(record.file_size) }}
        </template>

        <!-- 类型列 -->
        <template #cell-category="{ record }">
          <a-tag :color="getCategoryColor(record.category)">
            {{ getCategoryLabel(record.category) }}
          </a-tag>
        </template>

        <!-- 修改时间列 -->
        <template #cell-lastModified="{ record }">
          {{ formatDate(record.last_modified) }}
        </template>

        <!-- 缓存状态列 -->
        <template #cell-isCached="{ record }">
          <a-tag :color="record.is_cached ? 'success' : 'default'">
            {{ record.is_cached ? "已缓存" : "未缓存" }}
          </a-tag>
        </template>

        <!-- 操作列 -->
        <template #cell-actions="{ record }">
          <a-space>
            <a-button
              v-if="!record.is_cached"
              type="link"
              size="small"
              @click="pullFile(record)"
            >
              <download-outlined />
              拉取
            </a-button>

            <a-button
              v-if="record.is_cached"
              type="link"
              size="small"
              @click="importToRAG(record)"
            >
              <rocket-outlined />
              导入RAG
            </a-button>

            <a-button
              v-if="record.is_cached"
              type="link"
              size="small"
              @click="showProjectSelector(record)"
            >
              <folder-add-outlined />
              导入项目
            </a-button>

            <a-dropdown>
              <a-button type="link" size="small">
                <more-outlined />
              </a-button>
              <template #overlay>
                <a-menu @click="({ key }) => handleMoreAction(key, record)">
                  <a-menu-item key="favorite">
                    <star-outlined />
                    {{ record.is_favorite ? "取消收藏" : "收藏" }}
                  </a-menu-item>
                  <a-menu-item key="info">
                    <info-circle-outlined />
                    查看详情
                  </a-menu-item>
                  <a-menu-item key="copyPath">
                    <copy-outlined />
                    复制路径
                  </a-menu-item>
                </a-menu>
              </template>
            </a-dropdown>
          </a-space>
        </template>
      </VirtualTable>

      <!-- 虚拟滚动模式的分页控件 -->
      <div class="virtual-pagination">
        <a-pagination
          v-model:current="pagination.current"
          v-model:page-size="pagination.pageSize"
          :total="pagination.total"
          :show-size-changer="true"
          :show-quick-jumper="true"
          :page-size-options="['10', '20', '50', '100', '200']"
          show-total="(total) => `共 ${total} 个文件`"
          @change="handleTableChange"
        />
      </div>
    </div>

    <!-- 传输进度浮窗 -->
    <div v-if="activeTransfers.length > 0" class="transfer-progress">
      <a-card title="文件传输" size="small" :bordered="false">
        <div
          v-for="transfer in activeTransfers"
          :key="transfer.id"
          class="transfer-item"
        >
          <div class="transfer-info">
            <span class="file-name">{{ transfer.display_name }}</span>
            <span class="transfer-speed">
              {{ formatFileSize(transfer.bytes_transferred) }} /
              {{ formatFileSize(transfer.total_bytes) }}
            </span>
          </div>
          <a-progress
            :percent="transfer.progress"
            :status="transfer.status === 'failed' ? 'exception' : 'active'"
            size="small"
          />
          <a-button
            v-if="transfer.status === 'in_progress'"
            type="link"
            size="small"
            danger
            @click="cancelTransfer(transfer.id)"
          >
            取消
          </a-button>
        </div>
      </a-card>
    </div>

    <!-- 文件详情对话框 -->
    <a-modal
      v-model:open="fileDetailVisible"
      title="文件详情"
      :footer="null"
      width="600px"
    >
      <a-descriptions v-if="selectedFile" bordered :column="1">
        <a-descriptions-item label="文件名">
          {{ selectedFile.display_name }}
        </a-descriptions-item>
        <a-descriptions-item label="路径">
          {{ selectedFile.file_path }}
        </a-descriptions-item>
        <a-descriptions-item label="大小">
          {{ formatFileSize(selectedFile.file_size) }}
        </a-descriptions-item>
        <a-descriptions-item label="类型">
          {{ selectedFile.mime_type }}
        </a-descriptions-item>
        <a-descriptions-item label="分类">
          <a-tag :color="getCategoryColor(selectedFile.category)">
            {{ getCategoryLabel(selectedFile.category) }}
          </a-tag>
        </a-descriptions-item>
        <a-descriptions-item label="修改时间">
          {{ formatDate(selectedFile.last_modified) }}
        </a-descriptions-item>
        <a-descriptions-item label="索引时间">
          {{ formatDate(selectedFile.indexed_at) }}
        </a-descriptions-item>
        <a-descriptions-item label="缓存状态">
          <a-tag :color="selectedFile.is_cached ? 'success' : 'default'">
            {{ selectedFile.is_cached ? "已缓存" : "未缓存" }}
          </a-tag>
        </a-descriptions-item>
        <a-descriptions-item v-if="selectedFile.cache_path" label="缓存路径">
          {{ selectedFile.cache_path }}
        </a-descriptions-item>
        <a-descriptions-item label="校验和">
          {{ selectedFile.checksum || "未计算" }}
        </a-descriptions-item>
      </a-descriptions>
    </a-modal>

    <!-- 缓存统计对话框 -->
    <a-modal
      v-model:open="cacheStatsVisible"
      title="缓存统计"
      :footer="null"
      width="500px"
    >
      <a-spin :spinning="cacheStatsLoading">
        <a-descriptions v-if="cacheStats" bordered :column="1">
          <a-descriptions-item label="总文件数">
            {{ cacheStats.totalFiles }}
          </a-descriptions-item>
          <a-descriptions-item label="已缓存文件数">
            {{ cacheStats.cachedFiles }}
          </a-descriptions-item>
          <a-descriptions-item label="缓存大小">
            {{ formatFileSize(cacheStats.cacheSize) }}
          </a-descriptions-item>
          <a-descriptions-item label="缓存上限">
            {{ formatFileSize(cacheStats.maxCacheSize) }}
          </a-descriptions-item>
          <a-descriptions-item label="使用率">
            <a-progress
              :percent="Math.round(cacheStats.cacheUsagePercent)"
              :status="
                cacheStats.cacheUsagePercent > 90 ? 'exception' : 'normal'
              "
            />
          </a-descriptions-item>
        </a-descriptions>

        <a-button
          type="primary"
          danger
          block
          style="margin-top: 16px"
          @click="cleanupCache"
        >
          清理过期缓存
        </a-button>
      </a-spin>
    </a-modal>

    <!-- 项目选择对话框 -->
    <a-modal
      v-model:open="projectSelectorVisible"
      title="选择导入的项目"
      width="600px"
      @ok="confirmImportToProject"
      @cancel="projectSelectorVisible = false"
    >
      <a-spin :spinning="projectsLoading">
        <div
          v-if="projects.length === 0"
          style="text-align: center; padding: 40px"
        >
          <a-empty description="暂无项目">
            <a-button type="primary" @click="createNewProject">
              创建新项目
            </a-button>
          </a-empty>
        </div>

        <a-list v-else :data-source="projects" item-layout="horizontal">
          <template #renderItem="{ item }">
            <a-list-item>
              <template #actions>
                <a-radio
                  :checked="selectedProjectId === item.id"
                  @change="selectedProjectId = item.id"
                >
                  选择
                </a-radio>
              </template>
              <a-list-item-meta>
                <template #title>
                  <span>{{ item.name }}</span>
                  <a-tag
                    v-if="item.status"
                    :color="item.status === 'active' ? 'green' : 'default'"
                    style="margin-left: 8px"
                  >
                    {{ item.status === "active" ? "进行中" : "已完成" }}
                  </a-tag>
                </template>
                <template #description>
                  <div>{{ item.description || "暂无描述" }}</div>
                  <div style="font-size: 12px; color: #999; margin-top: 4px">
                    创建时间：{{ formatDate(item.created_at) }}
                  </div>
                </template>
              </a-list-item-meta>
            </a-list-item>
          </template>
        </a-list>
      </a-spin>

      <template #footer>
        <a-button @click="projectSelectorVisible = false"> 取消 </a-button>
        <a-button
          type="primary"
          :disabled="!selectedProjectId"
          :loading="importing"
          @click="confirmImportToProject"
        >
          确定导入
        </a-button>
      </template>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onUnmounted, computed } from "vue";
import { message, Modal } from "ant-design-vue";
import {
  MobileOutlined,
  SyncOutlined,
  DatabaseOutlined,
  SearchOutlined,
  FileTextOutlined,
  PictureOutlined,
  VideoCameraOutlined,
  SoundOutlined,
  CodeOutlined,
  DownloadOutlined,
  RocketOutlined,
  FolderAddOutlined,
  MoreOutlined,
  StarOutlined,
  StarFilled,
  InfoCircleOutlined,
  CopyOutlined,
} from "@ant-design/icons-vue";
import VirtualTable from "../components/VirtualTable.vue";

// 状态
const selectedDeviceId = ref("");
const devices = ref([]);
const devicesLoading = ref(false);
const syncing = ref(false);
const loading = ref(false);
const files = ref([]);
const selectedCategory = ref("");
const searchQuery = ref("");
const activeTransfers = ref([]);
const selectedFile = ref(null);
const fileDetailVisible = ref(false);
const cacheStatsVisible = ref(false);
const cacheStats = ref(null);
const cacheStatsLoading = ref(false);

// 项目选择相关状态
const projectSelectorVisible = ref(false);
const projects = ref([]);
const projectsLoading = ref(false);
const selectedProjectId = ref("");
const fileToImport = ref(null);
const importing = ref(false);

// 分页配置
const pagination = reactive({
  current: 1,
  pageSize: 20,
  total: 0,
  showSizeChanger: true,
  showQuickJumper: true,
  pageSizeOptions: ["10", "20", "50", "100"],
});

// 表格列配置
const columns = [
  {
    title: "文件名",
    key: "displayName",
    dataIndex: "display_name",
    width: "30%",
    ellipsis: true,
  },
  {
    title: "大小",
    key: "fileSize",
    dataIndex: "file_size",
    width: "12%",
  },
  {
    title: "类型",
    key: "category",
    dataIndex: "category",
    width: "10%",
  },
  {
    title: "修改时间",
    key: "lastModified",
    dataIndex: "last_modified",
    width: "15%",
  },
  {
    title: "缓存状态",
    key: "isCached",
    dataIndex: "is_cached",
    width: "10%",
  },
  {
    title: "操作",
    key: "actions",
    width: "15%",
  },
];

// 计算属性

// 虚拟滚动阈值（文件数量超过此值时启用虚拟滚动）
const VIRTUAL_SCROLL_THRESHOLD = 100;

// 是否应该使用虚拟滚动
const shouldUseVirtualScroll = computed(() => {
  return pagination.total >= VIRTUAL_SCROLL_THRESHOLD;
});

// 轮询定时器
let transferPollingTimer = null;

// 挂载时初始化
onMounted(async () => {
  await loadDevices();
  startTransferPolling();
});

// 卸载时清理
onUnmounted(() => {
  stopTransferPolling();
});

// 加载设备列表
async function loadDevices() {
  devicesLoading.value = true;
  try {
    const result = await window.ipcRenderer.invoke("external-file:get-devices");
    if (result.success) {
      devices.value = result.devices || [];
      // 如果只有一个设备，自动选择
      if (devices.value.length === 1) {
        selectedDeviceId.value = devices.value[0].deviceId;
        await loadFileList();
      }
    } else {
      message.error("获取设备列表失败：" + result.error);
    }
  } catch (error) {
    console.error("加载设备列表失败:", error);
    message.error("加载设备列表失败");
  } finally {
    devicesLoading.value = false;
  }
}

// 设备切换
async function handleDeviceChange() {
  pagination.current = 1;
  await loadFileList();
}

// 同步设备索引
async function syncDeviceIndex() {
  if (!selectedDeviceId.value) {
    message.warning("请先选择设备");
    return;
  }

  syncing.value = true;
  try {
    const result = await window.ipcRenderer.invoke(
      "external-file:request-sync",
      selectedDeviceId.value,
      { incremental: true },
    );

    if (result.success) {
      message.success(`同步完成！共同步 ${result.totalSynced} 个文件`);
      await loadFileList();
    } else {
      message.error("同步失败：" + result.error);
    }
  } catch (error) {
    console.error("同步索引失败:", error);
    message.error("同步索引失败");
  } finally {
    syncing.value = false;
  }
}

// 加载文件列表
async function loadFileList() {
  if (!selectedDeviceId.value) {
    files.value = [];
    pagination.total = 0;
    return;
  }

  loading.value = true;
  try {
    const filters = {
      limit: pagination.pageSize,
      offset: (pagination.current - 1) * pagination.pageSize,
    };

    if (selectedCategory.value) {
      filters.category = [selectedCategory.value];
    }

    if (searchQuery.value) {
      filters.search = searchQuery.value;
    }

    const result = await window.ipcRenderer.invoke(
      "external-file:get-file-list",
      selectedDeviceId.value,
      filters,
    );

    if (result.success) {
      files.value = result.files || [];
      pagination.total = result.total || 0;
    } else {
      message.error("获取文件列表失败：" + result.error);
    }
  } catch (error) {
    console.error("加载文件列表失败:", error);
    message.error("加载文件列表失败");
  } finally {
    loading.value = false;
  }
}

// 分类变更
function handleCategoryChange() {
  pagination.current = 1;
  loadFileList();
}

// 搜索
function handleSearch() {
  pagination.current = 1;
  loadFileList();
}

// 表格变更
function handleTableChange(pag) {
  pagination.current = pag.current;
  pagination.pageSize = pag.pageSize;
  loadFileList();
}

// 拉取文件
async function pullFile(file) {
  try {
    message.loading({ content: "正在拉取文件...", key: "pull", duration: 0 });

    const result = await window.ipcRenderer.invoke(
      "external-file:pull-file",
      file.id,
    );

    message.destroy("pull");

    if (result.success) {
      if (result.cached) {
        message.info("文件已在缓存中");
      } else {
        message.success("文件拉取完成");
      }
      await loadFileList();
    } else {
      message.error("文件拉取失败：" + result.error);
    }
  } catch (error) {
    message.destroy("pull");
    console.error("拉取文件失败:", error);
    message.error("拉取文件失败");
  }
}

// 导入到RAG
async function importToRAG(file) {
  try {
    message.loading({
      content: "正在导入到RAG...",
      key: "import",
      duration: 0,
    });

    const result = await window.ipcRenderer.invoke(
      "external-file:import-to-rag",
      file.id,
    );

    message.destroy("import");

    if (result.success) {
      message.success("导入成功！文件已加入知识库");
    } else {
      message.error("导入失败：" + result.error);
    }
  } catch (error) {
    message.destroy("import");
    console.error("导入RAG失败:", error);
    message.error("导入RAG失败");
  }
}

// 更多操作
async function handleMoreAction(key, file) {
  switch (key) {
    case "favorite":
      await toggleFavorite(file);
      break;
    case "info":
      showFileDetail(file);
      break;
    case "copyPath":
      copyFilePath(file);
      break;
  }
}

// 切换收藏
async function toggleFavorite(file) {
  try {
    const result = await window.ipcRenderer.invoke(
      "external-file:toggle-favorite",
      file.id,
    );

    if (result.success) {
      message.success(result.isFavorite ? "已收藏" : "已取消收藏");
      await loadFileList();
    } else {
      message.error("操作失败：" + result.error);
    }
  } catch (error) {
    console.error("切换收藏失败:", error);
    message.error("操作失败");
  }
}

// 显示文件详情
function showFileDetail(file) {
  selectedFile.value = file;
  fileDetailVisible.value = true;
}

// 复制文件路径
function copyFilePath(file) {
  navigator.clipboard.writeText(file.file_path || "");
  message.success("路径已复制");
}

// 显示缓存统计
async function showCacheStats() {
  cacheStatsVisible.value = true;
  cacheStatsLoading.value = true;

  try {
    const result = await window.ipcRenderer.invoke(
      "external-file:get-cache-stats",
    );

    if (result.success) {
      cacheStats.value = result.stats;
    } else {
      message.error("获取缓存统计失败：" + result.error);
    }
  } catch (error) {
    console.error("获取缓存统计失败:", error);
    message.error("获取缓存统计失败");
  } finally {
    cacheStatsLoading.value = false;
  }
}

// 清理缓存
async function cleanupCache() {
  Modal.confirm({
    title: "确认清理",
    content: "确定要清理过期缓存吗？",
    async onOk() {
      try {
        const result = await window.ipcRenderer.invoke(
          "external-file:cleanup-cache",
        );

        if (result.success) {
          message.success(`清理完成！清理了 ${result.cleanedCount} 个文件`);
          await showCacheStats();
          await loadFileList();
        } else {
          message.error("清理失败：" + result.error);
        }
      } catch (error) {
        console.error("清理缓存失败:", error);
        message.error("清理缓存失败");
      }
    },
  });
}

// 显示项目选择器
async function showProjectSelector(file) {
  fileToImport.value = file;
  projectSelectorVisible.value = true;
  await loadProjects();
}

// 加载项目列表
async function loadProjects() {
  projectsLoading.value = true;
  try {
    const result = await window.ipcRenderer.invoke(
      "external-file:get-projects",
    );

    if (result.success) {
      projects.value = result.projects || [];
      // 默认选择第一个项目
      if (projects.value.length > 0) {
        selectedProjectId.value = projects.value[0].id;
      }
    } else {
      message.error("获取项目列表失败：" + result.error);
    }
  } catch (error) {
    console.error("加载项目列表失败:", error);
    message.error("加载项目列表失败");
  } finally {
    projectsLoading.value = false;
  }
}

// 确认导入到项目
async function confirmImportToProject() {
  if (!selectedProjectId.value || !fileToImport.value) {
    message.warning("请选择项目");
    return;
  }

  importing.value = true;
  try {
    const result = await window.ipcRenderer.invoke(
      "external-file:import-to-project",
      fileToImport.value.id,
      selectedProjectId.value,
    );

    if (result.success) {
      message.success("文件已成功导入项目！");
      projectSelectorVisible.value = false;

      // 找到导入的项目名称
      const project = projects.value.find(
        (p) => p.id === selectedProjectId.value,
      );
      if (project) {
        message.info(`文件已导入到项目：${project.name}`);
      }

      // 重置状态
      selectedProjectId.value = "";
      fileToImport.value = null;
    } else {
      message.error("导入失败：" + result.error);
    }
  } catch (error) {
    console.error("导入项目失败:", error);
    message.error("导入项目失败");
  } finally {
    importing.value = false;
  }
}

// 创建新项目（跳转到项目创建页面）
function createNewProject() {
  projectSelectorVisible.value = false;
  // 导航到项目创建页面
  window.location.hash = "#/projects/new";
}

// 启动传输轮询
function startTransferPolling() {
  transferPollingTimer = setInterval(async () => {
    try {
      const result = await window.ipcRenderer.invoke(
        "external-file:get-active-transfers",
      );

      if (result.success) {
        activeTransfers.value = result.tasks || [];
      }
    } catch (error) {
      console.error("获取传输任务失败:", error);
    }
  }, 1000);
}

// 停止传输轮询
function stopTransferPolling() {
  if (transferPollingTimer) {
    clearInterval(transferPollingTimer);
    transferPollingTimer = null;
  }
}

// 取消传输
async function cancelTransfer(transferId) {
  try {
    const result = await window.ipcRenderer.invoke(
      "external-file:cancel-transfer",
      transferId,
    );

    if (result.success) {
      message.success("传输已取消");
    } else {
      message.error("取消失败：" + result.error);
    }
  } catch (error) {
    console.error("取消传输失败:", error);
    message.error("取消传输失败");
  }
}

// 工具函数

function getFileIcon(category) {
  const iconMap = {
    DOCUMENT: FileTextOutlined,
    IMAGE: PictureOutlined,
    VIDEO: VideoCameraOutlined,
    AUDIO: SoundOutlined,
    CODE: CodeOutlined,
  };
  return iconMap[category] || FileTextOutlined;
}

function getCategoryColor(category) {
  const colorMap = {
    DOCUMENT: "blue",
    IMAGE: "green",
    VIDEO: "purple",
    AUDIO: "orange",
    CODE: "cyan",
    OTHER: "default",
  };
  return colorMap[category] || "default";
}

function getCategoryLabel(category) {
  const labelMap = {
    DOCUMENT: "文档",
    IMAGE: "图片",
    VIDEO: "视频",
    AUDIO: "音频",
    CODE: "代码",
    OTHER: "其他",
  };
  return labelMap[category] || category;
}

function formatFileSize(bytes) {
  if (!bytes || bytes === 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return (bytes / Math.pow(k, i)).toFixed(2) + " " + units[i];
}

function formatDate(timestamp) {
  if (!timestamp) {
    return "-";
  }

  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  // 1小时内
  if (diff < 3600000) {
    const minutes = Math.floor(diff / 60000);
    return `${minutes}分钟前`;
  }

  // 1天内
  if (diff < 86400000) {
    const hours = Math.floor(diff / 3600000);
    return `${hours}小时前`;
  }

  // 7天内
  if (diff < 604800000) {
    const days = Math.floor(diff / 86400000);
    return `${days}天前`;
  }

  // 格式化为日期
  return date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
</script>

<style scoped>
.external-device-browser {
  padding: 24px;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.browser-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.header-left {
  display: flex;
  align-items: center;
}

.category-filter {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.file-count {
  color: #666;
  font-size: 14px;
}

.files-table {
  flex: 1;
  overflow: auto;
}

.file-name {
  display: flex;
  align-items: center;
  gap: 8px;
}

.file-name .name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.favorite-icon {
  color: #faad14;
}

.transfer-progress {
  position: fixed;
  bottom: 24px;
  right: 24px;
  width: 400px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  border-radius: 4px;
  z-index: 1000;
}

.transfer-item {
  padding: 12px 0;
  border-bottom: 1px solid #f0f0f0;
}

.transfer-item:last-child {
  border-bottom: none;
}

.transfer-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.transfer-info .file-name {
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.transfer-info .transfer-speed {
  color: #666;
  font-size: 12px;
}

/* 虚拟滚动表格容器 */
.virtual-table-container {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.virtual-pagination {
  padding: 16px;
  text-align: center;
  background-color: #fff;
  border-top: 1px solid #f0f0f0;
}
</style>
