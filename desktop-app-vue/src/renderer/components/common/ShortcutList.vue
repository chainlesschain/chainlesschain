<template>
  <div class="shortcut-list">
    <a-empty
      v-if="shortcuts.length === 0"
      description="没有找到快捷键"
      :image="Empty.PRESENTED_IMAGE_SIMPLE"
    />

    <div
      v-for="(shortcut, index) in shortcuts"
      :key="index"
      class="shortcut-item"
    >
      <div class="shortcut-description">
        {{ shortcut.description }}
      </div>
      <div class="shortcut-keys">
        <a-tag
          v-for="(key, keyIndex) in shortcut.keys"
          :key="keyIndex"
          class="shortcut-key"
        >
          {{ formatKey(key) }}
        </a-tag>
      </div>
    </div>
  </div>
</template>

<script setup>
import { Empty } from 'ant-design-vue';

defineProps({
  shortcuts: {
    type: Array,
    default: () => [],
  },
});

// 格式化按键显示
const formatKey = (key) => {
  const keyMap = {
    ctrl: '⌘',
    shift: '⇧',
    alt: '⌥',
    enter: '↵',
    escape: 'Esc',
    backspace: '⌫',
    delete: 'Del',
    arrowup: '↑',
    arrowdown: '↓',
    arrowleft: '←',
    arrowright: '→',
    '+': '+',
    '-': '-',
    '0': '0',
  };
  return keyMap[key.toLowerCase()] || key.toUpperCase();
};
</script>

<style scoped>
.shortcut-list {
  padding: 16px;
  max-height: 500px;
  overflow-y: auto;
}

.shortcut-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid #f0f0f0;
  transition: background-color 0.2s;
}

.shortcut-item:hover {
  background-color: #fafafa;
}

.shortcut-item:last-child {
  border-bottom: none;
}

.shortcut-description {
  flex: 1;
  color: #262626;
  font-size: 14px;
}

.shortcut-keys {
  display: flex;
  gap: 4px;
  align-items: center;
}

.shortcut-key {
  min-width: 32px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 8px;
  font-family: 'Courier New', monospace;
  font-size: 13px;
  font-weight: 500;
  background: linear-gradient(180deg, #ffffff 0%, #f5f5f5 100%);
  border: 1px solid #d9d9d9;
  border-radius: 4px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  color: #262626;
}
</style>
