/**
 * P2P端到端加密消息服务 (完整版)
 *
 * 集成P2P网络 + Signal协议，实现真正的端到端加密消息传输
 * 功能对齐桌面端
 *
 * 核心功能：
 * - P2P直连通信（WebRTC）
 * - Signal协议端到端加密
 * - 离线消息队列
 * - 消息状态同步
 * - 会话管理
 */

import { getP2PManager } from './p2p-manager.js'
import SignalSessionManager from './signal-session-manager.js'
import { db as database } from '../database.js'
import didService from '../did.js'

class P2PMessagingService {
  constructor() {
    this.p2pManager = null
    this.signalManager = null
    this.currentDid = null
    this.messageListeners = []
    this.initialized = false
  }

  /**
   * 初始化P2P消息服务
   */
  async initialize(did, config = {}) {
    console.log('[P2PMessaging] 初始化P2P消息服务...', did)

    try {
      if (this.initialized) {
        console.warn('[P2PMessaging] 服务已初始化')
        return
      }

      this.currentDid = did

      // 1. 初始化Signal会话管理器
      this.signalManager = new SignalSessionManager(database, {
        userId: did,
        deviceId: config.deviceId || 1
      })
      await this.signalManager.initialize()

      // 2. 初始化P2P管理器
      this.p2pManager = getP2PManager(config.p2p)
      await this.p2pManager.initialize(did)

      // 3. 注册P2P消息处理器
      this.setupP2PHandlers()

      this.initialized = true

      console.log('[P2PMessaging] ✅ P2P消息服务已初始化')
    } catch (error) {
      console.error('[P2PMessaging] ❌ 初始化失败:', error)
      throw error
    }
  }

  /**
   * 设置P2P消息处理器
   */
  setupP2PHandlers() {
    // 处理Signal会话建立请求
    this.p2pManager.onMessage('signal:pre-key-request', async (peerId, message) => {
      console.log('[P2PMessaging] 收到PreKey请求:', peerId)
      const preKeyBundle = await this.signalManager.getPreKeyBundle()

      // 发送PreKey Bundle回复
      await this.p2pManager.sendMessage(peerId, {
        type: 'signal:pre-key-response',
        preKeyBundle
      })
    })

    // 处理Signal会话建立响应
    this.p2pManager.onMessage('signal:pre-key-response', async (peerId, message) => {
      console.log('[P2PMessaging] 收到PreKey响应:', peerId)

      // 建立Signal会话
      await this.signalManager.buildSession(peerId, message.preKeyBundle)

      // 触发会话建立完成事件
      this.notifyListeners('session:established', { peerId })
    })

    // 处理加密消息
    this.p2pManager.onMessage('message:encrypted', async (peerId, message) => {
      console.log('[P2PMessaging] 收到加密消息:', peerId)
      await this.handleIncomingMessage(peerId, message)
    })

    // 处理消息送达确认
    this.p2pManager.onMessage('message:ack', async (peerId, message) => {
      console.log('[P2PMessaging] 收到消息确认:', message.messageId)
      await this.handleMessageAck(message.messageId, 'delivered')
    })

    // 处理消息已读回执
    this.p2pManager.onMessage('message:read', async (peerId, message) => {
      console.log('[P2PMessaging] 收到已读回执:', message.messageIds)
      for (const messageId of message.messageIds) {
        await this.handleMessageAck(messageId, 'read')
      }
    })

    // 监听P2P连接事件
    this.p2pManager.on('peer:connected', (peerId) => {
      console.log('[P2PMessaging] 节点已连接:', peerId)
      this.notifyListeners('peer:connected', { peerId })

      // 检查是否有会话，没有则请求建立
      if (!this.signalManager.getSession(peerId)) {
        this.requestPreKeyBundle(peerId)
      }
    })

    this.p2pManager.on('peer:disconnected', (peerId) => {
      console.log('[P2PMessaging] 节点已断开:', peerId)
      this.notifyListeners('peer:disconnected', { peerId })
    })
  }

  /**
   * 请求PreKey Bundle（建立Signal会话）
   */
  async requestPreKeyBundle(peerId) {
    console.log('[P2PMessaging] 请求PreKey Bundle:', peerId)

    try {
      await this.p2pManager.sendMessage(peerId, {
        type: 'signal:pre-key-request',
        from: this.currentDid
      })
    } catch (error) {
      console.error('[P2PMessaging] 请求PreKey Bundle失败:', error)
    }
  }

  /**
   * 发送消息
   * @param {string} recipientDid - 接收方DID
   * @param {Object} messageContent - 消息内容
   */
  async sendMessage(recipientDid, messageContent) {
    console.log('[P2PMessaging] 发送消息:', recipientDid)

    try {
      // 1. 检查是否为好友
      const friend = await database.getFriendByDid(recipientDid)
      if (!friend) {
        throw new Error('只能向好友发送消息')
      }

      // 2. 检查Signal会话是否存在
      let session = this.signalManager.getSession(recipientDid)
      if (!session) {
        console.log('[P2PMessaging] Signal会话不存在，请求建立...')
        await this.requestPreKeyBundle(recipientDid)

        // 等待会话建立（最多5秒）
        session = await this.waitForSession(recipientDid, 5000)
        if (!session) {
          throw new Error('无法建立Signal会话')
        }
      }

      // 3. 使用Signal协议加密消息
      const encryptedMessage = await this.signalManager.encryptMessage(
        recipientDid,
        messageContent
      )

      // 4. 创建消息记录
      const messageRecord = {
        id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        conversationId: this.getConversationId(this.currentDid, recipientDid),
        fromDid: this.currentDid,
        toDid: recipientDid,
        type: messageContent.type || 'text',
        content: JSON.stringify(encryptedMessage), // 存储加密后的消息
        plaintext: messageContent.content, // 明文（本地解密后）
        metadata: messageContent.metadata || {},
        status: 'sending',
        createdAt: Date.now(),
        updatedAt: Date.now()
      }

      // 5. 保存到本地数据库
      await database.exec(`
        INSERT INTO p2p_messages (
          id, conversation_id, from_did, to_did, type, content, plaintext,
          metadata, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        messageRecord.id,
        messageRecord.conversationId,
        messageRecord.fromDid,
        messageRecord.toDid,
        messageRecord.type,
        messageRecord.content,
        messageRecord.plaintext,
        JSON.stringify(messageRecord.metadata),
        messageRecord.status,
        messageRecord.createdAt,
        messageRecord.updatedAt
      ])

      // 6. 通过P2P发送加密消息
      const sent = await this.p2pManager.sendMessage(recipientDid, {
        type: 'message:encrypted',
        messageId: messageRecord.id,
        from: this.currentDid,
        encryptedMessage
      })

      // 7. 更新消息状态
      if (sent) {
        await this.updateMessageStatus(messageRecord.id, 'sent')
        messageRecord.status = 'sent'
      } else {
        console.warn('[P2PMessaging] 消息加入离线队列')
      }

      // 8. 更新会话
      await this.updateConversation(messageRecord)

      // 9. 通知监听器
      this.notifyListeners('message:sent', messageRecord)

      return {
        success: true,
        messageId: messageRecord.id,
        status: messageRecord.status
      }
    } catch (error) {
      console.error('[P2PMessaging] 发送消息失败:', error)
      throw error
    }
  }

  /**
   * 处理收到的加密消息
   */
  async handleIncomingMessage(peerId, message) {
    console.log('[P2PMessaging] 处理收到的消息:', message.messageId)

    try {
      // 1. 检查会话
      const session = this.signalManager.getSession(peerId)
      if (!session) {
        console.error('[P2PMessaging] Signal会话不存在:', peerId)
        return
      }

      // 2. 使用Signal协议解密消息
      const decryptedContent = await this.signalManager.decryptMessage(
        peerId,
        message.encryptedMessage
      )

      // 3. 创建消息记录
      const messageRecord = {
        id: message.messageId,
        conversationId: this.getConversationId(this.currentDid, peerId),
        fromDid: peerId,
        toDid: this.currentDid,
        type: decryptedContent.type || 'text',
        content: JSON.stringify(message.encryptedMessage),
        plaintext: decryptedContent.content,
        metadata: decryptedContent.metadata || {},
        status: 'delivered',
        createdAt: Date.now(),
        updatedAt: Date.now()
      }

      // 4. 保存到数据库
      await database.exec(`
        INSERT OR REPLACE INTO p2p_messages (
          id, conversation_id, from_did, to_did, type, content, plaintext,
          metadata, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        messageRecord.id,
        messageRecord.conversationId,
        messageRecord.fromDid,
        messageRecord.toDid,
        messageRecord.type,
        messageRecord.content,
        messageRecord.plaintext,
        JSON.stringify(messageRecord.metadata),
        messageRecord.status,
        messageRecord.createdAt,
        messageRecord.updatedAt
      ])

      // 5. 发送送达确认
      await this.p2pManager.sendMessage(peerId, {
        type: 'message:ack',
        messageId: message.messageId
      })

      // 6. 更新会话
      await this.updateConversation(messageRecord)

      // 7. 通知监听器
      this.notifyListeners('message:received', messageRecord)

      console.log('[P2PMessaging] ✅ 消息已接收并解密:', message.messageId)
    } catch (error) {
      console.error('[P2PMessaging] 处理收到的消息失败:', error)
    }
  }

  /**
   * 处理消息确认
   */
  async handleMessageAck(messageId, status) {
    try {
      await this.updateMessageStatus(messageId, status)
      this.notifyListeners('message:status', { messageId, status })
    } catch (error) {
      console.error('[P2PMessaging] 处理消息确认失败:', error)
    }
  }

  /**
   * 更新消息状态
   */
  async updateMessageStatus(messageId, status) {
    await database.exec(`
      UPDATE p2p_messages
      SET status = ?, updated_at = ?
      WHERE id = ?
    `, [status, Date.now(), messageId])
  }

  /**
   * 标记消息为已读
   */
  async markMessagesAsRead(conversationId, messageIds) {
    try {
      // 1. 更新本地数据库
      for (const messageId of messageIds) {
        await this.updateMessageStatus(messageId, 'read')
      }

      // 2. 获取对方DID
      const participants = conversationId.replace('conv_', '').split('_')
      const recipientDid = participants.find(did => did !== this.currentDid)

      if (!recipientDid) return

      // 3. 发送已读回执
      await this.p2pManager.sendMessage(recipientDid, {
        type: 'message:read',
        messageIds
      })

      this.notifyListeners('messages:read', { conversationId, messageIds })
    } catch (error) {
      console.error('[P2PMessaging] 标记已读失败:', error)
    }
  }

  /**
   * 获取会话消息
   */
  async getMessages(conversationId, options = {}) {
    const { limit = 50, offset = 0 } = options

    try {
      const rows = await database.exec(`
        SELECT * FROM p2p_messages
        WHERE conversation_id = ?
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `, [conversationId, limit, offset])

      return rows.map(row => ({
        id: row.id,
        conversationId: row.conversation_id,
        fromDid: row.from_did,
        toDid: row.to_did,
        type: row.type,
        plaintext: row.plaintext, // 解密后的明文
        metadata: JSON.parse(row.metadata || '{}'),
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        isOutgoing: row.from_did === this.currentDid
      }))
    } catch (error) {
      console.error('[P2PMessaging] 获取消息失败:', error)
      return []
    }
  }

  /**
   * 获取会话列表
   */
  async getConversations() {
    try {
      // 确保表存在
      await this.ensureMessageTable()

      const rows = await database.exec(`
        SELECT
          conversation_id,
          MAX(created_at) as last_message_at,
          COUNT(*) as message_count,
          SUM(CASE WHEN status != 'read' AND from_did != ? THEN 1 ELSE 0 END) as unread_count
        FROM p2p_messages
        GROUP BY conversation_id
        ORDER BY last_message_at DESC
      `, [this.currentDid])

      const conversations = []
      for (const row of rows) {
        // 提取对方DID
        const participants = row.conversation_id.replace('conv_', '').split('_')
        const recipientDid = participants.find(did => did !== this.currentDid)

        if (!recipientDid) continue

        // 获取最后一条消息
        const lastMessage = await database.exec(`
          SELECT * FROM p2p_messages
          WHERE conversation_id = ?
          ORDER BY created_at DESC
          LIMIT 1
        `, [row.conversation_id])[0]

        // 获取好友信息
        const friend = await database.getFriendByDid(recipientDid)

        conversations.push({
          id: row.conversation_id,
          recipientDid,
          friendInfo: friend || { did: recipientDid, nickname: 'Unknown' },
          lastMessage: lastMessage?.plaintext || '',
          lastMessageAt: row.last_message_at,
          messageCount: row.message_count,
          unreadCount: row.unread_count
        })
      }

      return conversations
    } catch (error) {
      console.error('[P2PMessaging] 获取会话列表失败:', error)
      return []
    }
  }

  /**
   * 确保消息表存在
   */
  async ensureMessageTable() {
    await database.exec(`
      CREATE TABLE IF NOT EXISTS p2p_messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        from_did TEXT NOT NULL,
        to_did TEXT NOT NULL,
        type TEXT DEFAULT 'text',
        content TEXT NOT NULL,
        plaintext TEXT,
        metadata TEXT,
        status TEXT DEFAULT 'sending',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)

    // 创建索引
    await database.exec(`
      CREATE INDEX IF NOT EXISTS idx_conversation
      ON p2p_messages(conversation_id, created_at DESC)
    `)
  }

  /**
   * 更新会话
   */
  async updateConversation(messageRecord) {
    // 会话信息通过p2p_messages表的聚合查询获取
    // 无需单独的conversations表
  }

  /**
   * 获取会话ID
   */
  getConversationId(did1, did2) {
    const dids = [did1, did2].sort()
    return `conv_${dids[0]}_${dids[1]}`
  }

  /**
   * 等待会话建立
   */
  async waitForSession(peerId, timeout = 5000) {
    const startTime = Date.now()

    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        const session = this.signalManager.getSession(peerId)
        if (session) {
          clearInterval(checkInterval)
          resolve(session)
        } else if (Date.now() - startTime > timeout) {
          clearInterval(checkInterval)
          resolve(null)
        }
      }, 100)
    })
  }

  /**
   * 添加消息监听器
   */
  addListener(listener) {
    this.messageListeners.push(listener)
  }

  /**
   * 移除消息监听器
   */
  removeListener(listener) {
    const index = this.messageListeners.indexOf(listener)
    if (index > -1) {
      this.messageListeners.splice(index, 1)
    }
  }

  /**
   * 通知监听器
   */
  notifyListeners(event, data) {
    for (const listener of this.messageListeners) {
      try {
        listener(event, data)
      } catch (error) {
        console.error('[P2PMessaging] 监听器错误:', error)
      }
    }
  }

  /**
   * 连接到对等节点
   */
  async connectToPeer(peerId) {
    return this.p2pManager.connectToPeer(peerId)
  }

  /**
   * 断开节点连接
   */
  async disconnectPeer(peerId) {
    return this.p2pManager.disconnect(peerId)
  }

  /**
   * 获取在线节点
   */
  getOnlinePeers() {
    return this.p2pManager.getOnlinePeers()
  }

  /**
   * 关闭服务
   */
  async shutdown() {
    console.log('[P2PMessaging] 关闭P2P消息服务...')

    if (this.p2pManager) {
      await this.p2pManager.shutdown()
    }

    this.initialized = false
    this.messageListeners = []

    console.log('[P2PMessaging] ✅ 服务已关闭')
  }
}

// 导出单例
let p2pMessagingInstance = null

export function getP2PMessaging() {
  if (!p2pMessagingInstance) {
    p2pMessagingInstance = new P2PMessagingService()
  }
  return p2pMessagingInstance
}

export default P2PMessagingService
