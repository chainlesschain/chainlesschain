import { logger } from '@/utils/logger';

/**
 * Animation Controller
 * Provides smooth 60 FPS animations and transition effects
 *
 * Features:
 * - requestAnimationFrame-based animations
 * - Easing functions collection
 * - Spring physics animations
 * - Performance monitoring
 * - Animation queue management
 * - Reduced motion support (a11y)
 */

// ==================== Type Definitions ====================

/**
 * Easing function type
 */
export type EasingFunction = (t: number, ...args: number[]) => number;

/**
 * Easing function name (built-in)
 */
export type EasingName =
  | 'linear'
  | 'easeInQuad'
  | 'easeOutQuad'
  | 'easeInOutQuad'
  | 'easeInCubic'
  | 'easeOutCubic'
  | 'easeInOutCubic'
  | 'easeInQuart'
  | 'easeOutQuart'
  | 'easeInOutQuart'
  | 'easeInQuint'
  | 'easeOutQuint'
  | 'easeInOutQuint'
  | 'easeInSine'
  | 'easeOutSine'
  | 'easeInOutSine'
  | 'easeInExpo'
  | 'easeOutExpo'
  | 'easeInOutExpo'
  | 'easeInCirc'
  | 'easeOutCirc'
  | 'easeInOutCirc'
  | 'easeOutElastic'
  | 'easeOutBounce'
  | 'spring';

/**
 * Easing parameter (name or function)
 */
export type EasingParam = EasingName | EasingFunction;

/**
 * Animation controller options
 */
export interface AnimationControllerOptions {
  defaultDuration?: number;
  defaultEasing?: EasingName;
  respectReducedMotion?: boolean;
  debug?: boolean;
}

/**
 * Animation configuration
 */
export interface AnimateConfig {
  from: number;
  to: number;
  duration?: number;
  easing?: EasingParam;
  onUpdate?: (value: number, progress?: number) => void;
  onComplete?: (value: number) => void;
}

/**
 * Spring animation configuration
 */
export interface SpringConfig {
  from: number;
  to: number;
  tension?: number;
  friction?: number;
  onUpdate?: (value: number, progress?: number) => void;
  onComplete?: (value: number) => void;
}

/**
 * Property animation target
 */
export interface PropertyAnimationTarget {
  [property: string]: number;
}

/**
 * Animation data stored internally
 */
export interface AnimationData {
  id: string;
  from: number;
  to: number;
  duration: number;
  easing: EasingFunction;
  onUpdate?: (value: number, progress?: number) => void;
  onComplete?: (value: number) => void;
  startTime: number | null;
  currentValue: number;
  resolve: (value: number) => void;
}

/**
 * Animation statistics
 */
export interface AnimationStats {
  totalAnimations: number;
  activeAnimations: number;
  droppedFrames: number;
  averageFPS: number;
}

/**
 * Extended animation statistics
 */
export interface ExtendedAnimationStats extends AnimationStats {
  reducedMotion: boolean;
}

/**
 * Easing functions collection type
 */
export interface EasingFunctions {
  linear: EasingFunction;
  easeInQuad: EasingFunction;
  easeOutQuad: EasingFunction;
  easeInOutQuad: EasingFunction;
  easeInCubic: EasingFunction;
  easeOutCubic: EasingFunction;
  easeInOutCubic: EasingFunction;
  easeInQuart: EasingFunction;
  easeOutQuart: EasingFunction;
  easeInOutQuart: EasingFunction;
  easeInQuint: EasingFunction;
  easeOutQuint: EasingFunction;
  easeInOutQuint: EasingFunction;
  easeInSine: EasingFunction;
  easeOutSine: EasingFunction;
  easeInOutSine: EasingFunction;
  easeInExpo: EasingFunction;
  easeOutExpo: EasingFunction;
  easeInOutExpo: EasingFunction;
  easeInCirc: EasingFunction;
  easeOutCirc: EasingFunction;
  easeInOutCirc: EasingFunction;
  easeOutElastic: EasingFunction;
  easeOutBounce: EasingFunction;
  spring: (t: number, tension?: number, friction?: number) => number;
}

// ==================== Implementation ====================

class AnimationController {
  private options: Required<AnimationControllerOptions>;
  private animations: Map<string, AnimationData>;
  private rafId: number | null;
  private lastTime: number;
  private reducedMotion: boolean;
  private stats: AnimationStats;

  /**
   * Easing functions collection
   * @see https://easings.net/
   */
  static easings: EasingFunctions = {
    // Linear
    linear: (t: number): number => t,

    // Quadratic
    easeInQuad: (t: number): number => t * t,
    easeOutQuad: (t: number): number => t * (2 - t),
    easeInOutQuad: (t: number): number => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),

    // Cubic
    easeInCubic: (t: number): number => t * t * t,
    easeOutCubic: (t: number): number => (--t) * t * t + 1,
    easeInOutCubic: (t: number): number =>
      (t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1),

    // Quartic
    easeInQuart: (t: number): number => t * t * t * t,
    easeOutQuart: (t: number): number => 1 - (--t) * t * t * t,
    easeInOutQuart: (t: number): number =>
      (t < 0.5 ? 8 * t * t * t * t : 1 - 8 * (--t) * t * t * t),

    // Quintic
    easeInQuint: (t: number): number => t * t * t * t * t,
    easeOutQuint: (t: number): number => 1 + (--t) * t * t * t * t,
    easeInOutQuint: (t: number): number =>
      (t < 0.5 ? 16 * t * t * t * t * t : 1 + 16 * (--t) * t * t * t * t),

    // Sine
    easeInSine: (t: number): number => 1 - Math.cos((t * Math.PI) / 2),
    easeOutSine: (t: number): number => Math.sin((t * Math.PI) / 2),
    easeInOutSine: (t: number): number => -(Math.cos(Math.PI * t) - 1) / 2,

    // Exponential
    easeInExpo: (t: number): number => (t === 0 ? 0 : Math.pow(2, 10 * t - 10)),
    easeOutExpo: (t: number): number => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
    easeInOutExpo: (t: number): number => {
      if (t === 0) return 0;
      if (t === 1) return 1;
      return t < 0.5
        ? Math.pow(2, 20 * t - 10) / 2
        : (2 - Math.pow(2, -20 * t + 10)) / 2;
    },

    // Circular
    easeInCirc: (t: number): number => 1 - Math.sqrt(1 - Math.pow(t, 2)),
    easeOutCirc: (t: number): number => Math.sqrt(1 - Math.pow(t - 1, 2)),
    easeInOutCirc: (t: number): number => {
      return t < 0.5
        ? (1 - Math.sqrt(1 - Math.pow(2 * t, 2))) / 2
        : (Math.sqrt(1 - Math.pow(-2 * t + 2, 2)) + 1) / 2;
    },

    // Elastic
    easeOutElastic: (t: number): number => {
      const c4 = (2 * Math.PI) / 3;
      return t === 0
        ? 0
        : t === 1
        ? 1
        : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
    },

    // Bounce
    easeOutBounce: (t: number): number => {
      const n1 = 7.5625;
      const d1 = 2.75;

      if (t < 1 / d1) {
        return n1 * t * t;
      } else if (t < 2 / d1) {
        return n1 * (t -= 1.5 / d1) * t + 0.75;
      } else if (t < 2.5 / d1) {
        return n1 * (t -= 2.25 / d1) * t + 0.9375;
      } else {
        return n1 * (t -= 2.625 / d1) * t + 0.984375;
      }
    },

    // Spring (custom)
    spring: (t: number, tension: number = 200, friction: number = 20): number => {
      const omega = Math.sqrt(tension);
      const zeta = friction / (2 * Math.sqrt(tension));
      const envelope = Math.exp(-zeta * omega * t);

      if (zeta < 1) {
        const omegaD = omega * Math.sqrt(1 - zeta * zeta);
        return (
          1 -
          envelope *
            (Math.cos(omegaD * t) +
              (zeta / Math.sqrt(1 - zeta * zeta)) * Math.sin(omegaD * t))
        );
      } else {
        return 1 - envelope * (1 + omega * t);
      }
    },
  };

  constructor(options: AnimationControllerOptions = {}) {
    // Configuration
    this.options = {
      defaultDuration: options.defaultDuration || 300, // ms
      defaultEasing: options.defaultEasing || 'easeOutCubic',
      respectReducedMotion: options.respectReducedMotion !== false,
      debug: options.debug || false,
    };

    // State
    this.animations = new Map();
    this.rafId = null;
    this.lastTime = 0;
    this.reducedMotion = this.checkReducedMotion();

    // Statistics
    this.stats = {
      totalAnimations: 0,
      activeAnimations: 0,
      droppedFrames: 0,
      averageFPS: 60,
    };

    // Start animation loop
    this.startAnimationLoop();

    if (this.options.debug) {
      logger.info('[AnimationController] Initialized');
    }
  }

  /**
   * Animate a value from start to end
   * @returns Promise that resolves when animation completes
   */
  animate(config: AnimateConfig): Promise<number> {
    const {
      from,
      to,
      duration = this.options.defaultDuration,
      easing = this.options.defaultEasing,
      onUpdate,
      onComplete,
    } = config;

    // Respect reduced motion preference
    if (this.reducedMotion && this.options.respectReducedMotion) {
      onUpdate?.(to);
      onComplete?.(to);
      return Promise.resolve(to);
    }

    const animationId = this.generateAnimationId();
    this.stats.totalAnimations++;

    return new Promise((resolve) => {
      const animation: AnimationData = {
        id: animationId,
        from,
        to,
        duration,
        easing:
          typeof easing === 'string'
            ? (AnimationController.easings[easing as EasingName] as EasingFunction)
            : easing,
        onUpdate,
        onComplete,
        startTime: null,
        currentValue: from,
        resolve,
      };

      this.animations.set(animationId, animation);
      this.stats.activeAnimations++;

      if (this.options.debug) {
        logger.info(`[AnimationController] Started animation: ${animationId}`);
      }
    });
  }

  /**
   * Animate multiple properties simultaneously
   */
  animateProperties(
    element: HTMLElement,
    properties: PropertyAnimationTarget,
    options: Omit<AnimateConfig, 'from' | 'to' | 'onUpdate'> = {}
  ): Promise<number[]> {
    const animations = Object.entries(properties).map(([prop, to]) => {
      const from = this.getCurrentValue(element, prop);

      return this.animate({
        from,
        to,
        ...options,
        onUpdate: (value: number) => {
          this.setProperty(element, prop, value);
        },
      });
    });

    return Promise.all(animations);
  }

  /**
   * Spring animation (physics-based)
   */
  spring(config: SpringConfig): Promise<number> {
    const {
      from,
      to,
      tension = 200,
      friction = 20,
      onUpdate,
      onComplete,
    } = config;

    // Calculate duration based on spring parameters
    const duration = this.calculateSpringDuration(tension, friction);

    return this.animate({
      from,
      to,
      duration,
      easing: (t: number) => AnimationController.easings.spring(t, tension, friction),
      onUpdate,
      onComplete,
    });
  }

  /**
   * Animation loop (requestAnimationFrame)
   */
  private startAnimationLoop(): void {
    const loop = (currentTime: number): void => {
      // Calculate delta time
      const deltaTime = currentTime - this.lastTime;
      this.lastTime = currentTime;

      // Update FPS stats
      if (deltaTime > 0) {
        const fps = 1000 / deltaTime;
        this.stats.averageFPS = this.stats.averageFPS * 0.9 + fps * 0.1;

        // Detect dropped frames
        if (fps < 50) {
          this.stats.droppedFrames++;
        }
      }

      // Update all active animations
      this.animations.forEach((animation) => {
        if (!animation.startTime) {
          animation.startTime = currentTime;
        }

        const elapsed = currentTime - animation.startTime;
        const progress = Math.min(elapsed / animation.duration, 1);

        // Apply easing
        const easedProgress = animation.easing(progress);

        // Calculate current value
        const range = animation.to - animation.from;
        const currentValue = animation.from + range * easedProgress;

        animation.currentValue = currentValue;

        // Call update callback
        if (animation.onUpdate) {
          animation.onUpdate(currentValue, progress);
        }

        // Animation complete
        if (progress >= 1) {
          this.completeAnimation(animation);
        }
      });

      // Continue loop
      this.rafId = requestAnimationFrame(loop);
    };

    this.rafId = requestAnimationFrame(loop);
  }

  /**
   * Complete an animation
   */
  private completeAnimation(animation: AnimationData): void {
    if (animation.onComplete) {
      animation.onComplete(animation.to);
    }

    animation.resolve(animation.to);

    this.animations.delete(animation.id);
    this.stats.activeAnimations--;

    if (this.options.debug) {
      logger.info(`[AnimationController] Completed animation: ${animation.id}`);
    }
  }

  /**
   * Cancel an animation
   */
  cancel(animationId: string): void {
    const animation = this.animations.get(animationId);

    if (animation) {
      animation.resolve(animation.currentValue);
      this.animations.delete(animationId);
      this.stats.activeAnimations--;

      if (this.options.debug) {
        logger.info(`[AnimationController] Cancelled animation: ${animationId}`);
      }
    }
  }

  /**
   * Cancel all animations
   */
  cancelAll(): void {
    this.animations.forEach((animation) => {
      animation.resolve(animation.currentValue);
    });

    this.animations.clear();
    this.stats.activeAnimations = 0;

    if (this.options.debug) {
      logger.info('[AnimationController] Cancelled all animations');
    }
  }

  /**
   * Get current CSS property value
   */
  private getCurrentValue(element: HTMLElement, property: string): number {
    const computed = window.getComputedStyle(element);
    const value = computed.getPropertyValue(property);

    // Parse numeric value
    return parseFloat(value) || 0;
  }

  /**
   * Set CSS property value
   */
  private setProperty(element: HTMLElement, property: string, value: number): void {
    // Handle units
    const needsUnit = [
      'width',
      'height',
      'top',
      'left',
      'right',
      'bottom',
      'margin',
      'padding',
    ].some((p) => property.includes(p));

    (element.style as Record<string, string>)[property] = needsUnit ? `${value}px` : String(value);
  }

  /**
   * Calculate spring duration
   */
  private calculateSpringDuration(tension: number, friction: number): number {
    // Approximate duration based on spring parameters
    const omega = Math.sqrt(tension);
    const zeta = friction / (2 * Math.sqrt(tension));

    if (zeta < 1) {
      // Underdamped
      return (4 / (omega * Math.sqrt(1 - zeta * zeta))) * 1000;
    } else {
      // Critically damped or overdamped
      return (4 / omega) * 1000;
    }
  }

  /**
   * Check if user prefers reduced motion
   */
  private checkReducedMotion(): boolean {
    if (typeof window === 'undefined') {
      return false;
    }
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /**
   * Generate unique animation ID
   */
  private generateAnimationId(): string {
    return `anim_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get statistics
   */
  getStats(): ExtendedAnimationStats {
    return {
      ...this.stats,
      averageFPS: Math.round(this.stats.averageFPS),
      reducedMotion: this.reducedMotion,
    };
  }

  /**
   * Update options
   */
  setOptions(options: Partial<AnimationControllerOptions>): void {
    this.options = { ...this.options, ...options } as Required<AnimationControllerOptions>;
  }

  /**
   * Get current options
   */
  getOptions(): Required<AnimationControllerOptions> {
    return { ...this.options };
  }

  /**
   * Check if there are active animations
   */
  hasActiveAnimations(): boolean {
    return this.animations.size > 0;
  }

  /**
   * Get number of active animations
   */
  getActiveAnimationCount(): number {
    return this.animations.size;
  }

  /**
   * Destroy and cleanup
   */
  destroy(): void {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    this.cancelAll();

    if (this.options.debug) {
      logger.info('[AnimationController] Destroyed');
    }
  }
}

// Singleton instance
let controllerInstance: AnimationController | null = null;

/**
 * Get or create animation controller instance
 */
export function getAnimationController(
  options?: AnimationControllerOptions
): AnimationController {
  if (!controllerInstance) {
    controllerInstance = new AnimationController(options);
  }
  return controllerInstance;
}

/**
 * Convenience function: animate a value
 */
export async function animate(config: AnimateConfig): Promise<number> {
  const controller = getAnimationController();
  return controller.animate(config);
}

/**
 * Convenience function: spring animation
 */
export async function spring(config: SpringConfig): Promise<number> {
  const controller = getAnimationController();
  return controller.spring(config);
}

/**
 * Reset singleton instance (useful for testing)
 */
export function resetAnimationController(): void {
  if (controllerInstance) {
    controllerInstance.destroy();
    controllerInstance = null;
  }
}

export { AnimationController };
export default AnimationController;
