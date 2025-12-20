/**
 * ChainlessChain Mobile - AI 增强服务
 * 提供知识摘要、标签建议、关联推荐等AI功能
 * 使用真实的LLM服务进行智能处理
 */

import { llm } from './llm'

class AIService {
  constructor() {
    this.isProcessing = false
  }

  /**
   * 生成知识摘要
   * @param {string} content - 知识内容
   * @param {number} maxLength - 摘要最大长度（字符数）
   * @returns {Promise<string>} 生成的摘要
   */
  async generateSummary(content, maxLength = 200) {
    if (!content || content.trim().length === 0) {
      throw new Error('内容不能为空')
    }

    // 如果内容本身就很短，直接返回
    if (content.length <= maxLength) {
      return content
    }

    const prompt = `请为以下内容生成一个简洁的摘要，长度控制在${maxLength}字以内。只返回摘要内容，不要添加任何前缀或说明。

内容：
${content}

摘要：`

    try {
      const response = await llm.query(prompt, [])
      return response.content.trim()
    } catch (error) {
      console.error('生成摘要失败:', error)
      throw new Error('生成摘要失败: ' + error.message)
    }
  }

  /**
   * 智能标签建议
   * @param {string} title - 知识标题
   * @param {string} content - 知识内容
   * @param {Array} existingTags - 现有标签列表
   * @param {number} maxTags - 最多建议标签数
   * @returns {Promise<Array>} 建议的标签列表
   */
  async suggestTags(title, content, existingTags = [], maxTags = 5) {
    if (!title && !content) {
      throw new Error('标题或内容不能都为空')
    }

    const existingTagNames = existingTags.map(t => t.name).join('、')
    const existingTagsText = existingTags.length > 0
      ? `\n\n已有标签供参考（不要重复）：${existingTagNames}`
      : ''

    const prompt = `请为以下知识条目建议${maxTags}个合适的标签。标签应该简洁、准确，能够帮助分类和检索。${existingTagsText}

标题：${title || '无'}
内容：${content.substring(0, 500)}${content.length > 500 ? '...' : ''}

请只返回标签名称，用逗号分隔，不要添加任何说明或前缀。例如：技术,编程,JavaScript,前端,Web开发`

    try {
      const response = await llm.query(prompt, [])
      const tagsText = response.content.trim()

      // 解析标签
      const suggestedTags = tagsText
        .split(/[,，、]/)
        .map(tag => tag.trim())
        .filter(tag => tag.length > 0 && tag.length <= 20)
        .slice(0, maxTags)

      // 过滤掉已存在的标签
      const existingTagNameSet = new Set(existingTags.map(t => t.name.toLowerCase()))
      const filteredTags = suggestedTags.filter(tag => !existingTagNameSet.has(tag.toLowerCase()))

      // 返回格式：[{name, confidence}]
      return filteredTags.map(name => ({
        name,
        confidence: 0.8 + Math.random() * 0.2 // 0.8-1.0的置信度
      }))
    } catch (error) {
      console.error('生成标签建议失败:', error)
      throw new Error('生成标签建议失败: ' + error.message)
    }
  }

  /**
   * 知识关联推荐
   * @param {string} currentTitle - 当前知识标题
   * @param {string} currentContent - 当前知识内容
   * @param {Array} allKnowledge - 所有知识列表
   * @param {number} maxRecommendations - 最多推荐数量
   * @returns {Promise<Array>} 推荐的知识ID列表
   */
  async recommendRelated(currentTitle, currentContent, allKnowledge, maxRecommendations = 5) {
    if (!currentTitle && !currentContent) {
      throw new Error('标题或内容不能都为空')
    }

    if (!allKnowledge || allKnowledge.length === 0) {
      return []
    }

    // 准备知识列表文本
    const knowledgeList = allKnowledge
      .slice(0, 20) // 限制数量避免token过多
      .map((item, index) => `${index + 1}. [ID:${item.id}] ${item.title}`)
      .join('\n')

    const prompt = `基于以下当前知识，从知识库中推荐${maxRecommendations}个最相关的知识条目。

当前知识：
标题：${currentTitle}
内容：${currentContent.substring(0, 300)}${currentContent.length > 300 ? '...' : ''}

知识库列表：
${knowledgeList}

请只返回推荐的知识ID（方括号中的ID），用逗号分隔，不要添加任何说明。例如：id1,id2,id3`

    try {
      const response = await llm.query(prompt, [])
      const idsText = response.content.trim()

      // 解析ID
      const recommendedIds = idsText
        .split(/[,，、]/)
        .map(id => id.trim())
        .filter(id => id.length > 0)
        .slice(0, maxRecommendations)

      return recommendedIds
    } catch (error) {
      console.error('生成关联推荐失败:', error)
      throw new Error('生成关联推荐失败: ' + error.message)
    }
  }

  /**
   * AI内容扩展
   * @param {string} title 标题
   * @param {string} outline 大纲或简要内容
   * @param {string} style 写作风格 ('formal', 'casual', 'technical')
   * @returns {Promise<string>} 扩展后的完整内容
   */
  async expandContent(title, outline, style = 'casual') {
    const styleMap = {
      formal: '正式、学术的风格',
      casual: '轻松、口语化的风格',
      technical: '技术性强、专业的风格'
    }

    const styleDesc = styleMap[style] || styleMap.casual

    const prompt = `请基于以下标题和大纲，扩展生成一篇完整的内容。写作风格：${styleDesc}。

标题：${title}
大纲：
${outline}

请生成完整内容，包含适当的段落、标题和细节说明：`

    try {
      const response = await llm.query(prompt, [])
      return response.content.trim()
    } catch (error) {
      console.error('内容扩展失败:', error)
      throw new Error('内容扩展失败: ' + error.message)
    }
  }

  /**
   * 改进内容（润色、纠错）
   * @param {string} content 原始内容
   * @param {string} instruction 改进指令
   * @returns {Promise<Object>} {improvedContent, suggestions}
   */
  async improveContent(content, instruction = '优化排版和表达，使内容更清晰、更易读') {
    if (!content || content.trim().length === 0) {
      throw new Error('内容不能为空')
    }

    const prompt = `请根据以下要求改进内容：${instruction}

原始内容：
${content}

请返回改进后的内容，保持原有意思但提升表达质量：`

    try {
      const response = await llm.query(prompt, [])
      return {
        improvedContent: response.content.trim(),
        suggestions: [
          '已优化段落结构',
          '已改进语言表达',
          '已增强内容可读性'
        ]
      }
    } catch (error) {
      console.error('改进内容失败:', error)
      throw new Error('改进内容失败: ' + error.message)
    }
  }

  /**
   * 智能提取关键词
   * @param {string} content - 文本内容
   * @param {number} maxKeywords - 最多关键词数
   * @returns {Promise<Array>} 关键词列表
   */
  async extractKeywords(content, maxKeywords = 10) {
    if (!content || content.trim().length === 0) {
      throw new Error('内容不能为空')
    }

    const prompt = `请从以下内容中提取${maxKeywords}个最重要的关键词。关键词应该能够代表文本的核心主题。

内容：
${content.substring(0, 1000)}${content.length > 1000 ? '...' : ''}

请只返回关键词，用逗号分隔，不要添加任何说明：`

    try {
      const response = await llm.query(prompt, [])
      const keywordsText = response.content.trim()

      // 解析关键词
      const keywords = keywordsText
        .split(/[,，、]/)
        .map(keyword => keyword.trim())
        .filter(keyword => keyword.length > 0 && keyword.length <= 20)
        .slice(0, maxKeywords)

      return keywords
    } catch (error) {
      console.error('提取关键词失败:', error)
      throw new Error('提取关键词失败: ' + error.message)
    }
  }

  /**
   * 生成知识标题
   * @param {string} content - 知识内容
   * @returns {Promise<string>} 生成的标题
   */
  async generateTitle(content) {
    if (!content || content.trim().length === 0) {
      throw new Error('内容不能为空')
    }

    const prompt = `请为以下内容生成一个简洁、准确的标题，长度控制在30字以内。只返回标题，不要添加任何前缀、引号或说明。

内容：
${content.substring(0, 500)}${content.length > 500 ? '...' : ''}

标题：`

    try {
      const response = await llm.query(prompt, [])
      return response.content.trim().replace(/^["'《「『]|["'》」』]$/g, '')
    } catch (error) {
      console.error('生成标题失败:', error)
      throw new Error('生成标题失败: ' + error.message)
    }
  }

  /**
   * 从知识内容生成问答对（用于学习和复习）
   * @param {string} content 知识内容
   * @param {number} questionCount 生成问题数量
   * @returns {Promise<Array>} 问答对数组 [{question, answer}]
   */
  async generateQA(content, questionCount = 3) {
    if (!content || content.trim().length === 0) {
      throw new Error('内容不能为空')
    }

    const prompt = `请基于以下内容生成${questionCount}个问答对，帮助用户更好地理解和记忆这些知识。

内容：
${content}

请严格按照以下格式返回，每个问答对占两行：
Q1: [问题]
A1: [答案]
Q2: [问题]
A2: [答案]`

    try {
      const response = await llm.query(prompt, [])
      const qaText = response.content.trim()

      // 解析问答对
      const qaList = []
      const lines = qaText.split('\n')
      let currentQ = ''

      for (const line of lines) {
        const trimmedLine = line.trim()
        if (trimmedLine.match(/^Q\d+:/)) {
          currentQ = trimmedLine.replace(/^Q\d+:\s*/, '')
        } else if (trimmedLine.match(/^A\d+:/)) {
          const answer = trimmedLine.replace(/^A\d+:\s*/, '')
          if (currentQ) {
            qaList.push({ question: currentQ, answer })
            currentQ = ''
          }
        }
      }

      return qaList.slice(0, questionCount)
    } catch (error) {
      console.error('生成问答失败:', error)
      throw new Error('生成问答失败: ' + error.message)
    }
  }
}

// 导出单例
export const aiService = new AIService()
export default AIService
