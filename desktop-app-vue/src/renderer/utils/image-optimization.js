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
 * Image Format Detector
 * 图片格式检测器
 */
export class ImageFormatDetector {
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
  async detect() {
    // Detect WebP
    this.support.webp = await this.detectWebP();

    // Detect AVIF
    this.support.avif = await this.detectAVIF();

    console.log("[ImageFormat] Browser support:", this.support);
  }

  /**
   * Detect WebP support
   */
  detectWebP() {
    return new Promise((resolve) => {
      const webpData =
        "data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=";

      const img = new Image();
      img.onload = () => resolve(img.width === 1);
      img.onerror = () => resolve(false);
      img.src = webpData;
    });
  }

  /**
   * Detect AVIF support
   */
  detectAVIF() {
    return new Promise((resolve) => {
      const avifData =
        "data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADybWV0YQAAAAAAAAAoaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAGxpYmF2aWYAAAAADnBpdG0AAAAAAAEAAAAeaWxvYwAAAABEAAABAAEAAAABAAABGgAAAB0AAAAoaWluZgAAAAAAAQAAABppbmZlAgAAAAABAABhdjAxQ29sb3IAAAAAamlwcnAAAABLaXBjbwAAABRpc3BlAAAAAAAAAAIAAAACAAAAEHBpeGkAAAAAAwgICAAAAAxhdjFDgQ0MAAAAABNjb2xybmNseAACAAIAAYAAAAAXaXBtYQAAAAAAAAABAAEEAQKDBAAAACVtZGF0EgAKCBgANogQEAwgMg8f8D///8WfhwB8+ErK42A=";

      const img = new Image();
      img.onload = () => resolve(img.width === 2);
      img.onerror = () => resolve(false);
      img.src = avifData;
    });
  }

  /**
   * Get best supported format
   */
  getBestFormat() {
    if (this.support.avif) {return "avif";}
    if (this.support.webp) {return "webp";}
    return "jpeg";
  }

  /**
   * Check if format is supported
   */
  isSupported(format) {
    return this.support[format] === true;
  }
}

/**
 * Smart Image Loader
 * 智能图片加载器
 */
export class SmartImageLoader {
  constructor(options = {}) {
    this.options = {
      // CDN base URL
      cdnBase: options.cdnBase || "",

      // Enable responsive images
      responsive: options.responsive !== false,

      // Enable WebP conversion
      webp: options.webp !== false,

      // Network-aware loading
      networkAware: options.networkAware !== false,

      // Quality (1-100)
      quality: options.quality || 80,

      // Enable blur placeholder
      placeholder: options.placeholder !== false,

      // Debug mode
      debug: options.debug || false,
    };

    this.formatDetector = new ImageFormatDetector();
    this.cache = new Map();
    this.queue = [];
    this.loading = new Set();
  }

  /**
   * Load image with optimizations
   */
  async load(src, options = {}) {
    const {
      width = null,
      height = null,
      quality = this.options.quality,
      placeholder = this.options.placeholder,
      priority = "normal",
    } = options;

    // Check cache
    const cacheKey = this.getCacheKey(src, width, height, quality);
    if (this.cache.has(cacheKey)) {
      if (this.options.debug) {
        console.log("[SmartImage] Cache hit:", src);
      }
      return this.cache.get(cacheKey);
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
  buildOptimizedUrl(src, options = {}) {
    const { width, height, quality } = options;

    // If using CDN
    if (this.options.cdnBase && !src.startsWith("data:")) {
      const params = new URLSearchParams();

      // Add format parameter
      if (this.options.webp) {
        const format = this.formatDetector.getBestFormat();
        params.append("format", format);
      }

      // Add size parameters
      if (width) {params.append("w", width);}
      if (height) {params.append("h", height);}
      if (quality) {params.append("q", quality);}

      // Network-aware quality
      if (this.options.networkAware) {
        const connection =
          navigator.connection ||
          navigator.mozConnection ||
          navigator.webkitConnection;
        if (connection) {
          const effectiveType = connection.effectiveType;

          // Reduce quality on slow networks
          if (effectiveType === "slow-2g" || effectiveType === "2g") {
            params.set("q", Math.min(quality, 50));
          } else if (effectiveType === "3g") {
            params.set("q", Math.min(quality, 70));
          }
        }
      }

      const paramString = params.toString();
      const separator = src.includes("?") ? "&" : "?";

      return `${this.options.cdnBase}${src}${separator}${paramString}`;
    }

    return src;
  }

  /**
   * Load image with placeholder
   */
  async loadImage(src, options = {}) {
    const { placeholder, priority } = options;

    // Return promise that resolves with image data
    return new Promise((resolve, reject) => {
      const img = new Image();

      img.onload = () => {
        if (this.options.debug) {
          console.log("[SmartImage] Loaded:", src);
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
        console.error("[SmartImage] Failed to load:", src, error);
        reject(error);
        this.loading.delete(src);
      };

      // Set loading priority
      if (priority === "high") {
        img.loading = "eager";
      } else {
        img.loading = "lazy";
      }

      // Start loading
      img.src = src;
      this.loading.add(src);
    });
  }

  /**
   * Generate cache key
   */
  getCacheKey(src, width, height, quality) {
    return `${src}:${width || ""}:${height || ""}:${quality || ""}`;
  }

  /**
   * Preload images
   */
  async preload(srcs, priority = "low") {
    const promises = srcs.map((src) => this.load(src, { priority }));

    return Promise.all(promises);
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
    if (this.options.debug) {
      console.log("[SmartImage] Cache cleared");
    }
  }

  /**
   * Get cache stats
   */
  getCacheStats() {
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
  constructor(options = {}) {
    this.breakpoints = options.breakpoints || [320, 640, 768, 1024, 1280, 1920];
    this.loader = options.loader || new SmartImageLoader();
  }

  /**
   * Generate srcset
   */
  generateSrcSet(src, options = {}) {
    const { quality = 80 } = options;

    const srcset = this.breakpoints
      .map((width) => {
        const url = this.loader.buildOptimizedUrl(src, {
          width,
          quality,
        });
        return `${url} ${width}w`;
      })
      .join(", ");

    return srcset;
  }

  /**
   * Generate sizes attribute
   */
  generateSizes(config) {
    if (typeof config === "string") {
      return config;
    }

    // Default responsive sizes
    return "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw";
  }

  /**
   * Create responsive image element
   */
  createResponsiveImage(src, options = {}) {
    const {
      alt = "",
      className = "",
      sizes = null,
      quality = 80,
      loading = "lazy",
    } = options;

    const img = document.createElement("img");
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
  static async generateBlurPlaceholder(src, options = {}) {
    const { width = 40, height = 40, blur = 20 } = options;

    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";

      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");

        // Draw scaled down image
        ctx.drawImage(img, 0, 0, width, height);

        // Apply blur filter
        ctx.filter = `blur(${blur}px)`;
        ctx.drawImage(canvas, 0, 0);

        // Convert to data URL
        const placeholder = canvas.toDataURL("image/jpeg", 0.1);

        resolve(placeholder);
      };

      img.onerror = reject;
      img.src = src;
    });
  }

  /**
   * Generate solid color placeholder
   */
  static generateColorPlaceholder(color = "#f0f0f0", width = 1, height = 1) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, width, height);

    return canvas.toDataURL();
  }

  /**
   * Generate gradient placeholder
   */
  static generateGradientPlaceholder(
    colors = ["#f0f0f0", "#e0e0e0"],
    width = 1,
    height = 1,
  ) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
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
  constructor(container, options = {}) {
    this.container = container;
    this.options = {
      placeholder: options.placeholder || null,
      fadeInDuration: options.fadeInDuration || 300,
      onLoad: options.onLoad || null,
      onError: options.onError || null,
    };

    this.loaded = false;
  }

  /**
   * Load image progressively
   */
  async load(src) {
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
      console.error("[ProgressiveImage] Load failed:", error);

      if (this.options.onError) {
        this.options.onError(error);
      }

      throw error;
    }
  }

  /**
   * Show placeholder
   */
  showPlaceholder(placeholderSrc) {
    const placeholder = document.createElement("img");
    placeholder.src = placeholderSrc;
    placeholder.style.filter = "blur(20px)";
    placeholder.style.width = "100%";
    placeholder.style.height = "100%";
    placeholder.className = "progressive-placeholder";

    this.container.replaceChildren();
    this.container.appendChild(placeholder);
  }

  /**
   * Load image
   */
  loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();

      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  /**
   * Show full image with fade-in
   */
  showImage(img) {
    img.style.opacity = "0";
    img.style.transition = `opacity ${this.options.fadeInDuration}ms ease-in-out`;
    img.style.width = "100%";
    img.style.height = "100%";
    img.className = "progressive-image";

    this.container.replaceChildren();
    this.container.appendChild(img);

    // Trigger fade-in
    setTimeout(() => {
      img.style.opacity = "1";
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
