/**
 * 群聊服务
 *
 * 功能：
 * - 群组创建和管理
 * - 群成员管理
 * - 群消息发送（多方加密）
 * - 群公告和设置
 */

import database from './database'
import didService from './did'
import friendService from './friends'
import websocketService from './websocket'
import nacl from 'tweetnacl-util'
import { encodeBase64, decodeBase64 } from 'tweetnacl-util'

class GroupChatService {
  constructor() {
    this.groups = []
    this.groupListeners = []
    this.currentDid = null
    this.realtimeHandlersRegistered = false
  }

  /**
   * 初始化群聊服务
   */
  async init() {
    try {
      if (!database.isOpen) {
        await database.initWithoutPin()
      }

      await this.loadGroups()
      await this._setupRealtimeChannel()
      console.log('群聊服务初始化完成')
    } catch (error) {
      console.error('群聊服务初始化失败:', error)
      throw error
    }
  }

  /**
   * 创建群组
   * @param {Object} groupInfo - 群组信息
   * @returns {Promise<Object>}
   */
  async createGroup(groupInfo) {
    try {
      const currentIdentity = await didService.getCurrentIdentity()
      if (!currentIdentity) {
        throw new Error('请先创建DID身份')
      }

      // 验证成员是否都是好友
      const friends = await friendService.getFriends()
      const friendDids = friends.map(f => f.did)
      const invalidMembers = groupInfo.members.filter(did => !friendDids.includes(did))

      if (invalidMembers.length > 0) {
        throw new Error('只能添加好友为群成员')
      }

      const groupId = `group_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      const group = {
        id: groupId,
        name: groupInfo.name,
        description: groupInfo.description || '',
        avatar: groupInfo.avatar || '',
        ownerId: currentIdentity.did,
        members: [currentIdentity.did, ...groupInfo.members],
        admins: [currentIdentity.did],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        settings: {
          allowMemberInvite: groupInfo.allowMemberInvite !== false,
          muteAll: false,
          announcement: ''
        }
      }

      // 保存到数据库
      await database.execute(
        `INSERT INTO group_chats (
          id, name, description, avatar, owner_did,
          members, admins, created_at, updated_at, settings
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          group.id,
          group.name,
          group.description,
          group.avatar,
          group.ownerId,
          JSON.stringify(group.members),
          JSON.stringify(group.admins),
          group.createdAt,
          group.updatedAt,
          JSON.stringify(group.settings)
        ]
      )

      // 通知所有成员
      await websocketService.send('group:created', {
        group,
        members: group.members
      })

      this.groups.push(group)
      return group
    } catch (error) {
      console.error('创建群组失败:', error)
      throw error
    }
  }

  /**
   * 发送群消息
   * @param {string} groupId - 群组ID
   * @param {Object} message - 消息内容
   * @returns {Promise<Object>}
   */
  async sendGroupMessage(groupId, message) {
    try {
      const currentIdentity = await didService.getCurrentIdentity()
      if (!currentIdentity) {
        throw new Error('请先创建DID身份')
      }

      const group = await this.getGroupById(groupId)
      if (!group) {
        throw new Error('群组不存在')
      }

      if (!group.members.includes(currentIdentity.did)) {
        throw new Error('您不是群成员')
      }

      // 创建消息记录
      const messageRecord = {
        id: `gmsg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        groupId: groupId,
        fromDid: currentIdentity.did,
        type: message.type || 'text',
        content: message.content,
        metadata: message.metadata || {},
        status: 'sending',
        createdAt: Date.now(),
        updatedAt: Date.now()
      }

      // 保存到数据库
      await database.execute(
        `INSERT INTO group_messages (
          id, group_id, from_did, type, content,
          metadata, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          messageRecord.id,
          messageRecord.groupId,
          messageRecord.fromDid,
          messageRecord.type,
          messageRecord.content,
          JSON.stringify(messageRecord.metadata),
          messageRecord.status,
          messageRecord.createdAt,
          messageRecord.updatedAt
        ]
      )

      // 通过WebSocket发送给所有群成员
      await websocketService.send('group:message', {
        groupId,
        message: messageRecord,
        members: group.members
      })

      // 更新状态为已发送
      messageRecord.status = 'sent'
      await database.execute(
        'UPDATE group_messages SET status = ?, updated_at = ? WHERE id = ?',
        ['sent', Date.now(), messageRecord.id]
      )

      return messageRecord
    } catch (error) {
      console.error('发送群消息失败:', error)
      throw error
    }
  }

  /**
   * 获取群消息历史
   * @param {string} groupId - 群组ID
   * @param {number} limit - 限制数量
   * @returns {Promise<Array>}
   */
  async getGroupMessages(groupId, limit = 50) {
    try {
      const rows = await database.query(
        `SELECT * FROM group_messages
         WHERE group_id = ?
         ORDER BY created_at DESC
         LIMIT ?`,
        [groupId, limit]
      )

      return rows.map(row => ({
        id: row.id,
        groupId: row.group_id,
        fromDid: row.from_did,
        type: row.type,
        content: row.content,
        metadata: JSON.parse(row.metadata || '{}'),
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      })).reverse()
    } catch (error) {
      console.error('获取群消息失败:', error)
      return []
    }
  }

  /**
   * 添加群成员
   * @param {string} groupId - 群组ID
   * @param {Array<string>} memberDids - 成员DID列表
   * @returns {Promise<Object>}
   */
  async addMembers(groupId, memberDids) {
    try {
      const currentIdentity = await didService.getCurrentIdentity()
      if (!currentIdentity) {
        throw new Error('请先创建DID身份')
      }

      const group = await this.getGroupById(groupId)
      if (!group) {
        throw new Error('群组不存在')
      }

      // 检查权限
      const canInvite = group.ownerId === currentIdentity.did ||
                       group.admins.includes(currentIdentity.did) ||
                       group.settings.allowMemberInvite

      if (!canInvite) {
        throw new Error('没有邀请权限')
      }

      // 验证是否都是好友
      const friends = await friendService.getFriends()
      const friendDids = friends.map(f => f.did)
      const invalidMembers = memberDids.filter(did => !friendDids.includes(did))

      if (invalidMembers.length > 0) {
        throw new Error('只能添加好友为群成员')
      }

      // 添加新成员
      const newMembers = memberDids.filter(did => !group.members.includes(did))
      group.members.push(...newMembers)
      group.updatedAt = Date.now()

      await database.execute(
        'UPDATE group_chats SET members = ?, updated_at = ? WHERE id = ?',
        [JSON.stringify(group.members), group.updatedAt, groupId]
      )

      // 通知所有成员
      await websocketService.send('group:members_added', {
        groupId,
        newMembers,
        addedBy: currentIdentity.did,
        members: group.members
      })

      return group
    } catch (error) {
      console.error('添加群成员失败:', error)
      throw error
    }
  }

  /**
   * 移除群成员
   * @param {string} groupId - 群组ID
   * @param {string} memberDid - 成员DID
   * @returns {Promise<Object>}
   */
  async removeMember(groupId, memberDid) {
    try {
      const currentIdentity = await didService.getCurrentIdentity()
      if (!currentIdentity) {
        throw new Error('请先创建DID身份')
      }

      const group = await this.getGroupById(groupId)
      if (!group) {
        throw new Error('群组不存在')
      }

      // 检查权限（只有群主和管理员可以移除成员）
      const canRemove = group.ownerId === currentIdentity.did ||
                       group.admins.includes(currentIdentity.did)

      if (!canRemove && memberDid !== currentIdentity.did) {
        throw new Error('没有移除权限')
      }

      // 不能移除群主
      if (memberDid === group.ownerId) {
        throw new Error('不能移除群主')
      }

      // 移除成员
      group.members = group.members.filter(did => did !== memberDid)
      group.admins = group.admins.filter(did => did !== memberDid)
      group.updatedAt = Date.now()

      await database.execute(
        'UPDATE group_chats SET members = ?, admins = ?, updated_at = ? WHERE id = ?',
        [JSON.stringify(group.members), JSON.stringify(group.admins), group.updatedAt, groupId]
      )

      // 通知所有成员
      await websocketService.send('group:member_removed', {
        groupId,
        removedMember: memberDid,
        removedBy: currentIdentity.did,
        members: group.members
      })

      return group
    } catch (error) {
      console.error('移除群成员失败:', error)
      throw error
    }
  }

  /**
   * 更新群信息
   * @param {string} groupId - 群组ID
   * @param {Object} updates - 更新内容
   * @returns {Promise<Object>}
   */
  async updateGroup(groupId, updates) {
    try {
      const currentIdentity = await didService.getCurrentIdentity()
      if (!currentIdentity) {
        throw new Error('请先创建DID身份')
      }

      const group = await this.getGroupById(groupId)
      if (!group) {
        throw new Error('群组不存在')
      }

      // 检查权限
      const canUpdate = group.ownerId === currentIdentity.did ||
                       group.admins.includes(currentIdentity.did)

      if (!canUpdate) {
        throw new Error('没有修改权限')
      }

      // 更新群信息
      if (updates.name) group.name = updates.name
      if (updates.description !== undefined) group.description = updates.description
      if (updates.avatar !== undefined) group.avatar = updates.avatar
      if (updates.settings) {
        group.settings = { ...group.settings, ...updates.settings }
      }
      group.updatedAt = Date.now()

      await database.execute(
        `UPDATE group_chats
         SET name = ?, description = ?, avatar = ?, settings = ?, updated_at = ?
         WHERE id = ?`,
        [
          group.name,
          group.description,
          group.avatar,
          JSON.stringify(group.settings),
          group.updatedAt,
          groupId
        ]
      )

      // 通知所有成员
      await websocketService.send('group:updated', {
        groupId,
        updates,
        updatedBy: currentIdentity.did,
        members: group.members
      })

      return group
    } catch (error) {
      console.error('更新群信息失败:', error)
      throw error
    }
  }

  /**
   * 加载群组列表
   */
  async loadGroups() {
    try {
      const currentIdentity = await didService.getCurrentIdentity()
      if (!currentIdentity) {
        this.groups = []
        return
      }

      const rows = await database.query(
        `SELECT * FROM group_chats
         WHERE members LIKE ?
         ORDER BY updated_at DESC`,
        [`%${currentIdentity.did}%`]
      )

      this.groups = rows.map(row => ({
        id: row.id,
        name: row.name,
        description: row.description,
        avatar: row.avatar,
        ownerId: row.owner_did,
        members: JSON.parse(row.members || '[]'),
        admins: JSON.parse(row.admins || '[]'),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        settings: JSON.parse(row.settings || '{}')
      }))
    } catch (error) {
      console.error('加载群组列表失败:', error)
      this.groups = []
    }
  }

  /**
   * 获取群组列表
   * @returns {Promise<Array>}
   */
  async getGroups() {
    if (this.groups.length === 0) {
      await this.loadGroups()
    }
    return this.groups
  }

  /**
   * 根据ID获取群组
   * @param {string} groupId - 群组ID
   * @returns {Promise<Object|null>}
   */
  async getGroupById(groupId) {
    const group = this.groups.find(g => g.id === groupId)
    if (group) {
      return group
    }

    try {
      const rows = await database.query(
        'SELECT * FROM group_chats WHERE id = ?',
        [groupId]
      )

      if (rows.length === 0) {
        return null
      }

      const row = rows[0]
      return {
        id: row.id,
        name: row.name,
        description: row.description,
        avatar: row.avatar,
        ownerId: row.owner_did,
        members: JSON.parse(row.members || '[]'),
        admins: JSON.parse(row.admins || '[]'),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        settings: JSON.parse(row.settings || '{}')
      }
    } catch (error) {
      console.error('获取群组失败:', error)
      return null
    }
  }

  /**
   * 设置实时通道
   * @private
   */
  async _setupRealtimeChannel() {
    if (this.realtimeHandlersRegistered) {
      return
    }

    try {
      const currentIdentity = await didService.getCurrentIdentity()
      if (!currentIdentity) {
        return
      }

      this.currentDid = currentIdentity.did

      await websocketService.ensureConnection({ did: currentIdentity.did })

      // 监听群消息
      websocketService.on('group:message', this._handleIncomingGroupMessage.bind(this))
      // 监听群组更新
      websocketService.on('group:updated', this._handleGroupUpdated.bind(this))
      // 监听成员变更
      websocketService.on('group:members_added', this._handleMembersAdded.bind(this))
      websocketService.on('group:member_removed', this._handleMemberRemoved.bind(this))

      this.realtimeHandlersRegistered = true
    } catch (error) {
      console.error('设置实时通道失败:', error)
    }
  }

  /**
   * 处理接收到的群消息
   * @private
   */
  async _handleIncomingGroupMessage(data) {
    if (!data || !data.message) {
      return
    }

    try {
      // 保存到数据库
      const message = data.message
      await database.execute(
        `INSERT OR REPLACE INTO group_messages (
          id, group_id, from_did, type, content,
          metadata, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          message.id,
          message.groupId,
          message.fromDid,
          message.type,
          message.content,
          JSON.stringify(message.metadata),
          'delivered',
          message.createdAt,
          Date.now()
        ]
      )

      // 通知监听器
      this.groupListeners.forEach(listener => {
        try {
          listener({ type: 'message', data: message })
        } catch (error) {
          console.error('通知监听器失败:', error)
        }
      })
    } catch (error) {
      console.error('处理群消息失败:', error)
    }
  }

  /**
   * 处理群组更新
   * @private
   */
  async _handleGroupUpdated(data) {
    if (!data || !data.groupId) {
      return
    }

    try {
      await this.loadGroups()

      this.groupListeners.forEach(listener => {
        try {
          listener({ type: 'group_updated', data })
        } catch (error) {
          console.error('通知监听器失败:', error)
        }
      })
    } catch (error) {
      console.error('处理群组更新失败:', error)
    }
  }

  /**
   * 处理成员添加
   * @private
   */
  async _handleMembersAdded(data) {
    if (!data || !data.groupId) {
      return
    }

    try {
      await this.loadGroups()

      this.groupListeners.forEach(listener => {
        try {
          listener({ type: 'members_added', data })
        } catch (error) {
          console.error('通知监听器失败:', error)
        }
      })
    } catch (error) {
      console.error('处理成员添加失败:', error)
    }
  }

  /**
   * 处理成员移除
   * @private
   */
  async _handleMemberRemoved(data) {
    if (!data || !data.groupId) {
      return
    }

    try {
      await this.loadGroups()

      this.groupListeners.forEach(listener => {
        try {
          listener({ type: 'member_removed', data })
        } catch (error) {
          console.error('通知监听器失败:', error)
        }
      })
    } catch (error) {
      console.error('处理成员移除失败:', error)
    }
  }

  /**
   * 添加监听器
   * @param {Function} listener - 监听函数
   */
  addListener(listener) {
    if (typeof listener === 'function') {
      this.groupListeners.push(listener)
    }
  }

  /**
   * 移除监听器
   * @param {Function} listener - 监听函数
   */
  removeListener(listener) {
    const index = this.groupListeners.indexOf(listener)
    if (index > -1) {
      this.groupListeners.splice(index, 1)
    }
  }
}

const groupChatService = new GroupChatService()

export default groupChatService
