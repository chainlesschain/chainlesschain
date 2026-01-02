/**
 * 知识库Git集成服务 (移动端版本)
 *
 * 功能：
 * - 知识库笔记的Git版本控制
 * - 自动提交笔记更改
 * - 远程同步（推送/拉取）
 * - 冲突处理
 *
 * 与知识库服务集成
 */

import GitManager from './git-manager.js'
import { getGitAutoSync } from './git-auto-sync.js'
import ConflictResolver from './conflict-resolver.js'
import { getFSAdapter } from './fs-adapter.js'
import { db as database } from '../database.js'

/**
 * 知识库Git集成服务类
 */
class KnowledgeGitIntegration {
  constructor(config = {}) {
    this.config = {
      // 仓库名称
      repoName: config.repoName || 'knowledge-base',

      // 是否启用Git
      enableGit: config.enableGit !== false,

      // 是否自动提交
      autoCommit: config.autoCommit !== false,

      // 是否自动推送
      autoPush: config.autoPush !== false,

      // 自动同步间隔（毫秒）
      syncInterval: config.syncInterval || 10 * 60 * 1000, // 默认10分钟

      ...config
    }

    // Git管理器
    this.gitManager = null

    // 自动同步服务
    this.autoSync = null

    // 冲突解决器
    this.conflictResolver = null

    // 文件系统适配器
    this.fs = getFSAdapter()

    // 初始化状态
    this.isInitialized = false

    // 待提交的更改队列
    this.pendingChanges = []
  }

  /**
   * 初始化Git集成
   * @returns {Promise<Object>}
   */
  async initialize() {
    if (!this.config.enableGit) {
      console.log('[KnowledgeGit] Git功能未启用')
      return { success: false, message: 'Git功能未启用' }
    }

    try {
      console.log('[KnowledgeGit] 初始化Git集成...')

      // 创建Git管理器
      this.gitManager = new GitManager({
        repoName: this.config.repoName,
        authorName: this.config.authorName || 'ChainlessChain User',
        authorEmail: this.config.authorEmail || 'user@chainlesschain.com'
      })

      // 初始化Git仓库
      await this.gitManager.initialize()

      // 创建冲突解决器
      this.conflictResolver = new ConflictResolver(this.gitManager)

      // 初始化自动同步（如果启用）
      if (this.config.autoCommit) {
        this.autoSync = getGitAutoSync({
          interval: this.config.syncInterval,
          enabled: true,
          autoPush: this.config.autoPush
        })

        await this.autoSync.start(this.config.repoName, {
          authorName: this.config.authorName,
          authorEmail: this.config.authorEmail
        })
      }

      this.isInitialized = true

      console.log('[KnowledgeGit] ✅ Git集成初始化成功')

      return {
        success: true,
        repoPath: this.gitManager.repoPath,
        autoCommit: this.config.autoCommit,
        autoPush: this.config.autoPush
      }
    } catch (error) {
      console.error('[KnowledgeGit] 初始化失败:', error)
      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * 笔记创建时的钩子
   * @param {Object} note - 笔记对象
   * @returns {Promise<boolean>}
   */
  async onNoteCreated(note) {
    if (!this.isInitialized || !this.config.autoCommit) {
      return false
    }

    try {
      console.log('[KnowledgeGit] 笔记创建:', note.id)

      // 导出笔记到Git仓库
      await this.exportNoteToRepo(note)

      // 添加到Git
      await this.gitManager.add(`notes/${note.id}.md`)

      // 提交
      const message = `创建笔记: ${note.title || '无标题'}`
      await this.gitManager.commit(message)

      console.log('[KnowledgeGit] ✅ 笔记已提交到Git')

      // 自动推送（如果启用）
      if (this.config.autoPush && this.gitManager.remote.url) {
        await this.gitManager.push().catch(err => {
          console.error('[KnowledgeGit] 推送失败:', err)
        })
      }

      return true
    } catch (error) {
      console.error('[KnowledgeGit] 笔记创建钩子失败:', error)
      return false
    }
  }

  /**
   * 笔记更新时的钩子
   * @param {Object} note - 笔记对象
   * @returns {Promise<boolean>}
   */
  async onNoteUpdated(note) {
    if (!this.isInitialized || !this.config.autoCommit) {
      return false
    }

    try {
      console.log('[KnowledgeGit] 笔记更新:', note.id)

      // 导出笔记到Git仓库
      await this.exportNoteToRepo(note)

      // 添加到Git
      await this.gitManager.add(`notes/${note.id}.md`)

      // 提交
      const message = `更新笔记: ${note.title || '无标题'}`
      await this.gitManager.commit(message)

      console.log('[KnowledgeGit] ✅ 笔记更新已提交到Git')

      // 自动推送（如果启用）
      if (this.config.autoPush && this.gitManager.remote.url) {
        await this.gitManager.push().catch(err => {
          console.error('[KnowledgeGit] 推送失败:', err)
        })
      }

      return true
    } catch (error) {
      console.error('[KnowledgeGit] 笔记更新钩子失败:', error)
      return false
    }
  }

  /**
   * 笔记删除时的钩子
   * @param {string} noteId - 笔记ID
   * @param {string} title - 笔记标题
   * @returns {Promise<boolean>}
   */
  async onNoteDeleted(noteId, title) {
    if (!this.isInitialized || !this.config.autoCommit) {
      return false
    }

    try {
      console.log('[KnowledgeGit] 笔记删除:', noteId)

      // 从Git仓库删除文件
      const filepath = `${this.gitManager.repoPath}/notes/${noteId}.md`
      const exists = await this.fs.exists(filepath)

      if (exists) {
        await this.fs.unlink(filepath)

        // 提交删除
        const message = `删除笔记: ${title || noteId}`
        await this.gitManager.commit(message)

        console.log('[KnowledgeGit] ✅ 笔记删除已提交到Git')

        // 自动推送（如果启用）
        if (this.config.autoPush && this.gitManager.remote.url) {
          await this.gitManager.push().catch(err => {
            console.error('[KnowledgeGit] 推送失败:', err)
          })
        }
      }

      return true
    } catch (error) {
      console.error('[KnowledgeGit] 笔记删除钩子失败:', error)
      return false
    }
  }

  /**
   * 导出笔记到Git仓库
   * @param {Object} note - 笔记对象
   * @returns {Promise<void>}
   * @private
   */
  async exportNoteToRepo(note) {
    try {
      // 确保notes目录存在
      const notesDir = `${this.gitManager.repoPath}/notes`
      const exists = await this.fs.exists(notesDir)

      if (!exists) {
        await this.fs.mkdir(notesDir, { recursive: true })
      }

      // 生成Markdown内容
      const markdown = this.generateMarkdown(note)

      // 写入文件
      const filepath = `${notesDir}/${note.id}.md`
      await this.fs.writeFile(filepath, markdown, 'utf8')

      console.log('[KnowledgeGit] 笔记已导出:', filepath)
    } catch (error) {
      console.error('[KnowledgeGit] 导出笔记失败:', error)
      throw error
    }
  }

  /**
   * 生成Markdown格式
   * @param {Object} note - 笔记对象
   * @returns {string}
   * @private
   */
  generateMarkdown(note) {
    const lines = []

    // 标题
    lines.push(`# ${note.title || '无标题'}`)
    lines.push('')

    // 元数据
    lines.push('---')
    lines.push(`id: ${note.id}`)
    lines.push(`created: ${note.created_at || new Date().toISOString()}`)
    lines.push(`updated: ${note.updated_at || new Date().toISOString()}`)

    if (note.tags) {
      lines.push(`tags: ${note.tags}`)
    }

    if (note.type) {
      lines.push(`type: ${note.type}`)
    }

    lines.push('---')
    lines.push('')

    // 内容
    lines.push(note.content || '')

    return lines.join('\n')
  }

  /**
   * 配置远程仓库
   * @param {string} url - 远程仓库URL
   * @param {Object} auth - 认证信息
   * @returns {Promise<boolean>}
   */
  async setRemote(url, auth = null) {
    if (!this.isInitialized) {
      throw new Error('Git集成未初始化')
    }

    try {
      await this.gitManager.setRemote(url)

      if (auth) {
        this.gitManager.setAuth(auth)
      }

      console.log('[KnowledgeGit] ✅ 远程仓库已配置:', url)

      return true
    } catch (error) {
      console.error('[KnowledgeGit] 配置远程仓库失败:', error)
      throw error
    }
  }

  /**
   * 推送到远程仓库
   * @returns {Promise<Object>}
   */
  async push() {
    if (!this.isInitialized) {
      throw new Error('Git集成未初始化')
    }

    try {
      console.log('[KnowledgeGit] 推送到远程...')

      const result = await this.gitManager.push()

      console.log('[KnowledgeGit] ✅ 推送成功')

      return result
    } catch (error) {
      console.error('[KnowledgeGit] 推送失败:', error)
      throw error
    }
  }

  /**
   * 从远程拉取
   * @returns {Promise<Object>}
   */
  async pull() {
    if (!this.isInitialized) {
      throw new Error('Git集成未初始化')
    }

    try {
      console.log('[KnowledgeGit] 从远程拉取...')

      const result = await this.gitManager.pull()

      if (result.hasConflicts) {
        console.warn('[KnowledgeGit] ⚠️ 拉取时检测到冲突')

        // 检测冲突
        await this.conflictResolver.detectConflicts()

        return {
          success: false,
          hasConflicts: true,
          conflicts: this.conflictResolver.getConflicts(),
          message: '拉取时检测到冲突，需要解决'
        }
      }

      console.log('[KnowledgeGit] ✅ 拉取成功')

      // 从Git仓库导入笔记到数据库
      await this.importNotesFromRepo()

      return {
        success: true,
        hasConflicts: false,
        message: '拉取成功'
      }
    } catch (error) {
      console.error('[KnowledgeGit] 拉取失败:', error)
      throw error
    }
  }

  /**
   * 从Git仓库导入笔记到数据库
   * @returns {Promise<number>}
   * @private
   */
  async importNotesFromRepo() {
    try {
      console.log('[KnowledgeGit] 从仓库导入笔记...')

      const notesDir = `${this.gitManager.repoPath}/notes`
      const exists = await this.fs.exists(notesDir)

      if (!exists) {
        console.log('[KnowledgeGit] notes目录不存在')
        return 0
      }

      const files = await this.fs.readdir(notesDir)
      let imported = 0

      for (const file of files) {
        if (!file.endsWith('.md')) continue

        const filepath = `${notesDir}/${file}`
        const content = await this.fs.readFile(filepath, 'utf8')

        // 解析Markdown
        const note = this.parseMarkdown(content)

        if (note) {
          // 更新或插入到数据库
          await this.upsertNote(note)
          imported++
        }
      }

      console.log('[KnowledgeGit] ✅ 导入完成:', imported, '个笔记')

      return imported
    } catch (error) {
      console.error('[KnowledgeGit] 导入笔记失败:', error)
      return 0
    }
  }

  /**
   * 解析Markdown内容
   * @param {string} markdown - Markdown内容
   * @returns {Object|null}
   * @private
   */
  parseMarkdown(markdown) {
    try {
      const lines = markdown.split('\n')

      let title = ''
      let metadata = {}
      let content = []
      let inMetadata = false
      let inContent = false

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]

        // 提取标题
        if (line.startsWith('# ') && !title) {
          title = line.substring(2).trim()
          continue
        }

        // 元数据开始
        if (line === '---' && !inMetadata && !inContent) {
          inMetadata = true
          continue
        }

        // 元数据结束
        if (line === '---' && inMetadata) {
          inMetadata = false
          inContent = true
          continue
        }

        // 解析元数据
        if (inMetadata) {
          const match = line.match(/^(\w+):\s*(.+)$/)
          if (match) {
            metadata[match[1]] = match[2]
          }
          continue
        }

        // 内容
        if (inContent) {
          content.push(line)
        }
      }

      return {
        id: metadata.id,
        title,
        content: content.join('\n').trim(),
        type: metadata.type || 'note',
        tags: metadata.tags || '',
        created_at: metadata.created || new Date().toISOString(),
        updated_at: metadata.updated || new Date().toISOString()
      }
    } catch (error) {
      console.error('[KnowledgeGit] 解析Markdown失败:', error)
      return null
    }
  }

  /**
   * 更新或插入笔记到数据库
   * @param {Object} note - 笔记对象
   * @returns {Promise<void>}
   * @private
   */
  async upsertNote(note) {
    try {
      // 检查笔记是否存在
      const existing = await database.exec(
        'SELECT id FROM notes WHERE id = ?',
        [note.id]
      )

      if (existing && existing.length > 0) {
        // 更新
        await database.exec(`
          UPDATE notes
          SET title = ?, content = ?, type = ?, tags = ?, updated_at = ?
          WHERE id = ?
        `, [note.title, note.content, note.type, note.tags, Date.now(), note.id])
      } else {
        // 插入
        await database.exec(`
          INSERT INTO notes (id, title, content, type, tags, created_at, updated_at, deleted)
          VALUES (?, ?, ?, ?, ?, ?, ?, 0)
        `, [note.id, note.title, note.content, note.type, note.tags, Date.now(), Date.now()])
      }
    } catch (error) {
      console.error('[KnowledgeGit] 更新笔记失败:', error)
      throw error
    }
  }

  /**
   * 获取Git状态
   * @returns {Promise<Object>}
   */
  async getStatus() {
    if (!this.isInitialized) {
      return { enabled: false }
    }

    try {
      const status = await this.gitManager.getStatus()

      return {
        enabled: true,
        ...status,
        autoCommit: this.config.autoCommit,
        autoPush: this.config.autoPush
      }
    } catch (error) {
      console.error('[KnowledgeGit] 获取状态失败:', error)
      return { enabled: true, error: error.message }
    }
  }

  /**
   * 获取提交历史
   * @param {number} limit - 限制数量
   * @returns {Promise<Array>}
   */
  async getHistory(limit = 20) {
    if (!this.isInitialized) {
      return []
    }

    try {
      return await this.gitManager.getLog(limit)
    } catch (error) {
      console.error('[KnowledgeGit] 获取历史失败:', error)
      return []
    }
  }

  /**
   * 获取冲突解决器
   * @returns {ConflictResolver}
   */
  getConflictResolver() {
    return this.conflictResolver
  }

  /**
   * 启用/禁用自动提交
   * @param {boolean} enabled - 是否启用
   */
  setAutoCommit(enabled) {
    this.config.autoCommit = enabled

    if (this.autoSync) {
      this.autoSync.setEnabled(enabled)
    }

    console.log('[KnowledgeGit] 自动提交:', enabled ? '启用' : '禁用')
  }

  /**
   * 启用/禁用自动推送
   * @param {boolean} enabled - 是否启用
   */
  setAutoPush(enabled) {
    this.config.autoPush = enabled

    if (this.autoSync) {
      this.autoSync.setAutoPush(enabled)
    }

    console.log('[KnowledgeGit] 自动推送:', enabled ? '启用' : '禁用')
  }
}

// 创建单例
let integrationInstance = null

/**
 * 获取知识库Git集成实例
 * @param {Object} config - 配置
 * @returns {KnowledgeGitIntegration}
 */
export function getKnowledgeGitIntegration(config) {
  if (!integrationInstance) {
    integrationInstance = new KnowledgeGitIntegration(config)
  }
  return integrationInstance
}

export default KnowledgeGitIntegration
