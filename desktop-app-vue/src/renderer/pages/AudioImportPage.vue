<template>
  <div class="audio-import-page">
    <div class="page-header">
      <h2>音频文件导入与转录</h2>
      <p class="page-desc">支持将音频文件转录为文本并保存到知识库</p>
    </div>

    <a-tabs v-model:active-key="activeTab">
      <!-- 上传转录 -->
      <a-tab-pane key="upload" tab="上传转录">
        <div class="tab-content">
          <AudioFileUpload
            :auto-transcribe="true"
            :engine="selectedEngine"
            @insert="handleInsertText"
          />
        </div>
      </a-tab-pane>

      <!-- 转录历史 -->
      <a-tab-pane key="history" tab="转录历史">
        <div class="tab-content">
          <div class="history-header">
            <a-input-search
              v-model:value="searchQuery"
              placeholder="搜索转录内容..."
              style="width: 300px"
              @search="searchHistory"
            />
            <a-button @click="loadHistory"> <ReloadOutlined /> 刷新 </a-button>
          </div>

          <a-list
            :data-source="historyList"
            :loading="loading"
            :pagination="pagination"
            @change="handlePageChange"
          >
            <template #renderItem="{ item }">
              <a-list-item>
                <a-list-item-meta>
                  <template #title>
                    <SoundOutlined class="history-icon" />
                    转录记录 #{{ item.id.substring(0, 8) }}
                  </template>
                  <template #description>
                    <div class="history-meta">
                      <span>引擎: {{ getEngineName(item.engine) }}</span>
                      <span>时间: {{ formatDate(item.created_at) }}</span>
                      <span>字数: {{ item.text.length }}</span>
                      <span v-if="item.confidence">
                        置信度: {{ (item.confidence * 100).toFixed(0) }}%
                      </span>
                    </div>
                    <div class="history-text">
                      {{ truncateText(item.text, 150) }}
                    </div>
                  </template>
                </a-list-item-meta>
                <template #actions>
                  <a @click="viewHistoryDetail(item)">查看</a>
                  <a @click="copyText(item.text)">复制</a>
                  <a @click="generateSubtitleForHistory(item)">生成字幕</a>
                  <a-popconfirm
                    title="确定删除此记录？"
                    ok-text="确定"
                    cancel-text="取消"
                    @confirm="deleteHistory(item.id)"
                  >
                    <a style="color: #ff4d4f">删除</a>
                  </a-popconfirm>
                </template>
              </a-list-item>
            </template>
          </a-list>
        </div>
      </a-tab-pane>

      <!-- 音频文件库 -->
      <a-tab-pane key="library" tab="音频文件库">
        <div class="tab-content">
          <div class="library-header">
            <a-space>
              <a-input-search
                v-model:value="librarySearchQuery"
                placeholder="搜索音频文件..."
                style="width: 300px"
                @search="searchLibrary"
              />
              <a-button @click="loadLibrary">
                <ReloadOutlined /> 刷新
              </a-button>
            </a-space>
            <div class="library-stats">
              <a-statistic title="总文件数" :value="stats.totalFiles" />
              <a-statistic
                title="总时长"
                :value="formatDuration(stats.totalDuration)"
              />
              <a-statistic
                title="已转录"
                :value="stats.transcribedFiles"
                :suffix="`/ ${stats.totalFiles}`"
              />
            </div>
          </div>

          <a-table
            :columns="libraryColumns"
            :data-source="libraryList"
            :loading="libraryLoading"
            :pagination="libraryPagination"
            row-key="id"
            @change="handleLibraryPageChange"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'file_name'">
                <SoundOutlined class="table-icon" />
                {{ record.file_name }}
              </template>
              <template v-else-if="column.key === 'duration'">
                {{ formatDuration(record.duration) }}
              </template>
              <template v-else-if="column.key === 'file_size'">
                {{ formatFileSize(record.file_size) }}
              </template>
              <template v-else-if="column.key === 'transcription'">
                <a-tag v-if="record.transcription_text" color="green">
                  已转录
                </a-tag>
                <a-tag v-else color="default"> 未转录 </a-tag>
              </template>
              <template v-else-if="column.key === 'created_at'">
                {{ formatDate(record.created_at) }}
              </template>
              <template v-else-if="column.key === 'action'">
                <a-space>
                  <a
                    v-if="record.transcription_text"
                    @click="viewFileDetail(record)"
                    >查看</a
                  >
                  <a v-else @click="retranscribe(record)">转录</a>
                  <a-popconfirm
                    title="确定删除此文件？"
                    ok-text="确定"
                    cancel-text="取消"
                    @confirm="deleteAudioFile(record.id)"
                  >
                    <a style="color: #ff4d4f">删除</a>
                  </a-popconfirm>
                </a-space>
              </template>
            </template>
          </a-table>
        </div>
      </a-tab-pane>

      <!-- 设置 -->
      <a-tab-pane key="settings" tab="设置">
        <div class="tab-content settings-panel">
          <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }">
            <a-form-item label="识别引擎">
              <a-select v-model:value="selectedEngine" style="width: 300px">
                <a-select-option
                  v-for="engine in availableEngines"
                  :key="engine.type"
                  :value="engine.type"
                  :disabled="!engine.available"
                >
                  {{ engine.name }}
                  <span v-if="!engine.available" class="engine-hint"
                    >(不可用)</span
                  >
                </a-select-option>
              </a-select>
              <div class="form-hint">选择语音识别引擎</div>
            </a-form-item>

            <a-form-item label="自动保存到知识库">
              <a-switch v-model:checked="autoSaveToKnowledge" />
              <div class="form-hint">转录完成后自动保存为笔记</div>
            </a-form-item>

            <a-form-item label="Whisper API 密钥">
              <a-input-password
                v-model:value="apiKey"
                placeholder="输入 OpenAI API Key"
                style="width: 400px"
              />
              <div class="form-hint">
                用于 Whisper API 识别。<a
                  href="https://platform.openai.com/api-keys"
                  target="_blank"
                  >获取API密钥</a
                >
              </div>
            </a-form-item>

            <a-divider>高级功能</a-divider>

            <a-form-item label="音频增强">
              <a-switch v-model:checked="enableAudioEnhancement" />
              <div class="form-hint">转录前自动进行降噪、音量归一化等处理</div>
            </a-form-item>

            <a-form-item label="自动检测语言">
              <a-switch v-model:checked="autoDetectLanguage" />
              <div class="form-hint">自动识别音频语言（支持40+种语言）</div>
            </a-form-item>

            <a-form-item label="自动生成字幕">
              <a-switch v-model:checked="autoGenerateSubtitles" />
              <div class="form-hint">转录完成后自动生成字幕文件</div>
            </a-form-item>

            <a-form-item v-if="autoGenerateSubtitles" label="字幕格式">
              <a-radio-group v-model:value="subtitleFormat">
                <a-radio value="srt"> SRT (SubRip) </a-radio>
                <a-radio value="vtt"> VTT (WebVTT) </a-radio>
              </a-radio-group>
              <div class="form-hint">选择字幕文件格式</div>
            </a-form-item>

            <a-form-item :wrapper-col="{ offset: 6, span: 18 }">
              <a-button type="primary" @click="saveSettings">
                保存设置
              </a-button>
            </a-form-item>
          </a-form>
        </div>
      </a-tab-pane>
    </a-tabs>

    <!-- 详情模态框 -->
    <a-modal
      v-model:open="showDetailModal"
      title="转录详情"
      width="800px"
      :footer="null"
    >
      <div v-if="selectedDetail" class="detail-modal">
        <div class="detail-meta">
          <a-descriptions bordered :column="2">
            <a-descriptions-item label="引擎">
              {{ getEngineName(selectedDetail.engine) }}
            </a-descriptions-item>
            <a-descriptions-item label="时间">
              {{ formatDate(selectedDetail.created_at) }}
            </a-descriptions-item>
            <a-descriptions-item label="字数">
              {{ selectedDetail.text.length }}
            </a-descriptions-item>
            <a-descriptions-item label="置信度">
              {{
                selectedDetail.confidence
                  ? (selectedDetail.confidence * 100).toFixed(0) + "%"
                  : "N/A"
              }}
            </a-descriptions-item>
          </a-descriptions>
        </div>
        <a-divider />
        <div class="detail-text">
          {{ selectedDetail.text }}
        </div>
        <a-divider />
        <div class="detail-actions">
          <a-space>
            <a-button @click="copyText(selectedDetail.text)">
              <CopyOutlined /> 复制
            </a-button>
            <a-button
              type="primary"
              @click="handleInsertText(selectedDetail.text)"
            >
              <EditOutlined /> 插入编辑器
            </a-button>
          </a-space>
        </div>
      </div>
    </a-modal>
  </div>
</template>

<script setup>
import { logger } from "@/utils/logger";

import { ref, onMounted, computed } from "vue";
import { useRouter } from "vue-router";
import { message, Modal } from "ant-design-vue";
import {
  SoundOutlined,
  ReloadOutlined,
  CopyOutlined,
  EditOutlined,
} from "@ant-design/icons-vue";
import AudioFileUpload from "../components/speech/AudioFileUpload.vue";

const router = useRouter();

// 标签页
const activeTab = ref("upload");

// 转录历史
const historyList = ref([]);
const loading = ref(false);
const searchQuery = ref("");
const pagination = ref({
  current: 1,
  pageSize: 10,
  total: 0,
});

// 音频文件库
const libraryList = ref([]);
const libraryLoading = ref(false);
const librarySearchQuery = ref("");
const libraryPagination = ref({
  current: 1,
  pageSize: 10,
  total: 0,
});
const stats = ref({
  totalFiles: 0,
  totalDuration: 0,
  transcribedFiles: 0,
});

// 设置
const selectedEngine = ref("whisper-api");
const availableEngines = ref([]);
const autoSaveToKnowledge = ref(true);
const apiKey = ref("");

// Phase 3 新增设置
const enableAudioEnhancement = ref(false);
const autoDetectLanguage = ref(false);
const autoGenerateSubtitles = ref(false);
const subtitleFormat = ref("srt");

// 详情
const showDetailModal = ref(false);
const selectedDetail = ref(null);

// 表格列定义
const libraryColumns = [
  { title: "文件名", dataIndex: "file_name", key: "file_name" },
  { title: "时长", dataIndex: "duration", key: "duration", width: 100 },
  { title: "大小", dataIndex: "file_size", key: "file_size", width: 100 },
  {
    title: "转录状态",
    dataIndex: "transcription",
    key: "transcription",
    width: 100,
  },
  { title: "创建时间", dataIndex: "created_at", key: "created_at", width: 180 },
  { title: "操作", key: "action", width: 150 },
];

// 初始化
onMounted(async () => {
  await loadAvailableEngines();
  await loadHistory();
  await loadLibrary();
  await loadStats();
});

// 加载可用引擎
const loadAvailableEngines = async () => {
  try {
    availableEngines.value =
      await window.electronAPI.speech.getAvailableEngines();
  } catch (error) {
    logger.error("加载引擎列表失败:", error);
  }
};

// 加载转录历史
const loadHistory = async () => {
  loading.value = true;
  try {
    const offset = (pagination.value.current - 1) * pagination.value.pageSize;
    const list = await window.electronAPI.speech.getHistory(
      pagination.value.pageSize,
      offset,
    );
    historyList.value = list || [];
    pagination.value.total = list.length;
  } catch (error) {
    logger.error("加载历史失败:", error);
    message.error("加载历史失败");
  } finally {
    loading.value = false;
  }
};

// 搜索历史
const searchHistory = async () => {
  if (!searchQuery.value.trim()) {
    await loadHistory();
    return;
  }

  loading.value = true;
  try {
    const list = await window.electronAPI.speech.searchHistory(
      searchQuery.value,
      {
        limit: pagination.value.pageSize,
        offset: 0,
      },
    );
    historyList.value = list || [];
    pagination.value.current = 1;
    pagination.value.total = list.length;
  } catch (error) {
    logger.error("搜索失败:", error);
    message.error("搜索失败");
  } finally {
    loading.value = false;
  }
};

// 加载音频文件库
const loadLibrary = async () => {
  libraryLoading.value = true;
  try {
    const offset =
      (libraryPagination.value.current - 1) * libraryPagination.value.pageSize;
    const list = await window.electronAPI.speech.listAudioFiles({
      limit: libraryPagination.value.pageSize,
      offset: offset,
    });
    libraryList.value = list || [];
    libraryPagination.value.total = list.length;
  } catch (error) {
    logger.error("加载文件库失败:", error);
    message.error("加载文件库失败");
  } finally {
    libraryLoading.value = false;
  }
};

// 搜索文件库
const searchLibrary = async () => {
  if (!librarySearchQuery.value.trim()) {
    await loadLibrary();
    return;
  }

  libraryLoading.value = true;
  try {
    const list = await window.electronAPI.speech.searchAudioFiles(
      librarySearchQuery.value,
    );
    libraryList.value = list || [];
  } catch (error) {
    logger.error("搜索失败:", error);
    message.error("搜索失败");
  } finally {
    libraryLoading.value = false;
  }
};

// 加载统计信息
const loadStats = async () => {
  try {
    stats.value = await window.electronAPI.speech.getStats();
  } catch (error) {
    logger.error("加载统计失败:", error);
  }
};

// 删除历史记录
const deleteHistory = async (id) => {
  try {
    await window.electronAPI.speech.deleteHistory(id);
    message.success("删除成功");
    await loadHistory();
  } catch (error) {
    logger.error("删除失败:", error);
    message.error("删除失败");
  }
};

// 删除音频文件
const deleteAudioFile = async (id) => {
  try {
    await window.electronAPI.speech.deleteAudioFile(id);
    message.success("删除成功");
    await loadLibrary();
    await loadStats();
  } catch (error) {
    logger.error("删除失败:", error);
    message.error("删除失败");
  }
};

// 查看详情
const viewHistoryDetail = (item) => {
  selectedDetail.value = item;
  showDetailModal.value = true;
};

const viewFileDetail = (file) => {
  selectedDetail.value = {
    text: file.transcription_text,
    engine: file.transcription_engine,
    confidence: file.transcription_confidence,
    created_at: file.created_at,
  };
  showDetailModal.value = true;
};

// 重新转录
const retranscribe = async (file) => {
  message.info("重新转录功能开发中");
};

// 生成字幕（从转录历史）
const generateSubtitleForHistory = async (item) => {
  try {
    if (!item.audio_file_id) {
      message.warning("该记录没有关联的音频文件，无法生成字幕");
      return;
    }

    // 选择保存位置
    const result = await window.electronAPI.dialog.showSaveDialog({
      title: "保存字幕文件",
      defaultPath: `subtitle_${item.id.substring(0, 8)}.${subtitleFormat.value}`,
      filters: [
        { name: "字幕文件", extensions: [subtitleFormat.value] },
        { name: "所有文件", extensions: ["*"] },
      ],
    });

    if (result.canceled || !result.filePath) {
      return;
    }

    message.loading({
      content: "正在生成字幕...",
      key: "subtitle",
      duration: 0,
    });

    await window.electronAPI.speech.generateSubtitle(
      item.audio_file_id,
      result.filePath,
      subtitleFormat.value,
    );

    message.success({ content: "字幕生成成功！", key: "subtitle" });
  } catch (error) {
    logger.error("生成字幕失败:", error);
    message.error({
      content: `生成字幕失败: ${error.message}`,
      key: "subtitle",
    });
  }
};

// 复制文本
const copyText = (text) => {
  navigator.clipboard
    .writeText(text)
    .then(() => {
      message.success("已复制到剪贴板");
    })
    .catch(() => {
      message.error("复制失败");
    });
};

// 插入文本
const handleInsertText = (text) => {
  Modal.confirm({
    title: "选择目标位置",
    content: "请选择要插入文本的位置：",
    okText: "插入到 AI 对话",
    cancelText: "保存到知识库",
    onOk: () => {
      // 保存到 localStorage 供 AI 对话页面使用
      localStorage.setItem(
        "pendingInsertText",
        JSON.stringify({
          text,
          source: "audio-transcription",
          timestamp: Date.now(),
        }),
      );
      router.push("/ai/chat");
      message.success("已跳转到 AI 对话页面");
    },
    onCancel: () => {
      // 保存到知识库 - 使用 IPC 调用
      saveToKnowledge(text);
    },
  });
};

// 保存到知识库
const saveToKnowledge = async (text) => {
  try {
    const result = await window.electron.ipcRenderer.invoke(
      "knowledge:create",
      {
        title: `转录文本 ${new Date().toLocaleString()}`,
        content: text,
        type: "note",
        tags: ["音频转录"],
      },
    );
    if (result.success) {
      message.success("已保存到知识库");
    } else {
      message.error("保存失败: " + (result.error || "未知错误"));
    }
  } catch (error) {
    logger.error("保存到知识库失败:", error);
    message.error("保存失败: " + error.message);
  }
};

// 保存设置
const saveSettings = async () => {
  try {
    await window.electronAPI.speech.updateConfig({
      defaultEngine: selectedEngine.value,
      knowledgeIntegration: {
        autoSaveToKnowledge: autoSaveToKnowledge.value,
      },
      whisperAPI: {
        apiKey: apiKey.value,
      },
    });
    message.success("设置已保存");
  } catch (error) {
    logger.error("保存设置失败:", error);
    message.error("保存设置失败");
  }
};

// 分页处理
const handlePageChange = (page) => {
  pagination.value.current = page;
  loadHistory();
};

const handleLibraryPageChange = (page) => {
  libraryPagination.value.current = page.current;
  loadLibrary();
};

// 工具函数
const formatDuration = (seconds) => {
  if (!seconds) {
    return "0:00";
  }
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

const formatFileSize = (bytes) => {
  if (!bytes) {
    return "0 B";
  }
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(1)} KB`;
  }
  return `${(kb / 1024).toFixed(1)} MB`;
};

const formatDate = (dateStr) => {
  if (!dateStr) {
    return "";
  }
  const date = new Date(dateStr);
  return date.toLocaleString("zh-CN");
};

const truncateText = (text, maxLength) => {
  if (!text) {
    return "";
  }
  return text.length > maxLength ? text.substring(0, maxLength) + "..." : text;
};

const getEngineName = (engine) => {
  const names = {
    "whisper-api": "Whisper API",
    "whisper-local": "Whisper Local",
    webspeech: "Web Speech",
  };
  return names[engine] || engine;
};
</script>

<style scoped lang="scss">
.audio-import-page {
  padding: 24px;
  max-width: 1400px;
  margin: 0 auto;
}

.page-header {
  margin-bottom: 24px;

  h2 {
    margin: 0 0 8px 0;
    font-size: 24px;
    font-weight: 600;
  }

  .page-desc {
    margin: 0;
    color: #666;
    font-size: 14px;
  }
}

.tab-content {
  padding: 24px 0;
}

.history-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 24px;
}

.history-icon {
  margin-right: 8px;
  color: #1890ff;
}

.history-meta {
  display: flex;
  gap: 16px;
  font-size: 12px;
  color: #999;
  margin-bottom: 8px;
}

.history-text {
  color: #666;
  line-height: 1.6;
  margin-top: 8px;
}

.library-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;

  .library-stats {
    display: flex;
    gap: 32px;
  }
}

.table-icon {
  margin-right: 8px;
  color: #1890ff;
}

.settings-panel {
  max-width: 800px;
  margin: 0 auto;
}

.form-hint {
  font-size: 12px;
  color: #999;
  margin-top: 4px;
}

.engine-hint {
  color: #999;
  margin-left: 8px;
}

.detail-modal {
  .detail-meta {
    margin-bottom: 16px;
  }

  .detail-text {
    max-height: 400px;
    overflow-y: auto;
    line-height: 1.8;
    white-space: pre-wrap;
    word-wrap: break-word;
    padding: 16px;
    background: #f5f5f5;
    border-radius: 4px;
  }

  .detail-actions {
    text-align: right;
  }
}
</style>
