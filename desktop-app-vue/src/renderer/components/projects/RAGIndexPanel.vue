<template>
  <div class="rag-index-panel">
    <a-card title="项目智能索引" :bordered="false">
      <template #extra>
        <a-space>
          <a-button
            type="primary"
            :loading="indexing"
            :icon="h(ReloadOutlined)"
            @click="handleIndex"
          >
            {{ indexing ? "索引中..." : "重新索引" }}
          </a-button>
          <a-button :icon="h(SyncOutlined)" @click="handleRefresh">
            刷新
          </a-button>
        </a-space>
      </template>

      <!-- 索引统计 -->
      <a-row :gutter="16" class="stats-row">
        <a-col :span="6">
          <a-statistic
            title="总文件数"
            :value="stats.totalFiles"
            :prefix="h(FileOutlined)"
          />
        </a-col>
        <a-col :span="6">
          <a-statistic
            title="已索引"
            :value="stats.indexedFiles"
            :value-style="{ color: '#3f8600' }"
            :prefix="h(CheckCircleOutlined)"
          />
        </a-col>
        <a-col :span="6">
          <a-statistic
            title="索引率"
            :value="stats.indexedPercentage"
            suffix="%"
            :value-style="{
              color: stats.indexedPercentage >= 80 ? '#3f8600' : '#cf1322',
            }"
          />
        </a-col>
        <a-col :span="6">
          <a-statistic
            title="未索引"
            :value="stats.totalFiles - stats.indexedFiles"
            :value-style="{ color: '#cf1322' }"
            :prefix="h(ExclamationCircleOutlined)"
          />
        </a-col>
      </a-row>

      <!-- 进度条 -->
      <div v-if="stats.totalFiles > 0" class="progress-section">
        <a-progress
          :percent="parseFloat(stats.indexedPercentage)"
          :status="stats.indexedPercentage >= 100 ? 'success' : 'active'"
        />
      </div>

      <!-- 索引选项 -->
      <a-divider>索引选项</a-divider>

      <a-form layout="vertical">
        <a-row :gutter="16">
          <a-col :span="12">
            <a-form-item label="文件类型过滤">
              <a-select
                v-model:value="indexOptions.fileTypes"
                mode="multiple"
                placeholder="选择要索引的文件类型（留空则全部）"
                :options="fileTypeOptions"
              />
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="索引模式">
              <a-radio-group v-model:value="indexOptions.forceReindex">
                <a-radio :value="false"> 增量索引（跳过已索引） </a-radio>
                <a-radio :value="true"> 强制重新索引 </a-radio>
              </a-radio-group>
            </a-form-item>
          </a-col>
        </a-row>
      </a-form>

      <!-- 最近索引历史 -->
      <a-divider>索引历史</a-divider>

      <a-timeline v-if="indexHistory.length > 0">
        <a-timeline-item
          v-for="item in indexHistory"
          :key="item.timestamp"
          :color="item.success ? 'green' : 'red'"
        >
          <template #dot>
            <CheckCircleOutlined v-if="item.success" style="color: #52c41a" />
            <CloseCircleOutlined v-else style="color: #ff4d4f" />
          </template>
          <p>
            <strong>{{ formatTime(item.timestamp) }}</strong>
          </p>
          <p v-if="item.success">
            成功索引 {{ item.indexedCount }} 个文件
            <span v-if="item.skippedCount > 0"
              >，跳过 {{ item.skippedCount }} 个</span
            >
          </p>
          <p v-else class="error-text">索引失败: {{ item.error }}</p>
        </a-timeline-item>
      </a-timeline>

      <a-empty v-else description="暂无索引历史" />
    </a-card>

    <!-- RAG查询测试面板 -->
    <a-card title="RAG查询测试" :bordered="false" style="margin-top: 16px">
      <a-form layout="vertical">
        <a-form-item label="测试查询">
          <a-textarea
            v-model:value="testQuery"
            placeholder="输入测试查询，例如：如何实现用户认证？"
            :rows="3"
          />
        </a-form-item>

        <a-form-item>
          <a-space>
            <a-button
              type="primary"
              :loading="querying"
              @click="handleTestQuery"
            >
              测试查询
            </a-button>
            <a-button @click="testQuery = ''"> 清空 </a-button>
          </a-space>
        </a-form-item>

        <!-- 查询结果 -->
        <div v-if="queryResult" class="query-result">
          <a-divider>查询结果</a-divider>

          <a-descriptions bordered size="small">
            <a-descriptions-item label="相关文档数">
              {{ queryResult.totalDocs }}
            </a-descriptions-item>
            <a-descriptions-item label="来源分布" :span="2">
              项目文件: {{ queryResult.sources.project }} | 知识库:
              {{ queryResult.sources.knowledge }} | 对话历史:
              {{ queryResult.sources.conversation }}
            </a-descriptions-item>
          </a-descriptions>

          <div class="context-summary" style="margin-top: 16px">
            <h4>上下文摘要：</h4>
            <pre>{{ queryResult.summary }}</pre>
          </div>

          <!-- 相关文档列表 -->
          <a-collapse
            v-if="queryResult.context.length > 0"
            style="margin-top: 16px"
          >
            <a-collapse-panel
              v-for="(doc, index) in queryResult.context"
              :key="index"
              :header="`文档 ${index + 1}: ${doc.metadata?.fileName || '未知'} (来源: ${doc.source})`"
            >
              <p>
                <strong>相关度分数:</strong>
                {{ doc.score?.toFixed(4) || "N/A" }}
              </p>
              <p><strong>内容预览:</strong></p>
              <pre class="doc-content"
                >{{ doc.content.substring(0, 500) }}...</pre
              >
            </a-collapse-panel>
          </a-collapse>
        </div>
      </a-form>
    </a-card>
  </div>
</template>

<script setup>
import { logger } from "@/utils/logger";

import { ref, onMounted, h } from "vue";
import { message } from "ant-design-vue";
import {
  ReloadOutlined,
  SyncOutlined,
  FileOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  CloseCircleOutlined,
} from "@ant-design/icons-vue";

const props = defineProps({
  projectId: {
    type: String,
    required: true,
  },
});

// 状态
const indexing = ref(false);
const querying = ref(false);
const stats = ref({
  totalFiles: 0,
  indexedFiles: 0,
  indexedPercentage: 0,
});

// 索引选项
const indexOptions = ref({
  fileTypes: [],
  forceReindex: false,
});

const fileTypeOptions = [
  { label: "Markdown (.md)", value: "md" },
  { label: "JavaScript (.js)", value: "js" },
  { label: "TypeScript (.ts)", value: "ts" },
  { label: "Python (.py)", value: "py" },
  { label: "Java (.java)", value: "java" },
  { label: "C++ (.cpp)", value: "cpp" },
  { label: "HTML (.html)", value: "html" },
  { label: "CSS (.css)", value: "css" },
  { label: "JSON (.json)", value: "json" },
  { label: "Text (.txt)", value: "txt" },
];

// 索引历史
const indexHistory = ref([]);

// 测试查询
const testQuery = ref("");
const queryResult = ref(null);

/**
 * 刷新统计信息
 */
async function handleRefresh() {
  try {
    const result = await window.electronAPI.project.getIndexStats(
      props.projectId,
    );
    stats.value = result;
  } catch (error) {
    logger.error("获取索引统计失败:", error);
    message.error("获取索引统计失败");
  }
}

/**
 * 执行索引
 */
async function handleIndex() {
  indexing.value = true;

  try {
    const options = {
      forceReindex: indexOptions.value.forceReindex,
    };

    if (indexOptions.value.fileTypes.length > 0) {
      options.fileTypes = indexOptions.value.fileTypes;
    }

    const result = await window.electronAPI.project.indexFiles(
      props.projectId,
      options,
    );

    // 添加到历史
    indexHistory.value.unshift({
      timestamp: Date.now(),
      success: true,
      indexedCount: result.indexedCount,
      skippedCount: result.skippedCount,
    });

    // 限制历史记录数量
    if (indexHistory.value.length > 10) {
      indexHistory.value = indexHistory.value.slice(0, 10);
    }

    message.success(`索引完成！已索引 ${result.indexedCount} 个文件`);

    // 刷新统计
    await handleRefresh();
  } catch (error) {
    logger.error("索引失败:", error);

    indexHistory.value.unshift({
      timestamp: Date.now(),
      success: false,
      error: error.message,
    });

    message.error("索引失败: " + error.message);
  } finally {
    indexing.value = false;
  }
}

/**
 * 测试RAG查询
 */
async function handleTestQuery() {
  if (!testQuery.value.trim()) {
    message.warning("请输入测试查询");
    return;
  }

  querying.value = true;
  queryResult.value = null;

  try {
    const result = await window.electronAPI.project.ragQuery(
      props.projectId,
      testQuery.value,
      {
        projectLimit: 5,
        knowledgeLimit: 3,
        conversationLimit: 3,
        useReranker: true,
      },
    );

    queryResult.value = result;
    message.success(`找到 ${result.totalDocs} 个相关文档`);
  } catch (error) {
    logger.error("RAG查询失败:", error);
    message.error("查询失败: " + error.message);
  } finally {
    querying.value = false;
  }
}

/**
 * 格式化时间
 */
function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleString("zh-CN");
}

// 初始化
onMounted(() => {
  handleRefresh();
});
</script>

<style scoped>
.rag-index-panel {
  padding: 16px;
}

.stats-row {
  margin-bottom: 24px;
}

.progress-section {
  margin: 24px 0;
}

.error-text {
  color: #ff4d4f;
}

.query-result {
  margin-top: 16px;
}

.context-summary pre {
  background: #f5f5f5;
  padding: 12px;
  border-radius: 4px;
  white-space: pre-wrap;
  word-wrap: break-word;
}

.doc-content {
  background: #fafafa;
  padding: 12px;
  border-radius: 4px;
  white-space: pre-wrap;
  word-wrap: break-word;
  max-height: 300px;
  overflow-y: auto;
}
</style>
