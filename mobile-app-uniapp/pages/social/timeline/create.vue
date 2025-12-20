<template>
  <view class="create-post-container">
    <!-- 头部 -->
    <view class="header">
      <button class="cancel-btn" @click="handleCancel">
        <text>取消</text>
      </button>
      <text class="title">发布动态</text>
      <button
        class="publish-btn"
        :class="{ 'btn-disabled': !canPublish }"
        :disabled="!canPublish || publishing"
        @click="handlePublish"
      >
        <text v-if="!publishing">发布</text>
        <text v-else>发布中...</text>
      </button>
    </view>

    <!-- 内容编辑区 -->
    <scroll-view class="content-area" scroll-y>
      <textarea
        class="content-input"
        v-model="content"
        placeholder="分享新鲜事..."
        :maxlength="maxLength"
        auto-height
        :disabled="publishing"
      />

      <view class="char-count">
        <text>{{ content.length }}/{{ maxLength }}</text>
      </view>

      <!-- 图片选择区域 -->
      <view class="images-section" v-if="images.length > 0">
        <view class="image-list">
          <view
            class="image-item"
            v-for="(img, index) in images"
            :key="index"
          >
            <image class="image" :src="img" mode="aspectFill" />
            <view class="remove-btn" @click="removeImage(index)">
              <text>✕</text>
            </view>
          </view>

          <view class="add-image-btn" v-if="images.length < maxImages" @click="addImage">
            <text class="add-icon">+</text>
          </view>
        </view>
      </view>

      <view class="add-image-placeholder" v-else @click="addImage">
        <text class="add-icon">📷</text>
        <text class="add-text">添加图片（最多{{ maxImages }}张）</text>
      </view>
    </scroll-view>

    <!-- 底部工具栏 -->
    <view class="toolbar">
      <view class="visibility-selector">
        <text class="label">可见范围：</text>
        <picker
          mode="selector"
          :range="visibilityOptions"
          range-key="label"
          :value="visibilityIndex"
          @change="handleVisibilityChange"
        >
          <view class="picker-content">
            <text>{{ visibilityOptions[visibilityIndex].label }}</text>
            <text class="dropdown-icon">▼</text>
          </view>
        </picker>
      </view>
    </view>
  </view>
</template>

<script>
import postsService from '@/services/posts'

export default {
  data() {
    return {
      content: '',
      images: [],
      maxLength: 2000,
      maxImages: 9,
      publishing: false,
      visibilityIndex: 1, // 默认好友可见
      visibilityOptions: [
        { value: 'public', label: '🌍 公开' },
        { value: 'friends', label: '👥 好友可见' },
        { value: 'private', label: '🔒 仅自己可见' }
      ]
    }
  },

  computed: {
    canPublish() {
      return this.content.trim().length > 0 || this.images.length > 0
    },

    selectedVisibility() {
      return this.visibilityOptions[this.visibilityIndex].value
    }
  },

  methods: {
    handleVisibilityChange(e) {
      this.visibilityIndex = e.detail.value
    },

    addImage() {
      // #ifdef APP-PLUS
      uni.chooseImage({
        count: this.maxImages - this.images.length,
        sizeType: ['compressed'],
        sourceType: ['album', 'camera'],
        success: (res) => {
          this.images.push(...res.tempFilePaths)
        },
        fail: (err) => {
          console.error('选择图片失败:', err)
          uni.showToast({
            title: '选择图片失败',
            icon: 'none'
          })
        }
      })
      // #endif

      // #ifdef H5
      // H5模式下简化处理
      uni.showToast({
        title: 'H5模式暂不支持上传图片',
        icon: 'none'
      })
      // #endif
    },

    removeImage(index) {
      this.images.splice(index, 1)
    },

    async handlePublish() {
      if (!this.canPublish || this.publishing) {
        return
      }

      this.publishing = true

      try {
        await postsService.createPost({
          content: this.content.trim(),
          images: this.images,
          visibility: this.selectedVisibility
        })

        uni.showToast({
          title: '发布成功',
          icon: 'success'
        })

        // 延迟返回
        setTimeout(() => {
          uni.navigateBack()
        }, 1000)
      } catch (error) {
        console.error('发布失败:', error)

        let errorMsg = '发布失败'
        if (error.message) {
          errorMsg = error.message
        }

        uni.showToast({
          title: errorMsg,
          icon: 'none',
          duration: 2000
        })
      } finally {
        this.publishing = false
      }
    },

    handleCancel() {
      if (this.content.trim().length > 0 || this.images.length > 0) {
        uni.showModal({
          title: '确认取消',
          content: '确定要放弃编辑吗？',
          success: (res) => {
            if (res.confirm) {
              uni.navigateBack()
            }
          }
        })
      } else {
        uni.navigateBack()
      }
    }
  }
}
</script>

<style lang="scss" scoped>
.create-post-container {
  min-height: 100vh;
  background: var(--bg-primary);
  display: flex;
  flex-direction: column;
}

.header {
  background: var(--bg-card);
  border-bottom: 2rpx solid var(--border-color);
  padding: 24rpx 32rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;

  .cancel-btn {
    background: transparent;
    color: var(--text-secondary);
    border: none;
    font-size: 28rpx;
    padding: 0;

    &::after {
      border: none;
    }
  }

  .title {
    font-size: 32rpx;
    font-weight: bold;
    color: var(--text-primary);
  }

  .publish-btn {
    background: var(--bg-accent);
    color: var(--text-on-accent);
    border: none;
    border-radius: 24rpx;
    padding: 8rpx 24rpx;
    font-size: 28rpx;

    &.btn-disabled {
      opacity: 0.5;
    }

    &::after {
      border: none;
    }
  }
}

.content-area {
  flex: 1;
  padding: 32rpx;
}

.content-input {
  width: 100%;
  min-height: 400rpx;
  background: transparent;
  font-size: 28rpx;
  color: var(--text-primary);
  line-height: 1.6;
}

.char-count {
  text-align: right;
  font-size: 22rpx;
  color: var(--text-tertiary);
  margin-top: 16rpx;
}

.images-section {
  margin-top: 32rpx;

  .image-list {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16rpx;

    .image-item {
      position: relative;
      width: 100%;
      padding-bottom: 100%;

      .image {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        border-radius: 12rpx;
      }

      .remove-btn {
        position: absolute;
        top: 8rpx;
        right: 8rpx;
        width: 48rpx;
        height: 48rpx;
        background: rgba(0, 0, 0, 0.6);
        border-radius: 24rpx;
        display: flex;
        align-items: center;
        justify-content: center;

        text {
          color: white;
          font-size: 28rpx;
        }
      }
    }

    .add-image-btn {
      width: 100%;
      padding-bottom: 100%;
      background: var(--bg-secondary);
      border-radius: 12rpx;
      border: 2rpx dashed var(--border-color);
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;

      .add-icon {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        font-size: 64rpx;
        color: var(--text-tertiary);
      }
    }
  }
}

.add-image-placeholder {
  margin-top: 32rpx;
  padding: 80rpx 32rpx;
  background: var(--bg-secondary);
  border-radius: 16rpx;
  border: 2rpx dashed var(--border-color);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16rpx;

  .add-icon {
    font-size: 64rpx;
  }

  .add-text {
    font-size: 24rpx;
    color: var(--text-tertiary);
  }
}

.toolbar {
  background: var(--bg-card);
  border-top: 2rpx solid var(--border-color);
  padding: 24rpx 32rpx;

  .visibility-selector {
    display: flex;
    align-items: center;
    gap: 16rpx;

    .label {
      font-size: 26rpx;
      color: var(--text-secondary);
    }

    .picker-content {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12rpx 24rpx;
      background: var(--bg-secondary);
      border-radius: 24rpx;
      font-size: 26rpx;
      color: var(--text-primary);

      .dropdown-icon {
        font-size: 20rpx;
        color: var(--text-tertiary);
      }
    }
  }
}
</style>
