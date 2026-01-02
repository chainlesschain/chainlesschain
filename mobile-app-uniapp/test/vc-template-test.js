/**
 * VC模板管理器测试
 *
 * 全面测试VC模板管理系统的所有功能
 *
 * @version 2.0.0
 */

import VCTemplateManager, { BUILT_IN_TEMPLATES } from '../src/services/vc/vc-template-manager.js'

/**
 * Mock数据库实现（用于测试）
 */
class MockDatabase {
  constructor() {
    this.tables = {
      vc_templates: []
    }
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

        if (sql.includes('vc_templates')) {
          const columns = [
            'id',
            'name',
            'type',
            'description',
            'icon',
            'category',
            'fields',
            'created_by',
            'is_public',
            'usage_count',
            'rating',
            'rating_count',
            'created_at',
            'updated_at',
            'deleted'
          ]

          values.forEach((val, idx) => {
            if (idx < columns.length) {
              row[columns[idx]] = val
            }
          })

          this.tables.vc_templates.push(row)
        }

        success()
        return
      }

      // UPDATE
      if (sql.includes('UPDATE')) {
        if (sql.includes('vc_templates')) {
          const id = args[args.length - 1]
          const template = this.tables.vc_templates.find(r => r.id === id)

          if (template) {
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
        if (sql.includes('vc_templates')) {
          const id = args[0]
          const index = this.tables.vc_templates.findIndex(r => r.id === id)
          if (index !== -1) {
            this.tables.vc_templates.splice(index, 1)
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

      if (sql.includes('vc_templates')) {
        results = [...this.tables.vc_templates]

        // 应用WHERE条件
        if (sql.includes('WHERE')) {
          // deleted = 0
          if (sql.includes('deleted = 0')) {
            results = results.filter(r => r.deleted === 0)
          }

          // id = ?
          if (sql.includes('id = ?')) {
            const id = args.find(arg => typeof arg === 'string' && !arg.startsWith('custom'))
            if (id) {
              results = results.filter(r => r.id === id)
            } else {
              results = results.filter(r => r.id === args[args.length - 1])
            }
          }

          // type = ?
          if (sql.includes('type = ?')) {
            const type = args.find(arg => typeof arg === 'string')
            results = results.filter(r => r.type === type)
          }

          // category = ?
          if (sql.includes('category = ?')) {
            const category = args.find(arg => typeof arg === 'string')
            results = results.filter(r => r.category === category)
          }

          // created_by = ?
          if (sql.includes('created_by = ?')) {
            const createdBy = args.find(arg => typeof arg === 'string')
            results = results.filter(r => r.created_by === createdBy)
          }

          // is_public = ?
          if (sql.includes('is_public = ?')) {
            const isPublic = args.find(arg => typeof arg === 'number')
            results = results.filter(r => r.is_public === isPublic)
          }
        }

        // COUNT(*)
        if (sql.includes('COUNT(*)')) {
          success([{ count: results.length }])
          return
        }

        // GROUP BY
        if (sql.includes('GROUP BY type')) {
          const grouped = {}
          results.forEach(r => {
            grouped[r.type] = (grouped[r.type] || 0) + 1
          })
          success(Object.entries(grouped).map(([type, count]) => ({ type, count })))
          return
        }

        // ORDER BY
        if (sql.includes('ORDER BY')) {
          if (sql.includes('usage_count DESC')) {
            results.sort((a, b) => (b.usage_count || 0) - (a.usage_count || 0))
          }
        }
      }

      success(results)
    } catch (error) {
      fail(error)
    }
  }

  // 辅助方法
  clear() {
    this.tables.vc_templates = []
  }

  getAllTemplates() {
    return [...this.tables.vc_templates]
  }
}

/**
 * 测试套件
 */
class VCTemplateManagerTest {
  constructor() {
    this.db = new MockDatabase()
    this.manager = new VCTemplateManager(this.db)
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
    console.log('VC模板管理器测试')
    console.log('========================================\n')

    await this.testInitialization()
    await this.testBuiltInTemplates()
    await this.testCRUDOperations()
    await this.testTemplateQueries()
    await this.testTemplateFilling()
    await this.testRatingSystem()
    await this.testUsageTracking()
    await this.testSearchFunctionality()
    await this.testStatistics()
    await this.testImportExport()
    await this.testCaching()
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
        return this.db.tables.vc_templates !== undefined
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
      '内置模板已加载',
      async () => {
        return Object.keys(BUILT_IN_TEMPLATES).length === 6
      }
    )

    await this.assert(
      'JavaScript技能模板存在',
      async () => {
        const template = await this.manager.getTemplateById('built-in:javascript-skill')
        return template !== null && template.name === 'JavaScript 技能证书'
      }
    )

    await this.assert(
      '教育凭证模板存在',
      async () => {
        const template = await this.manager.getTemplateById('built-in:education-degree')
        return template !== null && template.type === 'EducationCredential'
      }
    )

    await this.assert(
      '工作经历模板存在',
      async () => {
        const template = await this.manager.getTemplateById('built-in:work-experience')
        return template !== null && template.icon === '💼'
      }
    )

    await this.assert(
      '项目认证模板存在（移动端特有）',
      async () => {
        const template = await this.manager.getTemplateById('built-in:project-certification')
        return template !== null && template.category === 'project'
      }
    )

    await this.assert(
      '内置模板包含字段定义',
      async () => {
        const template = await this.manager.getTemplateById('built-in:trust-endorsement')
        return (
          Array.isArray(template.fields) &&
          template.fields.length > 0 &&
          template.fields[0].key === 'trustLevel'
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
          type: 'TestCredential',
          description: '这是一个测试模板',
          icon: '🧪',
          category: 'test',
          fields: [
            {
              key: 'testField',
              label: '测试字段',
              type: 'text',
              required: true
            }
          ],
          createdBy: 'did:test:123',
          isPublic: false
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
      '内置模板不能修改',
      async () => {
        try {
          await this.manager.updateTemplate('built-in:javascript-skill', { name: '新名称' })
          return false
        } catch (error) {
          return error.message === '不能修改内置模板'
        }
      }
    )

    await this.assert(
      '内置模板不能删除',
      async () => {
        try {
          await this.manager.deleteTemplate('built-in:javascript-skill')
          return false
        } catch (error) {
          return error.message === '不能删除内置模板'
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
      '获取所有模板（内置+自定义）',
      async () => {
        const templates = await this.manager.getAllTemplates()
        return templates.length >= 6 // 至少包含6个内置模板
      }
    )

    await this.assert(
      '按类型过滤',
      async () => {
        const templates = await this.manager.getAllTemplates({ type: 'SkillCertificate' })
        return templates.length > 0 && templates.every(t => t.type === 'SkillCertificate')
      }
    )

    await this.assert(
      '按分类过滤',
      async () => {
        const templates = await this.manager.getAllTemplates({ category: 'education' })
        return templates.length > 0 && templates.every(t => t.category === 'education')
      }
    )

    await this.assert(
      '创建并查询自定义模板',
      async () => {
        const created = await this.manager.createTemplate({
          name: '自定义技能',
          type: 'SkillCertificate',
          category: 'custom',
          fields: [{ key: 'skill', label: '技能', type: 'text', required: true }],
          createdBy: 'did:test:123'
        })

        const templates = await this.manager.getAllTemplates({ createdBy: 'did:test:123' })
        return templates.some(t => t.id === created.id)
      }
    )

    await this.assert(
      '获取凭证类型列表',
      async () => {
        const types = this.manager.getCredentialTypes()
        return (
          Array.isArray(types) &&
          types.includes('SkillCertificate') &&
          types.includes('EducationCredential')
        )
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
      '填充模板字段',
      async () => {
        const claims = await this.manager.fillTemplateValues('built-in:javascript-skill', {
          skill: 'JavaScript',
          level: 'Expert',
          yearsOfExperience: 5,
          certifications: 'AWS Certified'
        })

        return (
          claims.skill === 'JavaScript' &&
          claims.level === 'Expert' &&
          claims.yearsOfExperience === 5
        )
      }
    )

    await this.assert(
      '使用默认值填充',
      async () => {
        const claims = await this.manager.fillTemplateValues('built-in:javascript-skill', {
          yearsOfExperience: 3
          // skill 和 level 应使用默认值
        })

        return claims.skill === 'JavaScript' && claims.level === 'Intermediate'
      }
    )

    await this.assert(
      '必填字段验证',
      async () => {
        try {
          await this.manager.fillTemplateValues('built-in:javascript-skill', {
            // 缺少必填字段
          })
          return false
        } catch (error) {
          return error.message.includes('是必填的')
        }
      }
    )

    await this.assert(
      '填充教育凭证',
      async () => {
        const claims = await this.manager.fillTemplateValues('built-in:education-degree', {
          degree: '本科',
          major: '计算机科学',
          institution: '清华大学',
          graduationYear: 2020,
          gpa: '3.8/4.0'
        })

        return claims.major === '计算机科学' && claims.institution === '清华大学'
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

    let customTemplateId = null

    await this.assert(
      '创建可评分的自定义模板',
      async () => {
        const template = await this.manager.createTemplate({
          name: '可评分模板',
          type: 'TestCredential',
          fields: [{ key: 'test', label: '测试', type: 'text', required: true }],
          createdBy: 'did:test:123'
        })

        customTemplateId = template.id
        return template !== null
      }
    )

    await this.assert(
      '添加评分',
      async () => {
        const result = await this.manager.rateTemplate(customTemplateId, 5)
        return result.rating === 5 && result.rating_count === 1
      }
    )

    await this.assert(
      '计算平均评分',
      async () => {
        await this.manager.rateTemplate(customTemplateId, 3)
        const result = await this.manager.getTemplateById(customTemplateId)
        return result.rating === 4 && result.rating_count === 2
      }
    )

    await this.assert(
      '评分范围验证',
      async () => {
        try {
          await this.manager.rateTemplate(customTemplateId, 6)
          return false
        } catch (error) {
          return error.message === '评分必须在1-5之间'
        }
      }
    )

    await this.assert(
      '内置模板不能评分',
      async () => {
        try {
          await this.manager.rateTemplate('built-in:javascript-skill', 5)
          return false
        } catch (error) {
          return error.message === '不能为内置模板评分'
        }
      }
    )

    console.log()
  }

  /**
   * 测试：使用统计
   */
  async testUsageTracking() {
    console.log('7. 测试使用统计')
    console.log('---')

    let customTemplateId = null

    await this.assert(
      '创建模板用于统计',
      async () => {
        const template = await this.manager.createTemplate({
          name: '使用统计模板',
          type: 'TestCredential',
          fields: [{ key: 'test', label: '测试', type: 'text', required: true }],
          createdBy: 'did:test:123'
        })

        customTemplateId = template.id
        return template.usage_count === 0
      }
    )

    await this.assert(
      '增加使用次数',
      async () => {
        await this.manager.incrementUsageCount(customTemplateId)
        const template = await this.manager.getTemplateById(customTemplateId)
        return template.usage_count === 1
      }
    )

    await this.assert(
      '多次增加使用次数',
      async () => {
        await this.manager.incrementUsageCount(customTemplateId)
        await this.manager.incrementUsageCount(customTemplateId)
        const template = await this.manager.getTemplateById(customTemplateId)
        return template.usage_count === 3
      }
    )

    await this.assert(
      '内置模板不记录使用次数',
      async () => {
        await this.manager.incrementUsageCount('built-in:javascript-skill')
        // 不应抛出错误，只是不记录
        return true
      }
    )

    console.log()
  }

  /**
   * 测试：搜索功能
   */
  async testSearchFunctionality() {
    console.log('8. 测试搜索功能')
    console.log('---')

    await this.assert(
      '按名称搜索',
      async () => {
        const results = await this.manager.searchTemplates('JavaScript')
        return results.length > 0 && results.some(r => r.name.includes('JavaScript'))
      }
    )

    await this.assert(
      '按类型搜索',
      async () => {
        const results = await this.manager.searchTemplates('Skill')
        return results.length > 0
      }
    )

    await this.assert(
      '按分类搜索',
      async () => {
        const results = await this.manager.searchTemplates('education')
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
    console.log('9. 测试统计信息')
    console.log('---')

    await this.assert(
      '获取总体统计',
      async () => {
        const stats = await this.manager.getStatistics()
        return (
          stats.builtIn === 6 &&
          stats.total >= 6 &&
          typeof stats.custom === 'number' &&
          typeof stats.byType === 'object'
        )
      }
    )

    await this.assert(
      '按类型统计',
      async () => {
        const stats = await this.manager.getStatistics()
        return stats.byType.SkillCertificate > 0
      }
    )

    await this.assert(
      '统计包含公开模板数',
      async () => {
        const stats = await this.manager.getStatistics()
        return typeof stats.public === 'number'
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
    let customTemplateId = null

    await this.assert(
      '创建模板用于导出',
      async () => {
        const template = await this.manager.createTemplate({
          name: '导出测试模板',
          type: 'TestCredential',
          description: '用于测试导出',
          icon: '📦',
          category: 'test',
          fields: [{ key: 'test', label: '测试', type: 'text', required: true }],
          createdBy: 'did:test:123'
        })

        customTemplateId = template.id
        return template !== null
      }
    )

    await this.assert(
      '导出单个模板',
      async () => {
        exportData = await this.manager.exportTemplate(customTemplateId)
        return (
          exportData.version === '1.0' &&
          exportData.template.name === '导出测试模板' &&
          exportData.exportedAt !== undefined
        )
      }
    )

    await this.assert(
      '批量导出模板',
      async () => {
        const batchExport = await this.manager.exportTemplates([customTemplateId])
        return (
          batchExport.version === '1.0' &&
          batchExport.count === 1 &&
          Array.isArray(batchExport.templates)
        )
      }
    )

    await this.assert(
      '导入模板',
      async () => {
        const result = await this.manager.importTemplate(exportData, 'did:test:456')
        return result.success === 1 && result.failed === 0
      }
    )

    await this.assert(
      '导入重名模板应失败',
      async () => {
        const result = await this.manager.importTemplate(exportData, 'did:test:456')
        return result.failed === 1 && result.errors.length > 0
      }
    )

    await this.assert(
      '导入覆盖模式',
      async () => {
        const result = await this.manager.importTemplate(
          exportData,
          'did:test:456',
          { overwrite: true }
        )
        return result.success === 1
      }
    )

    await this.assert(
      '导入无效数据',
      async () => {
        try {
          await this.manager.importTemplate({ invalid: 'data' }, 'did:test:123')
          return false
        } catch (error) {
          return error.message === '无效的导入数据格式'
        }
      }
    )

    console.log()
  }

  /**
   * 测试：缓存功能
   */
  async testCaching() {
    console.log('11. 测试缓存功能')
    console.log('---')

    await this.assert(
      '模板查询缓存',
      async () => {
        await this.manager.getTemplateById('built-in:javascript-skill')
        const cached = this.manager.cache.has('built-in:javascript-skill')
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
      '更新时清除缓存',
      async () => {
        const template = await this.manager.createTemplate({
          name: '缓存测试',
          type: 'TestCredential',
          fields: [{ key: 'test', label: '测试', type: 'text', required: true }],
          createdBy: 'did:test:123'
        })

        await this.manager.updateTemplate(template.id, { name: '更新后' })

        return this.manager.statsCache === null
      }
    )

    await this.assert(
      '手动清除所有缓存',
      async () => {
        await this.manager.getTemplateById('built-in:javascript-skill')
        await this.manager.getStatistics()

        this.manager.clearAllCache()

        return this.manager.cache.size === 0 && this.manager.statsCache === null
      }
    )

    console.log()
  }

  /**
   * 测试：边界情况
   */
  async testEdgeCases() {
    console.log('12. 测试边界情况')
    console.log('---')

    await this.assert(
      '创建空名称模板应失败',
      async () => {
        try {
          await this.manager.createTemplate({
            name: '',
            type: 'TestCredential',
            fields: [],
            createdBy: 'did:test:123'
          })
          return false
        } catch (error) {
          return error.message.includes('不能为空')
        }
      }
    )

    await this.assert(
      '创建无效字段定义应失败',
      async () => {
        try {
          await this.manager.createTemplate({
            name: '测试',
            type: 'TestCredential',
            fields: [{ key: 'test' }], // 缺少 label 和 type
            createdBy: 'did:test:123'
          })
          return false
        } catch (error) {
          return error.message.includes('字段定义不完整')
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
          await this.manager.fillTemplateValues('non-existent-id', {})
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
  const test = new VCTemplateManagerTest()
  await test.runAll()
}

// 如果直接运行此文件
if (typeof window === 'undefined') {
  runTests().catch(console.error)
}

export { VCTemplateManagerTest, runTests, MockDatabase }
export default VCTemplateManagerTest
