/**
 * 端到端加密消息服务
 *
 * 功能：
 * - 端到端加密（E2EE）消息发送和接收
 * - 使用X25519密钥协商 + AES加密
 * - 消息历史管理
 * - 消息状态追踪（发送中、已送达、已读）
 */

import database from './database'
import didService from './did'
import friendService from './friends'
import websocketService from './websocket'
import nacl from 'tweetnacl-util'
import { encodeBase64, decodeBase64 } from 'tweetnacl-util'

class MessagingService {
  constructor() {
    this.conversations = []
    this.messageListeners = []
    this.currentDid = null
    this.realtimeHandlersRegistered = false
    this._handleRealtimeIncomingMessage = null
    this._handleRealtimeStatusUpdate = null
  }

  /**
   * 初始化消息服务
   */
  async init() {
    try {
      // 确保数据库已初始化
      if (!database.isOpen) {
        console.log('[MessagingService] 数据库未初始化，尝试初始化...')
        await database.initWithoutPin()
      }

      await this.loadConversations()
      console.log('消息服务初始化完成')

      await this._setupRealtimeChannel()
    } catch (error) {
      console.error('消息服务初始化失败:', error)
      throw error
    }
  }

  /**
   * 发送消息
   * @param {string} recipientDid - 接收方DID
   * @param {Object} message - 消息内容
   * @returns {Promise<Object>}
   */
  async sendMessage(recipientDid, message) {
    try {
      // 获取当前用户身份
      const currentIdentity = await didService.getCurrentIdentity()
      if (!currentIdentity) {
        throw new Error('请先创建DID身份')
      }

      // 验证是否为好友
      const friend = await database.getFriendByDid(recipientDid)
      if (!friend) {
        throw new Error('只能向好友发送消息')
      }

      // 获取接收方的DID文档（包含公钥）
      const recipientDidDoc = await didService.resolveDID(recipientDid)
      if (!recipientDidDoc) {
        throw new Error('无法获取接收方DID文档')
      }

      // 提取接收方的X25519公钥
      const recipientPublicKey = this._extractX25519PublicKey(recipientDidDoc)
      if (!recipientPublicKey) {
        throw new Error('接收方没有X25519公钥')
      }

      // 获取发送方的X25519私钥
      const senderPrivateKey = await this._getSenderX25519PrivateKey(currentIdentity)

      // 加密消息内容
      const encryptedContent = await this._encryptMessage(
        message.content,
        senderPrivateKey,
        recipientPublicKey
      )

      // 创建消息记录
      const messageRecord = {
        id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        conversationId: this._getConversationId(currentIdentity.did, recipientDid),
        fromDid: currentIdentity.did,
        toDid: recipientDid,
        type: message.type || 'text', // text, image, file, audio, video
        content: encryptedContent,
        metadata: message.metadata || {},
        status: 'sending', // sending, sent, delivered, read, failed
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }

      // 保存到数据库
      await database.saveMessage(messageRecord)

      const realtimeResult = await this._sendThroughRealtimeChannel(messageRecord)
      if (realtimeResult?.ok) {
        await database.updateMessageStatus(messageRecord.id, 'sent')
      } else if (realtimeResult?.queued) {
        console.log('[MessagingService] 消息已加入实时发送队列')
      } else if (realtimeResult?.skipped) {
        await this._simulateMessageSent(messageRecord.id)
      }

      // 更新会话
      await this._updateConversation(messageRecord)

      // 通知监听器
      this._notifyListeners('message:sent', messageRecord)

      return {
        success: true,
        messageId: messageRecord.id
      }
    } catch (error) {
      console.error('发送消息失败:', error)
      throw error
    }
  }

  /**
   * 接收消息（由WebSocket触发）
   * @param {Object} encryptedMessage - 加密的消息
   */
  async receiveMessage(encryptedMessage) {
    try {
      // 获取当前用户身份
      const currentIdentity = await didService.getCurrentIdentity()
      const toDid = encryptedMessage.toDid || currentIdentity?.did

      // 解密消息
      const senderDidDoc = await didService.resolveDID(encryptedMessage.fromDid)
      const senderPublicKey = this._extractX25519PublicKey(senderDidDoc)
      const recipientPrivateKey = await this._getSenderX25519PrivateKey(currentIdentity)

      const decryptedContent = await this._decryptMessage(
        encryptedMessage.content,
        recipientPrivateKey,
        senderPublicKey
      )

      const createdAt = encryptedMessage.createdAt || new Date().toISOString()

      // 保存消息
      const messageRecord = {
        ...encryptedMessage,
        toDid,
        createdAt,
        updatedAt: encryptedMessage.updatedAt || createdAt,
        conversationId: encryptedMessage.conversationId || this._getConversationId(encryptedMessage.fromDid, toDid),
        status: 'delivered',
        decryptedContent: decryptedContent,
        metadata: encryptedMessage.metadata || {}
      }

      await database.saveMessage(messageRecord)

      // 更新会话
      await this._updateConversation(messageRecord)

      // 发送送达回执
      await this._sendDeliveryReceipt(messageRecord)

      // 通知监听器
      this._notifyListeners('message:received', messageRecord)

      return messageRecord
    } catch (error) {
      console.error('接收消息失败:', error)
      throw error
    }
  }

  /**
   * 获取会话列表
   * @returns {Promise<Array>}
   */
  async getConversations() {
    try {
      await this.loadConversations()
      return [...this.conversations]
    } catch (error) {
      console.error('获取会话列表失败:', error)
      return []
    }
  }

  /**
   * 获取会话消息
   * @param {string} conversationId - 会话ID
   * @param {Object} options - 查询选项
   * @returns {Promise<Array>}
   */
  async getMessages(conversationId, options = {}) {
    try {
      const { limit = 50, offset = 0 } = options

      const messages = await database.getConversationMessages(conversationId, {
        limit,
        offset
      })

      // 解密消息内容
      for (const message of messages) {
        if (message.content && !message.decryptedContent) {
          try {
            message.decryptedContent = await this._decryptMessageRecord(message)
          } catch (error) {
            console.error(`解密消息 ${message.id} 失败:`, error)
            message.decryptedContent = '[解密失败]'
          }
        }
      }

      return messages
    } catch (error) {
      console.error('获取会话消息失败:', error)
      return []
    }
  }

  /**
   * 标记消息为已读
   * @param {string} conversationId - 会话ID
   */
  async markAsRead(conversationId) {
    try {
      const currentIdentity = await didService.getCurrentIdentity()

      await database.markConversationAsRead(conversationId)

      if (currentIdentity) {
        const unreadMessageIds = await database.getUnreadMessages(conversationId, currentIdentity.did)
        if (unreadMessageIds.length > 0) {
          await Promise.all(
            unreadMessageIds.map(messageId => database.updateMessageStatus(messageId, 'read'))
          )
          await this._sendReadReceipt(conversationId, unreadMessageIds, currentIdentity.did)
        }
      }

      // 通知监听器
      this._notifyListeners('conversation:read', { conversationId })
    } catch (error) {
      console.error('标记已读失败:', error)
    }
  }

  /**
   * 删除会话
   * @param {string} conversationId - 会话ID
   */
  async deleteConversation(conversationId) {
    try {
      await database.deleteConversation(conversationId)

      // 重新加载会话列表
      await this.loadConversations()

      // 通知监听器
      this._notifyListeners('conversation:deleted', { conversationId })
    } catch (error) {
      console.error('删除会话失败:', error)
      throw error
    }
  }

  /**
   * 添加消息监听器
   * @param {Function} listener - 监听函数
   */
  addMessageListener(listener) {
    this.messageListeners.push(listener)
  }

  /**
   * 移除消息监听器
   * @param {Function} listener - 监听函数
   */
  removeMessageListener(listener) {
    const index = this.messageListeners.indexOf(listener)
    if (index > -1) {
      this.messageListeners.splice(index, 1)
    }
  }

  /**
   * 加载会话列表
   * @private
   */
  async loadConversations() {
    try {
      const currentIdentity = await didService.getCurrentIdentity()
      if (!currentIdentity) {
        this.conversations = []
        return
      }

      this.conversations = await database.getConversations(currentIdentity.did)

      // 为每个会话获取好友信息
      for (const conv of this.conversations) {
        const friendDid = conv.participants.find(p => p !== currentIdentity.did)
        if (friendDid) {
          const friend = await database.getFriendByDid(friendDid)
          conv.friendInfo = friend || { friendDid }
        }
      }
    } catch (error) {
      console.error('加载会话列表失败:', error)
      this.conversations = []
    }
  }

  /**
   * 加密消息
   * @private
   * @param {string} content - 消息内容
   * @param {Uint8Array} senderPrivateKey - 发送方私钥
   * @param {Uint8Array} recipientPublicKey - 接收方公钥
   * @returns {Promise<string>}
   */
  async _encryptMessage(content, senderPrivateKey, recipientPublicKey) {
    try {
      // 使用X25519密钥协商生成共享密钥
      const sharedSecret = nacl.box.before(recipientPublicKey, senderPrivateKey)

      // 生成随机nonce
      const nonce = nacl.randomBytes(nacl.box.nonceLength)

      // 加密内容
      const messageBytes = nacl.decodeUTF8(content)
      const encrypted = nacl.box.after(messageBytes, nonce, sharedSecret)

      // 组合nonce和密文
      const combined = new Uint8Array(nonce.length + encrypted.length)
      combined.set(nonce)
      combined.set(encrypted, nonce.length)

      // 返回Base64编码
      return encodeBase64(combined)
    } catch (error) {
      console.error('加密消息失败:', error)
      throw error
    }
  }

  /**
   * 解密消息
   * @private
   * @param {string} encryptedContent - 加密内容（Base64）
   * @param {Uint8Array} recipientPrivateKey - 接收方私钥
   * @param {Uint8Array} senderPublicKey - 发送方公钥
   * @returns {Promise<string>}
   */
  async _decryptMessage(encryptedContent, recipientPrivateKey, senderPublicKey) {
    try {
      // 解码Base64
      const combined = decodeBase64(encryptedContent)

      // 分离nonce和密文
      const nonce = combined.slice(0, nacl.box.nonceLength)
      const encrypted = combined.slice(nacl.box.nonceLength)

      // 使用X25519密钥协商生成共享密钥
      const sharedSecret = nacl.box.before(senderPublicKey, recipientPrivateKey)

      // 解密
      const decrypted = nacl.box.open.after(encrypted, nonce, sharedSecret)

      if (!decrypted) {
        throw new Error('解密失败')
      }

      // 返回UTF-8字符串
      return nacl.encodeUTF8(decrypted)
    } catch (error) {
      console.error('解密消息失败:', error)
      throw error
    }
  }

  /**
   * 解密消息记录
   * @private
   */
  async _decryptMessageRecord(message) {
    try {
      const currentIdentity = await didService.getCurrentIdentity()

      // 确定发送方和接收方
      const isOutgoing = message.fromDid === currentIdentity.did
      const otherDid = isOutgoing ? message.toDid : message.fromDid

      // 获取密钥
      const otherDidDoc = await didService.resolveDID(otherDid)
      const otherPublicKey = this._extractX25519PublicKey(otherDidDoc)
      const currentPrivateKey = await this._getSenderX25519PrivateKey(currentIdentity)

      // 解密
      return await this._decryptMessage(
        message.content,
        currentPrivateKey,
        otherPublicKey
      )
    } catch (error) {
      console.error('解密消息记录失败:', error)
      throw error
    }
  }

  /**
   * 提取X25519公钥
   * @private
   */
  _extractX25519PublicKey(didDocument) {
    if (!didDocument || !didDocument.verificationMethod) {
      return null
    }

    // 查找X25519密钥
    const x25519Method = didDocument.verificationMethod.find(
      vm => vm.type === 'X25519KeyAgreementKey2019'
    )

    if (!x25519Method || !x25519Method.publicKeyBase58) {
      return null
    }

    // 解码Base58公钥
    return didService.base58Decode(x25519Method.publicKeyBase58)
  }

  /**
   * 获取发送方X25519私钥
   * @private
   */
  async _getSenderX25519PrivateKey(identity) {
    // 从加密的私钥中提取X25519私钥
    // 这里需要从identity.private_key_encrypted中解密
    // 简化处理：假设私钥已经在内存中
    const keyPair = await didService.getKeyPair(identity.did)
    return keyPair.encryptionKeyPair.secretKey
  }

  /**
   * 获取会话ID
   * @private
   */
  _getConversationId(did1, did2) {
    // 确保会话ID对于同一对用户是唯一的
    const dids = [did1, did2].sort()
    return `conv_${dids[0]}_${dids[1]}`
  }

  /**
   * 更新会话
   * @private
   */
  async _updateConversation(message) {
    try {
      const conversationId = message.conversationId

      const conversation = {
        id: conversationId,
        participants: [message.fromDid, message.toDid],
        lastMessage: message.content,
        lastMessageAt: message.createdAt,
        unreadCount: 0
      }

      await database.saveConversation(conversation)
      await this.loadConversations()
    } catch (error) {
      console.error('更新会话失败:', error)
    }
  }

  /**
   * 模拟消息发送成功（WebSocket实现前的临时方案）
   * @private
   */
  async _simulateMessageSent(messageId) {
    // 模拟网络延迟
    await new Promise(resolve => setTimeout(resolve, 500))

    // 更新消息状态
    await database.updateMessageStatus(messageId, 'sent')
  }

  /**
   * 通过实时通道发送消息
   * @private
   */
  async _sendThroughRealtimeChannel(messageRecord) {
    try {
      await this._setupRealtimeChannel()

      const payload = {
        messageId: messageRecord.id,
        fromDid: messageRecord.fromDid,
        toDid: messageRecord.toDid,
        type: messageRecord.type,
        content: messageRecord.content,
        metadata: messageRecord.metadata || {},
        createdAt: messageRecord.createdAt,
        conversationId: messageRecord.conversationId
      }

      return await websocketService.send('message:send', payload)
    } catch (error) {
      console.error('通过实时通道发送消息失败:', error)
      return { ok: false, error }
    }
  }

  /**
   * 发送送达回执
   * @private
   */
  async _sendDeliveryReceipt(messageRecord) {
    if (!messageRecord?.id) {
      return
    }

    try {
      await websocketService.send('message:delivered', {
        messageId: messageRecord.id,
        conversationId: messageRecord.conversationId,
        fromDid: messageRecord.fromDid,
        toDid: messageRecord.toDid,
        deliveredBy: messageRecord.toDid,
        createdAt: messageRecord.createdAt
      })
    } catch (error) {
      console.error('发送送达回执失败:', error)
    }
  }

  /**
   * 发送已读回执
   * @private
   */
  async _sendReadReceipt(conversationId, messageIds = [], readerDid = null) {
    if (!messageIds || messageIds.length === 0) {
      return
    }

    try {
      await websocketService.send('message:read', {
        conversationId,
        messageIds,
        readerDid
      })
    } catch (error) {
      console.error('发送已读回执失败:', error)
    }
  }

  /**
   * 通知监听器
   * @private
   */
  _notifyListeners(event, data) {
    for (const listener of this.messageListeners) {
      try {
        listener(event, data)
      } catch (error) {
        console.error('消息监听器错误:', error)
      }
    }
  }

  /**
   * 搜索消息
   * @param {string} query - 搜索关键词
   * @param {Object} options - 搜索选项
   * @returns {Promise<Array>}
   */
  async searchMessages(query, options = {}) {
    try {
      const messages = await database.searchMessages(query, options)

      // 解密搜索结果
      for (const message of messages) {
        if (message.content && !message.decryptedContent) {
          try {
            message.decryptedContent = await this._decryptMessageRecord(message)
          } catch (error) {
            message.decryptedContent = '[解密失败]'
          }
        }
      }

      // 过滤匹配的消息
      return messages.filter(msg =>
        msg.decryptedContent && msg.decryptedContent.includes(query)
      )
    } catch (error) {
      console.error('搜索消息失败:', error)
      return []
    }
  }

  /**
   * 初始化实时消息通道
   * @private
   */
  async _setupRealtimeChannel() {
    try {
      const identity = await didService.getCurrentIdentity()
      if (!identity) {
        return
      }

      this.currentDid = identity.did
      await websocketService.ensureConnection({ did: identity.did })

      if (this.realtimeHandlersRegistered) {
        return
      }

      this._handleRealtimeIncomingMessage = async (payload = {}) => {
        if (!payload.fromDid || !payload.toDid || !payload.content) {
          return
        }

        const normalized = {
          id: payload.messageId || payload.id || `msg_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
          fromDid: payload.fromDid,
          toDid: payload.toDid,
          type: payload.type || 'text',
          content: payload.content,
          metadata: payload.metadata || {},
          conversationId: payload.conversationId || this._getConversationId(payload.fromDid, payload.toDid),
          createdAt: payload.createdAt || new Date().toISOString(),
          updatedAt: payload.updatedAt || payload.createdAt || new Date().toISOString()
        }

        await this.receiveMessage(normalized)
      }

      this._handleRealtimeStatusUpdate = async (payload = {}) => {
        if (!payload.messageId) {
          return
        }

        const status = payload.status || (payload.type === 'message:read' ? 'read' : 'delivered')
        await database.updateMessageStatus(payload.messageId, status)
        this._notifyListeners('message:status', {
          messageId: payload.messageId,
          status
        })
      }

      websocketService.on('message:incoming', this._handleRealtimeIncomingMessage)
      websocketService.on('message:delivered', this._handleRealtimeStatusUpdate)
      websocketService.on('message:read', this._handleRealtimeStatusUpdate)

      this.realtimeHandlersRegistered = true
    } catch (error) {
      console.error('[MessagingService] 初始化实时通道失败:', error)
    }
  }
}

// 导出单例
export default new MessagingService()
