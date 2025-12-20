<template>
  <view class="import-export-page">
    <!-- 页面标题 -->
    <view class="page-header">
      <text class="page-title">导入/导出知识</text>
      <text class="page-desc">批量管理您的知识库</text>
    </view>

    <!-- 快捷操作 -->
    <view class="quick-actions">
      <view class="action-card" @click="showImportModal = true">
        <text class="action-icon">📥</text>
        <text class="action-title">导入知识</text>
        <text class="action-desc">从文件批量导入</text>
      </view>

      <view class="action-card" @click="showExportModal = true">
        <text class="action-icon">📤</text>
        <text class="action-title">导出知识</text>
        <text class="action-desc">批量导出为文件</text>
      </view>
    </view>

    <!-- 导入记录 -->
    <view class="section">
      <view class="section-header">
        <text class="section-title">导入历史</text>
        <text class="section-count">({{ importHistory.length }})</text>
      </view>

      <view class="empty" v-if="importHistory.length === 0">
        <text class="empty-icon">📋</text>
        <text class="empty-text">暂无导入记录</text>
      </view>

      <view class="history-list" v-else>
        <view class="history-item" v-for="item in importHistory" :key="item.id">
          <view class="item-info">
            <text class="item-title">{{ item.filename }}</text>
            <text class="item-time">{{ formatTime(item.timestamp) }}</text>
          </view>
          <view class="item-stats">
            <text class="stat-success">✓ {{ item.success }}</text>
            <text class="stat-failed" v-if="item.failed > 0">✗ {{ item.failed }}</text>
          </view>
        </view>
      </view>
    </view>

    <!-- 导入弹窗 -->
    <view class="modal" v-if="showImportModal" @click="showImportModal = false">
      <view class="modal-content import-modal" @click.stop>
        <text class="modal-title">导入知识</text>

        <view class="import-options">
          <text class="option-desc">选择要导入的文件格式：</text>

          <view class="format-list">
            <view class="format-item">
              <text class="format-icon">📝</text>
              <text class="format-name">Markdown (.md)</text>
            </view>
            <view class="format-item">
              <text class="format-icon">📄</text>
              <text class="format-name">纯文本 (.txt)</text>
            </view>
            <view class="format-item">
              <text class="format-icon">📦</text>
              <text class="format-name">JSON (.json)</text>
            </view>
          </view>

          <button class="select-file-btn" @click="selectFileToImport">
            <text>📂 选择文件</text>
          </button>

          <!-- 文件输入 (H5) -->
          <!-- #ifdef H5 -->
          <input
            ref="fileInput"
            type="file"
            accept=".md,.txt,.json"
            multiple
            style="display: none;"
            @change="handleFileSelect"
          />
          <!-- #endif -->
        </view>

        <button class="modal-close" @click="showImportModal = false">
          <text>取消</text>
        </button>
      </view>
    </view>

    <!-- 导出弹窗 -->
    <view class="modal" v-if="showExportModal" @click="showExportModal = false">
      <view class="modal-content export-modal" @click.stop>
        <text class="modal-title">导出知识</text>

        <view class="export-options">
          <view class="option-group">
            <text class="group-label">导出范围</text>
            <view class="radio-group">
              <view
                class="radio-item"
                :class="{ active: exportRange === 'all' }"
                @click="exportRange = 'all'"
              >
                <text class="radio-icon">{{ exportRange === 'all' ? '🔘' : '⚪' }}</text>
                <text class="radio-label">全部知识</text>
              </view>
              <view
                class="radio-item"
                :class="{ active: exportRange === 'recent' }"
                @click="exportRange = 'recent'"
              >
                <text class="radio-icon">{{ exportRange === 'recent' ? '🔘' : '⚪' }}</text>
                <text class="radio-label">最近30天</text>
              </view>
            </view>
          </view>

          <view class="option-group">
            <text class="group-label">导出格式</text>
            <view class="radio-group">
              <view
                class="radio-item"
                :class="{ active: exportFormat === 'markdown' }"
                @click="exportFormat = 'markdown'"
              >
                <text class="radio-icon">{{ exportFormat === 'markdown' ? '🔘' : '⚪' }}</text>
                <text class="radio-label">Markdown (.md)</text>
              </view>
              <view
                class="radio-item"
                :class="{ active: exportFormat === 'text' }"
                @click="exportFormat = 'text'"
              >
                <text class="radio-icon">{{ exportFormat === 'text' ? '🔘' : '⚪' }}</text>
                <text class="radio-label">纯文本 (.txt)</text>
              </view>
              <view
                class="radio-item"
                :class="{ active: exportFormat === 'json' }"
                @click="exportFormat = 'json'"
              >
                <text class="radio-icon">{{ exportFormat === 'json' ? '🔘' : '⚪' }}</text>
                <text class="radio-label">JSON (.json)</text>
              </view>
            </view>
          </view>

          <view class="export-info">
            <text class="info-text">将导出约 {{ getExportCount() }} 条知识</text>
          </view>

          <button class="export-btn" @click="executeExport" :disabled="exporting">
            <text>{{ exporting ? '导出中...' : '开始导出' }}</text>
          </button>
        </view>

        <button class="modal-close" @click="showExportModal = false">
          <text>取消</text>
        </button>
      </view>
    </view>
  </view>
</template>

<script>
import { db } from '@/services/database'
import { importExport } from '@/services/importExport'

export default {
  data() {
    return {
      showImportModal: false,
      showExportModal: false,
      importHistory: [],
      exportRange: 'all',
      exportFormat: 'markdown',
      exporting: false,
      allKnowledge: []
    }
  },
  onLoad() {
    this.loadImportHistory()
    this.loadAllKnowledge()
  },
  methods: {
    /**
     * 加载导入历史
     */
    loadImportHistory() {
      try {
        const history = uni.getStorageSync('import_history')
        this.importHistory = history ? JSON.parse(history) : []
      } catch (error) {
        console.error('加载导入历史失败:', error)
        this.importHistory = []
      }
    },

    /**
     * 保存导入历史
     */
    saveImportHistory(record) {
      try {
        this.importHistory.unshift(record)
        // 只保留最近20条
        if (this.importHistory.length > 20) {
          this.importHistory = this.importHistory.slice(0, 20)
        }
        uni.setStorageSync('import_history', JSON.stringify(this.importHistory))
      } catch (error) {
        console.error('保存导入历史失败:', error)
      }
    },

    /**
     * 加载所有知识
     */
    async loadAllKnowledge() {
      try {
        this.allKnowledge = await db.getKnowledgeItems({ limit: 10000 })
      } catch (error) {
        console.error('加载知识列表失败:', error)
      }
    },

    /**
     * 选择文件导入
     */
    selectFileToImport() {
      // #ifdef H5
      // H5 环境：触发文件选择器
      this.$refs.fileInput.click()
      // #endif

      // #ifndef H5
      // App 环境：使用 uni.chooseMessageFile 或文件选择API
      uni.chooseMessageFile({
        count: 10,
        type: 'file',
        extension: ['.md', '.txt', '.json'],
        success: (res) => {
          this.processSelectedFiles(res.tempFiles)
        },
        fail: (err) => {
          console.error('选择文件失败:', err)
          uni.showToast({
            title: '选择文件失败',
            icon: 'none'
          })
        }
      })
      // #endif
    },

    /**
     * 处理文件选择 (H5)
     */
    // #ifdef H5
    async handleFileSelect(event) {
      const files = event.target.files
      if (!files || files.length === 0) return

      const fileList = Array.from(files).map(file => ({
        name: file.name,
        size: file.size,
        file: file
      }))

      await this.processSelectedFiles(fileList)

      // 清空input，允许重复选择同一文件
      event.target.value = ''
    },
    // #endif

    /**
     * 处理选中的文件
     */
    async processSelectedFiles(files) {
      if (!files || files.length === 0) return

      uni.showLoading({ title: '导入中...' })

      let totalSuccess = 0
      let totalFailed = 0

      for (const fileInfo of files) {
        try {
          // 读取文件内容
          const content = await this.readFileContent(fileInfo)

          // 导入知识
          const knowledgeList = await importExport.importKnowledge(content, fileInfo.name)

          // 保存到数据库
          const stats = await importExport.saveImportedKnowledge(knowledgeList)

          totalSuccess += stats.success
          totalFailed += stats.failed

          // 记录到历史
          this.saveImportHistory({
            id: Date.now(),
            filename: fileInfo.name,
            timestamp: Date.now(),
            success: stats.success,
            failed: stats.failed
          })
        } catch (error) {
          console.error('导入文件失败:', fileInfo.name, error)
          totalFailed++
        }
      }

      uni.hideLoading()

      // 显示导入结果
      const message = `导入完成！\n成功: ${totalSuccess} 条\n失败: ${totalFailed} 条`
      uni.showModal({
        title: '导入结果',
        content: message,
        showCancel: false,
        success: () => {
          this.showImportModal = false
          // 刷新知识列表
          this.loadAllKnowledge()
        }
      })
    },

    /**
     * 读取文件内容
     */
    async readFileContent(fileInfo) {
      // #ifdef H5
      // H5 环境：使用 FileReader
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = (e) => {
          resolve(e.target.result)
        }
        reader.onerror = reject
        reader.readAsText(fileInfo.file)
      })
      // #endif

      // #ifndef H5
      // App 环境：使用 uni.getFileSystemManager
      return new Promise((resolve, reject) => {
        const fs = uni.getFileSystemManager()
        fs.readFile({
          filePath: fileInfo.path,
          encoding: 'utf8',
          success: (res) => {
            resolve(res.data)
          },
          fail: reject
        })
      })
      // #endif
    },

    /**
     * 获取导出数量
     */
    getExportCount() {
      if (this.exportRange === 'all') {
        return this.allKnowledge.length
      } else if (this.exportRange === 'recent') {
        const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
        return this.allKnowledge.filter(k => k.created_at > thirtyDaysAgo).length
      }
      return 0
    },

    /**
     * 执行导出
     */
    async executeExport() {
      if (this.exporting) return

      this.exporting = true
      uni.showLoading({ title: '导出中...' })

      try {
        // 获取要导出的知识列表
        let knowledgeList = this.allKnowledge

        if (this.exportRange === 'recent') {
          const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
          knowledgeList = knowledgeList.filter(k => k.created_at > thirtyDaysAgo)
        }

        if (knowledgeList.length === 0) {
          uni.hideLoading()
          uni.showToast({
            title: '没有可导出的知识',
            icon: 'none'
          })
          return
        }

        // 为每个知识加载标签
        for (const knowledge of knowledgeList) {
          const tags = await db.getKnowledgeTags(knowledge.id)
          knowledge.tags = tags || []
        }

        // 批量导出
        const { files } = importExport.exportBatch(knowledgeList, this.exportFormat)

        // 下载文件
        for (const { content, filename, mimeType } of files) {
          await this.downloadFile(content, filename, mimeType)
        }

        uni.hideLoading()
        uni.showToast({
          title: `成功导出 ${files.length} 个文件`,
          icon: 'success'
        })

        this.showExportModal = false
      } catch (error) {
        uni.hideLoading()
        console.error('导出失败:', error)
        uni.showToast({
          title: '导出失败: ' + error.message,
          icon: 'none',
          duration: 3000
        })
      } finally {
        this.exporting = false
      }
    },

    /**
     * 下载文件
     */
    async downloadFile(content, filename, mimeType) {
      // #ifdef H5
      // H5环境：创建下载链接
      const blob = new Blob([content], { type: mimeType + ';charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
      // 添加延迟，避免批量下载时被浏览器拦截
      await new Promise(resolve => setTimeout(resolve, 100))
      // #endif

      // #ifndef H5
      // App环境：保存到本地文件系统
      const fs = uni.getFileSystemManager()
      const filePath = `${uni.env.USER_DATA_PATH}/${filename}`

      return new Promise((resolve, reject) => {
        fs.writeFile({
          filePath: filePath,
          data: content,
          encoding: 'utf8',
          success: () => resolve(),
          fail: reject
        })
      })
      // #endif
    },

    /**
     * 格式化时间
     */
    formatTime(timestamp) {
      const date = new Date(timestamp)
      const year = date.getFullYear()
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')
      const hour = String(date.getHours()).padStart(2, '0')
      const minute = String(date.getMinutes()).padStart(2, '0')
      return `${year}-${month}-${day} ${hour}:${minute}`
    }
  }
}
</script>

<style lang="scss" scoped>
.import-export-page {
  min-height: 100vh;
  background-color: var(--bg-page);
  padding-bottom: 100rpx;
}

.page-header {
  padding: 48rpx 32rpx 32rpx;
  background-color: var(--bg-card);
  margin-bottom: 24rpx;

  .page-title {
    display: block;
    font-size: 44rpx;
    font-weight: bold;
    color: var(--text-primary);
    margin-bottom: 12rpx;
  }

  .page-desc {
    display: block;
    font-size: 26rpx;
    color: var(--text-tertiary);
  }
}

.quick-actions {
  padding: 24rpx;
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 20rpx;

  .action-card {
    background-color: var(--bg-card);
    border-radius: 16rpx;
    padding: 40rpx 24rpx;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12rpx;
    box-shadow: var(--shadow-sm);
    transition: all 0.2s;

    &:active {
      transform: scale(0.97);
    }

    .action-icon {
      font-size: 72rpx;
    }

    .action-title {
      font-size: 30rpx;
      font-weight: 500;
      color: var(--text-primary);
    }

    .action-desc {
      font-size: 24rpx;
      color: var(--text-tertiary);
    }
  }
}

.section {
  background-color: var(--bg-card);
  margin: 24rpx;
  border-radius: 16rpx;
  padding: 32rpx;
  box-shadow: var(--shadow-sm);

  .section-header {
    display: flex;
    align-items: center;
    margin-bottom: 24rpx;

    .section-title {
      font-size: 32rpx;
      font-weight: bold;
      color: var(--text-primary);
    }

    .section-count {
      margin-left: 8rpx;
      font-size: 24rpx;
      color: var(--text-tertiary);
    }
  }
}

.empty {
  text-align: center;
  padding: 80rpx 40rpx;

  .empty-icon {
    display: block;
    font-size: 100rpx;
    margin-bottom: 20rpx;
  }

  .empty-text {
    display: block;
    font-size: 28rpx;
    color: var(--text-secondary);
  }
}

.history-list {
  .history-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 24rpx;
    background-color: var(--bg-input);
    border-radius: 12rpx;
    margin-bottom: 12rpx;

    &:last-child {
      margin-bottom: 0;
    }

    .item-info {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 8rpx;

      .item-title {
        font-size: 28rpx;
        color: var(--text-primary);
        font-weight: 500;
      }

      .item-time {
        font-size: 24rpx;
        color: var(--text-tertiary);
      }
    }

    .item-stats {
      display: flex;
      gap: 16rpx;

      .stat-success {
        font-size: 26rpx;
        color: var(--color-success);
      }

      .stat-failed {
        font-size: 26rpx;
        color: var(--color-error);
      }
    }
  }
}

// 弹窗样式
.modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  z-index: 1000;

  .modal-content {
    width: 100%;
    max-height: 85vh;
    background-color: var(--bg-card);
    border-radius: 32rpx 32rpx 0 0;
    padding: 40rpx;
    animation: slideUp 0.3s ease-out;
    overflow-y: auto;

    .modal-title {
      display: block;
      font-size: 36rpx;
      font-weight: bold;
      color: var(--text-primary);
      margin-bottom: 32rpx;
      text-align: center;
    }

    .modal-close {
      width: 100%;
      height: 88rpx;
      background-color: var(--bg-input);
      color: var(--text-primary);
      border-radius: 44rpx;
      font-size: 30rpx;
      border: none;
      margin-top: 24rpx;

      &::after {
        border: none;
      }
    }
  }
}

.import-options {
  .option-desc {
    display: block;
    font-size: 28rpx;
    color: var(--text-secondary);
    margin-bottom: 20rpx;
  }

  .format-list {
    margin-bottom: 32rpx;

    .format-item {
      display: flex;
      align-items: center;
      gap: 16rpx;
      padding: 20rpx;
      background-color: var(--bg-input);
      border-radius: 12rpx;
      margin-bottom: 12rpx;

      .format-icon {
        font-size: 36rpx;
      }

      .format-name {
        font-size: 28rpx;
        color: var(--text-primary);
      }
    }
  }

  .select-file-btn {
    width: 100%;
    height: 88rpx;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: #ffffff;
    border-radius: 44rpx;
    font-size: 30rpx;
    border: none;
    font-weight: 500;

    &::after {
      border: none;
    }
  }
}

.export-options {
  .option-group {
    margin-bottom: 32rpx;

    .group-label {
      display: block;
      font-size: 28rpx;
      color: var(--text-secondary);
      margin-bottom: 16rpx;
      font-weight: 500;
    }

    .radio-group {
      .radio-item {
        display: flex;
        align-items: center;
        gap: 16rpx;
        padding: 20rpx 24rpx;
        background-color: var(--bg-input);
        border-radius: 12rpx;
        margin-bottom: 12rpx;
        transition: all 0.2s;

        &.active {
          background-color: rgba(102, 126, 234, 0.1);
          border: 2rpx solid var(--color-primary);
        }

        .radio-icon {
          font-size: 32rpx;
        }

        .radio-label {
          flex: 1;
          font-size: 28rpx;
          color: var(--text-primary);
        }
      }
    }
  }

  .export-info {
    padding: 20rpx;
    background-color: #e6f7ff;
    border-radius: 12rpx;
    margin-bottom: 24rpx;

    .info-text {
      display: block;
      font-size: 26rpx;
      color: var(--color-info);
      text-align: center;
    }
  }

  .export-btn {
    width: 100%;
    height: 88rpx;
    background-color: var(--color-primary);
    color: var(--text-inverse);
    border-radius: 44rpx;
    font-size: 30rpx;
    border: none;
    font-weight: 500;

    &[disabled] {
      opacity: 0.5;
    }

    &::after {
      border: none;
    }
  }
}

@keyframes slideUp {
  from {
    transform: translateY(100%);
  }
  to {
    transform: translateY(0);
  }
}
</style>
