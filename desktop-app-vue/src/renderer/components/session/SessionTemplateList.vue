<template>
  <div class="template-list">
    <!-- 工具栏 -->
    <div class="toolbar">
      <a-select
        v-model:value="categoryFilter"
        placeholder="按分类筛选"
        style="width: 150px"
        allow-clear
        @change="handleCategoryChange"
      >
        <a-select-option value="">
          全部
        </a-select-option>
        <a-select-option value="general">
          通用
        </a-select-option>
        <a-select-option value="tech">
          技术
        </a-select-option>
        <a-select-option value="work">
          工作
        </a-select-option>
        <a-select-option value="study">
          学习
        </a-select-option>
        <a-select-option value="other">
          其他
        </a-select-option>
      </a-select>
    </div>

    <!-- 模板网格 -->
    <a-spin :spinning="loading">
      <a-row :gutter="[16, 16]">
        <a-col
          v-for="template in filteredTemplates"
          :key="template.id"
          :xs="24"
          :sm="12"
          :md="8"
          :lg="6"
        >
          <a-card
            class="template-card"
            hoverable
            :body-style="{ padding: '16px' }"
          >
            <template #cover>
              <div class="template-cover">
                <FileTextOutlined />
              </div>
            </template>

            <a-card-meta :title="template.name">
              <template #description>
                <div class="template-info">
                  <p
                    v-if="template.description"
                    class="description"
                  >
                    {{ truncate(template.description, 60) }}
                  </p>
                  <div class="meta-row">
                    <a-tag :color="getCategoryColor(template.category)">
                      {{ getCategoryName(template.category) }}
                    </a-tag>
                    <span class="date">
                      {{ formatDate(template.created_at) }}
                    </span>
                  </div>
                </div>
              </template>
            </a-card-meta>

            <template #actions>
              <a-tooltip title="从模板创建会话">
                <PlayCircleOutlined
                  @click="$emit('create-from', template.id)"
                />
              </a-tooltip>
              <a-tooltip title="删除模板">
                <DeleteOutlined
                  style="color: #ff4d4f"
                  @click="$emit('delete', template.id)"
                />
              </a-tooltip>
            </template>
          </a-card>
        </a-col>
      </a-row>

      <!-- 空状态 -->
      <a-empty
        v-if="filteredTemplates.length === 0 && !loading"
        description="暂无模板"
      >
        <template #image>
          <FileTextOutlined style="font-size: 64px; color: #d9d9d9" />
        </template>
        <p class="empty-hint">
          在会话详情中点击"保存为模板"来创建模板
        </p>
      </a-empty>
    </a-spin>
  </div>
</template>

<script setup>
import { ref, computed } from "vue";
import {
  FileTextOutlined,
  PlayCircleOutlined,
  DeleteOutlined,
} from "@ant-design/icons-vue";

const props = defineProps({
  templates: {
    type: Array,
    default: () => [],
  },
  loading: {
    type: Boolean,
    default: false,
  },
});

defineEmits(["create-from", "delete"]);

// 状态
const categoryFilter = ref("");

// 过滤后的模板
const filteredTemplates = computed(() => {
  if (!categoryFilter.value) {
    return props.templates;
  }
  return props.templates.filter((t) => t.category === categoryFilter.value);
});

// 分类变化
const handleCategoryChange = () => {
  // 筛选由 computed 自动处理
};

// 获取分类名称
const getCategoryName = (category) => {
  const names = {
    general: "通用",
    tech: "技术",
    work: "工作",
    study: "学习",
    other: "其他",
  };
  return names[category] || "未分类";
};

// 获取分类颜色
const getCategoryColor = (category) => {
  const colors = {
    general: "blue",
    tech: "purple",
    work: "green",
    study: "orange",
    other: "default",
  };
  return colors[category] || "default";
};

// 格式化日期
const formatDate = (timestamp) => {
  if (!timestamp) {return "-";}

  const date = new Date(typeof timestamp === "number" ? timestamp : timestamp);
  return date.toLocaleDateString("zh-CN", {
    month: "short",
    day: "numeric",
  });
};

// 截断文本
const truncate = (text, maxLength) => {
  if (!text) {return "";}
  if (text.length <= maxLength) {return text;}
  return text.substring(0, maxLength) + "...";
};
</script>

<style lang="less" scoped>
.template-list {
  .toolbar {
    margin-bottom: 16px;
  }

  .template-card {
    height: 100%;

    .template-cover {
      height: 80px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: #fff;
      font-size: 32px;
    }

    .template-info {
      .description {
        font-size: 12px;
        color: #8c8c8c;
        margin-bottom: 8px;
        min-height: 36px;
      }

      .meta-row {
        display: flex;
        justify-content: space-between;
        align-items: center;

        .date {
          font-size: 11px;
          color: #bfbfbf;
        }
      }
    }
  }

  .empty-hint {
    font-size: 12px;
    color: #8c8c8c;
  }
}

:deep(.ant-card-meta-title) {
  font-size: 14px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
