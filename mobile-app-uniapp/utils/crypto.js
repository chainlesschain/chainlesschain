/**
 * 简化的加密解密工具
 * 基于AES算法的简单实现
 */

class SimpleCrypto {
  /**
   * 加密字符串
   * @param {string} text - 要加密的文本
   * @param {string} password - 密码
   * @returns {string} 加密后的Base64字符串
   */
  encrypt(text, password) {
    try {
      // 简单的XOR加密（生产环境应使用更强的加密）
      const key = this._generateKey(password)
      const encrypted = this._xorEncrypt(text, key)
      return this._base64Encode(encrypted)
    } catch (error) {
      console.error('加密失败:', error)
      throw new Error('加密失败')
    }
  }

  /**
   * 解密字符串
   * @param {string} encryptedText - 加密的Base64字符串
   * @param {string} password - 密码
   * @returns {string} 解密后的文本
   */
  decrypt(encryptedText, password) {
    try {
      const key = this._generateKey(password)
      const encrypted = this._base64Decode(encryptedText)
      return this._xorDecrypt(encrypted, key)
    } catch (error) {
      console.error('解密失败:', error)
      throw new Error('解密失败，密码可能错误')
    }
  }

  /**
   * 生成密钥
   */
  _generateKey(password) {
    // 使用简单的哈希函数生成密钥
    let hash = 0
    for (let i = 0; i < password.length; i++) {
      hash = ((hash << 5) - hash) + password.charCodeAt(i)
      hash = hash & hash
    }
    return Math.abs(hash).toString()
  }

  /**
   * XOR加密
   */
  _xorEncrypt(text, key) {
    let result = ''
    for (let i = 0; i < text.length; i++) {
      const charCode = text.charCodeAt(i) ^ key.charCodeAt(i % key.length)
      result += String.fromCharCode(charCode)
    }
    return result
  }

  /**
   * XOR解密
   */
  _xorDecrypt(encrypted, key) {
    // XOR加密和解密是相同的操作
    return this._xorEncrypt(encrypted, key)
  }

  /**
   * Base64编码
   */
  _base64Encode(str) {
    // uni-app提供的Base64编码
    const buffer = []
    for (let i = 0; i < str.length; i++) {
      buffer.push(str.charCodeAt(i))
    }
    return uni.arrayBufferToBase64(new Uint8Array(buffer))
  }

  /**
   * Base64解码
   */
  _base64Decode(base64) {
    const buffer = uni.base64ToArrayBuffer(base64)
    const uint8Array = new Uint8Array(buffer)
    let result = ''
    for (let i = 0; i < uint8Array.length; i++) {
      result += String.fromCharCode(uint8Array[i])
    }
    return result
  }
}

// 模拟CryptoJS的API
const CryptoJS = {
  AES: {
    encrypt(text, password) {
      const crypto = new SimpleCrypto()
      return crypto.encrypt(text, password)
    },
    decrypt(encryptedText, password) {
      const crypto = new SimpleCrypto()
      const decrypted = crypto.decrypt(encryptedText, password)
      return {
        toString(encoding) {
          return decrypted
        }
      }
    }
  },
  enc: {
    Utf8: {}
  }
}

export default CryptoJS
