<template>
  <Teleport to="body">
    <div
      class="photo-viewer-overlay"
      @click.self="handleClose"
      @keydown="handleKeydown"
    >
      <!-- Close button -->
      <a-button
        type="text"
        class="viewer-close-btn"
        @click="handleClose"
      >
        <CloseOutlined />
      </a-button>

      <!-- Navigation: Previous -->
      <a-button
        v-if="photos.length > 1"
        type="text"
        class="viewer-nav-btn viewer-nav-prev"
        :disabled="currentIndex <= 0"
        @click.stop="goToPrevious"
      >
        <LeftOutlined />
      </a-button>

      <!-- Main image area -->
      <div
        class="viewer-content"
        @click.stop
      >
        <div class="viewer-image-container">
          <a-spin
            v-if="imageLoading"
            size="large"
            class="viewer-spinner"
          />
          <img
            v-show="!imageLoading"
            ref="imageRef"
            :src="currentPhoto?.file_path || currentPhoto?.thumbnail_path"
            :alt="currentPhoto?.caption || 'Photo'"
            class="viewer-image"
            @load="onImageLoaded"
            @error="onImageError"
          >
        </div>

        <!-- Photo info bar -->
        <div class="viewer-info-bar">
          <div class="viewer-info-left">
            <span class="viewer-counter">
              {{ currentIndex + 1 }} / {{ photos.length }}
            </span>
            <span
              v-if="currentPhoto?.caption"
              class="viewer-caption"
            >
              {{ currentPhoto.caption }}
            </span>
          </div>
          <div class="viewer-info-right">
            <a-space>
              <a-tooltip title="Photo Details">
                <a-button
                  type="text"
                  size="small"
                  class="viewer-action-btn"
                  @click="showDetails = !showDetails"
                >
                  <InfoCircleOutlined />
                </a-button>
              </a-tooltip>
              <a-tooltip title="Download">
                <a-button
                  type="text"
                  size="small"
                  class="viewer-action-btn"
                  @click="handleDownload"
                >
                  <DownloadOutlined />
                </a-button>
              </a-tooltip>
            </a-space>
          </div>
        </div>

        <!-- Photo details panel -->
        <div
          v-if="showDetails"
          class="viewer-details-panel"
        >
          <div
            v-if="currentPhoto?.width && currentPhoto?.height"
            class="detail-item"
          >
            <span class="detail-label">Dimensions:</span>
            <span>{{ currentPhoto.width }} x {{ currentPhoto.height }}</span>
          </div>
          <div
            v-if="currentPhoto?.file_size"
            class="detail-item"
          >
            <span class="detail-label">Size:</span>
            <span>{{ formatFileSize(currentPhoto.file_size) }}</span>
          </div>
          <div
            v-if="currentPhoto?.mime_type"
            class="detail-item"
          >
            <span class="detail-label">Type:</span>
            <span>{{ currentPhoto.mime_type }}</span>
          </div>
          <div
            v-if="currentPhoto?.uploader_did"
            class="detail-item"
          >
            <span class="detail-label">Uploaded by:</span>
            <span>{{ shortenDid(currentPhoto.uploader_did) }}</span>
          </div>
          <div
            v-if="currentPhoto?.created_at"
            class="detail-item"
          >
            <span class="detail-label">Date:</span>
            <span>{{ formatDate(currentPhoto.created_at) }}</span>
          </div>
          <div
            v-if="currentPhoto?.is_encrypted"
            class="detail-item"
          >
            <span class="detail-label">Encrypted:</span>
            <a-tag
              color="green"
              size="small"
            >
              Yes
            </a-tag>
          </div>
        </div>
      </div>

      <!-- Navigation: Next -->
      <a-button
        v-if="photos.length > 1"
        type="text"
        class="viewer-nav-btn viewer-nav-next"
        :disabled="currentIndex >= photos.length - 1"
        @click.stop="goToNext"
      >
        <RightOutlined />
      </a-button>

      <!-- Thumbnail strip -->
      <div
        v-if="photos.length > 1"
        class="viewer-thumbnail-strip"
        @click.stop
      >
        <div
          v-for="(photo, index) in photos"
          :key="photo.id"
          class="thumbnail-item"
          :class="{ active: index === currentIndex }"
          @click="goToIndex(index)"
        >
          <img
            :src="photo.thumbnail_path || photo.file_path"
            :alt="photo.caption || `Photo ${index + 1}`"
          >
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import {
  CloseOutlined,
  LeftOutlined,
  RightOutlined,
  DownloadOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons-vue';
import { message as antMessage } from 'ant-design-vue';
import { logger } from '@/utils/logger';

// Props
const props = defineProps({
  /**
   * Array of photo objects
   */
  photos: {
    type: Array,
    required: true,
    default: () => [],
  },
  /**
   * Initial photo index to display
   */
  initialIndex: {
    type: Number,
    default: 0,
  },
});

// Emits
const emit = defineEmits(['close']);

// State
const currentIndex = ref(props.initialIndex);
const imageLoading = ref(true);
const showDetails = ref(false);
const imageRef = ref(null);

// Computed
const currentPhoto = computed(() => {
  if (props.photos.length === 0) {
    return null;
  }
  return props.photos[currentIndex.value] || null;
});

// Navigation
const goToPrevious = () => {
  if (currentIndex.value > 0) {
    currentIndex.value--;
    imageLoading.value = true;
  }
};

const goToNext = () => {
  if (currentIndex.value < props.photos.length - 1) {
    currentIndex.value++;
    imageLoading.value = true;
  }
};

const goToIndex = (index) => {
  if (index >= 0 && index < props.photos.length && index !== currentIndex.value) {
    currentIndex.value = index;
    imageLoading.value = true;
  }
};

// Image events
const onImageLoaded = () => {
  imageLoading.value = false;
};

const onImageError = () => {
  imageLoading.value = false;
  logger.warn('[PhotoViewer] Failed to load image at index:', currentIndex.value);
};

// Keyboard navigation
const handleKeydown = (event) => {
  switch (event.key) {
    case 'ArrowLeft':
      event.preventDefault();
      goToPrevious();
      break;
    case 'ArrowRight':
      event.preventDefault();
      goToNext();
      break;
    case 'Escape':
      event.preventDefault();
      handleClose();
      break;
    case 'Home':
      event.preventDefault();
      goToIndex(0);
      break;
    case 'End':
      event.preventDefault();
      goToIndex(props.photos.length - 1);
      break;
  }
};

// Close viewer
const handleClose = () => {
  emit('close');
};

// Download
const handleDownload = async () => {
  const photo = currentPhoto.value;
  if (!photo || !photo.file_path) {
    antMessage.warning('Photo file not available for download');
    return;
  }

  try {
    // Use Electron's save dialog if available
    const ipcRenderer = (window).electron?.ipcRenderer;
    if (ipcRenderer) {
      const { dialog } = require('@electron/remote') || {};
      // Fallback: create a download link
      const link = document.createElement('a');
      link.href = photo.file_path;
      link.download = photo.caption || `photo_${photo.id}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else {
      // Browser fallback
      const link = document.createElement('a');
      link.href = photo.file_path;
      link.download = photo.caption || `photo_${photo.id}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }

    antMessage.success('Download started');
  } catch (error) {
    logger.error('[PhotoViewer] Download failed:', error);
    antMessage.error('Download failed');
  }
};

// Utility functions
const formatFileSize = (bytes) => {
  if (!bytes || bytes === 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  let index = 0;
  let size = bytes;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index++;
  }
  return `${size.toFixed(1)} ${units[index]}`;
};

const formatDate = (timestamp) => {
  if (!timestamp) {
    return '';
  }
  return new Date(timestamp).toLocaleString();
};

const shortenDid = (did) => {
  if (!did) {
    return '';
  }
  return `${did.slice(0, 8)}...${did.slice(-6)}`;
};

// Global keyboard listener
const onGlobalKeydown = (event) => {
  handleKeydown(event);
};

// Lifecycle
onMounted(() => {
  document.addEventListener('keydown', onGlobalKeydown);
  // Prevent body scroll when viewer is open
  document.body.style.overflow = 'hidden';
});

onUnmounted(() => {
  document.removeEventListener('keydown', onGlobalKeydown);
  document.body.style.overflow = '';
});

// Watch for initialIndex changes
watch(
  () => props.initialIndex,
  (newVal) => {
    currentIndex.value = newVal;
    imageLoading.value = true;
  },
);
</script>

<style scoped lang="scss">
.photo-viewer-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 10000;
  background: rgba(0, 0, 0, 0.92);
  display: flex;
  align-items: center;
  justify-content: center;
}

// Close button
.viewer-close-btn {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 10001;
  color: white !important;
  font-size: 20px;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s;

  &:hover {
    background: rgba(255, 255, 255, 0.15);
  }
}

// Navigation buttons
.viewer-nav-btn {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  z-index: 10001;
  color: white !important;
  font-size: 24px;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s;

  &:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.15);
  }

  &:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
}

.viewer-nav-prev {
  left: 16px;
}

.viewer-nav-next {
  right: 16px;
}

// Main content area
.viewer-content {
  max-width: calc(100vw - 160px);
  max-height: calc(100vh - 120px);
  display: flex;
  flex-direction: column;
  align-items: center;
}

.viewer-image-container {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  max-height: calc(100vh - 200px);
}

.viewer-spinner {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);

  :deep(.ant-spin-dot-item) {
    background-color: white;
  }
}

.viewer-image {
  max-width: calc(100vw - 160px);
  max-height: calc(100vh - 200px);
  object-fit: contain;
  user-select: none;
  -webkit-user-drag: none;
}

// Info bar
.viewer-info-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  padding: 12px 0;
  color: rgba(255, 255, 255, 0.85);
}

.viewer-info-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.viewer-counter {
  font-size: 14px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.65);
}

.viewer-caption {
  font-size: 14px;
  max-width: 400px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.viewer-action-btn {
  color: rgba(255, 255, 255, 0.85) !important;

  &:hover {
    color: white !important;
    background: rgba(255, 255, 255, 0.1);
  }
}

// Details panel
.viewer-details-panel {
  width: 100%;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  padding: 12px 16px;
  margin-top: 4px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px 24px;
}

.detail-item {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.65);
}

.detail-label {
  font-weight: 500;
  color: rgba(255, 255, 255, 0.45);
  margin-right: 6px;
}

// Thumbnail strip
.viewer-thumbnail-strip {
  position: absolute;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 6px;
  padding: 8px 12px;
  background: rgba(0, 0, 0, 0.6);
  border-radius: 8px;
  max-width: calc(100vw - 80px);
  overflow-x: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.3) transparent;
}

.thumbnail-item {
  width: 48px;
  height: 48px;
  border-radius: 4px;
  overflow: hidden;
  cursor: pointer;
  flex-shrink: 0;
  border: 2px solid transparent;
  transition: border-color 0.2s, opacity 0.2s;
  opacity: 0.6;

  &:hover {
    opacity: 0.9;
  }

  &.active {
    border-color: white;
    opacity: 1;
  }

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
}
</style>
