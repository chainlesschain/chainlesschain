/**
 * 性能优化工具集
 * 提供防抖、节流、图片压缩、缓存等性能优化功能
 */

/**
 * 防抖函数 - 延迟执行,在指定时间内只执行最后一次
 * @param {Function} func - 需要防抖的函数
 * @param {number} delay - 延迟时间(毫秒)
 * @param {boolean} immediate - 是否立即执行
 * @returns {Function}
 */
export function debounce(func, delay = 300, immediate = false) {
  let timer = null;

  return function (...args) {
    const context = this;

    if (immediate && !timer) {
      func.apply(context, args);
    }

    if (timer) clearTimeout(timer);

    timer = setTimeout(() => {
      if (!immediate) {
        func.apply(context, args);
      }
      timer = null;
    }, delay);
  };
}

/**
 * 节流函数 - 限制函数执行频率
 * @param {Function} func - 需要节流的函数
 * @param {number} delay - 间隔时间(毫秒)
 * @param {Object} options - 配置选项
 * @returns {Function}
 */
export function throttle(func, delay = 300, options = {}) {
  let timer = null;
  let previous = 0;
  const { leading = true, trailing = true } = options;

  return function (...args) {
    const context = this;
    const now = Date.now();

    // 首次不执行
    if (!previous && !leading) {
      previous = now;
    }

    const remaining = delay - (now - previous);

    if (remaining <= 0 || remaining > delay) {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }

      previous = now;
      func.apply(context, args);
    } else if (!timer && trailing) {
      timer = setTimeout(() => {
        previous = leading ? Date.now() : 0;
        timer = null;
        func.apply(context, args);
      }, remaining);
    }
  };
}

/**
 * 请求动画帧节流
 * @param {Function} func - 需要执行的函数
 * @returns {Function}
 */
export function rafThrottle(func) {
  let rafId = null;

  return function (...args) {
    const context = this;

    if (rafId) return;

    rafId = requestAnimationFrame(() => {
      func.apply(context, args);
      rafId = null;
    });
  };
}

/**
 * 图片压缩
 * @param {string} imagePath - 图片路径
 * @param {Object} options - 压缩选项
 * @returns {Promise<string>} 压缩后的临时文件路径
 */
export function compressImage(imagePath, options = {}) {
  const {
    quality = 0.8,
    maxWidth = 1920,
    maxHeight = 1920,
    compressedWidth,
    compressedHeight
  } = options;

  return new Promise((resolve, reject) => {
    // #ifdef APP-PLUS
    plus.zip.compressImage(
      {
        src: imagePath,
        dst: imagePath.replace(/\.(jpg|jpeg|png)$/i, '_compressed.$1'),
        quality,
        width: compressedWidth || maxWidth,
        height: compressedHeight || maxHeight,
        overwrite: true
      },
      (event) => {
        resolve(event.target);
      },
      (error) => {
        reject(error);
      }
    );
    // #endif

    // #ifdef H5
    // H5端使用Canvas压缩
    const img = new Image();
    img.crossOrigin = 'Anonymous';

    img.onload = () => {
      let { width, height } = img;

      // 计算缩放比例
      if (width > maxWidth || height > maxHeight) {
        const ratio = Math.min(maxWidth / width, maxHeight / height);
        width *= ratio;
        height *= ratio;
      }

      const canvas = document.createElement('canvas');
      canvas.width = compressedWidth || width;
      canvas.height = compressedHeight || height;

      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      canvas.toBlob(
        (blob) => {
          const url = URL.createObjectURL(blob);
          resolve(url);
        },
        'image/jpeg',
        quality
      );
    };

    img.onerror = reject;
    img.src = imagePath;
    // #endif

    // #ifdef MP-WEIXIN || MP-ALIPAY
    // 小程序端暂不支持压缩,直接返回原图
    resolve(imagePath);
    // #endif
  });
}

/**
 * LRU缓存类
 */
export class LRUCache {
  constructor(capacity = 50) {
    this.capacity = capacity;
    this.cache = new Map();
  }

  get(key) {
    if (!this.cache.has(key)) {
      return null;
    }

    // 将访问的项移到最后(最近使用)
    const value = this.cache.get(key);
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  set(key, value) {
    // 如果已存在,先删除
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // 如果超过容量,删除最久未使用的项(第一个)
    if (this.cache.size >= this.capacity) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }

    this.cache.set(key, value);
  }

  has(key) {
    return this.cache.has(key);
  }

  delete(key) {
    return this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
  }

  get size() {
    return this.cache.size;
  }
}

/**
 * 内存缓存管理器
 */
export class MemoryCache {
  constructor(options = {}) {
    const { maxSize = 100, ttl = 5 * 60 * 1000 } = options; // 默认5分钟过期
    this.maxSize = maxSize;
    this.ttl = ttl;
    this.cache = new Map();
  }

  /**
   * 设置缓存
   * @param {string} key
   * @param {any} value
   * @param {number} ttl - 过期时间(毫秒),可选
   */
  set(key, value, ttl) {
    const expireTime = Date.now() + (ttl || this.ttl);

    // 如果超过容量,删除最早的项
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }

    this.cache.set(key, { value, expireTime });
  }

  /**
   * 获取缓存
   * @param {string} key
   * @returns {any}
   */
  get(key) {
    const item = this.cache.get(key);

    if (!item) {
      return null;
    }

    // 检查是否过期
    if (Date.now() > item.expireTime) {
      this.cache.delete(key);
      return null;
    }

    return item.value;
  }

  /**
   * 删除缓存
   * @param {string} key
   */
  delete(key) {
    this.cache.delete(key);
  }

  /**
   * 清空所有缓存
   */
  clear() {
    this.cache.clear();
  }

  /**
   * 清除过期缓存
   */
  clearExpired() {
    const now = Date.now();
    for (const [key, item] of this.cache.entries()) {
      if (now > item.expireTime) {
        this.cache.delete(key);
      }
    }
  }
}

/**
 * 懒加载图片
 * @param {string} imageSrc - 图片源
 * @param {Object} options - 选项
 * @returns {Promise<string>}
 */
export function lazyLoadImage(imageSrc, options = {}) {
  const { placeholder = '/static/images/placeholder.png', errorImage = '/static/images/error.png' } = options;

  return new Promise((resolve) => {
    // 如果是网络图片,使用uni.downloadFile
    if (imageSrc.startsWith('http://') || imageSrc.startsWith('https://')) {
      uni.downloadFile({
        url: imageSrc,
        success: (res) => {
          if (res.statusCode === 200) {
            resolve(res.tempFilePath);
          } else {
            resolve(errorImage);
          }
        },
        fail: () => {
          resolve(errorImage);
        }
      });
    } else {
      // 本地图片直接返回
      resolve(imageSrc);
    }
  });
}

/**
 * 批量处理任务(分批执行,避免阻塞主线程)
 * @param {Array} tasks - 任务数组
 * @param {number} batchSize - 每批数量
 * @param {number} delay - 批次间延迟(毫秒)
 * @returns {Promise}
 */
export async function batchProcess(tasks, batchSize = 10, delay = 0) {
  const results = [];

  for (let i = 0; i < tasks.length; i += batchSize) {
    const batch = tasks.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(task =>
      typeof task === 'function' ? task() : task
    ));

    results.push(...batchResults);

    // 批次间延迟,避免阻塞
    if (delay > 0 && i + batchSize < tasks.length) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  return results;
}

/**
 * 深拷贝
 * @param {any} obj
 * @returns {any}
 */
export function deepClone(obj) {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (obj instanceof Date) {
    return new Date(obj.getTime());
  }

  if (obj instanceof Array) {
    return obj.map(item => deepClone(item));
  }

  if (obj instanceof Object) {
    const clonedObj = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        clonedObj[key] = deepClone(obj[key]);
      }
    }
    return clonedObj;
  }
}

/**
 * 性能监控
 */
export class PerformanceMonitor {
  constructor() {
    this.marks = new Map();
    this.measures = new Map();
  }

  /**
   * 标记开始时间
   * @param {string} name
   */
  mark(name) {
    this.marks.set(name, Date.now());
  }

  /**
   * 测量时间差
   * @param {string} name
   * @param {string} startMark
   * @returns {number} 时间差(毫秒)
   */
  measure(name, startMark) {
    const startTime = this.marks.get(startMark);
    if (!startTime) {
      console.warn(`Performance mark "${startMark}" not found`);
      return 0;
    }

    const duration = Date.now() - startTime;
    this.measures.set(name, duration);

    console.log(`[Performance] ${name}: ${duration}ms`);
    return duration;
  }

  /**
   * 清除标记
   * @param {string} name
   */
  clearMark(name) {
    this.marks.delete(name);
  }

  /**
   * 清除测量
   * @param {string} name
   */
  clearMeasure(name) {
    this.measures.delete(name);
  }

  /**
   * 清除所有
   */
  clearAll() {
    this.marks.clear();
    this.measures.clear();
  }

  /**
   * 获取所有测量结果
   * @returns {Object}
   */
  getResults() {
    return {
      marks: Object.fromEntries(this.marks),
      measures: Object.fromEntries(this.measures)
    };
  }
}

// 导出单例
export const performanceMonitor = new PerformanceMonitor();
export const memoryCache = new MemoryCache();

export default {
  debounce,
  throttle,
  rafThrottle,
  compressImage,
  LRUCache,
  MemoryCache,
  lazyLoadImage,
  batchProcess,
  deepClone,
  PerformanceMonitor,
  performanceMonitor,
  memoryCache
};
