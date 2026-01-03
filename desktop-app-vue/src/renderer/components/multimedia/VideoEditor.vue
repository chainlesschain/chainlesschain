<template>
  <div class="video-editor">
    <a-card title="视频编辑器" :bordered="false">
      <a-row :gutter="24">
        <!-- 左侧：视频预览和文件选择 -->
        <a-col :span="16">
          <div class="video-preview">
            <video
              v-if="videoFile"
              ref="videoPlayer"
              :src="videoPreviewUrl"
              controls
              class="video-player"
            />
            <div v-else class="empty-preview">
              <VideoCameraOutlined style="font-size: 64px; color: #ccc" />
              <p>请选择视频文件</p>
            </div>
          </div>

          <a-upload
            v-model:file-list="fileList"
            :before-upload="handleBeforeUpload"
            accept="video/*"
            :max-count="1"
            @change="handleFileChange"
          >
            <a-button type="primary" block>
              <UploadOutlined /> 选择视频文件
            </a-button>
          </a-upload>

          <a-divider />

          <!-- 视频信息 -->
          <div v-if="videoInfo" class="video-info">
            <a-descriptions title="视频信息" :column="2" bordered size="small">
              <a-descriptions-item label="时长">
                {{ formatDuration(videoInfo.duration) }}
              </a-descriptions-item>
              <a-descriptions-item label="分辨率">
                {{ videoInfo.width }} x {{ videoInfo.height }}
              </a-descriptions-item>
              <a-descriptions-item label="帧率">
                {{ videoInfo.fps }} fps
              </a-descriptions-item>
              <a-descriptions-item label="编码">
                {{ videoInfo.codec }}
              </a-descriptions-item>
            </a-descriptions>
          </div>
        </a-col>

        <!-- 右侧：编辑选项 -->
        <a-col :span="8">
          <a-tabs v-model:activeKey="activeEditTab" tab-position="right">
            <!-- 滤镜效果 -->
            <a-tab-pane key="filters" tab="滤镜">
              <template #tab>
                <FilterOutlined /> 滤镜
              </template>

              <div class="edit-panel">
                <h4>选择滤镜效果</h4>
                <a-radio-group v-model:value="filterSettings.filterType" style="width: 100%">
                  <a-space direction="vertical" style="width: 100%">
                    <a-radio value="blur">模糊</a-radio>
                    <a-radio value="sharpen">锐化</a-radio>
                    <a-radio value="grayscale">黑白</a-radio>
                    <a-radio value="sepia">怀旧</a-radio>
                    <a-radio value="vignette">暗角</a-radio>
                    <a-radio value="brightness">亮度</a-radio>
                    <a-radio value="contrast">对比度</a-radio>
                    <a-radio value="saturation">饱和度</a-radio>
                    <a-radio value="negative">负片</a-radio>
                    <a-radio value="mirror">镜像</a-radio>
                    <a-radio value="flip">翻转</a-radio>
                    <a-radio value="vintage">复古</a-radio>
                    <a-radio value="cartoon">卡通</a-radio>
                  </a-space>
                </a-radio-group>

                <a-divider />

                <a-form-item label="强度">
                  <a-slider
                    v-model:value="filterSettings.intensity"
                    :min="0"
                    :max="2"
                    :step="0.1"
                    :marks="{ 0: '0', 1: '1', 2: '2' }"
                  />
                </a-form-item>

                <a-button type="primary" block @click="applyFilter" :loading="isProcessing">
                  <ThunderboltOutlined /> 应用滤镜
                </a-button>

                <a-divider />

                <!-- 滤镜链 -->
                <h4>滤镜链</h4>
                <a-tag
                  v-for="(filter, index) in filterChain"
                  :key="index"
                  closable
                  @close="removeFromChain(index)"
                  color="blue"
                  style="margin-bottom: 8px"
                >
                  {{ filter.filterType }} ({{ filter.intensity }})
                </a-tag>

                <a-space style="width: 100%; margin-top: 8px">
                  <a-button size="small" @click="addToChain">
                    <PlusOutlined /> 添加到链
                  </a-button>
                  <a-button
                    size="small"
                    type="primary"
                    @click="applyFilterChain"
                    :disabled="filterChain.length === 0"
                    :loading="isProcessing"
                  >
                    应用滤镜链
                  </a-button>
                </a-space>
              </div>
            </a-tab-pane>

            <!-- 音频处理 -->
            <a-tab-pane key="audio" tab="音频">
              <template #tab>
                <SoundOutlined /> 音频
              </template>

              <div class="edit-panel">
                <h4>音轨操作</h4>

                <a-space direction="vertical" style="width: 100%">
                  <a-button block @click="extractAudio" :loading="isProcessing">
                    <ExportOutlined /> 提取音频
                  </a-button>

                  <a-button block @click="separateAudioTracks" :loading="isProcessing">
                    <SplitCellsOutlined /> 分离所有音轨
                  </a-button>

                  <a-divider />

                  <h4>替换音轨</h4>
                  <a-upload
                    :before-upload="() => false"
                    accept="audio/*"
                    @change="handleAudioFileChange"
                  >
                    <a-button block>
                      <UploadOutlined /> 选择音频文件
                    </a-button>
                  </a-upload>

                  <a-button
                    block
                    type="primary"
                    @click="replaceAudio"
                    :disabled="!replacementAudio"
                    :loading="isProcessing"
                  >
                    <SwapOutlined /> 替换音轨
                  </a-button>

                  <a-divider />

                  <h4>音量调节</h4>
                  <a-form-item label="音量">
                    <a-slider
                      v-model:value="audioSettings.volumeLevel"
                      :min="0"
                      :max="2"
                      :step="0.1"
                      :marks="{ 0: '静音', 1: '正常', 2: '2x' }"
                    />
                  </a-form-item>

                  <a-checkbox v-model:checked="audioSettings.normalize">
                    音量归一化
                  </a-checkbox>

                  <a-button
                    block
                    type="primary"
                    @click="adjustVolume"
                    :loading="isProcessing"
                    style="margin-top: 12px"
                  >
                    <SoundOutlined /> 调整音量
                  </a-button>
                </a-space>
              </div>
            </a-tab-pane>

            <!-- 字幕 -->
            <a-tab-pane key="subtitles" tab="字幕">
              <template #tab>
                <FontSizeOutlined /> 字幕
              </template>

              <div class="edit-panel">
                <h4>字幕样式</h4>

                <a-form layout="vertical">
                  <a-form-item label="预设风格">
                    <a-select v-model:value="subtitleSettings.preset" style="width: 100%">
                      <a-select-option value="default">默认</a-select-option>
                      <a-select-option value="cinema">影院</a-select-option>
                      <a-select-option value="minimal">简约</a-select-option>
                      <a-select-option value="bold">粗体</a-select-option>
                    </a-select>
                  </a-form-item>

                  <a-collapse>
                    <a-collapse-panel key="1" header="高级设置">
                      <a-form-item label="字体">
                        <a-input v-model:value="subtitleSettings.fontName" />
                      </a-form-item>

                      <a-form-item label="字号">
                        <a-input-number
                          v-model:value="subtitleSettings.fontSize"
                          :min="12"
                          :max="72"
                          style="width: 100%"
                        />
                      </a-form-item>

                      <a-form-item label="字体颜色">
                        <input
                          type="color"
                          v-model="subtitleSettings.fontColor"
                          style="width: 100%"
                        />
                      </a-form-item>

                      <a-form-item label="描边颜色">
                        <input
                          type="color"
                          v-model="subtitleSettings.outlineColor"
                          style="width: 100%"
                        />
                      </a-form-item>

                      <a-form-item label="描边宽度">
                        <a-input-number
                          v-model:value="subtitleSettings.outlineWidth"
                          :min="0"
                          :max="5"
                          style="width: 100%"
                        />
                      </a-form-item>

                      <a-form-item label="阴影深度">
                        <a-input-number
                          v-model:value="subtitleSettings.shadowDepth"
                          :min="0"
                          :max="5"
                          style="width: 100%"
                        />
                      </a-form-item>

                      <a-space>
                        <a-checkbox v-model:checked="subtitleSettings.bold">粗体</a-checkbox>
                        <a-checkbox v-model:checked="subtitleSettings.italic">斜体</a-checkbox>
                        <a-checkbox v-model:checked="subtitleSettings.glowEffect">
                          发光效果
                        </a-checkbox>
                      </a-space>
                    </a-collapse-panel>
                  </a-collapse>

                  <a-divider />

                  <a-upload
                    :before-upload="() => false"
                    accept=".srt,.ass,.vtt"
                    @change="handleSubtitleFileChange"
                  >
                    <a-button block>
                      <FileTextOutlined /> 选择字幕文件
                    </a-button>
                  </a-upload>

                  <a-button
                    block
                    type="primary"
                    @click="addSubtitles"
                    :disabled="!subtitleFile"
                    :loading="isProcessing"
                    style="margin-top: 12px"
                  >
                    <PlusOutlined /> 添加字幕
                  </a-button>
                </a-form>
              </div>
            </a-tab-pane>

            <!-- 基础编辑 -->
            <a-tab-pane key="basic" tab="基础">
              <template #tab>
                <ScissorOutlined /> 基础
              </template>

              <div class="edit-panel">
                <a-space direction="vertical" style="width: 100%">
                  <a-button block @click="showTrimModal" :disabled="!videoFile">
                    <ScissorOutlined /> 裁剪视频
                  </a-button>

                  <a-button block @click="showConvertModal" :disabled="!videoFile">
                    <SwapOutlined /> 格式转换
                  </a-button>

                  <a-button block @click="showCompressModal" :disabled="!videoFile">
                    <CompressOutlined /> 压缩视频
                  </a-button>

                  <a-button block @click="generateThumbnail" :disabled="!videoFile">
                    <PictureOutlined /> 生成缩略图
                  </a-button>
                </a-space>
              </div>
            </a-tab-pane>
          </a-tabs>
        </a-col>
      </a-row>
    </a-card>

    <!-- 处理进度对话框 -->
    <a-modal
      v-model:visible="showProgressModal"
      title="处理进度"
      :footer="null"
      :closable="false"
    >
      <a-progress :percent="processProgress" :status="progressStatus" />
      <p style="margin-top: 12px; color: #8c8c8c">{{ processMessage }}</p>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { message } from 'ant-design-vue';
import {
  VideoCameraOutlined,
  UploadOutlined,
  FilterOutlined,
  SoundOutlined,
  FontSizeOutlined,
  ScissorOutlined,
  ThunderboltOutlined,
  PlusOutlined,
  ExportOutlined,
  SplitCellsOutlined,
  SwapOutlined,
  CompressOutlined,
  PictureOutlined,
  FileTextOutlined,
} from '@ant-design/icons-vue';

// 状态
const activeEditTab = ref('filters');
const fileList = ref([]);
const videoFile = ref(null);
const videoPreviewUrl = ref('');
const videoInfo = ref(null);
const isProcessing = ref(false);
const showProgressModal = ref(false);
const processProgress = ref(0);
const progressStatus = ref('active');
const processMessage = ref('');

// 滤镜设置
const filterSettings = ref({
  filterType: 'blur',
  intensity: 1,
});
const filterChain = ref([]);

// 音频设置
const audioSettings = ref({
  volumeLevel: 1,
  normalize: false,
});
const replacementAudio = ref(null);

// 字幕设置
const subtitleSettings = ref({
  preset: 'default',
  fontName: 'Arial',
  fontSize: 24,
  fontColor: '#FFFFFF',
  outlineColor: '#000000',
  outlineWidth: 2,
  shadowDepth: 2,
  bold: false,
  italic: false,
  glowEffect: false,
});
const subtitleFile = ref(null);

// 方法
const handleBeforeUpload = (file) => {
  videoFile.value = file;
  videoPreviewUrl.value = URL.createObjectURL(file);
  getVideoInfo(file);
  return false;
};

const handleFileChange = (info) => {
  console.log('File changed:', info);
};

const handleAudioFileChange = (info) => {
  if (info.file) {
    replacementAudio.value = info.file;
    message.success(`已选择音频文件: ${info.file.name}`);
  }
};

const handleSubtitleFileChange = (info) => {
  if (info.file) {
    subtitleFile.value = info.file;
    message.success(`已选择字幕文件: ${info.file.name}`);
  }
};

const getVideoInfo = async (file) => {
  try {
    const info = await window.electronAPI.invoke('video:getInfo', {
      videoPath: file.path,
    });
    videoInfo.value = info;
  } catch (error) {
    message.error(`获取视频信息失败: ${error.message}`);
  }
};

const applyFilter = async () => {
  if (!videoFile.value) {
    message.warning('请先选择视频文件');
    return;
  }

  isProcessing.value = true;
  showProgressModal.value = true;
  processProgress.value = 0;

  try {
    const outputPath = videoFile.value.path.replace(/\.[^.]+$/, `_${filterSettings.value.filterType}$&`);

    await window.electronAPI.invoke('video:applyFilter', {
      inputPath: videoFile.value.path,
      outputPath: outputPath,
      options: {
        filterType: filterSettings.value.filterType,
        intensity: filterSettings.value.intensity,
      },
    });

    message.success('滤镜应用成功');
    showProgressModal.value = false;
  } catch (error) {
    message.error(`滤镜应用失败: ${error.message}`);
    progressStatus.value = 'exception';
  } finally {
    isProcessing.value = false;
  }
};

const addToChain = () => {
  filterChain.value.push({ ...filterSettings.value });
  message.success('已添加到滤镜链');
};

const removeFromChain = (index) => {
  filterChain.value.splice(index, 1);
};

const applyFilterChain = async () => {
  if (!videoFile.value) {
    message.warning('请先选择视频文件');
    return;
  }

  isProcessing.value = true;
  showProgressModal.value = true;

  try {
    const outputPath = videoFile.value.path.replace(/\.[^.]+$/, '_filtered$&');

    await window.electronAPI.invoke('video:applyFilterChain', {
      inputPath: videoFile.value.path,
      outputPath: outputPath,
      filters: filterChain.value,
    });

    message.success('滤镜链应用成功');
    filterChain.value = [];
    showProgressModal.value = false;
  } catch (error) {
    message.error(`滤镜链应用失败: ${error.message}`);
  } finally {
    isProcessing.value = false;
  }
};

const extractAudio = async () => {
  if (!videoFile.value) return;

  isProcessing.value = true;
  try {
    const outputPath = videoFile.value.path.replace(/\.[^.]+$/, '.mp3');

    await window.electronAPI.invoke('video:extractAudio', {
      inputPath: videoFile.value.path,
      outputPath: outputPath,
    });

    message.success('音频提取成功');
  } catch (error) {
    message.error(`音频提取失败: ${error.message}`);
  } finally {
    isProcessing.value = false;
  }
};

const separateAudioTracks = async () => {
  if (!videoFile.value) return;

  isProcessing.value = true;
  try {
    const outputDir = videoFile.value.path.replace(/\.[^.]+$/, '_audio_tracks');

    await window.electronAPI.invoke('video:separateAudio', {
      inputPath: videoFile.value.path,
      outputDir: outputDir,
    });

    message.success('音轨分离成功');
  } catch (error) {
    message.error(`音轨分离失败: ${error.message}`);
  } finally {
    isProcessing.value = false;
  }
};

const replaceAudio = async () => {
  if (!videoFile.value || !replacementAudio.value) return;

  isProcessing.value = true;
  try {
    const outputPath = videoFile.value.path.replace(/\.[^.]+$/, '_new_audio$&');

    await window.electronAPI.invoke('video:replaceAudio', {
      videoPath: videoFile.value.path,
      audioPath: replacementAudio.value.path,
      outputPath: outputPath,
    });

    message.success('音轨替换成功');
  } catch (error) {
    message.error(`音轨替换失败: ${error.message}`);
  } finally {
    isProcessing.value = false;
  }
};

const adjustVolume = async () => {
  if (!videoFile.value) return;

  isProcessing.value = true;
  try {
    const outputPath = videoFile.value.path.replace(/\.[^.]+$/, '_volume$&');

    await window.electronAPI.invoke('video:adjustVolume', {
      inputPath: videoFile.value.path,
      outputPath: outputPath,
      volumeLevel: audioSettings.value.volumeLevel,
      normalize: audioSettings.value.normalize,
    });

    message.success('音量调整成功');
  } catch (error) {
    message.error(`音量调整失败: ${error.message}`);
  } finally {
    isProcessing.value = false;
  }
};

const addSubtitles = async () => {
  if (!videoFile.value || !subtitleFile.value) return;

  isProcessing.value = true;
  try {
    const outputPath = videoFile.value.path.replace(/\.[^.]+$/, '_subtitled$&');

    if (subtitleSettings.value.preset !== 'default') {
      await window.electronAPI.invoke('video:addSubtitlesWithPreset', {
        inputPath: videoFile.value.path,
        subtitlePath: subtitleFile.value.path,
        outputPath: outputPath,
        presetName: subtitleSettings.value.preset,
      });
    } else {
      await window.electronAPI.invoke('video:addSubtitles', {
        inputPath: videoFile.value.path,
        subtitlePath: subtitleFile.value.path,
        outputPath: outputPath,
        options: subtitleSettings.value,
      });
    }

    message.success('字幕添加成功');
  } catch (error) {
    message.error(`字幕添加失败: ${error.message}`);
  } finally {
    isProcessing.value = false;
  }
};

const generateThumbnail = async () => {
  if (!videoFile.value) return;

  isProcessing.value = true;
  try {
    const outputPath = videoFile.value.path.replace(/\.[^.]+$/, '_thumb.jpg');

    await window.electronAPI.invoke('video:generateThumbnail', {
      inputPath: videoFile.value.path,
      outputPath: outputPath,
    });

    message.success('缩略图生成成功');
  } catch (error) {
    message.error(`缩略图生成失败: ${error.message}`);
  } finally {
    isProcessing.value = false;
  }
};

const formatDuration = (seconds) => {
  if (!seconds) return '0秒';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}时${minutes}分${secs}秒`;
  } else if (minutes > 0) {
    return `${minutes}分${secs}秒`;
  } else {
    return `${secs}秒`;
  }
};

// 监听进度事件
if (window.electronAPI) {
  window.electronAPI.on('video:processing-progress', (event, data) => {
    processProgress.value = data.percent;
    processMessage.value = data.message || '';
  });
}
</script>

<style scoped lang="scss">
.video-editor {
  :deep(.ant-card-head) {
    background: linear-gradient(135deg, #ff6b6b 0%, #ee5a6f 100%);
    color: white;

    .ant-card-head-title {
      color: white;
    }
  }
}

.video-preview {
  width: 100%;
  height: 400px;
  background: #000;
  border-radius: 8px;
  overflow: hidden;
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  justify-content: center;

  .video-player {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .empty-preview {
    text-align: center;
    color: #666;

    p {
      margin-top: 16px;
      font-size: 14px;
    }
  }
}

.video-info {
  margin-top: 16px;
}

.edit-panel {
  h4 {
    margin-bottom: 16px;
    font-weight: 600;
    color: #262626;
  }
}
</style>
