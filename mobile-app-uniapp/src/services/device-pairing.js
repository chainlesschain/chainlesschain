/**
 * 设备配对服务
 *
 * 功能：
 * - 生成配对码和二维码
 * - 等待PC端确认
 * - 建立P2P连接
 * - 交换设备信息和密钥
 */

import { getP2PManager } from './p2p/p2p-manager'
import { getDIDService } from './did'

class DevicePairingService {
  constructor() {
    this.p2pManager = null
    this.didService = null

    // 配对状态
    this.isPairing = false
    this.pairingCode = null
    this.pairingTimeout = null
    this.pairingTimeoutMs = 5 * 60 * 1000 // 5分钟

    // 配对回调
    this.onPairingSuccess = null
    this.onPairingFailed = null
    this.onPairingCancelled = null
  }

  /**
   * 初始化
   */
  async initialize() {
    this.p2pManager = getP2PManager()
    this.didService = getDIDService()
  }

  /**
   * 生成6位配对码
   */
  generatePairingCode() {
    return Math.floor(100000 + Math.random() * 900000).toString()
  }

  /**
   * 开始配对流程
   * @returns {Promise<Object>} { qrCode, pairingCode, pcDevice }
   */
  async startPairing() {
    console.log('[DevicePairing] 开始配对流程...')

    if (this.isPairing) {
      throw new Error('配对流程已在进行中')
    }

    try {
      this.isPairing = true

      // 1. 生成配对码
      this.pairingCode = this.generatePairingCode()
      console.log('[DevicePairing] 配对码:', this.pairingCode)

      // 2. 获取当前DID
      const currentIdentity = await this.didService.getCurrentIdentity()
      if (!currentIdentity) {
        throw new Error('未找到DID身份，请先创建身份')
      }

      // 3. 获取设备信息
      const systemInfo = uni.getSystemInfoSync()
      const deviceInfo = {
        deviceId: await this.getDeviceId(),
        name: systemInfo.model || 'Unknown Device',
        platform: systemInfo.platform || 'unknown',
        version: '0.16.0',
        screenWidth: systemInfo.screenWidth,
        screenHeight: systemInfo.screenHeight,
        system: systemInfo.system
      }

      // 4. 生成二维码数据
      const qrData = {
        type: 'device-pairing',
        code: this.pairingCode,
        did: currentIdentity.did,
        deviceInfo,
        timestamp: Date.now()
      }

      // 5. 生成二维码图片
      const qrCode = await this.generateQRCode(qrData)

      // 6. 设置超时
      this.setupPairingTimeout()

      // 7. 等待PC端确认
      const pcDevice = await this.waitForPCConfirmation()

      // 8. 建立P2P连接
      await this.connectToPC(pcDevice.peerId)

      // 9. 交换设备信息
      await this.exchangeDeviceInfo(pcDevice.peerId)

      // 10. 建立加密会话
      await this.establishEncryptedSession(pcDevice.peerId)

      console.log('[DevicePairing] ✅ 配对成功！')

      if (this.onPairingSuccess) {
        this.onPairingSuccess(pcDevice)
      }

      return { qrCode, pairingCode: this.pairingCode, pcDevice }

    } catch (error) {
      console.error('[DevicePairing] ❌ 配对失败:', error)

      if (this.onPairingFailed) {
        this.onPairingFailed(error)
      }

      throw error
    } finally {
      this.cleanupPairing()
    }
  }

  /**
   * 生成二维码
   */
  async generateQRCode(data) {
    return new Promise((resolve, reject) => {
      // 使用uni-app的createCanvasContext生成二维码
      // 这里简化处理，实际应使用qrcode库
      const qrCodeText = JSON.stringify(data)

      // #ifdef H5
      // H5环境可以使用qrcode库
      if (typeof QRCode !== 'undefined') {
        const canvas = document.createElement('canvas')
        QRCode.toCanvas(canvas, qrCodeText, { width: 300 }, (error) => {
          if (error) {
            reject(error)
          } else {
            resolve(canvas.toDataURL())
          }
        })
      } else {
        // 降级方案：返回文本数据
        resolve(qrCodeText)
      }
      // #endif

      // #ifndef H5
      // App环境：返回数据，让UI层使用第三方组件渲染
      resolve(qrCodeText)
      // #endif
    })
  }

  /**
   * 等待PC端确认
   */
  async waitForPCConfirmation() {
    return new Promise((resolve, reject) => {
      console.log('[DevicePairing] 等待PC端确认...')

      // 监听配对确认消息
      const handler = (message) => {
        if (message.type === 'pairing:confirmation' &&
            message.pairingCode === this.pairingCode) {

          console.log('[DevicePairing] ✅ 收到PC端确认')

          // 清除监听器
          this.p2pManager.off('message', handler)

          resolve({
            peerId: message.pcPeerId,
            deviceInfo: message.deviceInfo
          })
        }
      }

      // 通过信令服务器监听
      this.p2pManager.on('message', handler)

      // 超时处理
      setTimeout(() => {
        this.p2pManager.off('message', handler)
        reject(new Error('等待PC端确认超时'))
      }, this.pairingTimeoutMs)
    })
  }

  /**
   * 连接到PC端
   */
  async connectToPC(pcPeerId) {
    console.log('[DevicePairing] 连接到PC端:', pcPeerId)

    try {
      await this.p2pManager.connectToPeer(pcPeerId)

      // 等待连接建立
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('连接PC端超时'))
        }, 30000) // 30秒

        const handler = (peerId) => {
          if (peerId === pcPeerId) {
            clearTimeout(timeout)
            this.p2pManager.off('peer:connected', handler)
            resolve()
          }
        }

        this.p2pManager.on('peer:connected', handler)
      })
    } catch (error) {
      console.error('[DevicePairing] 连接PC端失败:', error)
      throw error
    }
  }

  /**
   * 交换设备信息
   */
  async exchangeDeviceInfo(pcPeerId) {
    console.log('[DevicePairing] 交换设备信息...')

    const systemInfo = uni.getSystemInfoSync()
    const deviceInfo = {
      deviceId: await this.getDeviceId(),
      name: systemInfo.model || 'Unknown Device',
      platform: systemInfo.platform || 'unknown',
      version: '0.16.0',
      capabilities: {
        camera: true,
        bluetooth: true,
        wifi: true
      }
    }

    await this.p2pManager.sendMessage(pcPeerId, {
      type: 'device:info',
      deviceInfo
    })
  }

  /**
   * 建立加密会话
   */
  async establishEncryptedSession(pcPeerId) {
    console.log('[DevicePairing] 建立加密会话...')

    // TODO: 集成Signal协议
    // 这里先返回成功，后续实现Signal协议时完善
    return Promise.resolve()
  }

  /**
   * 获取设备ID
   */
  async getDeviceId() {
    // 尝试从storage获取
    let deviceId = uni.getStorageSync('device_id')

    if (!deviceId) {
      // 生成新的设备ID
      deviceId = this.generateDeviceId()
      uni.setStorageSync('device_id', deviceId)
    }

    return deviceId
  }

  /**
   * 生成设备ID
   */
  generateDeviceId() {
    // 简单的UUID v4实现
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0
      const v = c === 'x' ? r : (r & 0x3 | 0x8)
      return v.toString(16)
    })
  }

  /**
   * 设置配对超时
   */
  setupPairingTimeout() {
    this.pairingTimeout = setTimeout(() => {
      console.log('[DevicePairing] 配对超时')
      this.cancelPairing()

      if (this.onPairingFailed) {
        this.onPairingFailed(new Error('配对超时'))
      }
    }, this.pairingTimeoutMs)
  }

  /**
   * 取消配对
   */
  cancelPairing() {
    console.log('[DevicePairing] 取消配对')

    if (this.onPairingCancelled) {
      this.onPairingCancelled()
    }

    this.cleanupPairing()
  }

  /**
   * 清理配对状态
   */
  cleanupPairing() {
    this.isPairing = false
    this.pairingCode = null

    if (this.pairingTimeout) {
      clearTimeout(this.pairingTimeout)
      this.pairingTimeout = null
    }
  }

  /**
   * 获取配对状态
   */
  getPairingStatus() {
    return {
      isPairing: this.isPairing,
      pairingCode: this.pairingCode
    }
  }
}

// 导出单例
let devicePairingInstance = null

export function getDevicePairingService() {
  if (!devicePairingInstance) {
    devicePairingInstance = new DevicePairingService()
  }
  return devicePairingInstance
}

export default DevicePairingService
