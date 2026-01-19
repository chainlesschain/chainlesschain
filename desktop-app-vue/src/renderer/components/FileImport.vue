<template>
  <div class="file-import">
    <a-card
      title="文件导入"
      :loading="loading"
    >
      <template #extra>
        <a-space>
          <a-button
            type="primary"
            :loading="importing"
            @click="handleSelectFiles"
          >
            <template #icon>
              <upload-outlined />
            </template>
            选择文件
          </a-button>
        </a-space>
      </template>

      <!-- 导入进度 -->
      <div
        v-if="importing"
        class="import-progress"
      >
        <a-progress
          :percent="progressPercent"
          :status="progressStatus"
          :stroke-color="progressColor"
        />
        <p class="progress-text">
          {{ progressText }}
        </p>
      </div>

      <!-- 支持的格式说明 -->
      <a-alert
        v-if="!importing && importResults.length === 0"
        message="支持的文件格式"
        type="info"
        show-icon
        style="margin-bottom: 20px"
      >
        <template #description>
          <ul class="format-list">
            <li><strong>Markdown</strong>: .md, .markdown</li>
            <li><strong>PDF</strong>: .pdf (需要安装 pdf-parse 库)</li>
            <li><strong>Word</strong>: .doc, .docx (需要安装 mammoth 库)</li>
            <li><strong>纯文本</strong>: .txt</li>
          </ul>
          <a-divider />
          <p style="margin-top: 12px; color: #666;">
            提示: PDF 和 Word 导入需要额外的依赖库。如果导入失败，请在项目根目录运行:
          </p>
          <pre style="background: #f5f5f5; padding: 8px; border-radius: 4px; margin-top: 8px;">
npm install pdf-parse mammoth</pre>
        </template>
      </a-alert>

      <!-- 导入选项 -->
      <a-collapse
        v-if="!importing"
        style="margin-bottom: 20px"
      >
        <a-collapse-panel
          key="1"
          header="导入选项"
        >
          <a-form
            :label-col="{ span: 6 }"
            :wrapper-col="{ span: 18 }"
          >
            <a-form-item label="知识类型">
              <a-select
                v-model:value="importOptions.type"
                placeholder="选择知识类型"
              >
                <a-select-option value="note">
                  笔记
                </a-select-option>
                <a-select-option value="article">
                  文章
                </a-select-option>
                <a-select-option value="document">
                  文档
                </a-select-option>
                <a-select-option value="reference">
                  参考资料
                </a-select-option>
                <a-select-option value="code">
                  代码片段
                </a-select-option>
                <a-select-option value="idea">
                  灵感
                </a-select-option>
              </a-select>
            </a-form-item>

            <a-form-item label="标签">
              <a-select
                v-model:value="importOptions.tags"
                mode="tags"
                placeholder="添加标签 (可选)"
                style="width: 100%"
              >
                <a-select-option
                  v-for="tag in availableTags"
                  :key="tag.id"
                  :value="tag.name"
                >
                  {{ tag.name }}
                </a-select-option>
              </a-select>
            </a-form-item>

            <a-form-item label="自动索引">
              <a-switch v-model:checked="importOptions.autoIndex" />
              <span style="margin-left: 8px; color: #999; font-size: 12px;">
                导入后自动添加到 RAG 向量索引
              </span>
            </a-form-item>
          </a-form>
        </a-collapse-panel>
      </a-collapse>

      <!-- 导入结果 -->
      <div
        v-if="importResults.length > 0"
        class="import-results"
      >
        <a-divider>导入结果</a-divider>

        <a-row :gutter="16">
          <a-col :span="8">
            <a-statistic
              title="成功"
              :value="successCount"
              :value-style="{ color: '#3f8600' }"
            >
              <template #suffix>
                / {{ totalCount }}
              </template>
            </a-statistic>
          </a-col>
          <a-col :span="8">
            <a-statistic
              title="失败"
              :value="failedCount"
              :value-style="{ color: '#cf1322' }"
            >
              <template #suffix>
                / {{ totalCount }}
              </template>
            </a-statistic>
          </a-col>
          <a-col :span="8">
            <a-statistic
              title="总计"
              :value="totalCount"
            />
          </a-col>
        </a-row>

        <a-list
          style="margin-top: 20px"
          :data-source="importResults"
          :pagination="{ pageSize: 5 }"
        >
          <template #renderItem="{ item }">
            <a-list-item>
              <a-list-item-meta>
                <template #title>
                  <span>{{ getFileName(item.filePath) }}</span>
                  <a-tag
                    :color="item.status === 'success' ? 'success' : 'error'"
                    style="margin-left: 8px"
                  >
                    {{ item.status === 'success' ? '成功' : '失败' }}
                  </a-tag>
                </template>
                <template #description>
                  <div v-if="item.status === 'success'">
                    <span>ID: {{ item.result.id }}</span>
                    <a-divider type="vertical" />
                    <span>标题: {{ item.result.title }}</span>
                    <a-divider type="vertical" />
                    <span>类型: {{ item.result.type }}</span>
                  </div>
                  <div
                    v-else
                    style="color: #cf1322"
                  >
                    {{ item.error }}
                  </div>
                </template>
              </a-list-item-meta>
            </a-list-item>
          </template>
        </a-list>

        <div style="margin-top: 20px; text-align: center">
          <a-button @click="handleReset">
            重新导入
          </a-button>
        </div>
      </div>

      <!-- 拖拽区域 -->
      <div
        v-if="!importing && importResults.length === 0"
        class="drop-zone"
        :class="{ 'drop-zone-active': isDragging }"
        @drop="handleDrop"
        @dragover="handleDragOver"
        @dragleave="handleDragLeave"
      >
        <p class="drop-zone-icon">
          <cloud-upload-outlined />
        </p>
        <p class="drop-zone-text">
          拖拽文件到此处
        </p>
        <p class="drop-zone-hint">
          或点击上方"选择文件"按钮
        </p>
      </div>
    </a-card>
  </div>
</template>

<script setup>
import { logger, createLogger } from '@/utils/logger';

import { ref, reactive, computed, onMounted, onUnmounted } from 'vue';
import { message } from 'ant-design-vue';
import {
  UploadOutlined,
  CloudUploadOutlined,
} from '@ant-design/icons-vue';

const loading = ref(false);
const importing = ref(false);
const isDragging = ref(false);
const availableTags = ref([]);
const importResults = ref([]);

// 导入选项
const importOptions = reactive({
  type: 'note',
  tags: [],
  autoIndex: true,
});

// 进度跟踪
const importProgress = reactive({
  current: 0,
  total: 0,
  currentFile: '',
});

// 计算属性
const progressPercent = computed(() => {
  if (importProgress.total === 0) {return 0;}
  return Math.round((importProgress.current / importProgress.total) * 100);
});

const progressStatus = computed(() => {
  if (importProgress.current < importProgress.total) {return 'active';}
  return 'success';
});

const progressColor = computed(() => {
  if (failedCount.value > 0) {return '#ff4d4f';}
  return '#52c41a';
});

const progressText = computed(() => {
  return `正在导入: ${importProgress.current} / ${importProgress.total} - ${importProgress.currentFile}`;
});

const successCount = computed(() => {
  return importResults.value.filter(r => r.status === 'success').length;
});

const failedCount = computed(() => {
  return importResults.value.filter(r => r.status === 'failed').length;
});

const totalCount = computed(() => {
  return importResults.value.length;
});

// 加载可用标签
async function loadTags() {
  try {
    const tags = await window.electronAPI.db.getAllTags();
    availableTags.value = tags;
  } catch (error) {
    logger.error('加载标签失败:', error);
  }
}

// 选择文件
async function handleSelectFiles() {
  try {
    const result = await window.electronAPI.import.selectFiles();

    if (result.canceled) {
      return;
    }

    await importFiles(result.filePaths);
  } catch (error) {
    message.error('选择文件失败: ' + error.message);
  }
}

// 导入文件
async function importFiles(filePaths) {
  if (!filePaths || filePaths.length === 0) {
    return;
  }

  importing.value = true;
  importResults.value = [];
  importProgress.current = 0;
  importProgress.total = filePaths.length;
  importProgress.currentFile = '';

  try {
    const options = {
      type: importOptions.type,
      tags: importOptions.tags,
    };

    if (filePaths.length === 1) {
      // 单文件导入
      const filePath = filePaths[0];
      importProgress.currentFile = getFileName(filePath);

      try {
        const result = await window.electronAPI.import.importFile(filePath, options);
        importResults.value.push({
          filePath,
          status: 'success',
          result,
        });
        message.success(`文件导入成功: ${result.title}`);
      } catch (error) {
        importResults.value.push({
          filePath,
          status: 'failed',
          error: error.message,
        });
        message.error(`文件导入失败: ${error.message}`);
      }

      importProgress.current = 1;
    } else {
      // 批量导入
      const results = await window.electronAPI.import.importFiles(filePaths, options);

      // 转换结果格式
      results.success.forEach(item => {
        importResults.value.push({
          filePath: item.filePath,
          status: 'success',
          result: item.result,
        });
      });

      results.failed.forEach(item => {
        importResults.value.push({
          filePath: item.filePath,
          status: 'failed',
          error: item.error,
        });
      });

      if (results.failed.length > 0) {
        message.warning(`导入完成: ${results.success.length} 成功, ${results.failed.length} 失败`);
      } else {
        message.success(`成功导入 ${results.success.length} 个文件`);
      }
    }
  } catch (error) {
    message.error('导入失败: ' + error.message);
  } finally {
    importing.value = false;
  }
}

// 拖拽处理
function handleDrop(e) {
  e.preventDefault();
  isDragging.value = false;

  const files = Array.from(e.dataTransfer.files);
  const filePaths = files.map(f => f.path);

  importFiles(filePaths);
}

function handleDragOver(e) {
  e.preventDefault();
  isDragging.value = true;
}

function handleDragLeave(e) {
  e.preventDefault();
  isDragging.value = false;
}

// 重置
function handleReset() {
  importResults.value = [];
  importProgress.current = 0;
  importProgress.total = 0;
  importProgress.currentFile = '';
}

// 获取文件名
function getFileName(filePath) {
  return filePath.split(/[\\/]/).pop();
}

// 事件监听
function setupEventListeners() {
  window.electronAPI.import.on('import:progress', (data) => {
    importProgress.current = data.current;
    importProgress.total = data.total;
    importProgress.currentFile = getFileName(data.filePath);
  });
}

function cleanupEventListeners() {
  window.electronAPI.import.off('import:progress');
}

onMounted(() => {
  loadTags();
  setupEventListeners();
});

onUnmounted(() => {
  cleanupEventListeners();
});
</script>

<style scoped>
.file-import {
  padding: 20px;
}

.format-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.format-list li {
  padding: 4px 0;
}

.import-progress {
  margin-bottom: 24px;
}

.progress-text {
  margin-top: 8px;
  color: #666;
  font-size: 14px;
}

.import-results {
  margin-top: 20px;
}

.drop-zone {
  border: 2px dashed #d9d9d9;
  border-radius: 8px;
  padding: 60px 20px;
  text-align: center;
  background: #fafafa;
  transition: all 0.3s;
  cursor: pointer;
}

.drop-zone:hover {
  border-color: #1890ff;
  background: #f0f7ff;
}

.drop-zone-active {
  border-color: #52c41a;
  background: #f6ffed;
}

.drop-zone-icon {
  font-size: 48px;
  color: #d9d9d9;
  margin-bottom: 16px;
}

.drop-zone-active .drop-zone-icon {
  color: #52c41a;
}

.drop-zone-text {
  font-size: 16px;
  color: #666;
  margin-bottom: 8px;
}

.drop-zone-hint {
  font-size: 14px;
  color: #999;
}
</style>
