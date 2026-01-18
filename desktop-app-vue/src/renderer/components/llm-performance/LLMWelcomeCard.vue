<template>
  <transition name="slide-fade">
    <a-card v-if="visible" class="welcome-card">
      <div class="welcome-content">
        <div class="welcome-header">
          <div class="welcome-icon">
            <BarChartOutlined />
          </div>
          <div class="welcome-title">
            <h2>欢迎使用 LLM 性能仪表板</h2>
            <p>实时追踪您的 AI 使用情况、成本分析和性能优化</p>
          </div>
          <a-button
            type="text"
            class="dismiss-btn"
            @click="$emit('dismiss')"
            aria-label="关闭引导"
          >
            <CloseOutlined />
          </a-button>
        </div>

        <a-divider />

        <div class="welcome-features">
          <div
            v-for="feature in features"
            :key="feature.title"
            class="feature-item"
            tabindex="0"
          >
            <div class="feature-icon">
              <component :is="feature.icon" />
            </div>
            <div class="feature-text">
              <h4>{{ feature.title }}</h4>
              <p>{{ feature.description }}</p>
            </div>
          </div>
        </div>

        <a-divider />

        <div class="welcome-actions">
          <div class="action-text">
            <InfoCircleOutlined />
            <span
              >开始使用 AI 聊天功能后，数据将自动记录并显示在此仪表板中</span
            >
          </div>
          <div class="action-buttons">
            <a-button type="primary" size="large" @click="$emit('go-to-chat')">
              <template #icon><PlayCircleOutlined /></template>
              开始 AI 对话
            </a-button>
            <a-tooltip title="生成示例数据以预览仪表板功能（仅用于演示）">
              <a-button
                size="large"
                @click="$emit('generate-data')"
                :loading="generatingData"
              >
                <template #icon><ExperimentOutlined /></template>
                {{ generatingData ? "生成中..." : "生成示例数据" }}
              </a-button>
            </a-tooltip>
          </div>
          <a-progress
            v-if="generatingData"
            :percent="dataProgress"
            :show-info="false"
            size="small"
            style="margin-top: 12px; max-width: 300px"
          />
        </div>
      </div>
    </a-card>
  </transition>
</template>

<script setup>
import { markRaw } from "vue";
import {
  BarChartOutlined,
  CloseOutlined,
  ApiOutlined,
  DollarOutlined,
  RocketOutlined,
  PlayCircleOutlined,
  InfoCircleOutlined,
  ExperimentOutlined,
} from "@ant-design/icons-vue";

defineProps({
  visible: {
    type: Boolean,
    default: false,
  },
  generatingData: {
    type: Boolean,
    default: false,
  },
  dataProgress: {
    type: Number,
    default: 0,
  },
});

defineEmits(["dismiss", "generate-data", "go-to-chat"]);

const features = [
  {
    icon: markRaw(ApiOutlined),
    title: "调用追踪",
    description: "记录每次 LLM API 调用，包括 Token 使用量和响应时间",
  },
  {
    icon: markRaw(DollarOutlined),
    title: "成本分析",
    description: "按提供商、模型分类统计成本，支持预算告警",
  },
  {
    icon: markRaw(RocketOutlined),
    title: "优化建议",
    description: "智能分析使用模式，提供成本优化和性能提升建议",
  },
];
</script>

<style lang="less" scoped>
.welcome-card {
  margin-bottom: 24px;
  border-radius: 12px;
  background: linear-gradient(135deg, #f6f9fc 0%, #eef2f7 100%);
  border: 1px solid #e8ecf1;

  .welcome-content {
    .welcome-header {
      display: flex;
      align-items: flex-start;
      gap: 16px;
      position: relative;

      .welcome-icon {
        width: 56px;
        height: 56px;
        background: linear-gradient(135deg, #1890ff 0%, #096dd9 100%);
        border-radius: 12px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;

        :deep(.anticon) {
          font-size: 28px;
          color: #fff;
        }
      }

      .welcome-title {
        flex: 1;

        h2 {
          font-size: 22px;
          font-weight: 600;
          color: #1a202c;
          margin: 0 0 6px 0;
        }

        p {
          font-size: 14px;
          color: #718096;
          margin: 0;
        }
      }

      .dismiss-btn {
        color: #a0aec0;

        &:hover {
          color: #718096;
        }
      }
    }

    .welcome-features {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 20px;

      .feature-item {
        display: flex;
        gap: 14px;
        padding: 16px;
        background: #fff;
        border-radius: 10px;
        border: 1px solid #e2e8f0;
        transition: all 0.2s ease;
        cursor: default;

        &:hover,
        &:focus {
          border-color: #1890ff;
          box-shadow: 0 4px 12px rgba(24, 144, 255, 0.1);
          outline: none;
        }

        .feature-icon {
          width: 42px;
          height: 42px;
          background: #e6f7ff;
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;

          :deep(.anticon) {
            font-size: 20px;
            color: #1890ff;
          }
        }

        .feature-text {
          h4 {
            font-size: 15px;
            font-weight: 600;
            color: #1a202c;
            margin: 0 0 4px 0;
          }

          p {
            font-size: 13px;
            color: #718096;
            margin: 0;
            line-height: 1.5;
          }
        }
      }
    }

    .welcome-actions {
      text-align: center;

      .action-text {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        font-size: 14px;
        color: #718096;
        margin-bottom: 16px;
        padding: 10px 16px;
        background: #fff;
        border-radius: 8px;
        border: 1px dashed #cbd5e0;

        :deep(.anticon) {
          color: #1890ff;
        }
      }

      .action-buttons {
        display: flex;
        justify-content: center;
        gap: 12px;
        flex-wrap: wrap;
      }
    }
  }
}

// Slide fade transition
.slide-fade-enter-active {
  transition: all 0.3s ease-out;
}

.slide-fade-leave-active {
  transition: all 0.2s ease-in;
}

.slide-fade-enter-from,
.slide-fade-leave-to {
  transform: translateY(-20px);
  opacity: 0;
}

// Mobile responsiveness
@media (max-width: 768px) {
  .welcome-card {
    .welcome-content {
      .welcome-header {
        flex-direction: column;
        text-align: center;

        .welcome-icon {
          align-self: center;
        }

        .dismiss-btn {
          position: absolute;
          top: 0;
          right: 0;
        }
      }

      .welcome-features {
        grid-template-columns: 1fr;

        .feature-item {
          flex-direction: column;
          text-align: center;

          .feature-icon {
            align-self: center;
          }
        }
      }

      .welcome-actions {
        .action-text {
          flex-direction: column;
          text-align: center;
        }

        .action-buttons {
          flex-direction: column;

          button {
            width: 100%;
          }
        }
      }
    }
  }
}
</style>
