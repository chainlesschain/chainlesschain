/**
 * File Store - 文件管理
 * 负责文件上传、下载、共享、版本控制等功能
 */

import { logger } from '@/utils/logger';
import { defineStore } from 'pinia';
import { ref, computed, type Ref, type ComputedRef } from 'vue';
import { message } from 'ant-design-vue';
import { useIdentityStore } from './identityStore';

// ==================== 类型定义 ====================

/**
 * 文件锁定状态
 */
export type FileLockStatus = 'unlocked' | 'locked' | 'exclusive';

/**
 * 文件类型
 */
export type FileType =
  | 'document'
  | 'image'
  | 'video'
  | 'audio'
  | 'archive'
  | 'code'
  | 'spreadsheet'
  | 'presentation'
  | 'other';

/**
 * 文件
 */
export interface ProjectFile {
  id: string;
  name: string;
  file_type: FileType;
  size: number;
  path: string;
  hash?: string;
  project_id?: string;
  org_id?: string;
  workspace_id?: string;
  created_by: string;
  lock_status: FileLockStatus;
  locked_by?: string;
  locked_at?: number;
  lock_expires_at?: number;
  version: number;
  created_at: number;
  updated_at: number;
  [key: string]: any;
}

/**
 * 文件版本
 */
export interface FileVersion {
  id: string;
  file_id: string;
  version: number;
  size: number;
  hash: string;
  created_by: string;
  comment?: string;
  created_at: number;
}

/**
 * 文件共享
 */
export interface FileShare {
  id: string;
  file_id: string;
  shared_by: string;
  shared_with: string;
  permission: 'view' | 'edit' | 'admin';
  expires_at?: number;
  created_at: number;
}

/**
 * 文件上传数据
 */
export interface FileUploadData {
  name: string;
  path: string;
  project_id?: string;
  org_id?: string;
  workspace_id?: string;
  content?: ArrayBuffer | string;
  [key: string]: any;
}

/**
 * 文件共享数据
 */
export interface FileShareData {
  file_id: string;
  shared_with: string;
  permission: 'view' | 'edit' | 'admin';
  expires_at?: number;
}

/**
 * 文件筛选条件
 */
export interface FileFilters {
  project_id: string | null;
  org_id: string | null;
  workspace_id: string | null;
  file_type: FileType | null;
  locked: boolean | null;
}

/**
 * 上传进度
 */
export interface UploadProgress {
  [fileId: string]: number;
}

/**
 * 按类型分组的文件
 */
export interface FilesByType {
  [key: string]: ProjectFile[];
}

/**
 * 文件统计
 */
export interface FileStats {
  total: number;
  locked: number;
  shared: number;
  byType: Record<string, number>;
}

/**
 * IPC 结果
 */
interface IpcResult<T = any> {
  success: boolean;
  files?: ProjectFile[];
  file?: ProjectFile;
  versions?: FileVersion[];
  share?: FileShare;
  error?: string;
}

// ==================== Store ====================

export const useFileStore = defineStore('file', () => {
  // ==================== State ====================

  // 文件列表
  const files: Ref<ProjectFile[]> = ref([]);

  // 当前查看的文件
  const currentFile: Ref<ProjectFile | null> = ref(null);

  // 文件版本列表
  const currentFileVersions: Ref<FileVersion[]> = ref([]);

  // 共享文件列表
  const sharedFiles: Ref<ProjectFile[]> = ref([]);

  // 上传进度
  const uploadProgress: Ref<UploadProgress> = ref({});

  // 加载状态
  const loading: Ref<boolean> = ref(false);

  // 文件详情对话框可见性
  const fileDetailVisible: Ref<boolean> = ref(false);

  // 版本查看器可见性
  const versionViewerVisible: Ref<boolean> = ref(false);

  // 筛选条件
  const filters: Ref<FileFilters> = ref({
    project_id: null,
    org_id: null,
    workspace_id: null,
    file_type: null,
    locked: null,
  });

  // ==================== Getters ====================

  /**
   * 按类型分组的文件
   */
  const filesByType: ComputedRef<FilesByType> = computed(() => {
    const groups: FilesByType = {};

    files.value.forEach((file) => {
      if (!groups[file.file_type]) {
        groups[file.file_type] = [];
      }
      groups[file.file_type].push(file);
    });

    return groups;
  });

  /**
   * 锁定的文件
   */
  const lockedFiles: ComputedRef<ProjectFile[]> = computed(() => {
    return files.value.filter((f) => f.lock_status !== 'unlocked');
  });

  /**
   * 我锁定的文件
   */
  const myLockedFiles: ComputedRef<ProjectFile[]> = computed(() => {
    const identityStore = useIdentityStore();
    const currentUserDID = identityStore.currentUserDID;
    if (!currentUserDID) {
      return lockedFiles.value;
    }
    return lockedFiles.value.filter((f) => f.locked_by === currentUserDID);
  });

  /**
   * 文件统计
   */
  const fileStats: ComputedRef<FileStats> = computed(() => {
    return {
      total: files.value.length,
      locked: lockedFiles.value.length,
      shared: sharedFiles.value.length,
      byType: Object.keys(filesByType.value).reduce(
        (acc, type) => {
          acc[type] = filesByType.value[type].length;
          return acc;
        },
        {} as Record<string, number>
      ),
    };
  });

  // ==================== Actions ====================

  /**
   * 加载文件列表
   */
  async function loadFiles(queryFilters: Partial<FileFilters> = {}): Promise<void> {
    loading.value = true;

    try {
      const result: IpcResult = await (window as any).ipc.invoke('file:list', {
        filters: {
          ...filters.value,
          ...queryFilters,
        },
      });

      if (result.success) {
        files.value = result.files || [];
        logger.info('[FileStore] 文件列表加载成功', files.value.length);
      } else {
        message.error(`加载文件列表失败: ${result.error}`);
      }
    } catch (error) {
      message.error('加载文件列表异常');
      logger.error('[FileStore] 加载文件列表异常:', error as any);
    } finally {
      loading.value = false;
    }
  }

  /**
   * 上传文件
   */
  async function uploadFile(fileData: FileUploadData): Promise<ProjectFile | null> {
    loading.value = true;

    try {
      const result: IpcResult = await (window as any).ipc.invoke('file:upload', {
        fileData,
      });

      if (result.success) {
        message.success('文件上传成功');
        logger.info('[FileStore] 文件上传成功:', result.file);

        // 重新加载文件列表
        await loadFiles();

        return result.file || null;
      } else {
        message.error(`上传文件失败: ${result.error}`);
        return null;
      }
    } catch (error) {
      message.error('上传文件异常');
      logger.error('[FileStore] 上传文件异常:', error as any);
      return null;
    } finally {
      loading.value = false;
    }
  }

  /**
   * 删除文件
   */
  async function deleteFile(fileId: string): Promise<boolean> {
    loading.value = true;

    try {
      const result: IpcResult = await (window as any).ipc.invoke('file:delete', {
        fileId,
      });

      if (result.success) {
        message.success('文件已删除');

        // 从列表中移除
        const index = files.value.findIndex((f) => f.id === fileId);
        if (index !== -1) {
          files.value.splice(index, 1);
        }

        // 如果删除的是当前文件，关闭详情
        if (currentFile.value?.id === fileId) {
          currentFile.value = null;
          fileDetailVisible.value = false;
        }

        return true;
      } else {
        message.error(`删除文件失败: ${result.error}`);
        return false;
      }
    } catch (error) {
      message.error('删除文件异常');
      logger.error('[FileStore] 删除文件异常:', error as any);
      return false;
    } finally {
      loading.value = false;
    }
  }

  /**
   * 锁定文件
   */
  async function lockFile(fileId: string, expiresIn: number = 3600000): Promise<boolean> {
    try {
      const result: IpcResult = await (window as any).ipc.invoke('file:lock', {
        fileId,
        expiresIn,
      });

      if (result.success) {
        message.success('文件已锁定');
        await loadFiles();
        return true;
      } else {
        message.error(`锁定文件失败: ${result.error}`);
        return false;
      }
    } catch (error) {
      message.error('锁定文件异常');
      logger.error('[FileStore] 锁定文件异常:', error as any);
      return false;
    }
  }

  /**
   * 解锁文件
   */
  async function unlockFile(fileId: string): Promise<boolean> {
    try {
      const result: IpcResult = await (window as any).ipc.invoke('file:unlock', {
        fileId,
      });

      if (result.success) {
        message.success('文件已解锁');
        await loadFiles();
        return true;
      } else {
        message.error(`解锁文件失败: ${result.error}`);
        return false;
      }
    } catch (error) {
      message.error('解锁文件异常');
      logger.error('[FileStore] 解锁文件异常:', error as any);
      return false;
    }
  }

  /**
   * 加载文件版本列表
   */
  async function loadFileVersions(fileId: string): Promise<void> {
    try {
      const result: IpcResult = await (window as any).ipc.invoke('file:versions', {
        fileId,
      });

      if (result.success) {
        currentFileVersions.value = result.versions || [];
        logger.info('[FileStore] 版本列表加载成功', currentFileVersions.value.length);
      } else {
        message.error(`加载版本列表失败: ${result.error}`);
      }
    } catch (error) {
      message.error('加载版本列表异常');
      logger.error('[FileStore] 加载版本列表异常:', error as any);
    }
  }

  /**
   * 回滚到指定版本
   */
  async function rollbackToVersion(fileId: string, targetVersion: number): Promise<boolean> {
    loading.value = true;

    try {
      const result: IpcResult = await (window as any).ipc.invoke('file:rollback', {
        fileId,
        targetVersion,
      });

      if (result.success) {
        message.success(`已回滚到版本 v${targetVersion}`);
        await loadFiles();
        await loadFileVersions(fileId);
        return true;
      } else {
        message.error(`回滚失败: ${result.error}`);
        return false;
      }
    } catch (error) {
      message.error('回滚异常');
      logger.error('[FileStore] 回滚异常:', error as any);
      return false;
    } finally {
      loading.value = false;
    }
  }

  /**
   * 共享文件
   */
  async function shareFile(shareData: FileShareData): Promise<FileShare | null> {
    try {
      const result: IpcResult = await (window as any).ipc.invoke('file:share', {
        shareData,
      });

      if (result.success) {
        message.success('文件已共享');
        return result.share || null;
      } else {
        message.error(`共享失败: ${result.error}`);
        return null;
      }
    } catch (error) {
      message.error('共享异常');
      logger.error('[FileStore] 共享异常:', error as any);
      return null;
    }
  }

  /**
   * 加载共享文件列表
   */
  async function loadSharedFiles(orgId: string): Promise<void> {
    loading.value = true;

    try {
      const result: IpcResult = await (window as any).ipc.invoke('file:sharedFiles', {
        orgId,
      });

      if (result.success) {
        sharedFiles.value = result.files || [];
        logger.info('[FileStore] 共享文件加载成功', sharedFiles.value.length);
      } else {
        message.error(`加载共享文件失败: ${result.error}`);
      }
    } catch (error) {
      message.error('加载共享文件异常');
      logger.error('[FileStore] 加载共享文件异常:', error as any);
    } finally {
      loading.value = false;
    }
  }

  /**
   * 打开文件详情
   */
  async function openFileDetail(fileId: string): Promise<void> {
    try {
      const result: IpcResult = await (window as any).ipc.invoke('file:detail', {
        fileId,
      });

      if (result.success) {
        currentFile.value = result.file || null;
        fileDetailVisible.value = true;

        // 同时加载版本列表
        await loadFileVersions(fileId);
      } else {
        message.error(`加载文件详情失败: ${result.error}`);
      }
    } catch (error) {
      message.error('加载文件详情异常');
      logger.error('[FileStore] 加载文件详情异常:', error as any);
    }
  }

  /**
   * 关闭文件详情
   */
  function closeFileDetail(): void {
    fileDetailVisible.value = false;
    currentFile.value = null;
    currentFileVersions.value = [];
  }

  /**
   * 更新筛选条件
   */
  function updateFilters(newFilters: Partial<FileFilters>): void {
    filters.value = {
      ...filters.value,
      ...newFilters,
    };
    loadFiles();
  }

  /**
   * 清除筛选条件
   */
  function clearFilters(): void {
    filters.value = {
      project_id: null,
      org_id: null,
      workspace_id: null,
      file_type: null,
      locked: null,
    };
    loadFiles();
  }

  /**
   * 重置Store
   */
  function reset(): void {
    files.value = [];
    currentFile.value = null;
    currentFileVersions.value = [];
    sharedFiles.value = [];
    uploadProgress.value = {};
    loading.value = false;
    fileDetailVisible.value = false;
    versionViewerVisible.value = false;
    filters.value = {
      project_id: null,
      org_id: null,
      workspace_id: null,
      file_type: null,
      locked: null,
    };
  }

  // ==================== 返回 ====================

  return {
    // State
    files,
    currentFile,
    currentFileVersions,
    sharedFiles,
    uploadProgress,
    loading,
    fileDetailVisible,
    versionViewerVisible,
    filters,

    // Getters
    filesByType,
    lockedFiles,
    myLockedFiles,
    fileStats,

    // Actions
    loadFiles,
    uploadFile,
    deleteFile,
    lockFile,
    unlockFile,
    loadFileVersions,
    rollbackToVersion,
    shareFile,
    loadSharedFiles,
    openFileDetail,
    closeFileDetail,
    updateFilters,
    clearFilters,
    reset,
  };
});
