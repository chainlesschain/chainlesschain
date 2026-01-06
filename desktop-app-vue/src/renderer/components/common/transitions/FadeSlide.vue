<template>
  <transition
    :name="transitionName"
    :mode="mode"
    :appear="appear"
    @before-enter="handleBeforeEnter"
    @enter="handleEnter"
    @after-enter="handleAfterEnter"
    @before-leave="handleBeforeLeave"
    @leave="handleLeave"
    @after-leave="handleAfterLeave"
  >
    <slot />
  </transition>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  // Transition direction ('left', 'right', 'up', 'down')
  direction: {
    type: String,
    default: 'right',
    validator: (value) => ['left', 'right', 'up', 'down'].includes(value)
  },

  // Transition mode ('in-out', 'out-in', 'default')
  mode: {
    type: String,
    default: 'out-in'
  },

  // Distance to slide (px)
  distance: {
    type: Number,
    default: 20
  },

  // Duration (ms)
  duration: {
    type: Number,
    default: 300
  },

  // Easing function
  easing: {
    type: String,
    default: 'cubic-bezier(0.4, 0, 0.2, 1)'
  },

  // Apply transition on initial render
  appear: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits([
  'before-enter',
  'enter',
  'after-enter',
  'before-leave',
  'leave',
  'after-leave'
])

const transitionName = computed(() => `fade-slide-${props.direction}`)

// Transition hooks
const handleBeforeEnter = (el) => {
  emit('before-enter', el)
}

const handleEnter = (el, done) => {
  emit('enter', el, done)
  // Use setTimeout to ensure CSS transition triggers
  setTimeout(done, props.duration)
}

const handleAfterEnter = (el) => {
  emit('after-enter', el)
}

const handleBeforeLeave = (el) => {
  emit('before-leave', el)
}

const handleLeave = (el, done) => {
  emit('leave', el, done)
  setTimeout(done, props.duration)
}

const handleAfterLeave = (el) => {
  emit('after-leave', el)
}
</script>

<style scoped>
/* Fade Slide Right */
.fade-slide-right-enter-active,
.fade-slide-right-leave-active {
  transition: all v-bind(duration + 'ms') v-bind(easing);
}

.fade-slide-right-enter-from {
  opacity: 0;
  transform: translateX(calc(-1 * v-bind(distance + 'px')));
}

.fade-slide-right-leave-to {
  opacity: 0;
  transform: translateX(v-bind(distance + 'px'));
}

/* Fade Slide Left */
.fade-slide-left-enter-active,
.fade-slide-left-leave-active {
  transition: all v-bind(duration + 'ms') v-bind(easing);
}

.fade-slide-left-enter-from {
  opacity: 0;
  transform: translateX(v-bind(distance + 'px'));
}

.fade-slide-left-leave-to {
  opacity: 0;
  transform: translateX(calc(-1 * v-bind(distance + 'px')));
}

/* Fade Slide Up */
.fade-slide-up-enter-active,
.fade-slide-up-leave-active {
  transition: all v-bind(duration + 'ms') v-bind(easing);
}

.fade-slide-up-enter-from {
  opacity: 0;
  transform: translateY(v-bind(distance + 'px'));
}

.fade-slide-up-leave-to {
  opacity: 0;
  transform: translateY(calc(-1 * v-bind(distance + 'px')));
}

/* Fade Slide Down */
.fade-slide-down-enter-active,
.fade-slide-down-leave-active {
  transition: all v-bind(duration + 'ms') v-bind(easing);
}

.fade-slide-down-enter-from {
  opacity: 0;
  transform: translateY(calc(-1 * v-bind(distance + 'px')));
}

.fade-slide-down-leave-to {
  opacity: 0;
  transform: translateY(v-bind(distance + 'px'));
}

/* Respect reduced motion preference */
@media (prefers-reduced-motion: reduce) {
  .fade-slide-right-enter-active,
  .fade-slide-right-leave-active,
  .fade-slide-left-enter-active,
  .fade-slide-left-leave-active,
  .fade-slide-up-enter-active,
  .fade-slide-up-leave-active,
  .fade-slide-down-enter-active,
  .fade-slide-down-leave-active {
    transition-duration: 0.01ms !important;
  }

  .fade-slide-right-enter-from,
  .fade-slide-right-leave-to,
  .fade-slide-left-enter-from,
  .fade-slide-left-leave-to,
  .fade-slide-up-enter-from,
  .fade-slide-up-leave-to,
  .fade-slide-down-enter-from,
  .fade-slide-down-leave-to {
    transform: none;
  }
}
</style>
