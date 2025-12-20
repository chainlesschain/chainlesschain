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

      <!-- 标签选择 -->
      <view class="form-item tags-item">
        <view class="label-row">
          <text class="label">标签</text>
          <text class="add-tag-btn" @click="showTagModal = true">+ 添加标签</text>
        </view>

        <view class="selected-tags" v-if="selectedTags.length > 0">
          <view
            class="tag-chip"
            v-for="tag in selectedTags"
            :key="tag.id"
            :style="{ backgroundColor: tag.color + '20', borderColor: tag.color }"
          >
            <text class="tag-chip-name" :style="{ color: tag.color }">{{ tag.name }}</text>
            <text class="tag-chip-close" @click.stop="removeTag(tag.id)">×</text>
          </view>
        </view>

        <view class="empty-tags" v-else>
          <text class="empty-hint">未添加标签，点击右上角添加</text>
        </view>
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

    <!-- 标签选择弹窗 -->
    <view class="modal" v-if="showTagModal" @click="showTagModal = false">
      <view class="modal-content" @click.stop>
        <text class="modal-title">选择标签</text>

        <!-- 搜索框 -->
        <view class="search-box">
          <input
            class="search-input"
            type="text"
            v-model="tagSearchQuery"
            placeholder="搜索或创建标签..."
            @input="handleTagSearch"
          />
        </view>

        <!-- 已选标签 -->
        <view class="selected-section" v-if="selectedTags.length > 0">
          <text class="section-label">已选择 ({{ selectedTags.length }})</text>
          <view class="tag-grid">
            <view
              class="tag-option selected"
              v-for="tag in selectedTags"
              :key="tag.id"
              @click="toggleTag(tag)"
              :style="{ backgroundColor: tag.color + '20', borderColor: tag.color }"
            >
              <text class="tag-option-name" :style="{ color: tag.color }">{{ tag.name }}</text>
              <text class="tag-check">✓</text>
            </view>
          </view>
        </view>

        <!-- 可选标签 -->
        <view class="tags-section">
          <text class="section-label">全部标签</text>
          <view class="tag-grid" v-if="filteredTags.length > 0">
            <view
              class="tag-option"
              :class="{ selected: isTagSelected(tag.id) }"
              v-for="tag in filteredTags"
              :key="tag.id"
              @click="toggleTag(tag)"
              :style="isTagSelected(tag.id) ? { backgroundColor: tag.color + '20', borderColor: tag.color } : {}"
            >
              <text class="tag-option-name" :style="isTagSelected(tag.id) ? { color: tag.color } : {}">
                {{ tag.name }}
              </text>
              <text class="tag-count" v-if="!isTagSelected(tag.id)">{{ tag.count }}</text>
              <text class="tag-check" v-else>✓</text>
            </view>
          </view>

          <!-- 创建新标签提示 -->
          <view class="create-tag-hint" v-if="canCreateNewTag">
            <text class="hint-text">未找到匹配标签</text>
            <button class="create-tag-btn" @click="createNewTag">
              <text>创建 "{{ tagSearchQuery }}"</text>
            </button>
          </view>

          <view class="empty-tags-hint" v-if="allTags.length === 0 && !tagSearchQuery">
            <text>还没有标签，输入名称创建第一个标签</text>
          </view>
        </view>

        <!-- 预设颜色（创建新标签时显示） -->
        <view class="color-section" v-if="showColorPicker">
          <text class="section-label">选择颜色</text>
          <view class="color-grid">
            <view
              class="color-option"
              v-for="color in tagColors"
              :key="color"
              :class="{ active: selectedColor === color }"
              :style="{ backgroundColor: color }"
              @click="selectedColor = color"
            >
              <text class="color-check" v-if="selectedColor === color">✓</text>
            </view>
          </view>
        </view>

        <view class="modal-actions">
          <button class="modal-btn cancel" @click="closeTagModal">
            <text>取消</text>
          </button>
          <button class="modal-btn confirm" @click="confirmTags">
            <text>确定</text>
          </button>
        </view>
      </view>
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
      ],
      // 标签相关
      showTagModal: false,
      allTags: [],
      selectedTags: [],
      originalTagIds: [], // 用于编辑时保存原始标签ID
      tagSearchQuery: '',
      showColorPicker: false,
      selectedColor: '#3cc51f',
      tagColors: [
        '#3cc51f', '#1890ff', '#722ed1', '#eb2f96',
        '#fa8c16', '#fadb14', '#52c41a', '#13c2c2',
        '#2f54eb', '#f5222d', '#fa541c', '#a0d911'
      ]
    }
  },
  computed: {
    canSave() {
      return this.form.title.trim() !== '' && this.form.content.trim() !== ''
    },
    selectedTypeIndex() {
      return this.typeOptions.findIndex(item => item.value === this.form.type)
    },
    filteredTags() {
      if (!this.tagSearchQuery) {
        return this.allTags.filter(tag => !this.isTagSelected(tag.id))
      }

      const query = this.tagSearchQuery.toLowerCase()
      return this.allTags.filter(tag =>
        tag.name.toLowerCase().includes(query) && !this.isTagSelected(tag.id)
      )
    },
    canCreateNewTag() {
      if (!this.tagSearchQuery) return false

      const query = this.tagSearchQuery.trim().toLowerCase()
      const exists = this.allTags.some(tag => tag.name.toLowerCase() === query)
      return !exists && query.length > 0
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

    this.loadTags()
  },
  methods: {
    /**
     * 加载标签列表
     */
    async loadTags() {
      try {
        this.allTags = await db.getTags()
      } catch (error) {
        console.error('加载标签失败:', error)
      }
    },

    /**
     * 加载知识项和其标签
     */
    async loadItem() {
      try {
        const item = await db.getKnowledgeItem(this.id)
        if (item) {
          this.form = {
            title: item.title,
            type: item.type,
            content: item.content
          }

          // 加载该知识项的标签
          const tags = await db.getKnowledgeTags(this.id)
          this.selectedTags = tags || []
          this.originalTagIds = this.selectedTags.map(t => t.id)

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

    /**
     * 标签搜索
     */
    handleTagSearch() {
      // 搜索时不显示颜色选择器
      this.showColorPicker = false
    },

    /**
     * 检查标签是否已选中
     */
    isTagSelected(tagId) {
      return this.selectedTags.some(tag => tag.id === tagId)
    },

    /**
     * 切换标签选中状态
     */
    toggleTag(tag) {
      const index = this.selectedTags.findIndex(t => t.id === tag.id)
      if (index !== -1) {
        this.selectedTags.splice(index, 1)
      } else {
        this.selectedTags.push(tag)
      }
    },

    /**
     * 移除标签
     */
    removeTag(tagId) {
      const index = this.selectedTags.findIndex(t => t.id === tagId)
      if (index !== -1) {
        this.selectedTags.splice(index, 1)
      }
    },

    /**
     * 创建新标签
     */
    async createNewTag() {
      if (!this.canCreateNewTag) return

      this.showColorPicker = true

      try {
        const tagName = this.tagSearchQuery.trim()
        const newTag = await db.createTag(tagName, this.selectedColor)

        // 添加到全部标签列表
        this.allTags.push(newTag)

        // 自动选中新创建的标签
        this.selectedTags.push(newTag)

        // 清空搜索
        this.tagSearchQuery = ''
        this.showColorPicker = false

        uni.showToast({
          title: '标签已创建',
          icon: 'success',
          duration: 1000
        })
      } catch (error) {
        console.error('创建标签失败:', error)
        uni.showToast({
          title: '创建失败',
          icon: 'none'
        })
      }
    },

    /**
     * 确认标签选择
     */
    confirmTags() {
      this.showTagModal = false
      this.tagSearchQuery = ''
      this.showColorPicker = false
    },

    /**
     * 关闭标签弹窗
     */
    closeTagModal() {
      this.showTagModal = false
      this.tagSearchQuery = ''
      this.showColorPicker = false
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
        let itemId = this.id

        if (this.isEdit) {
          // 更新知识项
          await db.updateKnowledgeItem(this.id, {
            title: this.form.title.trim(),
            type: this.form.type,
            content: this.form.content.trim()
          })
        } else {
          // 新建知识项
          const newItem = await db.addKnowledgeItem({
            title: this.form.title.trim(),
            type: this.form.type,
            content: this.form.content.trim()
          })
          itemId = newItem.id
        }

        // 保存标签关联
        const tagIds = this.selectedTags.map(tag => tag.id)
        await db.setKnowledgeTags(itemId, tagIds)

        uni.showToast({
          title: this.isEdit ? '保存成功' : '创建成功',
          icon: 'success'
        })

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

    .label-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20rpx;

      .add-tag-btn {
        font-size: 26rpx;
        color: var(--color-primary);
        padding: 8rpx 16rpx;
        background-color: #e6f7e6;
        border-radius: 32rpx;
      }
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

    // 标签项样式
    &.tags-item {
      .selected-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 16rpx;

        .tag-chip {
          display: inline-flex;
          align-items: center;
          gap: 8rpx;
          padding: 12rpx 20rpx;
          border-radius: 32rpx;
          border: 2rpx solid;

          .tag-chip-name {
            font-size: 24rpx;
            font-weight: 500;
          }

          .tag-chip-close {
            font-size: 36rpx;
            line-height: 1;
            opacity: 0.6;
          }
        }
      }

      .empty-tags {
        padding: 40rpx 20rpx;
        text-align: center;

        .empty-hint {
          font-size: 26rpx;
          color: var(--text-tertiary);
        }
      }
    }
  }
}

.actions {
  padding: 24rpx;
  background-color: var(--bg-card);
  box-shadow: 0 -2rpx 8rpx rgba(0, 0, 0, 0.06);
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
      color: var(--text-inverse);

      &.disabled {
        opacity: 0.5;
      }
    }
  }

  .action-btn::after {
    border: none;
  }
}

// 标签选择弹窗
.modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;

  .modal-content {
    width: 680rpx;
    max-height: 80vh;
    background-color: var(--bg-card);
    border-radius: 16rpx;
    padding: 40rpx;
    overflow-y: auto;

    .modal-title {
      display: block;
      font-size: 36rpx;
      font-weight: bold;
      color: var(--text-primary);
      margin-bottom: 32rpx;
      text-align: center;
    }

    .search-box {
      margin-bottom: 24rpx;

      .search-input {
        width: 100%;
        height: 72rpx;
        padding: 0 24rpx;
        background-color: var(--bg-input);
        border-radius: 36rpx;
        font-size: 28rpx;
        color: var(--text-primary);
      }
    }

    .selected-section,
    .tags-section {
      margin-bottom: 24rpx;

      .section-label {
        display: block;
        font-size: 24rpx;
        color: var(--text-tertiary);
        margin-bottom: 16rpx;
      }

      .tag-grid {
        display: flex;
        flex-wrap: wrap;
        gap: 16rpx;

        .tag-option {
          display: inline-flex;
          align-items: center;
          gap: 8rpx;
          padding: 12rpx 20rpx;
          background-color: var(--bg-input);
          border-radius: 32rpx;
          border: 2rpx solid transparent;
          font-size: 24rpx;
          color: var(--text-secondary);
          transition: all 0.2s;

          &.selected {
            font-weight: 500;
          }

          .tag-option-name {
            font-size: 24rpx;
          }

          .tag-count {
            font-size: 20rpx;
            opacity: 0.6;
          }

          .tag-check {
            font-size: 24rpx;
            font-weight: bold;
          }
        }
      }

      .create-tag-hint {
        text-align: center;
        padding: 32rpx 20rpx;

        .hint-text {
          display: block;
          font-size: 24rpx;
          color: var(--text-tertiary);
          margin-bottom: 16rpx;
        }

        .create-tag-btn {
          background-color: var(--color-primary);
          color: var(--text-inverse);
          border-radius: 32rpx;
          padding: 16rpx 32rpx;
          font-size: 26rpx;
          border: none;

          &::after {
            border: none;
          }
        }
      }

      .empty-tags-hint {
        text-align: center;
        padding: 40rpx 20rpx;
        font-size: 26rpx;
        color: var(--text-tertiary);
      }
    }

    .color-section {
      margin-bottom: 24rpx;

      .section-label {
        display: block;
        font-size: 24rpx;
        color: var(--text-tertiary);
        margin-bottom: 16rpx;
      }

      .color-grid {
        display: grid;
        grid-template-columns: repeat(6, 1fr);
        gap: 16rpx;

        .color-option {
          aspect-ratio: 1;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 3rpx solid transparent;
          transition: all 0.2s;

          &.active {
            border-color: var(--text-primary);
            box-shadow: 0 4rpx 12rpx rgba(0, 0, 0, 0.2);
          }

          .color-check {
            font-size: 32rpx;
            color: var(--text-inverse);
            font-weight: bold;
          }
        }
      }
    }

    .modal-actions {
      display: flex;
      gap: 20rpx;
      margin-top: 32rpx;

      .modal-btn {
        flex: 1;
        height: 88rpx;
        border-radius: 44rpx;
        font-size: 30rpx;
        font-weight: 500;
        border: none;

        &::after {
          border: none;
        }

        &.cancel {
          background-color: var(--bg-input);
          color: var(--text-secondary);
        }

        &.confirm {
          background-color: var(--color-primary);
          color: var(--text-inverse);
        }
      }
    }
  }
}
</style>
