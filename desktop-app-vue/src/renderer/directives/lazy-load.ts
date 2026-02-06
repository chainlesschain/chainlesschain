/**
 * Vue 3 Lazy Load Directive
 * 图片懒加载指令，基于 Intersection Observer
 *
 * Usage:
 * <img v-lazy="imageUrl" alt="Description" />
 * <img v-lazy="{ src: imageUrl, lowRes: thumbnailUrl, priority: 'high' }" />
 * <div v-lazy:background="imageUrl" />
 */

import type { Directive, DirectiveBinding } from 'vue';
import { logger } from '@/utils/logger';
import { getLazyLoader } from '@/utils/image-lazy-loader';

export interface LazyLoadOptions {
  root?: Element | null;
  rootMargin?: string;
  threshold?: number | number[];
}

export interface LazyLoadValue {
  src: string;
  lowRes?: string;
  thumbnail?: string;
  priority?: 'high' | 'normal' | 'low';
}

export type LazyLoadBindingValue = string | LazyLoadValue;

interface LazyLoader {
  observe: (el: HTMLElement, options?: { priority?: string; lowResSrc?: string }) => void;
  unobserve: (el: HTMLElement) => void;
}

/**
 * Create lazy load directive
 */
export function createLazyLoadDirective(options: LazyLoadOptions = {}): Directive<HTMLElement, LazyLoadBindingValue> {
  const lazyLoader = getLazyLoader(options) as LazyLoader;

  return {
    // Directive mounted
    mounted(el: HTMLElement, binding: DirectiveBinding<LazyLoadBindingValue>) {
      // Handle different element types
      if (el.tagName === 'IMG') {
        handleImageElement(el as HTMLImageElement, binding, lazyLoader);
      } else {
        handleBackgroundImage(el, binding, lazyLoader);
      }
    },

    // Directive updated
    updated(el: HTMLElement, binding: DirectiveBinding<LazyLoadBindingValue>) {
      // If src changed, reload
      if (binding.value !== binding.oldValue) {
        lazyLoader.unobserve(el);

        if (el.tagName === 'IMG') {
          handleImageElement(el as HTMLImageElement, binding, lazyLoader);
        } else {
          handleBackgroundImage(el, binding, lazyLoader);
        }
      }
    },

    // Directive unmounted
    unmounted(el: HTMLElement) {
      const loader = getLazyLoader() as LazyLoader;
      loader.unobserve(el);
    },
  };
}

/**
 * Handle <img> element
 */
function handleImageElement(
  img: HTMLImageElement,
  binding: DirectiveBinding<LazyLoadBindingValue>,
  lazyLoader: LazyLoader
): void {
  const value = binding.value;

  // Parse binding value
  let src: string | undefined;
  let lowResSrc: string | undefined;
  let priority: string = 'normal';

  if (typeof value === 'string') {
    src = value;
  } else if (typeof value === 'object' && value !== null) {
    src = value.src;
    lowResSrc = value.lowRes || value.thumbnail;
    priority = value.priority || 'normal';
  }

  if (!src) {
    logger.warn('[v-lazy] No image src provided');
    return;
  }

  // Set data attributes
  img.dataset.src = src;
  if (lowResSrc) {
    img.dataset.lowResSrc = lowResSrc;
  }

  // Observe with lazy loader
  lazyLoader.observe(img, { priority, lowResSrc });

  // Add loading class
  img.classList.add('lazy-image');
}

/**
 * Handle background image
 */
function handleBackgroundImage(
  el: HTMLElement,
  binding: DirectiveBinding<LazyLoadBindingValue>,
  lazyLoader: LazyLoader
): void {
  const value = binding.value;

  // Parse binding value
  let src: string | undefined;
  let priority: string = 'normal';

  if (typeof value === 'string') {
    src = value;
  } else if (typeof value === 'object' && value !== null) {
    src = value.src;
    priority = value.priority || 'normal';
  }

  if (!src) {
    logger.warn('[v-lazy:background] No image src provided');
    return;
  }

  // Create temporary img element for observation
  const tempImg = document.createElement('img');
  tempImg.dataset.src = src;
  tempImg.style.display = 'none';

  // When image loads, apply to background
  const loadedSrc = src; // Capture in closure
  tempImg.addEventListener('lazyloaded', () => {
    el.style.backgroundImage = `url(${loadedSrc})`;
    el.classList.add('lazy-bg-loaded');
    tempImg.remove();
  });

  tempImg.addEventListener('lazyloaderror', () => {
    el.classList.add('lazy-bg-error');
    tempImg.remove();
  });

  // Append and observe
  el.appendChild(tempImg);
  lazyLoader.observe(tempImg, { priority });

  el.classList.add('lazy-background');
}

// Default export
export default createLazyLoadDirective();
