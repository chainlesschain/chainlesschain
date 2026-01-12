/**
 * QR码扫描服务
 * 提供二维码扫描和生成功能
 */

class QRCodeService {
  constructor() {
    this.scanResult = null
  }

  /**
   * 扫描二维码
   * @param {Object} options - 扫描选项
   * @returns {Promise<string>} 扫描结果
   */
  async scanQRCode(options = {}) {
    const defaultOptions = {
      needResult: true, // 是否需要返回结果
      scanType: ['qrCode', 'barCode'], // 扫描类型
      autoDecodeCharset: true // 自动解码字符集
    }

    const config = { ...defaultOptions, ...options }

    return new Promise((resolve, reject) => {
      // #ifdef APP-PLUS
      // App环境使用原生扫码
      uni.scanCode({
        ...config,
        success: (res) => {
          console.log('扫码成功:', res)
          this.scanResult = res.result
          this.handleScanResult(res.result)
          resolve(res.result)
        },
        fail: (err) => {
          console.error('扫码失败:', err)
          reject(new Error('扫码失败'))
        }
      })
      // #endif

      // #ifdef MP-WEIXIN
      // 微信小程序环境
      uni.scanCode({
        ...config,
        success: (res) => {
          console.log('扫码成功:', res)
          this.scanResult = res.result
          this.handleScanResult(res.result)
          resolve(res.result)
        },
        fail: (err) => {
          console.error('扫码失败:', err)
          reject(new Error('扫码失败'))
        }
      })
      // #endif

      // #ifdef H5
      // H5环境使用第三方库或跳转到扫码页面
      uni.navigateTo({
        url: '/pages/qrcode/scan',
        events: {
          scanResult: (data) => {
            this.scanResult = data.result
            this.handleScanResult(data.result)
            resolve(data.result)
          }
        },
        fail: (err) => {
          reject(new Error('打开扫码页面失败'))
        }
      })
      // #endif
    })
  }

  /**
   * 从相册选择二维码
   * @returns {Promise<string>} 识别结果
   */
  async scanFromAlbum() {
    return new Promise((resolve, reject) => {
      uni.chooseImage({
        count: 1,
        sourceType: ['album'],
        success: async (res) => {
          try {
            const tempFilePath = res.tempFilePaths[0]
            const result = await this.decodeQRCode(tempFilePath)
            this.scanResult = result
            this.handleScanResult(result)
            resolve(result)
          } catch (error) {
            reject(error)
          }
        },
        fail: (err) => {
          reject(new Error('选择图片失败'))
        }
      })
    })
  }

  /**
   * 解码二维码图片
   * @param {string} imagePath - 图片路径
   * @returns {Promise<string>} 解码结果
   */
  async decodeQRCode(imagePath) {
    // #ifdef APP-PLUS
    return new Promise((resolve, reject) => {
      // 使用原生插件解码
      plus.barcode.scan(
        imagePath,
        (type, result) => {
          resolve(result)
        },
        (error) => {
          reject(new Error('二维码识别失败'))
        }
      )
    })
    // #endif

    // #ifdef H5 || MP-WEIXIN
    // 使用jsQR库解码
    try {
      const result = await this.decodeWithJsQR(imagePath)
      return result
    } catch (error) {
      throw new Error('二维码识别失败')
    }
    // #endif
  }

  /**
   * 使用jsQR解码（H5环境）
   * @param {string} imagePath - 图片路径
   * @returns {Promise<string>}
   */
  async decodeWithJsQR(imagePath) {
    // 这里需要引入jsQR库
    // import jsQR from 'jsqr'

    return new Promise((resolve, reject) => {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      const img = new Image()

      img.onload = () => {
        canvas.width = img.width
        canvas.height = img.height
        ctx.drawImage(img, 0, 0)

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const code = jsQR(imageData.data, imageData.width, imageData.height)

        if (code) {
          resolve(code.data)
        } else {
          reject(new Error('未识别到二维码'))
        }
      }

      img.onerror = () => {
        reject(new Error('图片加载失败'))
      }

      img.src = imagePath
    })
  }

  /**
   * 生成二维码
   * @param {string} content - 二维码内容
   * @param {Object} options - 生成选项
   * @returns {Promise<string>} 二维码图片路径
   */
  async generateQRCode(content, options = {}) {
    const defaultOptions = {
      size: 300, // 尺寸
      margin: 10, // 边距
      backgroundColor: '#ffffff', // 背景色
      foregroundColor: '#000000', // 前景色
      errorCorrectionLevel: 'M' // 纠错级别: L/M/Q/H
    }

    const config = { ...defaultOptions, ...options }

    try {
      // 使用uQRCode库生成二维码
      const qrcode = await this.generateWithUQRCode(content, config)
      return qrcode
    } catch (error) {
      console.error('生成二维码失败:', error)
      throw error
    }
  }

  /**
   * 使用uQRCode生成二维码
   * @param {string} content - 内容
   * @param {Object} options - 选项
   * @returns {Promise<string>}
   */
  async generateWithUQRCode(content, options) {
    // 这里需要引入uQRCode库
    // import uQRCode from '@/utils/uqrcode.js'

    return new Promise((resolve, reject) => {
      uQRCode.make({
        canvasId: 'qrcode-canvas',
        text: content,
        size: options.size,
        margin: options.margin,
        backgroundColor: options.backgroundColor,
        foregroundColor: options.foregroundColor,
        fileType: 'png',
        errorCorrectLevel: uQRCode.errorCorrectLevel[options.errorCorrectionLevel],
        success: (res) => {
          resolve(res)
        },
        fail: (err) => {
          reject(err)
        }
      })
    })
  }

  /**
   * 保存二维码到相册
   * @param {string} imagePath - 图片路径
   * @returns {Promise<void>}
   */
  async saveToAlbum(imagePath) {
    return new Promise((resolve, reject) => {
      // 先请求保存权限
      uni.authorize({
        scope: 'scope.writePhotosAlbum',
        success: () => {
          this.saveImage(imagePath).then(resolve).catch(reject)
        },
        fail: () => {
          // 权限被拒绝，引导用户打开设置
          uni.showModal({
            title: '权限申请',
            content: '需要相册权限才能保存图片',
            confirmText: '去设置',
            success: (res) => {
              if (res.confirm) {
                uni.openSetting()
              }
            }
          })
          reject(new Error('没有相册权限'))
        }
      })
    })
  }

  /**
   * 保存图片
   * @param {string} imagePath - 图片路径
   * @returns {Promise<void>}
   */
  async saveImage(imagePath) {
    return new Promise((resolve, reject) => {
      uni.saveImageToPhotosAlbum({
        filePath: imagePath,
        success: () => {
          uni.showToast({
            title: '已保存到相册',
            icon: 'success'
          })
          resolve()
        },
        fail: (err) => {
          console.error('保存失败:', err)
          uni.showToast({
            title: '保存失败',
            icon: 'none'
          })
          reject(new Error('保存失败'))
        }
      })
    })
  }

  /**
   * 处理扫描结果
   * @param {string} result - 扫描结果
   */
  handleScanResult(result) {
    console.log('扫描结果:', result)

    // 判断结果类型并处理
    if (this.isURL(result)) {
      // URL类型
      this.handleURL(result)
    } else if (this.isDIDIdentity(result)) {
      // DID身份
      this.handleDIDIdentity(result)
    } else if (this.isContactCard(result)) {
      // 联系人名片
      this.handleContactCard(result)
    } else if (this.isPaymentCode(result)) {
      // 支付码
      this.handlePaymentCode(result)
    } else {
      // 纯文本
      this.handlePlainText(result)
    }
  }

  /**
   * 判断是否为URL
   */
  isURL(text) {
    const urlPattern = /^(https?:\/\/)/i
    return urlPattern.test(text)
  }

  /**
   * 判断是否为DID身份
   */
  isDIDIdentity(text) {
    return text.startsWith('did:')
  }

  /**
   * 判断是否为联系人名片
   */
  isContactCard(text) {
    try {
      const data = JSON.parse(text)
      return data.type === 'contact' && data.did
    } catch {
      return false
    }
  }

  /**
   * 判断是否为支付码
   */
  isPaymentCode(text) {
    try {
      const data = JSON.parse(text)
      return data.type === 'payment'
    } catch {
      return false
    }
  }

  /**
   * 处理URL
   */
  handleURL(url) {
    uni.showModal({
      title: '打开链接',
      content: url,
      confirmText: '打开',
      success: (res) => {
        if (res.confirm) {
          // #ifdef APP-PLUS
          plus.runtime.openURL(url)
          // #endif

          // #ifdef H5 || MP-WEIXIN
          window.location.href = url
          // #endif
        }
      }
    })
  }

  /**
   * 处理DID身份
   */
  handleDIDIdentity(did) {
    uni.showModal({
      title: '添加好友',
      content: `DID: ${did}`,
      confirmText: '添加',
      success: (res) => {
        if (res.confirm) {
          uni.navigateTo({
            url: `/pages/social/friends/add?did=${encodeURIComponent(did)}`
          })
        }
      }
    })
  }

  /**
   * 处理联系人名片
   */
  handleContactCard(text) {
    try {
      const data = JSON.parse(text)
      uni.navigateTo({
        url: `/pages/social/friends/add?did=${encodeURIComponent(data.did)}&name=${encodeURIComponent(data.name || '')}`
      })
    } catch (error) {
      console.error('解析名片失败:', error)
    }
  }

  /**
   * 处理支付码
   */
  handlePaymentCode(text) {
    try {
      const data = JSON.parse(text)
      uni.navigateTo({
        url: `/pages/trade/payment?code=${encodeURIComponent(text)}`
      })
    } catch (error) {
      console.error('解析支付码失败:', error)
    }
  }

  /**
   * 处理纯文本
   */
  handlePlainText(text) {
    uni.showModal({
      title: '扫描结果',
      content: text,
      showCancel: true,
      confirmText: '复制',
      success: (res) => {
        if (res.confirm) {
          uni.setClipboardData({
            data: text,
            success: () => {
              uni.showToast({
                title: '已复制',
                icon: 'success'
              })
            }
          })
        }
      }
    })
  }

  /**
   * 生成联系人名片二维码
   * @param {Object} contact - 联系人信息
   * @returns {Promise<string>}
   */
  async generateContactCard(contact) {
    const cardData = {
      type: 'contact',
      did: contact.did,
      name: contact.name,
      avatar: contact.avatar,
      timestamp: Date.now()
    }

    const content = JSON.stringify(cardData)
    return await this.generateQRCode(content)
  }

  /**
   * 生成支付二维码
   * @param {Object} paymentInfo - 支付信息
   * @returns {Promise<string>}
   */
  async generatePaymentCode(paymentInfo) {
    const paymentData = {
      type: 'payment',
      address: paymentInfo.address,
      amount: paymentInfo.amount,
      currency: paymentInfo.currency,
      memo: paymentInfo.memo,
      timestamp: Date.now()
    }

    const content = JSON.stringify(paymentData)
    return await this.generateQRCode(content)
  }

  /**
   * 获取最后扫描结果
   * @returns {string}
   */
  getLastScanResult() {
    return this.scanResult
  }

  /**
   * 清除扫描结果
   */
  clearScanResult() {
    this.scanResult = null
  }
}

// 导出单例
export default new QRCodeService()
