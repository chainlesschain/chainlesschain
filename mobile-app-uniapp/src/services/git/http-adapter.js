/**
 * HTTP适配器 (移动端版本)
 *
 * 将uni.request适配为isomorphic-git所需的HTTP接口
 *
 * isomorphic-git的HTTP客户端需要实现:
 * - request({ url, method, headers, body })
 */

/**
 * HTTP客户端适配器
 */
class HTTPAdapter {
  /**
   * 发送HTTP请求
   * @param {Object} options - 请求选项
   * @param {string} options.url - 请求URL
   * @param {string} options.method - 请求方法
   * @param {Object} options.headers - 请求头
   * @param {*} options.body - 请求体
   * @returns {Promise<Object>}
   */
  async request(options) {
    const { url, method = 'GET', headers = {}, body } = options

    console.log('[HTTPAdapter] 请求:', method, url)

    return new Promise((resolve, reject) => {
      uni.request({
        url,
        method,
        header: headers,
        data: body,
        responseType: 'arraybuffer', // Git需要处理二进制数据
        timeout: 30000,
        success: (res) => {
          console.log('[HTTPAdapter] 响应:', res.statusCode, url)

          // 转换响应格式
          const response = {
            url,
            method,
            statusCode: res.statusCode,
            statusMessage: this.getStatusMessage(res.statusCode),
            headers: res.header || {},
            body: res.data
          }

          resolve(response)
        },
        fail: (err) => {
          console.error('[HTTPAdapter] 请求失败:', err)
          reject(new Error(`HTTP请求失败: ${url}, ${err.errMsg || err.message}`))
        }
      })
    })
  }

  /**
   * 获取状态消息
   * @param {number} statusCode - 状态码
   * @returns {string}
   */
  getStatusMessage(statusCode) {
    const messages = {
      200: 'OK',
      201: 'Created',
      204: 'No Content',
      301: 'Moved Permanently',
      302: 'Found',
      304: 'Not Modified',
      400: 'Bad Request',
      401: 'Unauthorized',
      403: 'Forbidden',
      404: 'Not Found',
      500: 'Internal Server Error',
      502: 'Bad Gateway',
      503: 'Service Unavailable'
    }

    return messages[statusCode] || 'Unknown'
  }
}

// 创建单例
let httpAdapterInstance = null

/**
 * 获取HTTP适配器实例
 * @returns {HTTPAdapter}
 */
export function getHTTPAdapter() {
  if (!httpAdapterInstance) {
    httpAdapterInstance = new HTTPAdapter()
  }
  return httpAdapterInstance
}

export default HTTPAdapter
