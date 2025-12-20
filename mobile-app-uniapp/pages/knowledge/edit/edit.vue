<template>
  <view class="edit-container">
    <view class="form">
      <view class="form-item">
        <text class="label">标题</text>
        <input
          class="input"
          type="text"
          v-model="form.title"
          placeholder="请输入标题"
          maxlength="100"
        />
      </view>

      <view class="form-item">
        <text class="label">类型</text>
        <picker
          mode="selector"
          :range="typeOptions"
          range-key="label"
          :value="selectedTypeIndex"
          @change="handleTypeChange"
        >
          <view class="picker">
            <text>{{ getTypeLabel(form.type) }}</text>
            <text class="arrow">▼</text>
          </view>
        </picker>
      </view>

      <view class="form-item content-item">
        <text class="label">内容</text>
        <textarea
          class="textarea"
          v-model="form.content"
          placeholder="请输入内容"
          :maxlength="-1"
          :auto-height="true"
          :show-confirm-bar="false"
        />
      </view>
    </view>

    <view class="actions">
      <button class="action-btn cancel-btn" @click="handleCancel">
        <text>取消</text>
      </button>
      <button
        class="action-btn save-btn"
        :class="{ disabled: !canSave }"
        :disabled="!canSave || saving"
        @click="handleSave"
      >
        <text v-if="!saving">{{ isEdit ? '保存' : '创建' }}</text>
        <text v-else>保存中...</text>
      </button>
    </view>
  </view>
</template>

<script>
import { db } from '@/services/database'

export default {
  data() {
    return {
      id: '',
      isEdit: false,
      saving: false,
      form: {
        title: '',
        type: 'note',
        content: ''
      },
      typeOptions: [
        { value: 'note', label: '笔记' },
        { value: 'document', label: '文档' },
        { value: 'conversation', label: '对话' },
        { value: 'web_clip', label: '网页摘录' }
      ]
    }
  },
  computed: {
    canSave() {
      return this.form.title.trim() !== '' && this.form.content.trim() !== ''
    },
    selectedTypeIndex() {
      return this.typeOptions.findIndex(item => item.value === this.form.type)
    }
  },
  onLoad(options) {
    if (options.id) {
      this.id = options.id
      this.isEdit = true
      this.loadItem()
    } else {
      // 设置导航栏标题
      uni.setNavigationBarTitle({
        title: '新建知识'
      })
    }
  },
  methods: {
    async loadItem() {
      try {
        const item = await db.getKnowledgeItem(this.id)
        if (item) {
          this.form = {
            title: item.title,
            type: item.type,
            content: item.content
          }

          // 设置导航栏标题
          uni.setNavigationBarTitle({
            title: '编辑知识'
          })
        } else {
          uni.showToast({
            title: '未找到该知识条目',
            icon: 'none'
          })
          setTimeout(() => {
            uni.navigateBack()
          }, 1500)
        }
      } catch (error) {
        console.error('加载知识详情失败:', error)
        uni.showToast({
          title: '加载失败',
          icon: 'none'
        })
      }
    },
    getTypeLabel(type) {
      const option = this.typeOptions.find(item => item.value === type)
      return option ? option.label : type
    },
    handleTypeChange(e) {
      const index = e.detail.value
      this.form.type = this.typeOptions[index].value
    },
    async handleSave() {
      if (!this.canSave || this.saving) {
        return
      }

      this.saving = true

      try {
        if (this.isEdit) {
          // 更新
          await db.updateKnowledgeItem(this.id, {
            title: this.form.title.trim(),
            type: this.form.type,
            content: this.form.content.trim()
          })

          uni.showToast({
            title: '保存成功',
            icon: 'success'
          })
        } else {
          // 新建
          await db.addKnowledgeItem({
            title: this.form.title.trim(),
            type: this.form.type,
            content: this.form.content.trim()
          })

          uni.showToast({
            title: '创建成功',
            icon: 'success'
          })
        }

        setTimeout(() => {
          uni.navigateBack()
        }, 1000)
      } catch (error) {
        console.error('保存失败:', error)
        uni.showToast({
          title: '保存失败',
          icon: 'none'
        })
      } finally {
        this.saving = false
      }
    },
    handleCancel() {
      // 检查是否有未保存的内容
      if (this.form.title || this.form.content) {
        uni.showModal({
          title: '提示',
          content: '有未保存的内容，确定要离开吗？',
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
.edit-container {
  min-height: 100vh;
  background-color: var(--bg-page);
  display: flex;
  flex-direction: column;
}

.form {
  flex: 1;
  padding: 24rpx;

  .form-item {
    background-color: var(--bg-card);
    border-radius: 12rpx;
    padding: 32rpx;
    margin-bottom: 20rpx;

    .label {
      display: block;
      font-size: 28rpx;
      font-weight: 500;
      color: var(--text-primary);
      margin-bottom: 20rpx;
    }

    .input {
      width: 100%;
      height: 72rpx;
      padding: 0 24rpx;
      background-color: var(--bg-input);
      border-radius: 8rpx;
      font-size: 28rpx;
      color: var(--text-primary);
    }

    .picker {
      display: flex;
      align-items: center;
      justify-content: space-between;
      height: 72rpx;
      padding: 0 24rpx;
      background-color: var(--bg-input);
      border-radius: 8rpx;
      font-size: 28rpx;
      color: var(--text-primary);

      .arrow {
        font-size: 20rpx;
        color: var(--text-tertiary);
      }
    }

    .textarea {
      width: 100%;
      min-height: 400rpx;
      padding: 24rpx;
      background-color: var(--bg-input);
      border-radius: 8rpx;
      font-size: 28rpx;
      color: var(--text-primary);
      line-height: 1.6;
    }

    &.content-item {
      flex: 1;
      display: flex;
      flex-direction: column;

      .textarea {
        flex: 1;
      }
    }
  }
}

.actions {
  padding: 24rpx;
  background-color: var(--bg-card);
  box-shadow: 0 -2rpx 8rpx var(--shadow-sm);
  display: flex;
  gap: 20rpx;

  .action-btn {
    flex: 1;
    height: 88rpx;
    border-radius: 44rpx;
    font-size: 32rpx;
    font-weight: 500;
    border: none;
    display: flex;
    align-items: center;
    justify-content: center;

    &.cancel-btn {
      background-color: var(--bg-input);
      color: var(--text-secondary);
    }

    &.save-btn {
      background-color: var(--color-primary);
      color: var(--bg-card);

      &.disabled {
        opacity: 0.5;
      }
    }
  }

  .action-btn::after {
    border: none;
  }
}
</style>
