<template>
  <div class="task-plan-message">
    <div class="plan-header">
      <FileTextOutlined class="plan-icon" />
      <span class="plan-title">{{ message.content }}</span>
    </div>

    <div v-if="plan" class="plan-content">
      <!-- 计划标题和摘要 -->
      <div class="plan-summary-section">
        <h3>{{ plan.title || '任务计划' }}</h3>
        <p v-if="plan.summary" class="summary-text">{{ plan.summary }}</p>
      </div>

      <!-- 任务步骤 -->
      <div v-if="plan.tasks && plan.tasks.length > 0" class="plan-tasks">
        <h4>📋 任务步骤</h4>
        <div
          v-for="(task, index) in plan.tasks"
          :key="task.id || index"
          class="task-item"
        >
          <div class="task-number">{{ index + 1 }}</div>
          <div class="task-details">
            <div class="task-name">{{ task.name }}</div>
            <div v-if="task.description" class="task-description">{{ task.description }}</div>
            <div v-if="task.action" class="task-meta">
              <span class="meta-label">操作:</span>
              <span class="meta-value">{{ task.action }}</span>
            </div>
            <div v-if="task.output" class="task-meta">
              <span class="meta-label">输出:</span>
              <span class="meta-value">{{ task.output }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 预期输出 -->
      <div v-if="plan.outputs && plan.outputs.length > 0" class="plan-outputs">
        <h4>🎯 预期输出</h4>
        <ul>
          <li v-for="(output, index) in plan.outputs" :key="index">{{ output }}</li>
        </ul>
      </div>

      <!-- 注意事项 -->
      <div v-if="plan.notes && plan.notes.length > 0" class="plan-notes">
        <h4>⚠️ 注意事项</h4>
        <ul>
          <li v-for="(note, index) in plan.notes" :key="index">{{ note }}</li>
        </ul>
      </div>

      <!-- 操作按钮 -->
      <div v-if="status === 'pending'" class="plan-actions">
        <a-button @click="handleCancel" size="large">
          <CloseOutlined />
          取消
        </a-button>
        <a-button @click="handleModify" size="large">
          <EditOutlined />
          修改计划
        </a-button>
        <a-button type="primary" @click="handleConfirm" size="large">
          <CheckOutlined />
          确认执行
        </a-button>
      </div>

      <!-- 状态提示 -->
      <div v-else-if="status === 'confirmed'" class="plan-status">
        <CheckCircleOutlined style="color: #52c41a;" />
        <span>计划已确认，正在执行...</span>
      </div>

      <div v-else-if="status === 'executing'" class="plan-status">
        <LoadingOutlined spin style="color: #1890ff;" />
        <span>任务执行中...</span>
      </div>

      <div v-else-if="status === 'completed'" class="plan-status">
        <CheckCircleOutlined style="color: #52c41a;" />
        <span>任务已完成！</span>
      </div>

      <div v-else-if="status === 'cancelled'" class="plan-status">
        <CloseCircleOutlined style="color: #8c8c8c;" />
        <span>计划已取消</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import {
  FileTextOutlined,
  CheckOutlined,
  EditOutlined,
  CloseOutlined,
  CheckCircleOutlined,
  LoadingOutlined,
  CloseCircleOutlined,
} from '@ant-design/icons-vue';

const props = defineProps({
  message: {
    type: Object,
    required: true,
  },
});

const emit = defineEmits(['confirm', 'modify', 'cancel']);

const plan = computed(() => props.message.metadata?.plan);
const status = computed(() => props.message.metadata?.status || 'pending');

const handleConfirm = () => {
  emit('confirm', props.message);
};

const handleModify = () => {
  emit('modify', props.message);
};

const handleCancel = () => {
  emit('cancel', props.message);
};
</script>

<style scoped>
.task-plan-message {
  margin: 12px 0;
  border: 1px solid #e8e8e8;
  border-radius: 8px;
  background: #fafafa;
  overflow: hidden;
}

.plan-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: white;
  border-bottom: 1px solid #e8e8e8;
}

.plan-icon {
  font-size: 18px;
  color: #1890ff;
}

.plan-title {
  font-size: 15px;
  font-weight: 500;
  color: #262626;
}

.plan-content {
  padding: 16px;
  background: white;
}

.plan-summary-section {
  margin-bottom: 20px;
}

.plan-summary-section h3 {
  margin: 0 0 8px 0;
  font-size: 18px;
  font-weight: 600;
  color: #262626;
}

.summary-text {
  color: #595959;
  font-size: 14px;
  line-height: 1.6;
  margin: 0;
}

.plan-tasks,
.plan-outputs,
.plan-notes {
  margin-bottom: 20px;
}

.plan-tasks h4,
.plan-outputs h4,
.plan-notes h4 {
  font-size: 14px;
  font-weight: 600;
  color: #262626;
  margin: 0 0 12px 0;
}

.task-item {
  display: flex;
  gap: 12px;
  padding: 12px;
  background: #f5f5f5;
  border-radius: 6px;
  margin-bottom: 8px;
}

.task-number {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  background: #1890ff;
  color: white;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 14px;
}

.task-details {
  flex: 1;
}

.task-name {
  font-size: 14px;
  font-weight: 500;
  color: #262626;
  margin-bottom: 4px;
}

.task-description {
  font-size: 13px;
  color: #595959;
  line-height: 1.5;
  margin-bottom: 6px;
}

.task-meta {
  font-size: 12px;
  margin-top: 4px;
}

.meta-label {
  font-weight: 600;
  color: #8c8c8c;
  margin-right: 6px;
}

.meta-value {
  color: #595959;
}

.plan-outputs ul,
.plan-notes ul {
  margin: 0;
  padding-left: 20px;
  list-style-type: disc;
}

.plan-outputs li,
.plan-notes li {
  color: #595959;
  font-size: 13px;
  margin-bottom: 6px;
  line-height: 1.5;
}

.plan-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid #e8e8e8;
}

.plan-status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  background: #f5f5f5;
  border-radius: 6px;
  margin-top: 16px;
  font-size: 14px;
  color: #595959;
}
</style>
