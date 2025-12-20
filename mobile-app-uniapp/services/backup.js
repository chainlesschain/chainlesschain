/**
 * 数据备份与恢复服务
 */
import { db } from './database'
import CryptoJS from 'crypto-js'

class BackupService {
  constructor() {
    this.backupPrefix = 'chainless_backup_'
  }

  /**
   * 导出所有数据
   * @param {Object} options - 导出选项
   * @param {boolean} options.encrypted - 是否加密
   * @param {string} options.password - 加密密码（如果encrypted为true）
   * @returns {Promise<Object>} 导出的数据对象
   */
  async exportData(options = {}) {
    try {
      const { encrypted = false, password = '' } = options

      // 收集所有数据
      const exportData = {
        version: '1.0.0',
        timestamp: Date.now(),
        platform: uni.getSystemInfoSync().platform,
        data: {}
      }

      // 导出知识库数据
      exportData.data.knowledge = await db.getKnowledgeItems({ limit: 10000 })

      // 导出好友数据
      exportData.data.friends = await db.getFriends('all')

      // 导出对话数据
      exportData.data.conversations = await this._getAllConversations()

      // 导出消息数据
      exportData.data.messages = await this._getAllMessages()

      // 导出动态数据
      exportData.data.posts = await db.getPosts('all', 10000)

      // 导出评论数据
      exportData.data.comments = await this._getAllComments()

      // 导出交易数据
      exportData.data.transactions = await db.getTransactions(
        uni.getStorageSync('device_id') || 'did:chainless:user123',
        10000
      )

      // 导出订单数据
      const myDid = uni.getStorageSync('device_id') || 'did:chainless:user123'
      const buyOrders = await db.getOrders(myDid, 'buy')
      const sellOrders = await db.getOrders(myDid, 'sell')
      exportData.data.orders = [...buyOrders, ...sellOrders]

      // 导出市场列表数据
      exportData.data.listings = await db.getMyListings(myDid)

      // 导出用户设置
      exportData.data.settings = this._getUserSettings()

      // 如果需要加密
      if (encrypted && password) {
        const jsonStr = JSON.stringify(exportData)
        const encrypted = CryptoJS.AES.encrypt(jsonStr, password).toString()
        return {
          encrypted: true,
          data: encrypted
        }
      }

      return exportData
    } catch (error) {
      console.error('导出数据失败:', error)
      throw new Error('导出数据失败: ' + error.message)
    }
  }

  /**
   * 导入数据
   * @param {Object|string} importData - 导入的数据
   * @param {Object} options - 导入选项
   * @param {boolean} options.encrypted - 数据是否加密
   * @param {string} options.password - 解密密码
   * @param {boolean} options.merge - 是否合并（false为覆盖）
   * @returns {Promise<Object>} 导入结果统计
   */
  async importData(importData, options = {}) {
    try {
      const { encrypted = false, password = '', merge = false } = options

      let data = importData

      // 如果数据加密，先解密
      if (encrypted) {
        if (!password) {
          throw new Error('需要提供解密密码')
        }

        try {
          const decrypted = CryptoJS.AES.decrypt(importData.data || importData, password)
          const jsonStr = decrypted.toString(CryptoJS.enc.Utf8)

          if (!jsonStr) {
            throw new Error('解密失败，密码可能错误')
          }

          data = JSON.parse(jsonStr)
        } catch (error) {
          throw new Error('解密失败: ' + error.message)
        }
      }

      // 验证数据格式
      if (!data.version || !data.data) {
        throw new Error('无效的备份文件格式')
      }

      const stats = {
        knowledge: 0,
        friends: 0,
        conversations: 0,
        messages: 0,
        posts: 0,
        comments: 0,
        transactions: 0,
        orders: 0,
        listings: 0
      }

      // 如果不是合并模式，先清空数据
      if (!merge) {
        await this._clearAllData()
      }

      // 导入知识库
      if (data.data.knowledge && data.data.knowledge.length > 0) {
        for (const item of data.data.knowledge) {
          await db.addKnowledgeItem(item)
          stats.knowledge++
        }
      }

      // 导入好友
      if (data.data.friends && data.data.friends.length > 0) {
        for (const friend of data.data.friends) {
          await this._importFriend(friend)
          stats.friends++
        }
      }

      // 导入对话
      if (data.data.conversations && data.data.conversations.length > 0) {
        for (const conv of data.data.conversations) {
          await this._importConversation(conv)
          stats.conversations++
        }
      }

      // 导入消息
      if (data.data.messages && data.data.messages.length > 0) {
        for (const msg of data.data.messages) {
          await this._importMessage(msg)
          stats.messages++
        }
      }

      // 导入动态
      if (data.data.posts && data.data.posts.length > 0) {
        for (const post of data.data.posts) {
          await this._importPost(post)
          stats.posts++
        }
      }

      // 导入评论
      if (data.data.comments && data.data.comments.length > 0) {
        for (const comment of data.data.comments) {
          await this._importComment(comment)
          stats.comments++
        }
      }

      // 导入用户设置
      if (data.data.settings) {
        this._restoreUserSettings(data.data.settings)
      }

      return stats
    } catch (error) {
      console.error('导入数据失败:', error)
      throw error
    }
  }

  /**
   * 创建备份文件
   * @param {Object} options - 备份选项
   * @returns {Promise<string>} 备份文件路径
   */
  async createBackup(options = {}) {
    try {
      const exportData = await this.exportData(options)
      const timestamp = Date.now()
      const fileName = `${this.backupPrefix}${timestamp}.json`

      // 保存备份记录
      const backups = this.getBackupList()
      backups.unshift({
        id: timestamp,
        fileName,
        timestamp,
        size: JSON.stringify(exportData).length,
        encrypted: options.encrypted || false,
        platform: uni.getSystemInfoSync().platform
      })

      // 只保留最近10个备份记录
      if (backups.length > 10) {
        backups.splice(10)
      }

      uni.setStorageSync('backup_list', JSON.stringify(backups))
      uni.setStorageSync(fileName, JSON.stringify(exportData))

      return fileName
    } catch (error) {
      console.error('创建备份失败:', error)
      throw error
    }
  }

  /**
   * 获取备份列表
   * @returns {Array} 备份列表
   */
  getBackupList() {
    try {
      const list = uni.getStorageSync('backup_list')
      return list ? JSON.parse(list) : []
    } catch (error) {
      console.error('获取备份列表失败:', error)
      return []
    }
  }

  /**
   * 删除备份
   * @param {string} fileName - 备份文件名
   */
  deleteBackup(fileName) {
    try {
      // 删除备份文件
      uni.removeStorageSync(fileName)

      // 更新备份列表
      const backups = this.getBackupList()
      const newBackups = backups.filter(b => b.fileName !== fileName)
      uni.setStorageSync('backup_list', JSON.stringify(newBackups))
    } catch (error) {
      console.error('删除备份失败:', error)
      throw error
    }
  }

  /**
   * 获取备份文件内容
   * @param {string} fileName - 备份文件名
   * @returns {Object} 备份数据
   */
  getBackupData(fileName) {
    try {
      const data = uni.getStorageSync(fileName)
      return data ? JSON.parse(data) : null
    } catch (error) {
      console.error('获取备份数据失败:', error)
      return null
    }
  }

  /**
   * 格式化文件大小
   * @param {number} bytes - 字节数
   * @returns {string} 格式化后的大小
   */
  formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB'
  }

  // ========== 私有方法 ==========

  /**
   * 获取所有对话
   */
  async _getAllConversations() {
    try {
      const sql = 'SELECT * FROM conversations ORDER BY updated_at DESC'
      const result = await db.executeSql(sql, [])
      return result.rows || []
    } catch (error) {
      console.error('获取对话失败:', error)
      return []
    }
  }

  /**
   * 获取所有消息
   */
  async _getAllMessages() {
    try {
      const sql = 'SELECT * FROM messages ORDER BY timestamp ASC LIMIT 10000'
      const result = await db.executeSql(sql, [])
      return result.rows || []
    } catch (error) {
      console.error('获取消息失败:', error)
      return []
    }
  }

  /**
   * 获取所有评论
   */
  async _getAllComments() {
    try {
      const sql = 'SELECT * FROM post_comments ORDER BY created_at ASC'
      const result = await db.executeSql(sql, [])
      return result.rows || []
    } catch (error) {
      console.error('获取评论失败:', error)
      return []
    }
  }

  /**
   * 获取用户设置
   */
  _getUserSettings() {
    try {
      return {
        theme: uni.getStorageSync('app_theme'),
        userProfile: uni.getStorageSync('user_profile'),
        notificationSettings: uni.getStorageSync('notification_settings'),
        privacySettings: uni.getStorageSync('privacy_settings'),
        llmConfig: uni.getStorageSync('llm_config')
      }
    } catch (error) {
      console.error('获取用户设置失败:', error)
      return {}
    }
  }

  /**
   * 恢复用户设置
   */
  _restoreUserSettings(settings) {
    try {
      if (settings.theme) {
        uni.setStorageSync('app_theme', settings.theme)
      }
      if (settings.userProfile) {
        uni.setStorageSync('user_profile', settings.userProfile)
      }
      if (settings.notificationSettings) {
        uni.setStorageSync('notification_settings', settings.notificationSettings)
      }
      if (settings.privacySettings) {
        uni.setStorageSync('privacy_settings', settings.privacySettings)
      }
      if (settings.llmConfig) {
        uni.setStorageSync('llm_config', settings.llmConfig)
      }
    } catch (error) {
      console.error('恢复用户设置失败:', error)
    }
  }

  /**
   * 清空所有数据
   */
  async _clearAllData() {
    try {
      // 清空数据库表
      await db.executeSql('DELETE FROM knowledge_items', [])
      await db.executeSql('DELETE FROM friendships', [])
      await db.executeSql('DELETE FROM conversations', [])
      await db.executeSql('DELETE FROM messages', [])
      await db.executeSql('DELETE FROM posts', [])
      await db.executeSql('DELETE FROM post_likes', [])
      await db.executeSql('DELETE FROM post_comments', [])
      await db.executeSql('DELETE FROM transactions', [])
      await db.executeSql('DELETE FROM orders', [])
      await db.executeSql('DELETE FROM market_listings', [])

      console.log('数据已清空')
    } catch (error) {
      console.error('清空数据失败:', error)
      throw error
    }
  }

  /**
   * 导入好友
   */
  async _importFriend(friend) {
    try {
      const sql = `INSERT OR REPLACE INTO friendships
        (user_did, friend_did, nickname, group_name, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`

      await db.executeSql(sql, [
        friend.user_did,
        friend.friend_did,
        friend.nickname,
        friend.group_name,
        friend.status,
        friend.created_at,
        friend.updated_at || Date.now()
      ])
    } catch (error) {
      console.error('导入好友失败:', error)
    }
  }

  /**
   * 导入对话
   */
  async _importConversation(conv) {
    try {
      const sql = `INSERT OR REPLACE INTO conversations
        (id, participant_did, last_message, last_message_time, unread_count, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`

      await db.executeSql(sql, [
        conv.id,
        conv.participant_did,
        conv.last_message,
        conv.last_message_time,
        conv.unread_count,
        conv.created_at,
        conv.updated_at
      ])
    } catch (error) {
      console.error('导入对话失败:', error)
    }
  }

  /**
   * 导入消息
   */
  async _importMessage(msg) {
    try {
      const sql = `INSERT OR REPLACE INTO messages
        (id, conversation_id, sender_did, receiver_did, content, type, timestamp, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`

      await db.executeSql(sql, [
        msg.id,
        msg.conversation_id,
        msg.sender_did,
        msg.receiver_did,
        msg.content,
        msg.type,
        msg.timestamp,
        msg.status
      ])
    } catch (error) {
      console.error('导入消息失败:', error)
    }
  }

  /**
   * 导入动态
   */
  async _importPost(post) {
    try {
      const sql = `INSERT OR REPLACE INTO posts
        (id, author_did, content, visibility, like_count, comment_count, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`

      await db.executeSql(sql, [
        post.id,
        post.author_did,
        post.content,
        post.visibility,
        post.like_count,
        post.comment_count,
        post.created_at
      ])
    } catch (error) {
      console.error('导入动态失败:', error)
    }
  }

  /**
   * 导入评论
   */
  async _importComment(comment) {
    try {
      const sql = `INSERT OR REPLACE INTO post_comments
        (id, post_id, author_did, content, created_at)
        VALUES (?, ?, ?, ?, ?)`

      await db.executeSql(sql, [
        comment.id,
        comment.post_id,
        comment.author_did,
        comment.content,
        comment.created_at
      ])
    } catch (error) {
      console.error('导入评论失败:', error)
    }
  }
}

// 导出单例
export const backup = new BackupService()
