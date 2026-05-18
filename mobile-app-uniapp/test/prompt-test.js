/**
 * Prompt模板管理器测试
 *
 * 全面测试Prompt模板管理系统的所有功能
 *
 * @version 1.9.0
 */

import PromptManager from '../src/services/prompt/prompt-manager.js'

/**
 * Mock数据库实现（用于测试）
 */
class MockDatabase {
  constructor() {
    this.tables = {
      prompt_templates: []
    }
    this.autoIncrement = 1
  }

  executeSql({ sql, args = [], success, fail }) {
    try {
      // CREATE TABLE
      if (sql.includes('CREATE TABLE')) {
        success()
        return
      }

      // INSERT
      if (sql.includes('INSERT')) {
        const row = {}
        const values = args

        // 简化的INSERT解析
        if (sql.includes('prompt_templates')) {
          const columns = [
            'id',
            'name',
            'description',
            'template',
            'variables',
            'category',
            'tags',
            'is_system',
            'usage_count',
            'rating',
            'rating_count',
            'author',
            'version',
            'created_at',
            'updated_at',
            'deleted'
          ]

          values.forEach((val, idx) => {
            if (idx < columns.length) {
              row[columns[idx]] = val
            }
          })

          // 检查是否已存在（INSERT OR IGNORE）
          if (sql.includes('OR IGNORE')) {
            const exists = this.tables.prompt_templates.find(r => r.id === row.id)
            if (!exists) {
              this.tables.prompt_templates.push(row)
            }
          } else {
            this.tables.prompt_templates.push(row)
          }
        }

        success()
        return
      }

      // UPDATE
      if (sql.includes('UPDATE')) {
        if (sql.includes('prompt_templates')) {
          const id = args[args.length - 1]
          const template = this.tables.prompt_templates.find(r => r.id === id)

          if (template) {
            // 简化的UPDATE解析
            if (sql.includes('usage_count = usage_count + 1')) {
              template.usage_count = (template.usage_count || 0) + 1
            } else if (sql.includes('deleted = 1')) {
              template.deleted = 1
              template.updated_at = args[0]
            } else if (sql.includes('rating = ?')) {
              template.rating = args[0]
              template.rating_count = args[1]
            } else {
              // 通用UPDATE
              // 解析SET子句
              const setMatch = sql.match(/SET (.+?) WHERE/)
              if (setMatch) {
                const setParts = setMatch[1].split(',')
                let paramIndex = 0

                setParts.forEach(part => {
                  const field = part.trim().split('=')[0].trim()
                  if (field !== 'updated_at') {
                    template[field] = args[paramIndex]
                    paramIndex++
                  } else {
                    template.updated_at = args[paramIndex]
                    paramIndex++
                  }
                })
              }
            }
          }
        }

        success()
        return
      }

      // DELETE
      if (sql.includes('DELETE')) {
        if (sql.includes('prompt_templates')) {
          const id = args[0]
          const index = this.tables.prompt_templates.findIndex(r => r.id === id)
          if (index !== -1) {
            this.tables.prompt_templates.splice(index, 1)
          }
        }

        success()
        return
      }

      success()
    } catch (error) {
      fail(error)
    }
  }

  selectSql({ sql, args = [], success, fail }) {
    try {
      let results = []

      if (sql.includes('prompt_templates')) {
        results = [...this.tables.prompt_templates]

        // 应用WHERE条件
        if (sql.includes('WHERE')) {
          // deleted = 0
          if (sql.includes('deleted = 0')) {
            results = results.filter(r => r.deleted === 0)
          }

          // id = ?
          if (sql.includes('id = ?')) {
            const id = args[args.length - 1]
            results = results.filter(r => r.id === id)
          }

          // is_system = ?
          if (sql.includes('is_system = ?')) {
            const isSystem = args.find(arg => typeof arg === 'number')
            results = results.filter(r => r.is_system === isSystem)
          }

          // category = ?
          if (sql.includes('category = ?')) {
            const category = args.find(arg => typeof arg === 'string')
            results = results.filter(r => r.category === category)
          }

          // LIKE搜索
          if (sql.includes('LIKE ?')) {
            const searchTerm = args[0].replace(/%/g, '')
            results = results.filter(
              r =>
                r.name?.includes(searchTerm) ||
                r.description?.includes(searchTerm) ||
                r.template?.includes(searchTerm) ||
                r.tags?.includes(searchTerm)
            )
          }
        }

        // COUNT(*)
        if (sql.includes('COUNT(*)')) {
          success([{ count: results.length }])
          return
        }

        // DISTINCT category
        if (sql.includes('DISTINCT category')) {
          const categories = [...new Set(results.map(r => r.category))]
          success(categories.map(c => ({ category: c })))
          return
        }

        // GROUP BY category
        if (sql.includes('GROUP BY category')) {
          const grouped = {}
          results.forEach(r => {
            grouped[r.category] = (grouped[r.category] || 0) + 1
          })
          success(Object.entries(grouped).map(([category, count]) => ({ category, count })))
          return
        }

        // ORDER BY
        if (sql.includes('ORDER BY')) {
          if (sql.includes('usage_count DESC')) {
            results.sort((a, b) => (b.usage_count || 0) - (a.usage_count || 0))
          }
        }

        // LIMIT
        if (sql.includes('LIMIT')) {
          const limitMatch = sql.match(/LIMIT (\d+)/)
          if (limitMatch) {
            const limit = parseInt(limitMatch[1])
            results = results.slice(0, limit)
          }
        }

        // OFFSET
        if (sql.includes('OFFSET')) {
          const offsetMatch = sql.match(/OFFSET (\d+)/)
          if (offsetMatch) {
            const offset = parseInt(offsetMatch[1])
            results = results.slice(offset)
          }
        }
      }

      success(results)
    } catch (error) {
      fail(error)
    }
  }

  // 辅助方法：清空数据
  clear() {
    this.tables.prompt_templates = []
  }

  // 辅助方法：获取所有数据
  getAllPrompts() {
    return [...this.tables.prompt_templates]
  }
}

/**
 * 测试套件
 */
class PromptManagerTest {
  constructor() {
    this.db = new MockDatabase()
    this.manager = new PromptManager(this.db)
    this.testResults = {
      passed: 0,
      failed: 0,
      total: 0,
      details: []
    }
  }

  /**
   * 运行所有测试
   */
  async runAll() {
    console.log('========================================')
    console.log('Prompt模板管理器测试')
    console.log('========================================\n')

    await this.testInitialization()
    await this.testBuiltInTemplates()
    await this.testCRUDOperations()
    await this.testTemplateQueries()
    await this.testTemplateFilling()
    await this.testRatingSystem()
    await this.testSearchFunctionality()
    await this.testStatistics()
    await this.testCaching()
    await this.testImportExport()
    await this.testEdgeCases()

    this.printResults()
  }

  /**
   * 测试：初始化
   */
  async testInitialization() {
    console.log('1. 测试初始化')
    console.log('---')

    await this.assert(
      '初始化成功',
      async () => {
        const result = await this.manager.initialize()
        return result === true
      }
    )

    await this.assert(
      '数据库表已创建',
      async () => {
        return this.db.tables.prompt_templates !== undefined
      }
    )

    await this.assert(
      '重复初始化应跳过',
      async () => {
        const result = await this.manager.initialize()
        return result === true
      }
    )

    console.log()
  }

  /**
   * 测试：内置模板
   */
  async testBuiltInTemplates() {
    console.log('2. 测试内置模板')
    console.log('---')

    await this.assert(
      '内置模板已插入',
      async () => {
        const templates = await this.manager.getTemplates({ isSystem: true })
        return templates.length === 12
      }
    )

    await this.assert(
      '摘要模板存在',
      async () => {
        const template = await this.manager.getTemplateById('builtin-summarize')
        return template !== null && template.name === '内容摘要'
      }
    )

    await this.assert(
      'RAG查询模板存在',
      async () => {
        const template = await this.manager.getTemplateById('builtin-rag-query')
        return template !== null && template.category === 'rag'
      }
    )

    await this.assert(
      '移动快记模板存在',
      async () => {
        const template = await this.manager.getTemplateById('builtin-mobile-note')
        return template !== null && template.category === 'mobile'
      }
    )

    await this.assert(
      '内置模板包含变量定义',
      async () => {
        const template = await this.manager.getTemplateById('builtin-translate')
        return (
          Array.isArray(template.variables) &&
          template.variables.includes('content') &&
          template.variables.includes('target_language')
        )
      }
    )

    console.log()
  }

  /**
   * 测试：CRUD操作
   */
  async testCRUDOperations() {
    console.log('3. 测试CRUD操作')
    console.log('---')

    let createdId = null

    await this.assert(
      '创建自定义模板',
      async () => {
        const template = await this.manager.createTemplate({
          name: '测试模板',
          description: '这是一个测试模板',
          template: '请帮我处理：{{input}}',
          variables: ['input'],
          category: 'custom',
          tags: ['测试', 'custom']
        })

        createdId = template.id
        return template.name === '测试模板'
      }
    )

    await this.assert(
      '读取模板',
      async () => {
        const template = await this.manager.getTemplateById(createdId)
        return template !== null && template.description === '这是一个测试模板'
      }
    )

    await this.assert(
      '更新模板',
      async () => {
        const updated = await this.manager.updateTemplate(createdId, {
          description: '更新后的描述'
        })
        return updated.description === '更新后的描述'
      }
    )

    await this.assert(
      '删除模板（软删除）',
      async () => {
        await this.manager.deleteTemplate(createdId)
        const deleted = await this.manager.getTemplateById(createdId)
        return deleted === null
      }
    )

    await this.assert(
      '系统模板不能修改',
      async () => {
        try {
          await this.manager.updateTemplate('builtin-summarize', { name: '新名称' })
          return false
        } catch (error) {
          return error.message === '系统模板不能修改'
        }
      }
    )

    await this.assert(
      '系统模板不能删除',
      async () => {
        try {
          await this.manager.deleteTemplate('builtin-summarize')
          return false
        } catch (error) {
          return error.message === '系统模板不能删除'
        }
      }
    )

    console.log()
  }

  /**
   * 测试：模板查询
   */
  async testTemplateQueries() {
    console.log('4. 测试模板查询')
    console.log('---')

    await this.assert(
      '按分类查询',
      async () => {
        const templates = await this.manager.getTemplates({ category: 'writing' })
        return templates.length > 0 && templates.every(t => t.category === 'writing')
      }
    )

    await this.assert(
      '查询系统模板',
      async () => {
        const templates = await this.manager.getTemplates({ isSystem: true })
        return templates.every(t => t.is_system === true)
      }
    )

    await this.assert(
      '查询用户模板',
      async () => {
        // 创建一个用户模板
        await this.manager.createTemplate({
          name: '用户模板',
          template: '内容：{{content}}',
          variables: ['content']
        })

        const templates = await this.manager.getTemplates({ isSystem: false })
        return templates.length > 0 && templates.every(t => t.is_system === false)
      }
    )

    await this.assert(
      '分页查询',
      async () => {
        const page1 = await this.manager.getTemplates({ limit: 5, offset: 0 })
        const page2 = await this.manager.getTemplates({ limit: 5, offset: 5 })
        return page1.length <= 5 && page1[0]?.id !== page2[0]?.id
      }
    )

    await this.assert(
      '获取分类列表',
      async () => {
        const categories = await this.manager.getCategories()
        return Array.isArray(categories) && categories.includes('writing')
      }
    )

    console.log()
  }

  /**
   * 测试：模板填充
   */
  async testTemplateFilling() {
    console.log('5. 测试模板填充')
    console.log('---')

    await this.assert(
      '填充单个变量',
      async () => {
        const result = await this.manager.fillTemplate('builtin-summarize', {
          content: '这是一段测试文本'
        })
        return result.includes('这是一段测试文本')
      }
    )

    await this.assert(
      '填充多个变量',
      async () => {
        const result = await this.manager.fillTemplate('builtin-translate', {
          content: 'Hello World',
          target_language: '中文'
        })
        return result.includes('Hello World') && result.includes('中文')
      }
    )

    await this.assert(
      '填充后增加使用次数',
      async () => {
        const before = await this.manager.getTemplateById('builtin-code-explain')
        const beforeCount = before.usage_count

        await this.manager.fillTemplate('builtin-code-explain', {
          code: 'console.log("test")',
          language: 'javascript'
        })

        const after = await this.manager.getTemplateById('builtin-code-explain')
        return after.usage_count === beforeCount + 1
      }
    )

    await this.assert(
      '未填充的变量保留占位符',
      async () => {
        const result = await this.manager.fillTemplate('builtin-expand', {
          content: '测试内容'
          // 缺少 length 变量
        })
        return result.includes('测试内容')
      }
    )

    console.log()
  }

  /**
   * 测试：评分系统
   */
  async testRatingSystem() {
    console.log('6. 测试评分系统')
    console.log('---')

    await this.assert(
      '添加评分',
      async () => {
        const result = await this.manager.rateTemplate('builtin-summarize', 5)
        return result.rating === 5 && result.rating_count === 1
      }
    )

    await this.assert(
      '计算平均评分',
      async () => {
        await this.manager.rateTemplate('builtin-summarize', 3)
        const result = await this.manager.getTemplateById('builtin-summarize')
        return result.rating === 4 && result.rating_count === 2
      }
    )

    await this.assert(
      '评分范围验证',
      async () => {
        try {
          await this.manager.rateTemplate('builtin-summarize', 6)
          return false
        } catch (error) {
          return error.message === '评分必须在1-5之间'
        }
      }
    )

    console.log()
  }

  /**
   * 测试：搜索功能
   */
  async testSearchFunctionality() {
    console.log('7. 测试搜索功能')
    console.log('---')

    await this.assert(
      '按名称搜索',
      async () => {
        const results = await this.manager.searchTemplates('摘要')
        return results.length > 0 && results.some(r => r.name.includes('摘要'))
      }
    )

    await this.assert(
      '按描述搜索',
      async () => {
        const results = await this.manager.searchTemplates('翻译')
        return results.length > 0
      }
    )

    await this.assert(
      '按内容搜索',
      async () => {
        const results = await this.manager.searchTemplates('代码')
        return results.length > 0
      }
    )

    await this.assert(
      '搜索无结果',
      async () => {
        const results = await this.manager.searchTemplates('这是一个不存在的关键词xyz123')
        return results.length === 0
      }
    )

    console.log()
  }

  /**
   * 测试：统计信息
   */
  async testStatistics() {
    console.log('8. 测试统计信息')
    console.log('---')

    await this.assert(
      '获取总体统计',
      async () => {
        const stats = await this.manager.getStatistics()
        return (
          stats.total > 0 &&
          stats.system > 0 &&
          typeof stats.custom === 'number' &&
          typeof stats.byCategory === 'object'
        )
      }
    )

    await this.assert(
      '按分类统计',
      async () => {
        const stats = await this.manager.getStatistics()
        return stats.byCategory.writing > 0
      }
    )

    await this.assert(
      '最常用模板统计',
      async () => {
        const stats = await this.manager.getStatistics()
        return Array.isArray(stats.mostUsed) && stats.mostUsed.length > 0
      }
    )

    console.log()
  }

  /**
   * 测试：缓存功能
   */
  async testCaching() {
    console.log('9. 测试缓存功能')
    console.log('---')

    await this.assert(
      '模板查询缓存',
      async () => {
        // 第一次查询
        await this.manager.getTemplateById('builtin-summarize')

        // 第二次查询应从缓存读取
        const cached = this.manager.cache.has('builtin-summarize')
        return cached
      }
    )

    await this.assert(
      '统计信息缓存',
      async () => {
        await this.manager.getStatistics()
        return this.manager.statsCache !== null
      }
    )

    await this.assert(
      '分类列表缓存',
      async () => {
        await this.manager.getCategories()
        return this.manager.categoriesCache !== null
      }
    )

    await this.assert(
      '更新时清除缓存',
      async () => {
        const template = await this.manager.createTemplate({
          name: '缓存测试',
          template: '内容：{{test}}'
        })

        await this.manager.updateTemplate(template.id, { name: '更新后' })

        // 统计缓存应被清除
        return this.manager.statsCache === null
      }
    )

    await this.assert(
      '手动清除所有缓存',
      async () => {
        await this.manager.getTemplateById('builtin-summarize')
        await this.manager.getStatistics()
        await this.manager.getCategories()

        this.manager.clearAllCache()

        return (
          this.manager.cache.size === 0 &&
          this.manager.statsCache === null &&
          this.manager.categoriesCache === null
        )
      }
    )

    console.log()
  }

  /**
   * 测试：导入导出
   */
  async testImportExport() {
    console.log('10. 测试导入导出')
    console.log('---')

    let exportData = null

    await this.assert(
      '导出模板',
      async () => {
        exportData = await this.manager.exportTemplate('builtin-summarize')
        return (
          exportData.version === '1.0' &&
          exportData.template.name === '内容摘要' &&
          exportData.exported_at !== undefined
        )
      }
    )

    await this.assert(
      '导入模板',
      async () => {
        const imported = await this.manager.importTemplate(exportData)
        return imported.name === '内容摘要' && imported.author === 'imported'
      }
    )

    await this.assert(
      '导入无效数据',
      async () => {
        try {
          await this.manager.importTemplate({ invalid: 'data' })
          return false
        } catch (error) {
          return error.message === '无效的导入数据'
        }
      }
    )

    console.log()
  }

  /**
   * 测试：边界情况
   */
  async testEdgeCases() {
    console.log('11. 测试边界情况')
    console.log('---')

    await this.assert(
      '创建空名称模板应失败',
      async () => {
        try {
          await this.manager.createTemplate({
            name: '',
            template: '内容'
          })
          return false
        } catch (error) {
          return error.message === '模板名称和内容不能为空'
        }
      }
    )

    await this.assert(
      '创建空内容模板应失败',
      async () => {
        try {
          await this.manager.createTemplate({
            name: '测试',
            template: ''
          })
          return false
        } catch (error) {
          return error.message === '模板名称和内容不能为空'
        }
      }
    )

    await this.assert(
      '查询不存在的模板',
      async () => {
        const result = await this.manager.getTemplateById('non-existent-id')
        return result === null
      }
    )

    await this.assert(
      '更新不存在的模板应失败',
      async () => {
        try {
          await this.manager.updateTemplate('non-existent-id', { name: '新名称' })
          return false
        } catch (error) {
          return error.message === '模板不存在'
        }
      }
    )

    await this.assert(
      '删除不存在的模板应失败',
      async () => {
        try {
          await this.manager.deleteTemplate('non-existent-id')
          return false
        } catch (error) {
          return error.message === '模板不存在'
        }
      }
    )

    await this.assert(
      '填充不存在的模板应失败',
      async () => {
        try {
          await this.manager.fillTemplate('non-existent-id', {})
          return false
        } catch (error) {
          return error.message === '模板不存在'
        }
      }
    )

    console.log()
  }

  /**
   * 断言辅助函数
   */
  async assert(description, testFn) {
    this.testResults.total++

    try {
      const result = await testFn()

      if (result) {
        console.log(`  ✓ ${description}`)
        this.testResults.passed++
        this.testResults.details.push({ description, status: 'PASSED' })
      } else {
        console.log(`  ✗ ${description}`)
        this.testResults.failed++
        this.testResults.details.push({ description, status: 'FAILED', error: 'Assertion failed' })
      }
    } catch (error) {
      console.log(`  ✗ ${description}`)
      console.log(`    错误: ${error.message}`)
      this.testResults.failed++
      this.testResults.details.push({ description, status: 'ERROR', error: error.message })
    }
  }

  /**
   * 打印测试结果
   */
  printResults() {
    console.log('========================================')
    console.log('测试结果汇总')
    console.log('========================================')
    console.log(`总计: ${this.testResults.total}`)
    console.log(`通过: ${this.testResults.passed}`)
    console.log(`失败: ${this.testResults.failed}`)
    console.log(
      `通过率: ${((this.testResults.passed / this.testResults.total) * 100).toFixed(2)}%`
    )
    console.log('========================================\n')

    if (this.testResults.failed > 0) {
      console.log('失败的测试:')
      this.testResults.details
        .filter(d => d.status !== 'PASSED')
        .forEach(d => {
          console.log(`  - ${d.description}`)
          if (d.error) {
            console.log(`    ${d.error}`)
          }
        })
    }
  }
}

/**
 * 运行测试
 */
async function runTests() {
  const test = new PromptManagerTest()
  await test.runAll()
}

// 如果直接运行此文件
if (typeof window === 'undefined') {
  runTests().catch(console.error)
}

export { PromptManagerTest, runTests, MockDatabase }
export default PromptManagerTest
