<template>
  <div
    class="cb-action"
    :class="[`cb-action--${item.status}`, { 'cb-action--expandable': expandable, 'cb-action--open': expanded }]"
    :data-testid="`tool-card-${item.id}`"
    @click="onToggle"
  >
    <span class="cb-action__icon">
      <CheckCircleFilled v-if="item.status === 'done'" />
      <LoadingOutlined v-else-if="item.status === 'running'" />
      <ClockCircleOutlined v-else />
    </span>
    <span class="cb-action__label">{{ item.label }}</span>
    <span v-if="item.detail" class="cb-action__detail">{{ item.detail }}</span>
    <span v-if="expandable" class="cb-action__caret">
      <DownOutlined v-if="expanded" />
      <RightOutlined v-else />
    </span>
  </div>
</template>

<script setup>
import {
  CheckCircleFilled,
  ClockCircleOutlined,
  DownOutlined,
  LoadingOutlined,
  RightOutlined,
} from '@ant-design/icons-vue'

const props = defineProps({
  item: { type: Object, required: true },
  expandable: { type: Boolean, default: false },
  expanded: { type: Boolean, default: false },
})

const emit = defineEmits(['toggle'])

function onToggle() {
  if (props.expandable) emit('toggle')
}
</script>

<style scoped>
.cb-action {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 10px;
  background: var(--bg-card-hover);
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
  user-select: none;
}

.cb-action--expandable {
  cursor: pointer;
  transition: border-color 0.15s ease;
}

.cb-action--expandable:hover {
  border-color: #1677ff40;
}

.cb-action--open {
  border-color: #1677ff60;
}

.cb-action__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #52c41a;
  font-size: 14px;
}

.cb-action--running .cb-action__icon {
  color: #1677ff;
}

.cb-action--pending .cb-action__icon {
  color: var(--text-muted);
}

.cb-action__label {
  font-weight: 600;
  color: var(--text-primary);
  font-size: 13px;
}

.cb-action__detail {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-secondary);
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cb-action__caret {
  margin-left: 6px;
  color: var(--text-muted);
  font-size: 10px;
}

.cb-action--open .cb-action__caret {
  color: #1677ff;
}
</style>
