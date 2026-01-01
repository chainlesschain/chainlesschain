/**
 * 云同步服务
 * 整合本地备份和云存储功能
 */
import { backup } from './backup'
import { CloudStorageFactory } from './cloud/cloudStorage'

class CloudSyncService {
  constructor() {
    this.provider = null
    this.config = null
    this.syncInProgress = false
  }

  /**
   * 初始化云存储提供商
   */
  async initialize() {
    try {
      const config = this.getCloudConfig()
      if (!config || !config.enabled) {
        return false
      }

      this.config = config
      this.provider = CloudStorageFactory.create(config.type, config)
      return true
    } catch (error) {
      console.error('云存储初始化失败:', error)
      return false
    }
  }

  /**
   * 获取云存储配置
   */
  getCloudConfig() {
    try {
      const configStr = uni.getStorageSync('cloud_sync_config')
      return configStr ? JSON.parse(configStr) : null
    } catch (error) {
      console.error('获取云存储配置失败:', error)
      return null
    }
  }

  /**
   * 保存云存储配置
   */
  saveCloudConfig(config) {
    try {
      uni.setStorageSync('cloud_sync_config', JSON.stringify(config))
      this.config = config
      if (config.enabled) {
        this.provider = CloudStorageFactory.create(config.type, config)
      }
    } catch (error) {
      console.error('保存云存储配置失败:', error)
      throw error
    }
  }

  /**
   * 测试云存储连接
   */
  async testConnection(config) {
    try {
      const provider = CloudStorageFactory.create(config.type, config)
      return await provider.testConnection()
    } catch (error) {
      console.error('测试连接失败:', error)
      return false
    }
  }

  /**
   * 上传备份到云端
   * @param {string} fileName - 本地备份文件名
   * @returns {Promise<Object>} 上传结果
   */
  async uploadBackup(fileName) {
    if (!this.provider) {
      await this.initialize()
    }

    if (!this.provider) {
      throw new Error('云存储未配置')
    }

    try {
      // 获取本地备份数据
      const backupData = backup.getBackupData(fileName)
      if (!backupData) {
        throw new Error('本地备份文件不存在')
      }

      // 转换为 JSON 字符串
      const content = JSON.stringify(backupData)

      // 上传到云端
      const result = await this.provider.upload(fileName, content)

      // 更新本地备份记录，标记为已上传
      this._markBackupAsUploaded(fileName)

      return result
    } catch (error) {
      console.error('上传备份失败:', error)
      throw error
    }
  }

  /**
   * 从云端下载备份
   * @param {string} fileName - 云端文件名
   * @returns {Promise<Object>} 备份数据
   */
  async downloadBackup(fileName) {
    if (!this.provider) {
      await this.initialize()
    }

    if (!this.provider) {
      throw new Error('云存储未配置')
    }

    try {
      // 从云端下载
      const content = await this.provider.download(fileName)

      // 解析 JSON
      const backupData = typeof content === 'string'
        ? JSON.parse(content)
        : content

      return backupData
    } catch (error) {
      console.error('下载备份失败:', error)
      throw error
    }
  }

  /**
   * 列出云端备份
   * @returns {Promise<Array>} 云端备份列表
   */
  async listCloudBackups() {
    if (!this.provider) {
      await this.initialize()
    }

    if (!this.provider) {
      throw new Error('云存储未配置')
    }

    try {
      const files = await this.provider.list()

      // 过滤出备份文件并格式化
      return files
        .filter(file => file.fileName.startsWith('chainless_backup_'))
        .map(file => ({
          id: file.fileName.replace('chainless_backup_', '').replace('.json', ''),
          fileName: file.fileName,
          timestamp: parseInt(file.fileName.replace('chainless_backup_', '').replace('.json', '')),
          size: file.size,
          lastModified: file.lastModified,
          source: 'cloud'
        }))
        .sort((a, b) => b.timestamp - a.timestamp)
    } catch (error) {
      console.error('列出云端备份失败:', error)
      return []
    }
  }

  /**
   * 删除云端备份
   * @param {string} fileName - 文件名
   */
  async deleteCloudBackup(fileName) {
    if (!this.provider) {
      await this.initialize()
    }

    if (!this.provider) {
      throw new Error('云存储未配置')
    }

    try {
      await this.provider.delete(fileName)
    } catch (error) {
      console.error('删除云端备份失败:', error)
      throw error
    }
  }

  /**
   * 创建备份并上传到云端
   * @param {Object} options - 备份选项
   * @returns {Promise<Object>} 创建和上传结果
   */
  async createAndUploadBackup(options = {}) {
    try {
      // 创建本地备份
      const fileName = await backup.createBackup(options)

      // 如果启用了云同步，上传到云端
      if (this.config && this.config.enabled) {
        await this.uploadBackup(fileName)
      }

      return {
        success: true,
        fileName,
        uploaded: this.config && this.config.enabled
      }
    } catch (error) {
      console.error('创建并上传备份失败:', error)
      throw error
    }
  }

  /**
   * 从云端恢复备份到本地
   * @param {string} fileName - 云端文件名
   * @param {Object} options - 恢复选项
   * @returns {Promise<Object>} 恢复结果统计
   */
  async restoreFromCloud(fileName, options = {}) {
    try {
      // 从云端下载
      const backupData = await this.downloadBackup(fileName)

      // 恢复到本地
      const stats = await backup.importData(backupData, options)

      // 保存到本地备份列表
      this._saveCloudBackupToLocal(fileName, backupData)

      return stats
    } catch (error) {
      console.error('从云端恢复失败:', error)
      throw error
    }
  }

  /**
   * 同步：上传所有未上传的本地备份
   * @returns {Promise<Object>} 同步结果
   */
  async syncToCloud() {
    if (this.syncInProgress) {
      throw new Error('同步正在进行中')
    }

    if (!this.provider) {
      await this.initialize()
    }

    if (!this.provider) {
      throw new Error('云存储未配置')
    }

    this.syncInProgress = true

    try {
      const localBackups = backup.getBackupList()
      const uploadedBackups = this._getUploadedBackups()

      let uploaded = 0
      let failed = 0

      for (const localBackup of localBackups) {
        // 跳过已上传的
        if (uploadedBackups.includes(localBackup.fileName)) {
          continue
        }

        try {
          await this.uploadBackup(localBackup.fileName)
          uploaded++
        } catch (error) {
          console.error(`上传 ${localBackup.fileName} 失败:`, error)
          failed++
        }
      }

      return {
        success: true,
        uploaded,
        failed,
        total: localBackups.length
      }
    } finally {
      this.syncInProgress = false
    }
  }

  /**
   * 同步：下载云端所有备份到本地
   * @returns {Promise<Object>} 同步结果
   */
  async syncFromCloud() {
    if (this.syncInProgress) {
      throw new Error('同步正在进行中')
    }

    if (!this.provider) {
      await this.initialize()
    }

    if (!this.provider) {
      throw new Error('云存储未配置')
    }

    this.syncInProgress = true

    try {
      const cloudBackups = await this.listCloudBackups()
      const localBackups = backup.getBackupList()
      const localFileNames = localBackups.map(b => b.fileName)

      let downloaded = 0
      let failed = 0

      for (const cloudBackup of cloudBackups) {
        // 跳过已存在的
        if (localFileNames.includes(cloudBackup.fileName)) {
          continue
        }

        try {
          const backupData = await this.downloadBackup(cloudBackup.fileName)
          this._saveCloudBackupToLocal(cloudBackup.fileName, backupData)
          downloaded++
        } catch (error) {
          console.error(`下载 ${cloudBackup.fileName} 失败:`, error)
          failed++
        }
      }

      return {
        success: true,
        downloaded,
        failed,
        total: cloudBackups.length
      }
    } finally {
      this.syncInProgress = false
    }
  }

  /**
   * 双向同步
   * @returns {Promise<Object>} 同步结果
   */
  async syncBidirectional() {
    const uploadResult = await this.syncToCloud()
    const downloadResult = await this.syncFromCloud()

    return {
      success: true,
      uploaded: uploadResult.uploaded,
      downloaded: downloadResult.downloaded,
      failed: uploadResult.failed + downloadResult.failed
    }
  }

  /**
   * 获取同步状态
   */
  getSyncStatus() {
    const localBackups = backup.getBackupList()
    const uploadedBackups = this._getUploadedBackups()

    return {
      enabled: this.config && this.config.enabled,
      configured: !!this.config,
      totalBackups: localBackups.length,
      uploadedBackups: uploadedBackups.length,
      notUploadedBackups: localBackups.length - uploadedBackups.length,
      lastSyncTime: this._getLastSyncTime()
    }
  }

  // ========== 私有方法 ==========

  /**
   * 标记备份为已上传
   */
  _markBackupAsUploaded(fileName) {
    try {
      const uploaded = this._getUploadedBackups()
      if (!uploaded.includes(fileName)) {
        uploaded.push(fileName)
        uni.setStorageSync('uploaded_backups', JSON.stringify(uploaded))
      }
    } catch (error) {
      console.error('标记备份失败:', error)
    }
  }

  /**
   * 获取已上传的备份列表
   */
  _getUploadedBackups() {
    try {
      const uploaded = uni.getStorageSync('uploaded_backups')
      return uploaded ? JSON.parse(uploaded) : []
    } catch (error) {
      console.error('获取已上传备份列表失败:', error)
      return []
    }
  }

  /**
   * 保存云端备份到本地存储
   */
  _saveCloudBackupToLocal(fileName, backupData) {
    try {
      // 保存备份数据
      uni.setStorageSync(fileName, JSON.stringify(backupData))

      // 更新备份列表
      const backups = backup.getBackupList()
      const timestamp = parseInt(fileName.replace('chainless_backup_', '').replace('.json', ''))

      // 检查是否已存在
      if (!backups.find(b => b.fileName === fileName)) {
        backups.unshift({
          id: timestamp,
          fileName,
          timestamp,
          size: JSON.stringify(backupData).length,
          encrypted: backupData.encrypted || false,
          platform: backupData.platform || 'cloud',
          source: 'cloud'
        })

        // 只保留最近10个
        if (backups.length > 10) {
          backups.splice(10)
        }

        uni.setStorageSync('backup_list', JSON.stringify(backups))
      }
    } catch (error) {
      console.error('保存云端备份到本地失败:', error)
    }
  }

  /**
   * 获取最后同步时间
   */
  _getLastSyncTime() {
    try {
      return uni.getStorageSync('last_cloud_sync_time') || null
    } catch (error) {
      return null
    }
  }

  /**
   * 更新最后同步时间
   */
  _updateLastSyncTime() {
    try {
      uni.setStorageSync('last_cloud_sync_time', Date.now())
    } catch (error) {
      console.error('更新同步时间失败:', error)
    }
  }

  /**
   * 应用启动时自动同步
   * 在应用启动时调用，检查是否需要同步
   */
  async autoSyncOnStartup() {
    try {
      // 检查云同步是否启用
      if (!this.config || !this.config.enabled) {
        return
      }

      // 初始化云存储
      const initialized = await this.initialize()
      if (!initialized) {
        return
      }

      // 检查自动同步设置
      const autoSync = uni.getStorageSync('auto_cloud_sync') === 'true'
      if (!autoSync) {
        return
      }

      // 检查上次同步时间，避免频繁同步
      const lastSyncTime = this._getLastSyncTime()
      const now = Date.now()
      const sixHoursInMs = 6 * 60 * 60 * 1000

      if (lastSyncTime && (now - lastSyncTime < sixHoursInMs)) {
        console.log('距离上次同步不足6小时，跳过自动同步')
        return
      }

      // 静默执行双向同步
      console.log('开始自动云同步...')
      await this.syncBidirectional()
      this._updateLastSyncTime()
      console.log('自动云同步完成')
    } catch (error) {
      console.error('自动云同步失败:', error)
      // 静默失败，不影响应用启动
    }
  }

  /**
   * 检查并提示云端新备份
   * 检查云端是否有比本地更新的备份
   */
  async checkCloudUpdates() {
    try {
      if (!this.config || !this.config.enabled) {
        return null
      }

      await this.initialize()

      const cloudBackups = await this.listCloudBackups()
      const localBackups = backup.getBackupList()

      if (cloudBackups.length === 0) {
        return null
      }

      // 获取最新的云端备份
      const latestCloud = cloudBackups[0]

      // 获取最新的本地备份
      const latestLocal = localBackups[0]

      // 如果云端备份更新，返回提示信息
      if (!latestLocal || latestCloud.timestamp > latestLocal.timestamp) {
        return {
          hasUpdate: true,
          cloudBackup: latestCloud,
          message: '云端有更新的备份，是否下载？'
        }
      }

      return null
    } catch (error) {
      console.error('检查云端更新失败:', error)
      return null
    }
  }
}

// 导出单例
export const cloudSync = new CloudSyncService()
