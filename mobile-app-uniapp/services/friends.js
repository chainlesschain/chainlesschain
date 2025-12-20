/**
 * 好友管理服务
 * 基于DID的去中心化好友系统
 *
 * 功能：
 * - 发送/接受好友请求
 * - 好友列表管理
 * - 好友验证（基于DID签名）
 * - 黑名单管理
 */

import database from './database'
import didService from './did'
import authService from './auth'

class FriendService {
  constructor() {
    this.friendRequests = []
    this.friends = []
    this.blockedUsers = []
  }

  /**
   * 初始化好友服务
   */
  async init() {
    try {
      // 确保数据库已初始化
      if (!database.isOpen) {
        console.log('[FriendService] 数据库未初始化，尝试初始化...')
        await database.initWithoutPin()
      }

      await this.loadFriends()
      await this.loadFriendRequests()
      await this.loadBlockedUsers()
      console.log('好友服务初始化完成')
    } catch (error) {
      console.error('好友服务初始化失败:', error)
      throw error
    }
  }

  /**
   * 添加好友请求
   * @param {string} targetDid - 目标用户DID
   * @param {string} message - 请求消息
   * @returns {Promise<Object>}
   */
  async sendFriendRequest(targetDid, message = '') {
    try {
      // 验证目标DID格式
      if (!targetDid || !targetDid.startsWith('did:chainlesschain:')) {
        throw new Error('无效的DID格式')
      }

      // 检查是否已是好友
      const existingFriend = await database.getFriendByDid(targetDid)
      if (existingFriend) {
        throw new Error('该用户已是您的好友')
      }

      // 检查是否已发送过请求
      const existingRequest = await database.getFriendRequest(targetDid, 'sent')
      if (existingRequest) {
        throw new Error('已发送过好友请求')
      }

      // 检查是否在黑名单中
      const isBlocked = await this.isUserBlocked(targetDid)
      if (isBlocked) {
        throw new Error('无法向该用户发送请求')
      }

      // 获取当前用户身份
      const currentIdentity = await didService.getCurrentIdentity()
      if (!currentIdentity) {
        throw new Error('请先创建DID身份')
      }

      // 创建好友请求
      const request = {
        id: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        fromDid: currentIdentity.did,
        toDid: targetDid,
        message: message,
        status: 'pending', // pending, accepted, rejected
        direction: 'sent',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }

      // 签名请求（证明是本人发送）
      const signatureData = `${request.fromDid}:${request.toDid}:${request.createdAt}`
      request.signature = await didService.signMessage(signatureData)

      // 保存到数据库
      await database.saveFriendRequest(request)

      // TODO: 通过WebSocket发送给对方（Week 3-4后期实现）

      return {
        success: true,
        request
      }
    } catch (error) {
      console.error('发送好友请求失败:', error)
      throw error
    }
  }

  /**
   * 接受好友请求
   * @param {string} requestId - 请求ID
   * @returns {Promise<Object>}
   */
  async acceptFriendRequest(requestId) {
    try {
      // 获取请求
      const request = await database.getFriendRequestById(requestId)
      if (!request) {
        throw new Error('好友请求不存在')
      }

      if (request.status !== 'pending') {
        throw new Error('该请求已处理')
      }

      // 验证请求签名
      const signatureData = `${request.fromDid}:${request.toDid}:${request.createdAt}`
      const isValid = await didService.verifySignature(
        signatureData,
        request.signature,
        request.fromDid
      )

      if (!isValid) {
        throw new Error('请求签名验证失败')
      }

      // 获取当前用户身份
      const currentIdentity = await didService.getCurrentIdentity()

      // 创建双向好友关系
      const friendship = {
        id: `friend_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        userDid: currentIdentity.did,
        friendDid: request.fromDid,
        nickname: '', // 用户可后续设置备注
        notes: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }

      // 保存好友关系
      await database.saveFriend(friendship)

      // 更新请求状态
      await database.updateFriendRequest(requestId, {
        status: 'accepted',
        updatedAt: new Date().toISOString()
      })

      // 重新加载好友列表
      await this.loadFriends()

      // TODO: 通知对方（Week 3-4后期实现）

      return {
        success: true,
        friendship
      }
    } catch (error) {
      console.error('接受好友请求失败:', error)
      throw error
    }
  }

  /**
   * 拒绝好友请求
   * @param {string} requestId - 请求ID
   * @returns {Promise<Object>}
   */
  async rejectFriendRequest(requestId) {
    try {
      const request = await database.getFriendRequestById(requestId)
      if (!request) {
        throw new Error('好友请求不存在')
      }

      if (request.status !== 'pending') {
        throw new Error('该请求已处理')
      }

      // 更新请求状态
      await database.updateFriendRequest(requestId, {
        status: 'rejected',
        updatedAt: new Date().toISOString()
      })

      return {
        success: true
      }
    } catch (error) {
      console.error('拒绝好友请求失败:', error)
      throw error
    }
  }

  /**
   * 删除好友
   * @param {string} friendDid - 好友DID
   * @returns {Promise<Object>}
   */
  async removeFriend(friendDid) {
    try {
      const currentIdentity = await didService.getCurrentIdentity()

      // 删除好友关系
      await database.deleteFriend(currentIdentity.did, friendDid)

      // 重新加载好友列表
      await this.loadFriends()

      return {
        success: true
      }
    } catch (error) {
      console.error('删除好友失败:', error)
      throw error
    }
  }

  /**
   * 更新好友备注
   * @param {string} friendDid - 好友DID
   * @param {Object} updates - 更新内容 {nickname, notes}
   * @returns {Promise<Object>}
   */
  async updateFriendInfo(friendDid, updates) {
    try {
      const currentIdentity = await didService.getCurrentIdentity()

      await database.updateFriend(currentIdentity.did, friendDid, {
        ...updates,
        updatedAt: new Date().toISOString()
      })

      // 重新加载好友列表
      await this.loadFriends()

      return {
        success: true
      }
    } catch (error) {
      console.error('更新好友信息失败:', error)
      throw error
    }
  }

  /**
   * 拉黑用户
   * @param {string} userDid - 用户DID
   * @param {string} reason - 拉黑原因
   * @returns {Promise<Object>}
   */
  async blockUser(userDid, reason = '') {
    try {
      const currentIdentity = await didService.getCurrentIdentity()

      // 如果是好友，先删除好友关系
      const friend = await database.getFriendByDid(userDid)
      if (friend) {
        await this.removeFriend(userDid)
      }

      // 添加到黑名单
      const blockRecord = {
        id: `block_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        userDid: currentIdentity.did,
        blockedDid: userDid,
        reason: reason,
        createdAt: new Date().toISOString()
      }

      await database.saveBlockedUser(blockRecord)

      // 重新加载黑名单
      await this.loadBlockedUsers()

      return {
        success: true
      }
    } catch (error) {
      console.error('拉黑用户失败:', error)
      throw error
    }
  }

  /**
   * 取消拉黑
   * @param {string} userDid - 用户DID
   * @returns {Promise<Object>}
   */
  async unblockUser(userDid) {
    try {
      const currentIdentity = await didService.getCurrentIdentity()

      await database.deleteBlockedUser(currentIdentity.did, userDid)

      // 重新加载黑名单
      await this.loadBlockedUsers()

      return {
        success: true
      }
    } catch (error) {
      console.error('取消拉黑失败:', error)
      throw error
    }
  }

  /**
   * 检查用户是否被拉黑
   * @param {string} userDid - 用户DID
   * @returns {Promise<boolean>}
   */
  async isUserBlocked(userDid) {
    const blocked = this.blockedUsers.find(b => b.blockedDid === userDid)
    return !!blocked
  }

  /**
   * 获取好友列表
   * @param {Object} options - 查询选项
   * @returns {Promise<Array>}
   */
  async getFriends(options = {}) {
    const { search = '', sort = 'createdAt' } = options

    let friends = [...this.friends]

    // 搜索过滤
    if (search) {
      friends = friends.filter(f =>
        f.friendDid.includes(search) ||
        (f.nickname && f.nickname.includes(search)) ||
        (f.notes && f.notes.includes(search))
      )
    }

    // 排序
    if (sort === 'createdAt') {
      friends.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    } else if (sort === 'nickname') {
      friends.sort((a, b) => (a.nickname || '').localeCompare(b.nickname || ''))
    }

    // 为每个好友获取DID文档（包含公钥等信息）
    for (const friend of friends) {
      try {
        const didDoc = await didService.resolveDID(friend.friendDid)
        friend.didDocument = didDoc
      } catch (error) {
        console.error(`解析DID ${friend.friendDid} 失败:`, error)
        friend.didDocument = null
      }
    }

    return friends
  }

  /**
   * 获取待处理的好友请求
   * @param {string} direction - 'received' 或 'sent'
   * @returns {Promise<Array>}
   */
  async getPendingRequests(direction = 'received') {
    try {
      const currentIdentity = await didService.getCurrentIdentity()

      const requests = await database.getFriendRequests({
        userDid: currentIdentity.did,
        direction,
        status: 'pending'
      })

      return requests
    } catch (error) {
      console.error('获取好友请求失败:', error)
      return []
    }
  }

  /**
   * 获取黑名单
   * @returns {Promise<Array>}
   */
  async getBlockedUsers() {
    return [...this.blockedUsers]
  }

  /**
   * 通过DID搜索用户
   * @param {string} did - DID或DID片段
   * @returns {Promise<Object>}
   */
  async searchUserByDid(did) {
    try {
      // 验证DID格式
      if (!did.startsWith('did:chainlesschain:')) {
        throw new Error('无效的DID格式')
      }

      // 解析DID文档
      const didDoc = await didService.resolveDID(did)

      if (!didDoc) {
        throw new Error('DID不存在')
      }

      // 检查是否已是好友
      const isFriend = this.friends.some(f => f.friendDid === did)

      // 检查是否被拉黑
      const isBlocked = await this.isUserBlocked(did)

      return {
        did,
        didDocument: didDoc,
        isFriend,
        isBlocked
      }
    } catch (error) {
      console.error('搜索用户失败:', error)
      throw error
    }
  }

  /**
   * 加载好友列表
   * @private
   */
  async loadFriends() {
    try {
      const currentIdentity = await didService.getCurrentIdentity()
      if (!currentIdentity) {
        this.friends = []
        return
      }

      this.friends = await database.getFriends(currentIdentity.did)
    } catch (error) {
      console.error('加载好友列表失败:', error)
      this.friends = []
    }
  }

  /**
   * 加载好友请求
   * @private
   */
  async loadFriendRequests() {
    try {
      const currentIdentity = await didService.getCurrentIdentity()
      if (!currentIdentity) {
        this.friendRequests = []
        return
      }

      this.friendRequests = await database.getAllFriendRequests(currentIdentity.did)
    } catch (error) {
      console.error('加载好友请求失败:', error)
      this.friendRequests = []
    }
  }

  /**
   * 加载黑名单
   * @private
   */
  async loadBlockedUsers() {
    try {
      const currentIdentity = await didService.getCurrentIdentity()
      if (!currentIdentity) {
        this.blockedUsers = []
        return
      }

      this.blockedUsers = await database.getBlockedUsers(currentIdentity.did)
    } catch (error) {
      console.error('加载黑名单失败:', error)
      this.blockedUsers = []
    }
  }

  /**
   * 获取好友统计信息
   * @returns {Promise<Object>}
   */
  async getStatistics() {
    const pendingReceived = await this.getPendingRequests('received')
    const pendingSent = await this.getPendingRequests('sent')

    return {
      totalFriends: this.friends.length,
      pendingReceivedCount: pendingReceived.length,
      pendingSentCount: pendingSent.length,
      blockedCount: this.blockedUsers.length
    }
  }
}

// 导出单例
export default new FriendService()
