<template>
  <transition
    name="scale"
    :mode="mode"
    :appear="appear"
    @enter="handleEnter"
    @leave="handleLeave"
  >
    <slot />
  </transition>
</template>

<script setup>
const props = defineProps({
  // Transform origin ('center', 'top', 'bottom', 'left', 'right')
  origin: {
    type: String,
    default: 'center'
  },

  // Initial scale (0-1)
  initialScale: {
    type: Number,
    default: 0.9
  },

  // Transition mode
  mode: {
    type: String,
    default: 'out-in'
  },

  // Duration (ms)
  duration: {
    type: Number,
    default: 200
  },

  // Easing
  easing: {
    type: String,
    default: 'cubic-bezier(0.4, 0, 0.2, 1)'
  },

  // Appear on mount
  appear: {
    type: Boolean,
    default: false
  }
})

const handleEnter = (el, done) => {
  setTimeout(done, props.duration)
}

const handleLeave = (el, done) => {
  setTimeout(done, props.duration)
}
</script>

<style scoped>
.scale-enter-active,
.scale-leave-active {
  transition: all v-bind(duration + 'ms') v-bind(easing);
  transform-origin: v-bind(origin);
}

.scale-enter-from {
  opacity: 0;
  transform: scale(v-bind(initialScale));
}

.scale-leave-to {
  opacity: 0;
  transform: scale(v-bind(initialScale));
}

/* Reduced motion */
@media (prefers-reduced-motion: reduce) {
  .scale-enter-active,
  .scale-leave-active {
    transition-duration: 0.01ms !important;
  }

  .scale-enter-from,
  .scale-leave-to {
    transform: none;
  }
}
</style>
