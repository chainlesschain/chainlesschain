<template>
  <div
    class="step-node"
    :class="[
      `status-${status}`,
      { selected, 'is-control': isControlStep }
    ]"
    @click="$emit('click')"
  >
    <!-- Drag Handle -->
    <div class="drag-handle">
      <HolderOutlined />
    </div>

    <!-- Step Number -->
    <div class="step-number">{{ index + 1 }}</div>

    <!-- Step Icon -->
    <div class="step-icon" :style="{ background: stepColor }">
      <component :is="stepIcon" />
    </div>

    <!-- Step Content -->
    <div class="step-content">
      <div class="step-header">
        <span class="step-name">{{ stepName }}</span>
        <a-tag v-if="step.type !== 'action'" size="small">{{ step.type }}</a-tag>
      </div>
      <div class="step-details">
        {{ stepDescription }}
      </div>
    </div>

    <!-- Status Indicator -->
    <div class="step-status">
      <LoadingOutlined v-if="status === 'running'" spin />
      <CheckCircleOutlined v-else-if="status === 'success'" class="success" />
      <CloseCircleOutlined v-else-if="status === 'failed'" class="failed" />
    </div>

    <!-- Delete Button -->
    <a-button
      type="text"
      class="delete-btn"
      @click.stop="$emit('delete')"
    >
      <DeleteOutlined />
    </a-button>

    <!-- Nested Steps Indicator (for control flow) -->
    <div v-if="hasNestedSteps" class="nested-indicator">
      <DownOutlined />
      <span>{{ nestedStepsCount }} nested step(s)</span>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import {
  HolderOutlined,
  DeleteOutlined,
  LoadingOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  DownOutlined,
  GlobalOutlined,
  SelectOutlined,
  FormOutlined,
  ArrowDownOutlined,
  KeyOutlined,
  UploadOutlined,
  CopyOutlined,
  CodeOutlined,
  CameraOutlined,
  EyeOutlined,
  BranchesOutlined,
  RetweetOutlined,
  ClockCircleOutlined,
  SettingOutlined,
  ApiOutlined,
} from '@ant-design/icons-vue';

const props = defineProps({
  step: {
    type: Object,
    required: true
  },
  index: {
    type: Number,
    required: true
  },
  selected: {
    type: Boolean,
    default: false
  },
  status: {
    type: String,
    default: 'pending' // pending, running, success, failed
  }
});

defineEmits(['click', 'delete']);

const iconMap = {
  navigate: GlobalOutlined,
  goBack: ArrowDownOutlined,
  goForward: ArrowDownOutlined,
  reload: RetweetOutlined,
  click: SelectOutlined,
  type: FormOutlined,
  select: SelectOutlined,
  hover: EyeOutlined,
  scroll: ArrowDownOutlined,
  keyboard: KeyOutlined,
  upload: UploadOutlined,
  extract: CopyOutlined,
  screenshot: CameraOutlined,
  evaluate: CodeOutlined,
  condition: BranchesOutlined,
  loop: RetweetOutlined,
  wait: ClockCircleOutlined,
  variable: SettingOutlined,
  subprocess: ApiOutlined,
  try_catch: BranchesOutlined,
};

const colorMap = {
  navigate: '#1890ff',
  goBack: '#1890ff',
  goForward: '#1890ff',
  reload: '#1890ff',
  click: '#52c41a',
  type: '#52c41a',
  select: '#52c41a',
  hover: '#52c41a',
  scroll: '#52c41a',
  keyboard: '#52c41a',
  upload: '#52c41a',
  extract: '#722ed1',
  screenshot: '#722ed1',
  evaluate: '#722ed1',
  condition: '#fa8c16',
  loop: '#fa8c16',
  wait: '#fa8c16',
  variable: '#fa8c16',
  subprocess: '#eb2f96',
  try_catch: '#eb2f96',
};

const stepIcon = computed(() => {
  const action = props.step.action || props.step.type;
  return iconMap[action] || SettingOutlined;
});

const stepColor = computed(() => {
  const action = props.step.action || props.step.type;
  return colorMap[action] || '#999';
});

const stepName = computed(() => {
  const action = props.step.action || props.step.type;
  const names = {
    navigate: 'Navigate',
    goBack: 'Go Back',
    goForward: 'Go Forward',
    reload: 'Reload',
    click: 'Click',
    type: 'Type',
    select: 'Select',
    hover: 'Hover',
    scroll: 'Scroll',
    keyboard: 'Keyboard',
    upload: 'Upload',
    extract: 'Extract',
    screenshot: 'Screenshot',
    evaluate: 'Run Script',
    condition: 'If Condition',
    loop: 'Loop',
    wait: 'Wait',
    variable: 'Set Variable',
    subprocess: 'Sub-Workflow',
    try_catch: 'Try/Catch',
  };
  return names[action] || action;
});

const stepDescription = computed(() => {
  const config = props.step.config || {};

  switch (props.step.action || props.step.type) {
    case 'navigate':
      return config.url ? `Go to ${truncate(config.url, 30)}` : 'Enter URL';
    case 'click':
      return config.selector ? `Click ${truncate(config.selector, 25)}` : 'Select element';
    case 'type':
      return config.text ? `Type "${truncate(config.text, 20)}"` : 'Enter text';
    case 'select':
      return config.value ? `Select "${config.value}"` : 'Select option';
    case 'scroll':
      return `Scroll ${config.direction || 'down'} ${config.distance || 500}px`;
    case 'keyboard':
      return config.keys?.length ? `Press ${config.keys.join('+')}` : 'Press keys';
    case 'extract':
      return config.selector ? `Extract from ${truncate(config.selector, 20)}` : 'Select element';
    case 'screenshot':
      return config.fullPage ? 'Full page screenshot' : 'Viewport screenshot';
    case 'evaluate':
      return 'Execute JavaScript';
    case 'wait':
      if (config.waitType === 'time') return `Wait ${config.duration}ms`;
      if (config.waitType === 'selector') return `Wait for ${truncate(config.selector, 20)}`;
      return 'Wait';
    case 'variable':
      return config.name ? `${config.name} = ${truncate(String(config.value), 20)}` : 'Set variable';
    case 'condition':
      return 'Conditional branch';
    case 'loop':
      if (config.loopType === 'for') return `Repeat ${config.count} times`;
      return 'Loop';
    case 'subprocess':
      return 'Run sub-workflow';
    case 'try_catch':
      return 'Error handling';
    default:
      return props.step.description || '';
  }
});

const isControlStep = computed(() => {
  return ['condition', 'loop', 'try_catch', 'subprocess'].includes(
    props.step.action || props.step.type
  );
});

const hasNestedSteps = computed(() => {
  const config = props.step.config || {};
  return (
    (config.thenSteps?.length > 0) ||
    (config.elseSteps?.length > 0) ||
    (config.steps?.length > 0) ||
    (config.trySteps?.length > 0) ||
    (config.catchSteps?.length > 0)
  );
});

const nestedStepsCount = computed(() => {
  const config = props.step.config || {};
  return (
    (config.thenSteps?.length || 0) +
    (config.elseSteps?.length || 0) +
    (config.steps?.length || 0) +
    (config.trySteps?.length || 0) +
    (config.catchSteps?.length || 0)
  );
});

const truncate = (str, maxLen) => {
  if (!str) return '';
  return str.length > maxLen ? str.substring(0, maxLen) + '...' : str;
};
</script>

<style scoped>
.step-node {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: #fff;
  border: 2px solid #e8e8e8;
  border-radius: 8px;
  width: 100%;
  max-width: 360px;
  cursor: pointer;
  transition: all 0.2s;
  position: relative;
}

.step-node:hover {
  border-color: #1890ff;
  box-shadow: 0 2px 8px rgba(24, 144, 255, 0.15);
}

.step-node.selected {
  border-color: #1890ff;
  background: #e6f7ff;
}

.step-node.status-running {
  border-color: #1890ff;
  animation: pulse 1.5s infinite;
}

.step-node.status-success {
  border-color: #52c41a;
}

.step-node.status-failed {
  border-color: #ff4d4f;
}

.step-node.is-control {
  border-style: dashed;
}

@keyframes pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(24, 144, 255, 0.4); }
  50% { box-shadow: 0 0 0 8px rgba(24, 144, 255, 0); }
}

.drag-handle {
  cursor: move;
  color: #999;
  padding: 4px;
}

.drag-handle:hover {
  color: #666;
}

.step-number {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: #f0f0f0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 500;
  color: #666;
}

.step-icon {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 18px;
  flex-shrink: 0;
}

.step-content {
  flex: 1;
  min-width: 0;
}

.step-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.step-name {
  font-weight: 500;
  font-size: 14px;
}

.step-details {
  font-size: 12px;
  color: #666;
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.step-status {
  font-size: 18px;
}

.step-status .success {
  color: #52c41a;
}

.step-status .failed {
  color: #ff4d4f;
}

.delete-btn {
  opacity: 0;
  transition: opacity 0.2s;
  color: #999;
}

.step-node:hover .delete-btn {
  opacity: 1;
}

.delete-btn:hover {
  color: #ff4d4f;
}

.nested-indicator {
  position: absolute;
  bottom: -20px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: #999;
  background: #fff;
  padding: 2px 8px;
  border-radius: 10px;
  border: 1px solid #e8e8e8;
}
</style>
