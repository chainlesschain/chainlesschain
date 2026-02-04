import { logger, createLogger } from "@/utils/logger";
import { defineStore } from "pinia";
import { electronAPI } from "../utils/ipc";

/**
 * 项目管理Store
 * 管理项目列表、文件、模板、同步状态等
 */
export const useProjectStore = defineStore("project", {
  state: () => ({
    // 项目列表
    projects: [],
    currentProject: null,

    // 项目文件
    projectFiles: [],
    currentFile: null,
    fileTreeExpanded: [], // 展开的文件夹路径

    // 分页状态
    pagination: {
      current: 1,
      pageSize: 12,
      total: 0,
    },

    // 筛选和搜索
    filters: {
      projectType: "", // '', 'web', 'document', 'data', 'app'
      status: "", // '', 'active', 'completed', 'archived'
      tags: [],
      searchKeyword: "",
    },

    // 排序
    sortBy: "updated_at", // 'updated_at', 'created_at', 'name'
    sortOrder: "desc", // 'asc', 'desc'

    // 视图模式
    viewMode: "grid", // 'grid', 'list'

    // UI状态
    loading: false,
    syncing: false,
    syncError: null,

    // 新建项目状态
    creatingProject: false,
    createProgress: 0,
    createStatus: "",
  }),

  getters: {
    /**
     * 过滤和排序后的项目列表
     */
    filteredProjects: (state) => {
      let result = [...state.projects];

      // 筛选
      if (state.filters.projectType) {
        result = result.filter(
          (p) => p.project_type === state.filters.projectType,
        );
      }
      if (state.filters.status) {
        result = result.filter((p) => p.status === state.filters.status);
      }
      if (state.filters.tags.length > 0) {
        result = result.filter((p) => {
          try {
            const projectTags = JSON.parse(p.tags || "[]");
            return state.filters.tags.some((tag) => projectTags.includes(tag));
          } catch {
            return false;
          }
        });
      }
      if (state.filters.searchKeyword) {
        const keyword = state.filters.searchKeyword.toLowerCase();
        result = result.filter(
          (p) =>
            p.name.toLowerCase().includes(keyword) ||
            (p.description && p.description.toLowerCase().includes(keyword)),
        );
      }

      // 排序
      result.sort((a, b) => {
        const aVal = a[state.sortBy];
        const bVal = b[state.sortBy];

        if (state.sortBy === "name") {
          return state.sortOrder === "asc"
            ? aVal.localeCompare(bVal)
            : bVal.localeCompare(aVal);
        }

        return state.sortOrder === "asc" ? aVal - bVal : bVal - aVal;
      });

      return result;
    },

    /**
     * 分页后的项目
     */
    paginatedProjects: (state) => {
      const filtered = state.filteredProjects;
      const start = (state.pagination.current - 1) * state.pagination.pageSize;
      const end = start + state.pagination.pageSize;
      return filtered.slice(start, end);
    },

    /**
     * 项目统计
     */
    projectStats: (state) => {
      const stats = {
        total: state.projects.length,
        byType: {},
        byStatus: {},
      };

      state.projects.forEach((p) => {
        stats.byType[p.project_type] = (stats.byType[p.project_type] || 0) + 1;
        stats.byStatus[p.status] = (stats.byStatus[p.status] || 0) + 1;
      });

      return stats;
    },

    /**
     * 文件树结构
     */
    fileTree: (state) => {
      // 将扁平的文件列表转换为树形结构
      const root = { name: "/", path: "/", children: [], files: [] };

      state.projectFiles.forEach((file) => {
        const parts = file.file_path.split("/").filter(Boolean);
        let current = root;

        // 构建目录结构
        for (let i = 0; i < parts.length - 1; i++) {
          const partName = parts[i];
          const partPath = "/" + parts.slice(0, i + 1).join("/");

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
     * @param {string} userId - 用户ID
     * @param {boolean} forceSync - 是否强制同步
     */
    async fetchProjects(userId, forceSync = false) {
      this.loading = true;
      try {
        // 1. 从本地SQLite加载
        const response = await electronAPI.project.getAll(userId);
        // BUGFIX: IPC 返回的是 { projects: [], total: 0, hasMore: false }
        const localProjects = Array.isArray(response) ? response : (response.projects || []);
        this.projects = localProjects;
        this.pagination.total = response.total || localProjects.length;

        // 2. 后台同步
        if (forceSync || this.shouldSync()) {
          await this.syncProjects(userId);
        }
      } catch (error) {
        logger.error("加载项目列表失败:", error);
        throw error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * 创建项目
     * @param {Object} createData - 创建数据
     */
    async createProject(createData) {
      this.creatingProject = true;
      this.createProgress = 0;
      this.createStatus = "正在连接AI服务...";

      try {
        // 调用后端创建项目（含AI生成）
        this.createProgress = 10;
        this.createStatus = "正在生成项目文件...";

        const response = await window.electronAPI.project.create(createData);

        this.createProgress = 90;
        this.createStatus = "项目创建成功！";

        // 添加到列表 - 确保 projects 是数组
        if (!Array.isArray(this.projects)) {
          logger.warn("[Store] this.projects 不是数组，重置为空数组");
          this.projects = [];
        }
        this.projects.unshift(response);
        this.pagination.total++;

        this.createProgress = 100;

        return response;
      } catch (error) {
        this.createStatus = "创建失败: " + error.message;
        throw error;
      } finally {
        setTimeout(() => {
          this.creatingProject = false;
          this.createProgress = 0;
          this.createStatus = "";
        }, 1000);
      }
    },

    /**
     * 流式创建项目
     * @param {Object} createData - 创建数据（可能包含回调函数）
     * @param {Function} onProgress - 进度回调（可选，如果createData中有回调则使用createData中的）
     * @returns {Promise<Object>} 创建结果
     */
    async createProjectStream(createData, onProgress) {
      logger.info("[Store] ===== createProjectStream被调用 =====");
      logger.info("[Store] createData:", createData);
      logger.info("[Store] onProgress存在?", !!onProgress);
      logger.info("[Store] onProgress类型:", typeof onProgress);

      // 从 createData 中提取回调函数（如果存在）
      const {
        onProgress: dataOnProgress,
        onContent: dataOnContent,
        onComplete: dataOnComplete,
        onError: dataOnError,
        ...pureData
      } = createData;

      logger.info("[Store] 提取后的纯数据:", pureData);
      logger.info("[Store] 是否有回调函数:", {
        onProgress: !!dataOnProgress,
        onContent: !!dataOnContent,
        onComplete: !!dataOnComplete,
        onError: !!dataOnError,
      });

      return new Promise((resolve, reject) => {
        const progressData = {
          currentStage: "",
          stages: [],
          contentByStage: {},
          logs: [],
          metadata: {},
        };

        const callbacks = {
          onProgress: (data) => {
            logger.info("[Store] ===== onProgress回调被触发 =====");
            logger.info("[Store] Progress data:", data);
            logger.info("[Store] Progress stage:", data.stage);
            logger.info("[Store] Progress message:", data.message);

            // 更新当前阶段
            progressData.currentStage = data.stage;

            // 查找是否已有该阶段
            const existingStage = progressData.stages.find(
              (s) => s.stage === data.stage,
            );

            if (existingStage) {
              // 更新已有阶段
              existingStage.message = data.message;
              existingStage.timestamp = Date.now();
              existingStage.status = "running";

              // 标记之前的阶段为completed
              progressData.stages.forEach((s) => {
                if (s.stage !== data.stage && s.status === "running") {
                  s.status = "completed";
                }
              });
            } else {
              // 标记之前所有running的阶段为completed
              progressData.stages.forEach((s) => {
                if (s.status === "running") {
                  s.status = "completed";
                }
              });

              // 添加新阶段
              progressData.stages.push({
                stage: data.stage,
                message: data.message,
                timestamp: Date.now(),
                status: "running",
              });
            }

            progressData.logs.push({
              type: "info",
              message: data.message,
              timestamp: Date.now(),
            });

            // 调用来自 createData 的回调（如果存在）
            if (dataOnProgress) {
              dataOnProgress(data.stage);
            }

            // 回调给UI（使用参数传入的onProgress或createData中的）
            const progressCallback = onProgress || dataOnProgress;
            progressCallback?.({
              type: "progress",
              ...progressData,
            });
          },

          onContent: (data) => {
            // 累积内容
            if (!progressData.contentByStage[data.stage]) {
              progressData.contentByStage[data.stage] = "";
            }
            progressData.contentByStage[data.stage] += data.content;

            // 调用来自 createData 的回调（如果存在）
            if (dataOnContent) {
              dataOnContent(data.content);
            }

            // 回调给UI
            const progressCallback = onProgress || dataOnProgress;
            progressCallback?.({
              type: "content",
              ...progressData,
            });
          },

          onComplete: (data) => {
            logger.info("[Store] ===== onComplete回调被触发 =====");
            logger.info("[Store] Complete data:", data);
            logger.info("[Store] Complete data.projectId:", data.projectId);
            logger.info(
              "[Store] Complete data.files length:",
              data.files?.length,
            );

            // 标记所有阶段完成
            progressData.stages.forEach((s) => (s.status = "completed"));
            progressData.metadata = data.metadata || {};
            progressData.logs.push({
              type: "success",
              message: `成功生成${data.files?.length || 0}个文件`,
              timestamp: Date.now(),
            });

            logger.info("[Store] 所有阶段已标记为completed");

            // 添加到项目列表
            if (data.projectId) {
              logger.info("[Store] 添加项目到列表");
              // 确保 projects 是数组
              if (!Array.isArray(this.projects)) {
                logger.warn("[Store] this.projects 不是数组，重置为空数组");
                this.projects = [];
              }
              this.projects.unshift({
                id: data.projectId,
                name: pureData.name || "未命名项目",
                project_type: pureData.type || "web",
                files: data.files || [],
                metadata: data.metadata,
                created_at: Date.now(),
                updated_at: Date.now(),
              });
              this.pagination.total++;
              logger.info(
                "[Store] 项目已添加，当前项目总数:",
                this.projects.length,
              );
            } else {
              logger.warn("[Store] 警告: data.projectId为空，未添加到列表");
            }

            // 调用来自 createData 的回调（如果存在）
            if (dataOnComplete) {
              dataOnComplete(data);
            }

            // 回调给UI
            logger.info("[Store] 调用onProgress回调，type=complete");
            const progressCallback = onProgress || dataOnProgress;
            progressCallback?.({
              type: "complete",
              ...progressData,
              result: data,
            });

            logger.info("[Store] 调用resolve，完成Promise");
            resolve(data);
            logger.info("[Store] ===== onComplete处理完毕 =====");
          },

          onError: (error) => {
            // 标记当前阶段失败
            const currentStage = progressData.stages.find(
              (s) => s.status === "running",
            );
            if (currentStage) {
              currentStage.status = "error";
            }
            progressData.logs.push({
              type: "error",
              message: error.message,
              timestamp: Date.now(),
            });

            // 调用来自 createData 的回调（如果存在）
            if (dataOnError) {
              dataOnError(error);
            }

            // 回调给UI
            const progressCallback = onProgress || dataOnProgress;
            progressCallback?.({
              type: "error",
              ...progressData,
              error: error.message,
            });

            reject(error);
          },
        };

        // 调用流式创建 - 只传递纯数据（不包含函数）
        logger.info(
          "[Store] 调用window.electronAPI.project.createStream，传递纯数据",
        );
        // BUGFIX: 深拷贝 pureData 确保移除所有响应式代理
        const serializedData = JSON.parse(JSON.stringify(pureData));
        window.electronAPI.project
          .createStream(serializedData, callbacks)
          .catch((err) => {
            logger.error("[Store] createStream Promise rejected:", err);
            reject(err);
          });
      });
    },

    /**
     * 取消流式创建
     */
    async cancelProjectStream() {
      await window.electronAPI.project.cancelStream();
    },

    /**
     * 获取项目详情
     * @param {string} projectId - 项目ID
     */
    async getProject(projectId) {
      this.loading = true;
      try {
        // 1. 从本地获取
        let project = await window.electronAPI.project.get(projectId);

        if (!project) {
          // 2. 从后端获取并缓存
          project =
            await window.electronAPI.project.fetchFromBackend(projectId);
        }

        this.currentProject = project;

        // 3. 加载项目文件
        await this.loadProjectFiles(projectId);

        return project;
      } catch (error) {
        logger.error("获取项目详情失败:", error);
        throw error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * 通过ID获取项目（别名）
     * @param {string} projectId - 项目ID
     */
    async fetchProjectById(projectId) {
      return this.getProject(projectId);
    },

    /**
     * 更新项目
     * @param {string} projectId - 项目ID
     * @param {Object} updates - 更新数据
     */
    async updateProject(projectId, updates) {
      try {
        // 1. 更新本地
        await window.electronAPI.project.update(projectId, updates);

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
        logger.error("更新项目失败:", error);
        throw error;
      }
    },

    /**
     * 删除项目
     * @param {string} projectId - 项目ID
     */
    async deleteProject(projectId) {
      try {
        // 删除项目（包含本地和后端）
        await window.electronAPI.project.delete(projectId);

        // 更新store
        this.projects = this.projects.filter((p) => p.id !== projectId);
        this.pagination.total--;

        if (this.currentProject?.id === projectId) {
          this.currentProject = null;
        }
      } catch (error) {
        logger.error("删除项目失败:", error);
        throw error;
      }
    },

    // ==================== 文件管理 ====================

    /**
     * 加载项目文件
     * @param {string} projectId - 项目ID
     */
    async loadProjectFiles(projectId) {
      const startTime = Date.now();
      logger.info("[Store] ========== loadProjectFiles 开始 ==========");
      logger.info("[Store] 项目ID:", projectId);
      logger.info("[Store] 当前文件数:", this.projectFiles.length);

      try {
        const files = await window.electronAPI.project.getFiles(projectId);
        const elapsed = Date.now() - startTime;

        logger.info("[Store] ✓ IPC 返回，耗时:", elapsed, "ms");
        logger.info("[Store] 接收文件数:", files?.length || 0);

        if (files && files.length > 0) {
          logger.info(
            "[Store] 前3个文件:",
            files
              .slice(0, 3)
              .map((f) => f.file_name)
              .join(", "),
          );
        }

        // 强制创建新数组引用，确保 Vue 响应式系统能检测到变化
        this.projectFiles = files ? [...files] : [];

        logger.info("[Store] ✓ projectFiles 已更新");
        logger.info("[Store] 新长度:", this.projectFiles.length);
        logger.info("[Store] 引用已改变: true");
        logger.info("[Store] 更新时间戳:", Date.now());
        logger.info("[Store] ========== loadProjectFiles 结束 ==========");

        return this.projectFiles;
      } catch (error) {
        logger.error("[Store] ========== loadProjectFiles 错误 ==========");
        logger.error("[Store] Error:", error);
        throw error;
      }
    },

    /**
     * 保存项目文件
     * @param {string} projectId - 项目ID
     * @param {Array} files - 文件列表
     */
    async saveProjectFiles(projectId, files) {
      try {
        await window.electronAPI.project.saveFiles(projectId, files);
        this.projectFiles = files;
      } catch (error) {
        logger.error("保存项目文件失败:", error);
        throw error;
      }
    },

    /**
     * 更新文件
     * @param {string} fileId - 文件ID
     * @param {string} content - 文件内容
     */
    async updateFile(fileId, content) {
      try {
        const updatedFile = {
          id: fileId,
          content,
          updated_at: Date.now(),
          version: (this.currentFile?.version || 0) + 1,
        };

        await window.electronAPI.project.updateFile(updatedFile);

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
        logger.error("更新文件失败:", error);
        throw error;
      }
    },

    /**
     * 设置当前文件
     * @param {Object} file - 文件对象
     */
    setCurrentFile(file) {
      this.currentFile = file;
    },

    /**
     * 切换文件夹展开状态
     * @param {string} folderPath - 文件夹路径
     */
    toggleFolderExpanded(folderPath) {
      const index = this.fileTreeExpanded.indexOf(folderPath);
      if (index > -1) {
        this.fileTreeExpanded.splice(index, 1);
      } else {
        this.fileTreeExpanded.push(folderPath);
      }
    },

    // ==================== 模板管理 ====================

    // ==================== 同步 ====================

    /**
     * 同步项目
     * @param {string} userId - 用户ID
     */
    async syncProjects(userId) {
      if (this.syncing) {
        return;
      }

      // 检查 API 是否可用
      if (!electronAPI?.project?.sync) {
        return;
      }

      this.syncing = true;
      this.syncError = null;

      try {
        await electronAPI.project.sync(userId);

        // 重新加载本地数据
        const response = await electronAPI.project.getAll(userId);
        // BUGFIX: IPC 返回的是 { projects: [], total: 0, hasMore: false }
        const localProjects = Array.isArray(response) ? response : (response.projects || []);
        this.projects = localProjects;
        this.pagination.total = response.total || localProjects.length;

        // 更新最后同步时间
        localStorage.setItem("project_last_sync", Date.now().toString());
      } catch (error) {
        // IPC 未就绪时静默处理
        if (error.message?.includes("No handler registered")) {
          // 静默忽略，等待 IPC 就绪
          return;
        }
        this.syncError = error.message;
        logger.error("[Project Store] 同步项目失败:", error);
      } finally {
        this.syncing = false;
      }
    },

    /**
     * 同步单个项目到后端
     * @param {string} projectId - 项目ID
     */
    async syncProjectToBackend(projectId) {
      try {
        await window.electronAPI.project.syncOne(projectId);
      } catch (error) {
        logger.error("同步项目到后端失败:", error);
      }
    },

    /**
     * 判断是否需要同步
     * @returns {boolean}
     */
    shouldSync() {
      // 超过5分钟自动同步
      try {
        const lastSync = localStorage.getItem("project_last_sync");
        if (!lastSync) {
          return true;
        }
        return Date.now() - parseInt(lastSync) > 5 * 60 * 1000;
      } catch (error) {
        logger.warn("[ProjectStore] 读取同步时间失败:", error.message);
        return true;
      }
    },

    // ==================== 筛选和视图 ====================

    /**
     * 设置筛选条件
     * @param {string} key - 筛选键
     * @param {*} value - 筛选值
     */
    setFilter(key, value) {
      this.filters[key] = value;
      this.pagination.current = 1; // 重置到第一页
    },

    /**
     * 重置筛选条件
     */
    resetFilters() {
      this.filters = {
        projectType: "",
        status: "",
        tags: [],
        searchKeyword: "",
      };
      this.pagination.current = 1;
    },

    /**
     * 设置排序
     * @param {string} sortBy - 排序字段
     * @param {string} sortOrder - 排序顺序
     */
    setSort(sortBy, sortOrder) {
      this.sortBy = sortBy;
      this.sortOrder = sortOrder;
    },

    /**
     * 设置视图模式
     * @param {string} mode - 视图模式
     */
    setViewMode(mode) {
      this.viewMode = mode;
      try {
        localStorage.setItem("project_view_mode", mode);
      } catch (error) {
        logger.warn("[ProjectStore] 保存视图模式失败:", error.message);
      }
    },

    /**
     * 设置分页
     * @param {number} current - 当前页
     * @param {number} pageSize - 每页数量
     */
    setPagination(current, pageSize) {
      this.pagination.current = current;
      if (pageSize) {
        this.pagination.pageSize = pageSize;
      }
    },

    // ==================== Git集成 ====================

    /**
     * 初始化Git仓库
     * @param {string} projectId - 项目ID
     * @param {string} remoteUrl - 远程仓库URL（可选）
     */
    async initGit(projectId, remoteUrl = null) {
      try {
        const project = this.projects.find((p) => p.id === projectId);
        if (!project?.root_path) {
          throw new Error("项目路径不存在");
        }

        await window.electronAPI.project.gitInit(project.root_path, remoteUrl);
      } catch (error) {
        logger.error("初始化Git失败:", error);
        throw error;
      }
    },

    /**
     * Git提交
     * @param {string} projectId - 项目ID
     * @param {string} message - 提交消息
     * @param {boolean} autoGenerate - 是否自动生成提交消息
     */
    async gitCommit(projectId, message, autoGenerate = false) {
      try {
        const project = this.projects.find((p) => p.id === projectId);
        if (!project?.root_path) {
          throw new Error("项目路径不存在");
        }

        await window.electronAPI.project.gitCommit(
          projectId,
          project.root_path,
          message,
          autoGenerate,
        );
      } catch (error) {
        logger.error("Git提交失败:", error);
        throw error;
      }
    },

    /**
     * Git推送
     * @param {string} projectId - 项目ID
     * @param {string} remote - 远程仓库名（默认origin）
     * @param {string} branch - 分支名（默认当前分支）
     */
    async gitPush(projectId, remote = "origin", branch = null) {
      try {
        const project = this.projects.find((p) => p.id === projectId);
        if (!project?.root_path) {
          throw new Error("项目路径不存在");
        }

        await window.electronAPI.project.gitPush(
          project.root_path,
          remote,
          branch,
        );
      } catch (error) {
        logger.error("Git推送失败:", error);
        throw error;
      }
    },

    /**
     * Git拉取
     * @param {string} projectId - 项目ID
     * @param {string} remote - 远程仓库名（默认origin）
     * @param {string} branch - 分支名（默认当前分支）
     */
    async gitPull(projectId, remote = "origin", branch = null) {
      try {
        const project = this.projects.find((p) => p.id === projectId);
        if (!project?.root_path) {
          throw new Error("项目路径不存在");
        }

        await window.electronAPI.project.gitPull(
          projectId,
          project.root_path,
          remote,
          branch,
        );

        // 重新加载文件
        await this.loadProjectFiles(projectId);
      } catch (error) {
        logger.error("Git拉取失败:", error);
        throw error;
      }
    },

    /**
     * 获取Git状态
     * @param {string} projectId - 项目ID
     */
    async gitStatus(projectId) {
      try {
        const project = this.projects.find((p) => p.id === projectId);
        if (!project?.root_path) {
          throw new Error("项目路径不存在");
        }

        return await window.electronAPI.project.gitStatus(project.root_path);
      } catch (error) {
        logger.error("获取Git状态失败:", error);
        throw error;
      }
    },

    // ==================== 辅助方法 ====================

    /**
     * 清空当前项目
     */
    clearCurrentProject() {
      this.currentProject = null;
      this.projectFiles = [];
      this.currentFile = null;
      this.fileTreeExpanded = [];
    },

    /**
     * 从localStorage恢复视图模式
     */
    restoreViewMode() {
      try {
        const savedMode = localStorage.getItem("project_view_mode");
        if (savedMode) {
          this.viewMode = savedMode;
        }
      } catch (error) {
        logger.warn("[ProjectStore] 恢复视图模式失败:", error.message);
      }
    },
  },
});
