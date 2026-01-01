/**
 * 知识导入导出服务
 * 支持 Markdown、纯文本、JSON 格式
 */
import { db } from './database'

class ImportExportService {
  constructor() {
    this.supportedFormats = ['markdown', 'text', 'json']
  }

  /**
   * 导出单个知识为 Markdown 格式
   * @param {Object} knowledge - 知识对象
   * @returns {string} Markdown 内容
   */
  exportToMarkdown(knowledge) {
    let markdown = ''

    // 添加标题
    markdown += `# ${knowledge.title}\n\n`

    // 添加元数据
    markdown += `---\n`
    markdown += `创建时间: ${this.formatDate(knowledge.created_at)}\n`
    markdown += `更新时间: ${this.formatDate(knowledge.updated_at)}\n`
    markdown += `类型: ${this.getTypeLabel(knowledge.type)}\n`

    // 添加标签
    if (knowledge.tags && knowledge.tags.length > 0) {
      markdown += `标签: ${knowledge.tags.map(t => `#${t.name}`).join(' ')}\n`
    }

    // 添加文件夹
    if (knowledge.folder_name) {
      markdown += `文件夹: ${knowledge.folder_name}\n`
    }

    markdown += `---\n\n`

    // 添加内容
    markdown += knowledge.content || ''

    // 添加关联知识
    if (knowledge.links && knowledge.links.length > 0) {
      markdown += `\n\n## 关联知识\n\n`
      knowledge.links.forEach(link => {
        markdown += `- [[${link.title}]]\n`
      })
    }

    return markdown
  }

  /**
   * 导出单个知识为纯文本格式
   * @param {Object} knowledge - 知识对象
   * @returns {string} 纯文本内容
   */
  exportToText(knowledge) {
    let text = ''

    // 添加标题
    text += `${knowledge.title}\n`
    text += `${'='.repeat(knowledge.title.length)}\n\n`

    // 添加元数据
    text += `创建时间: ${this.formatDate(knowledge.created_at)}\n`
    text += `更新时间: ${this.formatDate(knowledge.updated_at)}\n`
    text += `类型: ${this.getTypeLabel(knowledge.type)}\n`

    if (knowledge.tags && knowledge.tags.length > 0) {
      text += `标签: ${knowledge.tags.map(t => t.name).join(', ')}\n`
    }

    if (knowledge.folder_name) {
      text += `文件夹: ${knowledge.folder_name}\n`
    }

    text += `\n${'-'.repeat(50)}\n\n`

    // 添加内容
    text += knowledge.content || ''

    return text
  }

  /**
   * 导出单个知识为 JSON 格式
   * @param {Object} knowledge - 知识对象
   * @returns {string} JSON 内容
   */
  exportToJSON(knowledge) {
    const exportData = {
      version: '1.0.0',
      exportTime: Date.now(),
      knowledge: {
        title: knowledge.title,
        content: knowledge.content,
        type: knowledge.type,
        tags: knowledge.tags || [],
        folder_name: knowledge.folder_name || null,
        created_at: knowledge.created_at,
        updated_at: knowledge.updated_at,
        links: knowledge.links || []
      }
    }

    return JSON.stringify(exportData, null, 2)
  }

  /**
   * 导出知识
   * @param {Object} knowledge - 知识对象
   * @param {string} format - 格式 (markdown/text/json)
   * @returns {Object} { content, filename, mimeType }
   */
  exportKnowledge(knowledge, format = 'markdown') {
    let content = ''
    let extension = ''
    let mimeType = ''

    switch (format) {
      case 'markdown':
        content = this.exportToMarkdown(knowledge)
        extension = 'md'
        mimeType = 'text/markdown'
        break
      case 'text':
        content = this.exportToText(knowledge)
        extension = 'txt'
        mimeType = 'text/plain'
        break
      case 'json':
        content = this.exportToJSON(knowledge)
        extension = 'json'
        mimeType = 'application/json'
        break
      default:
        throw new Error(`不支持的格式: ${format}`)
    }

    // 生成安全的文件名
    const safeTitle = this.sanitizeFilename(knowledge.title)
    const timestamp = this.formatDateForFilename(Date.now())
    const filename = `${safeTitle}_${timestamp}.${extension}`

    return {
      content,
      filename,
      mimeType
    }
  }

  /**
   * 批量导出知识
   * @param {Array} knowledgeList - 知识列表
   * @param {string} format - 格式
   * @returns {Object} 导出结果
   */
  exportBatch(knowledgeList, format = 'markdown') {
    if (format === 'json') {
      // JSON 格式支持多个知识在一个文件中
      const exportData = {
        version: '1.0.0',
        exportTime: Date.now(),
        count: knowledgeList.length,
        knowledge: knowledgeList.map(k => ({
          title: k.title,
          content: k.content,
          type: k.type,
          tags: k.tags || [],
          folder_name: k.folder_name || null,
          created_at: k.created_at,
          updated_at: k.updated_at,
          links: k.links || []
        }))
      }

      const timestamp = this.formatDateForFilename(Date.now())
      return {
        files: [{
          content: JSON.stringify(exportData, null, 2),
          filename: `knowledge_batch_${timestamp}.json`,
          mimeType: 'application/json'
        }]
      }
    } else {
      // Markdown 和 Text 格式为每个知识创建单独文件
      const files = knowledgeList.map(knowledge =>
        this.exportKnowledge(knowledge, format)
      )
      return { files }
    }
  }

  /**
   * 从 Markdown 导入知识
   * @param {string} content - Markdown 内容
   * @param {string} filename - 文件名
   * @returns {Object} 解析后的知识对象
   */
  importFromMarkdown(content, filename = '') {
    const knowledge = {
      title: '',
      content: '',
      type: 'note',
      tags: [],
      folder_name: null
    }

    // 提取元数据（YAML Front Matter）
    const frontMatterMatch = content.match(/^---\n([\s\S]*?)\n---\n/)
    let mainContent = content

    if (frontMatterMatch) {
      const frontMatter = frontMatterMatch[1]
      mainContent = content.replace(frontMatterMatch[0], '')

      // 解析元数据
      const lines = frontMatter.split('\n')
      lines.forEach(line => {
        const [key, ...valueParts] = line.split(':')
        const value = valueParts.join(':').trim()

        if (key === '标签' && value) {
          // 解析标签 #tag1 #tag2
          knowledge.tags = value.match(/#[\u4e00-\u9fa5\w]+/g)?.map(t => ({
            name: t.substring(1)
          })) || []
        } else if (key === '文件夹' && value) {
          knowledge.folder_name = value
        } else if (key === '类型' && value) {
          knowledge.type = this.parseTypeLabel(value)
        }
      })

      // 移除关联知识部分（暂不导入关联）
      mainContent = mainContent.replace(/\n## 关联知识\n\n[\s\S]*$/, '')
    }

    // 提取标题（第一个 # 标题）
    const titleMatch = mainContent.match(/^#\s+(.+)$/m)
    if (titleMatch) {
      knowledge.title = titleMatch[1].trim()
      mainContent = mainContent.replace(titleMatch[0], '').trim()
    } else {
      // 如果没有标题，使用文件名
      knowledge.title = filename.replace(/\.(md|txt|json)$/, '') || '未命名知识'
    }

    knowledge.content = mainContent.trim()

    return knowledge
  }

  /**
   * 从纯文本导入知识
   * @param {string} content - 文本内容
   * @param {string} filename - 文件名
   * @returns {Object} 解析后的知识对象
   */
  importFromText(content, filename = '') {
    const knowledge = {
      title: '',
      content: '',
      type: 'note',
      tags: [],
      folder_name: null
    }

    // 尝试提取第一行作为标题
    const lines = content.split('\n')
    let contentStartIndex = 0

    if (lines.length > 0) {
      const firstLine = lines[0].trim()

      // 检查是否有分隔线
      if (lines.length > 1 && /^=+$/.test(lines[1].trim())) {
        knowledge.title = firstLine
        contentStartIndex = 2
      } else if (firstLine.length > 0 && firstLine.length < 100) {
        // 如果第一行不太长，作为标题
        knowledge.title = firstLine
        contentStartIndex = 1
      }
    }

    // 如果没有提取到标题，使用文件名
    if (!knowledge.title) {
      knowledge.title = filename.replace(/\.(md|txt|json)$/, '') || '未命名知识'
    }

    // 剩余部分作为内容
    knowledge.content = lines.slice(contentStartIndex).join('\n').trim()

    // 移除元数据部分（如果有）
    knowledge.content = knowledge.content.replace(/^-{10,}\n[\s\S]*?\n-{10,}\n/m, '').trim()

    return knowledge
  }

  /**
   * 从 JSON 导入知识
   * @param {string} content - JSON 内容
   * @returns {Array} 知识对象数组
   */
  importFromJSON(content) {
    try {
      const data = JSON.parse(content)

      // 检查是否是批量导出的格式
      if (data.knowledge && Array.isArray(data.knowledge)) {
        return data.knowledge.map(k => ({
          title: k.title || '未命名知识',
          content: k.content || '',
          type: k.type || 'note',
          tags: k.tags || [],
          folder_name: k.folder_name || null
        }))
      }

      // 单个知识格式
      if (data.knowledge && typeof data.knowledge === 'object') {
        return [{
          title: data.knowledge.title || '未命名知识',
          content: data.knowledge.content || '',
          type: data.knowledge.type || 'note',
          tags: data.knowledge.tags || [],
          folder_name: data.knowledge.folder_name || null
        }]
      }

      throw new Error('无效的 JSON 格式')
    } catch (error) {
      console.error('JSON 解析失败:', error)
      throw new Error('JSON 格式错误: ' + error.message)
    }
  }

  /**
   * 导入知识
   * @param {string} content - 文件内容
   * @param {string} filename - 文件名
   * @returns {Promise<Array>} 导入的知识对象数组
   */
  async importKnowledge(content, filename) {
    const extension = filename.split('.').pop().toLowerCase()
    let knowledgeList = []

    try {
      switch (extension) {
        case 'md':
        case 'markdown':
          knowledgeList = [this.importFromMarkdown(content, filename)]
          break
        case 'txt':
          knowledgeList = [this.importFromText(content, filename)]
          break
        case 'json':
          knowledgeList = this.importFromJSON(content)
          break
        default:
          throw new Error(`不支持的文件格式: ${extension}`)
      }

      return knowledgeList
    } catch (error) {
      console.error('导入失败:', error)
      throw error
    }
  }

  /**
   * 保存导入的知识到数据库
   * @param {Array} knowledgeList - 知识列表
   * @returns {Promise<Object>} 导入结果统计
   */
  async saveImportedKnowledge(knowledgeList) {
    const stats = {
      success: 0,
      failed: 0,
      total: knowledgeList.length,
      errors: []
    }

    for (const knowledge of knowledgeList) {
      try {
        // 保存知识
        const item = await db.addKnowledgeItem({
          title: knowledge.title,
          content: knowledge.content,
          type: knowledge.type
        })

        // 保存标签
        if (knowledge.tags && knowledge.tags.length > 0) {
          for (const tag of knowledge.tags) {
            try {
              // 尝试创建或获取标签
              const existingTags = await db.getTags()
              let tagObj = existingTags.find(t => t.name === tag.name)

              if (!tagObj) {
                tagObj = await db.createTag(tag.name, this.getRandomColor())
              }

              // 关联标签
              await db.addTagToKnowledge(item.id, tagObj.id)
            } catch (tagError) {
              console.error('标签处理失败:', tagError)
            }
          }
        }

        stats.success++
      } catch (error) {
        console.error('保存知识失败:', error)
        stats.failed++
        stats.errors.push({
          title: knowledge.title,
          error: error.message
        })
      }
    }

    return stats
  }

  /**
   * 保存文件到本地（使用 uni API）
   * @param {string} content - 文件内容
   * @param {string} filename - 文件名
   * @returns {Promise<string>} 文件路径
   */
  async saveFile(content, filename) {
    return new Promise((resolve, reject) => {
      // 在 H5 平台，使用下载方式
      // #ifdef H5
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      link.click()
      URL.revokeObjectURL(url)
      resolve(filename)
      // #endif

      // 在 App 平台，使用文件系统
      // #ifndef H5
      const fs = uni.getFileSystemManager()
      const filePath = `${uni.env.USER_DATA_PATH}/${filename}`

      fs.writeFile({
        filePath,
        data: content,
        encoding: 'utf8',
        success: () => {
          resolve(filePath)
        },
        fail: (error) => {
          reject(new Error('保存文件失败: ' + error.errMsg))
        }
      })
      // #endif
    })
  }

  /**
   * 读取文件内容（使用 uni API）
   * @param {string} filePath - 文件路径
   * @returns {Promise<string>} 文件内容
   */
  async readFile(filePath) {
    return new Promise((resolve, reject) => {
      // #ifdef H5
      // H5 平台通过 input[type=file] 读取
      reject(new Error('H5 平台请使用文件选择器'))
      // #endif

      // #ifndef H5
      const fs = uni.getFileSystemManager()
      fs.readFile({
        filePath,
        encoding: 'utf8',
        success: (res) => {
          resolve(res.data)
        },
        fail: (error) => {
          reject(new Error('读取文件失败: ' + error.errMsg))
        }
      })
      // #endif
    })
  }

  // ========== 工具方法 ==========

  /**
   * 格式化日期
   */
  formatDate(timestamp) {
    const date = new Date(timestamp)
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    const hour = String(date.getHours()).padStart(2, '0')
    const minute = String(date.getMinutes()).padStart(2, '0')
    return `${year}-${month}-${day} ${hour}:${minute}`
  }

  /**
   * 格式化日期用于文件名
   */
  formatDateForFilename(timestamp) {
    const date = new Date(timestamp)
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    const hour = String(date.getHours()).padStart(2, '0')
    const minute = String(date.getMinutes()).padStart(2, '0')
    const second = String(date.getSeconds()).padStart(2, '0')
    return `${year}${month}${day}_${hour}${minute}${second}`
  }

  /**
   * 清理文件名中的非法字符
   */
  sanitizeFilename(filename) {
    return filename
      .replace(/[<>:"/\\|?*]/g, '_')
      .replace(/\s+/g, '_')
      .substring(0, 50)
  }

  /**
   * 获取类型标签
   */
  getTypeLabel(type) {
    const typeMap = {
      note: '笔记',
      document: '文档',
      code: '代码',
      link: '链接'
    }
    return typeMap[type] || '笔记'
  }

  /**
   * 解析类型标签
   */
  parseTypeLabel(label) {
    const labelMap = {
      '笔记': 'note',
      '文档': 'document',
      '代码': 'code',
      '链接': 'link'
    }
    return labelMap[label] || 'note'
  }

  /**
   * 获取随机颜色
   */
  getRandomColor() {
    const colors = ['#f50', '#2db7f5', '#87d068', '#108ee9', '#f5317f', '#7265e6', '#ffbf00', '#00a2ae']
    return colors[Math.floor(Math.random() * colors.length)]
  }
}

// 导出单例
export const importExport = new ImportExportService()
export default ImportExportService
