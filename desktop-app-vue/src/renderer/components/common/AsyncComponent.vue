<template>
  <div class="async-component-wrapper">
    <!-- Loading state -->
    <div
      v-if="loading"
      class="async-loading"
    >
      <slot name="loading">
        <div class="default-loading">
          <LoadingOutlined
            class="loading-icon"
            spin
          />
          <div class="loading-text">
            {{ loadingText }}
          </div>
          <div
            v-if="showProgress"
            class="loading-progress"
          >
            <a-progress
              :percent="loadProgress"
              :show-info="false"
              size="small"
            />
          </div>
        </div>
      </slot>
    </div>

    <!-- Error state -->
    <div
      v-else-if="error"
      class="async-error"
    >
      <slot
        name="error"
        :error="error"
        :retry="loadComponent"
      >
        <div class="default-error">
          <WarningOutlined class="error-icon" />
          <div class="error-title">
            Failed to load component
          </div>
          <div class="error-message">
            {{ error.message }}
          </div>
          <a-button
            type="primary"
            size="small"
            @click="loadComponent"
          >
            <ReloadOutlined /> Retry
          </a-button>
        </div>
      </slot>
    </div>

    <!-- Loaded component -->
    <component
      :is="loadedComponent"
      v-else
      v-bind="$attrs"
      @vue:mounted="handleMounted"
    />
  </div>
</template>

<script setup>
import { ref, onMounted, watch } from 'vue'
import { LoadingOutlined, WarningOutlined, ReloadOutlined } from '@ant-design/icons-vue'

const props = defineProps({
  // Component loader function (returns Promise)
  loader: {
    type: Function,
    required: true
  },

  // Loading text
  loadingText: {
    type: String,
    default: 'Loading component...'
  },

  // Show loading progress bar
  showProgress: {
    type: Boolean,
    default: false
  },

  // Delay before showing loading (ms)
  delay: {
    type: Number,
    default: 200
  },

  // Timeout for loading (ms)
  timeout: {
    type: Number,
    default: 30000
  },

  // Auto-retry on error
  autoRetry: {
    type: Boolean,
    default: false
  },

  // Max retry attempts
  maxRetries: {
    type: Number,
    default: 3
  },

  // Retry delay (ms)
  retryDelay: {
    type: Number,
    default: 1000
  }
})

const emit = defineEmits(['loaded', 'error', 'mounted'])

// State
const loading = ref(false)
const error = ref(null)
const loadedComponent = ref(null)
const loadProgress = ref(0)
const retryCount = ref(0)

let delayTimer = null
let timeoutTimer = null
let progressInterval = null

/**
 * Load component
 */
const loadComponent = async () => {
  loading.value = false
  error.value = null
  loadProgress.value = 0
  clearTimers()

  // Start delay timer
  delayTimer = setTimeout(() => {
    loading.value = true
    startProgressSimulation()
  }, props.delay)

  // Start timeout timer
  timeoutTimer = setTimeout(() => {
    if (loading.value) {
      error.value = new Error('Component load timeout')
      loading.value = false
      clearTimers()
      emit('error', error.value)
    }
  }, props.timeout)

  try {
    // Load component
    const component = await props.loader()

    // Success
    loadedComponent.value = component.default || component
    loadProgress.value = 100
    loading.value = false

    clearTimers()
    emit('loaded', loadedComponent.value)

    // Reset retry count on success
    retryCount.value = 0
  } catch (err) {
    error.value = err
    loading.value = false

    clearTimers()
    emit('error', err)

    // Auto-retry
    if (props.autoRetry && retryCount.value < props.maxRetries) {
      retryCount.value++
      console.log(`[AsyncComponent] Auto-retry ${retryCount.value}/${props.maxRetries}`)

      setTimeout(() => {
        loadComponent()
      }, props.retryDelay * retryCount.value) // Exponential backoff
    }
  }
}

/**
 * Simulate loading progress (for better UX)
 */
const startProgressSimulation = () => {
  if (!props.showProgress) {return}

  progressInterval = setInterval(() => {
    if (loadProgress.value < 90) {
      loadProgress.value += Math.random() * 10
    }
  }, 300)
}

/**
 * Clear all timers
 */
const clearTimers = () => {
  if (delayTimer) {
    clearTimeout(delayTimer)
    delayTimer = null
  }

  if (timeoutTimer) {
    clearTimeout(timeoutTimer)
    timeoutTimer = null
  }

  if (progressInterval) {
    clearInterval(progressInterval)
    progressInterval = null
  }
}

/**
 * Handle component mounted
 */
const handleMounted = () => {
  emit('mounted')
}

// Lifecycle
onMounted(() => {
  loadComponent()
})

// Watch loader changes
watch(() => props.loader, () => {
  loadComponent()
})

// Cleanup
onUnmounted(() => {
  clearTimers()
})
</script>

<style scoped>
.async-component-wrapper {
  min-height: 100px;
}

/* Loading state */
.async-loading {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 200px;
  padding: 40px 20px;
}

.default-loading {
  text-align: center;
  color: #1890ff;
}

.loading-icon {
  font-size: 32px;
  margin-bottom: 16px;
}

.loading-text {
  font-size: 14px;
  margin-bottom: 12px;
  color: #595959;
}

.loading-progress {
  width: 200px;
  margin: 0 auto;
}

/* Error state */
.async-error {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 200px;
  padding: 40px 20px;
}

.default-error {
  text-align: center;
  max-width: 400px;
}

.error-icon {
  font-size: 48px;
  color: #ff4d4f;
  margin-bottom: 16px;
}

.error-title {
  font-size: 16px;
  font-weight: 600;
  color: #262626;
  margin-bottom: 8px;
}

.error-message {
  font-size: 14px;
  color: #8c8c8c;
  margin-bottom: 16px;
  word-break: break-word;
}

/* Dark theme */
.dark .loading-text,
.dark .error-title {
  color: #ffffff;
}

.dark .error-message {
  color: #bfbfbf;
}
</style>
