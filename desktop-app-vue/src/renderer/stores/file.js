import { logger, createLogger } from '@/utils/logger';
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { message } from 'ant-design-vue';

/**
 * 文件管理Store - Phase 2
 * 负责文件上传、下载、共享、版本控制等功能
 */
export const useFileStore = defineStore('file', () => {
  // ==================== State ====================

  // 文件列表
  const files = ref([]);

  // 当前查看的文件
  const currentFile = ref(null);

  // 文件版本列表
  const currentFileVersions = ref([]);

  // 共享文件列表
  const sharedFiles = ref([]);

  // 上传进度
  const uploadProgress = ref({});

  // 加载状态
  const loading = ref(false);

  // 文件详情对话框可见性
  const fileDetailVisible = ref(false);

  // 版本查看器可见性
  const versionViewerVisible = ref(false);

  // 筛选条件
  const filters = ref({
    project_id: null,
    org_id: null,
    workspace_id: null,
    file_type: null,
    locked: null
  });

  // ==================== Getters ====================

  /**
   * 按类型分组的文件
   */
  const filesByType = computed(() => {
    const groups = {};

    files.value.forEach(file => {
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
  const lockedFiles = computed(() => {
    return files.value.filter(f => f.lock_status !== 'unlocked');
  });

  /**
   * 我锁定的文件
   */
  const myLockedFiles = computed(() => {
    // TODO: 获取当前用户DID
    return lockedFiles.value; // .filter(f => f.locked_by === currentUserDID);
  });

  /**
   * 文件统计
   */
  const fileStats = computed(() => {
    return {
      total: files.value.length,
      locked: lockedFiles.value.length,
      shared: sharedFiles.value.length,
      byType: Object.keys(filesByType.value).reduce((acc, type) => {
        acc[type] = filesByType.value[type].length;
        return acc;
      }, {})
    };
  });

  // ==================== Actions ====================

  /**
   * 加载文件列表
   */
  async function loadFiles(queryFilters = {}) {
    loading.value = true;

    try {
      const result = await window.ipc.invoke('file:list', {
        filters: {
          ...filters.value,
          ...queryFilters
        }
      });

      if (result.success) {
        files.value = result.files || [];
        logger.info('[FileStore] 文件列表加载成功', files.value.length);
      } else {
        message.error(`加载文件列表失败: ${result.error}`);
      }
    } catch (error) {
      message.error('加载文件列表异常');
      logger.error('[FileStore] 加载文件列表异常:', error);
    } finally {
      loading.value = false;
    }
  }

  /**
   * 上传文件
   */
  async function uploadFile(fileData) {
    loading.value = true;

    try {
      const result = await window.ipc.invoke('file:upload', {
        fileData
      });

      if (result.success) {
        message.success('文件上传成功');
        logger.info('[FileStore] 文件上传成功:', result.file);

        // 重新加载文件列表
        await loadFiles();

        return result.file;
      } else {
        message.error(`上传文件失败: ${result.error}`);
        return null;
      }
    } catch (error) {
      message.error('上传文件异常');
      logger.error('[FileStore] 上传文件异常:', error);
      return null;
    } finally {
      loading.value = false;
    }
  }

  /**
   * 删除文件
   */
  async function deleteFile(fileId) {
    loading.value = true;

    try {
      const result = await window.ipc.invoke('file:delete', {
        fileId
      });

      if (result.success) {
        message.success('文件已删除');

        // 从列表中移除
        const index = files.value.findIndex(f => f.id === fileId);
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
      logger.error('[FileStore] 删除文件异常:', error);
      return false;
    } finally {
      loading.value = false;
    }
  }

  /**
   * 锁定文件
   */
  async function lockFile(fileId, expiresIn = 3600000) {
    try {
      const result = await window.ipc.invoke('file:lock', {
        fileId,
        expiresIn
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
      logger.error('[FileStore] 锁定文件异常:', error);
      return false;
    }
  }

  /**
   * 解锁文件
   */
  async function unlockFile(fileId) {
    try {
      const result = await window.ipc.invoke('file:unlock', {
        fileId
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
      logger.error('[FileStore] 解锁文件异常:', error);
      return false;
    }
  }

  /**
   * 加载文件版本列表
   */
  async function loadFileVersions(fileId) {
    try {
      const result = await window.ipc.invoke('file:versions', {
        fileId
      });

      if (result.success) {
        currentFileVersions.value = result.versions || [];
        logger.info('[FileStore] 版本列表加载成功', currentFileVersions.value.length);
      } else {
        message.error(`加载版本列表失败: ${result.error}`);
      }
    } catch (error) {
      message.error('加载版本列表异常');
      logger.error('[FileStore] 加载版本列表异常:', error);
    }
  }

  /**
   * 回滚到指定版本
   */
  async function rollbackToVersion(fileId, targetVersion) {
    loading.value = true;

    try {
      const result = await window.ipc.invoke('file:rollback', {
        fileId,
        targetVersion
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
      logger.error('[FileStore] 回滚异常:', error);
      return false;
    } finally {
      loading.value = false;
    }
  }

  /**
   * 共享文件
   */
  async function shareFile(shareData) {
    try {
      const result = await window.ipc.invoke('file:share', {
        shareData
      });

      if (result.success) {
        message.success('文件已共享');
        return result.share;
      } else {
        message.error(`共享失败: ${result.error}`);
        return null;
      }
    } catch (error) {
      message.error('共享异常');
      logger.error('[FileStore] 共享异常:', error);
      return null;
    }
  }

  /**
   * 加载共享文件列表
   */
  async function loadSharedFiles(orgId) {
    loading.value = true;

    try {
      const result = await window.ipc.invoke('file:sharedFiles', {
        orgId
      });

      if (result.success) {
        sharedFiles.value = result.files || [];
        logger.info('[FileStore] 共享文件加载成功', sharedFiles.value.length);
      } else {
        message.error(`加载共享文件失败: ${result.error}`);
      }
    } catch (error) {
      message.error('加载共享文件异常');
      logger.error('[FileStore] 加载共享文件异常:', error);
    } finally {
      loading.value = false;
    }
  }

  /**
   * 打开文件详情
   */
  async function openFileDetail(fileId) {
    try {
      const result = await window.ipc.invoke('file:detail', {
        fileId
      });

      if (result.success) {
        currentFile.value = result.file;
        fileDetailVisible.value = true;

        // 同时加载版本列表
        await loadFileVersions(fileId);
      } else {
        message.error(`加载文件详情失败: ${result.error}`);
      }
    } catch (error) {
      message.error('加载文件详情异常');
      logger.error('[FileStore] 加载文件详情异常:', error);
    }
  }

  /**
   * 关闭文件详情
   */
  function closeFileDetail() {
    fileDetailVisible.value = false;
    currentFile.value = null;
    currentFileVersions.value = [];
  }

  /**
   * 更新筛选条件
   */
  function updateFilters(newFilters) {
    filters.value = {
      ...filters.value,
      ...newFilters
    };
    loadFiles();
  }

  /**
   * 清除筛选条件
   */
  function clearFilters() {
    filters.value = {
      project_id: null,
      org_id: null,
      workspace_id: null,
      file_type: null,
      locked: null
    };
    loadFiles();
  }

  /**
   * 重置Store
   */
  function reset() {
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
      locked: null
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
    reset
  };
});
