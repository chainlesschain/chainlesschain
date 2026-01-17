<template>
  <scroll-view
    class="virtual-list"
    scroll-y
    :scroll-top="scrollTop"
    :style="{ height: containerHeight + 'px' }"
    @scroll="handleScroll"
    @scrolltolower="handleScrollToLower"
  >
    <view class="virtual-list-phantom" :style="{ height: totalHeight + 'px' }"></view>
    <view class="virtual-list-container" :style="{ transform: `translateY(${offsetY}px)` }">
      <view
        v-for="item in visibleItems"
        :key="getItemKey(item)"
        class="virtual-list-item"
        :style="{ height: itemHeight + 'px' }"
      >
        <slot :item="item" :index="item._virtualIndex"></slot>
      </view>
    </view>

    <!-- 加载更多指示器 -->
    <view class="load-more" v-if="loading">
      <text class="load-more-text">加载中...</text>
    </view>
    <view class="load-more" v-else-if="noMore">
      <text class="load-more-text">没有更多了</text>
    </view>
  </scroll-view>
</template>

<script>
/**
 * VirtualList 虚拟列表组件
 * 用于高效渲染大量列表数据，只渲染可视区域内的元素
 *
 * @props {Array} data - 列表数据
 * @props {Number} itemHeight - 每个列表项的高度（px）
 * @props {Number} containerHeight - 容器高度（px）
 * @props {String} keyField - 用于生成唯一key的字段名
 * @props {Number} bufferSize - 缓冲区大小（额外渲染的项数）
 * @props {Boolean} loading - 是否正在加载
 * @props {Boolean} noMore - 是否没有更多数据
 *
 * @emits scrolltolower - 滚动到底部时触发
 */
export default {
  name: 'VirtualList',
  props: {
    data: {
      type: Array,
      default: () => []
    },
    itemHeight: {
      type: Number,
      default: 100
    },
    containerHeight: {
      type: Number,
      default: 600
    },
    keyField: {
      type: String,
      default: 'id'
    },
    bufferSize: {
      type: Number,
      default: 5
    },
    loading: {
      type: Boolean,
      default: false
    },
    noMore: {
      type: Boolean,
      default: false
    }
  },
  data() {
    return {
      scrollTop: 0,
      startIndex: 0,
      endIndex: 0,
      offsetY: 0
    }
  },
  computed: {
    // 总高度
    totalHeight() {
      return this.data.length * this.itemHeight
    },
    // 可见项数量
    visibleCount() {
      return Math.ceil(this.containerHeight / this.itemHeight) + this.bufferSize * 2
    },
    // 可见的数据项
    visibleItems() {
      const start = Math.max(0, this.startIndex - this.bufferSize)
      const end = Math.min(this.data.length, this.endIndex + this.bufferSize)

      return this.data.slice(start, end).map((item, index) => ({
        ...item,
        _virtualIndex: start + index
      }))
    }
  },
  watch: {
    data: {
      handler() {
        this.calculateVisibleRange()
      },
      immediate: true
    }
  },
  methods: {
    /**
     * 处理滚动事件
     */
    handleScroll(e) {
      const scrollTop = e.detail.scrollTop
      this.updateVisibleRange(scrollTop)
    },

    /**
     * 更新可见范围
     */
    updateVisibleRange(scrollTop) {
      // 计算起始索引
      this.startIndex = Math.floor(scrollTop / this.itemHeight)
      // 计算结束索引
      this.endIndex = this.startIndex + this.visibleCount
      // 计算偏移量
      const bufferStart = Math.max(0, this.startIndex - this.bufferSize)
      this.offsetY = bufferStart * this.itemHeight
    },

    /**
     * 计算可见范围
     */
    calculateVisibleRange() {
      this.startIndex = 0
      this.endIndex = Math.min(this.visibleCount, this.data.length)
      this.offsetY = 0
    },

    /**
     * 获取项目的key
     */
    getItemKey(item) {
      return item[this.keyField] || item._virtualIndex
    },

    /**
     * 处理滚动到底部
     */
    handleScrollToLower() {
      if (!this.loading && !this.noMore) {
        this.$emit('scrolltolower')
      }
    },

    /**
     * 滚动到指定位置
     */
    scrollTo(index) {
      this.scrollTop = index * this.itemHeight
      this.updateVisibleRange(this.scrollTop)
    },

    /**
     * 滚动到顶部
     */
    scrollToTop() {
      this.scrollTo(0)
    },

    /**
     * 滚动到底部
     */
    scrollToBottom() {
      this.scrollTo(this.data.length - 1)
    }
  }
}
</script>

<style lang="scss" scoped>
.virtual-list {
  position: relative;
  overflow: hidden;
  -webkit-overflow-scrolling: touch;

  .virtual-list-phantom {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: -1;
  }

  .virtual-list-container {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    will-change: transform;
  }

  .virtual-list-item {
    box-sizing: border-box;
    overflow: hidden;
  }

  .load-more {
    padding: 24rpx;
    text-align: center;

    .load-more-text {
      font-size: 24rpx;
      color: var(--text-tertiary);
    }
  }
}
</style>
