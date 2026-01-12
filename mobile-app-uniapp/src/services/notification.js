/**
 * 实时通知服务
 * 提供推送通知、本地通知和实时消息功能
 */

class NotificationService {
  constructor() {
    this.listeners = new Map()
    this.notificationHistory = []
    this.isInitialized = false
    this.settings = {
      messageNotification: true,
      tradeNotification: true,
      socialNotification: true,
      notificationSound: true,
      notificationVibration: true,
      doNotDisturbEnabled: false,
      doNotDisturbStart: '22:00',
      doNotDisturbEnd: '08:00'
    }
  }

  /**
   * 初始化通知服务
   */
  async initialize() {
    console.log('[NotificationService] 初始化通知服务...')

    try {
      // 加载通知设置
      await this.loadSettings()

      // 请求通知权限
      await this.requestPermission()

      // 初始化推送服务
      await this.initPushService()

      this.isInitialized = true
      console.log('[NotificationService] 通知服务初始化成功')
    } catch (error) {
      console.error('[NotificationService] 初始化失败:', error)
      throw error
    }
  }

  /**
   * 加载通知设置
   */
  async loadSettings() {
    try {
      const settings = uni.getStorageSync('notification_settings')
      if (settings) {
        this.settings = JSON.parse(settings)
      }
    } catch (error) {
      console.error('加载通知设置失败:', error)
    }
  }

  /**
   * 保存通知设置
   */
  async saveSettings() {
    try {
      uni.setStorageSync('notification_settings', JSON.stringify(this.settings))
    } catch (error) {
      console.error('保存通知设置失败:', error)
    }
  }

  /**
   * 请求通知权限
   */
  async requestPermission() {
    return new Promise((resolve) => {
      // #ifdef APP-PLUS
      const permissionID = 'android.permission.POST_NOTIFICATIONS'
      plus.android.requestPermissions(
        [permissionID],
        (result) => {
          if (result.granted && result.granted.length > 0) {
            console.log('通知权限已授予')
            resolve(true)
          } else {
            console.log('通知权限被拒绝')
            resolve(false)
          }
        },
        (error) => {
          console.error('权限申请失败:', error)
          resolve(false)
        }
      )
      // #endif

      // #ifdef MP-WEIXIN
      uni.authorize({
        scope: 'scope.notification',
        success: () => {
          console.log('通知权限已授予')
          resolve(true)
        },
        fail: () => {
          console.log('通知权限被拒绝')
          resolve(false)
        }
      })
      // #endif

      // #ifdef H5
      if ('Notification' in window) {
        Notification.requestPermission().then((permission) => {
          resolve(permission === 'granted')
        })
      } else {
        resolve(false)
      }
      // #endif
    })
  }

  /**
   * 初始化推送服务
   */
  async initPushService() {
    // #ifdef APP-PLUS
    // 获取客户端推送标识
    plus.push.getClientInfo({
      success: (info) => {
        console.log('推送客户端ID:', info.clientid)
        // 保存clientid用于服务端推送
        uni.setStorageSync('push_client_id', info.clientid)
      },
      fail: (error) => {
        console.error('获取推送客户端ID失败:', error)
      }
    })

    // 监听推送消息
    plus.push.addEventListener('click', (message) => {
      console.log('点击推送消息:', message)
      this.handlePushClick(message)
    }, false)

    plus.push.addEventListener('receive', (message) => {
      console.log('收到推送消息:', message)
      this.handlePushReceive(message)
    }, false)
    // #endif

    // #ifdef MP-WEIXIN
    // 小程序订阅消息
    // 需要在用户触发时调用
    // #endif
  }

  /**
   * 发送本地通知
   * @param {Object} options - 通知选项
   */
  async sendLocalNotification(options) {
    const {
      title,
      content,
      type = 'message',
      priority = 'normal',
      data = {},
      sound = this.settings.notificationSound,
      vibrate = this.settings.notificationVibration
    } = options

    // 检查勿扰模式
    if (this.isDoNotDisturbActive()) {
      console.log('[NotificationService] 勿扰模式已开启，跳过通知')
      // 仍然保存到历史记录
      this.addToHistory({ title, content, type, priority, data, timestamp: Date.now(), read: false })
      return
    }

    // 检查通知设置
    if (!this.shouldShowNotification(type)) {
      return
    }

    try {
      // #ifdef APP-PLUS
      plus.push.createMessage(content, '', {
        title: title,
        cover: false,
        sound: sound ? 'system' : 'none',
        when: new Date()
      })

      if (vibrate) {
        plus.device.vibrate(200)
      }
      // #endif

      // #ifdef MP-WEIXIN
      // 小程序不支持本地通知，使用订阅消息
      // 需要先获取用户授权
      // #endif

      // #ifdef H5
      if ('Notification' in window && Notification.permission === 'granted') {
        const notification = new Notification(title, {
          body: content,
          icon: '/logo.png',
          badge: '/logo.png',
          tag: type,
          data: data
        })

        notification.onclick = () => {
          this.handleNotificationClick({ type, data })
          notification.close()
        }
      }
      // #endif

      // 触发通知事件
      this.emit('notification', { title, content, type, priority, data })

      // 添加到通知历史
      this.addToHistory({ title, content, type, priority, data, timestamp: Date.now(), read: false })

    } catch (error) {
      console.error('发送本地通知失败:', error)
    }
  }

  /**
   * 检查勿扰模式是否激活
   */
  isDoNotDisturbActive() {
    if (!this.settings.doNotDisturbEnabled) return false

    const now = new Date()
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

    const start = this.settings.doNotDisturbStart
    const end = this.settings.doNotDisturbEnd

    if (start < end) {
      return currentTime >= start && currentTime < end
    } else {
      return currentTime >= start || currentTime < end
    }
  }

  /**
   * 检查是否应该显示通知
   */
  shouldShowNotification(type) {
    switch (type) {
      case 'message':
        return this.settings.messageNotification
      case 'trade':
        return this.settings.tradeNotification
      case 'social':
        return this.settings.socialNotification
      default:
        return true
    }
  }

  /**
   * 处理推送消息点击
   */
  handlePushClick(message) {
    const { type, data } = message.payload || {}

    switch (type) {
      case 'message':
        // 跳转到消息页面
        uni.navigateTo({
          url: `/pages/social/messages/messages?conversationId=${data.conversationId}`
        })
        break

      case 'trade':
        // 跳转到交易页面
        uni.navigateTo({
          url: `/pages/trade/orders/orders?orderId=${data.orderId}`
        })
        break

      case 'social':
        // 跳转到社交页面
        uni.navigateTo({
          url: `/pages/social/timeline/index?postId=${data.postId}`
        })
        break

      default:
        // 跳转到首页
        uni.switchTab({
          url: '/pages/index/index'
        })
    }
  }

  /**
   * 处理推送消息接收
   */
  handlePushReceive(message) {
    const { title, content, type, data } = message.payload || {}

    // 发送本地通知
    this.sendLocalNotification({
      title: title || '新消息',
      content: content || '',
      type: type || 'message',
      data: data || {}
    })
  }

  /**
   * 处理通知点击
   */
  handleNotificationClick({ type, data }) {
    this.handlePushClick({ payload: { type, data } })
  }

  /**
   * 添加到通知历史
   */
  addToHistory(notification) {
    const notificationWithId = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      ...notification
    }

    this.notificationHistory.unshift(notificationWithId)

    // 最多保留200条
    if (this.notificationHistory.length > 200) {
      this.notificationHistory = this.notificationHistory.slice(0, 200)
    }

    // 保存到本地
    this.saveHistory()

    // 更新TabBar角标
    this.updateTabBarBadge()
  }

  /**
   * 保存通知历史
   */
  saveHistory() {
    try {
      uni.setStorageSync('notification_history', JSON.stringify(this.notificationHistory))
    } catch (error) {
      console.error('保存通知历史失败:', error)
    }
  }

  /**
   * 加载通知历史
   */
  loadHistory() {
    try {
      const history = uni.getStorageSync('notification_history')
      if (history) {
        this.notificationHistory = JSON.parse(history)
      }
    } catch (error) {
      console.error('加载通知历史失败:', error)
    }
  }

  /**
   * 获取通知历史
   */
  getNotificationHistory() {
    return this.notificationHistory
  }

  /**
   * 清空通知历史
   */
  clearHistory() {
    this.notificationHistory = []
    this.saveHistory()
    this.updateTabBarBadge()
  }

  /**
   * 获取未读通知数量
   */
  getUnreadCount() {
    return this.notificationHistory.filter(n => !n.read).length
  }

  /**
   * 标记通知为已读
   */
  markAsRead(notificationId) {
    const notification = this.notificationHistory.find(n => n.id === notificationId)
    if (notification) {
      notification.read = true
      this.saveHistory()
      this.updateTabBarBadge()
    }
  }

  /**
   * 标记所有通知为已读
   */
  markAllAsRead() {
    this.notificationHistory.forEach(n => n.read = true)
    this.saveHistory()
    this.updateTabBarBadge()
  }

  /**
   * 删除通知
   */
  deleteNotification(notificationId) {
    const index = this.notificationHistory.findIndex(n => n.id === notificationId)
    if (index !== -1) {
      this.notificationHistory.splice(index, 1)
      this.saveHistory()
      this.updateTabBarBadge()
    }
  }

  /**
   * 添加通知（供外部调用）
   */
  async addNotification(notification) {
    await this.sendLocalNotification(notification)
  }

  /**
   * 显示通知（供外部调用）
   */
  async showNotification(notification) {
    await this.sendLocalNotification(notification)
  }

  /**
   * 禁用通知
   */
  disableNotifications() {
    this.settings.messageNotification = false
    this.settings.tradeNotification = false
    this.settings.socialNotification = false
    this.saveSettings()
  }

  /**
   * 更新TabBar角标
   */
  updateTabBarBadge() {
    const unreadCount = this.getUnreadCount()

    if (unreadCount > 0) {
      uni.setTabBarBadge({
        index: 2, // Messages tab index
        text: unreadCount > 99 ? '99+' : unreadCount.toString()
      })
    } else {
      uni.removeTabBarBadge({
        index: 2
      })
    }
  }

  /**
   * 发送消息通知
   */
  async sendMessageNotification(message) {
    await this.sendLocalNotification({
      title: message.senderName || '新消息',
      content: message.content || '',
      type: 'message',
      data: {
        conversationId: message.conversationId,
        messageId: message.id
      }
    })
  }

  /**
   * 发送交易通知
   */
  async sendTradeNotification(trade) {
    await this.sendLocalNotification({
      title: '交易通知',
      content: trade.message || '',
      type: 'trade',
      data: {
        orderId: trade.orderId,
        tradeId: trade.id
      }
    })
  }

  /**
   * 发送社交通知
   */
  async sendSocialNotification(social) {
    await this.sendLocalNotification({
      title: social.title || '社交动态',
      content: social.content || '',
      type: 'social',
      data: {
        postId: social.postId,
        userId: social.userId
      }
    })
  }

  /**
   * 订阅小程序消息（微信小程序）
   */
  async subscribeMessage(templateIds) {
    // #ifdef MP-WEIXIN
    return new Promise((resolve, reject) => {
      uni.requestSubscribeMessage({
        tmplIds: templateIds,
        success: (res) => {
          console.log('订阅消息成功:', res)
          resolve(res)
        },
        fail: (err) => {
          console.error('订阅消息失败:', err)
          reject(err)
        }
      })
    })
    // #endif

    // #ifndef MP-WEIXIN
    return Promise.resolve()
    // #endif
  }

  /**
   * 注册事件监听
   */
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, [])
    }
    this.listeners.get(event).push(callback)
  }

  /**
   * 移除事件监听
   */
  off(event, callback) {
    if (!this.listeners.has(event)) return

    const callbacks = this.listeners.get(event)
    const index = callbacks.indexOf(callback)
    if (index > -1) {
      callbacks.splice(index, 1)
    }
  }

  /**
   * 触发事件
   */
  emit(event, data) {
    if (!this.listeners.has(event)) return

    const callbacks = this.listeners.get(event)
    callbacks.forEach(callback => {
      try {
        callback(data)
      } catch (error) {
        console.error('事件回调执行失败:', error)
      }
    })
  }

  /**
   * 更新通知设置
   */
  updateSettings(settings) {
    this.settings = { ...this.settings, ...settings }
    this.saveSettings()
  }

  /**
   * 获取通知设置
   */
  getSettings() {
    return { ...this.settings }
  }

  /**
   * 清除所有通知
   */
  clearAll() {
    // #ifdef APP-PLUS
    plus.push.clear()
    // #endif

    this.clearHistory()
  }

  /**
   * 销毁通知服务
   */
  destroy() {
    this.listeners.clear()
    this.clearHistory()
    this.isInitialized = false
  }
}

// 导出单例
export default new NotificationService()
