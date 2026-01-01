/**
 * 加密密钥管理服务
 *
 * 用于管理PIN修改后的数据重新加密
 */
import database from './database'
import authService from './auth'

class EncryptionManager {
  constructor() {
    this.progressCallback = null
  }

  /**
   * 重新加密所有已加密的知识库内容
   * @param {string} oldMasterKey - 旧主密钥
   * @param {string} newMasterKey - 新主密钥
   * @returns {Promise<Object>} 重新加密结果统计
   */
  async reencryptAllData(oldMasterKey, newMasterKey) {
    const stats = {
      knowledge: { total: 0, success: 0, failed: 0 },
      identities: { total: 0, success: 0, failed: 0 },
      total: 0,
      success: 0,
      failed: 0
    }

    try {
      // 1. 重新加密知识库内容
      await this._reencryptKnowledge(oldMasterKey, newMasterKey, stats)

      // 2. 重新加密DID身份私钥
      await this._reencryptIdentities(oldMasterKey, newMasterKey, stats)

      // 汇总统计
      stats.total = stats.knowledge.total + stats.identities.total
      stats.success = stats.knowledge.success + stats.identities.success
      stats.failed = stats.knowledge.failed + stats.identities.failed

      console.log('重新加密完成:', stats)
      return stats
    } catch (error) {
      console.error('重新加密失败:', error)
      throw error
    }
  }

  /**
   * 重新加密知识库内容
   * @private
   */
  async _reencryptKnowledge(oldMasterKey, newMasterKey, stats) {
    try {
      // 获取所有知识项
      const items = await database.getKnowledgeItems({ limit: 10000 })

      if (!items || items.length === 0) {
        return
      }

      this._updateProgress('正在重新加密知识库...', 0, items.length)

      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        stats.knowledge.total++

        // 检查是否为加密内容
        if (item.content && item.content.startsWith('ENC:')) {
          try {
            // 去掉前缀
            const encryptedContent = item.content.substring(4)

            // 用旧密钥解密
            const decryptedContent = authService.decrypt(encryptedContent, oldMasterKey)

            // 用新密钥加密
            const reencryptedContent = authService.encrypt(decryptedContent, newMasterKey)

            // 更新数据库
            await database.updateKnowledgeItem(item.id, {
              content: 'ENC:' + reencryptedContent
            })

            stats.knowledge.success++
          } catch (error) {
            console.error(`重新加密知识项 ${item.id} 失败:`, error)
            stats.knowledge.failed++
          }
        }

        this._updateProgress('正在重新加密知识库...', i + 1, items.length)
      }
    } catch (error) {
      console.error('重新加密知识库失败:', error)
      throw error
    }
  }

  /**
   * 重新加密DID身份私钥
   * @private
   */
  async _reencryptIdentities(oldMasterKey, newMasterKey, stats) {
    try {
      // 获取所有身份
      const identities = await database.getAllIdentities()

      if (!identities || identities.length === 0) {
        return
      }

      this._updateProgress('正在重新加密DID身份...', 0, identities.length)

      for (let i = 0; i < identities.length; i++) {
        const identity = identities[i]
        stats.identities.total++

        try {
          // 解密私钥（假设存储格式是加密的JSON字符串）
          const encryptedPrivateKey = identity.private_key_encrypted

          // 用旧密钥解密
          const decryptedPrivateKey = authService.decrypt(encryptedPrivateKey, oldMasterKey)

          // 用新密钥加密
          const reencryptedPrivateKey = authService.encrypt(decryptedPrivateKey, newMasterKey)

          // 更新数据库
          await database.updateIdentity(identity.did, {
            private_key_encrypted: reencryptedPrivateKey
          })

          stats.identities.success++
        } catch (error) {
          console.error(`重新加密身份 ${identity.did} 失败:`, error)
          stats.identities.failed++
        }

        this._updateProgress('正在重新加密DID身份...', i + 1, identities.length)
      }
    } catch (error) {
      console.error('重新加密DID身份失败:', error)
      throw error
    }
  }

  /**
   * 扫描加密数据
   * 返回所有已加密数据的统计信息
   * @returns {Promise<Object>}
   */
  async scanEncryptedData() {
    const result = {
      knowledge: { total: 0, encrypted: 0 },
      identities: { total: 0, encrypted: 0 },
      totalEncrypted: 0
    }

    try {
      // 扫描知识库
      const items = await database.getKnowledgeItems({ limit: 10000 })
      result.knowledge.total = items.length
      result.knowledge.encrypted = items.filter(item =>
        item.content && item.content.startsWith('ENC:')
      ).length

      // 扫描身份
      const identities = await database.getAllIdentities()
      result.identities.total = identities.length
      result.identities.encrypted = identities.length // 所有身份私钥都应该加密

      result.totalEncrypted = result.knowledge.encrypted + result.identities.encrypted

      return result
    } catch (error) {
      console.error('扫描加密数据失败:', error)
      throw error
    }
  }

  /**
   * 设置进度回调
   * @param {Function} callback - 回调函数 (message, current, total) => void
   */
  setProgressCallback(callback) {
    this.progressCallback = callback
  }

  /**
   * 更新进度
   * @private
   */
  _updateProgress(message, current, total) {
    if (this.progressCallback) {
      this.progressCallback(message, current, total)
    }
  }

  /**
   * 批量解密知识库内容（用于导出或迁移）
   * @param {string} masterKey - 主密钥
   * @returns {Promise<Array>} 解密后的知识项列表
   */
  async decryptAllKnowledge(masterKey) {
    try {
      const items = await database.getKnowledgeItems({ limit: 10000 })
      const decryptedItems = []

      for (const item of items) {
        if (item.content && item.content.startsWith('ENC:')) {
          try {
            const encryptedContent = item.content.substring(4)
            const decryptedContent = authService.decrypt(encryptedContent, masterKey)

            decryptedItems.push({
              ...item,
              content: decryptedContent,
              wasEncrypted: true
            })
          } catch (error) {
            console.error(`解密知识项 ${item.id} 失败:`, error)
            decryptedItems.push({
              ...item,
              decryptError: true
            })
          }
        } else {
          decryptedItems.push({
            ...item,
            wasEncrypted: false
          })
        }
      }

      return decryptedItems
    } catch (error) {
      console.error('批量解密失败:', error)
      throw error
    }
  }

  /**
   * 批量加密知识库内容
   * @param {Array} items - 知识项列表
   * @param {string} masterKey - 主密钥
   * @returns {Promise<Object>} 加密结果统计
   */
  async encryptAllKnowledge(items, masterKey) {
    const stats = { total: 0, success: 0, failed: 0 }

    try {
      for (const item of items) {
        stats.total++

        try {
          // 加密内容
          const encryptedContent = authService.encrypt(item.content, masterKey)

          // 更新数据库
          await database.updateKnowledgeItem(item.id, {
            content: 'ENC:' + encryptedContent
          })

          stats.success++
        } catch (error) {
          console.error(`加密知识项 ${item.id} 失败:`, error)
          stats.failed++
        }
      }

      return stats
    } catch (error) {
      console.error('批量加密失败:', error)
      throw error
    }
  }
}

// 导出单例
export default new EncryptionManager()
