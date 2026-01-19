<template>
  <div class="plan-preview">
    <!-- 计划概要 -->
    <a-card
      title="📋 执行计划"
      class="plan-card"
    >
      <div class="plan-steps">
        <a-timeline>
          <a-timeline-item
            v-for="(step, index) in plan?.steps || []"
            :key="index"
            :color="getStepColor(step)"
          >
            <div class="step-content">
              <div class="step-title">
                <strong>{{ step.name }}</strong>
                <a-tag
                  v-if="step.tool"
                  color="blue"
                >
                  {{ step.tool }}
                </a-tag>
              </div>
              <div class="step-description">
                {{ step.description }}
              </div>
              <div
                v-if="step.estimatedTime"
                class="step-time"
              >
                预计耗时: {{ step.estimatedTime }}
              </div>
            </div>
          </a-timeline-item>
        </a-timeline>
      </div>
    </a-card>

    <!-- 预期输出 -->
    <a-card
      title="📂 预期输出"
      class="plan-card"
    >
      <div class="expected-outputs">
        <div
          v-for="(file, index) in plan?.expectedOutputs || []"
          :key="index"
          class="output-file"
        >
          <a-tag :color="getFileColor(file.type)">
            {{ getFileTypeLabel(file.type) }}
          </a-tag>
          <span class="file-name">{{ file.name }}</span>
          <span
            v-if="file.description"
            class="file-desc"
          >
            - {{ file.description }}
          </span>
        </div>
        <a-empty
          v-if="!plan?.expectedOutputs || plan.expectedOutputs.length === 0"
          description="暂无输出文件"
        />
      </div>
    </a-card>

    <!-- 推荐资源 -->
    <a-tabs
      v-model:active-key="activeTab"
      class="recommendations-tabs"
    >
      <!-- 推荐模板 -->
      <a-tab-pane
        key="templates"
        tab="📝 推荐模板"
      >
        <div class="recommendations-list">
          <div
            v-for="template in recommendedTemplates"
            :key="template.id"
            class="recommendation-item"
          >
            <div class="item-info">
              <div class="item-title">
                {{ template.name }}
              </div>
              <div class="item-description">
                {{ template.description }}
              </div>
              <div class="item-meta">
                <a-tag>{{ template.category }}</a-tag>
                <span class="match-score">
                  匹配度: {{ Math.round(template.matchScore * 100) }}%
                </span>
              </div>
            </div>
            <a-button
              type="link"
              @click="$emit('use-template', template.id)"
            >
              应用此模板
            </a-button>
          </div>
          <a-empty
            v-if="!recommendedTemplates || recommendedTemplates.length === 0"
            description="暂无推荐模板"
          />
        </div>
      </a-tab-pane>

      <!-- 推荐技能 -->
      <a-tab-pane
        key="skills"
        tab="⚡ 推荐技能"
      >
        <div class="recommendations-list">
          <div
            v-for="skill in recommendedSkills"
            :key="skill.id"
            class="recommendation-item"
          >
            <div class="item-info">
              <div class="item-title">
                {{ skill.name }}
              </div>
              <div class="item-description">
                {{ skill.description }}
              </div>
              <div class="item-meta">
                <a-tag>{{ skill.category }}</a-tag>
                <span class="match-score">
                  相关度: {{ Math.round(skill.relevanceScore * 100) }}%
                </span>
              </div>
            </div>
          </div>
          <a-empty
            v-if="!recommendedSkills || recommendedSkills.length === 0"
            description="暂无推荐技能"
          />
        </div>
      </a-tab-pane>

      <!-- 推荐工具 -->
      <a-tab-pane
        key="tools"
        tab="🔧 使用工具"
      >
        <div class="tools-list">
          <a-tag
            v-for="tool in recommendedTools"
            :key="tool"
            color="processing"
            class="tool-tag"
          >
            {{ tool }}
          </a-tag>
          <a-empty
            v-if="!recommendedTools || recommendedTools.length === 0"
            description="暂无使用工具"
          />
        </div>
      </a-tab-pane>
    </a-tabs>

    <!-- 调整参数 -->
    <a-card
      title="⚙️ 调整参数"
      class="plan-card"
    >
      <a-form layout="vertical">
        <a-row :gutter="16">
          <a-col :span="12">
            <a-form-item label="输出质量">
              <a-select
                v-model:value="adjustments.quality"
                placeholder="选择质量级别"
              >
                <a-select-option value="draft">
                  草稿 (快速生成)
                </a-select-option>
                <a-select-option value="normal">
                  标准 (平衡质量与速度)
                </a-select-option>
                <a-select-option value="high">
                  高质量 (细致打磨)
                </a-select-option>
              </a-select>
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="创意程度">
              <a-slider
                v-model:value="adjustments.creativity"
                :min="0"
                :max="100"
                :marks="{ 0: '保守', 50: '平衡', 100: '创新' }"
              />
            </a-form-item>
          </a-col>
        </a-row>
        <a-form-item label="额外要求">
          <a-textarea
            v-model:value="adjustments.additionalRequirements"
            placeholder="输入您的额外要求或限制条件..."
            :rows="3"
          />
        </a-form-item>
        <a-form-item>
          <a-button
            type="dashed"
            block
            @click="handleApplyAdjustments"
          >
            应用调整
          </a-button>
        </a-form-item>
      </a-form>
    </a-card>
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue';

const props = defineProps({
  plan: {
    type: Object,
    default: null
  },
  recommendedTemplates: {
    type: Array,
    default: () => []
  },
  recommendedSkills: {
    type: Array,
    default: () => []
  },
  recommendedTools: {
    type: Array,
    default: () => []
  }
});

const emit = defineEmits(['adjust', 'use-template']);

const activeTab = ref('templates');

const adjustments = reactive({
  quality: 'normal',
  creativity: 50,
  additionalRequirements: ''
});

// 获取步骤颜色
const getStepColor = (step) => {
  if (step.status === 'completed') {return 'green';}
  if (step.status === 'failed') {return 'red';}
  if (step.status === 'running') {return 'blue';}
  return 'gray';
};

// 获取文件类型颜色
const getFileColor = (type) => {
  const colorMap = {
    pptx: 'orange',
    docx: 'blue',
    xlsx: 'green',
    pdf: 'red',
    html: 'purple',
    md: 'cyan'
  };
  return colorMap[type] || 'default';
};

// 获取文件类型标签
const getFileTypeLabel = (type) => {
  const labelMap = {
    pptx: 'PPT',
    docx: 'Word',
    xlsx: 'Excel',
    pdf: 'PDF',
    html: 'HTML',
    md: 'Markdown'
  };
  return labelMap[type] || type.toUpperCase();
};

// 应用调整
const handleApplyAdjustments = () => {
  emit('adjust', { ...adjustments });
};
</script>

<style scoped>
.plan-preview {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-height: 70vh;
  overflow-y: auto;
}

/* 卡片样式 */
.plan-card {
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
}

.plan-card :deep(.ant-card-head) {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border-radius: 8px 8px 0 0;
}

.plan-card :deep(.ant-card-head-title) {
  color: white;
  font-weight: 600;
}

/* 步骤列表 */
.plan-steps {
  padding: 8px 0;
}

.step-content {
  padding-left: 8px;
}

.step-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.step-description {
  color: #666;
  font-size: 14px;
  margin-bottom: 4px;
}

.step-time {
  color: #999;
  font-size: 12px;
}

/* 预期输出 */
.expected-outputs {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.output-file {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  background: #f9f9f9;
  border-radius: 4px;
}

.file-name {
  font-weight: 500;
  color: #333;
}

.file-desc {
  color: #666;
  font-size: 13px;
}

/* 推荐资源 */
.recommendations-tabs {
  background: white;
  padding: 16px;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
}

.recommendations-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 300px;
  overflow-y: auto;
}

.recommendation-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px;
  border: 1px solid #e8e8e8;
  border-radius: 6px;
  transition: all 0.3s;
}

.recommendation-item:hover {
  border-color: #667eea;
  box-shadow: 0 2px 8px rgba(102, 126, 234, 0.1);
}

.item-info {
  flex: 1;
}

.item-title {
  font-weight: 600;
  font-size: 14px;
  color: #333;
  margin-bottom: 4px;
}

.item-description {
  font-size: 13px;
  color: #666;
  margin-bottom: 8px;
}

.item-meta {
  display: flex;
  align-items: center;
  gap: 12px;
}

.match-score {
  font-size: 12px;
  color: #999;
}

/* 工具列表 */
.tools-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.tool-tag {
  font-size: 13px;
  padding: 4px 12px;
}

/* 滚动条样式 */
.plan-preview::-webkit-scrollbar,
.recommendations-list::-webkit-scrollbar {
  width: 6px;
}

.plan-preview::-webkit-scrollbar-track,
.recommendations-list::-webkit-scrollbar-track {
  background: transparent;
}

.plan-preview::-webkit-scrollbar-thumb,
.recommendations-list::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.15);
  border-radius: 3px;
}

.plan-preview::-webkit-scrollbar-thumb:hover,
.recommendations-list::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 0, 0, 0.25);
}
</style>
