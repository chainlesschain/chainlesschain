<template>
  <view class="project-create-page">
    <!-- 导航栏 -->
    <view class="nav-bar">
      <text class="nav-back" @click="goBack">取消</text>
      <text class="nav-title">新建项目</text>
      <text class="nav-action" @click="createProject">创建</text>
    </view>

    <!-- 表单内容 -->
    <scroll-view scroll-y class="form-container">
      <!-- 项目名称 -->
      <view class="form-section">
        <view class="section-label required">项目名称</view>
        <view class="input-wrapper">
          <input
            v-model="formData.name"
            type="text"
            placeholder="请输入项目名称"
            maxlength="50"
            class="form-input"
          />
          <text class="input-count">{{ formData.name.length }}/50</text>
        </view>
      </view>

      <!-- 项目类型 -->
      <view class="form-section">
        <view class="section-label required">项目类型</view>
        <view class="type-grid">
          <view
            v-for="type in projectTypes"
            :key="type.value"
            :class="['type-card', { active: formData.type === type.value }]"
            @click="selectType(type.value)"
          >
            <text class="type-icon">{{ type.icon }}</text>
            <text class="type-label">{{ type.label }}</text>
          </view>
        </view>
      </view>

      <!-- 项目描述 -->
      <view class="form-section">
        <view class="section-label">项目描述</view>
        <textarea
          v-model="formData.description"
          placeholder="简要描述项目的目标和内容..."
          maxlength="500"
          class="form-textarea"
          :auto-height="true"
        />
        <text class="input-count">{{ formData.description.length }}/500</text>
      </view>

      <!-- 封面图片 -->
      <view class="form-section">
        <view class="section-label">项目封面（可选）</view>
        <view class="cover-upload">
          <view v-if="formData.coverImage" class="cover-preview">
            <image :src="formData.coverImage" mode="aspectFill" class="preview-image" />
            <view class="cover-actions">
              <text class="action-btn" @click="changeCover">更换</text>
              <text class="action-btn" @click="removeCover">移除</text>
            </view>
          </view>
          <view v-else class="cover-placeholder" @click="uploadCover">
            <text class="placeholder-icon">🖼️</text>
            <text class="placeholder-text">点击上传封面图片</text>
            <text class="placeholder-hint">建议尺寸 16:9，最大 5MB</text>
          </view>
        </view>
      </view>

      <!-- 项目模板 -->
      <view class="form-section">
        <view class="section-label">使用模板（可选）</view>
        <view class="template-selector">
          <view
            v-for="template in templates"
            :key="template.id"
            :class="['template-option', { active: selectedTemplate === template.id }]"
            @click="selectTemplate(template.id)"
          >
            <text class="template-icon">{{ template.icon }}</text>
            <view class="template-info">
              <text class="template-name">{{ template.name }}</text>
              <text class="template-desc">{{ template.description }}</text>
            </view>
            <text v-if="selectedTemplate === template.id" class="template-check">✓</text>
          </view>
        </view>
      </view>

      <!-- 高级设置 -->
      <view class="form-section">
        <view class="section-header" @click="toggleAdvanced">
          <view class="section-label">高级设置</view>
          <text class="toggle-icon">{{ showAdvanced ? '▼' : '▶' }}</text>
        </view>
        <view v-if="showAdvanced" class="advanced-options">
          <view class="option-item">
            <text class="option-label">启用AI助手</text>
            <switch :checked="formData.enableAI" @change="toggleEnableAI" color="#667eea" />
          </view>
          <view class="option-item">
            <text class="option-label">启用RAG检索</text>
            <switch :checked="formData.enableRAG" @change="toggleEnableRAG" color="#667eea" />
          </view>
          <view class="option-item">
            <text class="option-label">自动备份</text>
            <switch :checked="formData.autoBackup" @change="toggleAutoBackup" color="#667eea" />
          </view>
        </view>
      </view>

      <!-- 底部占位 -->
      <view class="bottom-spacer"></view>
    </scroll-view>

    <!-- 底部按钮 -->
    <view class="bottom-bar">
      <view class="btn-secondary" @click="goBack">
        <text class="btn-text">取消</text>
      </view>
      <view class="btn-primary" @click="createProject">
        <text class="btn-text">创建项目</text>
      </view>
    </view>
  </view>
</template>

<script>
import projectManager from '@/services/project-manager'
import database from '@/services/database'

export default {
  data() {
    return {
      formData: {
        name: '',
        type: 'general',
        description: '',
        coverImage: '',
        enableAI: true,
        enableRAG: true,
        autoBackup: true
      },
      projectTypes: [
        { label: '通用', value: 'general', icon: '📋' },
        { label: '代码', value: 'code', icon: '💻' },
        { label: '研究', value: 'research', icon: '🔬' },
        { label: '写作', value: 'writing', icon: '✍️' },
        { label: '学习', value: 'learning', icon: '📚' },
        { label: '其他', value: 'other', icon: '📁' }
      ],
      templates: [
        {
          id: 'blank',
          name: '空白项目',
          description: '从零开始创建',
          icon: '📄'
        },
        {
          id: 'code',
          name: '代码项目',
          description: '包含基础开发结构',
          icon: '💻'
        },
        {
          id: 'research',
          name: '研究项目',
          description: '适合学术研究',
          icon: '🔬'
        },
        {
          id: 'writing',
          name: '写作项目',
          description: '文章/文档写作',
          icon: '✍️'
        }
      ],
      selectedTemplate: '',
      showAdvanced: false,
      isCreating: false
    }
  },

  onLoad() {
    this.initDatabase()
  },

  methods: {
    async initDatabase() {
      try {
        if (!database.isOpen) {
          await database.initWithoutPin()
        }
      } catch (error) {
        console.error('[ProjectCreate] 数据库初始化失败:', error)
      }
    },

    selectType(type) {
      this.formData.type = type
    },

    selectTemplate(templateId) {
      if (this.selectedTemplate === templateId) {
        this.selectedTemplate = ''
      } else {
        this.selectedTemplate = templateId
      }
    },

    toggleAdvanced() {
      this.showAdvanced = !this.showAdvanced
    },

    toggleEnableAI(e) {
      this.formData.enableAI = e.detail.value
    },

    toggleEnableRAG(e) {
      this.formData.enableRAG = e.detail.value
    },

    toggleAutoBackup(e) {
      this.formData.autoBackup = e.detail.value
    },

    uploadCover() {
      uni.chooseImage({
        count: 1,
        sizeType: ['compressed'],
        sourceType: ['album', 'camera'],
        success: (res) => {
          const tempFilePath = res.tempFilePaths[0]
          this.formData.coverImage = tempFilePath
          console.log('[ProjectCreate] 封面图片已选择:', tempFilePath)
        },
        fail: (err) => {
          console.error('[ProjectCreate] 选择图片失败:', err)
          uni.showToast({
            title: '选择图片失败',
            icon: 'none'
          })
        }
      })
    },

    changeCover() {
      this.uploadCover()
    },

    removeCover() {
      this.formData.coverImage = ''
    },

    validateForm() {
      if (!this.formData.name.trim()) {
        uni.showToast({
          title: '请输入项目名称',
          icon: 'none'
        })
        return false
      }

      if (this.formData.name.trim().length < 2) {
        uni.showToast({
          title: '项目名称至少2个字符',
          icon: 'none'
        })
        return false
      }

      if (!this.formData.type) {
        uni.showToast({
          title: '请选择项目类型',
          icon: 'none'
        })
        return false
      }

      return true
    },

    async createProject() {
      if (this.isCreating) return

      if (!this.validateForm()) {
        return
      }

      this.isCreating = true

      uni.showLoading({
        title: '创建中...',
        mask: true
      })

      try {
        const projectData = {
          name: this.formData.name.trim(),
          description: this.formData.description.trim(),
          type: this.formData.type,
          coverImage: this.formData.coverImage,
          settings: {
            enableAI: this.formData.enableAI,
            enableRAG: this.formData.enableRAG,
            autoBackup: this.formData.autoBackup,
            template: this.selectedTemplate || null
          }
        }

        const project = await projectManager.createProject(projectData)

        uni.hideLoading()

        uni.showToast({
          title: '创建成功',
          icon: 'success',
          duration: 1500
        })

        // 延迟跳转，让用户看到成功提示
        setTimeout(() => {
          uni.redirectTo({
            url: `/pages/projects/detail?id=${project.id}`
          })
        }, 1500)

      } catch (error) {
        console.error('[ProjectCreate] 创建项目失败:', error)
        uni.hideLoading()
        uni.showToast({
          title: error.message || '创建失败',
          icon: 'none'
        })
      } finally {
        this.isCreating = false
      }
    },

    goBack() {
      // 检查是否有未保存的内容
      if (this.formData.name.trim() || this.formData.description.trim()) {
        uni.showModal({
          title: '提示',
          content: '确定要放弃创建吗？',
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

<style scoped>
.project-create-page {
  min-height: 100vh;
  background: #f5f5f5;
  display: flex;
  flex-direction: column;
}

/* 导航栏 */
.nav-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: white;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
}

.nav-back,
.nav-action {
  font-size: 16px;
  color: #667eea;
  padding: 4px 8px;
}

.nav-title {
  font-size: 18px;
  font-weight: 600;
  color: #333;
}

/* 表单容器 */
.form-container {
  flex: 1;
  padding: 16px;
}

/* 表单区块 */
.form-section {
  margin-bottom: 24px;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.section-label {
  font-size: 16px;
  font-weight: 600;
  color: #333;
  margin-bottom: 12px;
}

.section-label.required::after {
  content: '*';
  color: #f56c6c;
  margin-left: 4px;
}

.toggle-icon {
  font-size: 14px;
  color: #999;
}

/* 输入框 */
.input-wrapper {
  position: relative;
}

.form-input {
  width: 100%;
  padding: 12px 16px;
  background: white;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  font-size: 15px;
  color: #333;
}

.form-input::placeholder {
  color: #999;
}

.input-count {
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 12px;
  color: #999;
}

/* 文本域 */
.form-textarea {
  width: 100%;
  min-height: 100px;
  padding: 12px 16px;
  background: white;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  font-size: 15px;
  color: #333;
  line-height: 1.6;
}

.form-textarea::placeholder {
  color: #999;
}

/* 类型选择 */
.type-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

.type-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16px 12px;
  background: white;
  border: 2px solid #e0e0e0;
  border-radius: 12px;
  transition: all 0.3s;
}

.type-card.active {
  border-color: #667eea;
  background: linear-gradient(135deg, rgba(102, 126, 234, 0.1) 0%, rgba(118, 75, 162, 0.1) 100%);
}

.type-icon {
  font-size: 32px;
  margin-bottom: 8px;
}

.type-label {
  font-size: 14px;
  color: #666;
}

.type-card.active .type-label {
  color: #667eea;
  font-weight: 600;
}

/* 封面上传 */
.cover-upload {
  width: 100%;
}

.cover-preview {
  position: relative;
  width: 100%;
  height: 200px;
  border-radius: 12px;
  overflow: hidden;
}

.preview-image {
  width: 100%;
  height: 100%;
}

.cover-actions {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  background: rgba(0, 0, 0, 0.6);
  padding: 12px;
  gap: 12px;
}

.action-btn {
  flex: 1;
  text-align: center;
  padding: 8px;
  background: white;
  border-radius: 6px;
  font-size: 14px;
  color: #333;
}

.cover-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 200px;
  background: white;
  border: 2px dashed #e0e0e0;
  border-radius: 12px;
}

.placeholder-icon {
  font-size: 48px;
  margin-bottom: 12px;
}

.placeholder-text {
  font-size: 15px;
  color: #333;
  margin-bottom: 4px;
}

.placeholder-hint {
  font-size: 12px;
  color: #999;
}

/* 模板选择 */
.template-selector {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.template-option {
  display: flex;
  align-items: center;
  padding: 16px;
  background: white;
  border: 2px solid #e0e0e0;
  border-radius: 12px;
  transition: all 0.3s;
}

.template-option.active {
  border-color: #667eea;
  background: linear-gradient(135deg, rgba(102, 126, 234, 0.05) 0%, rgba(118, 75, 162, 0.05) 100%);
}

.template-icon {
  font-size: 24px;
  margin-right: 12px;
}

.template-info {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.template-name {
  font-size: 15px;
  font-weight: 600;
  color: #333;
  margin-bottom: 4px;
}

.template-desc {
  font-size: 13px;
  color: #999;
}

.template-check {
  font-size: 20px;
  color: #667eea;
  margin-left: 8px;
}

/* 高级选项 */
.advanced-options {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
  background: white;
  border-radius: 12px;
  margin-top: 12px;
}

.option-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.option-label {
  font-size: 15px;
  color: #333;
}

/* 底部占位 */
.bottom-spacer {
  height: 80px;
}

/* 底部按钮 */
.bottom-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  gap: 12px;
  padding: 12px 16px;
  padding-bottom: calc(12px + env(safe-area-inset-bottom));
  background: white;
  box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.1);
}

.btn-secondary,
.btn-primary {
  flex: 1;
  padding: 14px;
  border-radius: 12px;
  text-align: center;
  transition: opacity 0.2s;
}

.btn-secondary {
  background: #f5f5f5;
}

.btn-primary {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.btn-secondary .btn-text {
  color: #666;
  font-size: 16px;
  font-weight: 600;
}

.btn-primary .btn-text {
  color: white;
  font-size: 16px;
  font-weight: 600;
}

.btn-secondary:active,
.btn-primary:active {
  opacity: 0.8;
}
</style>
