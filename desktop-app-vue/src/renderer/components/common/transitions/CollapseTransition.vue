<template>
  <transition
    name="collapse"
    @before-enter="beforeEnter"
    @enter="enter"
    @after-enter="afterEnter"
    @before-leave="beforeLeave"
    @leave="leave"
    @after-leave="afterLeave"
  >
    <slot />
  </transition>
</template>

<script setup>
const props = defineProps({
  // Transition duration (ms)
  duration: {
    type: Number,
    default: 300
  },

  // Easing function
  easing: {
    type: String,
    default: 'cubic-bezier(0.4, 0, 0.2, 1)'
  },

  // Horizontal collapse instead of vertical
  horizontal: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['opened', 'closed'])

// Enter transition hooks
const beforeEnter = (el) => {
  el.style.transition = 'none'
  el.style.overflow = 'hidden'

  if (props.horizontal) {
    el.style.width = '0'
  } else {
    el.style.height = '0'
  }
}

const enter = (el, done) => {
  // Force reflow
  el.offsetHeight

  el.style.transition = `all ${props.duration}ms ${props.easing}`

  if (props.horizontal) {
    el.style.width = el.scrollWidth + 'px'
  } else {
    el.style.height = el.scrollHeight + 'px'
  }

  const transitionEnd = () => {
    el.removeEventListener('transitionend', transitionEnd)
    done()
  }

  el.addEventListener('transitionend', transitionEnd)
}

const afterEnter = (el) => {
  el.style.transition = ''
  el.style.overflow = ''

  if (props.horizontal) {
    el.style.width = ''
  } else {
    el.style.height = ''
  }

  emit('opened')
}

// Leave transition hooks
const beforeLeave = (el) => {
  el.style.overflow = 'hidden'

  if (props.horizontal) {
    el.style.width = el.scrollWidth + 'px'
  } else {
    el.style.height = el.scrollHeight + 'px'
  }

  // Force reflow
  el.offsetHeight
}

const leave = (el, done) => {
  el.style.transition = `all ${props.duration}ms ${props.easing}`

  if (props.horizontal) {
    el.style.width = '0'
  } else {
    el.style.height = '0'
  }

  const transitionEnd = () => {
    el.removeEventListener('transitionend', transitionEnd)
    done()
  }

  el.addEventListener('transitionend', transitionEnd)
}

const afterLeave = (el) => {
  el.style.transition = ''
  el.style.overflow = ''

  if (props.horizontal) {
    el.style.width = ''
  } else {
    el.style.height = ''
  }

  emit('closed')
}
</script>

<style scoped>
/* Reduced motion support */
@media (prefers-reduced-motion: reduce) {
  .collapse-enter-active,
  .collapse-leave-active {
    transition-duration: 0.01ms !important;
  }
}
</style>
