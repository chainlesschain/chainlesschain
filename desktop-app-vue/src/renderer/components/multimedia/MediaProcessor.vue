<template>
  <div class="media-processor">
    <a-card
      title="多媒体处理控制台"
      :bordered="false"
    >
      <template #extra>
        <a-space>
          <a-badge
            :count="processingCount"
            :overflow-count="99"
          >
            <CloudUploadOutlined style="font-size: 20px" />
          </a-badge>
        </a-space>
      </template>

      <a-tabs
        v-model:active-key="activeTab"
        type="card"
      >
        <!-- 图片处理 -->
        <a-tab-pane
          key="image"
          tab="图片处理"
        >
          <template #tab>
            <span><PictureOutlined /> 图片处理</span>
          </template>

          <div class="processor-content">
            <a-upload-dragger
              v-model:file-list="imageFiles"
              name="files"
              multiple
              :before-upload="() => false"
              accept="image/*"
              @change="handleImageChange"
            >
              <p class="ant-upload-drag-icon">
                <InboxOutlined />
              </p>
              <p class="ant-upload-text">
                点击或拖拽图片到此区域上传
              </p>
              <p class="ant-upload-hint">
                支持单张或批量上传，支持 JPG、PNG、GIF、WEBP 等格式
              </p>
            </a-upload-dragger>

            <a-divider />

            <a-form layout="vertical">
              <a-row :gutter="16">
                <a-col :span="8">
                  <a-form-item label="压缩质量">
                    <a-slider
                      v-model:value="imageOptions.quality"
                      :min="1"
                      :max="100"
                      :marks="{ 1: '低', 50: '中', 100: '高' }"
                    />
                  </a-form-item>
                </a-col>
                <a-col :span="8">
                  <a-form-item label="最大宽度">
                    <a-input-number
                      v-model:value="imageOptions.maxWidth"
                      :min="100"
                      :max="4096"
                      :step="100"
                      style="width: 100%"
                    />
                  </a-form-item>
                </a-col>
                <a-col :span="8">
                  <a-form-item label="输出格式">
                    <a-select
                      v-model:value="imageOptions.format"
                      style="width: 100%"
                    >
                      <a-select-option value="jpeg">
                        JPEG
                      </a-select-option>
                      <a-select-option value="png">
                        PNG
                      </a-select-option>
                      <a-select-option value="webp">
                        WebP
                      </a-select-option>
                    </a-select>
                  </a-form-item>
                </a-col>
              </a-row>

              <a-row :gutter="16">
                <a-col :span="24">
                  <a-form-item>
                    <a-space>
                      <a-checkbox v-model:checked="imageOptions.compress">
                        压缩图片
                      </a-checkbox>
                      <a-checkbox v-model:checked="imageOptions.generateThumbnail">
                        生成缩略图
                      </a-checkbox>
                      <a-checkbox v-model:checked="imageOptions.performOCR">
                        OCR识别
                      </a-checkbox>
                      <a-checkbox v-model:checked="imageOptions.addToKnowledge">
                        添加到知识库
                      </a-checkbox>
                    </a-space>
                  </a-form-item>
                </a-col>
              </a-row>

              <a-form-item>
                <a-space>
                  <a-button
                    type="primary"
                    :loading="isProcessing"
                    :disabled="imageFiles.length === 0"
                    @click="processImages"
                  >
                    <UploadOutlined /> 开始处理 ({{ imageFiles.length }}张)
                  </a-button>
                  <a-button
                    :disabled="imageFiles.length === 0"
                    @click="clearImageFiles"
                  >
                    清空列表
                  </a-button>
                </a-space>
              </a-form-item>
            </a-form>

            <!-- 处理结果 -->
            <div
              v-if="imageResults.length > 0"
              class="results-section"
            >
              <a-divider>处理结果</a-divider>
              <a-list
                :data-source="imageResults"
                :grid="{ gutter: 16, column: 3 }"
              >
                <template #renderItem="{ item }">
                  <a-list-item>
                    <a-card hoverable>
                      <template #cover>
                        <img
                          v-if="item.thumbnailUrl"
                          :src="item.thumbnailUrl"
                          :alt="item.filename"
                          style="height: 120px; object-fit: cover"
                        >
                      </template>
                      <a-card-meta :title="item.filename">
                        <template #description>
                          <div class="result-stats">
                            <div>大小: {{ formatFileSize(item.size) }}</div>
                            <div v-if="item.compressionRatio">
                              压缩率: {{ item.compressionRatio }}%
                            </div>
                            <div v-if="item.ocrText">
                              识别字数: {{ item.ocrText.length }}
                            </div>
                          </div>
                        </template>
                      </a-card-meta>
                    </a-card>
                  </a-list-item>
                </template>
              </a-list>
            </div>
          </div>
        </a-tab-pane>

        <!-- 音频转录 -->
        <a-tab-pane
          key="audio"
          tab="音频转录"
        >
          <template #tab>
            <span><SoundOutlined /> 音频转录</span>
          </template>

          <div class="processor-content">
            <a-upload-dragger
              v-model:file-list="audioFiles"
              name="files"
              multiple
              :before-upload="() => false"
              accept="audio/*"
              @change="handleAudioChange"
            >
              <p class="ant-upload-drag-icon">
                <CustomerServiceOutlined />
              </p>
              <p class="ant-upload-text">
                点击或拖拽音频文件到此区域上传
              </p>
              <p class="ant-upload-hint">
                支持 MP3、WAV、M4A、OGG 等格式
              </p>
            </a-upload-dragger>

            <a-divider />

            <a-form layout="vertical">
              <a-row :gutter="16">
                <a-col :span="12">
                  <a-form-item label="转录引擎">
                    <a-select
                      v-model:value="audioOptions.engine"
                      style="width: 100%"
                    >
                      <a-select-option value="whisper">
                        Whisper (本地)
                      </a-select-option>
                      <a-select-option value="azure">
                        Azure Speech
                      </a-select-option>
                      <a-select-option value="google">
                        Google Speech
                      </a-select-option>
                    </a-select>
                  </a-form-item>
                </a-col>
                <a-col :span="12">
                  <a-form-item label="语言">
                    <a-select
                      v-model:value="audioOptions.language"
                      style="width: 100%"
                    >
                      <a-select-option value="zh">
                        中文
                      </a-select-option>
                      <a-select-option value="en">
                        英文
                      </a-select-option>
                      <a-select-option value="auto">
                        自动检测
                      </a-select-option>
                    </a-select>
                  </a-form-item>
                </a-col>
              </a-row>

              <a-form-item>
                <a-space>
                  <a-button
                    type="primary"
                    :loading="isProcessing"
                    :disabled="audioFiles.length === 0"
                    @click="processAudio"
                  >
                    <ThunderboltOutlined /> 开始转录 ({{ audioFiles.length }}个)
                  </a-button>
                  <a-button
                    :disabled="audioFiles.length === 0"
                    @click="clearAudioFiles"
                  >
                    清空列表
                  </a-button>
                </a-space>
              </a-form-item>
            </a-form>

            <!-- 转录结果 -->
            <div
              v-if="audioResults.length > 0"
              class="results-section"
            >
              <a-divider>转录结果</a-divider>
              <a-list
                :data-source="audioResults"
                bordered
              >
                <template #renderItem="{ item }">
                  <a-list-item>
                    <a-list-item-meta :title="item.filename">
                      <template #description>
                        <div class="audio-result">
                          <a-typography-paragraph :copyable="{ text: item.text }">
                            {{ item.text || '转录中...' }}
                          </a-typography-paragraph>
                          <div class="audio-stats">
                            <a-space>
                              <a-tag color="blue">
                                时长: {{ formatDuration(item.duration) }}
                              </a-tag>
                              <a-tag
                                v-if="item.confidence"
                                color="green"
                              >
                                置信度: {{ item.confidence }}%
                              </a-tag>
                            </a-space>
                          </div>
                        </div>
                      </template>
                    </a-list-item-meta>
                  </a-list-item>
                </template>
              </a-list>
            </div>
          </div>
        </a-tab-pane>

        <!-- 批量OCR -->
        <a-tab-pane
          key="ocr"
          tab="批量OCR"
        >
          <template #tab>
            <span><ScanOutlined /> 批量OCR</span>
          </template>

          <div class="processor-content">
            <a-alert
              message="批量OCR识别"
              description="使用Worker池并发处理，速度提升3-4倍。适合处理大量图片。"
              type="info"
              show-icon
              style="margin-bottom: 16px"
            />

            <a-upload-dragger
              v-model:file-list="ocrFiles"
              name="files"
              multiple
              :before-upload="() => false"
              accept="image/*"
              @change="handleOCRChange"
            >
              <p class="ant-upload-drag-icon">
                <FileImageOutlined />
              </p>
              <p class="ant-upload-text">
                点击或拖拽图片到此区域进行OCR识别
              </p>
              <p class="ant-upload-hint">
                支持批量上传，自动使用多Worker并发处理
              </p>
            </a-upload-dragger>

            <a-divider />

            <a-form layout="vertical">
              <a-row :gutter="16">
                <a-col :span="12">
                  <a-form-item label="识别语言">
                    <a-select
                      v-model:value="ocrOptions.languages"
                      mode="multiple"
                      style="width: 100%"
                    >
                      <a-select-option value="chi_sim">
                        简体中文
                      </a-select-option>
                      <a-select-option value="chi_tra">
                        繁体中文
                      </a-select-option>
                      <a-select-option value="eng">
                        英文
                      </a-select-option>
                      <a-select-option value="jpn">
                        日文
                      </a-select-option>
                    </a-select>
                  </a-form-item>
                </a-col>
                <a-col :span="12">
                  <a-form-item label="并发Worker数">
                    <a-input-number
                      v-model:value="ocrOptions.maxWorkers"
                      :min="1"
                      :max="4"
                      style="width: 100%"
                    />
                  </a-form-item>
                </a-col>
              </a-row>

              <a-form-item>
                <a-button
                  type="primary"
                  :loading="isProcessing"
                  :disabled="ocrFiles.length === 0"
                  @click="processOCR"
                >
                  <ThunderboltOutlined /> 批量识别 ({{ ocrFiles.length }}张)
                </a-button>
              </a-form-item>
            </a-form>

            <!-- OCR结果 -->
            <div
              v-if="ocrResults.length > 0"
              class="results-section"
            >
              <a-divider>识别结果</a-divider>
              <a-collapse>
                <a-collapse-panel
                  v-for="(item, index) in ocrResults"
                  :key="index"
                  :header="`${item.filename} - ${item.text?.length || 0}字`"
                >
                  <a-typography-paragraph :copyable="{ text: item.text }">
                    {{ item.text }}
                  </a-typography-paragraph>
                  <a-space>
                    <a-tag
                      v-if="item.confidence"
                      color="green"
                    >
                      置信度: {{ item.confidence.toFixed(2) }}%
                    </a-tag>
                    <a-tag color="blue">
                      耗时: {{ item.duration }}ms
                    </a-tag>
                  </a-space>
                </a-collapse-panel>
              </a-collapse>
            </div>
          </div>
        </a-tab-pane>
      </a-tabs>
    </a-card>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { message } from 'ant-design-vue';
import {
  CloudUploadOutlined,
  PictureOutlined,
  SoundOutlined,
  ScanOutlined,
  InboxOutlined,
  CustomerServiceOutlined,
  FileImageOutlined,
  UploadOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons-vue';

// 状态
const activeTab = ref('image');
const isProcessing = ref(false);

// 文件列表
const imageFiles = ref([]);
const audioFiles = ref([]);
const ocrFiles = ref([]);

// 处理选项
const imageOptions = ref({
  quality: 85,
  maxWidth: 1920,
  format: 'jpeg',
  compress: true,
  generateThumbnail: true,
  performOCR: false,
  addToKnowledge: false,
});

const audioOptions = ref({
  engine: 'whisper',
  language: 'zh',
});

const ocrOptions = ref({
  languages: ['chi_sim', 'eng'],
  maxWorkers: 3,
});

// 处理结果
const imageResults = ref([]);
const audioResults = ref([]);
const ocrResults = ref([]);

// 计算属性
const processingCount = computed(() => {
  return imageFiles.value.length + audioFiles.value.length + ocrFiles.value.length;
});

// 方法
const handleImageChange = (info) => {
  console.log('Image files changed:', info.fileList);
};

const handleAudioChange = (info) => {
  console.log('Audio files changed:', info.fileList);
};

const handleOCRChange = (info) => {
  console.log('OCR files changed:', info.fileList);
};

const processImages = async () => {
  if (imageFiles.value.length === 0) {
    message.warning('请先选择图片文件');
    return;
  }

  isProcessing.value = true;
  imageResults.value = [];

  try {
    for (const file of imageFiles.value) {
      const result = await window.electronAPI.invoke('image:upload', {
        imagePath: file.originFileObj.path,
        options: imageOptions.value,
      });

      imageResults.value.push({
        filename: file.name,
        ...result,
        thumbnailUrl: file.thumbUrl,
      });
    }

    message.success(`成功处理 ${imageFiles.value.length} 张图片`);
  } catch (error) {
    message.error(`处理失败: ${error.message}`);
  } finally {
    isProcessing.value = false;
  }
};

const processAudio = async () => {
  if (audioFiles.value.length === 0) {
    message.warning('请先选择音频文件');
    return;
  }

  isProcessing.value = true;
  audioResults.value = [];

  try {
    for (const file of audioFiles.value) {
      const result = await window.electronAPI.invoke('audio:transcribe', {
        audioPath: file.originFileObj.path,
        options: audioOptions.value,
      });

      audioResults.value.push({
        filename: file.name,
        ...result,
      });
    }

    message.success(`成功转录 ${audioFiles.value.length} 个音频文件`);
  } catch (error) {
    message.error(`转录失败: ${error.message}`);
  } finally {
    isProcessing.value = false;
  }
};

const processOCR = async () => {
  if (ocrFiles.value.length === 0) {
    message.warning('请先选择图片文件');
    return;
  }

  isProcessing.value = true;
  ocrResults.value = [];

  try {
    const imagePaths = ocrFiles.value.map(f => f.originFileObj.path);

    const results = await window.electronAPI.invoke('image:batch-ocr', {
      imagePaths: imagePaths,
      options: ocrOptions.value,
    });

    ocrResults.value = results.map((result, index) => ({
      filename: ocrFiles.value[index].name,
      ...result,
    }));

    message.success(`成功识别 ${ocrFiles.value.length} 张图片`);
  } catch (error) {
    message.error(`识别失败: ${error.message}`);
  } finally {
    isProcessing.value = false;
  }
};

const clearImageFiles = () => {
  imageFiles.value = [];
  imageResults.value = [];
};

const clearAudioFiles = () => {
  audioFiles.value = [];
  audioResults.value = [];
};

const formatFileSize = (bytes) => {
  if (!bytes) {return '0 B';}
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
};

const formatDuration = (ms) => {
  if (!ms) {return '0秒';}
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {return `${seconds}秒`;}
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}分${remainingSeconds}秒`;
};
</script>

<style scoped lang="scss">
.media-processor {
  :deep(.ant-card-head) {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;

    .ant-card-head-title {
      color: white;
    }
  }
}

.processor-content {
  padding: 24px 0;
}

.results-section {
  margin-top: 24px;
}

.result-stats {
  font-size: 12px;
  color: #8c8c8c;

  div {
    margin-bottom: 4px;
  }
}

.audio-result {
  .audio-stats {
    margin-top: 12px;
  }
}

:deep(.ant-upload-drag) {
  background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
  border: 2px dashed #667eea;
  transition: all 0.3s ease;

  &:hover {
    border-color: #764ba2;
    background: linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%);
  }
}

:deep(.ant-upload-drag-icon) {
  color: #667eea;
  font-size: 48px;
}
</style>
