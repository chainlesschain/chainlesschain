import { logger } from '@/utils/logger';

/**
 * Smart Image Optimization System
 * 智能图片优化系统
 *
 * Features:
 * - WebP format detection and conversion
 * - Responsive image loading
 * - Image compression
 * - Placeholder generation (LQIP - Low Quality Image Placeholder)
 * - Progressive loading
 * - CDN support
 * - Network-aware loading
 */

/**
 * Supported image formats
 */
export type ImageFormat = 'webp' | 'avif' | 'jpeg' | 'jpeg2000' | 'png';

/**
 * Image loading priority
 */
export type LoadPriority = 'high' | 'normal' | 'low';

/**
 * Format support status
 */
export interface FormatSupport {
  webp: boolean | null;
  avif: boolean | null;
  jpeg2000: boolean | null;
}

/**
 * Options for SmartImageLoader
 */
export interface SmartImageLoaderOptions {
  /** CDN base URL */
  cdnBase?: string;
  /** Enable responsive images (default: true) */
  responsive?: boolean;
  /** Enable WebP conversion (default: true) */
  webp?: boolean;
  /** Network-aware loading (default: true) */
  networkAware?: boolean;
  /** Image quality (1-100, default: 80) */
  quality?: number;
  /** Enable blur placeholder (default: true) */
  placeholder?: boolean;
  /** Debug mode (default: false) */
  debug?: boolean;
}

/**
 * Options for loading an image
 */
export interface ImageLoadOptions {
  /** Target width */
  width?: number | null;
  /** Target height */
  height?: number | null;
  /** Quality (1-100) */
  quality?: number;
  /** Enable placeholder */
  placeholder?: boolean;
  /** Loading priority */
  priority?: LoadPriority;
}

/**
 * Result of image load operation
 */
export interface ImageLoadResult {
  /** Image source URL */
  src: string;
  /** Natural width */
  width: number;
  /** Natural height */
  height: number;
  /** Image element */
  element: HTMLImageElement;
}

/**
 * Options for building optimized URL
 */
export interface OptimizeUrlOptions {
  width?: number | null;
  height?: number | null;
  quality?: number;
}

/**
 * Cache stats for SmartImageLoader
 */
export interface CacheStats {
  /** Number of cached items */
  size: number;
  /** Number of currently loading items */
  loading: number;
}

/**
 * Options for responsive image generation
 */
export interface ResponsiveImageOptions {
  /** Quality (1-100, default: 80) */
  quality?: number;
}

/**
 * Options for creating responsive image element
 */
export interface CreateResponsiveImageOptions {
  /** Alt text */
  alt?: string;
  /** CSS class name */
  className?: string;
  /** Sizes attribute configuration */
  sizes?: string | null;
  /** Quality (1-100, default: 80) */
  quality?: number;
  /** Loading attribute ('lazy' | 'eager', default: 'lazy') */
  loading?: 'lazy' | 'eager';
}

/**
 * Options for blur placeholder generation
 */
export interface BlurPlaceholderOptions {
  /** Width (default: 40) */
  width?: number;
  /** Height (default: 40) */
  height?: number;
  /** Blur amount in pixels (default: 20) */
  blur?: number;
}

/**
 * Options for ProgressiveImageLoader
 */
export interface ProgressiveImageLoaderOptions {
  /** Placeholder source URL */
  placeholder?: string | null;
  /** Fade in duration in ms (default: 300) */
  fadeInDuration?: number;
  /** Callback on successful load */
  onLoad?: ((img: HTMLImageElement) => void) | null;
  /** Callback on error */
  onError?: ((error: Error) => void) | null;
}

/**
 * Network connection interface for navigator.connection
 */
interface NetworkInformation {
  effectiveType: 'slow-2g' | '2g' | '3g' | '4g';
  downlink?: number;
  rtt?: number;
  saveData?: boolean;
}

/**
 * 获取 navigator.connection 的辅助函数 (避免类型冲突)
 */
function getNavigatorConnection(): NetworkInformation | undefined {
  const nav = navigator as any;
  return nav.connection || nav.mozConnection || nav.webkitConnection;
}

/**
 * Image Format Detector
 * 图片格式检测器
 */
export class ImageFormatDetector {
  public support: FormatSupport;

  constructor() {
    this.support = {
      webp: null,
      avif: null,
      jpeg2000: null,
    };

    this.detect();
  }

  /**
   * Detect format support
   */
  async detect(): Promise<void> {
    // Detect WebP
    this.support.webp = await this.detectWebP();

    // Detect AVIF
    this.support.avif = await this.detectAVIF();

    logger.info('[ImageFormat] Browser support:', this.support);
  }

  /**
   * Detect WebP support
   */
  private detectWebP(): Promise<boolean> {
    return new Promise((resolve) => {
      const webpData =
        'data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=';

      const img = new Image();
      img.onload = () => resolve(img.width === 1);
      img.onerror = () => resolve(false);
      img.src = webpData;
    });
  }

  /**
   * Detect AVIF support
   */
  private detectAVIF(): Promise<boolean> {
    return new Promise((resolve) => {
      const avifData =
        'data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADybWV0YQAAAAAAAAAoaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAGxpYmF2aWYAAAAADnBpdG0AAAAAAAEAAAAeaWxvYwAAAABEAAABAAEAAAABAAABGgAAAB0AAAAoaWluZgAAAAAAAQAAABppbmZlAgAAAAABAABhdjAxQ29sb3IAAAAAamlwcnAAAABLaXBjbwAAABRpc3BlAAAAAAAAAAIAAAACAAAAEHBpeGkAAAAAAwgICAAAAAxhdjFDgQ0MAAAAABNjb2xybmNseAACAAIAAYAAAAAXaXBtYQAAAAAAAAABAAEEAQKDBAAAACVtZGF0EgAKCBgANogQEAwgMg8f8D///8WfhwB8+ErK42A=';

      const img = new Image();
      img.onload = () => resolve(img.width === 2);
      img.onerror = () => resolve(false);
      img.src = avifData;
    });
  }

  /**
   * Get best supported format
   */
  getBestFormat(): ImageFormat {
    if (this.support.avif) {
      return 'avif';
    }
    if (this.support.webp) {
      return 'webp';
    }
    return 'jpeg';
  }

  /**
   * Check if format is supported
   */
  isSupported(format: keyof FormatSupport): boolean {
    return this.support[format] === true;
  }
}

/**
 * Smart Image Loader
 * 智能图片加载器
 */
export class SmartImageLoader {
  private options: Required<SmartImageLoaderOptions>;
  public formatDetector: ImageFormatDetector;
  private cache: Map<string, ImageLoadResult> = new Map();
  private loading: Set<string> = new Set();

  constructor(options: SmartImageLoaderOptions = {}) {
    this.options = {
      cdnBase: options.cdnBase || '',
      responsive: options.responsive !== false,
      webp: options.webp !== false,
      networkAware: options.networkAware !== false,
      quality: options.quality || 80,
      placeholder: options.placeholder !== false,
      debug: options.debug || false,
    };

    this.formatDetector = new ImageFormatDetector();
  }

  /**
   * Load image with optimizations
   */
  async load(src: string, options: ImageLoadOptions = {}): Promise<ImageLoadResult> {
    const {
      width = null,
      height = null,
      quality = this.options.quality,
      placeholder = this.options.placeholder,
      priority = 'normal',
    } = options;

    // Check cache
    const cacheKey = this.getCacheKey(src, width, height, quality);
    if (this.cache.has(cacheKey)) {
      if (this.options.debug) {
        logger.info('[SmartImage] Cache hit:', src);
      }
      return this.cache.get(cacheKey)!;
    }

    // Build optimized URL
    const optimizedUrl = this.buildOptimizedUrl(src, {
      width,
      height,
      quality,
    });

    // Load image
    const result = await this.loadImage(optimizedUrl, {
      placeholder,
      priority,
    });

    // Cache result
    this.cache.set(cacheKey, result);

    return result;
  }

  /**
   * Build optimized image URL
   */
  buildOptimizedUrl(src: string, options: OptimizeUrlOptions = {}): string {
    const { width, height, quality } = options;

    // If using CDN
    if (this.options.cdnBase && !src.startsWith('data:')) {
      const params = new URLSearchParams();

      // Add format parameter
      if (this.options.webp) {
        const format = this.formatDetector.getBestFormat();
        params.append('format', format);
      }

      // Add size parameters
      if (width) {
        params.append('w', String(width));
      }
      if (height) {
        params.append('h', String(height));
      }
      if (quality) {
        params.append('q', String(quality));
      }

      // Network-aware quality
      if (this.options.networkAware) {
        const connection = getNavigatorConnection();
        if (connection) {
          const effectiveType = connection.effectiveType;

          // Reduce quality on slow networks
          if (effectiveType === 'slow-2g' || effectiveType === '2g') {
            params.set('q', String(Math.min(quality || 80, 50)));
          } else if (effectiveType === '3g') {
            params.set('q', String(Math.min(quality || 80, 70)));
          }
        }
      }

      const paramString = params.toString();
      const separator = src.includes('?') ? '&' : '?';

      return `${this.options.cdnBase}${src}${separator}${paramString}`;
    }

    return src;
  }

  /**
   * Load image with placeholder
   */
  private async loadImage(
    src: string,
    options: { placeholder?: boolean; priority?: LoadPriority }
  ): Promise<ImageLoadResult> {
    const { priority } = options;

    // Return promise that resolves with image data
    return new Promise((resolve, reject) => {
      const img = new Image();

      img.onload = () => {
        if (this.options.debug) {
          logger.info('[SmartImage] Loaded:', src);
        }

        resolve({
          src,
          width: img.naturalWidth,
          height: img.naturalHeight,
          element: img,
        });

        this.loading.delete(src);
      };

      img.onerror = (error) => {
        logger.error('[SmartImage] Failed to load:', src, error);
        reject(error);
        this.loading.delete(src);
      };

      // Set loading priority
      if (priority === 'high') {
        img.loading = 'eager';
      } else {
        img.loading = 'lazy';
      }

      // Start loading
      img.src = src;
      this.loading.add(src);
    });
  }

  /**
   * Generate cache key
   */
  private getCacheKey(
    src: string,
    width: number | null | undefined,
    height: number | null | undefined,
    quality: number | undefined
  ): string {
    return `${src}:${width || ''}:${height || ''}:${quality || ''}`;
  }

  /**
   * Preload images
   */
  async preload(srcs: string[], priority: LoadPriority = 'low'): Promise<ImageLoadResult[]> {
    const promises = srcs.map((src) => this.load(src, { priority }));
    return Promise.all(promises);
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
    if (this.options.debug) {
      logger.info('[SmartImage] Cache cleared');
    }
  }

  /**
   * Get cache stats
   */
  getCacheStats(): CacheStats {
    return {
      size: this.cache.size,
      loading: this.loading.size,
    };
  }
}

/**
 * Responsive Image Generator
 * 响应式图片生成器
 */
export class ResponsiveImageGenerator {
  private breakpoints: number[];
  private loader: SmartImageLoader;

  constructor(options: { breakpoints?: number[]; loader?: SmartImageLoader } = {}) {
    this.breakpoints = options.breakpoints || [320, 640, 768, 1024, 1280, 1920];
    this.loader = options.loader || new SmartImageLoader();
  }

  /**
   * Generate srcset
   */
  generateSrcSet(src: string, options: ResponsiveImageOptions = {}): string {
    const { quality = 80 } = options;

    const srcset = this.breakpoints
      .map((width) => {
        const url = this.loader.buildOptimizedUrl(src, {
          width,
          quality,
        });
        return `${url} ${width}w`;
      })
      .join(', ');

    return srcset;
  }

  /**
   * Generate sizes attribute
   */
  generateSizes(config?: string | null): string {
    if (typeof config === 'string') {
      return config;
    }

    // Default responsive sizes
    return '(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw';
  }

  /**
   * Create responsive image element
   */
  createResponsiveImage(src: string, options: CreateResponsiveImageOptions = {}): HTMLImageElement {
    const {
      alt = '',
      className = '',
      sizes = null,
      quality = 80,
      loading = 'lazy',
    } = options;

    const img = document.createElement('img');
    img.src = src;
    img.alt = alt;
    img.className = className;
    img.loading = loading;

    // Add srcset for responsive images
    img.srcset = this.generateSrcSet(src, { quality });

    // Add sizes attribute
    img.sizes = this.generateSizes(sizes);

    return img;
  }
}

/**
 * Image Placeholder Generator
 * 图片占位符生成器
 */
export class ImagePlaceholderGenerator {
  /**
   * Generate blur placeholder from image
   */
  static async generateBlurPlaceholder(
    src: string,
    options: BlurPlaceholderOptions = {}
  ): Promise<string> {
    const { width = 40, height = 40, blur = 20 } = options;

    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';

      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to get canvas context'));
          return;
        }

        // Draw scaled down image
        ctx.drawImage(img, 0, 0, width, height);

        // Apply blur filter
        ctx.filter = `blur(${blur}px)`;
        ctx.drawImage(canvas, 0, 0);

        // Convert to data URL
        const placeholder = canvas.toDataURL('image/jpeg', 0.1);

        resolve(placeholder);
      };

      img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
      img.src = src;
    });
  }

  /**
   * Generate solid color placeholder
   */
  static generateColorPlaceholder(
    color: string = '#f0f0f0',
    width: number = 1,
    height: number = 1
  ): string {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return '';
    }

    ctx.fillStyle = color;
    ctx.fillRect(0, 0, width, height);

    return canvas.toDataURL();
  }

  /**
   * Generate gradient placeholder
   */
  static generateGradientPlaceholder(
    colors: string[] = ['#f0f0f0', '#e0e0e0'],
    width: number = 1,
    height: number = 1
  ): string {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return '';
    }

    const gradient = ctx.createLinearGradient(0, 0, width, height);

    colors.forEach((color, index) => {
      gradient.addColorStop(index / (colors.length - 1), color);
    });

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    return canvas.toDataURL();
  }
}

/**
 * Progressive Image Loader
 * 渐进式图片加载器
 */
export class ProgressiveImageLoader {
  private container: HTMLElement;
  private options: Required<ProgressiveImageLoaderOptions>;
  public loaded: boolean = false;

  constructor(container: HTMLElement, options: ProgressiveImageLoaderOptions = {}) {
    this.container = container;
    this.options = {
      placeholder: options.placeholder || null,
      fadeInDuration: options.fadeInDuration || 300,
      onLoad: options.onLoad || null,
      onError: options.onError || null,
    };
  }

  /**
   * Load image progressively
   */
  async load(src: string): Promise<HTMLImageElement> {
    // Create placeholder if provided
    if (this.options.placeholder) {
      this.showPlaceholder(this.options.placeholder);
    }

    try {
      // Load full image
      const img = await this.loadImage(src);

      // Fade in full image
      this.showImage(img);

      this.loaded = true;

      if (this.options.onLoad) {
        this.options.onLoad(img);
      }

      return img;
    } catch (error) {
      logger.error('[ProgressiveImage] Load failed:', error);

      if (this.options.onError) {
        this.options.onError(error as Error);
      }

      throw error;
    }
  }

  /**
   * Show placeholder
   */
  private showPlaceholder(placeholderSrc: string): void {
    const placeholder = document.createElement('img');
    placeholder.src = placeholderSrc;
    placeholder.style.filter = 'blur(20px)';
    placeholder.style.width = '100%';
    placeholder.style.height = '100%';
    placeholder.className = 'progressive-placeholder';

    this.container.replaceChildren();
    this.container.appendChild(placeholder);
  }

  /**
   * Load image
   */
  private loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();

      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
      img.src = src;
    });
  }

  /**
   * Show full image with fade-in
   */
  private showImage(img: HTMLImageElement): void {
    img.style.opacity = '0';
    img.style.transition = `opacity ${this.options.fadeInDuration}ms ease-in-out`;
    img.style.width = '100%';
    img.style.height = '100%';
    img.className = 'progressive-image';

    this.container.replaceChildren();
    this.container.appendChild(img);

    // Trigger fade-in
    setTimeout(() => {
      img.style.opacity = '1';
    }, 10);
  }
}

// Global instances
export const formatDetector = new ImageFormatDetector();
export const smartImageLoader = new SmartImageLoader();
export const responsiveImageGenerator = new ResponsiveImageGenerator();

/**
 * Export default object
 */
export default {
  ImageFormatDetector,
  SmartImageLoader,
  ResponsiveImageGenerator,
  ImagePlaceholderGenerator,
  ProgressiveImageLoader,
  formatDetector,
  smartImageLoader,
  responsiveImageGenerator,
};
