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

      <!-- 文件夹选择 -->
      <view class="form-item">
        <text class="label">文件夹</text>
        <picker
          mode="selector"
          :range="folderOptions"
          range-key="label"
          :value="selectedFolderIndex"
          @change="handleFolderChange"
        >
          <view class="picker">
            <text>{{ getFolderLabel(form.folder_id) }}</text>
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
        <view class="label-row">
          <text class="label">内容</text>
          <text class="ai-assistant-btn" @click="showAIModal = true">🤖 AI助手</text>
        </view>
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

    <!-- AI助手弹窗 -->
    <view class="modal" v-if="showAIModal" @click="showAIModal = false">
      <view class="modal-content ai-modal" @click.stop>
        <text class="modal-title">🤖 AI助手</text>

        <view class="ai-options">
          <view class="ai-option" @click="generateSummary">
            <view class="option-icon">📝</view>
            <text class="option-label">生成摘要</text>
            <text class="option-desc">为长文本生成简短摘要</text>
          </view>

          <view class="ai-option" @click="suggestTags">
            <view class="option-icon">🏷️</view>
            <text class="option-label">标签建议</text>
            <text class="option-desc">AI分析内容推荐标签</text>
          </view>

          <view class="ai-option" @click="expandContent">
            <view class="option-icon">✨</view>
            <text class="option-label">内容扩展</text>
            <text class="option-desc">根据大纲生成完整内容</text>
          </view>

          <view class="ai-option" @click="improveContent">
            <view class="option-icon">💡</view>
            <text class="option-label">内容润色</text>
            <text class="option-desc">改进语言表达和结构</text>
          </view>

          <view class="ai-option" @click="generateTitle">
            <view class="option-icon">📌</view>
            <text class="option-label">生成标题</text>
            <text class="option-desc">根据内容自动生成标题</text>
          </view>

          <view class="ai-option" @click="extractKeywords">
            <view class="option-icon">🔑</view>
            <text class="option-label">提取关键词</text>
            <text class="option-desc">自动识别核心关键词</text>
          </view>
        </view>

        <button class="modal-close" @click="showAIModal = false">
          <text>取消</text>
        </button>
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
import { aiService } from '@/services/ai'

export default {
  data() {
    return {
      id: '',
      isEdit: false,
      saving: false,
      form: {
        title: '',
        type: 'note',
        content: '',
        folder_id: null
      },
      typeOptions: [
        { value: 'note', label: '笔记' },
        { value: 'document', label: '文档' },
        { value: 'conversation', label: '对话' },
        { value: 'web_clip', label: '网页摘录' }
      ],
      // 文件夹相关
      folders: [],
      // 标签相关
      showTagModal: false,
      showAIModal: false,
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
    selectedFolderIndex() {
      return this.folderOptions.findIndex(item => item.value === this.form.folder_id)
    },
    folderOptions() {
      const options = [{ value: null, label: '📁 无文件夹（根目录）' }]
      this.folders.forEach(folder => {
        options.push({
          value: folder.id,
          label: `${folder.icon || '📁'} ${folder.name}`
        })
      })
      return options
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
      // 如果从文件夹页面跳转过来，设置默认文件夹
      if (options.folderId) {
        this.form.folder_id = parseInt(options.folderId)
      }

      // 设置导航栏标题
      uni.setNavigationBarTitle({
        title: '新建知识'
      })
    }

    this.loadTags()
    this.loadFolders()
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
     * 加载文件夹列表
     */
    async loadFolders() {
      try {
        this.folders = await db.getFolders()
      } catch (error) {
        console.error('加载文件夹失败:', error)
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
            content: item.content,
            folder_id: item.folder_id
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

    getFolderLabel(folderId) {
      if (!folderId) {
        return '📁 无文件夹（根目录）'
      }
      const folder = this.folders.find(f => f.id === folderId)
      return folder ? `${folder.icon || '📁'} ${folder.name}` : '📁 无文件夹（根目录）'
    },

    handleFolderChange(e) {
      const index = e.detail.value
      this.form.folder_id = this.folderOptions[index].value
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
            content: this.form.content.trim(),
            folder_id: this.form.folder_id
          })
        } else {
          // 新建知识项
          const newItem = await db.addKnowledgeItem({
            title: this.form.title.trim(),
            type: this.form.type,
            content: this.form.content.trim(),
            folder_id: this.form.folder_id
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

    /**
     * AI生成摘要
     */
    async generateSummary() {
      if (!this.form.content) {
        uni.showToast({
          title: '请先输入内容',
          icon: 'none'
        })
        return
      }

      this.showAIModal = false

      uni.showLoading({
        title: 'AI生成中...',
        mask: true
      })

      try {
        const summary = await aiService.generateSummary(this.form.content, 200)

        uni.hideLoading()

        uni.showModal({
          title: '智能摘要',
          content: summary,
          confirmText: '使用摘要',
          cancelText: '保留原文',
          success: (res) => {
            if (res.confirm) {
              // 将摘要插入到内容开头
              this.form.content = `【摘要】\n${summary}\n\n【正文】\n${this.form.content}`
            }
          }
        })
      } catch (error) {
        uni.hideLoading()
        uni.showToast({
          title: error.message || '生成失败',
          icon: 'none'
        })
      }
    },

    /**
     * AI标签建议
     */
    async suggestTags() {
      if (!this.form.title && !this.form.content) {
        uni.showToast({
          title: '请先输入标题或内容',
          icon: 'none'
        })
        return
      }

      this.showAIModal = false

      uni.showLoading({
        title: 'AI分析中...',
        mask: true
      })

      try {
        const suggestions = await aiService.suggestTags(
          this.form.title,
          this.form.content,
          this.allTags
        )

        uni.hideLoading()

        if (suggestions.length === 0) {
          uni.showToast({
            title: '未找到合适的标签',
            icon: 'none'
          })
          return
        }

        // 显示建议的标签
        const tagNames = suggestions.map(s => s.name).join('、')
        uni.showModal({
          title: 'AI标签建议',
          content: `建议添加以下标签：\n${tagNames}`,
          confirmText: '添加这些标签',
          cancelText: '取消',
          success: async (res) => {
            if (res.confirm) {
              // 添加建议的标签
              for (const suggestion of suggestions) {
                // 检查标签是否已存在
                let tag = this.allTags.find(t => t.name === suggestion.name)

                // 如果标签不存在，创建新标签
                if (!tag) {
                  const randomColor = this.tagColors[Math.floor(Math.random() * this.tagColors.length)]
                  tag = await db.createTag(suggestion.name, randomColor)
                  this.allTags.push(tag)
                }

                // 添加到已选标签（避免重复）
                if (!this.selectedTags.find(t => t.id === tag.id)) {
                  this.selectedTags.push(tag)
                }
              }

              uni.showToast({
                title: '标签已添加',
                icon: 'success'
              })
            }
          }
        })
      } catch (error) {
        uni.hideLoading()
        uni.showToast({
          title: error.message || '分析失败',
          icon: 'none'
        })
      }
    },

    /**
     * AI内容扩展
     */
    async expandContent() {
      if (!this.form.title) {
        uni.showToast({
          title: '请先输入标题',
          icon: 'none'
        })
        return
      }

      const outline = this.form.content || '请根据标题生成内容'

      this.showAIModal = false

      uni.showLoading({
        title: 'AI创作中...',
        mask: true
      })

      try {
        const expanded = await aiService.expandContent(
          this.form.title,
          outline,
          'casual'
        )

        uni.hideLoading()

        uni.showModal({
          title: 'AI生成的内容',
          content: expanded.substring(0, 200) + '...',
          confirmText: '使用生成内容',
          cancelText: '取消',
          success: (res) => {
            if (res.confirm) {
              this.form.content = expanded
              uni.showToast({
                title: '内容已更新',
                icon: 'success'
              })
            }
          }
        })
      } catch (error) {
        uni.hideLoading()
        uni.showToast({
          title: error.message || '生成失败',
          icon: 'none'
        })
      }
    },

    /**
     * AI内容润色
     */
    async improveContent() {
      if (!this.form.content) {
        uni.showToast({
          title: '请先输入内容',
          icon: 'none'
        })
        return
      }

      this.showAIModal = false

      uni.showLoading({
        title: 'AI润色中...',
        mask: true
      })

      try {
        const result = await aiService.improveContent(this.form.content)

        uni.hideLoading()

        const suggestions = result.suggestions.join('\n• ')

        uni.showModal({
          title: '改进建议',
          content: `AI建议：\n• ${suggestions}`,
          confirmText: '知道了',
          showCancel: false
        })
      } catch (error) {
        uni.hideLoading()
        uni.showToast({
          title: error.message || '润色失败',
          icon: 'none'
        })
      }
    },

    /**
     * AI生成标题
     */
    async generateTitle() {
      if (!this.form.content) {
        uni.showToast({
          title: '请先输入内容',
          icon: 'none'
        })
        return
      }

      this.showAIModal = false

      uni.showLoading({
        title: 'AI生成中...',
        mask: true
      })

      try {
        const title = await aiService.generateTitle(this.form.content)

        uni.hideLoading()

        // 如果标题为空，提示用户是否替换
        if (this.form.title) {
          uni.showModal({
            title: '生成的标题',
            content: title,
            confirmText: '使用此标题',
            cancelText: '取消',
            success: (res) => {
              if (res.confirm) {
                this.form.title = title
              }
            }
          })
        } else {
          // 直接使用生成的标题
          this.form.title = title
          uni.showToast({
            title: '标题已生成',
            icon: 'success'
          })
        }
      } catch (error) {
        uni.hideLoading()
        uni.showToast({
          title: error.message || '生成标题失败',
          icon: 'none'
        })
      }
    },

    /**
     * AI提取关键词
     */
    async extractKeywords() {
      if (!this.form.title && !this.form.content) {
        uni.showToast({
          title: '请先输入标题或内容',
          icon: 'none'
        })
        return
      }

      this.showAIModal = false

      uni.showLoading({
        title: 'AI分析中...',
        mask: true
      })

      try {
        const text = this.form.title + '\n' + this.form.content
        const keywords = await aiService.extractKeywords(text, 8)

        uni.hideLoading()

        if (keywords.length === 0) {
          uni.showToast({
            title: '未提取到关键词',
            icon: 'none'
          })
          return
        }

        // 显示关键词，让用户选择是否创建为标签
        uni.showModal({
          title: '提取的关键词',
          content: keywords.join('、'),
          confirmText: '创建为标签',
          cancelText: '取消',
          success: async (res) => {
            if (res.confirm) {
              // 将关键词创建为标签并选中
              for (const keyword of keywords) {
                try {
                  // 检查标签是否已存在
                  const existingTag = this.allTags.find(t => t.name === keyword)
                  if (existingTag) {
                    // 如果存在且未选中，则选中
                    if (!this.isTagSelected(existingTag.id)) {
                      this.selectedTags.push(existingTag)
                    }
                  } else {
                    // 创建新标签
                    const newTag = await db.createTag(keyword, this.getRandomColor())
                    this.allTags.push(newTag)
                    this.selectedTags.push(newTag)
                  }
                } catch (error) {
                  console.error('创建标签失败:', keyword, error)
                }
              }

              uni.showToast({
                title: '标签已创建',
                icon: 'success'
              })
            }
          }
        })
      } catch (error) {
        uni.hideLoading()
        uni.showToast({
          title: error.message || '提取关键词失败',
          icon: 'none'
        })
      }
    },

    /**
     * 获取随机颜色
     */
    getRandomColor() {
      const colors = this.tagColors
      return colors[Math.floor(Math.random() * colors.length)]
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

      .ai-assistant-btn {
        font-size: 24rpx;
        color: #fff;
        padding: 10rpx 20rpx;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        border-radius: 32rpx;
        box-shadow: 0 4rpx 12rpx rgba(102, 126, 234, 0.4);
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

// AI助手弹窗
.ai-modal {
  .ai-options {
    display: flex;
    flex-direction: column;
    gap: 20rpx;
    margin-bottom: 32rpx;

    .ai-option {
      background-color: var(--bg-input);
      border-radius: 16rpx;
      padding: 24rpx;
      display: flex;
      align-items: center;
      gap: 20rpx;
      transition: all 0.2s;

      &:active {
        background-color: var(--bg-hover);
        transform: scale(0.98);
      }

      .option-icon {
        width: 80rpx;
        height: 80rpx;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        border-radius: 16rpx;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 40rpx;
        flex-shrink: 0;
      }

      .option-label {
        font-size: 30rpx;
        font-weight: 500;
        color: var(--text-primary);
        margin-bottom: 8rpx;
      }

      .option-desc {
        font-size: 24rpx;
        color: var(--text-tertiary);
      }

      > view:last-child {
        flex: 1;
        display: flex;
        flex-direction: column;
      }
    }
  }
}
</style>
