<template>
  <div class="performance-monitor">
    <a-card
      :title="collapsed ? '' : 'Performance Monitor'"
      size="small"
      :class="['monitor-card', { collapsed }]"
    >
      <template #extra>
        <a-space>
          <a-button
            type="text"
            size="small"
            :icon="collapsed ? h(ExpandOutlined) : h(ShrinkOutlined)"
            @click="toggleCollapse"
          />
          <a-button
            v-if="!collapsed"
            type="text"
            size="small"
            :icon="h(ClearOutlined)"
            @click="clearMetrics"
          />
        </a-space>
      </template>

      <div
        v-if="!collapsed"
        class="metrics-container"
      >
        <!-- Real-time Stats -->
        <a-row :gutter="[16, 16]">
          <a-col :span="6">
            <a-statistic
              title="File Operations"
              :value="metrics.fileOperations.total"
              :precision="0"
            >
              <template #suffix>
                <span class="metric-suffix">
                  ({{ metrics.fileOperations.avgTime }}ms avg)
                </span>
              </template>
            </a-statistic>
          </a-col>
          <a-col :span="6">
            <a-statistic
              title="AI Responses"
              :value="metrics.aiResponses.total"
              :precision="0"
            >
              <template #suffix>
                <span class="metric-suffix">
                  ({{ metrics.aiResponses.avgTime }}ms avg)
                </span>
              </template>
            </a-statistic>
          </a-col>
          <a-col :span="6">
            <a-statistic
              title="Memory Usage"
              :value="metrics.memory.used"
              :precision="2"
              suffix="MB"
            >
              <template #prefix>
                <component
                  :is="getMemoryIcon()"
                  :style="{ color: getMemoryColor() }"
                />
              </template>
            </a-statistic>
          </a-col>
          <a-col :span="6">
            <a-statistic
              title="FPS"
              :value="metrics.fps"
              :precision="0"
            >
              <template #prefix>
                <component
                  :is="getFpsIcon()"
                  :style="{ color: getFpsColor() }"
                />
              </template>
            </a-statistic>
          </a-col>
        </a-row>

        <!-- Charts -->
        <a-tabs
          v-model:active-key="activeTab"
          size="small"
          class="metrics-tabs"
        >
          <a-tab-pane
            key="fileOps"
            tab="File Operations"
          >
            <div class="chart-container">
              <canvas ref="fileOpsChart" />
            </div>
            <a-list
              size="small"
              :data-source="recentFileOps"
              class="recent-operations"
            >
              <template #renderItem="{ item }">
                <a-list-item>
                  <a-list-item-meta>
                    <template #title>
                      <span>{{ item.operation }}</span>
                      <a-tag
                        :color="getOperationColor(item.duration)"
                        size="small"
                        class="duration-tag"
                      >
                        {{ item.duration }}ms
                      </a-tag>
                    </template>
                    <template #description>
                      {{ item.file }} - {{ formatTime(item.timestamp) }}
                    </template>
                  </a-list-item-meta>
                </a-list-item>
              </template>
            </a-list>
          </a-tab-pane>

          <a-tab-pane
            key="aiResponses"
            tab="AI Responses"
          >
            <div class="chart-container">
              <canvas ref="aiResponseChart" />
            </div>
            <a-list
              size="small"
              :data-source="recentAiResponses"
              class="recent-operations"
            >
              <template #renderItem="{ item }">
                <a-list-item>
                  <a-list-item-meta>
                    <template #title>
                      <span>{{ item.model }}</span>
                      <a-tag
                        :color="getOperationColor(item.duration)"
                        size="small"
                        class="duration-tag"
                      >
                        {{ item.duration }}ms
                      </a-tag>
                    </template>
                    <template #description>
                      {{ item.tokens }} tokens - {{ formatTime(item.timestamp) }}
                    </template>
                  </a-list-item-meta>
                </a-list-item>
              </template>
            </a-list>
          </a-tab-pane>

          <a-tab-pane
            key="system"
            tab="System"
          >
            <a-descriptions
              :column="2"
              size="small"
              bordered
            >
              <a-descriptions-item label="Heap Used">
                {{ metrics.memory.heapUsed }}MB / {{ metrics.memory.heapTotal }}MB
              </a-descriptions-item>
              <a-descriptions-item label="Heap Limit">
                {{ metrics.memory.heapLimit }}MB
              </a-descriptions-item>
              <a-descriptions-item label="External">
                {{ metrics.memory.external }}MB
              </a-descriptions-item>
              <a-descriptions-item label="Array Buffers">
                {{ metrics.memory.arrayBuffers }}MB
              </a-descriptions-item>
              <a-descriptions-item label="DOM Nodes">
                {{ metrics.dom.nodes }}
              </a-descriptions-item>
              <a-descriptions-item label="Event Listeners">
                {{ metrics.dom.listeners }}
              </a-descriptions-item>
              <a-descriptions-item label="Network Requests">
                {{ metrics.network.requests }}
              </a-descriptions-item>
              <a-descriptions-item label="Cache Hit Rate">
                {{ metrics.cache.hitRate }}%
              </a-descriptions-item>
            </a-descriptions>
          </a-tab-pane>
        </a-tabs>
      </div>

      <!-- Collapsed View -->
      <div
        v-else
        class="collapsed-view"
      >
        <a-space>
          <a-badge
            :count="metrics.fileOperations.total"
            :overflow-count="999"
          >
            <FileOutlined />
          </a-badge>
          <a-badge
            :count="metrics.aiResponses.total"
            :overflow-count="999"
          >
            <RobotOutlined />
          </a-badge>
          <span :style="{ color: getFpsColor() }">{{ metrics.fps }} FPS</span>
        </a-space>
      </div>
    </a-card>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onUnmounted, nextTick, h } from 'vue'
import {
  FileOutlined,
  RobotOutlined,
  ExpandOutlined,
  ShrinkOutlined,
  ClearOutlined,
  ThunderboltOutlined,
  WarningOutlined,
  CheckCircleOutlined
} from '@ant-design/icons-vue'
import Chart from 'chart.js/auto'

const collapsed = ref(true)
const activeTab = ref('fileOps')

const metrics = reactive({
  fileOperations: {
    total: 0,
    avgTime: 0,
    times: []
  },
  aiResponses: {
    total: 0,
    avgTime: 0,
    times: []
  },
  memory: {
    used: 0,
    heapUsed: 0,
    heapTotal: 0,
    heapLimit: 0,
    external: 0,
    arrayBuffers: 0
  },
  dom: {
    nodes: 0,
    listeners: 0
  },
  network: {
    requests: 0
  },
  cache: {
    hitRate: 0
  },
  fps: 0
})

const recentFileOps = ref([])
const recentAiResponses = ref([])

const fileOpsChart = ref(null)
const aiResponseChart = ref(null)
let fileOpsChartInstance = null
let aiResponseChartInstance = null

let updateInterval = null
const fpsInterval = null
let lastFrameTime = performance.now()
let frameCount = 0

// Toggle collapse
const toggleCollapse = () => {
  collapsed.value = !collapsed.value
  if (!collapsed.value) {
    nextTick(() => {
      initCharts()
    })
  }
}

// Clear metrics
const clearMetrics = () => {
  metrics.fileOperations.total = 0
  metrics.fileOperations.avgTime = 0
  metrics.fileOperations.times = []
  metrics.aiResponses.total = 0
  metrics.aiResponses.avgTime = 0
  metrics.aiResponses.times = []
  recentFileOps.value = []
  recentAiResponses.value = []
  updateCharts()
}

// Track file operation
const trackFileOperation = (operation, file, duration) => {
  metrics.fileOperations.total++
  metrics.fileOperations.times.push(duration)

  // Keep only last 100 operations
  if (metrics.fileOperations.times.length > 100) {
    metrics.fileOperations.times.shift()
  }

  // Calculate average
  const sum = metrics.fileOperations.times.reduce((a, b) => a + b, 0)
  metrics.fileOperations.avgTime = Math.round(sum / metrics.fileOperations.times.length)

  // Add to recent operations
  recentFileOps.value.unshift({
    operation,
    file,
    duration,
    timestamp: Date.now()
  })

  // Keep only last 10
  if (recentFileOps.value.length > 10) {
    recentFileOps.value.pop()
  }

  updateCharts()
}

// Track AI response
const trackAiResponse = (model, tokens, duration) => {
  metrics.aiResponses.total++
  metrics.aiResponses.times.push(duration)

  // Keep only last 100 responses
  if (metrics.aiResponses.times.length > 100) {
    metrics.aiResponses.times.shift()
  }

  // Calculate average
  const sum = metrics.aiResponses.times.reduce((a, b) => a + b, 0)
  metrics.aiResponses.avgTime = Math.round(sum / metrics.aiResponses.times.length)

  // Add to recent responses
  recentAiResponses.value.unshift({
    model,
    tokens,
    duration,
    timestamp: Date.now()
  })

  // Keep only last 10
  if (recentAiResponses.value.length > 10) {
    recentAiResponses.value.pop()
  }

  updateCharts()
}

// Update memory metrics
const updateMemoryMetrics = () => {
  if (performance.memory) {
    const memory = performance.memory
    metrics.memory.used = Math.round(memory.usedJSHeapSize / 1024 / 1024)
    metrics.memory.heapUsed = Math.round(memory.usedJSHeapSize / 1024 / 1024)
    metrics.memory.heapTotal = Math.round(memory.totalJSHeapSize / 1024 / 1024)
    metrics.memory.heapLimit = Math.round(memory.jsHeapSizeLimit / 1024 / 1024)
  }

  // DOM metrics
  metrics.dom.nodes = document.querySelectorAll('*').length

  // Event listeners: getEventListeners() only works in Chrome DevTools Console
  // Not available in regular JavaScript, so we set it to 0
  metrics.dom.listeners = 0
}

// Update FPS
const updateFps = () => {
  frameCount++
  const currentTime = performance.now()
  const elapsed = currentTime - lastFrameTime

  if (elapsed >= 1000) {
    metrics.fps = Math.round((frameCount * 1000) / elapsed)
    frameCount = 0
    lastFrameTime = currentTime
  }

  requestAnimationFrame(updateFps)
}

// Initialize charts
const initCharts = () => {
  if (fileOpsChart.value && !fileOpsChartInstance) {
    const ctx = fileOpsChart.value.getContext('2d')
    fileOpsChartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          label: 'Response Time (ms)',
          data: [],
          borderColor: '#1890ff',
          backgroundColor: 'rgba(24, 144, 255, 0.1)',
          tension: 0.4,
          fill: true
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false
          }
        },
        scales: {
          y: {
            beginAtZero: true
          }
        }
      }
    })
  }

  if (aiResponseChart.value && !aiResponseChartInstance) {
    const ctx = aiResponseChart.value.getContext('2d')
    aiResponseChartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          label: 'Response Time (ms)',
          data: [],
          borderColor: '#52c41a',
          backgroundColor: 'rgba(82, 196, 26, 0.1)',
          tension: 0.4,
          fill: true
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false
          }
        },
        scales: {
          y: {
            beginAtZero: true
          }
        }
      }
    })
  }
}

// Update charts
const updateCharts = () => {
  if (fileOpsChartInstance && metrics.fileOperations.times.length > 0) {
    const labels = metrics.fileOperations.times.map((_, i) => i + 1)
    fileOpsChartInstance.data.labels = labels
    fileOpsChartInstance.data.datasets[0].data = metrics.fileOperations.times
    fileOpsChartInstance.update('none')
  }

  if (aiResponseChartInstance && metrics.aiResponses.times.length > 0) {
    const labels = metrics.aiResponses.times.map((_, i) => i + 1)
    aiResponseChartInstance.data.labels = labels
    aiResponseChartInstance.data.datasets[0].data = metrics.aiResponses.times
    aiResponseChartInstance.update('none')
  }
}

// Get operation color based on duration
const getOperationColor = (duration) => {
  if (duration < 100) {return 'success'}
  if (duration < 500) {return 'warning'}
  return 'error'
}

// Get memory icon
const getMemoryIcon = () => {
  const percentage = (metrics.memory.heapUsed / metrics.memory.heapLimit) * 100
  if (percentage < 50) {return CheckCircleOutlined}
  if (percentage < 80) {return WarningOutlined}
  return ThunderboltOutlined
}

// Get memory color
const getMemoryColor = () => {
  const percentage = (metrics.memory.heapUsed / metrics.memory.heapLimit) * 100
  if (percentage < 50) {return '#52c41a'}
  if (percentage < 80) {return '#faad14'}
  return '#ff4d4f'
}

// Get FPS icon
const getFpsIcon = () => {
  if (metrics.fps >= 50) {return CheckCircleOutlined}
  if (metrics.fps >= 30) {return WarningOutlined}
  return ThunderboltOutlined
}

// Get FPS color
const getFpsColor = () => {
  if (metrics.fps >= 50) {return '#52c41a'}
  if (metrics.fps >= 30) {return '#faad14'}
  return '#ff4d4f'
}

// Format time
const formatTime = (timestamp) => {
  const date = new Date(timestamp)
  return date.toLocaleTimeString()
}

// Expose methods
defineExpose({
  trackFileOperation,
  trackAiResponse
})

onMounted(() => {
  // Update metrics every second
  updateInterval = setInterval(() => {
    updateMemoryMetrics()
  }, 1000)

  // Start FPS monitoring
  updateFps()
})

onUnmounted(() => {
  if (updateInterval) {
    clearInterval(updateInterval)
  }

  if (fileOpsChartInstance) {
    fileOpsChartInstance.destroy()
  }

  if (aiResponseChartInstance) {
    aiResponseChartInstance.destroy()
  }
})
</script>

<style scoped>
.performance-monitor {
  position: fixed;
  bottom: 20px;
  left: 20px;
  z-index: 999;
  max-width: 600px;
  pointer-events: auto;
}

.monitor-card {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  transition: all 0.3s ease;
}

.monitor-card.collapsed {
  width: auto;
}

.metrics-container {
  max-height: 500px;
  overflow-y: auto;
}

.metric-suffix {
  font-size: 12px;
  color: #8c8c8c;
}

.metrics-tabs {
  margin-top: 16px;
}

.chart-container {
  height: 200px;
  margin-bottom: 16px;
}

.recent-operations {
  max-height: 200px;
  overflow-y: auto;
}

.duration-tag {
  margin-left: 8px;
}

.collapsed-view {
  display: flex;
  align-items: center;
  gap: 12px;
}
</style>
