/**
 * Animation Controller
 * 动画控制器 - 提供流畅的 60 FPS 动画和过渡效果
 *
 * Features:
 * - requestAnimationFrame-based animations
 * - Easing functions collection
 * - Spring physics animations
 * - Performance monitoring
 * - Animation queue management
 * - Reduced motion support (a11y)
 */

class AnimationController {
  constructor(options = {}) {
    // Configuration
    this.options = {
      defaultDuration: options.defaultDuration || 300, // ms
      defaultEasing: options.defaultEasing || 'easeOutCubic',
      respectReducedMotion: options.respectReducedMotion !== false,
      debug: options.debug || false,
    }

    // State
    this.animations = new Map() // animationId -> animation data
    this.rafId = null
    this.lastTime = 0
    this.reducedMotion = this.checkReducedMotion()

    // Statistics
    this.stats = {
      totalAnimations: 0,
      activeAnimations: 0,
      droppedFrames: 0,
      averageFPS: 60,
    }

    // Start animation loop
    this.startAnimationLoop()

    if (this.options.debug) {
      console.log('[AnimationController] Initialized')
    }
  }

  /**
   * Easing functions
   * See: https://easings.net/
   */
  static easings = {
    // Linear
    linear: t => t,

    // Quadratic
    easeInQuad: t => t * t,
    easeOutQuad: t => t * (2 - t),
    easeInOutQuad: t => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),

    // Cubic
    easeInCubic: t => t * t * t,
    easeOutCubic: t => (--t) * t * t + 1,
    easeInOutCubic: t => (t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1),

    // Quartic
    easeInQuart: t => t * t * t * t,
    easeOutQuart: t => 1 - (--t) * t * t * t,
    easeInOutQuart: t => (t < 0.5 ? 8 * t * t * t * t : 1 - 8 * (--t) * t * t * t),

    // Quintic
    easeInQuint: t => t * t * t * t * t,
    easeOutQuint: t => 1 + (--t) * t * t * t * t,
    easeInOutQuint: t => (t < 0.5 ? 16 * t * t * t * t * t : 1 + 16 * (--t) * t * t * t * t),

    // Sine
    easeInSine: t => 1 - Math.cos((t * Math.PI) / 2),
    easeOutSine: t => Math.sin((t * Math.PI) / 2),
    easeInOutSine: t => -(Math.cos(Math.PI * t) - 1) / 2,

    // Exponential
    easeInExpo: t => (t === 0 ? 0 : Math.pow(2, 10 * t - 10)),
    easeOutExpo: t => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
    easeInOutExpo: t => {
      if (t === 0) return 0
      if (t === 1) return 1
      return t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2
    },

    // Circular
    easeInCirc: t => 1 - Math.sqrt(1 - Math.pow(t, 2)),
    easeOutCirc: t => Math.sqrt(1 - Math.pow(t - 1, 2)),
    easeInOutCirc: t => {
      return t < 0.5
        ? (1 - Math.sqrt(1 - Math.pow(2 * t, 2))) / 2
        : (Math.sqrt(1 - Math.pow(-2 * t + 2, 2)) + 1) / 2
    },

    // Elastic
    easeOutElastic: t => {
      const c4 = (2 * Math.PI) / 3
      return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1
    },

    // Bounce
    easeOutBounce: t => {
      const n1 = 7.5625
      const d1 = 2.75

      if (t < 1 / d1) {
        return n1 * t * t
      } else if (t < 2 / d1) {
        return n1 * (t -= 1.5 / d1) * t + 0.75
      } else if (t < 2.5 / d1) {
        return n1 * (t -= 2.25 / d1) * t + 0.9375
      } else {
        return n1 * (t -= 2.625 / d1) * t + 0.984375
      }
    },

    // Spring (custom)
    spring: (t, tension = 200, friction = 20) => {
      const omega = Math.sqrt(tension)
      const zeta = friction / (2 * Math.sqrt(tension))
      const envelope = Math.exp(-zeta * omega * t)

      if (zeta < 1) {
        const omegaD = omega * Math.sqrt(1 - zeta * zeta)
        return 1 - envelope * (Math.cos(omegaD * t) + (zeta / Math.sqrt(1 - zeta * zeta)) * Math.sin(omegaD * t))
      } else {
        return 1 - envelope * (1 + omega * t)
      }
    },
  }

  /**
   * Animate a value from start to end
   * @param {Object} config - Animation configuration
   * @returns {Promise} Resolves when animation completes
   */
  animate(config) {
    const {
      from,
      to,
      duration = this.options.defaultDuration,
      easing = this.options.defaultEasing,
      onUpdate,
      onComplete,
    } = config

    // Respect reduced motion preference
    if (this.reducedMotion && this.options.respectReducedMotion) {
      onUpdate?.(to)
      onComplete?.(to)
      return Promise.resolve(to)
    }

    const animationId = this.generateAnimationId()
    this.stats.totalAnimations++

    return new Promise((resolve) => {
      const animation = {
        id: animationId,
        from,
        to,
        duration,
        easing: typeof easing === 'string' ? AnimationController.easings[easing] : easing,
        onUpdate,
        onComplete,
        startTime: null,
        currentValue: from,
        resolve,
      }

      this.animations.set(animationId, animation)
      this.stats.activeAnimations++

      if (this.options.debug) {
        console.log(`[AnimationController] Started animation: ${animationId}`)
      }
    })
  }

  /**
   * Animate multiple properties simultaneously
   * @param {Object} element - Target element
   * @param {Object} properties - Properties to animate
   * @param {Object} options - Animation options
   */
  animateProperties(element, properties, options = {}) {
    const animations = Object.entries(properties).map(([prop, to]) => {
      const from = this.getCurrentValue(element, prop)

      return this.animate({
        from,
        to,
        ...options,
        onUpdate: (value) => {
          this.setProperty(element, prop, value)
        },
      })
    })

    return Promise.all(animations)
  }

  /**
   * Spring animation (physics-based)
   * @param {Object} config - Spring configuration
   */
  spring(config) {
    const {
      from,
      to,
      tension = 200,
      friction = 20,
      onUpdate,
      onComplete,
    } = config

    // Calculate duration based on spring parameters
    const duration = this.calculateSpringDuration(tension, friction)

    return this.animate({
      from,
      to,
      duration,
      easing: (t) => AnimationController.easings.spring(t, tension, friction),
      onUpdate,
      onComplete,
    })
  }

  /**
   * Animation loop (requestAnimationFrame)
   */
  startAnimationLoop() {
    const loop = (currentTime) => {
      // Calculate delta time
      const deltaTime = currentTime - this.lastTime
      this.lastTime = currentTime

      // Update FPS stats
      if (deltaTime > 0) {
        const fps = 1000 / deltaTime
        this.stats.averageFPS = (this.stats.averageFPS * 0.9 + fps * 0.1)

        // Detect dropped frames
        if (fps < 50) {
          this.stats.droppedFrames++
        }
      }

      // Update all active animations
      this.animations.forEach((animation) => {
        if (!animation.startTime) {
          animation.startTime = currentTime
        }

        const elapsed = currentTime - animation.startTime
        const progress = Math.min(elapsed / animation.duration, 1)

        // Apply easing
        const easedProgress = animation.easing(progress)

        // Calculate current value
        const range = animation.to - animation.from
        const currentValue = animation.from + range * easedProgress

        animation.currentValue = currentValue

        // Call update callback
        if (animation.onUpdate) {
          animation.onUpdate(currentValue, progress)
        }

        // Animation complete
        if (progress >= 1) {
          this.completeAnimation(animation)
        }
      })

      // Continue loop
      this.rafId = requestAnimationFrame(loop)
    }

    this.rafId = requestAnimationFrame(loop)
  }

  /**
   * Complete an animation
   */
  completeAnimation(animation) {
    if (animation.onComplete) {
      animation.onComplete(animation.to)
    }

    animation.resolve(animation.to)

    this.animations.delete(animation.id)
    this.stats.activeAnimations--

    if (this.options.debug) {
      console.log(`[AnimationController] Completed animation: ${animation.id}`)
    }
  }

  /**
   * Cancel an animation
   */
  cancel(animationId) {
    const animation = this.animations.get(animationId)

    if (animation) {
      animation.resolve(animation.currentValue)
      this.animations.delete(animationId)
      this.stats.activeAnimations--

      if (this.options.debug) {
        console.log(`[AnimationController] Cancelled animation: ${animationId}`)
      }
    }
  }

  /**
   * Cancel all animations
   */
  cancelAll() {
    this.animations.forEach((animation) => {
      animation.resolve(animation.currentValue)
    })

    this.animations.clear()
    this.stats.activeAnimations = 0

    if (this.options.debug) {
      console.log('[AnimationController] Cancelled all animations')
    }
  }

  /**
   * Get current CSS property value
   */
  getCurrentValue(element, property) {
    const computed = window.getComputedStyle(element)
    const value = computed.getPropertyValue(property)

    // Parse numeric value
    return parseFloat(value) || 0
  }

  /**
   * Set CSS property value
   */
  setProperty(element, property, value) {
    // Handle units
    const needsUnit = ['width', 'height', 'top', 'left', 'right', 'bottom', 'margin', 'padding'].some(
      p => property.includes(p)
    )

    element.style[property] = needsUnit ? `${value}px` : value
  }

  /**
   * Calculate spring duration
   */
  calculateSpringDuration(tension, friction) {
    // Approximate duration based on spring parameters
    const omega = Math.sqrt(tension)
    const zeta = friction / (2 * Math.sqrt(tension))

    if (zeta < 1) {
      // Underdamped
      return (4 / (omega * Math.sqrt(1 - zeta * zeta))) * 1000
    } else {
      // Critically damped or overdamped
      return (4 / omega) * 1000
    }
  }

  /**
   * Check if user prefers reduced motion
   */
  checkReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }

  /**
   * Generate unique animation ID
   */
  generateAnimationId() {
    return `anim_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      ...this.stats,
      averageFPS: Math.round(this.stats.averageFPS),
      reducedMotion: this.reducedMotion,
    }
  }

  /**
   * Destroy and cleanup
   */
  destroy() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }

    this.cancelAll()

    if (this.options.debug) {
      console.log('[AnimationController] Destroyed')
    }
  }
}

// Singleton instance
let controllerInstance = null

/**
 * Get or create animation controller instance
 */
export function getAnimationController(options) {
  if (!controllerInstance) {
    controllerInstance = new AnimationController(options)
  }
  return controllerInstance
}

/**
 * Convenience function: animate a value
 */
export async function animate(config) {
  const controller = getAnimationController()
  return controller.animate(config)
}

/**
 * Convenience function: spring animation
 */
export async function spring(config) {
  const controller = getAnimationController()
  return controller.spring(config)
}

export default AnimationController
