<template>
  <view class="templates-page">
    <view class="nav-bar">
      <text class="nav-back" @click="goBack">返回</text>
      <text class="nav-title">项目模板</text>
      <text class="nav-action" :class="{ disabled: loading }" @click="refreshTemplates">刷新</text>
    </view>

    <view class="search-section">
      <view class="search-box">
        <text class="search-icon">🔍</text>
        <input
          v-model="searchQuery"
          type="text"
          placeholder="搜索模板、类型或标签"
          @input="onSearchInput"
        />
        <text v-if="searchQuery" class="clear-icon" @click="clearSearch">×</text>
      </view>
      <scroll-view scroll-x class="category-scroll" show-scrollbar="false">
        <view
          v-for="category in categories"
          :key="category.key"
          :class="['category-chip', { active: activeCategory === category.key }]"
          @click="selectCategory(category.key)"
        >
          <text>{{ category.label }}</text>
          <text class="chip-count">{{ category.count }}</text>
        </view>
      </scroll-view>
    </view>

    <view v-if="loading" class="loading-state">
      <view class="loading-spinner"></view>
      <text class="loading-text">模板加载中...</text>
    </view>

    <scroll-view v-else scroll-y class="template-list">
      <view
        v-for="template in filteredTemplates"
        :key="template.id"
        class="template-card"
      >
        <view class="template-icon">{{ template.icon || '📄' }}</view>
        <view class="template-info">
          <text class="template-name">{{ template.display_name || template.name }}</text>
          <text class="template-desc">{{ template.description || '暂无描述' }}</text>
          <view class="template-meta">
            <text>{{ formatCategory(template.category) }}</text>
            <text>使用 {{ template.usage_count || 0 }}</text>
            <text v-if="template.tags && template.tags.length">
              标签：{{ template.tags.slice(0, 3).join('、') }}
            </text>
          </view>
        </view>
        <view class="template-actions">
          <button class="use-btn" @click="openTemplateModal(template)">立即使用</button>
        </view>
      </view>

      <view v-if="!filteredTemplates.length" class="empty-state">
        <text class="empty-icon">🗂️</text>
        <text class="empty-title">暂无匹配的模板</text>
        <text class="empty-subtitle">尝试切换分类或清除搜索条件</text>
      </view>
    </scroll-view>

    <!-- 模板填写弹窗 -->
    <view v-if="showTemplateModal" class="popup-overlay" @click="closeTemplateModal">
      <view class="template-modal" @click.stop>
        <view class="dialog-header">
          <text class="dialog-title">{{ selectedTemplate?.display_name || selectedTemplate?.name }}</text>
          <text class="dialog-close" @click="closeTemplateModal">×</text>
        </view>

        <scroll-view scroll-y class="modal-body">
          <view v-if="selectedTemplate?.description" class="template-description">
            <text>{{ selectedTemplate.description }}</text>
          </view>

          <view v-if="variableSchema.length" class="variable-list">
            <view
              v-for="field in variableSchema"
              :key="field.name"
              class="form-group"
            >
              <view class="form-label">
                <text>{{ field.label || field.name }}</text>
                <text v-if="field.required" class="required">*</text>
              </view>

              <textarea
                v-if="isTextareaField(field)"
                v-model="variableForm[field.name]"
                class="form-textarea"
                :placeholder="field.placeholder || '请输入内容'"
                auto-height
              />

              <input
                v-else-if="isTextField(field)"
                v-model="variableForm[field.name]"
                class="form-input"
                type="text"
                :placeholder="field.placeholder || '请输入内容'"
              />

              <picker
                v-else-if="isSelectField(field)"
                :range="field.options || []"
                range-key="label"
                @change="handleSelectChange(field, $event)"
              >
                <view class="picker-value">
                  <text>
                    {{ getSelectLabel(field, variableForm[field.name]) || '请选择' }}
                  </text>
                  <text class="picker-arrow">›</text>
                </view>
              </picker>

              <view v-else-if="field.type === 'boolean'" class="switch-row">
                <switch
                  :checked="Boolean(variableForm[field.name])"
                  @change="handleBooleanChange(field, $event)"
                  color="#667eea"
                />
                <text class="switch-hint">{{ field.placeholder || '' }}</text>
              </view>

              <input
                v-else
                v-model="variableForm[field.name]"
                class="form-input"
                type="text"
                :placeholder="field.placeholder || '请输入内容'"
              />
            </view>
          </view>

          <view v-else class="no-variable-hint">
            <text>该模板无需额外参数，直接生成内容即可。</text>
          </view>

          <view class="preview-section">
            <view class="preview-header">
              <text class="preview-title">内容预览</text>
              <button class="link-btn" @click="renderTemplatePreview(true)">重新生成</button>
            </view>
            <view v-if="previewLoading" class="preview-loading">
              <view class="loading-spinner small"></view>
              <text>生成中...</text>
            </view>
            <scroll-view v-else class="preview-box" scroll-y>
              <text v-if="renderedContent" class="preview-text">{{ renderedContent }}</text>
              <text v-else-if="renderError" class="preview-error">{{ renderError }}</text>
              <text v-else class="preview-placeholder">
                填写参数后将自动生成模板内容
              </text>
            </scroll-view>
          </view>
        </scroll-view>

        <view class="modal-actions">
          <button class="action-btn" @click="copyPreview" :disabled="!renderedContent">复制内容</button>
          <button class="action-btn" @click="saveAsKnowledge" :disabled="!renderedContent || saving">
            {{ saving ? '保存中...' : '保存到知识库' }}
          </button>
          <button class="confirm-btn" @click="closeTemplateModal">完成</button>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import database from '@/services/database'
import { getTemplateManager } from '@/services/template/template-manager'

export default {
  data() {
    return {
      loading: true,
      templateManager: null,
      templates: [],
      categories: [{ key: 'all', label: '全部', count: 0 }],
      searchQuery: '',
      activeCategory: 'all',
      filteredTemplates: [],

      // 模板使用
      showTemplateModal: false,
      selectedTemplate: null,
      variableSchema: [],
      variableForm: {},
      previewLoading: false,
      previewTimer: null,
      renderedContent: '',
      renderError: '',
      saving: false
    }
  },

  watch: {
    variableForm: {
      handler() {
        if (this.showTemplateModal) {
          this.schedulePreviewRender()
        }
      },
      deep: true
    }
  },

  async onLoad() {
    try {
      await this.initDatabase()
      await this.loadTemplates()
    } catch (error) {
      console.error('[ProjectTemplates] 页面初始化失败:', error)
    }
  },

  methods: {
    async initDatabase() {
      try {
        if (!database.isOpen) {
          await database.initWithoutPin()
        }
      } catch (error) {
        console.error('[ProjectTemplates] 数据库初始化失败:', error)
        uni.showToast({
          title: error.message || '初始化失败',
          icon: 'none'
        })
        throw error
      }

      this.templateManager = getTemplateManager()
      try {
        await this.templateManager.initialize()
      } catch (error) {
        console.error('[ProjectTemplates] 模板服务初始化失败:', error)
        uni.showToast({
          title: error.message || '模板服务初始化失败',
          icon: 'none'
        })
        throw error
      }
    },

    async loadTemplates() {
      if (!this.templateManager) return
      this.loading = true
      try {
        const [templates, categories] = await Promise.all([
          this.templateManager.getTemplates({ limit: 200 }),
          this.templateManager.getCategories().catch(() => [])
        ])

        this.templates = templates || []
        const formattedCategories = (categories || []).map(item => ({
          key: item.category,
          label: item.category || '未分类',
          count: item.count || 0
        }))
        const totalCount = this.templates.length
        this.categories = [{ key: 'all', label: '全部', count: totalCount }, ...formattedCategories]
        this.updateFilteredTemplates()
      } catch (error) {
        console.error('[ProjectTemplates] 加载模板失败:', error)
        uni.showToast({
          title: error.message || '加载模板失败',
          icon: 'none'
        })
      } finally {
        this.loading = false
      }
    },

    refreshTemplates() {
      if (this.loading) return
      this.loadTemplates()
    },

    onSearchInput() {
      this.updateFilteredTemplates()
    },

    clearSearch() {
      this.searchQuery = ''
      this.updateFilteredTemplates()
    },

    selectCategory(key) {
      if (this.activeCategory === key) return
      this.activeCategory = key
      this.updateFilteredTemplates()
    },

    updateFilteredTemplates() {
      const query = this.searchQuery.trim().toLowerCase()
      const category = this.activeCategory
      this.filteredTemplates = this.templates.filter(template => {
        const matchCategory = category === 'all' || template.category === category
        const matchQuery = !query ||
          template.display_name?.toLowerCase().includes(query) ||
          template.description?.toLowerCase().includes(query) ||
          template.category?.toLowerCase().includes(query) ||
          (template.tags || []).some(tag => (tag || '').toLowerCase().includes(query))
        return matchCategory && matchQuery
      })
    },

    openTemplateModal(template) {
      this.selectedTemplate = template
      this.variableSchema = Array.isArray(template.variables) ? template.variables : []
      this.variableForm = {}
      this.variableSchema.forEach(field => {
        if (field.default !== undefined && field.default !== null) {
          this.$set(this.variableForm, field.name, field.default)
        } else if (field.type === 'boolean') {
          this.$set(this.variableForm, field.name, false)
        } else {
          this.$set(this.variableForm, field.name, '')
        }
      })
      this.renderedContent = ''
      this.renderError = ''
      this.showTemplateModal = true
      this.renderTemplatePreview(true)
    },

    closeTemplateModal() {
      this.showTemplateModal = false
      this.selectedTemplate = null
      this.variableSchema = []
      this.variableForm = {}
      this.renderedContent = ''
      this.renderError = ''
      this.previewLoading = false
      if (this.previewTimer) {
        clearTimeout(this.previewTimer)
        this.previewTimer = null
      }
    },

    schedulePreviewRender() {
      if (!this.selectedTemplate) return
      if (this.previewTimer) {
        clearTimeout(this.previewTimer)
      }
      this.previewTimer = setTimeout(() => {
        this.renderTemplatePreview()
      }, 300)
    },

    async renderTemplatePreview(force = false) {
      if (!this.selectedTemplate || !this.templateManager) return
      if (!force && !this.showTemplateModal) return

      const missingField = this.variableSchema.find(
        field => field.required && this.isFieldEmpty(this.variableForm[field.name], field.type)
      )
      if (missingField) {
        this.renderedContent = ''
        this.renderError = `请填写 ${missingField.label || missingField.name}`
        return
      }

      this.previewLoading = true
      this.renderError = ''
      try {
        const data = {}
        this.variableSchema.forEach(field => {
          data[field.name] = this.variableForm[field.name] ?? ''
        })
        const templateSource = this.selectedTemplate.content ? this.selectedTemplate : this.selectedTemplate.id
        const content = await this.templateManager.renderTemplateContent(templateSource, data)
        this.renderedContent = content
        this.renderError = ''
      } catch (error) {
        console.error('[ProjectTemplates] 渲染模板失败:', error)
        this.renderedContent = ''
        this.renderError = error.message || '渲染失败，请稍后重试'
      } finally {
        this.previewLoading = false
      }
    },

    isFieldEmpty(value, type) {
      if (type === 'boolean') return false
      if (Array.isArray(value)) return value.length === 0
      return value === undefined || value === null || String(value).trim() === ''
    },

    isTextareaField(field) {
      return field.type === 'textarea' || field.type === 'richtext'
    },

    isTextField(field) {
      return !field.type || field.type === 'text' || field.type === 'string' || field.type === 'number'
    },

    isSelectField(field) {
      return field.type === 'select' && Array.isArray(field.options) && field.options.length > 0
    },

    handleSelectChange(field, event) {
      const index = Number(event.detail.value || 0)
      const options = field.options || []
      const option = options[index]
      this.$set(this.variableForm, field.name, option ? (option.value ?? option.label ?? '') : '')
    },

    handleBooleanChange(field, event) {
      this.$set(this.variableForm, field.name, event.detail.value)
    },

    getSelectLabel(field, value) {
      const options = field.options || []
      const match = options.find(option => option.value === value || option.label === value)
      return match ? (match.label || match.value) : ''
    },

    copyPreview() {
      if (!this.renderedContent) return
      uni.setClipboardData({
        data: this.renderedContent,
        success: () => {
          uni.showToast({
            title: '内容已复制',
            icon: 'none'
          })
        }
      })
    },

    async saveAsKnowledge() {
      if (!this.renderedContent) {
        uni.showToast({ title: '请先生成内容', icon: 'none' })
        return
      }
      this.saving = true
      try {
        const title = `${this.selectedTemplate.display_name || this.selectedTemplate.name || '模板内容'} - ${this.formatTimestamp(Date.now())}`
        await database.addKnowledgeItem({
          title,
          type: 'note',
          content: this.renderedContent
        })
        uni.showToast({
          title: '已保存到知识库',
          icon: 'none'
        })
      } catch (error) {
        console.error('[ProjectTemplates] 保存知识失败:', error)
        uni.showToast({
          title: error.message || '保存失败',
          icon: 'none'
        })
      } finally {
        this.saving = false
      }
    },

    formatCategory(value) {
      if (!value) return '未分类'
      const map = {
        writing: '写作',
        research: '研究',
        meeting: '会议',
        study: '学习',
        project: '项目',
        todo: '任务',
        note: '笔记'
      }
      return map[value] || value
    },

    formatTimestamp(timestamp) {
      const date = new Date(timestamp)
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
    },

    goBack() {
      uni.navigateBack()
    }
  }
}
</script>

<style scoped>
.templates-page {
  min-height: 100vh;
  background: #f5f5f5;
}

.nav-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  background: white;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
}

.nav-back,
.nav-action {
  font-size: 15px;
  color: #667eea;
}

.nav-action.disabled {
  color: #bbb;
}

.nav-title {
  font-size: 18px;
  font-weight: 600;
  color: #1a1a1a;
}

.search-section {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.search-box {
  display: flex;
  align-items: center;
  background: white;
  border-radius: 999px;
  padding: 8px 14px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.05);
}

.search-box input {
  flex: 1;
  border: none;
  background: transparent;
  font-size: 14px;
  margin: 0 8px;
}

.search-icon {
  font-size: 16px;
  color: #999;
}

.clear-icon {
  font-size: 16px;
  color: #bbb;
}

.category-scroll {
  display: flex;
  gap: 8px;
  padding-bottom: 4px;
  white-space: nowrap;
}

.category-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: white;
  border-radius: 999px;
  font-size: 13px;
  color: #666;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.05);
}

.category-chip.active {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}

.chip-count {
  font-size: 12px;
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 80px 20px;
  color: #666;
}

.loading-spinner {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 3px solid #f0f0f0;
  border-top-color: #667eea;
  animation: spin 1s linear infinite;
}

.loading-spinner.small {
  width: 20px;
  height: 20px;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.loading-text {
  margin-top: 10px;
  font-size: 14px;
}

.template-list {
  padding: 0 16px 80px;
}

.template-card {
  background: white;
  border-radius: 14px;
  padding: 16px;
  margin-bottom: 14px;
  display: flex;
  gap: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.template-icon {
  font-size: 32px;
}

.template-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.template-name {
  font-size: 16px;
  font-weight: 600;
  color: #1a1a1a;
}

.template-desc {
  font-size: 13px;
  color: #666;
  line-height: 1.4;
}

.template-meta {
  font-size: 12px;
  color: #999;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.template-actions {
  display: flex;
  align-items: center;
}

.use-btn {
  padding: 8px 14px;
  border: none;
  border-radius: 999px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  font-size: 13px;
}

.empty-state {
  text-align: center;
  color: #999;
  padding: 80px 20px;
}

.empty-icon {
  font-size: 42px;
  margin-bottom: 12px;
}

.empty-title {
  font-size: 16px;
  color: #333;
}

.empty-subtitle {
  font-size: 13px;
  color: #999;
}

.popup-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: flex-end;
  padding: 16px;
  z-index: 999;
}

.template-modal {
  width: 100%;
  background: white;
  border-radius: 16px 16px 0 0;
  max-height: 90%;
  display: flex;
  flex-direction: column;
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid #f0f0f0;
}

.dialog-title {
  font-size: 18px;
  font-weight: 600;
  color: #1a1a1a;
}

.dialog-close {
  font-size: 20px;
  color: #999;
}

.modal-body {
  padding: 16px 20px 0;
  max-height: 60vh;
}

.template-description {
  padding: 12px;
  background: #f7f7fb;
  border-radius: 8px;
  font-size: 13px;
  color: #555;
  margin-bottom: 16px;
}

.form-group {
  margin-bottom: 14px;
  display: flex;
  flex-direction: column;
}

.form-label {
  font-size: 13px;
  color: #555;
  margin-bottom: 6px;
}

.required {
  color: #ff4d4f;
  margin-left: 4px;
}

.form-input,
.form-textarea {
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 14px;
  background: #fff;
}

.form-textarea {
  min-height: 80px;
}

.picker-value {
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 10px 12px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.picker-arrow {
  color: #bbb;
}

.switch-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.switch-hint {
  font-size: 12px;
  color: #999;
}

.preview-section {
  margin-top: 20px;
  border-top: 1px solid #f0f0f0;
  padding-top: 16px;
}

.preview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.preview-title {
  font-size: 15px;
  font-weight: 600;
  color: #333;
}

.link-btn {
  border: none;
  background: transparent;
  color: #667eea;
  font-size: 13px;
}

.preview-box {
  max-height: 200px;
  background: #f7f7fb;
  border-radius: 12px;
  padding: 12px;
}

.preview-text {
  font-size: 13px;
  color: #333;
  line-height: 1.6;
  white-space: pre-wrap;
}

.preview-placeholder,
.preview-error {
  font-size: 13px;
  color: #999;
}

.preview-error {
  color: #ff4d4f;
}

.preview-loading {
  display: flex;
  gap: 8px;
  align-items: center;
  color: #666;
}

.modal-actions {
  display: flex;
  padding: 12px 16px 16px;
  gap: 10px;
}

.action-btn {
  flex: 1;
  border: none;
  border-radius: 999px;
  padding: 10px 0;
  font-size: 14px;
  background: #f0f0f0;
  color: #333;
}

.action-btn:disabled {
  opacity: 0.5;
}

.confirm-btn {
  flex: 1;
  border: none;
  border-radius: 999px;
  padding: 10px 0;
  font-size: 14px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}

.no-variable-hint {
  font-size: 13px;
  color: #999;
  background: #f8f8f8;
  padding: 12px;
  border-radius: 8px;
}
</style>
