/**
 * 字段映射工具
 * 用于本地 SQLite 与后端 PostgreSQL 之间的数据格式转换
 */
class FieldMapper {
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
   */
  toLocal(backendRecord, tableName) {
    const base = {
      id: backendRecord.id,
      created_at: this.toMillis(backendRecord.createdAt),
      updated_at: this.toMillis(backendRecord.updatedAt),
      synced_at: Date.now(),
      sync_status: 'synced'
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
}

module.exports = FieldMapper;
