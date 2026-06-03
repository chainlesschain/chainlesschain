/**
 * 媒体管理系统测试套件
 * Media Manager Test Suite
 *
 * 测试覆盖:
 * - 初始化
 * - 文件导入
 * - 文件查询
 * - 文件搜索
 * - 文件更新
 * - 文件删除
 * - 统计信息
 * - 缓存功能
 * - 批量操作
 * - 边界情况
 *
 * @version 1.0.0
 * @since 2024-01-02
 */

import {
  createMediaManager,
  MediaType,
  SUPPORTED_FORMATS,
  MIME_TYPES,
  FILE_SIZE_LIMITS
} from '../src/services/media/media-manager.js'

// ============================================================
// 模拟数据库
// ============================================================

class MockDatabase {
  constructor() {
    this.tables = {
      media_files: []
    }
    this.indexes = []
  }

  async executeSql(sql, params = []) {
    // 模拟 CREATE TABLE
    if (sql.includes('CREATE TABLE')) {
      return []
    }

    // 模拟 CREATE INDEX
    if (sql.includes('CREATE INDEX')) {
      return []
    }

    // 模拟 INSERT
    if (sql.includes('INSERT INTO media_files')) {
      const record = {
        id: params[0],
        name: params[1],
        type: params[2],
        mime_type: params[3],
        file_path: params[4],
        thumbnail_path: params[5],
        size: params[6],
        duration: params[7],
        page_count: params[8],
        width: params[9],
        height: params[10],
        extracted_text: params[11],
        tags: params[12],
        metadata: params[13],
        created_at: params[14],
        updated_at: params[15],
        deleted: params[16]
      }

      this.tables.media_files.push(record)
      return []
    }

    // 模拟 SELECT
    if (sql.includes('SELECT')) {
      let records = [...this.tables.media_files]

      // WHERE deleted = 0
      if (sql.includes('deleted = 0')) {
        records = records.filter(r => r.deleted === 0)
      }

      // WHERE id = ?
      if (sql.includes('WHERE id = ?')) {
        records = records.filter(r => r.id === params[0])
      }

      // WHERE type = ?
      if (sql.includes('type = ?')) {
        const typeIndex = params.findIndex((p, i) => sql.split('?')[i]?.includes('type'))
        if (typeIndex !== -1) {
          records = records.filter(r => r.type === params[typeIndex])
        }
      }

      // LIKE 搜索
      if (sql.includes('LIKE ?')) {
        const pattern = params[0].replace(/%/g, '')
        records = records.filter(r =>
          r.name.includes(pattern) ||
          (r.extracted_text && r.extracted_text.includes(pattern)) ||
          (r.tags && r.tags.includes(pattern))
        )
      }

      // COUNT
      if (sql.includes('COUNT(*)')) {
        return [{ count: records.length }]
      }

      // GROUP BY type
      if (sql.includes('GROUP BY type')) {
        const grouped = {}
        records.forEach(r => {
          if (!grouped[r.type]) {
            grouped[r.type] = { type: r.type, count: 0, total_size: 0 }
          }
          grouped[r.type].count++
          grouped[r.type].total_size += r.size
        })
        return Object.values(grouped)
      }

      // ORDER BY created_at DESC
      if (sql.includes('ORDER BY created_at DESC')) {
        records.sort((a, b) => b.created_at - a.created_at)
      }

      // ORDER BY size DESC
      if (sql.includes('ORDER BY size DESC')) {
        records.sort((a, b) => b.size - a.size)
      }

      // LIMIT
      const limitMatch = sql.match(/LIMIT\s+\?/)
      if (limitMatch) {
        const limitIndex = params.length - 1
        records = records.slice(0, params[limitIndex])
      }

      return records
    }

    // 模拟 UPDATE
    if (sql.includes('UPDATE media_files')) {
      const idIndex = params.length - 1
      const id = params[idIndex]

      const record = this.tables.media_files.find(r => r.id === id)
      if (record) {
        // 软删除
        if (sql.includes('deleted = 1')) {
          record.deleted = 1
          record.updated_at = params[0]
        } else {
          // 普通更新
          if (sql.includes('name = ?')) {
            record.name = params[0]
          }
          if (sql.includes('tags = ?')) {
            const tagsIndex = params.findIndex((p, i) => sql.split('?')[i]?.includes('tags'))
            if (tagsIndex !== -1) {
              record.tags = params[tagsIndex]
            }
          }
          record.updated_at = params[params.length - 2]
        }
      }

      return []
    }

    return []
  }

  reset() {
    this.tables.media_files = []
  }
}

// ============================================================
// 测试套件
// ============================================================

async function runTests() {
  console.log('='.repeat(60))
  console.log('媒体管理系统测试套件')
  console.log('='.repeat(60))
  console.log()

  const db = new MockDatabase()
  const mediaManager = createMediaManager(db)

  let passedTests = 0
  let failedTests = 0

  // 辅助测试函数
  const test = async (name, fn) => {
    try {
      await fn()
      console.log(`✓ ${name}`)
      passedTests++
    } catch (error) {
      console.error(`✗ ${name}`)
      console.error(`  错误: ${error.message}`)
      failedTests++
    }
  }

  // ============================================================
  // 1. 初始化测试
  // ============================================================

  console.log('1. 初始化测试')
  console.log('-'.repeat(60))

  await test('应该成功创建管理器实例', async () => {
    if (!mediaManager) throw new Error('管理器实例创建失败')
    if (mediaManager.initialized) throw new Error('初始状态应为未初始化')
  })

  await test('应该成功初始化', async () => {
    await mediaManager.initialize()
    if (!mediaManager.initialized) throw new Error('初始化标志未设置')
  })

  await test('重复初始化应该跳过', async () => {
    await mediaManager.initialize()
    if (!mediaManager.initialized) throw new Error('状态异常')
  })

  console.log()

  // ============================================================
  // 2. 文件导入测试
  // ============================================================

  console.log('2. 文件导入测试')
  console.log('-'.repeat(60))

  await test('应该成功导入PDF文档', async () => {
    const fileData = {
      name: 'test-document.pdf',
      path: '/storage/documents/test.pdf',
      size: 1024 * 500,  // 500KB
      pageCount: 10
    }

    const result = await mediaManager.importFile(fileData)

    if (!result.id) throw new Error('未返回文件ID')
    if (result.type !== 'document') throw new Error('文件类型错误')
    if (result.mime_type !== 'application/pdf') throw new Error('MIME类型错误')
  })

  await test('应该成功导入图片文件', async () => {
    const fileData = {
      name: 'test-image.jpg',
      path: '/storage/images/test.jpg',
      size: 1024 * 200,  // 200KB
      width: 1920,
      height: 1080
    }

    const result = await mediaManager.importFile(fileData)

    if (!result.id) throw new Error('未返回文件ID')
    if (result.type !== 'image') throw new Error('文件类型错误')
    if (result.width !== 1920) throw new Error('图片宽度未保存')
    if (result.height !== 1080) throw new Error('图片高度未保存')
  })

  await test('应该成功导入视频文件', async () => {
    const fileData = {
      name: 'test-video.mp4',
      path: '/storage/videos/test.mp4',
      size: 1024 * 1024 * 50,  // 50MB
      duration: 120,  // 2分钟
      width: 1920,
      height: 1080
    }

    const result = await mediaManager.importFile(fileData)

    if (!result.id) throw new Error('未返回文件ID')
    if (result.type !== 'video') throw new Error('文件类型错误')
    if (result.duration !== 120) throw new Error('时长未保存')
  })

  await test('应该成功导入音频文件', async () => {
    const fileData = {
      name: 'test-audio.mp3',
      path: '/storage/audio/test.mp3',
      size: 1024 * 1024 * 5,  // 5MB
      duration: 180  // 3分钟
    }

    const result = await mediaManager.importFile(fileData)

    if (!result.id) throw new Error('未返回文件ID')
    if (result.type !== 'audio') throw new Error('文件类型错误')
  })

  await test('应该成功导入带标签的文件', async () => {
    const fileData = {
      name: 'tagged-document.pdf',
      path: '/storage/documents/tagged.pdf',
      size: 1024 * 300,
      tags: ['工作', '重要', '合同']
    }

    const result = await mediaManager.importFile(fileData)

    if (!result.tags || result.tags.length !== 3) throw new Error('标签未保存')
    if (!result.tags.includes('工作')) throw new Error('标签内容错误')
  })

  await test('文件名为空应该抛出错误', async () => {
    try {
      await mediaManager.importFile({ path: '/test.pdf', size: 1000 })
      throw new Error('应该抛出错误')
    } catch (error) {
      if (!error.message.includes('文件名不能为空')) throw error
    }
  })

  await test('文件路径为空应该抛出错误', async () => {
    try {
      await mediaManager.importFile({ name: 'test.pdf', size: 1000 })
      throw new Error('应该抛出错误')
    } catch (error) {
      if (!error.message.includes('文件路径不能为空')) throw error
    }
  })

  await test('文件大小无效应该抛出错误', async () => {
    try {
      await mediaManager.importFile({ name: 'test.pdf', path: '/test.pdf', size: -1 })
      throw new Error('应该抛出错误')
    } catch (error) {
      if (!error.message.includes('文件大小无效')) throw error
    }
  })

  await test('不支持的文件格式应该抛出错误', async () => {
    try {
      await mediaManager.importFile({
        name: 'test.exe',
        path: '/test.exe',
        size: 1000
      })
      throw new Error('应该抛出错误')
    } catch (error) {
      if (!error.message.includes('不支持的文件格式')) throw error
    }
  })

  await test('文件过大应该抛出错误', async () => {
    try {
      await mediaManager.importFile({
        name: 'large.pdf',
        path: '/large.pdf',
        size: 100 * 1024 * 1024  // 100MB (超过50MB限制)
      })
      throw new Error('应该抛出错误')
    } catch (error) {
      if (!error.message.includes('文件太大')) throw error
    }
  })

  console.log()

  // ============================================================
  // 3. 批量导入测试
  // ============================================================

  console.log('3. 批量导入测试')
  console.log('-'.repeat(60))

  await test('应该成功批量导入多个文件', async () => {
    const files = [
      { name: 'batch1.pdf', path: '/batch1.pdf', size: 1000 },
      { name: 'batch2.jpg', path: '/batch2.jpg', size: 2000 },
      { name: 'batch3.mp4', path: '/batch3.mp4', size: 3000 }
    ]

    const result = await mediaManager.importFiles(files)

    if (result.success.length !== 3) throw new Error('成功数量不正确')
    if (result.failed.length !== 0) throw new Error('失败数量不正确')
  })

  await test('批量导入时应该正确处理部分失败', async () => {
    const files = [
      { name: 'valid.pdf', path: '/valid.pdf', size: 1000 },
      { name: 'invalid.exe', path: '/invalid.exe', size: 1000 },  // 不支持的格式
      { name: 'valid2.jpg', path: '/valid2.jpg', size: 1000 }
    ]

    const result = await mediaManager.importFiles(files)

    if (result.success.length !== 2) throw new Error('成功数量不正确')
    if (result.failed.length !== 1) throw new Error('失败数量不正确')
    if (result.failed[0].file !== 'invalid.exe') throw new Error('失败文件不正确')
  })

  console.log()

  // ============================================================
  // 4. 文件查询测试
  // ============================================================

  console.log('4. 文件查询测试')
  console.log('-'.repeat(60))

  await test('应该获取所有文件', async () => {
    const files = await mediaManager.getAllFiles()
    if (files.length === 0) throw new Error('未获取到文件')
  })

  await test('应该按类型过滤文件', async () => {
    const documents = await mediaManager.getAllFiles({ type: 'document' })
    const invalidType = documents.find(f => f.type !== 'document')
    if (invalidType) throw new Error('过滤结果包含其他类型')
  })

  await test('应该按大小范围过滤文件', async () => {
    const files = await mediaManager.getAllFiles({
      minSize: 2000,
      maxSize: 5000
    })

    const invalidSize = files.find(f => f.size < 2000 || f.size > 5000)
    if (invalidSize) throw new Error('过滤结果超出大小范围')
  })

  await test('应该按标签过滤文件', async () => {
    const files = await mediaManager.getAllFiles({
      tags: ['工作']
    })

    if (files.length === 0) throw new Error('未找到带标签的文件')
    const noTag = files.find(f => !f.tags.includes('工作'))
    if (noTag) throw new Error('过滤结果不包含指定标签')
  })

  await test('应该根据ID获取文件', async () => {
    const allFiles = await mediaManager.getAllFiles()
    if (allFiles.length === 0) throw new Error('没有文件可供测试')

    const file = await mediaManager.getFileById(allFiles[0].id)
    if (!file) throw new Error('未获取到文件')
    if (file.id !== allFiles[0].id) throw new Error('文件ID不匹配')
  })

  await test('获取不存在的文件应该返回null', async () => {
    const file = await mediaManager.getFileById('non-existent-id')
    if (file !== null) throw new Error('应该返回null')
  })

  console.log()

  // ============================================================
  // 5. 文件搜索测试
  // ============================================================

  console.log('5. 文件搜索测试')
  console.log('-'.repeat(60))

  await test('应该根据文件名搜索', async () => {
    const results = await mediaManager.searchFiles('test')
    if (results.length === 0) throw new Error('未找到匹配文件')
  })

  await test('空查询应该返回空数组', async () => {
    const results = await mediaManager.searchFiles('')
    if (results.length !== 0) throw new Error('应该返回空数组')
  })

  await test('搜索应该不区分大小写', async () => {
    const results1 = await mediaManager.searchFiles('TEST')
    const results2 = await mediaManager.searchFiles('test')
    // 由于SQLite LIKE默认不区分大小写，两者应该返回相同结果
    if (results1.length !== results2.length) throw new Error('搜索应该不区分大小写')
  })

  console.log()

  // ============================================================
  // 6. 文件更新测试
  // ============================================================

  console.log('6. 文件更新测试')
  console.log('-'.repeat(60))

  await test('应该成功更新文件名', async () => {
    const allFiles = await mediaManager.getAllFiles()
    if (allFiles.length === 0) throw new Error('没有文件可供测试')

    const fileId = allFiles[0].id
    const newName = 'updated-name.pdf'

    const updated = await mediaManager.updateFile(fileId, { name: newName })

    if (updated.name !== newName) throw new Error('文件名未更新')
  })

  await test('应该成功更新标签', async () => {
    const allFiles = await mediaManager.getAllFiles()
    if (allFiles.length === 0) throw new Error('没有文件可供测试')

    const fileId = allFiles[0].id
    const newTags = ['新标签1', '新标签2']

    const updated = await mediaManager.updateFile(fileId, { tags: newTags })

    if (updated.tags.length !== 2) throw new Error('标签未更新')
    if (!updated.tags.includes('新标签1')) throw new Error('标签内容不正确')
  })

  await test('更新时应该自动更新updated_at', async () => {
    const allFiles = await mediaManager.getAllFiles()
    if (allFiles.length === 0) throw new Error('没有文件可供测试')

    const fileId = allFiles[0].id
    const originalUpdatedAt = allFiles[0].updatedAt

    // 等待1ms确保时间戳不同
    await new Promise(resolve => setTimeout(resolve, 1))

    const updated = await mediaManager.updateFile(fileId, { name: 'new-name.pdf' })

    if (updated.updatedAt <= originalUpdatedAt) throw new Error('updated_at未更新')
  })

  await test('更新不存在的文件应该返回null', async () => {
    const updated = await mediaManager.updateFile('non-existent-id', { name: 'test.pdf' })
    if (updated !== null) throw new Error('应该返回null')
  })

  console.log()

  // ============================================================
  // 7. 文件删除测试
  // ============================================================

  console.log('7. 文件删除测试')
  console.log('-'.repeat(60))

  await test('应该成功删除文件（软删除）', async () => {
    const fileData = {
      name: 'to-delete.pdf',
      path: '/to-delete.pdf',
      size: 1000
    }

    const file = await mediaManager.importFile(fileData)
    await mediaManager.deleteFile(file.id)

    const deleted = await mediaManager.getFileById(file.id)
    if (deleted !== null) throw new Error('文件未被删除')
  })

  await test('应该成功批量删除文件', async () => {
    const file1 = await mediaManager.importFile({
      name: 'batch-delete1.pdf',
      path: '/batch-delete1.pdf',
      size: 1000
    })

    const file2 = await mediaManager.importFile({
      name: 'batch-delete2.pdf',
      path: '/batch-delete2.pdf',
      size: 1000
    })

    const count = await mediaManager.deleteFiles([file1.id, file2.id])

    if (count !== 2) throw new Error('删除数量不正确')

    const deleted1 = await mediaManager.getFileById(file1.id)
    const deleted2 = await mediaManager.getFileById(file2.id)

    if (deleted1 !== null || deleted2 !== null) throw new Error('文件未被删除')
  })

  await test('删除空数组应该返回0', async () => {
    const count = await mediaManager.deleteFiles([])
    if (count !== 0) throw new Error('应该返回0')
  })

  console.log()

  // ============================================================
  // 8. 统计信息测试
  // ============================================================

  console.log('8. 统计信息测试')
  console.log('-'.repeat(60))

  await test('应该获取统计信息', async () => {
    const stats = await mediaManager.getStatistics()

    if (typeof stats.total !== 'number') throw new Error('总数类型错误')
    if (typeof stats.totalSize !== 'number') throw new Error('总大小类型错误')
    if (!stats.byType) throw new Error('缺少按类型统计')
  })

  await test('统计应该正确计算各类型数量', async () => {
    const stats = await mediaManager.getStatistics()

    if (typeof stats.document !== 'number') throw new Error('文档数量类型错误')
    if (typeof stats.image !== 'number') throw new Error('图片数量类型错误')
    if (typeof stats.video !== 'number') throw new Error('视频数量类型错误')
    if (typeof stats.audio !== 'number') throw new Error('音频数量类型错误')
  })

  await test('应该获取最近文件', async () => {
    const recent = await mediaManager.getRecentFiles(5)

    if (!Array.isArray(recent)) throw new Error('应该返回数组')
    if (recent.length > 5) throw new Error('数量超过限制')

    // 检查是否按时间排序
    for (let i = 1; i < recent.length; i++) {
      if (recent[i].createdAt > recent[i - 1].createdAt) {
        throw new Error('未按时间排序')
      }
    }
  })

  await test('应该获取最大文件列表', async () => {
    const largest = await mediaManager.getLargestFiles(5)

    if (!Array.isArray(largest)) throw new Error('应该返回数组')
    if (largest.length > 5) throw new Error('数量超过限制')

    // 检查是否按大小排序
    for (let i = 1; i < largest.length; i++) {
      if (largest[i].size > largest[i - 1].size) {
        throw new Error('未按大小排序')
      }
    }
  })

  console.log()

  // ============================================================
  // 9. 缓存测试
  // ============================================================

  console.log('9. 缓存测试')
  console.log('-'.repeat(60))

  await test('第二次获取文件应该使用缓存', async () => {
    const allFiles = await mediaManager.getAllFiles()
    if (allFiles.length === 0) throw new Error('没有文件可供测试')

    const fileId = allFiles[0].id

    // 第一次获取
    await mediaManager.getFileById(fileId)

    // 第二次获取应该使用缓存
    const cached = mediaManager.cache.get(fileId)
    if (!cached) throw new Error('未缓存文件')
  })

  await test('统计信息应该被缓存', async () => {
    // 第一次获取
    await mediaManager.getStatistics()

    // 检查缓存
    if (!mediaManager.statsCache) throw new Error('统计信息未缓存')
  })

  await test('更新文件应该清除缓存', async () => {
    const allFiles = await mediaManager.getAllFiles()
    if (allFiles.length === 0) throw new Error('没有文件可供测试')

    const fileId = allFiles[0].id

    // 先获取一次以填充缓存
    await mediaManager.getFileById(fileId)

    // 更新文件
    await mediaManager.updateFile(fileId, { name: 'cache-test.pdf' })

    // 检查缓存是否被清除
    const cached = mediaManager.cache.get(fileId)
    if (cached) throw new Error('缓存未被清除')
  })

  await test('删除文件应该清除缓存', async () => {
    const fileData = {
      name: 'cache-delete-test.pdf',
      path: '/cache-delete-test.pdf',
      size: 1000
    }

    const file = await mediaManager.importFile(fileData)

    // 获取文件以填充缓存
    await mediaManager.getFileById(file.id)

    // 删除文件
    await mediaManager.deleteFile(file.id)

    // 检查缓存是否被清除
    const cached = mediaManager.cache.get(file.id)
    if (cached) throw new Error('缓存未被清除')
  })

  console.log()

  // ============================================================
  // 10. 工具方法测试
  // ============================================================

  console.log('10. 工具方法测试')
  console.log('-'.repeat(60))

  await test('应该正确格式化文件大小', async () => {
    const { formatFileSize } = await import('../src/services/media/media-manager.js')

    if (formatFileSize(0) !== '0 B') throw new Error('0字节格式化错误')
    if (formatFileSize(1024) !== '1 KB') throw new Error('1KB格式化错误')
    if (formatFileSize(1024 * 1024) !== '1 MB') throw new Error('1MB格式化错误')
    if (formatFileSize(1024 * 1024 * 1024) !== '1 GB') throw new Error('1GB格式化错误')
  })

  await test('应该正确格式化时长', async () => {
    const { formatDuration } = await import('../src/services/media/media-manager.js')

    if (formatDuration(0) !== '00:00') throw new Error('0秒格式化错误')
    if (formatDuration(60) !== '01:00') throw new Error('1分钟格式化错误')
    if (formatDuration(3661) !== '01:01:01') throw new Error('1小时1分1秒格式化错误')
  })

  await test('应该获取支持的文件格式', async () => {
    const formats = mediaManager.getSupportedFormats()

    if (!formats.document) throw new Error('缺少文档格式')
    if (!formats.image) throw new Error('缺少图片格式')
    if (!formats.video) throw new Error('缺少视频格式')
    if (!formats.audio) throw new Error('缺少音频格式')
  })

  await test('应该获取文件大小限制', async () => {
    const limits = mediaManager.getFileSizeLimits()

    if (typeof limits.document !== 'number') throw new Error('文档限制类型错误')
    if (typeof limits.image !== 'number') throw new Error('图片限制类型错误')
    if (typeof limits.video !== 'number') throw new Error('视频限制类型错误')
    if (typeof limits.audio !== 'number') throw new Error('音频限制类型错误')
  })

  console.log()

  // ============================================================
  // 测试总结
  // ============================================================

  console.log('='.repeat(60))
  console.log('测试总结')
  console.log('='.repeat(60))
  console.log(`总测试数: ${passedTests + failedTests}`)
  console.log(`✓ 通过: ${passedTests}`)
  console.log(`✗ 失败: ${failedTests}`)
  console.log(`通过率: ${((passedTests / (passedTests + failedTests)) * 100).toFixed(2)}%`)
  console.log('='.repeat(60))

  if (failedTests === 0) {
    console.log('\n🎉 所有测试通过！')
  } else {
    console.log(`\n⚠️  有 ${failedTests} 个测试失败`)
  }
}

// 运行测试
runTests().catch(error => {
  console.error('测试运行失败:', error)
  process.exit(1)
})
