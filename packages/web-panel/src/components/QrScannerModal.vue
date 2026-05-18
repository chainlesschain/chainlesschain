<template>
  <a-modal
    :open="open"
    title="扫描移动端配对码"
    :width="520"
    :footer="null"
    :mask-closable="false"
    @cancel="onCancel"
  >
    <div class="scanner-wrap">
      <div v-if="error" style="margin-bottom: 12px;">
        <a-alert type="error" :message="error" show-icon />
      </div>

      <div class="video-frame">
        <video ref="videoRef" autoplay playsinline muted />
        <canvas ref="canvasRef" style="display: none;" />
        <div v-if="!error" class="overlay">
          <div class="hint">{{ scanningHint }}</div>
        </div>
      </div>

      <div style="margin-top: 12px; font-size: 12px; color: var(--text-muted);">
        在 Android 上 设置 → 配对桌面 显示 QR 码，将其对准摄像头。5 分钟内有效。
      </div>

      <div v-if="cameras.length > 1" style="margin-top: 12px;">
        <a-select
          :value="selectedCameraId"
          style="width: 100%;"
          @change="onCameraChange"
        >
          <a-select-option v-for="cam in cameras" :key="cam.deviceId" :value="cam.deviceId">
            {{ cam.label || `Camera ${cam.deviceId.slice(0, 8)}` }}
          </a-select-option>
        </a-select>
      </div>

      <div style="margin-top: 16px; display: flex; gap: 8px; justify-content: flex-end;">
        <a-button @click="onCancel">取消</a-button>
      </div>
    </div>
  </a-modal>
</template>

<script setup>
import { ref, watch, onUnmounted } from 'vue'
import jsQR from 'jsqr'

const props = defineProps({
  open: { type: Boolean, default: false },
})
const emit = defineEmits(['scanned', 'cancel'])

const videoRef = ref(null)
const canvasRef = ref(null)
const error = ref('')
const scanningHint = ref('正在启动摄像头…')
const cameras = ref([])
const selectedCameraId = ref('')

let stream = null
let rafId = null
let stopped = false

watch(
  () => props.open,
  async (isOpen) => {
    if (isOpen) {
      await startScanner()
    } else {
      cleanup()
    }
  },
)

onUnmounted(() => {
  cleanup()
})

async function startScanner() {
  error.value = ''
  scanningHint.value = '正在启动摄像头…'
  stopped = false
  try {
    // 优先用后置摄像头（facingMode: environment）— 桌面通常没有但 fallback 任意可用
    const constraints = selectedCameraId.value
      ? { video: { deviceId: { exact: selectedCameraId.value } } }
      : { video: { facingMode: 'environment' } }
    stream = await navigator.mediaDevices.getUserMedia(constraints)
    if (stopped) {
      // race: cancel during getUserMedia
      stream.getTracks().forEach((t) => t.stop())
      return
    }
    if (videoRef.value) {
      videoRef.value.srcObject = stream
      await videoRef.value.play()
    }
    scanningHint.value = '请将 QR 对准摄像头…'
    await enumerateCameras()
    scanLoop()
  } catch (err) {
    error.value = `摄像头无法访问: ${err.message}。请检查浏览器权限。`
  }
}

async function enumerateCameras() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    cameras.value = devices.filter((d) => d.kind === 'videoinput')
    if (!selectedCameraId.value && cameras.value.length > 0) {
      // Try to pick the current active track's deviceId
      const track = stream?.getVideoTracks?.()[0]
      const trackSettings = track?.getSettings?.() || {}
      selectedCameraId.value = trackSettings.deviceId || cameras.value[0].deviceId
    }
  } catch {
    // enumerateDevices may need camera permission; quietly skip
  }
}

async function onCameraChange(deviceId) {
  selectedCameraId.value = deviceId
  cleanup()
  await startScanner()
}

function scanLoop() {
  if (stopped) return
  const video = videoRef.value
  const canvas = canvasRef.value
  if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
    rafId = requestAnimationFrame(scanLoop)
    return
  }
  // Draw video frame to offscreen canvas; jsQR works on ImageData
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)

  const code = jsQR(imageData.data, imageData.width, imageData.height, {
    inversionAttempts: 'dontInvert',
  })

  if (code && code.data) {
    // 找到 QR — 立即停扫，提交给父组件
    scanningHint.value = '已识别 QR'
    stopped = true
    cleanup()
    emit('scanned', code.data)
    return
  }

  rafId = requestAnimationFrame(scanLoop)
}

function cleanup() {
  stopped = true
  if (rafId) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
  if (stream) {
    stream.getTracks().forEach((t) => t.stop())
    stream = null
  }
  if (videoRef.value) {
    try {
      videoRef.value.srcObject = null
    } catch {
      // ignore
    }
  }
}

function onCancel() {
  cleanup()
  emit('cancel')
}
</script>

<style scoped>
.scanner-wrap {
  display: flex;
  flex-direction: column;
}

.video-frame {
  position: relative;
  width: 100%;
  aspect-ratio: 4 / 3;
  background: #000;
  border-radius: 8px;
  overflow: hidden;
}

.video-frame video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  pointer-events: none;
}

.overlay .hint {
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  padding: 6px 12px;
  border-radius: 4px;
  font-size: 12px;
  margin-bottom: 16px;
}
</style>
