/**
 * 移动端同步客户端
 *
 * 功能：
 * - 与桌面端进行数据同步
 * - 接收桌面端推送的变更
 * - 上传本地变更到桌面端
 * - 群聊消息同步
 * - 离线队列管理
 */

import { getDatabase } from '../database/database-manager'
import { getP2PManager } from '../p2p/p2p-manager'

class MobileSyncClient {
  constructor(config = {}) {
    this.config = {
      // 同步配置
      syncInterval: config.syncInterval || 60000,      // 自动同步间隔（60秒）
      batchSize: config.batchSize || 100,              // 批量同步大小
      enableAutoSync: config.enableAutoSync !== false,

      // 同步范围
      syncKnowledge: config.syncKnowledge !== false,   // 同步知识库
      syncContacts: config.syncContacts !== false,     // 同步联系人
      syncGroupChats: config.syncGroupChats !== false, // 同步群聊
      syncMessages: config.syncMessages !== false,     // 同步消息

      ...config
    }

    // 同步状态
    this.isSyncing = false
    this.lastSyncTime = {
      knowledge: 0,
      contacts: 0,
      groupChats: 0,
      messages: 0
    }

    // 桌面端设备信息
    this.desktopDevice = null // { peerId, deviceId, deviceInfo }

    // 离线队列
    this.offlineQueue = []

    // 统计信息
    this.stats = {
      totalSyncs: 0,
      knowledgeReceived: 0,
      contactsReceived: 0,
      groupChatsReceived: 0,
      messagesReceived: 0,
      knowledgeUploaded: 0,
      contactsUploaded: 0,
      groupChatsUploaded: 0,
      messagesUploaded: 0
    }

    // 事件监听器
    this.eventListeners = new Map()

    // 自动同步定时器
    this.autoSyncTimer = null

    console.log('[MobileSyncClient] 移动端同步客户端已初始化')
  }

  /**
   * 初始化同步客户端
   */
  async initialize() {
    console.log('[MobileSyncClient] 初始化同步客户端...')

    try {
      // 获取P2P管理器
      this.p2pManager = getP2PManager()

      // 注册消息处理器
      this.registerMessageHandlers()

      // 启动自动同步
      if (this.config.enableAutoSync) {
        this.startAutoSync()
      }

      console.log('[MobileSyncClient] ✅ 同步客户端初始化成功')

    } catch (error) {
      console.error('[MobileSyncClient] ❌ 同步客户端初始化失败:', error)
      throw error
    }
  }

  /**
   * 注册消息处理器
   */
  registerMessageHandlers() {
    // 处理知识库同步
    this.p2pManager.onMessage('mobile-sync:knowledge', (peerId, message) => {
      this.handleKnowledgeSync(peerId, message)
    })

    // 处理联系人同步
    this.p2pManager.onMessage('mobile-sync:contacts', (peerId, message) => {
      this.handleContactsSync(peerId, message)
    })

    // 处理群聊同步
    this.p2pManager.onMessage('mobile-sync:group-chats', (peerId, message) => {
      this.handleGroupChatsSync(peerId, message)
    })

    // 处理消息同步
    this.p2pManager.onMessage('mobile-sync:messages', (peerId, message) => {
      this.handleMessagesSync(peerId, message)
    })

    console.log('[MobileSyncClient] 消息处理器已注册')
  }

  /**
   * 连接到桌面端
   * @param {string} peerId - 桌面端P2P节点ID
   * @param {string} deviceId - 桌面端设备ID
   */
  async connectToDesktop(peerId, deviceId) {
    console.log('[MobileSyncClient] 连接到桌面端:', peerId, deviceId)

    try {
      // 保存桌面端信息
      this.desktopDevice = {
        peerId,
        deviceId,
        connectedAt: Date.now()
      }

      // 连接到桌面端
      await this.p2pManager.connectToPeer(peerId)

      // 注册移动设备
      await this.registerToDesktop()

      // 请求全量同步
      await this.requestFullSync()

      this.emit('desktop:connected', { peerId, deviceId })

      console.log('[MobileSyncClient] ✅ 已连接到桌面端')

    } catch (error) {
      console.error('[MobileSyncClient] ❌ 连接桌面端失败:', error)
      throw error
    }
  }

  /**
   * 注册到桌面端
   */
  async registerToDesktop() {
    if (!this.desktopDevice) {
      throw new Error('桌面端设备未设置')
    }

    const systemInfo = uni.getSystemInfoSync()

    await this.p2pManager.sendMessage(this.desktopDevice.peerId, {
      type: 'mobile-sync:register',
      deviceId: this.getDeviceId(),
      deviceInfo: {
        name: systemInfo.model || 'Unknown Device',
        platform: systemInfo.platform || 'unknown',
        version: '0.22.0',
        osVersion: systemInfo.system || 'unknown'
      }
    })

    console.log('[MobileSyncClient] 已注册到桌面端')
  }

  /**
   * 请求全量同步
   */
  async requestFullSync() {
    if (!this.desktopDevice) {
      throw new Error('桌面端设备未设置')
    }

    console.log('[MobileSyncClient] 请求全量同步')

    await this.p2pManager.sendMessage(this.desktopDevice.peerId, {
      type: 'mobile-sync:request',
      lastSyncTime: this.lastSyncTime
    })
  }

  /**
   * 处理知识库同步
   */
  async handleKnowledgeSync(peerId, message) {
    console.log(`[MobileSyncClient] 处理知识库同步: ${message.changes.length}条`)

    try {
      const db = await getDatabase()

      for (const change of message.changes) {
        if (change.type === 'delete') {
          await db.execute(
            'UPDATE notes SET deleted = 1, updated_at = ? WHERE id = ?',
            [change.timestamp, change.id]
          )
        } else {
          await db.execute(`
            INSERT OR REPLACE INTO notes (id, title, content, tags, category, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
          `, [
            change.id,
            change.data.title,
            change.data.content,
            change.data.tags,
            change.data.category,
            change.timestamp
          ])
        }

        this.stats.knowledgeReceived++
      }

      // 更新同步时间
      this.lastSyncTime.knowledge = message.timestamp

      // 保存到本地存储
      this.saveSyncTime()

      this.emit('sync:knowledge-received', {
        count: message.changes.length,
        batchIndex: message.batchIndex,
        totalBatches: message.totalBatches
      })

      console.log('[MobileSyncClient] ✅ 知识库同步完成')

    } catch (error) {
      console.error('[MobileSyncClient] ❌ 处理知识库同步失败:', error)
    }
  }

  /**
   * 处理联系人同步
   */
  async handleContactsSync(peerId, message) {
    console.log(`[MobileSyncClient] 处理联系人同步: ${message.changes.length}条`)

    try {
      const db = await getDatabase()

      for (const change of message.changes) {
        if (change.type === 'delete') {
          await db.execute(
            'UPDATE contacts SET deleted = 1, updated_at = ? WHERE did = ?',
            [change.timestamp, change.id]
          )
        } else {
          await db.execute(`
            INSERT OR REPLACE INTO contacts (did, nickname, avatar, status, updated_at)
            VALUES (?, ?, ?, ?, ?)
          `, [
            change.id,
            change.data.nickname,
            change.data.avatar,
            change.data.status,
            change.timestamp
          ])
        }

        this.stats.contactsReceived++
      }

      // 更新同步时间
      this.lastSyncTime.contacts = message.timestamp

      // 保存到本地存储
      this.saveSyncTime()

      this.emit('sync:contacts-received', {
        count: message.changes.length
      })

      console.log('[MobileSyncClient] ✅ 联系人同步完成')

    } catch (error) {
      console.error('[MobileSyncClient] ❌ 处理联系人同步失败:', error)
    }
  }

  /**
   * 处理群聊同步
   */
  async handleGroupChatsSync(peerId, message) {
    console.log(`[MobileSyncClient] 处理群聊同步: ${message.changes.length}条`)

    try {
      const db = await getDatabase()

      for (const change of message.changes) {
        // 更新群聊基本信息
        await db.execute(`
          INSERT OR REPLACE INTO group_chats
          (id, name, description, avatar, creator_did, member_count, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
          change.id,
          change.data.name,
          change.data.description,
          change.data.avatar,
          change.data.creator_did,
          change.data.member_count,
          change.timestamp
        ])

        // 更新群成员
        if (change.data.members) {
          for (const member of change.data.members) {
            await db.execute(`
              INSERT OR REPLACE INTO group_members
              (group_id, member_did, role, nickname, joined_at)
              VALUES (?, ?, ?, ?, ?)
            `, [
              change.id,
              member.member_did,
              member.role,
              member.nickname,
              member.joined_at
            ])
          }
        }

        this.stats.groupChatsReceived++
      }

      // 更新同步时间
      this.lastSyncTime.groupChats = message.timestamp

      // 保存到本地存储
      this.saveSyncTime()

      this.emit('sync:group-chats-received', {
        count: message.changes.length
      })

      console.log('[MobileSyncClient] ✅ 群聊同步完成')

    } catch (error) {
      console.error('[MobileSyncClient] ❌ 处理群聊同步失败:', error)
    }
  }

  /**
   * 处理消息同步
   */
  async handleMessagesSync(peerId, message) {
    console.log(`[MobileSyncClient] 处理消息同步: ${message.changes.length}条`)

    try {
      const db = await getDatabase()

      for (const change of message.changes) {
        await db.execute(`
          INSERT OR IGNORE INTO group_messages
          (id, group_id, sender_did, content, message_type, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `, [
          change.id,
          change.data.group_id,
          change.data.sender_did,
          change.data.content,
          change.data.message_type,
          change.timestamp
        ])

        this.stats.messagesReceived++
      }

      // 更新同步时间
      this.lastSyncTime.messages = message.timestamp

      // 保存到本地存储
      this.saveSyncTime()

      this.emit('sync:messages-received', {
        count: message.changes.length,
        batchIndex: message.batchIndex,
        totalBatches: message.totalBatches
      })

      console.log('[MobileSyncClient] ✅ 消息同步完成')

    } catch (error) {
      console.error('[MobileSyncClient] ❌ 处理消息同步失败:', error)
    }
  }

  /**
   * 上传本地变更
   */
  async uploadLocalChanges() {
    if (!this.desktopDevice) {
      console.warn('[MobileSyncClient] 桌面端未连接，无法上传变更')
      return
    }

    console.log('[MobileSyncClient] 上传本地变更...')

    try {
      // 1. 上传知识库变更
      if (this.config.syncKnowledge) {
        await this.uploadKnowledgeChanges()
      }

      // 2. 上传联系人变更
      if (this.config.syncContacts) {
        await this.uploadContactsChanges()
      }

      // 3. 上传群聊变更
      if (this.config.syncGroupChats) {
        await this.uploadGroupChatsChanges()
      }

      // 4. 上传消息变更
      if (this.config.syncMessages) {
        await this.uploadMessagesChanges()
      }

      console.log('[MobileSyncClient] ✅ 本地变更上传完成')

    } catch (error) {
      console.error('[MobileSyncClient] ❌ 上传本地变更失败:', error)
    }
  }

  /**
   * 上传知识库变更
   */
  async uploadKnowledgeChanges() {
    const db = await getDatabase()

    const stmt = await db.prepare(`
      SELECT id, title, content, tags, category, updated_at, deleted
      FROM notes
      WHERE updated_at > ?
      ORDER BY updated_at ASC
    `)

    const notes = await stmt.all(this.lastSyncTime.knowledge)

    if (notes.length === 0) {
      return
    }

    const changes = notes.map(note => ({
      type: note.deleted ? 'delete' : 'upsert',
      entity: 'note',
      id: note.id,
      data: note.deleted ? null : {
        title: note.title,
        content: note.content,
        tags: note.tags,
        category: note.category,
        updated_at: note.updated_at
      },
      timestamp: note.updated_at
    }))

    await this.p2pManager.sendMessage(this.desktopDevice.peerId, {
      type: 'mobile-sync:knowledge-changes',
      changes: changes
    })

    this.stats.knowledgeUploaded += changes.length

    console.log(`[MobileSyncClient] 已上传 ${changes.length} 个知识库变更`)
  }

  /**
   * 上传联系人变更
   */
  async uploadContactsChanges() {
    const db = await getDatabase()

    const stmt = await db.prepare(`
      SELECT did, nickname, avatar, status, updated_at, deleted
      FROM contacts
      WHERE updated_at > ?
      ORDER BY updated_at ASC
    `)

    const contacts = await stmt.all(this.lastSyncTime.contacts)

    if (contacts.length === 0) {
      return
    }

    const changes = contacts.map(contact => ({
      type: contact.deleted ? 'delete' : 'upsert',
      entity: 'contact',
      id: contact.did,
      data: contact.deleted ? null : {
        nickname: contact.nickname,
        avatar: contact.avatar,
        status: contact.status,
        updated_at: contact.updated_at
      },
      timestamp: contact.updated_at
    }))

    await this.p2pManager.sendMessage(this.desktopDevice.peerId, {
      type: 'mobile-sync:contacts-changes',
      changes: changes
    })

    this.stats.contactsUploaded += changes.length

    console.log(`[MobileSyncClient] 已上传 ${changes.length} 个联系人变更`)
  }

  /**
   * 上传群聊变更
   */
  async uploadGroupChatsChanges() {
    const db = await getDatabase()

    const stmt = await db.prepare(`
      SELECT id, name, description, avatar, creator_did, member_count, updated_at
      FROM group_chats
      WHERE updated_at > ?
      ORDER BY updated_at ASC
    `)

    const groups = await stmt.all(this.lastSyncTime.groupChats)

    if (groups.length === 0) {
      return
    }

    const changes = []

    for (const group of groups) {
      // 获取群成员
      const memberStmt = await db.prepare(`
        SELECT member_did, role, nickname, joined_at
        FROM group_members
        WHERE group_id = ?
      `)
      const members = await memberStmt.all(group.id)

      changes.push({
        type: 'upsert',
        entity: 'group',
        id: group.id,
        data: {
          name: group.name,
          description: group.description,
          avatar: group.avatar,
          creator_did: group.creator_did,
          member_count: group.member_count,
          members: members,
          updated_at: group.updated_at
        },
        timestamp: group.updated_at
      })
    }

    await this.p2pManager.sendMessage(this.desktopDevice.peerId, {
      type: 'mobile-sync:group-chats-changes',
      changes: changes
    })

    this.stats.groupChatsUploaded += changes.length

    console.log(`[MobileSyncClient] 已上传 ${changes.length} 个群聊变更`)
  }

  /**
   * 上传消息变更
   */
  async uploadMessagesChanges() {
    const db = await getDatabase()

    const stmt = await db.prepare(`
      SELECT id, group_id, sender_did, content, message_type, created_at
      FROM group_messages
      WHERE created_at > ?
      ORDER BY created_at ASC
    `)

    const messages = await stmt.all(this.lastSyncTime.messages)

    if (messages.length === 0) {
      return
    }

    const changes = messages.map(message => ({
      type: 'insert',
      entity: 'message',
      id: message.id,
      data: {
        group_id: message.group_id,
        sender_did: message.sender_did,
        content: message.content,
        message_type: message.message_type,
        created_at: message.created_at
      },
      timestamp: message.created_at
    }))

    await this.p2pManager.sendMessage(this.desktopDevice.peerId, {
      type: 'mobile-sync:messages-changes',
      changes: changes
    })

    this.stats.messagesUploaded += changes.length

    console.log(`[MobileSyncClient] 已上传 ${changes.length} 个消息变更`)
  }

  /**
   * 启动自动同步
   */
  startAutoSync() {
    if (this.autoSyncTimer) {
      clearInterval(this.autoSyncTimer)
    }

    this.autoSyncTimer = setInterval(async () => {
      if (this.desktopDevice && !this.isSyncing) {
        try {
          await this.uploadLocalChanges()
        } catch (error) {
          console.error('[MobileSyncClient] 自动同步失败:', error)
        }
      }
    }, this.config.syncInterval)

    console.log('[MobileSyncClient] 自动同步已启动')
  }

  /**
   * 停止自动同步
   */
  stopAutoSync() {
    if (this.autoSyncTimer) {
      clearInterval(this.autoSyncTimer)
      this.autoSyncTimer = null
      console.log('[MobileSyncClient] 自动同步已停止')
    }
  }

  /**
   * 保存同步时间
   */
  saveSyncTime() {
    try {
      uni.setStorageSync('mobile_sync_time', this.lastSyncTime)
    } catch (error) {
      console.error('[MobileSyncClient] 保存同步时间失败:', error)
    }
  }

  /**
   * 加载同步时间
   */
  loadSyncTime() {
    try {
      const syncTime = uni.getStorageSync('mobile_sync_time')
      if (syncTime) {
        this.lastSyncTime = syncTime
      }
    } catch (error) {
      console.error('[MobileSyncClient] 加载同步时间失败:', error)
    }
  }

  /**
   * 获取设备ID
   */
  getDeviceId() {
    try {
      let deviceId = uni.getStorageSync('device_id')
      if (!deviceId) {
        deviceId = `mobile-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
        uni.setStorageSync('device_id', deviceId)
      }
      return deviceId
    } catch (error) {
      console.error('[MobileSyncClient] 获取设备ID失败:', error)
      return `mobile-${Date.now()}`
    }
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      ...this.stats,
      isSyncing: this.isSyncing,
      isConnected: !!this.desktopDevice,
      lastSyncTime: this.lastSyncTime
    }
  }

  /**
   * 事件监听
   */
  on(event, callback) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, [])
    }
    this.eventListeners.get(event).push(callback)
  }

  /**
   * 触发事件
   */
  emit(event, data) {
    const listeners = this.eventListeners.get(event)
    if (listeners) {
      listeners.forEach(callback => callback(data))
    }
  }

  /**
   * 断开连接
   */
  async disconnect() {
    console.log('[MobileSyncClient] 断开连接')

    this.stopAutoSync()

    if (this.desktopDevice) {
      await this.p2pManager.disconnect(this.desktopDevice.peerId)
      this.desktopDevice = null
    }

    this.emit('desktop:disconnected')
  }

  /**
   * 清理资源
   */
  cleanup() {
    this.stopAutoSync()
    this.offlineQueue = []
    this.eventListeners.clear()
  }
}

// 导出单例
let mobileSyncClientInstance = null

export function getMobileSyncClient(config) {
  if (!mobileSyncClientInstance) {
    mobileSyncClientInstance = new MobileSyncClient(config)
  }
  return mobileSyncClientInstance
}

export default MobileSyncClient
