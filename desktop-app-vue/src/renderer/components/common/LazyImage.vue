<template>
  <div class="lazy-image-wrapper" :class="wrapperClasses">
    <!-- Main image -->
    <img
      ref="imageRef"
      :alt="alt"
      :class="imageClasses"
      :style="imageStyle"
      @load="handleLoad"
      @error="handleError"
    />

    <!-- Loading spinner -->
    <div v-if="loading && showLoader" class="lazy-image-loader">
      <LoadingOutlined class="loader-icon" spin />
      <div v-if="loadProgress > 0" class="loader-progress">{{ loadProgress }}%</div>
    </div>

    <!-- Error state -->
    <div v-if="error && showError" class="lazy-image-error">
      <PictureOutlined class="error-icon" />
      <div class="error-text">{{ errorMessage }}</div>
      <a-button v-if="allowRetry" size="small" @click="retry">Retry</a-button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { LoadingOutlined, PictureOutlined } from '@ant-design/icons-vue'
import { getLazyLoader } from '@/utils/image-lazy-loader'

const props = defineProps({
  // Image source
  src: {
    type: String,
    required: true
  },

  // Low-res thumbnail for progressive loading
  thumbnail: {
    type: String,
    default: ''
  },

  // Alt text
  alt: {
    type: String,
    default: ''
  },

  // Loading priority ('high', 'normal', 'low')
  priority: {
    type: String,
    default: 'normal',
    validator: (value) => ['high', 'normal', 'low'].includes(value)
  },

  // Width
  width: {
    type: [String, Number],
    default: 'auto'
  },

  // Height
  height: {
    type: [String, Number],
    default: 'auto'
  },

  // Object fit ('cover', 'contain', 'fill', 'none', 'scale-down')
  fit: {
    type: String,
    default: 'cover',
    validator: (value) => ['cover', 'contain', 'fill', 'none', 'scale-down'].includes(value)
  },

  // Border radius
  radius: {
    type: [String, Number],
    default: 0
  },

  // Show loading spinner
  showLoader: {
    type: Boolean,
    default: true
  },

  // Show error message
  showError: {
    type: Boolean,
    default: true
  },

  // Custom error message
  errorMessage: {
    type: String,
    default: 'Failed to load image'
  },

  // Allow retry on error
  allowRetry: {
    type: Boolean,
    default: true
  },

  // Fade-in animation
  fadeIn: {
    type: Boolean,
    default: true
  }
})

const emit = defineEmits(['load', 'error', 'progress'])

// Refs
const imageRef = ref(null)
const loading = ref(true)
const error = ref(false)
const loadProgress = ref(0)
const lazyLoader = getLazyLoader()

// Computed
const wrapperClasses = computed(() => ({
  'lazy-image-loading': loading.value,
  'lazy-image-error': error.value,
  'lazy-image-fade': props.fadeIn
}))

const imageClasses = computed(() => ({
  'lazy-image': true,
  'lazy-loaded': !loading.value && !error.value
}))

const imageStyle = computed(() => ({
  width: typeof props.width === 'number' ? `${props.width}px` : props.width,
  height: typeof props.height === 'number' ? `${props.height}px` : props.height,
  objectFit: props.fit,
  borderRadius: typeof props.radius === 'number' ? `${props.radius}px` : props.radius
}))

/**
 * Handle successful load
 */
const handleLoad = (event) => {
  loading.value = false
  error.value = false
  loadProgress.value = 100

  emit('load', event)
}

/**
 * Handle load error
 */
const handleError = (event) => {
  loading.value = false
  error.value = true

  emit('error', event)
}

/**
 * Retry loading
 */
const retry = () => {
  loading.value = true
  error.value = false
  loadProgress.value = 0

  lazyLoader.unobserve(imageRef.value)
  initLazyLoad()
}

/**
 * Initialize lazy loading
 */
const initLazyLoad = () => {
  if (!imageRef.value || !props.src) return

  // Set data attributes
  imageRef.value.dataset.src = props.src
  if (props.thumbnail) {
    imageRef.value.dataset.lowResSrc = props.thumbnail
  }

  // Listen to lazy load events
  imageRef.value.addEventListener('lazyloaded', (event) => {
    handleLoad(event)
  })

  imageRef.value.addEventListener('lazyloaderror', (event) => {
    handleError(event)
  })

  // Observe with lazy loader
  lazyLoader.observe(imageRef.value, {
    priority: props.priority,
    lowResSrc: props.thumbnail
  })
}

/**
 * Simulate progress (for better UX)
 */
const simulateProgress = () => {
  const interval = setInterval(() => {
    if (loadProgress.value < 90 && loading.value) {
      loadProgress.value += Math.random() * 20
      emit('progress', loadProgress.value)
    } else {
      clearInterval(interval)
    }
  }, 300)
}

// Lifecycle
onMounted(() => {
  initLazyLoad()
  if (props.showLoader) {
    simulateProgress()
  }
})

onUnmounted(() => {
  if (imageRef.value) {
    lazyLoader.unobserve(imageRef.value)
  }
})

// Watch src changes
watch(() => props.src, () => {
  loading.value = true
  error.value = false
  loadProgress.value = 0

  if (imageRef.value) {
    lazyLoader.unobserve(imageRef.value)
    initLazyLoad()
  }
})
</script>

<style scoped>
.lazy-image-wrapper {
  position: relative;
  display: inline-block;
  overflow: hidden;
  background-color: #f5f5f5;
}

.lazy-image {
  display: block;
  width: 100%;
  height: 100%;
  transition: opacity 0.3s ease-in-out;
}

/* Fade-in animation */
.lazy-image-fade .lazy-image {
  opacity: 0;
}

.lazy-image-fade .lazy-image.lazy-loaded {
  opacity: 1;
}

/* Loading state */
.lazy-image-loading .lazy-image {
  opacity: 0.3;
}

.lazy-image-loader {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  color: #1890ff;
}

.loader-icon {
  font-size: 24px;
}

.loader-progress {
  font-size: 12px;
  color: #8c8c8c;
}

/* Error state */
.lazy-image-error .lazy-image {
  opacity: 0;
}

.lazy-image-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 20px;
  color: #ff4d4f;
}

.error-icon {
  font-size: 48px;
  opacity: 0.5;
}

.error-text {
  font-size: 14px;
  color: #8c8c8c;
}

/* Blur-up effect for progressive loading */
.lazy-image.lazy-loading-blur {
  filter: blur(20px);
  transform: scale(1.1);
}

/* Dark theme */
.dark .lazy-image-wrapper {
  background-color: #2a2a2a;
}

.dark .loader-progress,
.dark .error-text {
  color: #bfbfbf;
}
</style>
