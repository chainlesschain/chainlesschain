<template>
  <a-modal
    v-model:open="visible"
    title="选择要共享的屏幕或窗口"
    width="800px"
    :footer="null"
    @cancel="handleCancel"
  >
    <a-spin :spinning="loading">
      <a-tabs v-model:active-key="activeTab">
        <!-- 屏幕标签页 -->
        <a-tab-pane
          key="screen"
          tab="整个屏幕"
        >
          <div class="source-grid">
            <div
              v-for="source in screenSources"
              :key="source.id"
              class="source-item"
              :class="{ selected: selectedSource?.id === source.id }"
              @click="selectSource(source)"
            >
              <div class="source-thumbnail">
                <img
                  :src="source.thumbnail"
                  :alt="source.name"
                >
              </div>
              <div class="source-name">
                {{ source.name }}
              </div>
            </div>
            <a-empty
              v-if="screenSources.length === 0"
              description="没有可用的屏幕"
            />
          </div>
        </a-tab-pane>

        <!-- 窗口标签页 -->
        <a-tab-pane
          key="window"
          tab="应用窗口"
        >
          <div class="source-grid">
            <div
              v-for="source in windowSources"
              :key="source.id"
              class="source-item"
              :class="{ selected: selectedSource?.id === source.id }"
              @click="selectSource(source)"
            >
              <div class="source-thumbnail">
                <img
                  :src="source.thumbnail"
                  :alt="source.name"
                >
                <img
                  v-if="source.appIcon"
                  :src="source.appIcon"
                  class="app-icon"
                >
              </div>
              <div class="source-name">
                {{ source.name }}
              </div>
            </div>
            <a-empty
              v-if="windowSources.length === 0"
              description="没有可用的窗口"
            />
          </div>
        </a-tab-pane>
      </a-tabs>

      <div class="modal-footer">
        <a-space>
          <a-button @click="handleCancel">
            取消
          </a-button>
          <a-button
            type="primary"
            :disabled="!selectedSource"
            @click="handleConfirm"
          >
            共享
          </a-button>
        </a-space>
      </div>
    </a-spin>
  </a-modal>
</template>

<script setup>
import { logger, createLogger } from '@/utils/logger';

import { ref, computed, watch } from 'vue'
import { message } from 'ant-design-vue'

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['update:visible', 'select'])

// 状态
const visible = computed({
  get: () => props.visible,
  set: (val) => emit('update:visible', val)
})

const loading = ref(false)
const activeTab = ref('screen')
const sources = ref([])
const selectedSource = ref(null)

// 计算属性
const screenSources = computed(() => {
  return sources.value.filter(s => s.id.startsWith('screen:'))
})

const windowSources = computed(() => {
  return sources.value.filter(s => s.id.startsWith('window:'))
})

// 监听visible变化，加载屏幕源
watch(visible, async (newVal) => {
  if (newVal) {
    await loadSources()
  } else {
    selectedSource.value = null
  }
})

// 方法
const loadSources = async () => {
  try {
    loading.value = true
    const result = await window.electron.ipcRenderer.invoke('screen-share:get-sources', {
      types: ['screen', 'window'],
      thumbnailSize: { width: 300, height: 200 }
    })

    if (result.success) {
      sources.value = result.sources
    } else {
      message.error('获取屏幕源失败: ' + result.error)
    }
  } catch (error) {
    logger.error('加载屏幕源失败:', error)
    message.error('加载屏幕源失败')
  } finally {
    loading.value = false
  }
}

const selectSource = (source) => {
  selectedSource.value = source
}

const handleConfirm = () => {
  if (selectedSource.value) {
    emit('select', selectedSource.value)
    visible.value = false
  }
}

const handleCancel = () => {
  visible.value = false
}
</script>

<style scoped>
.source-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 16px;
  max-height: 400px;
  overflow-y: auto;
  padding: 16px 0;
}

.source-item {
  cursor: pointer;
  border: 2px solid transparent;
  border-radius: 8px;
  padding: 8px;
  transition: all 0.3s;
}

.source-item:hover {
  border-color: #1890ff;
  background-color: #f0f5ff;
}

.source-item.selected {
  border-color: #1890ff;
  background-color: #e6f7ff;
}

.source-thumbnail {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 10;
  border-radius: 4px;
  overflow: hidden;
  background-color: #f0f0f0;
}

.source-thumbnail img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.app-icon {
  position: absolute;
  bottom: 8px;
  right: 8px;
  width: 32px;
  height: 32px;
  border-radius: 4px;
  background-color: white;
  padding: 2px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

.source-name {
  margin-top: 8px;
  text-align: center;
  font-size: 12px;
  color: #666;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.modal-footer {
  margin-top: 16px;
  text-align: right;
  padding-top: 16px;
  border-top: 1px solid #f0f0f0;
}
</style>
