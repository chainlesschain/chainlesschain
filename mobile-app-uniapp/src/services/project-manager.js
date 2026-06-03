/**
 * 项目管理服务
 * 提供项目CRUD、文件管理、任务管理、协作管理等功能
 */

import database from './database'
import didService from './did'

class ProjectManager {
  constructor() {
    this.currentProject = null
  }

  /**
   * 创建项目
   * @param {Object} projectData 项目数据
   * @returns {Promise<Object>}
   */
  async createProject(projectData) {
    try {
      const identity = await didService.getCurrentIdentity()

      if (!identity || !identity.did) {
        throw new Error('请先创建DID身份')
      }

      const currentDid = identity.did

      const project = {
        name: projectData.name,
        description: projectData.description || '',
        type: projectData.type || 'general',
        status: 'active',
        owner_did: currentDid,
        cover_image: projectData.coverImage || '',
        settings: JSON.stringify(projectData.settings || {})
      }

      const newProject = await database.createProject(project)

      console.log('[ProjectManager] 项目创建成功:', newProject.id)
      return newProject
    } catch (error) {
      console.error('[ProjectManager] 创建项目失败:', error)
      throw error
    }
  }

  /**
   * 获取项目列表
   * @param {Object} filters 筛选条件
   * @returns {Promise<Array>}
   */
  async getProjects(filters = {}) {
    try {
      const identity = await didService.getCurrentIdentity()

      if (!identity || !identity.did) {
        console.warn('[ProjectManager] 未登录，返回空列表')
        return []
      }

      const currentDid = identity.did

      const options = {
        owner_did: currentDid,
        status: filters.status || 'active',
        type: filters.type,
        sortBy: filters.sortBy || 'updated_at',
        sortOrder: filters.sortOrder || 'DESC',
        limit: filters.limit || 50,
        offset: filters.offset || 0
      }

      const projects = await database.getProjects(options)

      // 同时获取协作项目
      if (filters.includeCollaborating !== false) {
        const collaboratingProjects = await database.getCollaboratingProjects(currentDid)
        // 合并并去重
        const allProjects = [...projects, ...collaboratingProjects]
        const uniqueProjects = Array.from(
          new Map(allProjects.map(p => [p.id, p])).values()
        )
        return uniqueProjects
      }

      return projects
    } catch (error) {
      console.error('[ProjectManager] 获取项目列表失败:', error)
      return []
    }
  }

  /**
   * 获取单个项目
   * @param {string} projectId 项目ID
   * @returns {Promise<Object|null>}
   */
  async getProject(projectId) {
    try {
      const project = await database.getProjectById(projectId)

      if (!project) {
        console.warn('[ProjectManager] 项目不存在:', projectId)
        return null
      }

      // 获取项目的额外信息
      const files = await database.getProjectFiles(projectId)
      const tasks = await database.getProjectTasks(projectId)
      const collaborators = await database.getProjectCollaborators(projectId)

      return {
        ...project,
        fileCount: files.length,
        taskCount: tasks.length,
        collaboratorCount: collaborators.length,
        settings: project.settings ? JSON.parse(project.settings) : {}
      }
    } catch (error) {
      console.error('[ProjectManager] 获取项目失败:', error)
      return null
    }
  }

  /**
   * 更新项目
   * @param {string} projectId 项目ID
   * @param {Object} updates 更新数据
   * @returns {Promise<void>}
   */
  async updateProject(projectId, updates) {
    try {
      // 验证权限
      await this.checkProjectPermission(projectId, 'editor')

      // 处理settings字段
      if (updates.settings && typeof updates.settings === 'object') {
        updates.settings = JSON.stringify(updates.settings)
      }

      await database.updateProject(projectId, updates)
      console.log('[ProjectManager] 项目更新成功:', projectId)
    } catch (error) {
      console.error('[ProjectManager] 更新项目失败:', error)
      throw error
    }
  }

  /**
   * 删除项目
   * @param {string} projectId 项目ID
   * @returns {Promise<void>}
   */
  async deleteProject(projectId) {
    try {
      // 验证权限（只有所有者可以删除）
      await this.checkProjectPermission(projectId, 'owner')

      await database.deleteProject(projectId)
      console.log('[ProjectManager] 项目删除成功:', projectId)
    } catch (error) {
      console.error('[ProjectManager] 删除项目失败:', error)
      throw error
    }
  }

  /**
   * 归档项目
   * @param {string} projectId 项目ID
   * @returns {Promise<void>}
   */
  async archiveProject(projectId) {
    try {
      await this.updateProject(projectId, { status: 'archived' })
      console.log('[ProjectManager] 项目已归档:', projectId)
    } catch (error) {
      console.error('[ProjectManager] 归档项目失败:', error)
      throw error
    }
  }

  // ==================== 文件管理 ====================

  /**
   * 添加文件到项目
   * @param {string} projectId 项目ID
   * @param {Object} fileData 文件数据
   * @returns {Promise<Object>}
   */
  async addFile(projectId, fileData) {
    try {
      // 验证权限
      await this.checkProjectPermission(projectId, 'editor')

      const file = {
        project_id: projectId,
        file_name: fileData.name,
        file_type: fileData.type,
        file_path: fileData.path,
        content: fileData.content,
        file_size: fileData.size || 0
      }

      const newFile = await database.addProjectFile(file)

      // 更新项目时间
      await database.updateProject(projectId, {
        updated_at: Date.now()
      })

      console.log('[ProjectManager] 文件添加成功:', newFile.id)
      return newFile
    } catch (error) {
      console.error('[ProjectManager] 添加文件失败:', error)
      throw error
    }
  }

  /**
   * 获取项目文件列表
   * @param {string} projectId 项目ID
   * @returns {Promise<Array>}
   */
  async getFiles(projectId) {
    try {
      return await database.getProjectFiles(projectId)
    } catch (error) {
      console.error('[ProjectManager] 获取文件列表失败:', error)
      return []
    }
  }

  /**
   * 获取文件内容
   * @param {string} fileId 文件ID
   * @returns {Promise<Object|null>}
   */
  async getFile(fileId) {
    try {
      return await database.getProjectFile(fileId)
    } catch (error) {
      console.error('[ProjectManager] 获取文件失败:', error)
      return null
    }
  }

  /**
   * 更新文件
   * @param {string} fileId 文件ID
   * @param {Object} updates 更新数据
   * @returns {Promise<void>}
   */
  async updateFile(fileId, updates) {
    try {
      const file = await database.getProjectFile(fileId)
      if (!file) {
        throw new Error('文件不存在')
      }

      // 验证权限
      await this.checkProjectPermission(file.project_id, 'editor')

      await database.updateProjectFile(fileId, updates)

      // 更新项目时间
      await database.updateProject(file.project_id, {
        updated_at: Date.now()
      })

      console.log('[ProjectManager] 文件更新成功:', fileId)
    } catch (error) {
      console.error('[ProjectManager] 更新文件失败:', error)
      throw error
    }
  }

  /**
   * 删除文件
   * @param {string} fileId 文件ID
   * @returns {Promise<void>}
   */
  async deleteFile(fileId) {
    try {
      const file = await database.getProjectFile(fileId)
      if (!file) {
        throw new Error('文件不存在')
      }

      // 验证权限
      await this.checkProjectPermission(file.project_id, 'editor')

      await database.deleteProjectFile(fileId)
      console.log('[ProjectManager] 文件删除成功:', fileId)
    } catch (error) {
      console.error('[ProjectManager] 删除文件失败:', error)
      throw error
    }
  }

  // ==================== 任务管理 ====================

  /**
   * 创建任务
   * @param {string} projectId 项目ID
   * @param {Object} taskData 任务数据
   * @returns {Promise<Object>}
   */
  async createTask(projectId, taskData) {
    try {
      // 验证权限
      await this.checkProjectPermission(projectId, 'editor')

      const task = {
        project_id: projectId,
        title: taskData.title,
        description: taskData.description || '',
        status: 'todo',
        priority: taskData.priority || 'medium',
        assignee_did: taskData.assigneeDid || null,
        due_date: taskData.dueDate || null
      }

      const newTask = await database.createProjectTask(task)
      console.log('[ProjectManager] 任务创建成功:', newTask.id)
      return newTask
    } catch (error) {
      console.error('[ProjectManager] 创建任务失败:', error)
      throw error
    }
  }

  /**
   * 获取项目任务列表
   * @param {string} projectId 项目ID
   * @param {Object} options 查询选项
   * @returns {Promise<Array>}
   */
  async getTasks(projectId, options = {}) {
    try {
      return await database.getProjectTasks(projectId, options)
    } catch (error) {
      console.error('[ProjectManager] 获取任务列表失败:', error)
      return []
    }
  }

  /**
   * 更新任务状态
   * @param {string} taskId 任务ID
   * @param {string} status 新状态
   * @returns {Promise<void>}
   */
  async updateTaskStatus(taskId, status) {
    try {
      const updates = {
        status: status,
        completed_at: status === 'done' ? Date.now() : null
      }

      await database.updateProjectTask(taskId, updates)
      console.log('[ProjectManager] 任务状态更新成功:', taskId, status)
    } catch (error) {
      console.error('[ProjectManager] 更新任务状态失败:', error)
      throw error
    }
  }

  /**
   * 更新任务
   * @param {string} taskId 任务ID
   * @param {Object} updates 更新数据
   * @returns {Promise<void>}
   */
  async updateTask(taskId, updates) {
    try {
      await database.updateProjectTask(taskId, updates)
      console.log('[ProjectManager] 任务更新成功:', taskId)
    } catch (error) {
      console.error('[ProjectManager] 更新任务失败:', error)
      throw error
    }
  }

  /**
   * 删除任务
   * @param {string} taskId 任务ID
   * @returns {Promise<void>}
   */
  async deleteTask(taskId) {
    try {
      await database.deleteProjectTask(taskId)
      console.log('[ProjectManager] 任务删除成功:', taskId)
    } catch (error) {
      console.error('[ProjectManager] 删除任务失败:', error)
      throw error
    }
  }

  // ==================== 协作管理 ====================

  /**
   * 邀请协作者
   * @param {string} projectId 项目ID
   * @param {string} collaboratorDid 协作者DID
   * @param {string} role 角色
   * @returns {Promise<Object>}
   */
  async inviteCollaborator(projectId, collaboratorDid, role = 'viewer') {
    try {
      // 验证权限（只有所有者和编辑者可以邀请）
      const identity = await didService.getCurrentIdentity()
      const currentDid = identity ? identity.did : null
      const project = await database.getProjectById(projectId)

      if (project.owner_did !== currentDid) {
        const collaboration = await database.getCollaboration(projectId, currentDid)
        if (!collaboration || collaboration.role === 'viewer') {
          throw new Error('无权限邀请协作者')
        }
      }

      // 创建邀请
      const invitation = {
        project_id: projectId,
        collaborator_did: collaboratorDid,
        role: role,
        accepted_at: null
      }

      const collab = await database.createCollaboration(invitation)

      // TODO: 通过WebSocket发送邀请通知

      console.log('[ProjectManager] 协作者邀请成功:', collaboratorDid)
      return collab
    } catch (error) {
      console.error('[ProjectManager] 邀请协作者失败:', error)
      throw error
    }
  }

  /**
   * 接受协作邀请
   * @param {string} projectId 项目ID
   * @returns {Promise<void>}
   */
  async acceptInvitation(projectId) {
    try {
      const identity = await didService.getCurrentIdentity()
      const currentDid = identity ? identity.did : null

      if (!currentDid) {
        throw new Error('未登录')
      }

      await database.updateCollaboration(projectId, currentDid, {
        accepted_at: Date.now()
      })

      console.log('[ProjectManager] 协作邀请已接受:', projectId)
    } catch (error) {
      console.error('[ProjectManager] 接受邀请失败:', error)
      throw error
    }
  }

  /**
   * 获取协作项目列表
   * @returns {Promise<Array>}
   */
  async getCollaboratingProjects() {
    try {
      const identity = await didService.getCurrentIdentity()
      const currentDid = identity ? identity.did : null

      if (!currentDid) {
        return []
      }

      return await database.getCollaboratingProjects(currentDid)
    } catch (error) {
      console.error('[ProjectManager] 获取协作项目失败:', error)
      return []
    }
  }

  /**
   * 获取项目协作者列表
   * @param {string} projectId 项目ID
   * @returns {Promise<Array>}
   */
  async getCollaborators(projectId) {
    try {
      return await database.getProjectCollaborators(projectId)
    } catch (error) {
      console.error('[ProjectManager] 获取协作者失败:', error)
      return []
    }
  }

  // ==================== 权限检查 ====================

  /**
   * 检查用户对项目的权限
   * @param {string} projectId 项目ID
   * @param {string} requiredRole 需要的角色 (owner, editor, viewer)
   * @returns {Promise<boolean>}
   */
  async checkProjectPermission(projectId, requiredRole = 'viewer') {
    try {
      const identity = await didService.getCurrentIdentity()
      const currentDid = identity ? identity.did : null

      if (!currentDid) {
        throw new Error('未登录')
      }

      const project = await database.getProjectById(projectId)
      if (!project) {
        throw new Error('项目不存在')
      }

      // 所有者拥有所有权限
      if (project.owner_did === currentDid) {
        return true
      }

      // 检查协作权限
      const collaboration = await database.getCollaboration(projectId, currentDid)
      if (!collaboration || !collaboration.accepted_at) {
        throw new Error('无访问权限')
      }

      // 角色权限检查
      const roleHierarchy = { owner: 3, editor: 2, viewer: 1 }
      const userRoleLevel = roleHierarchy[collaboration.role] || 0
      const requiredRoleLevel = roleHierarchy[requiredRole] || 0

      if (userRoleLevel < requiredRoleLevel) {
        throw new Error(`需要 ${requiredRole} 权限`)
      }

      return true
    } catch (error) {
      console.error('[ProjectManager] 权限检查失败:', error)
      throw error
    }
  }

  // ==================== 项目统计 ====================

  /**
   * 获取项目统计信息
   * @param {string} projectId 项目ID
   * @returns {Promise<Object>}
   */
  async getProjectStatistics(projectId) {
    try {
      const files = await database.getProjectFiles(projectId)
      const tasks = await database.getProjectTasks(projectId)
      const collaborators = await database.getProjectCollaborators(projectId)

      const tasksByStatus = {
        todo: tasks.filter(t => t.status === 'todo').length,
        in_progress: tasks.filter(t => t.status === 'in_progress').length,
        done: tasks.filter(t => t.status === 'done').length
      }

      const totalFileSize = files.reduce((sum, f) => sum + (f.file_size || 0), 0)

      return {
        fileCount: files.length,
        taskCount: tasks.length,
        tasksByStatus,
        collaboratorCount: collaborators.length,
        totalFileSize,
        completionRate: tasks.length > 0
          ? Math.round((tasksByStatus.done / tasks.length) * 100)
          : 0
      }
    } catch (error) {
      console.error('[ProjectManager] 获取统计信息失败:', error)
      return {
        fileCount: 0,
        taskCount: 0,
        tasksByStatus: { todo: 0, in_progress: 0, done: 0 },
        collaboratorCount: 0,
        totalFileSize: 0,
        completionRate: 0
      }
    }
  }
}

// 导出单例
export default new ProjectManager()
