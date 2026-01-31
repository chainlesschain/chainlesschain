<template>
  <a-card
    class="skill-card"
    hoverable
    @click="emit('viewDetail', skill)"
  >
    <!-- 卡片头部 -->
    <template #title>
      <div class="skill-card-title">
        <ToolOutlined class="skill-icon" />
        <span class="skill-name">{{ skill.name }}</span>
      </div>
    </template>

    <!-- 操作按钮 -->
    <template #extra>
      <a-button
        type="text"
        size="small"
        @click.stop="emit('test', skill)"
      >
        <ExperimentOutlined />
      </a-button>
    </template>

    <!-- 卡片内容 -->
    <div class="skill-card-content">
      <!-- 类型标签 -->
      <div class="skill-type-badge">
        <a-tag :color="getTypeColor(skill.type)">
          {{ getTypeText(skill.type) }}
        </a-tag>
      </div>

      <!-- 描述 -->
      <div v-if="skill.description" class="skill-description">
        {{ skill.description }}
      </div>

      <!-- 支持的操作 -->
      <div v-if="skill.supportedOperations && skill.supportedOperations.length > 0" class="skill-operations">
        <div class="operations-label">支持的操作:</div>
        <div class="operations-tags">
          <a-tag
            v-for="op in skill.supportedOperations.slice(0, 3)"
            :key="op"
            size="small"
          >
            {{ op }}
          </a-tag>
          <span v-if="skill.supportedOperations.length > 3" class="more-tag">
            +{{ skill.supportedOperations.length - 3 }}
          </span>
        </div>
      </div>

      <!-- 支持的文件类型 -->
      <div v-if="skill.supportedFileTypes && skill.supportedFileTypes.length > 0" class="skill-file-types">
        <div class="file-types-label">文件类型:</div>
        <div class="file-types-tags">
          <a-tag
            v-for="type in skill.supportedFileTypes"
            :key="type"
            size="small"
            color="geekblue"
          >
            .{{ type }}
          </a-tag>
        </div>
      </div>
    </div>
  </a-card>
</template>

<script setup>
import { ToolOutlined, ExperimentOutlined } from "@ant-design/icons-vue";

// Props
const props = defineProps({
  skill: {
    type: Object,
    required: true,
  },
});

// Emits
const emit = defineEmits(["viewDetail", "test"]);

// ==========================================
// 辅助函数
// ==========================================

function getTypeColor(type) {
  const colors = {
    office: "green",
    coding: "blue",
    "data-analysis": "orange",
    other: "default",
  };
  return colors[type] || "default";
}

function getTypeText(type) {
  const texts = {
    office: "Office 文档",
    coding: "编程",
    "data-analysis": "数据分析",
    other: "其他",
  };
  return texts[type] || type;
}
</script>

<style scoped lang="scss">
.skill-card {
  border-radius: 8px;
  transition: all 0.3s;
  cursor: pointer;

  &:hover {
    transform: translateY(-4px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  }

  .skill-card-title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 16px;
    font-weight: 600;

    .skill-icon {
      color: #1890ff;
      font-size: 18px;
    }

    .skill-name {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  .skill-card-content {
    .skill-type-badge {
      margin-bottom: 12px;
    }

    .skill-description {
      color: #595959;
      font-size: 14px;
      margin-bottom: 16px;
      line-height: 1.6;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .skill-operations,
    .skill-file-types {
      margin-bottom: 12px;

      .operations-label,
      .file-types-label {
        font-size: 12px;
        color: #8c8c8c;
        margin-bottom: 6px;
      }

      .operations-tags,
      .file-types-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        align-items: center;

        .more-tag {
          font-size: 12px;
          color: #8c8c8c;
        }
      }
    }
  }
}
</style>
