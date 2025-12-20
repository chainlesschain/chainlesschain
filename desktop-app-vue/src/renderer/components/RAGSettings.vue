<template>
  <div class="rag-settings">
    <a-card title="RAG 配置" class="config-card">
      <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }">
        <!-- 启用 RAG -->
        <a-form-item label="启用 RAG">
          <a-switch
            v-model:checked="config.enableRAG"
            @change="handleConfigChange"
          />
          <div class="form-item-tip">
            使用知识库增强 AI 回答的准确性和相关性
          </div>
        </a-form-item>

        <a-divider />

        <!-- 检索参数 -->
        <a-form-item label="返回结果数量">
          <a-slider
            v-model:value="config.topK"
            :min="1"
            :max="20"
            :disabled="!config.enableRAG"
            @change="handleConfigChange"
          />
          <div class="slider-value">{{ config.topK }} 个</div>
          <div class="form-item-tip">
            每次检索返回的最相关知识条目数量
          </div>
        </a-form-item>

        <a-form-item label="相似度阈值">
          <a-slider
            v-model:value="config.similarityThreshold"
            :min="0"
            :max="1"
            :step="0.1"
            :disabled="!config.enableRAG"
            @change="handleConfigChange"
          />
          <div class="slider-value">{{ config.similarityThreshold.toFixed(1) }}</div>
          <div class="form-item-tip">
            只返回相似度高于此阈值的结果（0-1）
          </div>
        </a-form-item>

        <a-form-item label="最大上下文长度">
          <a-slider
            v-model:value="config.maxContextLength"
            :min="500"
            :max="5000"
            :step="100"
            :disabled="!config.enableRAG"
            @change="handleConfigChange"
          />
          <div class="slider-value">{{ config.maxContextLength }} 字符</div>
          <div class="form-item-tip">
            传递给 AI 的知识库上下文最大长度
          </div>
        </a-form-item>

        <a-divider />

        <!-- 搜索模式 -->
        <a-form-item label="混合搜索">
          <a-switch
            v-model:checked="config.enableHybridSearch"
            :disabled="!config.enableRAG"
            @change="handleConfigChange"
          />
          <div class="form-item-tip">
            结合向量搜索和关键词搜索以获得更好的结果
          </div>
        </a-form-item>

        <a-form-item
          v-if="config.enableHybridSearch"
          label="向量搜索权重"
        >
          <a-slider
            v-model:value="config.vectorWeight"
            :min="0"
            :max="1"
            :step="0.1"
            :disabled="!config.enableRAG"
            @change="handleVectorWeightChange"
          />
          <div class="slider-value">{{ config.vectorWeight.toFixed(1) }}</div>
          <div class="form-item-tip">
            向量搜索在混合搜索中的权重
          </div>
        </a-form-item>

        <a-form-item
          v-if="config.enableHybridSearch"
          label="关键词搜索权重"
        >
          <a-slider
            v-model:value="config.keywordWeight"
            :min="0"
            :max="1"
            :step="0.1"
            :disabled="!config.enableRAG"
            @change="handleKeywordWeightChange"
          />
          <div class="slider-value">{{ config.keywordWeight.toFixed(1) }}</div>
          <div class="form-item-tip">
            关键词搜索在混合搜索中的权重
          </div>
        </a-form-item>

        <a-divider />

        <!-- 高级选项 -->
        <a-form-item label="重排序">
          <a-switch
            v-model:checked="config.enableReranking"
            :disabled="!config.enableRAG"
            @change="handleConfigChange"
          />
          <div class="form-item-tip">
            对检索结果进行二次排序（需要额外的 LLM 调用）
          </div>
        </a-form-item>

        <!-- 保存按钮 -->
        <a-form-item :wrapper-col="{ offset: 6, span: 18 }">
          <a-space>
            <a-button
              type="primary"
              :loading="saving"
              @click="handleSave"
            >
              保存配置
            </a-button>
            <a-button @click="handleReset">
              重置为默认
            </a-button>
          </a-space>
        </a-form-item>
      </a-form>
    </a-card>

    <!-- 向量存储状态 -->
    <a-card title="向量存储" class="vector-store-card">
      <a-spin :spinning="loadingStats">
        <a-descriptions bordered :column="1">
          <a-descriptions-item label="存储模式">
            <a-tag v-if="stats.storageMode === 'chromadb'" color="success">
              ChromaDB (持久化)
            </a-tag>
            <a-tag v-else-if="stats.storageMode === 'memory'" color="warning">
              内存模式 (临时)
            </a-tag>
            <a-tag v-else color="default">
              未知
            </a-tag>
          </a-descriptions-item>
          <a-descriptions-item v-if="stats.chromaUrl" label="ChromaDB地址">
            {{ stats.chromaUrl }}
          </a-descriptions-item>
          <a-descriptions-item label="索引文档数">
            {{ stats.totalItems || 0 }} 个
          </a-descriptions-item>
          <a-descriptions-item label="缓存命中率">
            {{ cacheHitRate }}%
          </a-descriptions-item>
          <a-descriptions-item label="缓存大小">
            {{ stats.cacheStats?.size || 0 }} / {{ stats.cacheStats?.maxSize || 0 }}
          </a-descriptions-item>
        </a-descriptions>

        <a-alert
          v-if="stats.storageMode === 'memory'"
          style="margin-top: 16px"
          type="warning"
          message="当前使用内存模式"
          description="ChromaDB服务未连接，向量数据存储在内存中，应用重启后将丢失。建议启动ChromaDB服务以获得持久化存储。"
          show-icon
        />

        <a-alert
          v-if="stats.storageMode === 'chromadb'"
          style="margin-top: 16px"
          type="success"
          message="ChromaDB已连接"
          description="向量数据已持久化存储到ChromaDB，重启应用后数据不会丢失。"
          show-icon
        />
      </a-spin>
    </a-card>

    <!-- 索引管理 -->
    <a-card title="索引管理" class="stats-card">
      <a-spin :spinning="loadingStats">
        <div style="margin-bottom: 16px">
          <a-space>
            <a-button
              type="primary"
              :loading="rebuilding"
              @click="handleRebuildIndex"
            >
              <template #icon><reload-outlined /></template>
              重建索引
            </a-button>
            <a-button @click="loadStats">
              <template #icon><sync-outlined /></template>
              刷新统计
            </a-button>
          </a-space>
        </div>

        <a-alert
          type="info"
          message="关于向量索引"
          description="重建索引会为所有知识库条目重新生成向量嵌入。如果您修改了大量知识库内容或更换了嵌入模型，建议重建索引以获得最佳检索效果。"
          show-icon
        />
      </a-spin>
    </a-card>

    <!-- RAG 工作流程说明 -->
    <a-card title="RAG 工作流程" class="workflow-card">
      <div class="workflow-steps">
        <div class="workflow-step">
          <div class="step-number">1</div>
          <div class="step-content">
            <div class="step-title">用户提问</div>
            <div class="step-desc">用户在 AI 对话中输入问题</div>
          </div>
        </div>

        <div class="workflow-arrow">↓</div>

        <div class="workflow-step">
          <div class="step-number">2</div>
          <div class="step-content">
            <div class="step-title">检索相关知识</div>
            <div class="step-desc">在知识库中搜索与问题相关的内容</div>
          </div>
        </div>

        <div class="workflow-arrow">↓</div>

        <div class="workflow-step">
          <div class="step-number">3</div>
          <div class="step-content">
            <div class="step-title">构建增强上下文</div>
            <div class="step-desc">将检索到的知识与用户问题组合</div>
          </div>
        </div>

        <div class="workflow-arrow">↓</div>

        <div class="workflow-step">
          <div class="step-number">4</div>
          <div class="step-content">
            <div class="step-title">生成回答</div>
            <div class="step-desc">AI 基于知识库内容生成准确回答</div>
          </div>
        </div>
      </div>
    </a-card>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { message } from 'ant-design-vue';
import { ReloadOutlined, SyncOutlined } from '@ant-design/icons-vue';

// 配置
const config = ref({
  enableRAG: true,
  topK: 5,
  similarityThreshold: 0.3,
  maxContextLength: 2000,
  enableHybridSearch: true,
  vectorWeight: 0.7,
  keywordWeight: 0.3,
  enableReranking: false,
});

// 统计信息
const stats = ref({
  totalItems: 0,
  cacheStats: {
    size: 0,
    maxSize: 1000,
    hits: 0,
    misses: 0,
  },
});

// 状态
const saving = ref(false);
const loadingStats = ref(false);
const rebuilding = ref(false);

// 计算缓存命中率
const cacheHitRate = computed(() => {
  const { hits = 0, misses = 0 } = stats.value.cacheStats || {};
  const total = hits + misses;
  return total > 0 ? ((hits / total) * 100).toFixed(1) : '0.0';
});

// 加载统计信息
const loadStats = async () => {
  loadingStats.value = true;
  try {
    const result = await window.electronAPI.rag.getStats();
    stats.value = result;
  } catch (error) {
    console.error('[RAGSettings] 加载统计失败:', error);
    message.error('加载统计信息失败');
  } finally {
    loadingStats.value = false;
  }
};

// 处理配置变更
const handleConfigChange = () => {
  // 配置变更时可以显示未保存提示
};

// 处理向量权重变更
const handleVectorWeightChange = (value) => {
  config.value.keywordWeight = parseFloat((1 - value).toFixed(1));
};

// 处理关键词权重变更
const handleKeywordWeightChange = (value) => {
  config.value.vectorWeight = parseFloat((1 - value).toFixed(1));
};

// 保存配置
const handleSave = async () => {
  saving.value = true;
  try {
    // 转换为普通对象以避免结构化克隆错误
    const plainConfig = JSON.parse(JSON.stringify(config.value));
    await window.electronAPI.rag.updateConfig(plainConfig);
    message.success('RAG 配置已保存');
  } catch (error) {
    console.error('[RAGSettings] 保存配置失败:', error);
    message.error('保存配置失败');
  } finally {
    saving.value = false;
  }
};

// 重置配置
const handleReset = () => {
  config.value = {
    enableRAG: true,
    topK: 5,
    similarityThreshold: 0.3,
    maxContextLength: 2000,
    enableHybridSearch: true,
    vectorWeight: 0.7,
    keywordWeight: 0.3,
    enableReranking: false,
  };
  message.info('已重置为默认配置');
};

// 重建索引
const handleRebuildIndex = async () => {
  rebuilding.value = true;
  try {
    await window.electronAPI.rag.rebuildIndex();
    message.success('向量索引重建成功');
    await loadStats(); // 重新加载统计
  } catch (error) {
    console.error('[RAGSettings] 重建索引失败:', error);
    message.error('重建索引失败');
  } finally {
    rebuilding.value = false;
  }
};

// 组件挂载时加载统计
onMounted(async () => {
  await loadStats();
});
</script>

<style scoped>
.rag-settings {
  height: 100%;
}

.config-card,
.vector-store-card,
.stats-card,
.workflow-card {
  margin-bottom: 16px;
}

.form-item-tip {
  color: rgba(0, 0, 0, 0.45);
  font-size: 12px;
  margin-top: 4px;
}

.slider-value {
  text-align: center;
  color: #1890ff;
  font-weight: 500;
  margin-top: 4px;
}

/* 工作流程样式 */
.workflow-steps {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.workflow-step {
  display: flex;
  align-items: center;
  width: 100%;
  max-width: 500px;
  padding: 16px;
  background: #f5f5f5;
  border-radius: 8px;
  margin: 8px 0;
}

.step-number {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: #1890ff;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  font-weight: bold;
  margin-right: 16px;
}

.step-content {
  flex: 1;
}

.step-title {
  font-size: 16px;
  font-weight: 500;
  color: rgba(0, 0, 0, 0.85);
  margin-bottom: 4px;
}

.step-desc {
  font-size: 14px;
  color: rgba(0, 0, 0, 0.45);
}

.workflow-arrow {
  font-size: 24px;
  color: #1890ff;
  margin: 4px 0;
}
</style>
