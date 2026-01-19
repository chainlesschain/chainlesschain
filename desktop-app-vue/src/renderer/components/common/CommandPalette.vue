<template>
  <a-modal
    v-model:open="visible"
    :footer="null"
    :closable="false"
    :width="600"
    wrap-class-name="command-palette-modal"
    @cancel="close"
  >
    <div class="command-palette">
      <!-- 搜索框 -->
      <div class="search-box">
        <SearchOutlined class="search-icon" />
        <input
          ref="searchInput"
          v-model="searchQuery"
          type="text"
          placeholder="输入命令或快捷键..."
          class="search-input"
          @keydown.down.prevent="selectNext"
          @keydown.up.prevent="selectPrevious"
          @keydown.enter.prevent="executeSelected"
          @keydown.esc="close"
        >
        <span class="search-hint">Esc 关闭</span>
      </div>

      <!-- 命令列表 -->
      <div
        ref="commandList"
        class="command-list"
      >
        <div
          v-for="(command, index) in filteredCommands"
          :key="command.key"
          class="command-item"
          :class="{ active: index === selectedIndex }"
          @click="executeCommand(command)"
          @mouseenter="selectedIndex = index"
        >
          <div class="command-info">
            <div class="command-description">
              {{ command.description }}
            </div>
            <div
              v-if="command.scope !== 'global'"
              class="command-scope"
            >
              <TagOutlined />
              {{ command.scope }}
            </div>
          </div>
          <div class="command-shortcut">
            {{ command.keyDisplay }}
          </div>
        </div>

        <!-- 空状态 -->
        <div
          v-if="filteredCommands.length === 0"
          class="empty-state"
        >
          <InboxOutlined class="empty-icon" />
          <div class="empty-text">
            没有找到匹配的命令
          </div>
          <div class="empty-hint">
            试试其他关键词
          </div>
        </div>
      </div>

      <!-- 底部提示 -->
      <div class="palette-footer">
        <div class="footer-hint">
          <span><ArrowUpOutlined /> <ArrowDownOutlined /> 选择</span>
          <span><EnterOutlined /> 执行</span>
          <span><CloseOutlined /> 关闭</span>
        </div>
        <div class="footer-stats">
          {{ filteredCommands.length }} / {{ allCommands.length }} 命令
        </div>
      </div>
    </div>
  </a-modal>
</template>

<script setup>
import { logger, createLogger } from '@/utils/logger';

import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import {
  SearchOutlined,
  TagOutlined,
  InboxOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  EnterOutlined,
  CloseOutlined
} from '@ant-design/icons-vue'
import keyboardShortcuts from '@/utils/keyboard-shortcuts'

const visible = ref(false)
const searchQuery = ref('')
const selectedIndex = ref(0)
const searchInput = ref(null)
const commandList = ref(null)
const allCommands = ref([])

// 过滤后的命令列表
const filteredCommands = computed(() => {
  if (!searchQuery.value.trim()) {
    return allCommands.value
  }

  const query = searchQuery.value.toLowerCase()

  return allCommands.value.filter(command => {
    return (
      command.description.toLowerCase().includes(query) ||
      command.keyDisplay.toLowerCase().includes(query) ||
      command.scope.toLowerCase().includes(query)
    )
  })
})

// 监听搜索变化，重置选中索引
watch(searchQuery, () => {
  selectedIndex.value = 0
})

// 监听选中索引变化，滚动到可见区域
watch(selectedIndex, async () => {
  await nextTick()

  if (commandList.value) {
    const activeItem = commandList.value.querySelector('.command-item.active')
    if (activeItem) {
      activeItem.scrollIntoView({
        block: 'nearest',
        behavior: 'smooth'
      })
    }
  }
})

/**
 * 显示命令面板
 */
const show = () => {
  visible.value = true
  searchQuery.value = ''
  selectedIndex.value = 0
  allCommands.value = keyboardShortcuts.getAllCommands()

  // 聚焦搜索框
  nextTick(() => {
    searchInput.value?.focus()
  })
}

/**
 * 关闭命令面板
 */
const close = () => {
  visible.value = false
  keyboardShortcuts.hideCommandPalette()
}

/**
 * 选择下一个命令
 */
const selectNext = () => {
  if (selectedIndex.value < filteredCommands.value.length - 1) {
    selectedIndex.value++
  } else {
    selectedIndex.value = 0
  }
}

/**
 * 选择上一个命令
 */
const selectPrevious = () => {
  if (selectedIndex.value > 0) {
    selectedIndex.value--
  } else {
    selectedIndex.value = filteredCommands.value.length - 1
  }
}

/**
 * 执行选中的命令
 */
const executeSelected = () => {
  const command = filteredCommands.value[selectedIndex.value]
  if (command) {
    executeCommand(command)
  }
}

/**
 * 执行命令
 */
const executeCommand = (command) => {
  try {
    command.handler()
    close()
  } catch (error) {
    logger.error('[CommandPalette] Execute error:', error)
  }
}

/**
 * 监听显示/隐藏事件
 */
const handleShowEvent = () => {
  show()
}

const handleHideEvent = () => {
  close()
}

onMounted(() => {
  window.addEventListener('show-command-palette', handleShowEvent)
  window.addEventListener('hide-command-palette', handleHideEvent)
})

onUnmounted(() => {
  window.removeEventListener('show-command-palette', handleShowEvent)
  window.removeEventListener('hide-command-palette', handleHideEvent)
})

// 暴露方法
defineExpose({
  show,
  close
})
</script>

<style scoped>
/* 命令面板容器 */
.command-palette {
  display: flex;
  flex-direction: column;
  max-height: 600px;
}

/* 搜索框 */
.search-box {
  display: flex;
  align-items: center;
  padding: 16px;
  border-bottom: 1px solid #f0f0f0;
  gap: 12px;
}

.search-icon {
  font-size: 18px;
  color: #8c8c8c;
}

.search-input {
  flex: 1;
  border: none;
  outline: none;
  font-size: 16px;
  color: #262626;
  background: transparent;
}

.search-input::placeholder {
  color: #bfbfbf;
}

.search-hint {
  font-size: 12px;
  color: #8c8c8c;
  padding: 2px 8px;
  background: #f5f5f5;
  border-radius: 3px;
}

/* 命令列表 */
.command-list {
  flex: 1;
  overflow-y: auto;
  max-height: 400px;
}

.command-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  cursor: pointer;
  transition: background-color 0.2s;
}

.command-item:hover,
.command-item.active {
  background-color: #f5f5f5;
}

.command-info {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
}

.command-description {
  font-size: 14px;
  color: #262626;
}

.command-scope {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #8c8c8c;
  padding: 2px 8px;
  background: #fafafa;
  border-radius: 3px;
}

.command-shortcut {
  font-size: 12px;
  color: #595959;
  padding: 4px 8px;
  background: #fafafa;
  border: 1px solid #d9d9d9;
  border-radius: 4px;
  font-family: monospace;
  white-space: nowrap;
}

/* 空状态 */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  color: #8c8c8c;
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 16px;
  opacity: 0.5;
}

.empty-text {
  font-size: 16px;
  margin-bottom: 8px;
}

.empty-hint {
  font-size: 14px;
  opacity: 0.7;
}

/* 底部 */
.palette-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-top: 1px solid #f0f0f0;
  background: #fafafa;
}

.footer-hint {
  display: flex;
  gap: 16px;
  font-size: 12px;
  color: #8c8c8c;
}

.footer-hint span {
  display: flex;
  align-items: center;
  gap: 4px;
}

.footer-stats {
  font-size: 12px;
  color: #8c8c8c;
}

/* 暗色主题 */
.dark .search-box {
  border-bottom-color: #3e3e3e;
}

.dark .search-input {
  color: #ffffff;
}

.dark .search-input::placeholder {
  color: #595959;
}

.dark .search-hint {
  background: #2a2a2a;
  color: #bfbfbf;
}

.dark .command-item:hover,
.dark .command-item.active {
  background-color: #2a2a2a;
}

.dark .command-description {
  color: #ffffff;
}

.dark .command-scope {
  background: #2a2a2a;
  color: #bfbfbf;
}

.dark .command-shortcut {
  background: #2a2a2a;
  border-color: #3e3e3e;
  color: #bfbfbf;
}

.dark .palette-footer {
  border-top-color: #3e3e3e;
  background: #1f1f1f;
}

.dark .footer-hint,
.dark .footer-stats {
  color: #bfbfbf;
}

/* 滚动条样式 */
.command-list::-webkit-scrollbar {
  width: 8px;
}

.command-list::-webkit-scrollbar-track {
  background: #f5f5f5;
}

.command-list::-webkit-scrollbar-thumb {
  background: #d9d9d9;
  border-radius: 4px;
}

.command-list::-webkit-scrollbar-thumb:hover {
  background: #bfbfbf;
}

.dark .command-list::-webkit-scrollbar-track {
  background: #1f1f1f;
}

.dark .command-list::-webkit-scrollbar-thumb {
  background: #3e3e3e;
}

.dark .command-list::-webkit-scrollbar-thumb:hover {
  background: #4e4e4e;
}
</style>

<style>
/* 模态框样式覆盖 */
.command-palette-modal .ant-modal {
  top: 100px;
}

.command-palette-modal .ant-modal-content {
  padding: 0;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.15);
}

.command-palette-modal .ant-modal-body {
  padding: 0;
}
</style>
