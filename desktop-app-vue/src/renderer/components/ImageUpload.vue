<template>
  <div class="image-upload-container">
    <a-card title="图片上传与 OCR 识别" :bordered="false">
      <!-- 上传选项 -->
      <a-space direction="vertical" style="width: 100%" :size="16">
        <!-- 拖拽上传区域 -->
        <a-upload-dragger
          :before-upload="handleBeforeUpload"
          :show-upload-list="false"
          accept="image/*"
          multiple
        >
          <p class="ant-upload-drag-icon">
            <camera-outlined :style="{ fontSize: '48px', color: '#1890ff' }" />
          </p>
          <p class="ant-upload-text">点击或拖拽图片到此区域上传</p>
          <p class="ant-upload-hint">
            支持单张或批量上传。支持 JPG、PNG、GIF、BMP、WebP 格式
          </p>
        </a-upload-dragger>

        <!-- 或者使用文件选择 -->
        <div style="text-align: center">
          <a-button type="primary" @click="handleSelectFiles" :loading="uploading">
            <file-image-outlined /> 选择图片文件
          </a-button>
        </div>

        <!-- 上传选项配置 -->
        <a-card title="上传选项" size="small" :bordered="true">
          <a-form layout="vertical">
            <a-row :gutter="16">
              <a-col :span="12">
                <a-form-item label="知识库类型">
                  <a-select v-model:value="uploadOptions.type" style="width: 100%">
                    <a-select-option value="note">笔记</a-select-option>
                    <a-select-option value="article">文章</a-select-option>
                    <a-select-option value="document">文档</a-select-option>
                    <a-select-option value="book">书籍</a-select-option>
                    <a-select-option value="code">代码</a-select-option>
                  </a-select>
                </a-form-item>
              </a-col>

              <a-col :span="12">
                <a-form-item label="标签（可选）">
                  <a-select
                    v-model:value="uploadOptions.tags"
                    mode="tags"
                    style="width: 100%"
                    placeholder="输入标签并按回车"
                    :token-separators="[',']"
                  />
                </a-form-item>
              </a-col>
            </a-row>

            <a-row :gutter="16">
              <a-col :span="8">
                <a-form-item>
                  <a-checkbox v-model:checked="uploadOptions.compress">
                    自动压缩
                  </a-checkbox>
                </a-form-item>
              </a-col>

              <a-col :span="8">
                <a-form-item>
                  <a-checkbox v-model:checked="uploadOptions.performOCR">
                    OCR 识别
                  </a-checkbox>
                </a-form-item>
              </a-col>

              <a-col :span="8">
                <a-form-item>
                  <a-checkbox v-model:checked="uploadOptions.addToIndex">
                    自动索引
                  </a-checkbox>
                </a-form-item>
              </a-col>
            </a-row>
          </a-form>
        </a-card>

        <!-- 上传进度 -->
        <a-card v-if="uploading" title="上传进度" size="small" :bordered="true">
          <a-progress
            :percent="uploadProgress.percentage"
            :status="uploadProgress.status"
          >
            <template #format="percent">
              {{ uploadProgress.current }} / {{ uploadProgress.total }} ({{ percent }}%)
            </template>
          </a-progress>

          <div v-if="currentUploading" style="margin-top: 12px">
            <a-spin :spinning="true" size="small" />
            <span style="margin-left: 8px">
              正在处理: {{ currentUploading }}
            </span>
          </div>

          <!-- OCR 进度 -->
          <div v-if="ocrProgress.active" style="margin-top: 12px">
            <a-progress
              :percent="Math.round(ocrProgress.progress * 100)"
              size="small"
              status="active"
            >
              <template #format="percent">
                OCR 识别中: {{ percent }}%
              </template>
            </a-progress>
          </div>
        </a-card>

        <!-- 上传结果 -->
        <a-card v-if="uploadResults.length > 0" title="上传结果" size="small" :bordered="true">
          <!-- 统计信息 -->
          <a-statistic-group>
            <a-row :gutter="16">
              <a-col :span="8">
                <a-statistic
                  title="总数"
                  :value="uploadResults.length"
                  :value-style="{ color: '#1890ff' }"
                >
                  <template #prefix>
                    <file-image-outlined />
                  </template>
                </a-statistic>
              </a-col>
              <a-col :span="8">
                <a-statistic
                  title="成功"
                  :value="successCount"
                  :value-style="{ color: '#52c41a' }"
                >
                  <template #prefix>
                    <check-circle-outlined />
                  </template>
                </a-statistic>
              </a-col>
              <a-col :span="8">
                <a-statistic
                  title="失败"
                  :value="failureCount"
                  :value-style="{ color: '#f5222d' }"
                >
                  <template #prefix>
                    <close-circle-outlined />
                  </template>
                </a-statistic>
              </a-col>
            </a-row>
          </a-statistic-group>

          <!-- 结果列表 -->
          <a-divider />
          <a-collapse :bordered="false">
            <a-collapse-panel
              v-for="(result, index) in uploadResults"
              :key="index"
              :header="getResultHeader(result, index)"
            >
              <div v-if="result.success">
                <!-- 成功结果 -->
                <a-descriptions :column="2" size="small" bordered>
                  <a-descriptions-item label="文件名">
                    {{ result.filename }}
                  </a-descriptions-item>
                  <a-descriptions-item label="文件大小">
                    {{ formatFileSize(result.size) }}
                  </a-descriptions-item>
                  <a-descriptions-item label="压缩率">
                    {{ result.compressionRatio }}%
                  </a-descriptions-item>
                  <a-descriptions-item label="OCR 置信度">
                    <a-tag v-if="result.ocrConfidence" :color="getConfidenceColor(result.ocrConfidence)">
                      {{ result.ocrConfidence.toFixed(2) }}%
                    </a-tag>
                    <span v-else>-</span>
                  </a-descriptions-item>
                </a-descriptions>

                <!-- OCR 识别文本 -->
                <a-card
                  v-if="result.ocrText"
                  title="识别文本"
                  size="small"
                  :bordered="false"
                  style="margin-top: 12px"
                >
                  <div style="max-height: 200px; overflow-y: auto; white-space: pre-wrap">
                    {{ result.ocrText }}
                  </div>

                  <!-- OCR 质量评估 -->
                  <a-divider style="margin: 12px 0" />
                  <div v-if="result.ocrQuality">
                    <a-tag :color="getQualityColor(result.ocrQuality.quality)">
                      {{ getQualityLabel(result.ocrQuality.quality) }}
                    </a-tag>
                    <span style="margin-left: 8px; color: #666">
                      {{ result.ocrQuality.recommendation }}
                    </span>
                  </div>
                </a-card>

                <!-- 操作按钮 -->
                <div style="margin-top: 12px">
                  <a-space>
                    <a-button size="small" @click="viewImage(result.imageId)">
                      <eye-outlined /> 查看图片
                    </a-button>
                    <a-button size="small" @click="copyOCRText(result.ocrText)">
                      <copy-outlined /> 复制文本
                    </a-button>
                    <a-button
                      size="small"
                      danger
                      @click="deleteImage(result.imageId)"
                    >
                      <delete-outlined /> 删除
                    </a-button>
                  </a-space>
                </div>
              </div>

              <div v-else>
                <!-- 失败结果 -->
                <a-alert
                  :message="result.error"
                  type="error"
                  show-icon
                />
              </div>
            </a-collapse-panel>
          </a-collapse>

          <!-- 清除结果 -->
          <div style="margin-top: 16px; text-align: center">
            <a-button @click="clearResults">
              <clear-outlined /> 清除结果
            </a-button>
          </div>
        </a-card>

        <!-- 图片列表 -->
        <a-card title="已上传图片" size="small" :bordered="true">
          <template #extra>
            <a-space>
              <a-input-search
                v-model:value="searchQuery"
                placeholder="搜索图片 (OCR文本)"
                style="width: 200px"
                @search="handleSearch"
              >
                <template #enterButton>
                  <a-button>
                    <search-outlined />
                  </a-button>
                </template>
              </a-input-search>
              <a-button @click="loadImages">
                <reload-outlined /> 刷新
              </a-button>
            </a-space>
          </template>

          <!-- 统计信息 -->
          <a-row :gutter="16" style="margin-bottom: 16px">
            <a-col :span="8">
              <a-statistic
                title="图片总数"
                :value="imageStats.totalImages"
                :value-style="{ fontSize: '18px' }"
              />
            </a-col>
            <a-col :span="8">
              <a-statistic
                title="总大小"
                :value="formatFileSize(imageStats.totalSize)"
                :value-style="{ fontSize: '18px' }"
              />
            </a-col>
            <a-col :span="8">
              <a-statistic
                title="平均 OCR 置信度"
                :value="imageStats.averageOcrConfidence"
                :precision="2"
                suffix="%"
                :value-style="{ fontSize: '18px' }"
              />
            </a-col>
          </a-row>

          <!-- 图片网格 -->
          <a-spin :spinning="loadingImages">
            <div v-if="images.length === 0" style="text-align: center; padding: 40px">
              <a-empty description="暂无图片" />
            </div>

            <a-row v-else :gutter="[16, 16]">
              <a-col
                v-for="image in images"
                :key="image.id"
                :xs="24"
                :sm="12"
                :md="8"
                :lg="6"
              >
                <a-card
                  hoverable
                  :cover-style="{ height: '150px', overflow: 'hidden' }"
                  @click="viewImage(image.id)"
                >
                  <template #cover>
                    <img
                      v-if="image.thumbnail_path"
                      :src="`file://${image.thumbnail_path}`"
                      :alt="image.original_filename"
                      style="width: 100%; height: 150px; object-fit: cover"
                    />
                    <div v-else style="height: 150px; display: flex; align-items: center; justify-content: center; background: #f5f5f5">
                      <file-image-outlined :style="{ fontSize: '48px', color: '#ccc' }" />
                    </div>
                  </template>

                  <a-card-meta>
                    <template #title>
                      <a-tooltip :title="image.original_filename">
                        <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap">
                          {{ image.original_filename }}
                        </div>
                      </a-tooltip>
                    </template>

                    <template #description>
                      <div>
                        <div>{{ formatFileSize(image.size) }}</div>
                        <div v-if="image.ocr_confidence">
                          OCR: {{ image.ocr_confidence.toFixed(0) }}%
                        </div>
                        <div style="color: #999; font-size: 12px">
                          {{ formatDate(image.created_at) }}
                        </div>
                      </div>
                    </template>
                  </a-card-meta>
                </a-card>
              </a-col>
            </a-row>

            <!-- 分页 -->
            <div v-if="images.length > 0" style="margin-top: 16px; text-align: center">
              <a-pagination
                v-model:current="pagination.current"
                v-model:page-size="pagination.pageSize"
                :total="pagination.total"
                show-size-changer
                show-quick-jumper
                :show-total="(total) => `共 ${total} 张图片`"
                @change="handlePageChange"
              />
            </div>
          </a-spin>
        </a-card>
      </a-space>
    </a-card>

    <!-- 图片查看器模态框 -->
    <a-modal
      v-model:open="imageViewerVisible"
      title="图片详情"
      width="80%"
      :footer="null"
      centered
    >
      <div v-if="currentImage">
        <a-row :gutter="16">
          <!-- 图片预览 -->
          <a-col :span="12">
            <img
              :src="`file://${currentImage.path}`"
              :alt="currentImage.original_filename"
              style="width: 100%; border-radius: 4px"
            />
          </a-col>

          <!-- 图片信息 -->
          <a-col :span="12">
            <a-descriptions :column="1" bordered size="small">
              <a-descriptions-item label="文件名">
                {{ currentImage.original_filename }}
              </a-descriptions-item>
              <a-descriptions-item label="文件大小">
                {{ formatFileSize(currentImage.size) }}
              </a-descriptions-item>
              <a-descriptions-item label="尺寸">
                {{ currentImage.width }} x {{ currentImage.height }}
              </a-descriptions-item>
              <a-descriptions-item label="格式">
                {{ currentImage.format?.toUpperCase() }}
              </a-descriptions-item>
              <a-descriptions-item label="上传时间">
                {{ formatDate(currentImage.created_at) }}
              </a-descriptions-item>
              <a-descriptions-item label="OCR 置信度">
                <a-tag v-if="currentImage.ocr_confidence" :color="getConfidenceColor(currentImage.ocr_confidence)">
                  {{ currentImage.ocr_confidence.toFixed(2) }}%
                </a-tag>
                <span v-else>-</span>
              </a-descriptions-item>
            </a-descriptions>

            <!-- OCR 文本 -->
            <a-card
              v-if="currentImage.ocr_text"
              title="识别文本"
              size="small"
              style="margin-top: 16px"
            >
              <div style="max-height: 300px; overflow-y: auto; white-space: pre-wrap">
                {{ currentImage.ocr_text }}
              </div>

              <div style="margin-top: 12px">
                <a-button size="small" @click="copyOCRText(currentImage.ocr_text)">
                  <copy-outlined /> 复制文本
                </a-button>
              </div>
            </a-card>

            <!-- 操作按钮 -->
            <div style="margin-top: 16px">
              <a-space>
                <a-button type="primary" @click="openInExplorer(currentImage.path)">
                  <folder-open-outlined /> 在文件夹中显示
                </a-button>
                <a-button danger @click="confirmDelete(currentImage.id)">
                  <delete-outlined /> 删除
                </a-button>
              </a-space>
            </div>
          </a-col>
        </a-row>
      </div>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { message, Modal } from 'ant-design-vue';
import {
  CameraOutlined,
  FileImageOutlined,
  EyeOutlined,
  CopyOutlined,
  DeleteOutlined,
  ClearOutlined,
  SearchOutlined,
  ReloadOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  FolderOpenOutlined,
} from '@ant-design/icons-vue';

// 上传选项
const uploadOptions = reactive({
  type: 'note',
  tags: [],
  compress: true,
  performOCR: true,
  addToIndex: true,
});

// 上传状态
const uploading = ref(false);
const uploadProgress = reactive({
  current: 0,
  total: 0,
  percentage: 0,
  status: 'normal',
});
const currentUploading = ref('');
const ocrProgress = reactive({
  active: false,
  progress: 0,
});

// 上传结果
const uploadResults = ref([]);
const successCount = computed(() => uploadResults.value.filter(r => r.success).length);
const failureCount = computed(() => uploadResults.value.filter(r => !r.success).length);

// 图片列表
const images = ref([]);
const loadingImages = ref(false);
const searchQuery = ref('');
const pagination = reactive({
  current: 1,
  pageSize: 12,
  total: 0,
});

// 图片统计
const imageStats = reactive({
  totalImages: 0,
  totalSize: 0,
  averageOcrConfidence: 0,
});

// 图片查看器
const imageViewerVisible = ref(false);
const currentImage = ref(null);

// 文件选择前的处理
const handleBeforeUpload = (file) => {
  const files = Array.isArray(file) ? file : [file];
  handleFilesSelected(files);
  return false; // 阻止自动上传
};

// 选择文件
const handleSelectFiles = async () => {
  try {
    const result = await window.electronAPI.image.selectImages();

    if (!result.canceled && result.filePaths?.length > 0) {
      await uploadImages(result.filePaths);
    }
  } catch (error) {
    console.error('选择文件失败:', error);
    message.error('选择文件失败: ' + error.message);
  }
};

// 处理选中的文件
const handleFilesSelected = (files) => {
  const filePaths = files.map(file => file.path || file);
  uploadImages(filePaths);
};

// 上传图片
const uploadImages = async (filePaths) => {
  if (filePaths.length === 0) return;

  uploading.value = true;
  uploadProgress.current = 0;
  uploadProgress.total = filePaths.length;
  uploadProgress.percentage = 0;
  uploadProgress.status = 'active';
  uploadResults.value = [];

  // 监听上传事件
  const uploadStartHandler = (data) => {
    currentUploading.value = data.imagePath;
  };

  const uploadCompleteHandler = (data) => {
    uploadProgress.current++;
    uploadProgress.percentage = Math.round((uploadProgress.current / uploadProgress.total) * 100);
  };

  const ocrProgressHandler = (data) => {
    ocrProgress.active = true;
    ocrProgress.progress = data.progress || 0;
  };

  window.electronAPI.image.on('image:upload-start', uploadStartHandler);
  window.electronAPI.image.on('image:upload-complete', uploadCompleteHandler);
  window.electronAPI.image.on('image:ocr-progress', ocrProgressHandler);

  try {
    const options = {
      compress: uploadOptions.compress,
      generateThumbnail: true,
      performOCR: uploadOptions.performOCR,
      addToKnowledge: true,
      addToIndex: uploadOptions.addToIndex,
      knowledgeType: uploadOptions.type,
      tags: uploadOptions.tags,
    };

    let results;
    if (filePaths.length === 1) {
      // 单张图片
      const result = await window.electronAPI.image.upload(filePaths[0], options);
      results = [{ success: true, path: filePaths[0], ...result }];
    } else {
      // 批量上传
      results = await window.electronAPI.image.uploadBatch(filePaths, options);
    }

    uploadResults.value = results;
    uploadProgress.status = 'success';

    const successCount = results.filter(r => r.success).length;
    message.success(`上传完成！成功 ${successCount} 张，失败 ${results.length - successCount} 张`);

    // 刷新图片列表
    await loadImages();
    await loadStats();
  } catch (error) {
    console.error('上传失败:', error);
    uploadProgress.status = 'exception';
    message.error('上传失败: ' + error.message);
  } finally {
    uploading.value = false;
    currentUploading.value = '';
    ocrProgress.active = false;

    // 移除事件监听
    window.electronAPI.image.off('image:upload-start', uploadStartHandler);
    window.electronAPI.image.off('image:upload-complete', uploadCompleteHandler);
    window.electronAPI.image.off('image:ocr-progress', ocrProgressHandler);
  }
};

// 加载图片列表
const loadImages = async () => {
  loadingImages.value = true;

  try {
    const offset = (pagination.current - 1) * pagination.pageSize;
    const options = {
      limit: pagination.pageSize,
      offset: offset,
      orderBy: 'created_at',
      order: 'DESC',
    };

    const result = await window.electronAPI.image.listImages(options);
    images.value = result;

    // 更新总数（这里简化处理，实际应该从后端获取总数）
    if (result.length < pagination.pageSize && pagination.current === 1) {
      pagination.total = result.length;
    }
  } catch (error) {
    console.error('加载图片列表失败:', error);
    message.error('加载图片列表失败: ' + error.message);
  } finally {
    loadingImages.value = false;
  }
};

// 加载统计信息
const loadStats = async () => {
  try {
    const stats = await window.electronAPI.image.getStats();
    Object.assign(imageStats, stats);
    pagination.total = stats.totalImages;
  } catch (error) {
    console.error('加载统计信息失败:', error);
  }
};

// 搜索图片
const handleSearch = async () => {
  if (!searchQuery.value.trim()) {
    await loadImages();
    return;
  }

  loadingImages.value = true;

  try {
    const result = await window.electronAPI.image.searchImages(searchQuery.value);
    images.value = result;
    pagination.total = result.length;
    message.info(`找到 ${result.length} 张图片`);
  } catch (error) {
    console.error('搜索失败:', error);
    message.error('搜索失败: ' + error.message);
  } finally {
    loadingImages.value = false;
  }
};

// 分页变化
const handlePageChange = (page, pageSize) => {
  pagination.current = page;
  pagination.pageSize = pageSize;
  loadImages();
};

// 查看图片
const viewImage = async (imageId) => {
  try {
    const image = await window.electronAPI.image.getImage(imageId);
    currentImage.value = image;
    imageViewerVisible.value = true;
  } catch (error) {
    console.error('加载图片详情失败:', error);
    message.error('加载图片详情失败: ' + error.message);
  }
};

// 复制 OCR 文本
const copyOCRText = (text) => {
  if (!text) return;

  navigator.clipboard.writeText(text).then(() => {
    message.success('文本已复制到剪贴板');
  }).catch((error) => {
    console.error('复制失败:', error);
    message.error('复制失败');
  });
};

// 删除图片
const deleteImage = async (imageId) => {
  Modal.confirm({
    title: '确认删除',
    content: '确定要删除这张图片吗？此操作不可恢复。',
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    onOk: async () => {
      try {
        await window.electronAPI.image.deleteImage(imageId);
        message.success('删除成功');
        await loadImages();
        await loadStats();

        if (imageViewerVisible.value && currentImage.value?.id === imageId) {
          imageViewerVisible.value = false;
        }
      } catch (error) {
        console.error('删除失败:', error);
        message.error('删除失败: ' + error.message);
      }
    },
  });
};

// 确认删除（从查看器）
const confirmDelete = (imageId) => {
  deleteImage(imageId);
};

// 在文件夹中打开
const openInExplorer = (filePath) => {
  // 这里需要通过 IPC 调用系统命令
  message.info('功能开发中...');
};

// 清除结果
const clearResults = () => {
  uploadResults.value = [];
  uploadProgress.current = 0;
  uploadProgress.total = 0;
  uploadProgress.percentage = 0;
};

// 工具函数
const formatFileSize = (bytes) => {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(2) + ' ' + sizes[i];
};

const formatDate = (timestamp) => {
  if (!timestamp) return '-';
  const date = new Date(timestamp);
  return date.toLocaleString('zh-CN');
};

const getResultHeader = (result, index) => {
  const status = result.success ? '✓' : '✗';
  const filename = result.path ? result.path.split(/[/\\]/).pop() : `图片 ${index + 1}`;
  return `${status} ${filename}`;
};

const getConfidenceColor = (confidence) => {
  if (confidence >= 80) return 'green';
  if (confidence >= 60) return 'blue';
  if (confidence >= 40) return 'orange';
  return 'red';
};

const getQualityColor = (quality) => {
  const colors = {
    high: 'green',
    medium: 'blue',
    low: 'orange',
    very_low: 'red',
    unknown: 'default',
  };
  return colors[quality] || 'default';
};

const getQualityLabel = (quality) => {
  const labels = {
    high: '高质量',
    medium: '中等质量',
    low: '低质量',
    very_low: '很低质量',
    unknown: '未知',
  };
  return labels[quality] || '未知';
};

// 组件挂载时加载数据
onMounted(() => {
  loadImages();
  loadStats();
});
</script>

<style scoped>
.image-upload-container {
  padding: 20px;
  max-width: 1400px;
  margin: 0 auto;
}

.ant-upload-drag-icon {
  margin-bottom: 16px;
}

.ant-upload-text {
  font-size: 16px;
  font-weight: 500;
  margin-bottom: 8px;
}

.ant-upload-hint {
  color: rgba(0, 0, 0, 0.45);
}

:deep(.ant-card-head-title) {
  font-weight: 600;
}

:deep(.ant-statistic-title) {
  font-size: 14px;
  color: rgba(0, 0, 0, 0.65);
}

:deep(.ant-collapse-header) {
  font-weight: 500;
}
</style>
