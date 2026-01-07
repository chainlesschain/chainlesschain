/**
 * P2P处理器自动化测试脚本
 *
 * 测试所有P2P处理器的功能是否正常
 */

const path = require('path')
const Database = require('better-sqlite3')

// 模拟处理器
class MockDatabaseManager {
  constructor(dbPath) {
    this.db = new Database(dbPath, { readonly: true })
  }

  all(sql, params = []) {
    const stmt = this.db.prepare(sql)
    return stmt.all(...params)
  }

  get(sql, params = []) {
    const stmt = this.db.prepare(sql)
    return stmt.get(...params)
  }

  close() {
    this.db.close()
  }
}

// 测试知识库同步处理器
async function testKnowledgeSyncHandler() {
  console.log('\n========== 测试知识库同步处理器 ==========\n')

  const KnowledgeSyncHandler = require('../src/main/p2p/knowledge-sync-handler.js')

  // 获取数据库路径
  const userDataPath = process.env.APPDATA ||
    (process.platform === 'darwin' ? process.env.HOME + '/Library/Application Support' : process.env.HOME + '/.local/share')
  const dbPath = path.join(userDataPath, 'chainlesschain-desktop-vue', 'data', 'chainlesschain.db')

  console.log('📂 数据库路径:', dbPath)

  try {
    const db = new MockDatabaseManager(dbPath)
    const handler = new KnowledgeSyncHandler(db)

    // 测试1: 获取笔记列表
    console.log('\n✅ 测试 1: 获取笔记列表')
    const mockMessage1 = {
      type: 'knowledge:list-notes',
      requestId: 'test-1',
      params: { limit: 10, offset: 0 }
    }

    const result1 = await handler.handleMessage('mock-peer-id', mockMessage1)
    console.log('   响应:', result1 ? '成功' : '失败')
    if (result1 && result1.data) {
      console.log(`   笔记数: ${result1.data.notes?.length || 0}`)
      console.log(`   总数: ${result1.data.total || 0}`)
    }

    // 测试2: 获取文件夹列表
    console.log('\n✅ 测试 2: 获取文件夹列表')
    const mockMessage2 = {
      type: 'knowledge:list-folders',
      requestId: 'test-2',
      params: {}
    }

    const result2 = await handler.handleMessage('mock-peer-id', mockMessage2)
    console.log('   响应:', result2 ? '成功' : '失败')
    if (result2 && result2.data) {
      console.log(`   文件夹数: ${result2.data.folders?.length || 0}`)
    }

    // 测试3: 获取标签列表
    console.log('\n✅ 测试 3: 获取标签列表')
    const mockMessage3 = {
      type: 'knowledge:list-tags',
      requestId: 'test-3',
      params: {}
    }

    const result3 = await handler.handleMessage('mock-peer-id', mockMessage3)
    console.log('   响应:', result3 ? '成功' : '失败')
    if (result3 && result3.data) {
      console.log(`   标签数: ${result3.data.tags?.length || 0}`)
    }

    // 测试4: 搜索笔记（搜索"Markdown"）
    console.log('\n✅ 测试 4: 搜索笔记（关键词: "Markdown"）')
    const mockMessage4 = {
      type: 'knowledge:search-notes',
      requestId: 'test-4',
      params: { query: 'Markdown', limit: 10, offset: 0 }
    }

    const result4 = await handler.handleMessage('mock-peer-id', mockMessage4)
    console.log('   响应:', result4 ? '成功' : '失败')
    if (result4 && result4.data) {
      console.log(`   搜索结果数: ${result4.data.notes?.length || 0}`)
      if (result4.data.notes && result4.data.notes.length > 0) {
        console.log(`   第一条结果: ${result4.data.notes[0].title}`)
      }
    }

    // 测试5: 获取单个笔记详情
    console.log('\n✅ 测试 5: 获取笔记详情')

    // 先获取第一个笔记的ID
    const firstNote = result1?.data?.notes?.[0]
    if (firstNote) {
      const mockMessage5 = {
        type: 'knowledge:get-note',
        requestId: 'test-5',
        params: { noteId: firstNote.id }
      }

      const result5 = await handler.handleMessage('mock-peer-id', mockMessage5)
      console.log('   响应:', result5 ? '成功' : '失败')
      if (result5 && result5.data && result5.data.note) {
        console.log(`   笔记标题: ${result5.data.note.title}`)
        console.log(`   内容长度: ${result5.data.note.content?.length || 0} 字符`)
      }
    } else {
      console.log('   跳过（没有笔记）')
    }

    db.close()
    console.log('\n✅ 知识库同步处理器测试完成！')
    return true

  } catch (error) {
    console.error('\n❌ 知识库同步处理器测试失败:', error.message)
    return false
  }
}

// 测试项目同步处理器
async function testProjectSyncHandler() {
  console.log('\n========== 测试项目同步处理器 ==========\n')

  const ProjectSyncHandler = require('../src/main/p2p/project-sync-handler.js')

  const userDataPath = process.env.APPDATA ||
    (process.platform === 'darwin' ? process.env.HOME + '/Library/Application Support' : process.env.HOME + '/.local/share')
  const dbPath = path.join(userDataPath, 'chainlesschain-desktop-vue', 'data', 'chainlesschain.db')

  try {
    const db = new MockDatabaseManager(dbPath)
    const handler = new ProjectSyncHandler(db)

    // 测试1: 获取项目列表
    console.log('\n✅ 测试 1: 获取项目列表')
    const mockMessage1 = {
      type: 'project:list-projects',
      requestId: 'test-1',
      params: { limit: 10, offset: 0 }
    }

    const result1 = await handler.handleMessage('mock-peer-id', mockMessage1)
    console.log('   响应:', result1 ? '成功' : '失败')
    if (result1 && result1.data) {
      console.log(`   项目数: ${result1.data.projects?.length || 0}`)
      console.log(`   总数: ${result1.data.total || 0}`)

      if (result1.data.projects && result1.data.projects.length > 0) {
        console.log(`   第一个项目: ${result1.data.projects[0].name}`)
      }
    }

    // 测试2: 获取项目详情（如果有项目）
    const firstProject = result1?.data?.projects?.[0]
    if (firstProject) {
      console.log('\n✅ 测试 2: 获取项目详情')
      const mockMessage2 = {
        type: 'project:get-project',
        requestId: 'test-2',
        params: { projectId: firstProject.id }
      }

      const result2 = await handler.handleMessage('mock-peer-id', mockMessage2)
      console.log('   响应:', result2 ? '成功' : '失败')
      if (result2 && result2.data && result2.data.project) {
        console.log(`   项目名称: ${result2.data.project.name}`)
        console.log(`   本地路径: ${result2.data.project.local_path || '无'}`)
        if (result2.data.project.stats) {
          console.log(`   文件统计: ${result2.data.project.stats.totalFiles || 0} 个文件`)
        }
      }

      // 测试3: 获取文件树（如果项目有本地路径）
      if (firstProject.local_path) {
        console.log('\n✅ 测试 3: 获取文件树')
        const mockMessage3 = {
          type: 'project:get-file-tree',
          requestId: 'test-3',
          params: { projectId: firstProject.id, maxDepth: 2 }
        }

        const result3 = await handler.handleMessage('mock-peer-id', mockMessage3)
        console.log('   响应:', result3 ? '成功' : '失败')
        if (result3 && result3.data && result3.data.fileTree) {
          console.log(`   根节点数: ${result3.data.fileTree.length}`)
        }
      }
    } else {
      console.log('\n⚠️  数据库中没有项目，跳过详细测试')
    }

    db.close()
    console.log('\n✅ 项目同步处理器测试完成！')
    return true

  } catch (error) {
    console.error('\n❌ 项目同步处理器测试失败:', error.message)
    return false
  }
}

// 测试PC状态处理器
async function testPCStatusHandler() {
  console.log('\n========== 测试PC状态处理器 ==========\n')

  const PCStatusHandler = require('../src/main/p2p/pc-status-handler.js')

  try {
    const handler = new PCStatusHandler()

    // 测试1: 获取系统信息
    console.log('\n✅ 测试 1: 获取系统信息')
    const mockMessage1 = {
      type: 'pc-status:get-system-info',
      requestId: 'test-1'
    }

    const result1 = await handler.handleMessage('mock-peer-id', mockMessage1)
    console.log('   响应:', result1 ? '成功' : '失败')
    if (result1 && result1.data && result1.data.systemInfo) {
      console.log(`   平台: ${result1.data.systemInfo.platform}`)
      console.log(`   CPU: ${result1.data.systemInfo.cpus?.[0]?.model || '未知'}`)
      console.log(`   内存: ${(result1.data.systemInfo.totalMemory / 1024 / 1024 / 1024).toFixed(2)} GB`)
    }

    // 测试2: 获取服务状态
    console.log('\n✅ 测试 2: 获取服务状态')
    const mockMessage2 = {
      type: 'pc-status:get-services',
      requestId: 'test-2'
    }

    const result2 = await handler.handleMessage('mock-peer-id', mockMessage2)
    console.log('   响应:', result2 ? '成功' : '失败')
    if (result2 && result2.data && result2.data.services) {
      console.log(`   服务数: ${result2.data.services.length}`)
      const runningServices = result2.data.services.filter(s => s.status === 'running')
      console.log(`   运行中: ${runningServices.length}`)
    }

    // 测试3: 获取实时监控数据
    console.log('\n✅ 测试 3: 获取实时监控数据')
    const mockMessage3 = {
      type: 'pc-status:get-monitoring',
      requestId: 'test-3'
    }

    const result3 = await handler.handleMessage('mock-peer-id', mockMessage3)
    console.log('   响应:', result3 ? '成功' : '失败')
    if (result3 && result3.data && result3.data.monitoring) {
      console.log(`   CPU使用率: ${result3.data.monitoring.cpuUsage?.toFixed(2)}%`)
      console.log(`   内存使用率: ${result3.data.monitoring.memoryUsage?.toFixed(2)}%`)
      console.log(`   进程数: ${result3.data.monitoring.processCount}`)
    }

    console.log('\n✅ PC状态处理器测试完成！')
    return true

  } catch (error) {
    console.error('\n❌ PC状态处理器测试失败:', error.message)
    return false
  }
}

// 主测试函数
async function runTests() {
  console.log('╔════════════════════════════════════════════════════════╗')
  console.log('║       ChainlessChain P2P处理器自动化测试              ║')
  console.log('╚════════════════════════════════════════════════════════╝')

  const results = {
    knowledgeSync: false,
    projectSync: false,
    pcStatus: false
  }

  try {
    // 测试知识库同步
    results.knowledgeSync = await testKnowledgeSyncHandler()

    // 测试项目同步
    results.projectSync = await testProjectSyncHandler()

    // 测试PC状态
    results.pcStatus = await testPCStatusHandler()

  } catch (error) {
    console.error('\n❌ 测试过程中发生错误:', error)
  }

  // 打印测试总结
  console.log('\n╔════════════════════════════════════════════════════════╗')
  console.log('║                   测试结果汇总                         ║')
  console.log('╚════════════════════════════════════════════════════════╝\n')

  console.log(`知识库同步处理器: ${results.knowledgeSync ? '✅ 通过' : '❌ 失败'}`)
  console.log(`项目同步处理器:   ${results.projectSync ? '✅ 通过' : '❌ 失败'}`)
  console.log(`PC状态处理器:     ${results.pcStatus ? '✅ 通过' : '❌ 失败'}`)

  const totalTests = 3
  const passedTests = Object.values(results).filter(r => r).length

  console.log(`\n总计: ${passedTests}/${totalTests} 通过`)
  console.log(`成功率: ${(passedTests / totalTests * 100).toFixed(2)}%`)

  if (passedTests === totalTests) {
    console.log('\n🎉 所有测试通过！PC端处理器功能正常！')
    process.exit(0)
  } else {
    console.log('\n⚠️  部分测试失败，请检查错误信息')
    process.exit(1)
  }
}

// 运行测试
runTests().catch(error => {
  console.error('测试运行失败:', error)
  process.exit(1)
})
