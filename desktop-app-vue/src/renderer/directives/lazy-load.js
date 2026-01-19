/**
 * Vue 3 Lazy Load Directive
 * 图片懒加载指令，基于 Intersection Observer
 *
 * Usage:
 * <img v-lazy="imageUrl" alt="Description" />
 * <img v-lazy="{ src: imageUrl, lowRes: thumbnailUrl, priority: 'high' }" />
 * <div v-lazy:background="imageUrl" />
 */

import { logger, createLogger } from '@/utils/logger';
import { getLazyLoader } from '@/utils/image-lazy-loader'

/**
 * Create lazy load directive
 */
export function createLazyLoadDirective(options = {}) {
  const lazyLoader = getLazyLoader(options)

  return {
    // Directive mounted
    mounted(el, binding) {
      // Handle different element types
      if (el.tagName === 'IMG') {
        handleImageElement(el, binding, lazyLoader)
      } else {
        handleBackgroundImage(el, binding, lazyLoader)
      }
    },

    // Directive updated
    updated(el, binding) {
      // If src changed, reload
      if (binding.value !== binding.oldValue) {
        lazyLoader.unobserve(el)

        if (el.tagName === 'IMG') {
          handleImageElement(el, binding, lazyLoader)
        } else {
          handleBackgroundImage(el, binding, lazyLoader)
        }
      }
    },

    // Directive unmounted
    unmounted(el, binding) {
      const lazyLoader = getLazyLoader()
      lazyLoader.unobserve(el)
    }
  }
}

/**
 * Handle <img> element
 */
function handleImageElement(img, binding, lazyLoader) {
  const value = binding.value

  // Parse binding value
  let src, lowResSrc, priority

  if (typeof value === 'string') {
    src = value
  } else if (typeof value === 'object') {
    src = value.src
    lowResSrc = value.lowRes || value.thumbnail
    priority = value.priority || 'normal'
  }

  if (!src) {
    logger.warn('[v-lazy] No image src provided')
    return
  }

  // Set data attributes
  img.dataset.src = src
  if (lowResSrc) {
    img.dataset.lowResSrc = lowResSrc
  }

  // Observe with lazy loader
  lazyLoader.observe(img, { priority, lowResSrc })

  // Add loading class
  img.classList.add('lazy-image')
}

/**
 * Handle background image
 */
function handleBackgroundImage(el, binding, lazyLoader) {
  const value = binding.value

  // Parse binding value
  let src, priority

  if (typeof value === 'string') {
    src = value
  } else if (typeof value === 'object') {
    src = value.src
    priority = value.priority || 'normal'
  }

  if (!src) {
    logger.warn('[v-lazy:background] No image src provided')
    return
  }

  // Create temporary img element for observation
  const tempImg = document.createElement('img')
  tempImg.dataset.src = src
  tempImg.style.display = 'none'

  // When image loads, apply to background
  tempImg.addEventListener('lazyloaded', () => {
    el.style.backgroundImage = `url(${src})`
    el.classList.add('lazy-bg-loaded')
    tempImg.remove()
  })

  tempImg.addEventListener('lazyloaderror', () => {
    el.classList.add('lazy-bg-error')
    tempImg.remove()
  })

  // Append and observe
  el.appendChild(tempImg)
  lazyLoader.observe(tempImg, { priority })

  el.classList.add('lazy-background')
}

// Default export
export default createLazyLoadDirective()
