/**
 * 字段映射工具
 * 用于本地 SQLite 与后端 PostgreSQL 之间的数据格式转换
 */
class FieldMapper {
  constructor() {
    // 定义每个表的必填字段（对应数据库的 NOT NULL 约束）
    this.requiredFields = {
      projects: ['id', 'user_id', 'name', 'project_type', 'created_at', 'updated_at'],
      project_files: ['id', 'project_id', 'file_path', 'file_name', 'created_at', 'updated_at'],
      knowledge_items: ['id', 'title', 'type', 'created_at', 'updated_at'],
      conversations: ['id', 'title', 'created_at', 'updated_at'],
      messages: ['id', 'conversation_id', 'role', 'content', 'created_at', 'updated_at'],
      project_collaborators: ['id', 'project_id', 'user_id', 'created_at'],
      project_comments: ['id', 'project_id', 'user_id', 'content', 'created_at'],
      project_tasks: ['id', 'project_id', 'title', 'created_at', 'updated_at']
    };
  }

  /**
   * 时间戳转换：毫秒 → ISO 8601
   */
  toISO8601(milliseconds) {
    return milliseconds ? new Date(milliseconds).toISOString() : null;
  }

  /**
   * 时间戳转换：ISO 8601 → 毫秒
   */
  toMillis(isoString) {
    return isoString ? new Date(isoString).getTime() : null;
  }

  /**
   * 验证记录是否包含所有必填字段
   * @param {Object} record - 待验证的记录
   * @param {string} tableName - 表名
   * @returns {Object} { valid: boolean, missingFields: string[] }
   */
  validateRequiredFields(record, tableName) {
    const requiredFields = this.requiredFields[tableName] || [];
    const missingFields = [];

    for (const field of requiredFields) {
      const value = record[field];
      if (value === null || value === undefined || value === '') {
        missingFields.push(field);
      }
    }

    return {
      valid: missingFields.length === 0,
      missingFields
    };
  }

  /**
   * 本地记录 → 后端格式
   */
  toBackend(localRecord, tableName) {
    const base = {
      id: localRecord.id,
      createdAt: this.toISO8601(localRecord.created_at),
      updatedAt: this.toISO8601(localRecord.updated_at),
    };

    switch (tableName) {
      case 'projects':
        return {
          ...base,
          userId: localRecord.user_id,
          name: localRecord.name,
          description: localRecord.description,
          projectType: localRecord.project_type,
          status: localRecord.status,
          rootPath: localRecord.root_path,
          fileCount: localRecord.file_count,
          totalSize: localRecord.total_size,
          syncStatus: localRecord.sync_status,
          syncedAt: this.toISO8601(localRecord.synced_at),
          deviceId: localRecord.device_id,
          deleted: localRecord.deleted || 0
        };

      case 'project_files':
        return {
          ...base,
          projectId: localRecord.project_id,
          filePath: localRecord.file_path,
          fileName: localRecord.file_name,
          fileType: localRecord.file_type,
          content: localRecord.content,
          contentHash: localRecord.content_hash,
          version: localRecord.version,
          syncStatus: localRecord.sync_status,
          deleted: localRecord.deleted || 0
        };

      case 'knowledge_items':
        return {
          ...base,
          title: localRecord.title,
          type: localRecord.type,
          content: localRecord.content,
          contentPath: localRecord.content_path,
          syncStatus: localRecord.sync_status,
          deviceId: localRecord.device_id
        };

      case 'conversations':
        return {
          ...base,
          title: localRecord.title,
          projectId: localRecord.project_id,
          contextType: localRecord.context_type,
          contextData: localRecord.context_data,
          syncStatus: localRecord.sync_status
        };

      case 'messages':
        return {
          ...base,
          conversationId: localRecord.conversation_id,
          role: localRecord.role,
          content: localRecord.content,
          timestamp: localRecord.timestamp,
          syncStatus: localRecord.sync_status
        };

      default:
        return base;
    }
  }

  /**
   * 后端格式 → 本地记录
   * @param {Object} backendRecord - 后端记录
   * @param {string} tableName - 表名
   * @param {Object} options - 转换选项
   * @param {Object} options.existingRecord - 已存在的本地记录（用于保留本地状态）
   * @param {boolean} options.preserveLocalStatus - 是否保留本地同步状态（默认false）
   * @param {string} options.forceSyncStatus - 强制设置的同步状态（优先级最高）
   */
  toLocal(backendRecord, tableName, options = {}) {
    const {
      existingRecord = null,
      preserveLocalStatus = false,
      forceSyncStatus = null
    } = options;

    // 决定同步状态
    let syncStatus;
    let syncedAt;

    if (forceSyncStatus) {
      // 强制指定的状态（最高优先级）
      syncStatus = forceSyncStatus;
      syncedAt = Date.now();
    } else if (preserveLocalStatus && existingRecord) {
      // 保留本地状态（用于更新场景）
      syncStatus = existingRecord.sync_status || 'synced';
      syncedAt = existingRecord.synced_at || Date.now();
    } else {
      // 默认：新记录或强制同步
      syncStatus = 'synced';
      syncedAt = Date.now();
    }

    const base = {
      id: backendRecord.id,
      created_at: this.toMillis(backendRecord.createdAt),
      updated_at: this.toMillis(backendRecord.updatedAt),
      synced_at: syncedAt,
      sync_status: syncStatus
    };

    switch (tableName) {
      case 'projects':
        return {
          ...base,
          user_id: backendRecord.userId,
          name: backendRecord.name,
          description: backendRecord.description,
          project_type: backendRecord.projectType,
          status: backendRecord.status,
          root_path: backendRecord.rootPath,
          file_count: backendRecord.fileCount,
          total_size: backendRecord.totalSize,
          device_id: backendRecord.deviceId,
          deleted: backendRecord.deleted || 0
        };

      case 'project_files':
        return {
          ...base,
          project_id: backendRecord.projectId,
          file_path: backendRecord.filePath,
          file_name: backendRecord.fileName,
          file_type: backendRecord.fileType,
          content: backendRecord.content,
          content_hash: backendRecord.contentHash,
          version: backendRecord.version,
          deleted: backendRecord.deleted || 0
        };

      case 'knowledge_items':
        return {
          ...base,
          title: backendRecord.title,
          type: backendRecord.type,
          content: backendRecord.content,
          content_path: backendRecord.contentPath,
          device_id: backendRecord.deviceId
        };

      case 'conversations':
        return {
          ...base,
          title: backendRecord.title,
          project_id: backendRecord.projectId,
          context_type: backendRecord.contextType,
          context_data: backendRecord.contextData
        };

      case 'messages':
        return {
          ...base,
          conversation_id: backendRecord.conversationId,
          role: backendRecord.role,
          content: backendRecord.content,
          timestamp: backendRecord.timestamp
        };

      default:
        return base;
    }
  }

  /**
   * 将后端记录转换为本地记录（新记录场景）
   * 明确标记为synced状态
   */
  toLocalAsNew(backendRecord, tableName) {
    return this.toLocal(backendRecord, tableName, {
      forceSyncStatus: 'synced'
    });
  }

  /**
   * 将后端记录转换为本地记录（更新场景）
   * 保留本地的同步状态
   */
  toLocalForUpdate(backendRecord, tableName, existingRecord) {
    return this.toLocal(backendRecord, tableName, {
      existingRecord,
      preserveLocalStatus: true
    });
  }

  /**
   * 将后端记录转换为本地记录（冲突标记）
   * 标记为conflict状态
   */
  toLocalAsConflict(backendRecord, tableName) {
    return this.toLocal(backendRecord, tableName, {
      forceSyncStatus: 'conflict'
    });
  }
}

module.exports = FieldMapper;
