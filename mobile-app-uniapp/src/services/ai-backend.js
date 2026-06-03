/**
 * 后端AI服务封装
 *
 * 功能：
 * - 封装对 backend/ai-service 的HTTP请求
 * - 普通对话接口
 * - 客户端模拟流式对话
 * - RAG查询接口
 */

class AIBackendService {
  constructor() {
    // 开发环境：http://localhost:8001
    // 生产环境：需要配置实际的后端地址
    this.baseURL = 'http://localhost:8001'
  }

  /**
   * 设置后端地址
   * @param {string} url - 后端服务地址
   */
  setBaseURL(url) {
    this.baseURL = url
  }

  /**
   * 普通对话（非流式）
   * @param {Array} messages - 消息历史 [{ role: 'user'|'assistant', content: '...' }]
   * @param {Object} options - 选项
   * @returns {Promise<Object>} - { content, model, usage }
   */
  async chat(messages, options = {}) {
    return new Promise((resolve, reject) => {
      uni.request({
        url: `${this.baseURL}/api/chat`,
        method: 'POST',
        header: {
          'Content-Type': 'application/json'
        },
        data: {
          messages,
          model: options.model,
          temperature: options.temperature || 0.7,
          max_tokens: options.maxTokens || 2000
        },
        timeout: 60000, // 60秒超时
        success: (res) => {
          if (res.statusCode === 200) {
            resolve({
              content: res.data.response || res.data.content || res.data.message,
              model: res.data.model || 'unknown',
              usage: res.data.usage || { total_tokens: 0 }
            })
          } else {
            reject(new Error(`API错误: ${res.statusCode} - ${res.data?.error || '未知错误'}`))
          }
        },
        fail: (err) => {
          console.error('网络请求失败:', err)
          reject(new Error(`网络请求失败: ${err.errMsg}`))
        }
      })
    })
  }

  /**
   * 模拟流式对话（客户端逐字显示）
   * @param {Array} messages - 消息历史
   * @param {Function} onChunk - 回调函数 ({ type: 'chunk'|'complete', content, done })
   * @param {Object} options - 选项
   * @returns {Promise<Object>}
   */
  async chatStream(messages, onChunk, options = {}) {
    try {
      // 1. 发送普通请求获取完整响应
      const result = await this.chat(messages, options)
      const fullContent = result.content

      if (!fullContent) {
        onChunk({ type: 'complete', content: '', done: true })
        return result
      }

      // 2. 客户端模拟逐字显示
      return new Promise((resolve) => {
        let index = 0
        const chunkSize = 2  // 每次显示2个字符
        const interval = 30  // 30ms间隔

        const timer = setInterval(() => {
          if (index >= fullContent.length) {
            clearInterval(timer)
            onChunk({
              type: 'complete',
              content: fullContent,
              done: true
            })
            resolve(result)
            return
          }

          // 智能分割：中文按字，英文按词
          let end = index + chunkSize

          // 检测是否为中文字符
          if (this._isChinese(fullContent[index])) {
            end = index + 1
          } else {
            // 英文按词分割
            const nextSpace = fullContent.indexOf(' ', index)
            end = Math.min(
              nextSpace > -1 ? nextSpace + 1 : fullContent.length,
              index + 15
            )
          }

          const chunk = fullContent.substring(index, end)
          index = end

          onChunk({
            type: 'chunk',
            content: chunk,
            done: false
          })
        }, interval)
      })
    } catch (error) {
      console.error('流式对话失败:', error)
      throw error
    }
  }

  /**
   * RAG查询（检索知识库）
   * @param {string} query - 查询问题
   * @param {Object} options - 选项
   * @returns {Promise<Object>} - { results: [...], total }
   */
  async ragQuery(query, options = {}) {
    return new Promise((resolve, reject) => {
      uni.request({
        url: `${this.baseURL}/api/rag/query`,
        method: 'POST',
        header: {
          'Content-Type': 'application/json'
        },
        data: {
          query,
          top_k: options.topK || 5,
          min_score: options.minScore || 0.3
        },
        timeout: 30000,
        success: (res) => {
          if (res.statusCode === 200) {
            resolve({
              results: res.data.results || [],
              total: res.data.total || 0
            })
          } else {
            reject(new Error(`RAG查询失败: ${res.statusCode}`))
          }
        },
        fail: (err) => {
          console.error('RAG查询网络错误:', err)
          reject(new Error(`网络请求失败: ${err.errMsg}`))
        }
      })
    })
  }

  /**
   * 增强型RAG查询（带重排序）
   * @param {string} query - 查询问题
   * @param {Object} options - 选项
   * @returns {Promise<Object>}
   */
  async ragQueryEnhanced(query, options = {}) {
    return new Promise((resolve, reject) => {
      uni.request({
        url: `${this.baseURL}/api/rag/query/enhanced`,
        method: 'POST',
        header: {
          'Content-Type': 'application/json'
        },
        data: {
          query,
          top_k: options.topK || 5,
          use_reranker: options.useReranker !== false,
          sources: options.sources || ['project', 'knowledge']
        },
        timeout: 30000,
        success: (res) => {
          if (res.statusCode === 200) {
            resolve({
              results: res.data.results || [],
              total: res.data.total || 0,
              context: res.data.context || ''
            })
          } else {
            reject(new Error(`增强RAG查询失败: ${res.statusCode}`))
          }
        },
        fail: (err) => {
          console.error('增强RAG查询网络错误:', err)
          reject(new Error(`网络请求失败: ${err.errMsg}`))
        }
      })
    })
  }

  /**
   * 检查服务状态
   * @returns {Promise<boolean>}
   */
  async checkStatus() {
    return new Promise((resolve) => {
      uni.request({
        url: `${this.baseURL}/health`,
        method: 'GET',
        timeout: 5000,
        success: (res) => {
          resolve(res.statusCode === 200)
        },
        fail: () => {
          resolve(false)
        }
      })
    })
  }

  /**
   * 判断是否为中文字符
   * @private
   */
  _isChinese(char) {
    if (!char) return false
    return /[\u4e00-\u9fa5]/.test(char)
  }
}

// 导出单例
export default new AIBackendService()
