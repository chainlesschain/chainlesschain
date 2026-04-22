<template>
  <div class="multimodal-collab-page">
    <!-- 页面头部 -->
    <div class="page-header">
      <div class="header-left">
        <h2>多模态协作</h2>
        <span class="subtitle">Multimodal Collaboration</span>
      </div>
      <div class="header-right">
        <a-button @click="handleGetStats"> 统计 </a-button>
      </div>
    </div>

    <!-- 输入区域 -->
    <a-card title="输入" size="small" class="input-section">
      <div class="modality-selector">
        <a-radio-group v-model:value="selectedModality" button-style="solid">
          <a-radio-button value="text"> 文本 </a-radio-button>
          <a-radio-button value="document"> 文档 </a-radio-button>
          <a-radio-button value="image"> 图像 </a-radio-button>
          <a-radio-button value="screen"> 屏幕捕获 </a-radio-button>
        </a-radio-group>
      </div>

      <!-- 文本输入 -->
      <div v-if="selectedModality === 'text'" class="input-area">
        <a-textarea
          v-model:value="textInput"
          placeholder="输入文本内容..."
          :rows="4"
        />
        <a-button
          type="primary"
          style="margin-top: 8px"
          :loading="store.loading"
          @click="handleAddText"
        >
          添加文本
        </a-button>
      </div>

      <!-- 文档上传 -->
      <div v-if="selectedModality === 'document'" class="input-area">
        <a-upload-dragger
          :before-upload="handleDocumentUpload"
          :show-upload-list="false"
          accept=".pdf,.doc,.docx,.txt,.md"
        >
          <p class="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p class="ant-upload-text">点击或拖拽上传文档</p>
          <p class="ant-upload-hint">支持 PDF、Word、TXT、Markdown</p>
        </a-upload-dragger>
      </div>

      <!-- 图像上传 -->
      <div v-if="selectedModality === 'image'" class="input-area">
        <a-upload-dragger
          :before-upload="handleImageUpload"
          :show-upload-list="false"
          accept=".png,.jpg,.jpeg,.gif,.webp"
        >
          <p class="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p class="ant-upload-text">点击或拖拽上传图像</p>
          <p class="ant-upload-hint">支持 PNG、JPG、GIF、WebP</p>
        </a-upload-dragger>
      </div>

      <!-- 屏幕捕获 -->
      <div v-if="selectedModality === 'screen'" class="input-area">
        <a-button
          type="primary"
          :loading="store.loading"
          @click="handleCaptureScreen"
        >
          捕获屏幕
        </a-button>
      </div>

      <!-- 已添加的输入列表 -->
      <div v-if="pendingInputs.length > 0" class="pending-inputs">
        <h4>待融合输入 ({{ pendingInputs.length }})</h4>
        <a-tag
          v-for="(input, idx) in pendingInputs"
          :key="idx"
          closable
          @close="pendingInputs.splice(idx, 1)"
        >
          {{ input.modality }}: {{ input.summary || "..." }}
        </a-tag>
        <a-button
          type="primary"
          style="margin-top: 8px"
          :loading="store.loading"
          @click="handleFuse"
        >
          融合输入
        </a-button>
      </div>
    </a-card>

    <!-- 上下文预览 -->
    <a-card
      v-if="store.currentSession"
      title="上下文预览"
      size="small"
      class="context-section"
    >
      <div class="token-budget">
        <span>Token 预算:</span>
        <a-progress
          :percent="store.tokenBudgetPercent"
          :status="store.tokenBudgetPercent > 90 ? 'exception' : 'active'"
          style="flex: 1; margin-left: 12px"
        />
        <span class="token-info"
          >{{ store.tokenBudgetUsed }} / {{ store.tokenBudgetTotal }}</span
        >
      </div>
      <div class="session-inputs">
        <h4>融合内容 ({{ store.currentSession.inputs?.length || 0 }} 项)</h4>
        <a-tag v-for="input in store.currentSession.inputs" :key="input.id">
          {{ input.modality }} ({{ input.tokenCost }} tokens)
        </a-tag>
      </div>
    </a-card>

    <!-- 输出区域 -->
    <a-card
      v-if="store.currentSession"
      title="输出"
      size="small"
      class="output-section"
    >
      <div class="output-format">
        <span>输出格式:</span>
        <a-radio-group v-model:value="outputFormat" style="margin-left: 12px">
          <a-radio-button value="markdown"> Markdown </a-radio-button>
          <a-radio-button value="html"> HTML </a-radio-button>
          <a-radio-button value="echarts"> ECharts </a-radio-button>
          <a-radio-button value="ppt"> PPT </a-radio-button>
        </a-radio-group>
        <a-button
          type="primary"
          style="margin-left: 12px"
          :loading="store.loading"
          @click="handleGenerateOutput"
        >
          生成输出
        </a-button>
      </div>

      <!-- 渲染区 -->
      <div v-if="latestArtifact" class="render-area">
        <!-- eslint-disable vue/no-v-html -- sanitized via safeHtml / renderMarkdown / DOMPurify; see AUDIT_2026-04-22.md §3 -->
        <div
          v-if="outputFormat === 'markdown' || outputFormat === 'html'"
          class="rendered-content"
          v-html="safeHtml(latestArtifact.content)"
        />
        <!-- eslint-enable vue/no-v-html -->
        <pre v-else class="raw-content">{{ latestArtifact.content }}</pre>
      </div>
    </a-card>

    <!-- 历史产物 -->
    <a-card
      v-if="store.artifacts.length > 0"
      title="生成历史"
      size="small"
      class="artifacts-section"
    >
      <a-list :data-source="store.artifacts" size="small">
        <template #renderItem="{ item }">
          <a-list-item>
            <a-list-item-meta
              :title="item.format.toUpperCase()"
              :description="`${item.size} bytes | ${item.createdAt}`"
            />
          </a-list-item>
        </template>
      </a-list>
    </a-card>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { InboxOutlined } from "@ant-design/icons-vue";
import { message } from "ant-design-vue";
import { useMultimodalStore } from "../stores/multimodal";
import { safeHtml } from "@/utils/sanitizeHtml";

const store = useMultimodalStore();

const selectedModality = ref("text");
const textInput = ref("");
const outputFormat = ref("markdown");
const pendingInputs = ref<
  { modality: string; content: any; summary: string }[]
>([]);

const latestArtifact = computed(() => {
  if (store.artifacts.length === 0) {
    return null;
  }
  return store.artifacts[store.artifacts.length - 1];
});

function handleAddText() {
  if (!textInput.value.trim()) {
    message.warning("请输入文本内容");
    return;
  }
  pendingInputs.value.push({
    modality: "text",
    content: textInput.value,
    summary:
      textInput.value.substring(0, 30) +
      (textInput.value.length > 30 ? "..." : ""),
  });
  textInput.value = "";
  message.success("文本已添加");
}

function handleDocumentUpload(file: File) {
  pendingInputs.value.push({
    modality: "document",
    content: { name: file.name, path: (file as any).path || file.name },
    summary: file.name,
  });
  message.success(`文档 ${file.name} 已添加`);
  return false;
}

function handleImageUpload(file: File) {
  pendingInputs.value.push({
    modality: "image",
    content: { name: file.name, path: (file as any).path || file.name },
    summary: file.name,
  });
  message.success(`图像 ${file.name} 已添加`);
  return false;
}

async function handleCaptureScreen() {
  const result = await store.captureScreen();
  if (result.success && result.data) {
    pendingInputs.value.push({
      modality: "screen",
      content: result.data,
      summary: "屏幕截图",
    });
    message.success("屏幕已捕获");
  } else {
    message.error(result.error || "屏幕捕获失败");
  }
}

async function handleFuse() {
  if (pendingInputs.value.length === 0) {
    return;
  }
  const result = await store.fuseInput(pendingInputs.value);
  if (result.success) {
    message.success("输入融合完成");
    pendingInputs.value = [];
  } else {
    message.error(result.error || "融合失败");
  }
}

async function handleGenerateOutput() {
  if (!store.currentSession) {
    return;
  }
  const result = await store.generateOutput(
    store.currentSession.id,
    outputFormat.value,
  );
  if (result.success) {
    message.success("输出生成完成");
  } else {
    message.error(result.error || "生成失败");
  }
}

async function handleGetStats() {
  await store.getStats();
  if (store.stats) {
    message.info(
      `总会话: ${store.stats.totalSessions}, 总输入: ${store.stats.totalInputs}`,
    );
  }
}

onMounted(async () => {
  await store.getSupportedModalities();
});
</script>

<style lang="less" scoped>
.multimodal-collab-page {
  padding: 24px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;

  .header-left {
    h2 {
      margin: 0;
    }
    .subtitle {
      color: rgba(0, 0, 0, 0.45);
      font-size: 14px;
    }
  }
}

.input-section {
  margin-bottom: 16px;
}

.modality-selector {
  margin-bottom: 16px;
}

.input-area {
  margin-bottom: 16px;
}

.pending-inputs {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid #f0f0f0;

  h4 {
    margin-bottom: 8px;
  }
}

.context-section {
  margin-bottom: 16px;
}

.token-budget {
  display: flex;
  align-items: center;
  margin-bottom: 12px;

  .token-info {
    margin-left: 12px;
    color: rgba(0, 0, 0, 0.45);
    font-size: 12px;
    white-space: nowrap;
  }
}

.session-inputs {
  h4 {
    margin-bottom: 8px;
  }
}

.output-section {
  margin-bottom: 16px;
}

.output-format {
  display: flex;
  align-items: center;
  margin-bottom: 16px;
}

.render-area {
  margin-top: 16px;
  padding: 16px;
  background: #fafafa;
  border-radius: 4px;
  min-height: 200px;
  max-height: 500px;
  overflow: auto;
}

.raw-content {
  margin: 0;
  font-family: "Consolas", "Monaco", monospace;
  font-size: 13px;
}

.artifacts-section {
  margin-top: 16px;
}
</style>
