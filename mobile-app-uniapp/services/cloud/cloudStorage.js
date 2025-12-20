/**
 * 云存储服务抽象接口
 * 支持多种云存储提供商
 */

/**
 * 云存储提供商基类
 */
export class CloudStorageProvider {
  constructor(config) {
    this.config = config
  }

  /**
   * 上传文件
   * @param {string} fileName - 文件名
   * @param {string} content - 文件内容
   * @returns {Promise<Object>} 上传结果
   */
  async upload(fileName, content) {
    throw new Error('upload() must be implemented')
  }

  /**
   * 下载文件
   * @param {string} fileName - 文件名
   * @returns {Promise<string>} 文件内容
   */
  async download(fileName) {
    throw new Error('download() must be implemented')
  }

  /**
   * 列出所有文件
   * @returns {Promise<Array>} 文件列表
   */
  async list() {
    throw new Error('list() must be implemented')
  }

  /**
   * 删除文件
   * @param {string} fileName - 文件名
   * @returns {Promise<void>}
   */
  async delete(fileName) {
    throw new Error('delete() must be implemented')
  }

  /**
   * 检查连接是否正常
   * @returns {Promise<boolean>}
   */
  async testConnection() {
    throw new Error('testConnection() must be implemented')
  }
}

/**
 * WebDAV 云存储提供商
 * 支持坚果云、NextCloud等WebDAV服务
 */
export class WebDAVProvider extends CloudStorageProvider {
  constructor(config) {
    super(config)
    // config: { url, username, password, basePath }
    this.baseUrl = config.url.replace(/\/$/, '')
    this.basePath = (config.basePath || '/chainless-backup').replace(/\/$/, '')
    this.auth = 'Basic ' + uni.arrayBufferToBase64(
      new TextEncoder().encode(`${config.username}:${config.password}`)
    )
  }

  /**
   * 发送 WebDAV 请求
   */
  async _request(method, path, data = null, headers = {}) {
    const url = `${this.baseUrl}${this.basePath}${path}`

    return new Promise((resolve, reject) => {
      uni.request({
        url,
        method,
        data,
        header: {
          'Authorization': this.auth,
          ...headers
        },
        timeout: 30000,
        success: (res) => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(res)
          } else {
            reject(new Error(`WebDAV request failed: ${res.statusCode}`))
          }
        },
        fail: (err) => {
          reject(new Error('网络请求失败: ' + err.errMsg))
        }
      })
    })
  }

  /**
   * 确保目录存在
   */
  async _ensureDirectory() {
    try {
      await this._request('MKCOL', '')
    } catch (error) {
      // 目录可能已存在，忽略错误
      console.log('Directory might already exist:', error.message)
    }
  }

  async upload(fileName, content) {
    try {
      await this._ensureDirectory()

      await this._request('PUT', `/${fileName}`, content, {
        'Content-Type': 'application/json'
      })

      return {
        success: true,
        fileName,
        size: content.length,
        uploadTime: Date.now()
      }
    } catch (error) {
      console.error('WebDAV upload failed:', error)
      throw new Error('上传失败: ' + error.message)
    }
  }

  async download(fileName) {
    try {
      const res = await this._request('GET', `/${fileName}`)
      return res.data
    } catch (error) {
      console.error('WebDAV download failed:', error)
      throw new Error('下载失败: ' + error.message)
    }
  }

  async list() {
    try {
      await this._ensureDirectory()

      const res = await this._request('PROPFIND', '', null, {
        'Depth': '1',
        'Content-Type': 'application/xml'
      })

      // 解析 WebDAV PROPFIND 响应
      return this._parseFileList(res.data)
    } catch (error) {
      console.error('WebDAV list failed:', error)
      // 如果目录不存在，返回空列表
      return []
    }
  }

  async delete(fileName) {
    try {
      await this._request('DELETE', `/${fileName}`)
    } catch (error) {
      console.error('WebDAV delete failed:', error)
      throw new Error('删除失败: ' + error.message)
    }
  }

  async testConnection() {
    try {
      await this._ensureDirectory()
      return true
    } catch (error) {
      console.error('WebDAV connection test failed:', error)
      return false
    }
  }

  /**
   * 解析文件列表
   */
  _parseFileList(xmlData) {
    try {
      // 简单的 XML 解析（生产环境应使用专业的 XML 解析器）
      const files = []
      const regex = /<d:href>([^<]+)<\/d:href>[\s\S]*?<d:getcontentlength>(\d+)<\/d:getcontentlength>[\s\S]*?<d:getlastmodified>([^<]+)<\/d:getlastmodified>/g

      let match
      while ((match = regex.exec(xmlData)) !== null) {
        const path = decodeURIComponent(match[1])
        const fileName = path.split('/').pop()

        // 只返回 .json 文件
        if (fileName && fileName.endsWith('.json')) {
          files.push({
            fileName,
            size: parseInt(match[2]),
            lastModified: new Date(match[3]).getTime()
          })
        }
      }

      return files
    } catch (error) {
      console.error('Parse file list failed:', error)
      return []
    }
  }
}

/**
 * 简单 HTTP 云存储提供商
 * 支持使用预签名 URL 的对象存储服务
 */
export class SimpleHTTPProvider extends CloudStorageProvider {
  constructor(config) {
    super(config)
    // config: { apiUrl, apiKey }
    this.apiUrl = config.apiUrl.replace(/\/$/, '')
    this.apiKey = config.apiKey
  }

  async _request(method, endpoint, data = null) {
    const url = `${this.apiUrl}${endpoint}`

    return new Promise((resolve, reject) => {
      uni.request({
        url,
        method,
        data,
        header: {
          'X-API-Key': this.apiKey,
          'Content-Type': 'application/json'
        },
        timeout: 30000,
        success: (res) => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(res.data)
          } else {
            reject(new Error(`HTTP request failed: ${res.statusCode}`))
          }
        },
        fail: (err) => {
          reject(new Error('网络请求失败: ' + err.errMsg))
        }
      })
    })
  }

  async upload(fileName, content) {
    try {
      const result = await this._request('POST', '/upload', {
        fileName,
        content
      })

      return {
        success: true,
        fileName,
        size: content.length,
        uploadTime: Date.now(),
        ...result
      }
    } catch (error) {
      console.error('HTTP upload failed:', error)
      throw new Error('上传失败: ' + error.message)
    }
  }

  async download(fileName) {
    try {
      const result = await this._request('GET', `/download/${fileName}`)
      return result.content || result
    } catch (error) {
      console.error('HTTP download failed:', error)
      throw new Error('下载失败: ' + error.message)
    }
  }

  async list() {
    try {
      const result = await this._request('GET', '/list')
      return result.files || []
    } catch (error) {
      console.error('HTTP list failed:', error)
      return []
    }
  }

  async delete(fileName) {
    try {
      await this._request('DELETE', `/delete/${fileName}`)
    } catch (error) {
      console.error('HTTP delete failed:', error)
      throw new Error('删除失败: ' + error.message)
    }
  }

  async testConnection() {
    try {
      await this._request('GET', '/ping')
      return true
    } catch (error) {
      console.error('HTTP connection test failed:', error)
      return false
    }
  }
}

/**
 * 云存储工厂类
 */
export class CloudStorageFactory {
  static create(type, config) {
    switch (type) {
      case 'webdav':
        return new WebDAVProvider(config)
      case 'http':
        return new SimpleHTTPProvider(config)
      default:
        throw new Error(`Unknown cloud storage type: ${type}`)
    }
  }

  /**
   * 获取支持的提供商列表
   */
  static getSupportedProviders() {
    return [
      {
        type: 'webdav',
        name: 'WebDAV',
        description: '支持坚果云、NextCloud等',
        configFields: [
          { key: 'url', label: 'WebDAV 地址', type: 'text', placeholder: 'https://dav.jianguoyun.com/dav/' },
          { key: 'username', label: '用户名', type: 'text', placeholder: '邮箱地址' },
          { key: 'password', label: '密码', type: 'password', placeholder: '应用密码' },
          { key: 'basePath', label: '备份目录', type: 'text', placeholder: '/chainless-backup', default: '/chainless-backup' }
        ]
      },
      {
        type: 'http',
        name: '自定义 HTTP API',
        description: '使用自己的云存储 API',
        configFields: [
          { key: 'apiUrl', label: 'API 地址', type: 'text', placeholder: 'https://api.example.com' },
          { key: 'apiKey', label: 'API 密钥', type: 'password', placeholder: '您的 API 密钥' }
        ]
      }
    ]
  }
}
