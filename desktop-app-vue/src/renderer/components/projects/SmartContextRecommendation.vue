<template>
  <div
    v-if="recommendations.length > 0"
    class="smart-context-panel"
  >
    <div class="context-header">
      <h4 class="context-title">
        <BulbOutlined />
        智能推荐
      </h4>
      <a-tooltip title="根据对话内容智能推荐相关文件和上下文">
        <QuestionCircleOutlined class="help-icon" />
      </a-tooltip>
    </div>

    <div class="recommendations-list">
      <a-collapse
        v-model:active-key="activeKeys"
        ghost
      >
        <!-- 相关文件推荐 -->
        <a-collapse-panel
          v-if="fileRecommendations.length > 0"
          key="files"
          header="相关文件"
        >
          <template #extra>
            <a-badge
              :count="fileRecommendations.length"
              :number-style="{ backgroundColor: '#52c41a' }"
            />
          </template>
          <div class="recommendation-items">
            <div
              v-for="file in fileRecommendations"
              :key="file.id"
              :class="[
                'recommendation-item',
                { selected: selectedFiles.includes(file.id) },
              ]"
              @click="toggleFileSelection(file)"
            >
              <div class="item-icon">
                <FileTextOutlined />
              </div>
              <div class="item-content">
                <div class="item-name">
                  {{ file.name }}
                </div>
                <div class="item-reason">
                  {{ file.reason }}
                </div>
                <div class="item-score">
                  <span>相关度:</span>
                  <a-progress
                    :percent="file.relevanceScore"
                    size="small"
                    :show-info="false"
                    :stroke-color="getScoreColor(file.relevanceScore)"
                  />
                  <span class="score-value">{{ file.relevanceScore }}%</span>
                </div>
              </div>
              <div class="item-actions">
                <a-button
                  size="small"
                  :type="selectedFiles.includes(file.id) ? 'primary' : 'text'"
                  @click.stop="toggleFileSelection(file)"
                >
                  {{ selectedFiles.includes(file.id) ? "已选择" : "选择" }}
                </a-button>
              </div>
            </div>
          </div>
        </a-collapse-panel>

        <!-- 历史对话推荐 -->
        <a-collapse-panel
          v-if="conversationRecommendations.length > 0"
          key="conversations"
          header="相关对话"
        >
          <template #extra>
            <a-badge
              :count="conversationRecommendations.length"
              :number-style="{ backgroundColor: '#1890ff' }"
            />
          </template>
          <div class="recommendation-items">
            <div
              v-for="conv in conversationRecommendations"
              :key="conv.id"
              class="recommendation-item"
              @click="handleConversationClick(conv)"
            >
              <div class="item-icon">
                <MessageOutlined />
              </div>
              <div class="item-content">
                <div class="item-name">
                  {{ conv.summary }}
                </div>
                <div class="item-reason">
                  {{ conv.reason }}
                </div>
                <div class="item-time">
                  {{ formatTime(conv.timestamp) }}
                </div>
              </div>
              <div class="item-actions">
                <a-button
                  size="small"
                  type="text"
                >
                  查看
                </a-button>
              </div>
            </div>
          </div>
        </a-collapse-panel>

        <!-- 相关知识推荐 -->
        <a-collapse-panel
          v-if="knowledgeRecommendations.length > 0"
          key="knowledge"
          header="相关知识"
        >
          <template #extra>
            <a-badge
              :count="knowledgeRecommendations.length"
              :number-style="{ backgroundColor: '#faad14' }"
            />
          </template>
          <div class="recommendation-items">
            <div
              v-for="knowledge in knowledgeRecommendations"
              :key="knowledge.id"
              class="recommendation-item"
              @click="handleKnowledgeClick(knowledge)"
            >
              <div class="item-icon">
                <BookOutlined />
              </div>
              <div class="item-content">
                <div class="item-name">
                  {{ knowledge.title }}
                </div>
                <div class="item-preview">
                  {{ knowledge.preview }}
                </div>
                <div class="item-tags">
                  <a-tag
                    v-for="tag in knowledge.tags"
                    :key="tag"
                    size="small"
                  >
                    {{ tag }}
                  </a-tag>
                </div>
              </div>
              <div class="item-actions">
                <a-button
                  size="small"
                  type="text"
                >
                  查看
                </a-button>
              </div>
            </div>
          </div>
        </a-collapse-panel>
      </a-collapse>
    </div>

    <!-- 应用选择的上下文 -->
    <div
      v-if="selectedFiles.length > 0"
      class="context-actions"
    >
      <a-button
        type="primary"
        size="small"
        block
        @click="applyContext"
      >
        <PlusCircleOutlined />
        添加 {{ selectedFiles.length }} 个文件到上下文
      </a-button>
    </div>
  </div>
</template>

<script setup>
import { logger } from "@/utils/logger";

import { ref, computed, watch } from "vue";
import {
  BulbOutlined,
  QuestionCircleOutlined,
  FileTextOutlined,
  MessageOutlined,
  BookOutlined,
  PlusCircleOutlined,
} from "@ant-design/icons-vue";

const props = defineProps({
  projectId: {
    type: String,
    required: true,
  },
  currentMessage: {
    type: String,
    default: "",
  },
  conversationHistory: {
    type: Array,
    default: () => [],
  },
  projectFiles: {
    type: Array,
    default: () => [],
  },
});

const emit = defineEmits([
  "apply-context",
  "view-conversation",
  "view-knowledge",
]);

// 状态
const activeKeys = ref(["files"]); // 默认展开文件推荐
const selectedFiles = ref([]);
const recommendations = ref([]);

// 分类推荐
const fileRecommendations = computed(() =>
  recommendations.value.filter((r) => r.type === "file"),
);

const conversationRecommendations = computed(() =>
  recommendations.value.filter((r) => r.type === "conversation"),
);

const knowledgeRecommendations = computed(() =>
  recommendations.value.filter((r) => r.type === "knowledge"),
);

// 生成智能推荐
const generateRecommendations = () => {
  logger.info("[SmartContext] 🧠 生成智能推荐...");

  const newRecommendations = [];

  // 1. 分析当前消息的关键词
  const keywords = extractKeywords(props.currentMessage);
  logger.info("[SmartContext] 关键词:", keywords);

  // 2. 根据关键词推荐相关文件
  if (props.projectFiles.length > 0) {
    const relevantFiles = props.projectFiles
      .map((file) => {
        const score = calculateFileRelevance(file, keywords);
        if (score > 30) {
          // 只推荐相关度 > 30% 的文件
          return {
            type: "file",
            id: file.file_name || file.name,
            name: file.file_name || file.name,
            path: file.file_path || file.path,
            relevanceScore: score,
            reason: generateFileReason(file, keywords, score),
          };
        }
        return null;
      })
      .filter(Boolean)
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, 5); // 最多推荐5个文件

    newRecommendations.push(...relevantFiles);
  }

  // 3. 推荐相关历史对话
  if (props.conversationHistory.length > 3) {
    const relevantConversations = props.conversationHistory
      .filter((msg) => msg.role === "user" || msg.role === "assistant")
      .map((msg) => {
        const score = calculateTextSimilarity(
          props.currentMessage,
          msg.content,
        );
        if (score > 40) {
          return {
            type: "conversation",
            id: msg.id,
            summary: truncateText(msg.content, 50),
            content: msg.content,
            timestamp: msg.timestamp,
            reason: "讨论了类似的话题",
            relevanceScore: score,
          };
        }
        return null;
      })
      .filter(Boolean)
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, 3); // 最多推荐3条对话

    newRecommendations.push(...relevantConversations);
  }

  // 4. 推荐相关知识（模拟数据，实际应该从知识库查询）
  if (keywords.length > 0) {
    const knowledgeItems = [
      {
        type: "knowledge",
        id: "k1",
        title: "相关技术文档",
        preview: "包含相关技术实现的详细说明...",
        tags: keywords.slice(0, 3),
        relevanceScore: 75,
      },
    ];
    // newRecommendations.push(...knowledgeItems); // 暂时注释掉，等知识库功能完善
  }

  recommendations.value = newRecommendations;
  logger.info("[SmartContext] ✅ 生成了", newRecommendations.length, "条推荐");
};

// 提取关键词（简单实现）
const extractKeywords = (text) => {
  if (!text) {
    return [];
  }

  // 移除标点符号，分词
  const words = text
    .toLowerCase()
    .replace(/[^\w\s\u4e00-\u9fa5]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2); // 过滤掉长度小于3的词

  // 去重
  return [...new Set(words)];
};

// 计算文件相关度
const calculateFileRelevance = (file, keywords) => {
  if (keywords.length === 0) {
    return 0;
  }

  const fileName = (file.file_name || file.name || "").toLowerCase();
  const filePath = (file.file_path || file.path || "").toLowerCase();
  const fileContent = (file.content || "").toLowerCase();

  let score = 0;
  let matchCount = 0;

  keywords.forEach((keyword) => {
    // 文件名匹配（权重最高）
    if (fileName.includes(keyword)) {
      score += 30;
      matchCount++;
    }

    // 文件路径匹配
    if (filePath.includes(keyword)) {
      score += 20;
      matchCount++;
    }

    // 文件内容匹配
    if (fileContent.includes(keyword)) {
      score += 10;
      matchCount++;
    }
  });

  // 标准化分数到 0-100
  return Math.min(
    100,
    Math.round((score / keywords.length) * (matchCount / keywords.length)),
  );
};

// 生成文件推荐原因
const generateFileReason = (file, keywords, score) => {
  const matchedKeywords = keywords.filter((kw) => {
    const fileName = (file.file_name || file.name || "").toLowerCase();
    const fileContent = (file.content || "").toLowerCase();
    return fileName.includes(kw) || fileContent.includes(kw);
  });

  if (matchedKeywords.length > 0) {
    return `包含关键词: ${matchedKeywords.slice(0, 3).join(", ")}`;
  }

  return "可能与当前讨论相关";
};

// 计算文本相似度（简单实现）
const calculateTextSimilarity = (text1, text2) => {
  const words1 = new Set(extractKeywords(text1));
  const words2 = new Set(extractKeywords(text2));

  if (words1.size === 0 || words2.size === 0) {
    return 0;
  }

  // 计算交集
  const intersection = new Set([...words1].filter((x) => words2.has(x)));

  // Jaccard 相似度
  const union = new Set([...words1, ...words2]);
  const similarity = (intersection.size / union.size) * 100;

  return Math.round(similarity);
};

// 截断文本
const truncateText = (text, maxLength) => {
  if (text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength) + "...";
};

// 获取分数颜色
const getScoreColor = (score) => {
  if (score >= 80) {
    return "#52c41a";
  } // 绿色
  if (score >= 60) {
    return "#1890ff";
  } // 蓝色
  if (score >= 40) {
    return "#faad14";
  } // 橙色
  return "#d9d9d9"; // 灰色
};

// 格式化时间
const formatTime = (timestamp) => {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  if (diff < 60 * 1000) {
    return "刚刚";
  }
  if (diff < 60 * 60 * 1000) {
    return `${Math.floor(diff / (60 * 1000))}分钟前`;
  }
  if (diff < 24 * 60 * 60 * 1000) {
    return `${Math.floor(diff / (60 * 60 * 1000))}小时前`;
  }
  if (diff < 7 * 24 * 60 * 60 * 1000) {
    return `${Math.floor(diff / (24 * 60 * 60 * 1000))}天前`;
  }

  return date.toLocaleDateString("zh-CN");
};

// 切换文件选择
const toggleFileSelection = (file) => {
  const index = selectedFiles.value.indexOf(file.id);
  if (index > -1) {
    selectedFiles.value.splice(index, 1);
  } else {
    selectedFiles.value.push(file.id);
  }
};

// 应用上下文
const applyContext = () => {
  const selected = recommendations.value.filter(
    (r) => r.type === "file" && selectedFiles.value.includes(r.id),
  );
  emit("apply-context", selected);
  selectedFiles.value = [];
};

// 查看对话
const handleConversationClick = (conv) => {
  emit("view-conversation", conv);
};

// 查看知识
const handleKnowledgeClick = (knowledge) => {
  emit("view-knowledge", knowledge);
};

// 监听当前消息变化
watch(
  () => props.currentMessage,
  (newMessage) => {
    if (newMessage && newMessage.trim().length > 5) {
      // 防抖：延迟生成推荐
      setTimeout(() => {
        generateRecommendations();
      }, 500);
    } else {
      recommendations.value = [];
    }
  },
  { immediate: false },
);

// 监听项目文件变化
watch(
  () => props.projectFiles,
  () => {
    if (props.currentMessage) {
      generateRecommendations();
    }
  },
  { deep: true },
);
</script>

<style scoped>
.smart-context-panel {
  background: white;
  border-left: 1px solid #e8e8e8;
  display: flex;
  flex-direction: column;
  height: 100%;
}

.context-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  border-bottom: 1px solid #e8e8e8;
}

.context-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
  color: #333;
}

.help-icon {
  color: #999;
  cursor: help;
}

.recommendations-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.recommendations-list :deep(.ant-collapse) {
  background: transparent;
  border: none;
}

.recommendations-list :deep(.ant-collapse-item) {
  margin-bottom: 8px;
  border: 1px solid #e8e8e8;
  border-radius: 6px;
  background: white;
}

.recommendations-list :deep(.ant-collapse-header) {
  font-weight: 600;
  padding: 12px 16px !important;
}

.recommendation-items {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.recommendation-item {
  display: flex;
  gap: 12px;
  padding: 12px;
  background: #fafafa;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
  border: 1px solid transparent;
}

.recommendation-item:hover {
  background: #f0f0f0;
  border-color: #1890ff;
}

.recommendation-item.selected {
  background: #e6f7ff;
  border-color: #1890ff;
}

.item-icon {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: white;
  border-radius: 6px;
  font-size: 16px;
  color: #1890ff;
  flex-shrink: 0;
}

.item-content {
  flex: 1;
  min-width: 0;
}

.item-name {
  font-size: 14px;
  font-weight: 500;
  color: #333;
  margin-bottom: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.item-reason {
  font-size: 12px;
  color: #666;
  margin-bottom: 6px;
}

.item-preview {
  font-size: 12px;
  color: #999;
  margin-bottom: 6px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.item-score {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: #999;
}

.item-score .ant-progress {
  flex: 1;
  margin: 0;
}

.score-value {
  font-weight: 600;
  color: #666;
}

.item-time {
  font-size: 11px;
  color: #999;
  margin-top: 4px;
}

.item-tags {
  margin-top: 6px;
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.item-actions {
  display: flex;
  align-items: center;
}

.context-actions {
  padding: 12px;
  border-top: 1px solid #e8e8e8;
  background: #fafafa;
}
</style>
