/**
 * Git冲突解决器 (移动端版本)
 *
 * 功能：
 * - 冲突检测
 * - 冲突内容解析
 * - 多种解决策略
 * - 批量冲突解决
 * - UI数据格式化
 *
 * 功能对齐桌面端
 */

/**
 * 冲突解决器类
 */
class ConflictResolver {
  constructor(gitManager) {
    this.gitManager = gitManager

    // 冲突文件列表
    this.conflicts = []

    // 解决策略
    this.strategies = {
      OURS: 'ours',         // 保留本地版本
      THEIRS: 'theirs',     // 使用远程版本
      MANUAL: 'manual'      // 手动编辑
    }
  }

  /**
   * 检测冲突
   * @returns {Promise<Object>}
   */
  async detectConflicts() {
    try {
      console.log('[ConflictResolver] 检测冲突...')

      const conflictFiles = await this.gitManager.getConflictFiles()

      this.conflicts = []

      // 获取每个冲突文件的详细信息
      for (const file of conflictFiles) {
        const conflictData = await this.gitManager.getConflictContent(file.filepath)

        this.conflicts.push({
          filepath: file.filepath,
          status: file.status,
          content: conflictData.fullContent,
          conflicts: conflictData.conflicts,
          resolved: false,
          resolution: null
        })
      }

      console.log('[ConflictResolver] 检测到冲突文件:', this.conflicts.length)

      return {
        hasConflicts: this.conflicts.length > 0,
        count: this.conflicts.length,
        files: this.conflicts.map(c => ({
          filepath: c.filepath,
          conflictsCount: c.conflicts.length,
          resolved: c.resolved
        }))
      }
    } catch (error) {
      console.error('[ConflictResolver] 冲突检测失败:', error)
      throw error
    }
  }

  /**
   * 获取冲突列表
   * @returns {Array}
   */
  getConflicts() {
    return this.conflicts
  }

  /**
   * 获取冲突文件详情
   * @param {string} filepath - 文件路径
   * @returns {Object|null}
   */
  getConflictDetail(filepath) {
    return this.conflicts.find(c => c.filepath === filepath) || null
  }

  /**
   * 格式化冲突内容（用于UI展示）
   * @param {string} filepath - 文件路径
   * @returns {Object|null}
   */
  formatConflictForUI(filepath) {
    const conflict = this.getConflictDetail(filepath)

    if (!conflict) {
      return null
    }

    // 将冲突内容转换为UI友好的格式
    const formattedConflicts = conflict.conflicts.map((c, index) => ({
      id: index,
      startLine: c.startLine,
      endLine: c.endLine,
      ours: {
        label: c.oursLabel || 'HEAD (本地)',
        content: c.ours,
        lines: c.ours.split('\n').length
      },
      theirs: {
        label: c.theirsLabel || 'REMOTE (远程)',
        content: c.theirs,
        lines: c.theirs.split('\n').length
      },
      resolved: false,
      selectedVersion: null
    }))

    return {
      filepath: conflict.filepath,
      totalConflicts: formattedConflicts.length,
      conflicts: formattedConflicts,
      fullContent: conflict.content,
      resolved: conflict.resolved
    }
  }

  /**
   * 解决单个文件的冲突
   * @param {string} filepath - 文件路径
   * @param {string} strategy - 解决策略
   * @param {string} content - 如果是manual策略，提供解决后的内容
   * @returns {Promise<boolean>}
   */
  async resolveConflict(filepath, strategy, content = null) {
    try {
      console.log('[ConflictResolver] 解决冲突:', filepath, strategy)

      // 验证策略
      if (!Object.values(this.strategies).includes(strategy)) {
        throw new Error(`无效的解决策略: ${strategy}`)
      }

      // 使用GitManager解决冲突
      await this.gitManager.resolveConflict(filepath, strategy, content)

      // 更新本地冲突记录
      const conflict = this.conflicts.find(c => c.filepath === filepath)

      if (conflict) {
        conflict.resolved = true
        conflict.resolution = strategy
      }

      console.log('[ConflictResolver] ✅ 冲突已解决:', filepath)

      return true
    } catch (error) {
      console.error('[ConflictResolver] 解决冲突失败:', error)
      throw error
    }
  }

  /**
   * 批量解决冲突
   * @param {Array} resolutions - 解决方案列表 [{ filepath, strategy, content }]
   * @returns {Promise<Object>}
   */
  async resolveMultiple(resolutions) {
    console.log('[ConflictResolver] 批量解决冲突:', resolutions.length)

    const results = {
      total: resolutions.length,
      succeeded: 0,
      failed: 0,
      errors: []
    }

    for (const resolution of resolutions) {
      try {
        await this.resolveConflict(
          resolution.filepath,
          resolution.strategy,
          resolution.content
        )

        results.succeeded++
      } catch (error) {
        results.failed++
        results.errors.push({
          filepath: resolution.filepath,
          error: error.message
        })
      }
    }

    console.log('[ConflictResolver] 批量解决完成:', results)

    return results
  }

  /**
   * 智能解决所有冲突 (自动选择策略)
   * @param {string} defaultStrategy - 默认策略
   * @returns {Promise<Object>}
   */
  async resolveAllAuto(defaultStrategy = 'ours') {
    console.log('[ConflictResolver] 自动解决所有冲突，策略:', defaultStrategy)

    const resolutions = this.conflicts.map(conflict => ({
      filepath: conflict.filepath,
      strategy: defaultStrategy,
      content: null
    }))

    return await this.resolveMultiple(resolutions)
  }

  /**
   * 完成冲突解决（检查并提交）
   * @param {string} commitMessage - 提交消息
   * @returns {Promise<Object>}
   */
  async complete(commitMessage = 'Resolve merge conflicts') {
    try {
      console.log('[ConflictResolver] 完成冲突解决...')

      // 检查是否还有未解决的冲突
      const unresolvedCount = this.conflicts.filter(c => !c.resolved).length

      if (unresolvedCount > 0) {
        throw new Error(`还有 ${unresolvedCount} 个文件的冲突未解决`)
      }

      // 使用GitManager完成合并
      const result = await this.gitManager.completeMerge(commitMessage)

      console.log('[ConflictResolver] ✅ 冲突解决完成')

      // 清空冲突列表
      this.conflicts = []

      return result
    } catch (error) {
      console.error('[ConflictResolver] 完成冲突解决失败:', error)
      throw error
    }
  }

  /**
   * 取消冲突解决（中止合并）
   * @returns {Promise<boolean>}
   */
  async abort() {
    try {
      console.log('[ConflictResolver] 中止冲突解决...')

      // TODO: isomorphic-git没有直接的abort merge命令
      // 需要实现手动重置到合并前状态

      console.warn('[ConflictResolver] ⚠️ 中止合并功能暂未实现')

      // 清空冲突列表
      this.conflicts = []

      return true
    } catch (error) {
      console.error('[ConflictResolver] 中止失败:', error)
      throw error
    }
  }

  /**
   * 生成冲突摘要
   * @returns {Object}
   */
  getSummary() {
    const total = this.conflicts.length
    const resolved = this.conflicts.filter(c => c.resolved).length
    const unresolved = total - resolved

    const conflictsByType = {}

    for (const conflict of this.conflicts) {
      const ext = conflict.filepath.split('.').pop() || 'unknown'

      if (!conflictsByType[ext]) {
        conflictsByType[ext] = {
          total: 0,
          resolved: 0,
          files: []
        }
      }

      conflictsByType[ext].total++
      if (conflict.resolved) {
        conflictsByType[ext].resolved++
      }

      conflictsByType[ext].files.push(conflict.filepath)
    }

    return {
      total,
      resolved,
      unresolved,
      progress: total > 0 ? (resolved / total * 100).toFixed(2) + '%' : '0%',
      conflictsByType
    }
  }

  /**
   * 重置解决器状态
   */
  reset() {
    this.conflicts = []
    console.log('[ConflictResolver] 状态已重置')
  }

  /**
   * 比较两个版本的差异
   * @param {string} ours - 本地版本
   * @param {string} theirs - 远程版本
   * @returns {Object}
   */
  compareDiff(ours, theirs) {
    const oursLines = ours.split('\n')
    const theirsLines = theirs.split('\n')

    // 简单的行级差异比较
    const diff = {
      added: [],
      removed: [],
      changed: [],
      unchanged: []
    }

    const maxLength = Math.max(oursLines.length, theirsLines.length)

    for (let i = 0; i < maxLength; i++) {
      const ourLine = oursLines[i]
      const theirLine = theirsLines[i]

      if (ourLine === theirLine) {
        // 相同行
        diff.unchanged.push({
          lineNumber: i + 1,
          content: ourLine
        })
      } else if (ourLine && !theirLine) {
        // 仅在本地存在
        diff.removed.push({
          lineNumber: i + 1,
          content: ourLine
        })
      } else if (!ourLine && theirLine) {
        // 仅在远程存在
        diff.added.push({
          lineNumber: i + 1,
          content: theirLine
        })
      } else {
        // 内容不同
        diff.changed.push({
          lineNumber: i + 1,
          ours: ourLine,
          theirs: theirLine
        })
      }
    }

    return diff
  }

  /**
   * 预览解决方案
   * @param {string} filepath - 文件路径
   * @param {string} strategy - 策略
   * @returns {string}
   */
  previewResolution(filepath, strategy) {
    const conflict = this.getConflictDetail(filepath)

    if (!conflict) {
      throw new Error(`冲突文件不存在: ${filepath}`)
    }

    let previewContent = conflict.content

    if (strategy === this.strategies.OURS) {
      // 预览选择本地版本后的内容
      for (const c of conflict.conflicts) {
        const lines = conflict.content.split('\n')
        const original = lines.slice(c.startLine, c.endLine + 1).join('\n')
        previewContent = previewContent.replace(original, c.ours)
      }
    } else if (strategy === this.strategies.THEIRS) {
      // 预览选择远程版本后的内容
      for (const c of conflict.conflicts) {
        const lines = conflict.content.split('\n')
        const original = lines.slice(c.startLine, c.endLine + 1).join('\n')
        previewContent = previewContent.replace(original, c.theirs)
      }
    }

    return previewContent
  }
}

export default ConflictResolver
