<template>
  <view class="project-detail-page">
    <!-- 导航栏 -->
    <view class="nav-bar">
      <view class="nav-left" @click="goBack">
        <text class="nav-icon">←</text>
        <text class="nav-text">返回</text>
      </view>
      <text class="nav-title">项目详情</text>
      <view class="nav-right" @click="showMoreMenu">
        <text class="nav-icon">&#8943;</text>
      </view>
    </view>

    <!-- 加载中 -->
    <view v-if="isLoading" class="loading-container">
      <view class="loading-spinner"></view>
      <text class="loading-text">加载中...</text>
    </view>

    <!-- 项目内容 -->
    <view v-else-if="project" class="project-content">
      <!-- 项目信息卡片 -->
      <view class="project-header-card">
        <view class="project-cover">
          <image
            v-if="project.cover_image"
            :src="project.cover_image"
            mode="aspectFill"
            class="cover-image"
          />
          <view v-else class="cover-placeholder">
            <text class="cover-icon">{{ getProjectIcon(project.type) }}</text>
          </view>
        </view>

        <view class="project-info">
          <view class="info-row">
            <text class="project-name">{{ project.name }}</text>
            <view :class="['project-type', `type-${project.type}`]">
              {{ getProjectTypeLabel(project.type) }}
            </view>
          </view>

          <text v-if="project.description" class="project-desc">
            {{ project.description }}
          </text>

          <!-- 统计信息 -->
          <view class="stats-row">
            <view class="stat-item">
              <text class="stat-icon">📄</text>
              <text class="stat-text">{{ project.fileCount || 0 }} 文件</text>
            </view>
            <view class="stat-item">
              <text class="stat-icon">✓</text>
              <text class="stat-text">{{ project.taskCount || 0 }} 任务</text>
            </view>
            <view class="stat-item">
              <text class="stat-icon">👥</text>
              <text class="stat-text">{{ project.collaboratorCount || 0 }} 协作</text>
            </view>
          </view>

          <!-- 完成进度 -->
          <view v-if="project.completionRate !== undefined" class="progress-section">
            <view class="progress-header">
              <text class="progress-label">完成进度</text>
              <text class="progress-percent">{{ project.completionRate }}%</text>
            </view>
            <view class="progress-bar">
              <view
                class="progress-fill"
                :style="{ width: project.completionRate + '%' }"
              ></view>
            </view>
          </view>
        </view>
      </view>

      <!-- Tab导航 -->
      <view class="tab-navigation">
        <view
          v-for="tab in tabs"
          :key="tab.value"
          :class="['tab-item', { active: currentTab === tab.value }]"
          @click="switchTab(tab.value)"
        >
          <text class="tab-icon">{{ tab.icon }}</text>
          <text class="tab-label">{{ tab.label }}</text>
        </view>
      </view>

      <!-- Tab内容 -->
      <view class="tab-content">
        <!-- 文件Tab -->
        <view v-if="currentTab === 'files'" class="files-tab">
          <!-- 文件列表 -->
          <view v-if="fileTree.length > 0" class="file-tree-container">
            <scroll-view scroll-y class="file-tree-scroll">
              <view
                v-for="node in visibleFileNodes"
                :key="node.key"
                class="file-tree-node"
                :class="['node-' + node.type]"
                :style="{ paddingLeft: (node.level * 18 + 12) + 'px' }"
              >
                <view class="tree-node-content" @click="handleTreeNodeTap(node)">
                  <text
                    v-if="node.type === 'folder'"
                    class="tree-toggle"
                    @click.stop="toggleFolderState(node.key)"
                  >
                    {{ isFolderExpandedKey(node.key) ? '▾' : '▸' }}
                  </text>
                  <text v-else class="tree-toggle placeholder"> </text>
                  <text class="tree-icon">
                    {{ node.type === 'folder' ? '📂' : getFileIcon(node.file?.file_type) }}
                  </text>
                  <view class="tree-info">
                    <text class="tree-name">{{ node.name }}</text>
                    <view v-if="node.type === 'file'" class="tree-meta">
                      <text>{{ formatFileSize(node.file?.file_size) }}</text>
                      <text>{{ formatTime(node.file?.created_at) }}</text>
                    </view>
                  </view>
                </view>
                <view
                  v-if="node.type === 'file'"
                  class="tree-actions"
                  @click.stop="showFileMenu(node.file)"
                >
                  <text class="action-icon">&#8943;</text>
                </view>
              </view>
            </scroll-view>
          </view>

          <!-- 空状态 -->
          <view v-else class="empty-state">
            <view class="empty-icon">📄</view>
            <text class="empty-title">暂无文件</text>
            <text class="empty-subtitle">点击下方按钮添加文件</text>
          </view>

          <!-- 上传按钮 -->
          <view class="upload-button" @click="uploadFile">
            <text class="upload-icon">➕</text>
            <text class="upload-text">添加文件</text>
          </view>
        </view>

        <!-- 任务Tab -->
        <view v-if="currentTab === 'tasks'" class="tasks-tab">
          <!-- 任务看板 -->
          <view class="task-board">
            <!-- Todo列 -->
            <view class="task-column">
              <view class="column-header">
                <text class="column-title">待办</text>
                <view class="column-badge">{{ tasksByStatus.todo.length }}</view>
              </view>
              <view class="task-list">
                <view
                  v-for="task in tasksByStatus.todo"
                  :key="task.id"
                  class="task-card"
                  @click="viewTask(task)"
                >
                  <text class="task-title">{{ task.title }}</text>
                  <text v-if="task.description" class="task-desc">{{ task.description }}</text>
                  <view class="task-footer">
                    <view :class="['task-priority', `priority-${task.priority}`]">
                      {{ getPriorityLabel(task.priority) }}
                    </view>
                    <text v-if="task.due_date" class="task-due">
                      {{ formatDate(task.due_date) }}
                    </text>
                  </view>
                </view>
              </view>
            </view>

            <!-- In Progress列 -->
            <view class="task-column">
              <view class="column-header">
                <text class="column-title">进行中</text>
                <view class="column-badge">{{ tasksByStatus.in_progress.length }}</view>
              </view>
              <view class="task-list">
                <view
                  v-for="task in tasksByStatus.in_progress"
                  :key="task.id"
                  class="task-card"
                  @click="viewTask(task)"
                >
                  <text class="task-title">{{ task.title }}</text>
                  <text v-if="task.description" class="task-desc">{{ task.description }}</text>
                  <view class="task-footer">
                    <view :class="['task-priority', `priority-${task.priority}`]">
                      {{ getPriorityLabel(task.priority) }}
                    </view>
                    <text v-if="task.due_date" class="task-due">
                      {{ formatDate(task.due_date) }}
                    </text>
                  </view>
                </view>
              </view>
            </view>

            <!-- Done列 -->
            <view class="task-column">
              <view class="column-header">
                <text class="column-title">已完成</text>
                <view class="column-badge">{{ tasksByStatus.done.length }}</view>
              </view>
              <view class="task-list">
                <view
                  v-for="task in tasksByStatus.done"
                  :key="task.id"
                  class="task-card done"
                  @click="viewTask(task)"
                >
                  <text class="task-title">{{ task.title }}</text>
                  <text v-if="task.description" class="task-desc">{{ task.description }}</text>
                  <view class="task-footer">
                    <text class="task-completed">
                      ✓ {{ formatTime(task.completed_at) }}
                    </text>
                  </view>
                </view>
              </view>
            </view>
          </view>

          <!-- 创建任务按钮 -->
          <view class="create-task-button" @click="showCreateTaskDialog">
            <text class="create-icon">➕</text>
            <text class="create-text">创建任务</text>
          </view>
        </view>

        <!-- 设置Tab -->
        <view v-if="currentTab === 'settings'" class="settings-tab">
          <!-- 基本信息 -->
          <view class="settings-section">
            <text class="section-title">基本信息</text>
            <view class="setting-item" @click="editProjectInfo">
              <view class="setting-label">
                <text class="label-icon">📝</text>
                <text class="label-text">编辑项目信息</text>
              </view>
              <text class="setting-arrow">›</text>
            </view>
          </view>

          <!-- 协作 -->
          <view class="settings-section">
            <text class="section-title">协作管理</text>
            <view class="setting-item" @click="openCollaboratorDialog">
              <view class="setting-label">
                <text class="label-icon">👥</text>
                <text class="label-text">协作者</text>
              </view>
              <view class="setting-value">
                <text>{{ collaborators.length }} 人</text>
                <text class="setting-arrow">›</text>
              </view>
            </view>
            <view class="setting-item" @click="openCollaboratorDialog(true)">
              <view class="setting-label">
                <text class="label-icon">➕</text>
                <text class="label-text">邀请协作者</text>
              </view>
              <text class="setting-arrow">›</text>
            </view>
          </view>

          <!-- 高级设置 -->
          <view class="settings-section">
            <text class="section-title">高级设置</text>
            <view class="setting-item">
              <view class="setting-label">
                <text class="label-icon">🤖</text>
                <text class="label-text">AI助手</text>
              </view>
              <switch
                :checked="projectSettings.enableAI"
                @change="toggleSetting('enableAI', $event)"
              />
            </view>
            <view class="setting-item">
              <view class="setting-label">
                <text class="label-icon">🔍</text>
                <text class="label-text">智能检索(RAG)</text>
              </view>
              <switch
                :checked="projectSettings.enableRAG"
                @change="toggleSetting('enableRAG', $event)"
              />
            </view>
            <view class="setting-item">
              <view class="setting-label">
                <text class="label-icon">💾</text>
                <text class="label-text">自动备份</text>
              </view>
              <switch
                :checked="projectSettings.autoBackup"
                @change="toggleSetting('autoBackup', $event)"
              />
            </view>
          </view>

          <!-- 危险操作 -->
          <view class="settings-section">
            <text class="section-title">危险操作</text>
            <view class="setting-item danger" @click="archiveProject">
              <view class="setting-label">
                <text class="label-icon">📦</text>
                <text class="label-text">归档项目</text>
              </view>
              <text class="setting-arrow">›</text>
            </view>
            <view class="setting-item danger" @click="deleteProject">
              <view class="setting-label">
                <text class="label-icon">🗑️</text>
                <text class="label-text">删除项目</text>
              </view>
              <text class="setting-arrow">›</text>
            </view>
          </view>
        </view>
      </view>
    </view>

    <!-- 错误状态 -->
    <view v-else class="error-state">
      <view class="error-icon">⚠️</view>
      <text class="error-title">加载失败</text>
      <text class="error-subtitle">项目不存在或无访问权限</text>
      <view class="error-button" @click="goBack">
        <text>返回</text>
      </view>
    </view>

    <!-- 更多菜单弹窗 -->
    <view v-if="showMorePopup" class="popup-overlay" @click="showMorePopup = false">
      <view class="popup-menu" @click.stop>
        <view class="menu-item" @click="shareProject">
          <text class="menu-icon">📤</text>
          <text class="menu-text">分享项目</text>
        </view>
        <view class="menu-item" @click="exportProject">
          <text class="menu-icon">📥</text>
          <text class="menu-text">导出项目</text>
        </view>
        <view class="menu-item" @click="archiveProject">
          <text class="menu-icon">📦</text>
          <text class="menu-text">归档</text>
        </view>
      </view>
    </view>

    <!-- 创建任务弹窗 -->
    <view v-if="showTaskDialog" class="popup-overlay" @click="showTaskDialog = false">
      <view class="task-dialog" @click.stop>
        <view class="dialog-header">
          <text class="dialog-title">创建任务</text>
          <text class="dialog-close" @click="showTaskDialog = false">✕</text>
        </view>

        <view class="dialog-body">
          <view class="form-group">
            <text class="form-label">任务标题</text>
            <input
              v-model="newTask.title"
              class="form-input"
              placeholder="请输入任务标题"
              maxlength="100"
            />
          </view>

          <view class="form-group">
            <text class="form-label">任务描述</text>
            <textarea
              v-model="newTask.description"
              class="form-textarea"
              placeholder="请输入任务描述（可选）"
              maxlength="500"
            />
          </view>

          <view class="form-group">
            <text class="form-label">优先级</text>
            <view class="priority-selector">
              <view
                v-for="priority in priorities"
                :key="priority.value"
                :class="['priority-option', { active: newTask.priority === priority.value }]"
                @click="newTask.priority = priority.value"
              >
                <text>{{ priority.label }}</text>
              </view>
            </view>
          </view>

          <view class="form-group">
            <text class="form-label">截止日期（可选）</text>
            <view class="date-picker" @click="selectDueDate">
              <text v-if="newTask.dueDate">{{ formatDate(newTask.dueDate) }}</text>
              <text v-else class="date-placeholder">选择日期</text>
            </view>
          </view>
        </view>

        <view class="dialog-footer">
          <view class="dialog-button cancel" @click="showTaskDialog = false">
            <text>取消</text>
          </view>
          <view class="dialog-button confirm" @click="createTask">
            <text>创建</text>
          </view>
        </view>
      </view>
    </view>

    <!-- 任务详情弹窗 -->
    <view v-if="showTaskDetailDialog" class="popup-overlay" @click="showTaskDetailDialog = false">
      <view class="task-detail-dialog" @click.stop>
        <view class="dialog-header">
          <text class="dialog-title">任务详情</text>
          <text class="dialog-close" @click="showTaskDetailDialog = false">✕</text>
        </view>

        <view class="dialog-body">
          <text class="task-detail-title">{{ selectedTask.title }}</text>

          <view v-if="selectedTask.description" class="task-detail-desc">
            {{ selectedTask.description }}
          </view>

          <view class="task-detail-info">
            <view class="info-item">
              <text class="info-label">优先级</text>
              <view :class="['task-priority', `priority-${selectedTask.priority}`]">
                {{ getPriorityLabel(selectedTask.priority) }}
              </view>
            </view>

            <view v-if="selectedTask.due_date" class="info-item">
              <text class="info-label">截止日期</text>
              <text class="info-value">{{ formatDate(selectedTask.due_date) }}</text>
            </view>

            <view class="info-item">
              <text class="info-label">状态</text>
              <text class="info-value">{{ getStatusLabel(selectedTask.status) }}</text>
            </view>

            <view v-if="selectedTask.completed_at" class="info-item">
              <text class="info-label">完成时间</text>
              <text class="info-value">{{ formatTime(selectedTask.completed_at) }}</text>
            </view>
          </view>

          <!-- 状态切换按钮 -->
          <view class="status-actions">
            <view
              v-if="selectedTask.status === 'todo'"
              class="status-button primary"
              @click="updateTaskStatus(selectedTask.id, 'in_progress')"
            >
              <text>开始任务</text>
            </view>
            <view
              v-if="selectedTask.status === 'in_progress'"
              class="status-button success"
              @click="updateTaskStatus(selectedTask.id, 'done')"
            >
              <text>完成任务</text>
            </view>
            <view
              v-if="selectedTask.status === 'done'"
              class="status-button"
              @click="updateTaskStatus(selectedTask.id, 'todo')"
            >
              <text>重新打开</text>
            </view>
          </view>
        </view>

        <view class="dialog-footer">
          <view class="dialog-button danger" @click="deleteTask(selectedTask.id)">
            <text>删除任务</text>
          </view>
        </view>
      </view>
    </view>

    <!-- 协作者管理 -->
    <view v-if="showCollaboratorDialog" class="popup-overlay" @click="closeCollaboratorDialog">
      <view class="collaborator-dialog" @click.stop>
        <view class="dialog-header">
          <text class="dialog-title">协作成员</text>
          <text class="dialog-close" @click="closeCollaboratorDialog">×</text>
        </view>

        <view class="collaborator-body">
          <scroll-view scroll-y class="collaborator-list">
            <view
              v-for="collaborator in collaborators"
              :key="collaborator.collaborator_did"
              class="collaborator-item"
            >
              <view class="collaborator-info">
                <text class="collaborator-id">{{ collaborator.collaborator_did }}</text>
                <view class="collaborator-role">{{ getRoleLabel(collaborator.role) }}</view>
              </view>
              <view class="collaborator-meta">
                <text class="collaborator-status">
                  {{ collaborator.accepted_at ? '已接受' : '待接受' }}
                </text>
                <text class="collaborator-time" v-if="collaborator.invited_at">
                  {{ formatTime(collaborator.invited_at) }}
                </text>
              </view>
            </view>
            <view v-if="!collaborators.length" class="collaborator-empty">
              <text class="empty-title">暂无协作者</text>
              <text class="empty-subtitle">邀请 DID 好友加入项目协同</text>
            </view>
          </scroll-view>

          <view class="invite-form">
            <text class="form-label">邀请 DID</text>
            <input
              ref="inviteInput"
              v-model="inviteForm.did"
              class="form-input"
              placeholder="did:example:123..."
              maxlength="200"
            />

            <text class="form-label">角色</text>
            <view class="role-selector">
              <view
                v-for="role in roles"
                :key="role.value"
                :class="['role-option', { active: inviteForm.role === role.value }]"
                @click="inviteForm.role = role.value"
              >
                {{ role.label }}
              </view>
            </view>

            <view class="dialog-button confirm" @click="submitInvitation">
              发送邀请
            </view>
          </view>
        </view>
      </view>
    </view>

    <!-- 文件预览 -->
    <view v-if="filePreviewVisible" class="popup-overlay" @click="closeFilePreview">
      <view class="file-preview-dialog" @click.stop>
        <view class="dialog-header">
          <text class="dialog-title">{{ previewFileData?.name || '文件预览' }}</text>
          <text class="dialog-close" @click="closeFilePreview">×</text>
        </view>

        <view class="preview-meta" v-if="previewFileData">
          <text>{{ previewFileData.type || 'text/plain' }}</text>
          <text>{{ formatFileSize(previewFileData.size) }}</text>
        </view>

        <view class="preview-loading" v-if="previewLoading">
          <view class="loading-spinner small"></view>
          <text class="loading-text">正在加载内容...</text>
        </view>
        <scroll-view v-else class="preview-content" scroll-y>
          <text v-if="previewFileData?.isText" class="preview-text">
            {{ previewFileData?.content || '暂无内容' }}
          </text>
          <image
            v-else-if="previewFileData?.isImage"
            :src="previewFileData?.content"
            mode="widthFix"
            class="preview-image"
          />
          <view v-else class="preview-placeholder">
            <text>暂不支持在线预览该文件类型，请下载后查看。</text>
          </view>
        </scroll-view>

        <view class="dialog-footer">
          <view
            v-if="previewFileData?.isText && previewFileData?.content"
            class="dialog-button secondary"
            @click="copyPreviewContent"
          >
            复制内容
          </view>
          <view class="dialog-button confirm" @click="downloadPreviewFile">
            下载文件
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import projectManager from '@/services/project-manager'
import database from '@/services/database'

export default {
  data() {
    return {
      projectId: '',
      project: null,
      isLoading: true,
      currentTab: 'files',
      tabs: [
        { value: 'files', label: '文件', icon: '📄' },
        { value: 'tasks', label: '任务', icon: '✓' },
        { value: 'settings', label: '设置', icon: '⚙️' }
      ],

      // 文件相关
      files: [],
      fileTree: [],
      expandedFolders: {},

      // 任务相关
      tasks: [],
      tasksByStatus: {
        todo: [],
        in_progress: [],
        done: []
      },

      // 弹窗状态
      showMorePopup: false,
      showTaskDialog: false,
      showTaskDetailDialog: false,

      // 新任务表单
      newTask: {
        title: '',
        description: '',
        priority: 'medium',
        dueDate: null
      },

      // 选中的任务
      selectedTask: {},

      // 优先级选项
      priorities: [
        { value: 'low', label: '低' },
        { value: 'medium', label: '中' },
        { value: 'high', label: '高' }
      ],

      // 项目设置
      projectSettings: {
        enableAI: false,
        enableRAG: false,
        autoBackup: true
      },

      // 协作
      collaborators: [],
      showCollaboratorDialog: false,
      inviteForm: {
        did: '',
        role: 'viewer'
      },
      roles: [
        { value: 'viewer', label: '只读' },
        { value: 'editor', label: '可编辑' }
      ],

      // 文件预览
      filePreviewVisible: false,
      previewLoading: false,
      previewFileData: null
    }
  },

  computed: {
    visibleFileNodes() {
      const nodes = []
      const traverse = (list, level) => {
        if (!Array.isArray(list)) return
        list.forEach(node => {
          nodes.push({
            ...node,
            level,
            expanded: node.type === 'folder' ? this.isFolderExpandedKey(node.key) : false
          })
          if (node.type === 'folder' && this.isFolderExpandedKey(node.key) && node.children?.length) {
            traverse(node.children, level + 1)
          }
        })
      }
      traverse(this.fileTree, 0)
      return nodes
    }
  },

  onLoad(options) {
    if (options.id) {
      this.projectId = options.id
      this.loadProjectData()
    } else {
      this.isLoading = false
    }
  },

  methods: {
    async loadProjectData() {
      try {
        this.isLoading = true

        // 加载项目信息
        const project = await projectManager.getProject(this.projectId)

        if (!project) {
          this.project = null
          this.isLoading = false
          return
        }

        this.project = project

        // 解析设置
        if (project.settings && typeof project.settings === 'object') {
          this.projectSettings = {
            ...this.projectSettings,
            ...project.settings
          }
        }

        // 加载文件列表
        await this.loadFiles()

        // 加载任务列表
        await this.loadTasks()

        // 加载协作者
        await this.loadCollaborators()

      } catch (error) {
        console.error('[ProjectDetail] 加载项目失败:', error)
        uni.showToast({
          title: '加载失败',
          icon: 'none'
        })
      } finally {
        this.isLoading = false
      }
    },

    async loadFiles() {
      try {
        this.files = await projectManager.getFiles(this.projectId)
        this.buildFileTree()
      } catch (error) {
        console.error('[ProjectDetail] 加载文件失败:', error)
      }
    },

    async loadTasks() {
      try {
        this.tasks = await projectManager.getTasks(this.projectId)

        // 按状态分组
        this.tasksByStatus = {
          todo: this.tasks.filter(t => t.status === 'todo'),
          in_progress: this.tasks.filter(t => t.status === 'in_progress'),
          done: this.tasks.filter(t => t.status === 'done')
        }
      } catch (error) {
        console.error('[ProjectDetail] 加载任务失败:', error)
      }
    },

    buildFileTree() {
      const root = []
      const folderMap = new Map()
      folderMap.set('', root)

      this.files.forEach(file => {
        const rawPath = (file.file_path && file.file_path.trim()) ? file.file_path : file.file_name || ''
        const segments = this.getPathSegments(rawPath)
        const fileName = segments.length > 0 ? segments.pop() : (file.file_name || '未命名文件')
        let currentPath = ''
        let parentChildren = root

        segments.forEach(segment => {
          currentPath = currentPath ? `${currentPath}/${segment}` : segment
          let folderNode = folderMap.get(currentPath)
          if (!folderNode) {
            folderNode = {
              key: `dir-${currentPath}`,
              name: segment,
              type: 'folder',
              path: currentPath,
              children: []
            }
            folderMap.set(currentPath, folderNode)
            parentChildren.push(folderNode)
          }
          parentChildren = folderNode.children
        })

        parentChildren.push({
          key: file.id,
          name: fileName,
          type: 'file',
          path: rawPath,
          file
        })
      })

      this.sortTreeNodes(root)
      this.fileTree = root

      if (!Object.keys(this.expandedFolders).length) {
        root.forEach(node => {
          if (node.type === 'folder') {
            this.$set(this.expandedFolders, node.key, true)
          }
        })
      }
    },

    sortTreeNodes(nodes) {
      nodes.sort((a, b) => {
        if (a.type === b.type) {
          return a.name.localeCompare(b.name)
        }
        return a.type === 'folder' ? -1 : 1
      })
      nodes.forEach(node => {
        if (node.type === 'folder' && node.children) {
          this.sortTreeNodes(node.children)
        }
      })
    },

    getPathSegments(path = '') {
      if (!path) return []
      return path.split(/[\\/]/).filter(Boolean)
    },

    handleTreeNodeTap(node) {
      if (node.type === 'folder') {
        this.toggleFolderState(node.key)
      } else if (node.file) {
        this.previewFile(node.file)
      }
    },

    toggleFolderState(key) {
      const current = !!this.expandedFolders[key]
      this.$set(this.expandedFolders, key, !current)
    },

    isFolderExpandedKey(key) {
      return !!this.expandedFolders[key]
    },

    async loadCollaborators() {
      try {
        const list = await projectManager.getCollaborators(this.projectId)
        this.collaborators = Array.isArray(list) ? list : []
        if (this.project) {
          this.project.collaboratorCount = this.collaborators.length
        }
      } catch (error) {
        console.error('[ProjectDetail] 加载协作者失败:', error)
      }
    },

    switchTab(tab) {
      this.currentTab = tab
    },

    goBack() {
      uni.navigateBack()
    },

    showMoreMenu() {
      this.showMorePopup = true
    },

    // ==================== 文件操作 ====================

    uploadFile() {
      // #ifdef H5
      // H5环境使用input file
      const input = document.createElement('input')
      input.type = 'file'
      input.onchange = async (e) => {
        const file = e.target.files[0]
        if (!file) return

        const reader = new FileReader()
        reader.onload = async (event) => {
          try {
            const content = event.target.result

            await projectManager.addFile(this.projectId, {
              name: file.name,
              type: file.type,
              path: '',
              content: content,
              size: file.size
            })

            uni.showToast({
              title: '上传成功',
              icon: 'success'
            })

            await this.loadFiles()
          } catch (error) {
            console.error('[ProjectDetail] 上传文件失败:', error)
            uni.showToast({
              title: '上传失败',
              icon: 'none'
            })
          }
        }
        reader.readAsText(file)
      }
      input.click()
      // #endif

      // #ifndef H5
      // App环境使用uni.chooseFile
      uni.chooseFile({
        count: 1,
        success: async (res) => {
          const file = res.tempFiles[0]

          try {
            await projectManager.addFile(this.projectId, {
              name: file.name,
              type: file.type,
              path: file.path,
              content: '', // App环境暂不读取内容
              size: file.size
            })

            uni.showToast({
              title: '上传成功',
              icon: 'success'
            })

            await this.loadFiles()
          } catch (error) {
            console.error('[ProjectDetail] 上传文件失败:', error)
            uni.showToast({
              title: '上传失败',
              icon: 'none'
            })
          }
        }
      })
      // #endif
    },

    async previewFile(file) {
      if (!file || !file.id) return

      this.filePreviewVisible = true
      this.previewLoading = true
      this.previewFileData = {
        name: file.file_name,
        type: file.file_type,
        size: file.file_size,
        content: '',
        isText: this.isTextFile(file.file_type, file.file_name),
        isImage: this.isImageFile(file.file_type, file.file_name)
      }

      try {
        const record = await projectManager.getFile(file.id)
        const type = record?.file_type || file.file_type || 'text/plain'
        const size = record?.file_size || file.file_size || 0
        const content = record?.content || ''

        this.previewFileData = {
          name: file.file_name,
          type,
          size,
          content,
          isText: this.isTextFile(type, file.file_name),
          isImage: this.isImageFile(type, file.file_name),
          raw: record
        }
      } catch (error) {
        console.error('[ProjectDetail] 预览文件失败:', error)
        uni.showToast({
          title: '预览失败',
          icon: 'none'
        })
        this.filePreviewVisible = false
      } finally {
        this.previewLoading = false
      }
    },

    showFileMenu(file) {
      uni.showActionSheet({
        itemList: ['预览', '下载', '删除'],
        success: async (res) => {
          if (res.tapIndex === 0) {
            this.previewFile(file)
          } else if (res.tapIndex === 1) {
            this.downloadFile(file)
          } else if (res.tapIndex === 2) {
            this.confirmDeleteFile(file)
          }
        }
      })
    },

    async downloadFile(file) {
      if (!file || !file.id) return

      try {
        const record = await projectManager.getFile(file.id)

        if (!record || !record.content) {
          uni.showToast({
            title: '暂无可下载内容',
            icon: 'none'
          })
          return
        }

        this.downloadContent(
          file.file_name || 'project-file.txt',
          record.content,
          record.file_type || 'text/plain'
        )
      } catch (error) {
        console.error('[ProjectDetail] 下载文件失败:', error)
        uni.showToast({
          title: '下载失败',
          icon: 'none'
        })
      }
    },

    confirmDeleteFile(file) {
      uni.showModal({
        title: '确认删除',
        content: `确定要删除文件"${file.file_name}"吗？`,
        success: async (res) => {
          if (res.confirm) {
            try {
              await projectManager.deleteFile(file.id)

              uni.showToast({
                title: '删除成功',
                icon: 'success'
              })

              await this.loadFiles()
            } catch (error) {
              console.error('[ProjectDetail] 删除文件失败:', error)
              uni.showToast({
                title: '删除失败',
                icon: 'none'
              })
            }
          }
        }
      })
    },

    // ==================== 任务操作 ====================

    showCreateTaskDialog() {
      this.newTask = {
        title: '',
        description: '',
        priority: 'medium',
        dueDate: null
      }
      this.showTaskDialog = true
    },

    selectDueDate() {
      uni.showDatePicker({
        success: (res) => {
          this.newTask.dueDate = new Date(res.year, res.month - 1, res.day).getTime()
        }
      })
    },

    async createTask() {
      if (!this.newTask.title.trim()) {
        uni.showToast({
          title: '请输入任务标题',
          icon: 'none'
        })
        return
      }

      try {
        await projectManager.createTask(this.projectId, {
          title: this.newTask.title.trim(),
          description: this.newTask.description.trim(),
          priority: this.newTask.priority,
          dueDate: this.newTask.dueDate
        })

        uni.showToast({
          title: '创建成功',
          icon: 'success'
        })

        this.showTaskDialog = false
        await this.loadTasks()
      } catch (error) {
        console.error('[ProjectDetail] 创建任务失败:', error)
        uni.showToast({
          title: '创建失败',
          icon: 'none'
        })
      }
    },

    viewTask(task) {
      this.selectedTask = task
      this.showTaskDetailDialog = true
    },

    async updateTaskStatus(taskId, status) {
      try {
        await projectManager.updateTaskStatus(taskId, status)

        uni.showToast({
          title: '状态已更新',
          icon: 'success'
        })

        this.showTaskDetailDialog = false
        await this.loadTasks()

        // 重新加载项目统计信息
        await this.loadProjectData()
      } catch (error) {
        console.error('[ProjectDetail] 更新任务状态失败:', error)
        uni.showToast({
          title: '更新失败',
          icon: 'none'
        })
      }
    },

    async deleteTask(taskId) {
      uni.showModal({
        title: '确认删除',
        content: '确定要删除这个任务吗？',
        success: async (res) => {
          if (res.confirm) {
            try {
              await projectManager.deleteTask(taskId)

              uni.showToast({
                title: '删除成功',
                icon: 'success'
              })

              this.showTaskDetailDialog = false
              await this.loadTasks()
            } catch (error) {
              console.error('[ProjectDetail] 删除任务失败:', error)
              uni.showToast({
                title: '删除失败',
                icon: 'none'
              })
            }
          }
        }
      })
    },

    // ==================== 设置操作 ====================

    editProjectInfo() {
      // TODO: 跳转到编辑页面
      uni.showToast({
        title: '编辑功能开发中',
        icon: 'none'
      })
    },

    openCollaboratorDialog(autoFocus = false) {
      this.showCollaboratorDialog = true
      if (autoFocus) {
        this.$nextTick(() => {
          const input = this.$refs && this.$refs.inviteInput
          if (input && typeof input.focus === 'function') {
            input.focus()
          }
        })
      }
    },

    closeCollaboratorDialog() {
      this.showCollaboratorDialog = false
    },

    async submitInvitation() {
      if (!this.inviteForm.did.trim()) {
        uni.showToast({
          title: '请输入协作者 DID',
          icon: 'none'
        })
        return
      }

      try {
        await projectManager.inviteCollaborator(
          this.projectId,
          this.inviteForm.did.trim(),
          this.inviteForm.role
        )

        uni.showToast({
          title: '邀请已发送',
          icon: 'success'
        })

        this.inviteForm.did = ''
        this.inviteForm.role = 'viewer'
        await this.loadCollaborators()
      } catch (error) {
        console.error('[ProjectDetail] 邀请协作者失败:', error)
        uni.showToast({
          title: error.message || '邀请失败',
          icon: 'none'
        })
      }
    },

    async toggleSetting(key, event) {
      const value = event.detail.value

      try {
        this.projectSettings[key] = value

        await projectManager.updateProject(this.projectId, {
          settings: this.projectSettings
        })

        console.log(`[ProjectDetail] 设置已更新: ${key} = ${value}`)
      } catch (error) {
        console.error('[ProjectDetail] 更新设置失败:', error)
        // 回滚
        this.projectSettings[key] = !value
      }
    },

    archiveProject() {
      uni.showModal({
        title: '确认归档',
        content: '归档后项目将不再显示在项目列表中，可在"已归档"中查看',
        success: async (res) => {
          if (res.confirm) {
            try {
              await projectManager.archiveProject(this.projectId)

              uni.showToast({
                title: '归档成功',
                icon: 'success'
              })

              setTimeout(() => {
                uni.navigateBack()
              }, 1500)
            } catch (error) {
              console.error('[ProjectDetail] 归档失败:', error)
              uni.showToast({
                title: '归档失败',
                icon: 'none'
              })
            }
          }
        }
      })
    },

    deleteProject() {
      uni.showModal({
        title: '确认删除',
        content: '删除后将无法恢复，确定要删除这个项目吗？',
        confirmColor: '#ff4d4f',
        success: async (res) => {
          if (res.confirm) {
            try {
              await projectManager.deleteProject(this.projectId)

              uni.showToast({
                title: '删除成功',
                icon: 'success'
              })

              setTimeout(() => {
                uni.navigateBack()
              }, 1500)
            } catch (error) {
              console.error('[ProjectDetail] 删除失败:', error)
              uni.showToast({
                title: error.message || '删除失败',
                icon: 'none'
              })
            }
          }
        }
      })
    },

    shareProject() {
      // TODO: 实现分享功能
      this.showMorePopup = false
      uni.showToast({
        title: '分享功能开发中',
        icon: 'none'
      })
    },

    exportProject() {
      // TODO: 实现导出功能
      this.showMorePopup = false
      uni.showToast({
        title: '导出功能开发中',
        icon: 'none'
      })
    },

    // ==================== 工具方法 ====================

    getProjectIcon(type) {
      const icons = {
        general: '📋',
        code: '💻',
        research: '🔬',
        writing: '✍️',
        learning: '📚',
        other: '📁'
      }
      return icons[type] || icons.other
    },

    getProjectTypeLabel(type) {
      const labels = {
        general: '通用',
        code: '代码',
        research: '研究',
        writing: '写作',
        learning: '学习',
        other: '其他'
      }
      return labels[type] || labels.other
    },

    getFileIcon(fileType) {
      if (!fileType) return '📄'

      if (fileType.includes('image')) return '🖼️'
      if (fileType.includes('video')) return '🎥'
      if (fileType.includes('audio')) return '🎵'
      if (fileType.includes('pdf')) return '📕'
      if (fileType.includes('word') || fileType.includes('document')) return '📘'
      if (fileType.includes('excel') || fileType.includes('spreadsheet')) return '📊'
      if (fileType.includes('zip') || fileType.includes('rar')) return '📦'

      return '📄'
    },

    formatFileSize(bytes) {
      if (!bytes) return '0 B'

      const sizes = ['B', 'KB', 'MB', 'GB']
      const i = Math.floor(Math.log(bytes) / Math.log(1024))

      return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i]
    },

    getPriorityLabel(priority) {
      const labels = {
        low: '低',
        medium: '中',
        high: '高'
      }
      return labels[priority] || labels.medium
    },

    getStatusLabel(status) {
      const labels = {
        todo: '待办',
        in_progress: '进行中',
        done: '已完成'
      }
      return labels[status] || status
    },

    formatTime(timestamp) {
      if (!timestamp) return ''

      const now = Date.now()
      const diff = now - timestamp
      const minute = 60 * 1000
      const hour = 60 * minute
      const day = 24 * hour

      if (diff < minute) {
        return '刚刚'
      } else if (diff < hour) {
        return Math.floor(diff / minute) + '分钟前'
      } else if (diff < day) {
        return Math.floor(diff / hour) + '小时前'
      } else if (diff < 7 * day) {
        return Math.floor(diff / day) + '天前'
      } else {
        const date = new Date(timestamp)
        return `${date.getMonth() + 1}月${date.getDate()}日`
      }
    },

    formatDate(timestamp) {
      if (!timestamp) return ''

      const date = new Date(timestamp)
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    },

    getRoleLabel(role) {
      const map = {
        owner: '所有者',
        editor: '可编辑',
        viewer: '只读'
      }
      return map[role] || '协作者'
    },

    isTextFile(type = '', name = '') {
      const textExt = ['.txt', '.md', '.json', '.js', '.ts', '.vue', '.py', '.java', '.go', '.rs', '.xml', '.yml', '.yaml']
      return (
        !type ||
        type.startsWith('text') ||
        type.includes('json') ||
        textExt.some(ext => name?.toLowerCase().endsWith(ext))
      )
    },

    isImageFile(type = '', name = '') {
      const imageExt = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp']
      return (
        type.startsWith('image') ||
        imageExt.some(ext => name?.toLowerCase().endsWith(ext))
      )
    },

    closeFilePreview() {
      this.filePreviewVisible = false
      this.previewFileData = null
    },

    copyPreviewContent() {
      if (!this.previewFileData?.content) return

      uni.setClipboardData({
        data: this.previewFileData.content,
        success: () => {
          uni.showToast({
            title: '内容已复制',
            icon: 'none'
          })
        }
      })
    },

    downloadPreviewFile() {
      if (!this.previewFileData) return

      this.downloadContent(
        this.previewFileData.name || 'project-file.txt',
        this.previewFileData.content || '',
        this.previewFileData.type || 'text/plain'
      )
    },

    downloadContent(fileName, content, mimeType) {
      if (typeof document === 'undefined') {
        uni.setClipboardData({
          data: content,
          success: () => {
            uni.showToast({
              title: '内容已复制',
              icon: 'none'
            })
          }
        })
        return
      }

      try {
        const blob = new Blob([content], { type: mimeType || 'text/plain' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = fileName
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        URL.revokeObjectURL(url)
        uni.showToast({
          title: '已开始下载',
          icon: 'none'
        })
      } catch (error) {
        console.error('[ProjectDetail] 触发下载失败:', error)
        uni.showToast({
          title: '下载失败',
          icon: 'none'
        })
      }
    }
  }
}
</script>

<style scoped>
.project-detail-page {
  min-height: 100vh;
  background: #f5f5f5;
  padding-bottom: calc(env(safe-area-inset-bottom) + 20px);
}

/* 导航栏 */
.nav-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: white;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
  position: sticky;
  top: 0;
  z-index: 100;
}

.nav-left,
.nav-right {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 60px;
}

.nav-icon {
  font-size: 20px;
  color: #333;
}

.nav-text {
  font-size: 16px;
  color: #333;
}

.nav-title {
  font-size: 18px;
  font-weight: 600;
  color: #333;
}

/* 加载状态 */
.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 100px 20px;
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid #f0f0f0;
  border-top-color: #667eea;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.loading-text {
  margin-top: 16px;
  font-size: 14px;
  color: #999;
}

/* 项目内容 */
.project-content {
  padding: 16px;
}

/* 项目信息卡片 */
.project-header-card {
  background: white;
  border-radius: 12px;
  overflow: hidden;
  margin-bottom: 16px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.project-cover {
  width: 100%;
  height: 150px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.cover-image {
  width: 100%;
  height: 100%;
}

.cover-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.cover-icon {
  font-size: 60px;
}

.project-info {
  padding: 16px;
}

.info-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.project-name {
  font-size: 20px;
  font-weight: 600;
  color: #333;
  flex: 1;
  margin-right: 8px;
}

.project-type {
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 12px;
  color: white;
  background: #999;
}

.type-code {
  background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
}

.type-research {
  background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
}

.type-writing {
  background: linear-gradient(135deg, #43e97b 0%, #38f9d7 100%);
}

.type-learning {
  background: linear-gradient(135deg, #fa709a 0%, #fee140 100%);
}

.project-desc {
  font-size: 14px;
  color: #666;
  line-height: 1.6;
  margin-bottom: 16px;
}

.stats-row {
  display: flex;
  gap: 20px;
  margin-bottom: 16px;
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.stat-icon {
  font-size: 14px;
}

.stat-text {
  font-size: 12px;
  color: #999;
}

.progress-section {
  margin-top: 12px;
}

.progress-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
}

.progress-label {
  font-size: 14px;
  color: #666;
}

.progress-percent {
  font-size: 14px;
  font-weight: 600;
  color: #667eea;
}

.progress-bar {
  width: 100%;
  height: 6px;
  background: #f0f0f0;
  border-radius: 3px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
  transition: width 0.3s;
}

/* Tab导航 */
.tab-navigation {
  display: flex;
  background: white;
  border-radius: 12px;
  padding: 8px;
  margin-bottom: 16px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.tab-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 12px 8px;
  border-radius: 8px;
  transition: all 0.3s;
}

.tab-item.active {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.tab-icon {
  font-size: 20px;
}

.tab-item.active .tab-icon,
.tab-item.active .tab-label {
  filter: brightness(0) invert(1);
}

.tab-label {
  font-size: 14px;
  color: #666;
}

.tab-item.active .tab-label {
  color: white;
  font-weight: 600;
}

/* Tab内容 */
.tab-content {
  min-height: 300px;
}

/* 文件Tab */
.files-tab {
  position: relative;
}

.file-tree-container {
  background: white;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.file-tree-scroll {
  max-height: 420px;
}

.file-tree-node {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-bottom: 1px solid #f0f0f0;
}

.file-tree-node:last-child {
  border-bottom: none;
}

.tree-node-content {
  display: flex;
  align-items: center;
  flex: 1;
  gap: 8px;
}

.tree-toggle {
  width: 16px;
  font-size: 12px;
  color: #999;
  text-align: center;
}

.tree-toggle.placeholder {
  color: transparent;
}

.tree-icon {
  width: 22px;
  text-align: center;
}

.tree-info {
  flex: 1;
  min-width: 0;
}

.tree-name {
  font-size: 14px;
  color: #333;
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tree-meta {
  display: flex;
  gap: 10px;
  font-size: 12px;
  color: #999;
  margin-top: 2px;
}

.tree-actions {
  padding-left: 8px;
}

.action-icon {
  font-size: 20px;
  color: #999;
}

.upload-button {
  position: fixed;
  bottom: calc(env(safe-area-inset-bottom) + 30px);
  right: 20px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 20px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 24px;
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
}

.upload-icon {
  font-size: 20px;
  color: white;
}

.upload-text {
  font-size: 14px;
  font-weight: 600;
  color: white;
}

/* 任务Tab */
.tasks-tab {
  position: relative;
}

.task-board {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  padding-bottom: 16px;
}

.task-column {
  min-width: 280px;
  flex: 1;
}

.column-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.column-title {
  font-size: 16px;
  font-weight: 600;
  color: #333;
}

.column-badge {
  padding: 2px 8px;
  background: #f0f0f0;
  border-radius: 10px;
  font-size: 12px;
  color: #666;
}

.task-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.task-card {
  background: white;
  border-radius: 8px;
  padding: 12px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.08);
  transition: transform 0.2s;
}

.task-card:active {
  transform: scale(0.98);
}

.task-card.done {
  opacity: 0.7;
}

.task-title {
  font-size: 15px;
  font-weight: 500;
  color: #333;
  display: block;
  margin-bottom: 6px;
}

.task-desc {
  font-size: 13px;
  color: #666;
  display: block;
  margin-bottom: 8px;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}

.task-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.task-priority {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  color: white;
}

.priority-low {
  background: #52c41a;
}

.priority-medium {
  background: #faad14;
}

.priority-high {
  background: #ff4d4f;
}

.task-due {
  font-size: 12px;
  color: #999;
}

.task-completed {
  font-size: 12px;
  color: #52c41a;
}

.create-task-button {
  position: fixed;
  bottom: calc(env(safe-area-inset-bottom) + 30px);
  right: 20px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 20px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 24px;
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
}

.create-icon {
  font-size: 20px;
  color: white;
}

.create-text {
  font-size: 14px;
  font-weight: 600;
  color: white;
}

/* 设置Tab */
.settings-tab {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.settings-section {
  background: white;
  border-radius: 12px;
  padding: 16px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: #999;
  margin-bottom: 12px;
  display: block;
}

.setting-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 0;
  border-bottom: 1px solid #f0f0f0;
}

.setting-item:last-child {
  border-bottom: none;
}

.setting-label {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
}

.label-icon {
  font-size: 18px;
}

.label-text {
  font-size: 15px;
  color: #333;
}

.setting-value {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: #999;
}

.setting-arrow {
  font-size: 18px;
  color: #ccc;
}

.setting-item.danger .label-text {
  color: #ff4d4f;
}

/* 空状态 */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 80px 20px;
  text-align: center;
}

.empty-icon {
  font-size: 80px;
  margin-bottom: 20px;
  opacity: 0.5;
}

.empty-title {
  font-size: 18px;
  font-weight: 600;
  color: #333;
  margin-bottom: 8px;
}

.empty-subtitle {
  font-size: 14px;
  color: #999;
}

/* 错误状态 */
.error-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 100px 20px;
  text-align: center;
}

.error-icon {
  font-size: 80px;
  margin-bottom: 20px;
}

.error-title {
  font-size: 20px;
  font-weight: 600;
  color: #333;
  margin-bottom: 8px;
}

.error-subtitle {
  font-size: 14px;
  color: #999;
  margin-bottom: 30px;
}

.error-button {
  padding: 10px 30px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 20px;
  color: white;
  font-size: 14px;
}

/* 弹窗 */
.popup-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  z-index: 1000;
}

.popup-menu {
  width: 100%;
  background: white;
  border-radius: 12px 12px 0 0;
  padding: 20px;
  padding-bottom: calc(env(safe-area-inset-bottom) + 20px);
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  border-radius: 8px;
  transition: background 0.2s;
}

.menu-item:active {
  background: #f5f5f5;
}

.menu-icon {
  font-size: 20px;
}

.menu-text {
  font-size: 16px;
  color: #333;
}

/* 任务对话框 */
.task-dialog,
.task-detail-dialog {
  width: 90%;
  max-width: 500px;
  background: white;
  border-radius: 12px;
  overflow: hidden;
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid #f0f0f0;
}

.dialog-title {
  font-size: 18px;
  font-weight: 600;
  color: #333;
}

.dialog-close {
  font-size: 20px;
  color: #999;
  padding: 4px;
}

.dialog-body {
  padding: 20px;
  max-height: 60vh;
  overflow-y: auto;
}

.form-group {
  margin-bottom: 16px;
}

.form-label {
  display: block;
  font-size: 14px;
  font-weight: 500;
  color: #333;
  margin-bottom: 8px;
}

.form-input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #d9d9d9;
  border-radius: 6px;
  font-size: 14px;
}

.form-textarea {
  width: 100%;
  min-height: 80px;
  padding: 10px 12px;
  border: 1px solid #d9d9d9;
  border-radius: 6px;
  font-size: 14px;
}

.priority-selector {
  display: flex;
  gap: 8px;
}

.priority-option {
  flex: 1;
  padding: 8px 12px;
  text-align: center;
  border: 1px solid #d9d9d9;
  border-radius: 6px;
  font-size: 14px;
  color: #666;
  transition: all 0.2s;
}

.priority-option.active {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-color: #667eea;
  color: white;
}

.date-picker {
  padding: 10px 12px;
  border: 1px solid #d9d9d9;
  border-radius: 6px;
  font-size: 14px;
  color: #333;
}

.date-placeholder {
  color: #999;
}

.dialog-footer {
  display: flex;
  gap: 12px;
  padding: 16px 20px;
  border-top: 1px solid #f0f0f0;
}

.dialog-button {
  flex: 1;
  padding: 12px;
  text-align: center;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
}

.dialog-button.cancel {
  background: #f5f5f5;
  color: #666;
}

.dialog-button.confirm {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}

.dialog-button.secondary {
  background: #f0f0f0;
  color: #333;
}

.dialog-button.danger {
  background: #ff4d4f;
  color: white;
}

/* 协作者弹窗 */
.collaborator-dialog {
  width: 90%;
  max-width: 420px;
  max-height: 80vh;
  background: white;
  border-radius: 12px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.collaborator-body {
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.collaborator-list {
  max-height: 200px;
}

.collaborator-item {
  background: #f8f8f8;
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 10px;
}

.collaborator-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 6px;
}

.collaborator-id {
  font-size: 13px;
  color: #333;
  flex: 1;
  word-break: break-all;
}

.collaborator-role {
  font-size: 12px;
  color: #667eea;
  background: rgba(102, 126, 234, 0.12);
  padding: 2px 8px;
  border-radius: 20px;
}

.collaborator-meta {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: #888;
}

.collaborator-empty {
  padding: 20px 0;
  text-align: center;
}

.collaborator-empty .empty-title {
  font-weight: 600;
  color: #333;
}

.collaborator-empty .empty-subtitle {
  font-size: 12px;
  color: #999;
  margin-top: 4px;
}

.invite-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.role-selector {
  display: flex;
  gap: 8px;
}

.role-option {
  flex: 1;
  padding: 10px 12px;
  text-align: center;
  border: 1px solid #d9d9d9;
  border-radius: 6px;
  font-size: 14px;
  color: #666;
}

.role-option.active {
  border-color: #667eea;
  color: #667eea;
  background: rgba(102, 126, 234, 0.12);
}

/* 文件预览 */
.file-preview-dialog {
  width: 90%;
  max-width: 500px;
  max-height: 80vh;
  background: white;
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.preview-meta {
  display: flex;
  justify-content: space-between;
  padding: 0 20px;
  font-size: 12px;
  color: #999;
}

.preview-loading {
  padding: 40px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.loading-spinner.small {
  width: 24px;
  height: 24px;
}

.preview-content {
  flex: 1;
  padding: 16px 20px;
  background: #fafafa;
}

.preview-text {
  font-family: Menlo, Monaco, Consolas, 'Courier New', monospace;
  white-space: pre-wrap;
  font-size: 13px;
  color: #333;
}

.preview-image {
  width: 100%;
  border-radius: 8px;
}

.preview-placeholder {
  font-size: 14px;
  color: #999;
  text-align: center;
  padding: 40px 0;
}

/* 任务详情对话框 */
.task-detail-title {
  font-size: 20px;
  font-weight: 600;
  color: #333;
  margin-bottom: 12px;
}

.task-detail-desc {
  font-size: 14px;
  color: #666;
  line-height: 1.6;
  margin-bottom: 20px;
  padding: 12px;
  background: #f5f5f5;
  border-radius: 6px;
}

.task-detail-info {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 20px;
}

.info-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.info-label {
  font-size: 14px;
  color: #999;
}

.info-value {
  font-size: 14px;
  color: #333;
}

.status-actions {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
}

.status-button {
  flex: 1;
  padding: 12px;
  text-align: center;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  background: #f5f5f5;
  color: #666;
}

.status-button.primary {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}

.status-button.success {
  background: #52c41a;
  color: white;
}
</style>
