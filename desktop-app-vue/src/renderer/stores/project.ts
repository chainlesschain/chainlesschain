/**
 * Project Store - 项目管理
 * 管理项目列表、文件、模板、同步状态等
 */

import { logger } from '@/utils/logger';
import { defineStore } from 'pinia';
import { electronAPI } from '../utils/ipc';

// ==================== 类型定义 ====================

/**
 * 项目类型
 */
export type ProjectType = 'web' | 'document' | 'data' | 'app' | string;

/**
 * 项目状态
 */
export type ProjectStatus = 'active' | 'completed' | 'archived' | string;

/**
 * 视图模式
 */
export type ViewMode = 'grid' | 'list';

/**
 * 排序字段
 */
export type SortBy = 'updated_at' | 'created_at' | 'name';

/**
 * 排序顺序
 */
export type SortOrder = 'asc' | 'desc';

/**
 * 项目
 */
export interface Project {
  id: string;
  name: string;
  description?: string;
  project_type: ProjectType;
  status: ProjectStatus;
  tags?: string;
  root_path?: string;
  files?: ProjectFile[];
  metadata?: any;
  created_at: number;
  updated_at: number;
  [key: string]: any;
}

/**
 * 项目文件
 */
export interface ProjectFile {
  id: string;
  project_id: string;
  file_name: string;
  file_path: string;
  content?: string;
  version?: number;
  created_at: number;
  updated_at: number;
  [key: string]: any;
}

/**
 * 文件树节点
 */
export interface FileTreeNode {
  name: string;
  path: string;
  children: FileTreeNode[];
  files: ProjectFile[];
}

/**
 * 分页状态
 */
export interface PaginationState {
  current: number;
  pageSize: number;
  total: number;
}

/**
 * 筛选条件
 */
export interface ProjectFilters {
  projectType: ProjectType | '';
  status: ProjectStatus | '';
  tags: string[];
  searchKeyword: string;
}

/**
 * 项目统计
 */
export interface ProjectStats {
  total: number;
  byType: Record<string, number>;
  byStatus: Record<string, number>;
}

/**
 * 创建项目数据
 */
export interface ProjectCreateData {
  name: string;
  type?: ProjectType;
  description?: string;
  onProgress?: (stage: string) => void;
  onContent?: (content: string) => void;
  onComplete?: (data: any) => void;
  onError?: (error: Error) => void;
  [key: string]: any;
}

/**
 * 进度数据
 */
export interface ProgressData {
  currentStage: string;
  stages: ProgressStage[];
  contentByStage: Record<string, string>;
  logs: ProgressLog[];
  metadata: Record<string, any>;
}

/**
 * 进度阶段
 */
export interface ProgressStage {
  stage: string;
  message: string;
  timestamp: number;
  status: 'running' | 'completed' | 'error';
}

/**
 * 进度日志
 */
export interface ProgressLog {
  type: 'info' | 'success' | 'error';
  message: string;
  timestamp: number;
}

/**
 * Project Store 状态
 */
export interface ProjectState {
  projects: Project[];
  currentProject: Project | null;
  projectFiles: ProjectFile[];
  currentFile: ProjectFile | null;
  fileTreeExpanded: string[];
  pagination: PaginationState;
  filters: ProjectFilters;
  sortBy: SortBy;
  sortOrder: SortOrder;
  viewMode: ViewMode;
  loading: boolean;
  syncing: boolean;
  syncError: string | null;
  creatingProject: boolean;
  createProgress: number;
  createStatus: string;
}

// ==================== Store ====================

export const useProjectStore = defineStore('project', {
  state: (): ProjectState => ({
    // 项目列表
    projects: [],
    currentProject: null,

    // 项目文件
    projectFiles: [],
    currentFile: null,
    fileTreeExpanded: [],

    // 分页状态
    pagination: {
      current: 1,
      pageSize: 12,
      total: 0,
    },

    // 筛选和搜索
    filters: {
      projectType: '',
      status: '',
      tags: [],
      searchKeyword: '',
    },

    // 排序
    sortBy: 'updated_at',
    sortOrder: 'desc',

    // 视图模式
    viewMode: 'grid',

    // UI状态
    loading: false,
    syncing: false,
    syncError: null,

    // 新建项目状态
    creatingProject: false,
    createProgress: 0,
    createStatus: '',
  }),

  getters: {
    /**
     * 过滤和排序后的项目列表
     */
    filteredProjects(): Project[] {
      let result = [...this.projects];

      // 筛选
      if (this.filters.projectType) {
        result = result.filter((p) => p.project_type === this.filters.projectType);
      }
      if (this.filters.status) {
        result = result.filter((p) => p.status === this.filters.status);
      }
      if (this.filters.tags.length > 0) {
        result = result.filter((p) => {
          try {
            const projectTags = JSON.parse(p.tags || '[]') as string[];
            return this.filters.tags.some((tag) => projectTags.includes(tag));
          } catch {
            return false;
          }
        });
      }
      if (this.filters.searchKeyword) {
        const keyword = this.filters.searchKeyword.toLowerCase();
        result = result.filter(
          (p) =>
            p.name.toLowerCase().includes(keyword) ||
            (p.description && p.description.toLowerCase().includes(keyword))
        );
      }

      // 排序
      result.sort((a, b) => {
        const aVal = a[this.sortBy];
        const bVal = b[this.sortBy];

        if (this.sortBy === 'name') {
          return this.sortOrder === 'asc'
            ? String(aVal).localeCompare(String(bVal))
            : String(bVal).localeCompare(String(aVal));
        }

        return this.sortOrder === 'asc'
          ? Number(aVal) - Number(bVal)
          : Number(bVal) - Number(aVal);
      });

      return result;
    },

    /**
     * 分页后的项目
     */
    paginatedProjects(): Project[] {
      const filtered = this.filteredProjects;
      const start = (this.pagination.current - 1) * this.pagination.pageSize;
      const end = start + this.pagination.pageSize;
      return filtered.slice(start, end);
    },

    /**
     * 项目统计
     */
    projectStats(): ProjectStats {
      const stats: ProjectStats = {
        total: this.projects.length,
        byType: {},
        byStatus: {},
      };

      this.projects.forEach((p) => {
        stats.byType[p.project_type] = (stats.byType[p.project_type] || 0) + 1;
        stats.byStatus[p.status] = (stats.byStatus[p.status] || 0) + 1;
      });

      return stats;
    },

    /**
     * 文件树结构
     */
    fileTree(): FileTreeNode {
      const root: FileTreeNode = { name: '/', path: '/', children: [], files: [] };

      this.projectFiles.forEach((file) => {
        const parts = file.file_path.split('/').filter(Boolean);
        let current = root;

        // 构建目录结构
        for (let i = 0; i < parts.length - 1; i++) {
          const partName = parts[i];
          const partPath = '/' + parts.slice(0, i + 1).join('/');

          let child = current.children.find((c) => c.name === partName);
          if (!child) {
            child = {
              name: partName,
              path: partPath,
              children: [],
              files: [],
            };
            current.children.push(child);
          }
          current = child;
        }

        // 添加文件
        current.files.push(file);
      });

      return root;
    },
  },

  actions: {
    // ==================== 项目CRUD ====================

    /**
     * 获取项目列表
     */
    async fetchProjects(userId: string, forceSync: boolean = false): Promise<void> {
      this.loading = true;
      try {
        // 1. 从本地SQLite加载
        const response = await electronAPI.project.getAll(userId);
        const localProjects = Array.isArray(response) ? response : response.projects || [];
        this.projects = localProjects;
        this.pagination.total = (response as any).total || localProjects.length;

        // 2. 后台同步
        if (forceSync || this.shouldSync()) {
          await this.syncProjects(userId);
        }
      } catch (error) {
        logger.error('加载项目列表失败:', error as any);
        throw error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * 创建项目
     */
    async createProject(createData: ProjectCreateData): Promise<Project> {
      this.creatingProject = true;
      this.createProgress = 0;
      this.createStatus = '正在连接AI服务...';

      try {
        // 调用后端创建项目（含AI生成）
        this.createProgress = 10;
        this.createStatus = '正在生成项目文件...';

        const response = await (window as any).electronAPI.project.create(createData);

        this.createProgress = 90;
        this.createStatus = '项目创建成功！';

        // 添加到列表
        if (!Array.isArray(this.projects)) {
          logger.warn('[Store] this.projects 不是数组，重置为空数组');
          this.projects = [];
        }
        this.projects.unshift(response);
        this.pagination.total++;

        this.createProgress = 100;

        return response;
      } catch (error) {
        this.createStatus = '创建失败: ' + (error as Error).message;
        throw error;
      } finally {
        setTimeout(() => {
          this.creatingProject = false;
          this.createProgress = 0;
          this.createStatus = '';
        }, 1000);
      }
    },

    /**
     * 流式创建项目
     */
    async createProjectStream(
      createData: ProjectCreateData,
      onProgress?: (data: ProgressData & { type: string; result?: any; error?: string }) => void
    ): Promise<any> {
      logger.info('[Store] ===== createProjectStream被调用 =====');

      // 从 createData 中提取回调函数（如果存在）
      const {
        onProgress: dataOnProgress,
        onContent: dataOnContent,
        onComplete: dataOnComplete,
        onError: dataOnError,
        ...pureData
      } = createData;

      return new Promise((resolve, reject) => {
        const progressData: ProgressData = {
          currentStage: '',
          stages: [],
          contentByStage: {},
          logs: [],
          metadata: {},
        };

        const callbacks = {
          onProgress: (data: { stage: string; message: string }) => {
            logger.info('[Store] Progress data:', data);

            progressData.currentStage = data.stage;

            const existingStage = progressData.stages.find((s) => s.stage === data.stage);

            if (existingStage) {
              existingStage.message = data.message;
              existingStage.timestamp = Date.now();
              existingStage.status = 'running';

              progressData.stages.forEach((s) => {
                if (s.stage !== data.stage && s.status === 'running') {
                  s.status = 'completed';
                }
              });
            } else {
              progressData.stages.forEach((s) => {
                if (s.status === 'running') {
                  s.status = 'completed';
                }
              });

              progressData.stages.push({
                stage: data.stage,
                message: data.message,
                timestamp: Date.now(),
                status: 'running',
              });
            }

            progressData.logs.push({
              type: 'info',
              message: data.message,
              timestamp: Date.now(),
            });

            if (dataOnProgress) {
              dataOnProgress(data.stage);
            }

            // 只调用新的进度回调（如果存在）
            onProgress?.({
              type: 'progress',
              ...progressData,
            });
          },

          onContent: (data: { stage: string; content: string }) => {
            if (!progressData.contentByStage[data.stage]) {
              progressData.contentByStage[data.stage] = '';
            }
            progressData.contentByStage[data.stage] += data.content;

            if (dataOnContent) {
              dataOnContent(data.content);
            }

            // 只调用新的进度回调（如果存在）
            onProgress?.({
              type: 'content',
              ...progressData,
            });
          },

          onComplete: (data: { projectId?: string; files?: any[]; metadata?: any }) => {
            logger.info('[Store] Complete data:', data);

            progressData.stages.forEach((s) => (s.status = 'completed'));
            progressData.metadata = data.metadata || {};
            progressData.logs.push({
              type: 'success',
              message: `成功生成${data.files?.length || 0}个文件`,
              timestamp: Date.now(),
            });

            if (data.projectId) {
              if (!Array.isArray(this.projects)) {
                this.projects = [];
              }
              this.projects.unshift({
                id: data.projectId,
                name: pureData.name || '未命名项目',
                project_type: pureData.type || 'web',
                status: 'active',
                files: data.files || [],
                metadata: data.metadata,
                created_at: Date.now(),
                updated_at: Date.now(),
              });
              this.pagination.total++;
            }

            if (dataOnComplete) {
              dataOnComplete(data);
            }

            // 只调用新的进度回调（如果存在）
            onProgress?.({
              type: 'complete',
              ...progressData,
              result: data,
            });

            resolve(data);
          },

          onError: (error: Error) => {
            const currentStage = progressData.stages.find((s) => s.status === 'running');
            if (currentStage) {
              currentStage.status = 'error';
            }
            progressData.logs.push({
              type: 'error',
              message: error.message,
              timestamp: Date.now(),
            });

            if (dataOnError) {
              dataOnError(error);
            }

            // 只调用新的进度回调（如果存在）
            onProgress?.({
              type: 'error',
              ...progressData,
              error: error.message,
            });

            reject(error);
          },
        };

        // 调用流式创建
        const serializedData = JSON.parse(JSON.stringify(pureData));
        (window as any).electronAPI.project.createStream(serializedData, callbacks).catch(reject);
      });
    },

    /**
     * 取消流式创建
     */
    async cancelProjectStream(): Promise<void> {
      await (window as any).electronAPI.project.cancelStream();
    },

    /**
     * 获取项目详情
     */
    async getProject(projectId: string): Promise<Project> {
      this.loading = true;
      try {
        // 1. 从本地获取
        let project = await (window as any).electronAPI.project.get(projectId);

        if (!project) {
          // 2. 从后端获取并缓存
          project = await (window as any).electronAPI.project.fetchFromBackend(projectId);
        }

        this.currentProject = project;

        // 3. 加载项目文件
        await this.loadProjectFiles(projectId);

        return project;
      } catch (error) {
        logger.error('获取项目详情失败:', error as any);
        throw error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * 通过ID获取项目（别名）
     */
    async fetchProjectById(projectId: string): Promise<Project> {
      return this.getProject(projectId);
    },

    /**
     * 更新项目
     */
    async updateProject(projectId: string, updates: Partial<Project>): Promise<void> {
      try {
        // 1. 更新本地
        await (window as any).electronAPI.project.update(projectId, updates);

        // 2. 更新store
        const index = this.projects.findIndex((p) => p.id === projectId);
        if (index !== -1) {
          this.projects[index] = {
            ...this.projects[index],
            ...updates,
            updated_at: Date.now(),
          };
        }

        if (this.currentProject?.id === projectId) {
          this.currentProject = { ...this.currentProject, ...updates };
        }

        // 3. 后台同步到后端
        this.syncProjectToBackend(projectId);
      } catch (error) {
        logger.error('更新项目失败:', error as any);
        throw error;
      }
    },

    /**
     * 删除项目
     */
    async deleteProject(projectId: string): Promise<void> {
      try {
        // 删除项目（包含本地和后端）
        await (window as any).electronAPI.project.delete(projectId);

        // 更新store
        if (!Array.isArray(this.projects)) {
          this.projects = [];
        }
        this.projects = this.projects.filter((p) => p.id !== projectId);
        this.pagination.total--;

        if (this.currentProject?.id === projectId) {
          this.currentProject = null;
        }
      } catch (error) {
        logger.error('删除项目失败:', error as any);
        throw error;
      }
    },

    // ==================== 文件管理 ====================

    /**
     * 加载项目文件
     */
    async loadProjectFiles(projectId: string): Promise<ProjectFile[]> {
      const startTime = Date.now();
      logger.info('[Store] loadProjectFiles 开始, 项目ID:', projectId);

      try {
        const response = await (window as any).electronAPI.project.getFiles(projectId);
        const elapsed = Date.now() - startTime;

        logger.info(`[Store] IPC 返回，耗时: ${elapsed}ms`);

        let files: ProjectFile[] = [];

        try {
          if (Array.isArray(response)) {
            files = response;
          } else if (response && typeof response === 'object' && Array.isArray(response.files)) {
            files = response.files;
          } else {
            files = [];
          }
        } catch {
          files = [];
        }

        this.projectFiles = Array.isArray(files) ? [...files] : [];
        logger.info('[Store] projectFiles 已更新, 长度:', this.projectFiles.length);

        return this.projectFiles;
      } catch (error) {
        logger.error('[Store] loadProjectFiles 错误:', error as any);
        this.projectFiles = [];
        return [];
      }
    },

    /**
     * 保存项目文件
     */
    async saveProjectFiles(projectId: string, files: ProjectFile[]): Promise<void> {
      try {
        await (window as any).electronAPI.project.saveFiles(projectId, files);
        this.projectFiles = files;
      } catch (error) {
        logger.error('保存项目文件失败:', error as any);
        throw error;
      }
    },

    /**
     * 更新文件
     */
    async updateFile(fileId: string, content: string): Promise<void> {
      try {
        const updatedFile = {
          id: fileId,
          content,
          updated_at: Date.now(),
          version: (this.currentFile?.version || 0) + 1,
        };

        await (window as any).electronAPI.project.updateFile(updatedFile);

        // 更新store
        const index = this.projectFiles.findIndex((f) => f.id === fileId);
        if (index !== -1) {
          this.projectFiles[index] = {
            ...this.projectFiles[index],
            ...updatedFile,
          };
        }

        if (this.currentFile?.id === fileId) {
          this.currentFile = { ...this.currentFile, ...updatedFile };
        }
      } catch (error) {
        logger.error('更新文件失败:', error as any);
        throw error;
      }
    },

    /**
     * 设置当前文件
     */
    setCurrentFile(file: ProjectFile | null): void {
      this.currentFile = file;
    },

    /**
     * 切换文件夹展开状态
     */
    toggleFolderExpanded(folderPath: string): void {
      const index = this.fileTreeExpanded.indexOf(folderPath);
      if (index > -1) {
        this.fileTreeExpanded.splice(index, 1);
      } else {
        this.fileTreeExpanded.push(folderPath);
      }
    },

    // ==================== 同步 ====================

    /**
     * 同步项目
     */
    async syncProjects(userId: string): Promise<void> {
      if (this.syncing) {
        return;
      }

      if (!electronAPI?.project?.sync) {
        return;
      }

      this.syncing = true;
      this.syncError = null;

      try {
        await electronAPI.project.sync(userId);

        // 重新加载本地数据
        const response = await electronAPI.project.getAll(userId);
        const localProjects = Array.isArray(response) ? response : response.projects || [];
        this.projects = localProjects;
        this.pagination.total = (response as any).total || localProjects.length;

        // 更新最后同步时间
        localStorage.setItem('project_last_sync', Date.now().toString());
      } catch (error) {
        const err = error as Error;
        if (err.message?.includes('No handler registered')) {
          return;
        }
        this.syncError = err.message;
        logger.error('[Project Store] 同步项目失败:', error as any);
      } finally {
        this.syncing = false;
      }
    },

    /**
     * 同步单个项目到后端
     */
    async syncProjectToBackend(projectId: string): Promise<void> {
      try {
        await (window as any).electronAPI.project.syncOne(projectId);
      } catch (error) {
        logger.error('同步项目到后端失败:', error as any);
      }
    },

    /**
     * 判断是否需要同步
     */
    shouldSync(): boolean {
      try {
        const lastSync = localStorage.getItem('project_last_sync');
        if (!lastSync) {
          return true;
        }
        return Date.now() - parseInt(lastSync) > 5 * 60 * 1000;
      } catch {
        return true;
      }
    },

    // ==================== 筛选和视图 ====================

    /**
     * 设置筛选条件
     */
    setFilter(key: keyof ProjectFilters, value: any): void {
      (this.filters as any)[key] = value;
      this.pagination.current = 1;
    },

    /**
     * 重置筛选条件
     */
    resetFilters(): void {
      this.filters = {
        projectType: '',
        status: '',
        tags: [],
        searchKeyword: '',
      };
      this.pagination.current = 1;
    },

    /**
     * 设置排序
     */
    setSort(sortBy: SortBy, sortOrder: SortOrder): void {
      this.sortBy = sortBy;
      this.sortOrder = sortOrder;
    },

    /**
     * 设置视图模式
     */
    setViewMode(mode: ViewMode): void {
      this.viewMode = mode;
      try {
        localStorage.setItem('project_view_mode', mode);
      } catch {
        // 静默失败
      }
    },

    /**
     * 设置分页
     */
    setPagination(current: number, pageSize?: number): void {
      this.pagination.current = current;
      if (pageSize) {
        this.pagination.pageSize = pageSize;
      }
    },

    // ==================== Git集成 ====================

    /**
     * 初始化Git仓库
     */
    async initGit(projectId: string, remoteUrl: string | null = null): Promise<void> {
      try {
        const project = this.projects.find((p) => p.id === projectId);
        if (!project?.root_path) {
          throw new Error('项目路径不存在');
        }

        await (window as any).electronAPI.project.gitInit(project.root_path, remoteUrl);
      } catch (error) {
        logger.error('初始化Git失败:', error as any);
        throw error;
      }
    },

    /**
     * Git提交
     */
    async gitCommit(
      projectId: string,
      message: string,
      autoGenerate: boolean = false
    ): Promise<void> {
      try {
        const project = this.projects.find((p) => p.id === projectId);
        if (!project?.root_path) {
          throw new Error('项目路径不存在');
        }

        await (window as any).electronAPI.project.gitCommit(
          projectId,
          project.root_path,
          message,
          autoGenerate
        );
      } catch (error) {
        logger.error('Git提交失败:', error as any);
        throw error;
      }
    },

    /**
     * Git推送
     */
    async gitPush(
      projectId: string,
      remote: string = 'origin',
      branch: string | null = null
    ): Promise<void> {
      try {
        const project = this.projects.find((p) => p.id === projectId);
        if (!project?.root_path) {
          throw new Error('项目路径不存在');
        }

        await (window as any).electronAPI.project.gitPush(project.root_path, remote, branch);
      } catch (error) {
        logger.error('Git推送失败:', error as any);
        throw error;
      }
    },

    /**
     * Git拉取
     */
    async gitPull(
      projectId: string,
      remote: string = 'origin',
      branch: string | null = null
    ): Promise<void> {
      try {
        const project = this.projects.find((p) => p.id === projectId);
        if (!project?.root_path) {
          throw new Error('项目路径不存在');
        }

        await (window as any).electronAPI.project.gitPull(
          projectId,
          project.root_path,
          remote,
          branch
        );

        // 重新加载文件
        await this.loadProjectFiles(projectId);
      } catch (error) {
        logger.error('Git拉取失败:', error as any);
        throw error;
      }
    },

    /**
     * 获取Git状态
     */
    async gitStatus(projectId: string): Promise<any> {
      try {
        const project = this.projects.find((p) => p.id === projectId);
        if (!project?.root_path) {
          throw new Error('项目路径不存在');
        }

        return await (window as any).electronAPI.project.gitStatus(project.root_path);
      } catch (error) {
        logger.error('获取Git状态失败:', error as any);
        throw error;
      }
    },

    // ==================== 辅助方法 ====================

    /**
     * 清空当前项目
     */
    clearCurrentProject(): void {
      this.currentProject = null;
      this.projectFiles = [];
      this.currentFile = null;
      this.fileTreeExpanded = [];
    },

    /**
     * 从localStorage恢复视图模式
     */
    restoreViewMode(): void {
      try {
        const savedMode = localStorage.getItem('project_view_mode') as ViewMode | null;
        if (savedMode) {
          this.viewMode = savedMode;
        }
      } catch {
        // 静默失败
      }
    },
  },
});
