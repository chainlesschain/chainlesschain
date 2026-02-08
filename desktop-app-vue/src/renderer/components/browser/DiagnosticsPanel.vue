<template>
  <a-card title="🔍 浏览器诊断工具" :bordered="false" class="diagnostics-panel">
    <a-tabs v-model:active-key="activeTab" type="card">
      <!-- OCR 文本识别 -->
      <a-tab-pane key="ocr" tab="OCR 文本识别">
        <a-space direction="vertical" style="width: 100%" size="large">
          <!-- 语言选择 -->
          <a-form layout="inline">
            <a-form-item label="识别语言">
              <a-select
                v-model:value="ocrConfig.lang"
                style="width: 200px"
                :options="languageOptions"
              />
            </a-form-item>
            <a-form-item label="识别区域">
              <a-input-group compact>
                <a-input
                  v-model:value="ocrConfig.rectangle.left"
                  style="width: 60px"
                  placeholder="X"
                  type="number"
                />
                <a-input
                  v-model:value="ocrConfig.rectangle.top"
                  style="width: 60px"
                  placeholder="Y"
                  type="number"
                />
                <a-input
                  v-model:value="ocrConfig.rectangle.width"
                  style="width: 70px"
                  placeholder="宽度"
                  type="number"
                />
                <a-input
                  v-model:value="ocrConfig.rectangle.height"
                  style="width: 70px"
                  placeholder="高度"
                  type="number"
                />
              </a-input-group>
            </a-form-item>
            <a-form-item>
              <a-checkbox v-model:checked="ocrConfig.useFullPage">
                全屏识别
              </a-checkbox>
            </a-form-item>
          </a-form>

          <!-- 操作按钮 -->
          <a-space>
            <a-button
              type="primary"
              :loading="loading.ocr"
              @click="handleOCRRecognize"
            >
              <template #icon>
                <ScanOutlined />
              </template>
              开始识别
            </a-button>
            <a-button @click="handleClearOCRResult"> 清除结果 </a-button>
          </a-space>

          <!-- OCR 结果 -->
          <a-card v-if="ocrResult" title="识别结果" size="small">
            <template #extra>
              <a-space>
                <a-statistic
                  title="置信度"
                  :value="ocrResult.confidence"
                  suffix="%"
                  :value-style="{ fontSize: '14px' }"
                />
                <a-statistic
                  title="耗时"
                  :value="ocrResult.duration"
                  suffix="ms"
                  :value-style="{ fontSize: '14px' }"
                />
              </a-space>
            </template>

            <a-textarea
              v-model:value="ocrResult.text"
              :rows="8"
              placeholder="识别的文本将显示在这里..."
              readonly
            />

            <a-divider />

            <a-collapse v-if="ocrResult.words && ocrResult.words.length > 0">
              <a-collapse-panel key="words" header="详细单词信息">
                <a-table
                  :columns="ocrWordsColumns"
                  :data-source="ocrResult.words"
                  :pagination="{ pageSize: 10 }"
                  size="small"
                >
                  <template #bodyCell="{ column, record }">
                    <template v-if="column.key === 'confidence'">
                      <a-progress
                        :percent="record.confidence"
                        size="small"
                        :stroke-color="getConfidenceColor(record.confidence)"
                      />
                    </template>
                  </template>
                </a-table>
              </a-collapse-panel>
            </a-collapse>
          </a-card>
        </a-space>
      </a-tab-pane>

      <!-- 截图比对 -->
      <a-tab-pane key="diff" tab="截图比对">
        <a-space direction="vertical" style="width: 100%" size="large">
          <!-- 配置 -->
          <a-form layout="inline">
            <a-form-item label="相似度阈值">
              <a-slider
                v-model:value="diffConfig.threshold"
                :min="0"
                :max="1"
                :step="0.01"
                :tooltip="{ formatter: (v) => `${(v * 100).toFixed(0)}%` }"
                style="width: 200px"
              />
            </a-form-item>
            <a-form-item>
              <a-checkbox v-model:checked="diffConfig.antialiasing">
                忽略抗锯齿
              </a-checkbox>
            </a-form-item>
            <a-form-item>
              <a-checkbox v-model:checked="diffConfig.ignoreColors">
                灰度比较
              </a-checkbox>
            </a-form-item>
          </a-form>

          <!-- 截图上传 -->
          <a-row :gutter="16">
            <a-col :span="12">
              <a-card title="基准截图" size="small">
                <a-upload
                  :before-upload="
                    (file) => handleUploadScreenshot(file, 'baseline')
                  "
                  :show-upload-list="false"
                  accept="image/png,image/jpeg"
                >
                  <a-button>
                    <template #icon>
                      <UploadOutlined />
                    </template>
                    上传基准截图
                  </a-button>
                </a-upload>
                <div v-if="diffScreenshots.baseline" class="screenshot-preview">
                  <img :src="diffScreenshots.baseline" alt="Baseline" />
                </div>
              </a-card>
            </a-col>
            <a-col :span="12">
              <a-card title="当前截图" size="small">
                <a-space>
                  <a-upload
                    :before-upload="
                      (file) => handleUploadScreenshot(file, 'current')
                    "
                    :show-upload-list="false"
                    accept="image/png,image/jpeg"
                  >
                    <a-button>
                      <template #icon>
                        <UploadOutlined />
                      </template>
                      上传当前截图
                    </a-button>
                  </a-upload>
                  <a-button
                    type="primary"
                    :loading="loading.capture"
                    @click="handleCaptureCurrentScreenshot"
                  >
                    <template #icon>
                      <CameraOutlined />
                    </template>
                    截取当前页面
                  </a-button>
                </a-space>
                <div v-if="diffScreenshots.current" class="screenshot-preview">
                  <img :src="diffScreenshots.current" alt="Current" />
                </div>
              </a-card>
            </a-col>
          </a-row>

          <!-- 比对按钮 -->
          <a-button
            type="primary"
            size="large"
            :loading="loading.compare"
            :disabled="!diffScreenshots.baseline || !diffScreenshots.current"
            block
            @click="handleCompareScreenshots"
          >
            <template #icon>
              <DiffOutlined />
            </template>
            开始比对
          </a-button>

          <!-- 比对结果 -->
          <a-card v-if="diffResult" title="比对结果" size="small">
            <template #extra>
              <a-space>
                <a-badge
                  :status="diffResult.status === 'passed' ? 'success' : 'error'"
                  :text="diffResult.status === 'passed' ? '通过' : '失败'"
                />
                <a-statistic
                  title="相似度"
                  :value="(diffResult.similarity * 100).toFixed(2)"
                  suffix="%"
                  :value-style="{
                    fontSize: '16px',
                    color:
                      diffResult.status === 'passed' ? '#52c41a' : '#ff4d4f',
                  }"
                />
                <a-statistic
                  title="差异像素"
                  :value="diffResult.mismatchedPixels"
                  :value-style="{ fontSize: '14px' }"
                />
              </a-space>
            </template>

            <a-row v-if="diffResult.diffImage" :gutter="16">
              <a-col :span="24">
                <div class="diff-image-container">
                  <img
                    :src="`data:image/png;base64,${diffResult.diffImage}`"
                    alt="Diff"
                  />
                  <p class="diff-legend">
                    <span class="legend-item">
                      <span class="legend-color" style="background: #ff00ff" />
                      差异区域
                    </span>
                  </p>
                </div>
              </a-col>
            </a-row>

            <a-descriptions
              :column="2"
              size="small"
              bordered
              style="margin-top: 16px"
            >
              <a-descriptions-item label="分析尺寸">
                {{ diffResult.dimensions?.width }} x
                {{ diffResult.dimensions?.height }}
              </a-descriptions-item>
              <a-descriptions-item label="耗时">
                {{ diffResult.duration }} ms
              </a-descriptions-item>
              <a-descriptions-item label="差异百分比">
                {{
                  (
                    (diffResult.mismatchedPixels /
                      (diffResult.dimensions?.width *
                        diffResult.dimensions?.height)) *
                    100
                  ).toFixed(4)
                }}%
              </a-descriptions-item>
              <a-descriptions-item label="阈值">
                {{ (diffConfig.threshold * 100).toFixed(0) }}%
              </a-descriptions-item>
            </a-descriptions>
          </a-card>
        </a-space>
      </a-tab-pane>

      <!-- 诊断历史 -->
      <a-tab-pane key="history" tab="诊断历史">
        <a-space direction="vertical" style="width: 100%" size="large">
          <a-space>
            <a-button type="primary" @click="handleRefreshHistory">
              <template #icon>
                <ReloadOutlined />
              </template>
              刷新历史
            </a-button>
            <a-button danger @click="handleClearHistory">
              清除全部历史
            </a-button>
          </a-space>

          <a-table
            :columns="historyColumns"
            :data-source="diagnosticsHistory"
            :pagination="{ pageSize: 10 }"
            :loading="loading.history"
            row-key="id"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'type'">
                <a-tag :color="record.type === 'ocr' ? 'blue' : 'green'">
                  {{ record.type === "ocr" ? "OCR识别" : "截图比对" }}
                </a-tag>
              </template>
              <template v-if="column.key === 'status'">
                <a-badge
                  :status="record.status === 'success' ? 'success' : 'error'"
                  :text="record.status === 'success' ? '成功' : '失败'"
                />
              </template>
              <template v-if="column.key === 'timestamp'">
                {{ formatTimestamp(record.timestamp) }}
              </template>
              <template v-if="column.key === 'action'">
                <a-space>
                  <a-button
                    type="link"
                    size="small"
                    @click="handleViewHistoryDetail(record)"
                  >
                    查看详情
                  </a-button>
                  <a-button
                    type="link"
                    size="small"
                    danger
                    @click="handleDeleteHistory(record.id)"
                  >
                    删除
                  </a-button>
                </a-space>
              </template>
            </template>
          </a-table>
        </a-space>
      </a-tab-pane>
    </a-tabs>
  </a-card>
</template>

<script setup>
import { ref, reactive } from "vue";
import { message } from "ant-design-vue";
import {
  ScanOutlined,
  CameraOutlined,
  UploadOutlined,
  DiffOutlined,
  ReloadOutlined,
} from "@ant-design/icons-vue";

// Props
const props = defineProps({
  targetId: {
    type: String,
    required: true,
  },
});

// State
const activeTab = ref("ocr");

const loading = reactive({
  ocr: false,
  compare: false,
  capture: false,
  history: false,
});

// OCR Configuration
const ocrConfig = reactive({
  lang: "eng",
  rectangle: {
    left: 0,
    top: 0,
    width: 0,
    height: 0,
  },
  useFullPage: true,
});

const languageOptions = [
  { label: "English", value: "eng" },
  { label: "简体中文", value: "chi_sim" },
  { label: "繁体中文", value: "chi_tra" },
  { label: "日本語", value: "jpn" },
  { label: "한국어", value: "kor" },
  { label: "Español", value: "spa" },
  { label: "Français", value: "fra" },
  { label: "Deutsch", value: "deu" },
];

const ocrResult = ref(null);

const ocrWordsColumns = [
  { title: "文本", dataIndex: "text", key: "text" },
  { title: "置信度", dataIndex: "confidence", key: "confidence", width: 200 },
  { title: "X", dataIndex: "x", key: "x", width: 60 },
  { title: "Y", dataIndex: "y", key: "y", width: 60 },
];

// Screenshot Diff Configuration
const diffConfig = reactive({
  threshold: 0.95,
  antialiasing: true,
  ignoreColors: false,
});

const diffScreenshots = reactive({
  baseline: null,
  current: null,
});

const diffResult = ref(null);

// History
const diagnosticsHistory = ref([]);

const historyColumns = [
  { title: "类型", dataIndex: "type", key: "type", width: 120 },
  { title: "状态", dataIndex: "status", key: "status", width: 100 },
  { title: "时间", dataIndex: "timestamp", key: "timestamp", width: 180 },
  { title: "描述", dataIndex: "description", key: "description" },
  { title: "操作", key: "action", width: 180 },
];

// Methods

/**
 * OCR 文本识别
 */
const handleOCRRecognize = async () => {
  loading.ocr = true;
  try {
    const options = {
      lang: ocrConfig.lang,
    };

    // 如果不是全屏识别，添加区域参数
    if (
      !ocrConfig.useFullPage &&
      (ocrConfig.rectangle.width > 0 || ocrConfig.rectangle.height > 0)
    ) {
      options.rectangle = { ...ocrConfig.rectangle };
    }

    const result = await window.electron.ipcRenderer.invoke(
      "browser:ocr:recognize",
      props.targetId,
      options,
    );

    ocrResult.value = result;

    // 添加到历史
    addToHistory({
      type: "ocr",
      status: "success",
      description: `识别语言: ${ocrConfig.lang}, 置信度: ${result.confidence.toFixed(2)}%`,
      data: result,
    });

    message.success("OCR 识别完成");
  } catch (error) {
    message.error("OCR 识别失败: " + error.message);
    console.error("OCR error:", error);

    addToHistory({
      type: "ocr",
      status: "error",
      description: `识别失败: ${error.message}`,
    });
  } finally {
    loading.ocr = false;
  }
};

const handleClearOCRResult = () => {
  ocrResult.value = null;
};

const getConfidenceColor = (confidence) => {
  if (confidence >= 90) {
    return "#52c41a";
  }
  if (confidence >= 70) {
    return "#faad14";
  }
  return "#ff4d4f";
};

/**
 * 截图上传
 */
const handleUploadScreenshot = (file, type) => {
  const reader = new FileReader();
  reader.onload = (e) => {
    diffScreenshots[type] = e.target.result;
    message.success(`${type === "baseline" ? "基准" : "当前"}截图已加载`);
  };
  reader.readAsDataURL(file);
  return false; // 阻止自动上传
};

/**
 * 截取当前页面
 */
const handleCaptureCurrentScreenshot = async () => {
  loading.capture = true;
  try {
    const result = await window.electron.ipcRenderer.invoke(
      "browser:screenshot",
      props.targetId,
      { type: "png", fullPage: false },
    );

    diffScreenshots.current = `data:image/png;base64,${result.screenshot}`;
    message.success("当前页面截图成功");
  } catch (error) {
    message.error("截图失败: " + error.message);
    console.error("Screenshot error:", error);
  } finally {
    loading.capture = false;
  }
};

/**
 * 比对截图
 */
const handleCompareScreenshots = async () => {
  loading.compare = true;
  try {
    // 提取 base64 数据
    const baselineBase64 = diffScreenshots.baseline.split(",")[1];
    const currentBase64 = diffScreenshots.current.split(",")[1];

    const result = await window.electron.ipcRenderer.invoke(
      "browser:screenshot:compare",
      baselineBase64,
      currentBase64,
      {
        threshold: diffConfig.threshold,
        antialiasing: diffConfig.antialiasing,
        ignoreColors: diffConfig.ignoreColors,
        generateDiff: true,
      },
    );

    diffResult.value = result;

    // 添加到历史
    addToHistory({
      type: "diff",
      status: result.status === "passed" ? "success" : "warning",
      description: `相似度: ${(result.similarity * 100).toFixed(2)}%, 差异像素: ${result.mismatchedPixels}`,
      data: result,
    });

    if (result.status === "passed") {
      message.success("截图比对通过");
    } else {
      message.warning("截图比对失败，存在差异");
    }
  } catch (error) {
    message.error("截图比对失败: " + error.message);
    console.error("Compare error:", error);

    addToHistory({
      type: "diff",
      status: "error",
      description: `比对失败: ${error.message}`,
    });
  } finally {
    loading.compare = false;
  }
};

/**
 * 历史管理
 */
const addToHistory = (item) => {
  const historyItem = {
    id: Date.now() + Math.random(),
    timestamp: Date.now(),
    ...item,
  };
  diagnosticsHistory.value.unshift(historyItem);

  // 限制历史记录数量
  if (diagnosticsHistory.value.length > 100) {
    diagnosticsHistory.value = diagnosticsHistory.value.slice(0, 100);
  }
};

const handleRefreshHistory = () => {
  message.info("历史记录已刷新");
};

const handleClearHistory = () => {
  diagnosticsHistory.value = [];
  message.success("历史记录已清除");
};

const handleViewHistoryDetail = (record) => {
  console.log("View history detail:", record);
  message.info("查看详情功能开发中");
};

const handleDeleteHistory = (id) => {
  diagnosticsHistory.value = diagnosticsHistory.value.filter(
    (item) => item.id !== id,
  );
  message.success("已删除");
};

const formatTimestamp = (timestamp) => {
  return new Date(timestamp).toLocaleString("zh-CN");
};
</script>

<style scoped lang="less">
.diagnostics-panel {
  :deep(.ant-card-body) {
    padding: 16px;
  }

  .screenshot-preview {
    margin-top: 16px;
    border: 1px solid #d9d9d9;
    border-radius: 4px;
    padding: 8px;
    text-align: center;
    background: #fafafa;

    img {
      max-width: 100%;
      max-height: 300px;
      object-fit: contain;
    }
  }

  .diff-image-container {
    text-align: center;
    padding: 16px;
    background: #fafafa;
    border-radius: 4px;

    img {
      max-width: 100%;
      border: 1px solid #d9d9d9;
      border-radius: 4px;
    }

    .diff-legend {
      margin-top: 12px;
      font-size: 12px;

      .legend-item {
        display: inline-flex;
        align-items: center;
        margin-right: 16px;

        .legend-color {
          display: inline-block;
          width: 20px;
          height: 12px;
          margin-right: 6px;
          border: 1px solid #d9d9d9;
        }
      }
    }
  }
}
</style>
