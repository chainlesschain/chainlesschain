/**
 * ChainlessChain Mobile - 认证服务
 * PIN 码模拟 SIMKey 认证
 */

class AuthService {
  constructor() {
    this.isAuthenticated = false
    this.pin = null
    this.deviceId = null
  }

  /**
   * 初始化
   */
  init() {
    // 获取设备 ID
    this.deviceId = uni.getStorageSync('device_id')
    if (!this.deviceId) {
      this.deviceId = this.generateDeviceId()
      uni.setStorageSync('device_id', this.deviceId)
    }

    // 检查登录状态
    this.isAuthenticated = uni.getStorageSync('isLoggedIn') === true
  }

  /**
   * 生成设备 ID
   */
  generateDeviceId() {
    const systemInfo = uni.getSystemInfoSync()
    return `${systemInfo.platform}_${systemInfo.deviceId || Date.now()}`
  }

  /**
   * 验证 PIN 码
   * @param {string} pin PIN码（4-6位数字）
   * @returns {Promise<Object>} 验证结果
   */
  async verifyPIN(pin) {
    return new Promise((resolve, reject) => {
      // 验证 PIN 码格式
      if (!/^\d{4,6}$/.test(pin)) {
        reject(new Error('PIN码格式错误，请输入4-6位数字'))
        return
      }

      // 模拟异步验证过程
      setTimeout(() => {
        // 获取存储的 PIN 码
        const storedPIN = uni.getStorageSync('user_pin')

        if (!storedPIN) {
          // 首次登录，设置 PIN 码
          uni.setStorageSync('user_pin', pin)
          this.pin = pin
          this.isAuthenticated = true
          uni.setStorageSync('isLoggedIn', true)

          resolve({
            success: true,
            isFirstTime: true,
            message: 'PIN码已设置'
          })
        } else {
          // 验证 PIN 码
          if (storedPIN === pin) {
            this.pin = pin
            this.isAuthenticated = true
            uni.setStorageSync('isLoggedIn', true)

            resolve({
              success: true,
              isFirstTime: false,
              message: 'PIN码验证成功'
            })
          } else {
            reject(new Error('PIN码错误'))
          }
        }
      }, 500) // 模拟硬件验证延迟
    })
  }

  /**
   * 修改 PIN 码
   * @param {string} oldPin 旧PIN码
   * @param {string} newPin 新PIN码
   */
  async changePIN(oldPin, newPin) {
    const storedPIN = uni.getStorageSync('user_pin')

    if (storedPIN !== oldPin) {
      throw new Error('旧PIN码错误')
    }

    if (!/^\d{4,6}$/.test(newPin)) {
      throw new Error('新PIN码格式错误，请输入4-6位数字')
    }

    uni.setStorageSync('user_pin', newPin)
    this.pin = newPin

    return {
      success: true,
      message: 'PIN码已更新'
    }
  }

  /**
   * 重置 PIN 码（需要额外验证，如助记词）
   */
  async resetPIN(mnemonic, newPin) {
    // TODO: 实现助记词验证
    // 目前简化实现，直接允许重置
    if (!/^\d{4,6}$/.test(newPin)) {
      throw new Error('新PIN码格式错误')
    }

    uni.setStorageSync('user_pin', newPin)
    this.pin = newPin

    return {
      success: true,
      message: 'PIN码已重置'
    }
  }

  /**
   * 退出登录
   */
  logout() {
    this.isAuthenticated = false
    this.pin = null
    uni.setStorageSync('isLoggedIn', false)

    // 跳转到登录页
    uni.reLaunch({
      url: '/pages/login/login'
    })
  }

  /**
   * 获取加密密钥（从 PIN 码派生）
   */
  getEncryptionKey() {
    if (!this.pin) {
      throw new Error('未登录')
    }

    // 简化版密钥派生（生产环境应使用 PBKDF2）
    return `key_${this.pin}_salt_${this.deviceId}`
  }

  /**
   * 检查是否已登录
   */
  isLoggedIn() {
    return this.isAuthenticated
  }

  /**
   * 获取设备 ID
   */
  getDeviceId() {
    return this.deviceId
  }

  /**
   * 模拟 SIMKey 状态检测
   */
  async detectSIMKey() {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          detected: true,
          status: 'ready',
          serialNumber: `SIM_${this.deviceId}`,
          manufacturer: 'ChainlessChain (Simulated)',
          type: 'USIM'
        })
      }, 300)
    })
  }

  /**
   * 模拟数据签名
   */
  async signData(data) {
    if (!this.pin) {
      throw new Error('未登录')
    }

    // 简化的签名实现（生产环境需要真实的加密算法）
    const dataStr = typeof data === 'string' ? data : JSON.stringify(data)
    const signature = `sig_${dataStr}_${this.pin}_${Date.now()}`

    return {
      data: dataStr,
      signature: signature,
      timestamp: Date.now()
    }
  }

  /**
   * 模拟数据加密
   */
  async encryptData(data) {
    if (!this.pin) {
      throw new Error('未登录')
    }

    // 简化的加密实现（生产环境需要 AES 等加密算法）
    const dataStr = typeof data === 'string' ? data : JSON.stringify(data)
    const encrypted = btoa(dataStr) // Base64 编码模拟加密

    return {
      encrypted: encrypted,
      algorithm: 'simulated',
      timestamp: Date.now()
    }
  }

  /**
   * 模拟数据解密
   */
  async decryptData(encryptedData) {
    if (!this.pin) {
      throw new Error('未登录')
    }

    try {
      const decrypted = atob(encryptedData) // Base64 解码模拟解密
      return decrypted
    } catch (error) {
      throw new Error('解密失败')
    }
  }
}

// 导出单例
export const auth = new AuthService()
export default AuthService
