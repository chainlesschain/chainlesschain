<template>
  <div
    ref="scrollContainer"
    class="virtual-message-list"
    @scroll="handleScroll"
  >
    <div
      v-if="virtualizer && virtualItems.length > 0"
      :style="{
        height: `${virtualizer.getTotalSize()}px`,
        width: '100%',
        position: 'relative',
      }"
    >
      <div
        v-for="virtualRow in virtualItems"
        :key="virtualRow.key"
        :style="{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          transform: `translateY(${virtualRow.start}px)`,
        }"
      >
        <slot
          :message="messages[virtualRow.index]"
          :index="virtualRow.index"
        />
      </div>
    </div>

    <div
      v-else
      class="fallback-list"
    >
      <div
        v-for="(message, index) in messages"
        :key="message.id || index"
      >
        <slot
          :message="message"
          :index="index"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { Virtualizer } from '@tanstack/virtual-core'

const props = defineProps({
  messages: {
    type: Array,
    required: true,
    default: () => [],
  },
  estimateSize: {
    type: Number,
    default: 120,
  },
})

const emit = defineEmits(['scroll-to-bottom', 'load-more'])

const scrollContainer = ref(null)
const virtualizer = ref(null)
const updateKey = ref(0)

const virtualItems = computed(() => {
  if (!virtualizer.value) return []
  // eslint-disable-next-line no-unused-expressions
  updateKey.value
  return virtualizer.value.getVirtualItems()
})

const initVirtualizer = () => {
  if (!scrollContainer.value) return
  try {
    virtualizer.value = new Virtualizer({
      count: props.messages.length,
      getScrollElement: () => scrollContainer.value,
      estimateSize: () => props.estimateSize,
      overscan: 5,
      scrollMargin: 0,
      onChange: () => { updateKey.value++ },
    })
    nextTick(() => {
      if (virtualizer.value && scrollContainer.value) {
        virtualizer.value.measure()
        updateKey.value++
        scrollContainer.value.scrollTop = 1
        setTimeout(() => {
          if (scrollContainer.value) scrollContainer.value.scrollTop = 0
        }, 50)
      }
    })
  } catch (error) {
    console.error('[VirtualMessageList] init failed:', error)
  }
}

const handleScroll = () => {
  if (!scrollContainer.value) return
  if (virtualizer.value) virtualizer.value.measure()
  const { scrollTop, scrollHeight, clientHeight } = scrollContainer.value
  if (scrollTop < 100) emit('load-more')
  if (scrollTop + clientHeight >= scrollHeight - 50) emit('scroll-to-bottom')
}

const scrollToBottom = () => {
  if (!scrollContainer.value) return
  requestAnimationFrame(() => {
    if (scrollContainer.value) {
      scrollContainer.value.scrollTop = scrollContainer.value.scrollHeight
    }
  })
}

const scrollToMessage = (messageId) => {
  const index = props.messages.findIndex((m) => m.id === messageId)
  if (index !== -1 && virtualizer.value) {
    virtualizer.value.scrollToIndex(index, { align: 'center' })
  }
}

watch(
  () => props.messages.length,
  (newLength, oldLength) => {
    if (virtualizer.value) {
      virtualizer.value.setOptions({
        count: newLength,
        estimateSize: () => props.estimateSize,
      })
      updateKey.value++
      if (newLength > oldLength) {
        nextTick(() => scrollToBottom())
      }
    } else {
      nextTick(() => {
        initVirtualizer()
        if (virtualizer.value) updateKey.value++
      })
    }
  },
)

watch(
  () => props.messages,
  (newMessages) => {
    if (!virtualizer.value && newMessages.length > 0) {
      nextTick(() => initVirtualizer())
    } else if (virtualizer.value) {
      virtualizer.value.setOptions({
        count: newMessages.length,
        estimateSize: () => props.estimateSize,
        getScrollElement: () => scrollContainer.value,
        overscan: 5,
        scrollMargin: 0,
        onChange: () => { updateKey.value++ },
      })
      updateKey.value++
      nextTick(() => {
        if (virtualizer.value) virtualizer.value.measure()
      })
    }
  },
  { deep: true },
)

defineExpose({ scrollToBottom, scrollToMessage })

onMounted(() => {
  nextTick(() => {
    initVirtualizer()
    if (props.messages.length > 0) scrollToBottom()
  })
})

onUnmounted(() => {
  if (virtualizer.value) virtualizer.value = null
})
</script>

<style scoped>
.virtual-message-list {
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
}

.fallback-list {
  width: 100%;
}

.virtual-message-list::-webkit-scrollbar {
  width: 6px;
}

.virtual-message-list::-webkit-scrollbar-track {
  background: transparent;
}

.virtual-message-list::-webkit-scrollbar-thumb {
  background: var(--border-color, #c1c1c1);
  border-radius: 3px;
}

.virtual-message-list::-webkit-scrollbar-thumb:hover {
  background: var(--text-muted, #a8a8a8);
}
</style>
