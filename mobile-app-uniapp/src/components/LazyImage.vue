<template>
  <view class="lazy-image" :style="containerStyle">
    <!-- 加载中占位 -->
    <view class="lazy-image-placeholder" v-if="loading && !error">
      <view class="placeholder-animation"></view>
    </view>

    <!-- 加载失败占位 -->
    <view class="lazy-image-error" v-else-if="error" @click="retry">
      <text class="error-icon">🖼️</text>
      <text class="error-text">加载失败</text>
      <text class="retry-text">点击重试</text>
    </view>

    <!-- 实际图片 -->
    <image
      v-if="shouldLoad && !error"
      class="lazy-image-content"
      :src="currentSrc"
      :mode="mode"
      :lazy-load="true"
      :fade-show="fadeShow"
      @load="handleLoad"
      @error="handleError"
    />
  </view>
</template>

<script>
/**
 * LazyImage 图片懒加载组件
 * 支持占位图、加载动画、错误处理和重试
 *
 * @props {String} src - 图片地址
 * @props {String} placeholder - 占位图地址
 * @props {String} errorImage - 错误占位图地址
 * @props {String} mode - 图片裁剪、缩放模式
 * @props {Number} width - 宽度（rpx）
 * @props {Number} height - 高度（rpx）
 * @props {Boolean} fadeShow - 是否使用淡入效果
 * @props {Number} threshold - 预加载阈值（px）
 *
 * @emits load - 图片加载成功
 * @emits error - 图片加载失败
 */
export default {
  name: 'LazyImage',
  props: {
    src: {
      type: String,
      required: true
    },
    placeholder: {
      type: String,
      default: ''
    },
    errorImage: {
      type: String,
      default: ''
    },
    mode: {
      type: String,
      default: 'aspectFill'
    },
    width: {
      type: [Number, String],
      default: '100%'
    },
    height: {
      type: [Number, String],
      default: 200
    },
    fadeShow: {
      type: Boolean,
      default: true
    },
    threshold: {
      type: Number,
      default: 100
    },
    borderRadius: {
      type: [Number, String],
      default: 0
    }
  },
  data() {
    return {
      loading: true,
      error: false,
      shouldLoad: false,
      retryCount: 0,
      maxRetry: 3,
      observer: null
    }
  },
  computed: {
    containerStyle() {
      const width = typeof this.width === 'number' ? `${this.width}rpx` : this.width
      const height = typeof this.height === 'number' ? `${this.height}rpx` : this.height
      const borderRadius = typeof this.borderRadius === 'number' ? `${this.borderRadius}rpx` : this.borderRadius

      return {
        width,
        height,
        borderRadius
      }
    },
    currentSrc() {
      if (this.error && this.errorImage) {
        return this.errorImage
      }
      if (this.loading && this.placeholder) {
        return this.placeholder
      }
      return this.src
    }
  },
  mounted() {
    this.initIntersectionObserver()
  },
  beforeUnmount() {
    this.destroyObserver()
  },
  watch: {
    src: {
      handler(newSrc) {
        if (newSrc) {
          this.reset()
          this.initIntersectionObserver()
        }
      }
    }
  },
  methods: {
    /**
     * 初始化交叉观察器
     */
    initIntersectionObserver() {
      // #ifdef H5
      if ('IntersectionObserver' in window) {
        this.observer = new IntersectionObserver(
          (entries) => {
            if (entries[0].isIntersecting) {
              this.shouldLoad = true
              this.destroyObserver()
            }
          },
          {
            rootMargin: `${this.threshold}px`
          }
        )
        this.observer.observe(this.$el)
      } else {
        // 不支持 IntersectionObserver 的情况下直接加载
        this.shouldLoad = true
      }
      // #endif

      // #ifndef H5
      // 小程序环境使用 uni-app 的 createIntersectionObserver
      this.observer = uni.createIntersectionObserver(this, {
        thresholds: [0],
        observeAll: false
      })

      this.observer.relativeToViewport({
        bottom: this.threshold,
        top: this.threshold
      }).observe('.lazy-image', (res) => {
        if (res.intersectionRatio > 0) {
          this.shouldLoad = true
          this.destroyObserver()
        }
      })
      // #endif
    },

    /**
     * 销毁观察器
     */
    destroyObserver() {
      if (this.observer) {
        // #ifdef H5
        this.observer.disconnect()
        // #endif

        // #ifndef H5
        this.observer.disconnect()
        // #endif

        this.observer = null
      }
    },

    /**
     * 处理图片加载成功
     */
    handleLoad(e) {
      this.loading = false
      this.error = false
      this.$emit('load', e)
    },

    /**
     * 处理图片加载失败
     */
    handleError(e) {
      this.loading = false
      this.error = true
      this.$emit('error', e)
    },

    /**
     * 重试加载
     */
    retry() {
      if (this.retryCount < this.maxRetry) {
        this.retryCount++
        this.loading = true
        this.error = false

        // 添加时间戳防止缓存
        const timestamp = Date.now()
        const separator = this.src.includes('?') ? '&' : '?'
        this.shouldLoad = false

        this.$nextTick(() => {
          this.shouldLoad = true
        })
      } else {
        uni.showToast({
          title: '图片加载失败',
          icon: 'none'
        })
      }
    },

    /**
     * 重置状态
     */
    reset() {
      this.loading = true
      this.error = false
      this.shouldLoad = false
      this.retryCount = 0
      this.destroyObserver()
    }
  }
}
</script>

<style lang="scss" scoped>
.lazy-image {
  position: relative;
  overflow: hidden;
  background-color: var(--bg-input);

  .lazy-image-placeholder {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: var(--bg-input);

    .placeholder-animation {
      width: 60%;
      height: 60%;
      background: linear-gradient(
        90deg,
        var(--bg-input) 25%,
        var(--bg-hover) 50%,
        var(--bg-input) 75%
      );
      background-size: 200% 100%;
      animation: shimmer 1.5s infinite;
      border-radius: 8rpx;
    }
  }

  .lazy-image-error {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background-color: var(--bg-input);

    .error-icon {
      font-size: 48rpx;
      margin-bottom: 8rpx;
      opacity: 0.5;
    }

    .error-text {
      font-size: 24rpx;
      color: var(--text-tertiary);
      margin-bottom: 4rpx;
    }

    .retry-text {
      font-size: 22rpx;
      color: var(--color-primary);
    }
  }

  .lazy-image-content {
    width: 100%;
    height: 100%;
    display: block;
  }
}

@keyframes shimmer {
  0% {
    background-position: -200% 0;
  }
  100% {
    background-position: 200% 0;
  }
}
</style>
