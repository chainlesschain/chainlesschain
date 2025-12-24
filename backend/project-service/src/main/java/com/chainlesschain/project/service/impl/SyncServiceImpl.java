package com.chainlesschain.project.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.chainlesschain.project.dto.ConflictResolutionDTO;
import com.chainlesschain.project.dto.SyncRequestDTO;
import com.chainlesschain.project.dto.SyncResponseDTO;
import com.chainlesschain.project.entity.*;
import com.chainlesschain.project.mapper.*;
import com.chainlesschain.project.service.SyncService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.*;

/**
 * 数据同步服务实现
 */
@Slf4j
@Service
public class SyncServiceImpl implements SyncService {

    @Autowired
    private ProjectMapper projectMapper;

    @Autowired
    private ProjectFileMapper projectFileMapper;

    @Autowired
    private ProjectConversationMapper projectConversationMapper;

    @Autowired
    private ProjectTaskMapper projectTaskMapper;

    @Autowired
    private ProjectCollaboratorMapper projectCollaboratorMapper;

    @Autowired
    private ProjectCommentMapper projectCommentMapper;

    @Autowired(required = false)
    private SyncLogMapper syncLogMapper;

    @Override
    @Transactional
    public Map<String, Object> uploadBatch(SyncRequestDTO request) {
        long startTime = System.currentTimeMillis();
        log.info("[SyncService] 开始批量上传: table={}, deviceId={}, records={}",
            request.getTableName(), request.getDeviceId(), request.getRecords().size());

        int successCount = 0;
        int failedCount = 0;
        int conflictCount = 0;
        List<Map<String, Object>> conflicts = new ArrayList<>();

        for (Map<String, Object> record : request.getRecords()) {
            try {
                // 根据表名选择对应的Mapper进行插入或更新
                boolean hasConflict = insertOrUpdateRecord(request.getTableName(), record, request.getDeviceId());

                if (hasConflict && !request.getForceOverwrite()) {
                    conflictCount++;
                    conflicts.add(record);
                } else {
                    successCount++;
                    // 记录同步日志
                    logSync(request.getTableName(), (String) record.get("id"),
                        "upload", "success", request.getDeviceId(), null);
                }
            } catch (Exception e) {
                log.error("[SyncService] 上传记录失败: id={}, error={}", record.get("id"), e.getMessage());
                failedCount++;
                logSync(request.getTableName(), (String) record.get("id"),
                    "upload", "failed", request.getDeviceId(), e.getMessage());
            }
        }

        long executionTime = System.currentTimeMillis() - startTime;
        log.info("[SyncService] 批量上传完成: success={}, failed={}, conflict={}, time={}ms",
            successCount, failedCount, conflictCount, executionTime);

        Map<String, Object> result = new HashMap<>();
        result.put("successCount", successCount);
        result.put("failedCount", failedCount);
        result.put("conflictCount", conflictCount);
        result.put("conflicts", conflicts);
        result.put("executionTimeMs", executionTime);

        return result;
    }

    @Override
    public SyncResponseDTO downloadIncremental(String tableName, Long lastSyncedAt, String deviceId) {
        long startTime = System.currentTimeMillis();
        log.info("[SyncService] 开始增量下载: table={}, lastSyncedAt={}, deviceId={}",
            tableName, lastSyncedAt, deviceId);

        SyncResponseDTO response = new SyncResponseDTO();
        SyncResponseDTO.SyncStats stats = new SyncResponseDTO.SyncStats();

        // 将毫秒时间戳转换为LocalDateTime
        LocalDateTime lastSyncTime = lastSyncedAt == null || lastSyncedAt == 0
            ? LocalDateTime.of(1970, 1, 1, 0, 0)
            : LocalDateTime.ofInstant(
                java.time.Instant.ofEpochMilli(lastSyncedAt),
                ZoneId.systemDefault()
            );

        try {
            // 根据表名查询增量数据
            List<Map<String, Object>> records = queryIncrementalData(tableName, lastSyncTime, deviceId);

            for (Map<String, Object> record : records) {
                Integer deleted = (Integer) record.get("deleted");
                LocalDateTime createdAt = (LocalDateTime) record.get("createdAt");
                LocalDateTime updatedAt = (LocalDateTime) record.get("updatedAt");

                // 转换时间戳为毫秒（安全处理 null 值）
                Long createdAtMillis = toMillis(createdAt);
                Long updatedAtMillis = toMillis(updatedAt);

                record.put("createdAt", createdAtMillis != null ? createdAtMillis : 0L);
                record.put("updatedAt", updatedAtMillis != null ? updatedAtMillis : 0L);

                if (deleted != null && deleted == 1) {
                    // 已删除的记录
                    response.getDeletedIds().add((String) record.get("id"));
                    stats.setDeletedCount(stats.getDeletedCount() + 1);
                } else if (createdAtMillis != null && createdAtMillis > lastSyncedAt) {
                    // 新增记录
                    response.getNewRecords().add(record);
                    stats.setNewCount(stats.getNewCount() + 1);
                } else {
                    // 更新记录
                    response.getUpdatedRecords().add(record);
                    stats.setUpdatedCount(stats.getUpdatedCount() + 1);
                }
            }

            response.setServerTimestamp(System.currentTimeMillis());
            stats.setExecutionTimeMs(System.currentTimeMillis() - startTime);
            response.setStats(stats);

            log.info("[SyncService] 增量下载完成: new={}, updated={}, deleted={}, time={}ms",
                stats.getNewCount(), stats.getUpdatedCount(), stats.getDeletedCount(),
                stats.getExecutionTimeMs());

        } catch (Exception e) {
            log.error("[SyncService] 增量下载失败: {}", e.getMessage(), e);
            throw new RuntimeException("增量下载失败: " + e.getMessage());
        }

        return response;
    }

    @Override
    public Map<String, Object> getSyncStatus(String deviceId) {
        log.info("[SyncService] 获取同步状态: deviceId={}", deviceId);

        Map<String, Object> status = new HashMap<>();
        status.put("deviceId", deviceId);
        status.put("serverTime", System.currentTimeMillis());

        // 统计各表的待同步数量
        Map<String, Integer> pendingCounts = new HashMap<>();
        pendingCounts.put("projects", countPendingRecords("projects", deviceId));
        pendingCounts.put("project_files", countPendingRecords("project_files", deviceId));
        pendingCounts.put("project_conversations", countPendingRecords("project_conversations", deviceId));
        pendingCounts.put("project_tasks", countPendingRecords("project_tasks", deviceId));
        pendingCounts.put("project_collaborators", countPendingRecords("project_collaborators", deviceId));
        pendingCounts.put("project_comments", countPendingRecords("project_comments", deviceId));

        status.put("pendingCounts", pendingCounts);
        status.put("isOnline", true);

        return status;
    }

    @Override
    @Transactional
    public void resolveConflict(ConflictResolutionDTO resolution) {
        log.info("[SyncService] 解决冲突: conflictId={}, resolution={}",
            resolution.getConflictId(), resolution.getResolution());

        // 根据解决策略更新数据
        if ("manual".equals(resolution.getResolution()) && resolution.getMergedData() != null) {
            insertOrUpdateRecord(resolution.getTableName(), resolution.getMergedData(), resolution.getDeviceId());
        }

        // 记录冲突解决日志
        logSync(resolution.getTableName(), resolution.getRecordId(),
            "resolve_conflict", "success", resolution.getDeviceId(),
            "Resolution: " + resolution.getResolution());
    }

    // ==================== 私有辅助方法 ====================

    /**
     * 插入或更新记录
     *
     * @return true 如果检测到冲突
     */
    private boolean insertOrUpdateRecord(String tableName, Map<String, Object> record, String deviceId) {
        String id = (String) record.get("id");

        // 根据表名选择对应的操作
        switch (tableName) {
            case "projects":
                return upsertProject(record, deviceId);
            case "project_files":
                return upsertProjectFile(record, deviceId);
            case "project_conversations":
                return upsertProjectConversation(record, deviceId);
            case "project_tasks":
                return upsertProjectTask(record, deviceId);
            case "project_collaborators":
                return upsertProjectCollaborator(record, deviceId);
            case "project_comments":
                return upsertProjectComment(record, deviceId);
            default:
                throw new IllegalArgumentException("不支持的表: " + tableName);
        }
    }

    /**
     * 查询增量数据
     */
    private List<Map<String, Object>> queryIncrementalData(String tableName, LocalDateTime lastSyncTime, String deviceId) {
        // 这里需要使用MyBatis的动态SQL或者直接JDBC查询
        // 简化实现：只查询updatedAt > lastSyncTime的记录

        switch (tableName) {
            case "projects":
                QueryWrapper<Project> projectWrapper = new QueryWrapper<>();
                projectWrapper.gt("updated_at", lastSyncTime);
                return projectMapper.selectMaps(projectWrapper);

            case "project_files":
                QueryWrapper<ProjectFile> fileWrapper = new QueryWrapper<>();
                fileWrapper.gt("updated_at", lastSyncTime);
                return projectFileMapper.selectMaps(fileWrapper);

            case "project_conversations":
                QueryWrapper<ProjectConversation> convWrapper = new QueryWrapper<>();
                convWrapper.gt("created_at", lastSyncTime);
                return projectConversationMapper.selectMaps(convWrapper);

            case "project_tasks":
                QueryWrapper<ProjectTask> taskWrapper = new QueryWrapper<>();
                taskWrapper.gt("updated_at", lastSyncTime);
                return projectTaskMapper.selectMaps(taskWrapper);

            case "project_collaborators":
                QueryWrapper<ProjectCollaborator> collabWrapper = new QueryWrapper<>();
                collabWrapper.gt("updated_at", lastSyncTime);
                return projectCollaboratorMapper.selectMaps(collabWrapper);

            case "project_comments":
                QueryWrapper<ProjectComment> commentWrapper = new QueryWrapper<>();
                commentWrapper.gt("updated_at", lastSyncTime);
                return projectCommentMapper.selectMaps(commentWrapper);

            default:
                return new ArrayList<>();
        }
    }

    /**
     * 插入或更新 Project 记录
     * @return true 如果检测到冲突
     */
    private boolean upsertProject(Map<String, Object> record, String deviceId) {
        String id = (String) record.get("id");
        Project existing = projectMapper.selectById(id);

        // 将 Map 转换为 LocalDateTime
        LocalDateTime clientUpdatedAt = parseDateTime(record.get("updatedAt"));

        // 检测冲突
        if (existing != null) {
            LocalDateTime serverUpdatedAt = existing.getUpdatedAt();
            // 如果服务器端数据更新且不是同一个设备，则存在冲突
            if (serverUpdatedAt != null && clientUpdatedAt != null &&
                serverUpdatedAt.isAfter(clientUpdatedAt) &&
                !deviceId.equals(existing.getDeviceId())) {
                log.warn("[SyncService] 检测到 Project 冲突: id={}, serverTime={}, clientTime={}",
                    id, serverUpdatedAt, clientUpdatedAt);
                return true;
            }
        }

        // 构建 Project 实体
        Project project = new Project();
        project.setId(id);
        project.setUserId((String) record.get("userId"));
        project.setName((String) record.get("name"));
        project.setDescription((String) record.get("description"));
        project.setProjectType((String) record.get("projectType"));
        project.setStatus((String) record.get("status"));
        project.setRootPath((String) record.get("rootPath"));
        project.setFileCount(getLong(record.get("fileCount")));
        project.setTotalSize(getLong(record.get("totalSize")));
        project.setCreatedAt(parseDateTime(record.get("createdAt")));
        project.setUpdatedAt(clientUpdatedAt);
        project.setSyncStatus("synced");
        project.setSyncedAt(LocalDateTime.now());
        project.setDeviceId(deviceId);
        project.setDeleted(getInteger(record.get("deleted")));

        // 执行插入或更新
        if (existing == null) {
            projectMapper.insert(project);
            log.debug("[SyncService] 插入新 Project: id={}", id);
        } else {
            projectMapper.updateById(project);
            log.debug("[SyncService] 更新 Project: id={}", id);
        }

        return false;
    }

    /**
     * 插入或更新 ProjectFile 记录
     */
    private boolean upsertProjectFile(Map<String, Object> record, String deviceId) {
        String id = (String) record.get("id");
        ProjectFile existing = projectFileMapper.selectById(id);

        LocalDateTime clientUpdatedAt = parseDateTime(record.get("updatedAt"));

        // 检测冲突
        if (existing != null) {
            LocalDateTime serverUpdatedAt = existing.getUpdatedAt();
            if (serverUpdatedAt != null && clientUpdatedAt != null &&
                serverUpdatedAt.isAfter(clientUpdatedAt) &&
                !deviceId.equals(existing.getDeviceId())) {
                log.warn("[SyncService] 检测到 ProjectFile 冲突: id={}", id);
                return true;
            }
        }

        // 构建 ProjectFile 实体
        ProjectFile file = new ProjectFile();
        file.setId(id);
        file.setProjectId((String) record.get("projectId"));
        file.setFilePath((String) record.get("filePath"));
        file.setFileName((String) record.get("fileName"));
        file.setFileType((String) record.get("fileType"));
        file.setContent((String) record.get("content"));
        file.setContentHash((String) record.get("contentHash"));
        file.setVersion(getInteger(record.get("version")));
        file.setCreatedAt(parseDateTime(record.get("createdAt")));
        file.setUpdatedAt(clientUpdatedAt);
        file.setSyncStatus("synced");
        file.setSyncedAt(LocalDateTime.now());
        file.setDeviceId(deviceId);

        if (existing == null) {
            projectFileMapper.insert(file);
            log.debug("[SyncService] 插入新 ProjectFile: id={}", id);
        } else {
            projectFileMapper.updateById(file);
            log.debug("[SyncService] 更新 ProjectFile: id={}", id);
        }

        return false;
    }

    /**
     * 插入或更新 ProjectConversation 记录
     */
    private boolean upsertProjectConversation(Map<String, Object> record, String deviceId) {
        String id = (String) record.get("id");
        ProjectConversation existing = projectConversationMapper.selectById(id);

        LocalDateTime clientCreatedAt = parseDateTime(record.get("createdAt"));

        // 对话记录一般不会冲突（只插入不更新），但为了一致性也检查
        if (existing != null) {
            log.debug("[SyncService] ProjectConversation 已存在，跳过: id={}", id);
            return false;
        }

        // 构建 ProjectConversation 实体
        ProjectConversation conversation = new ProjectConversation();
        conversation.setId(id);
        conversation.setProjectId((String) record.get("projectId"));
        conversation.setTitle((String) record.get("title"));
        conversation.setContext((String) record.get("context"));
        conversation.setCreatedAt(clientCreatedAt);
        conversation.setSyncStatus("synced");
        conversation.setSyncedAt(LocalDateTime.now());
        conversation.setDeviceId(deviceId);

        projectConversationMapper.insert(conversation);
        log.debug("[SyncService] 插入新 ProjectConversation: id={}", id);

        return false;
    }

    /**
     * 插入或更新 ProjectTask 记录
     */
    private boolean upsertProjectTask(Map<String, Object> record, String deviceId) {
        String id = (String) record.get("id");
        ProjectTask existing = projectTaskMapper.selectById(id);

        LocalDateTime clientUpdatedAt = parseDateTime(record.get("updatedAt"));

        // 检测冲突
        if (existing != null) {
            LocalDateTime serverUpdatedAt = existing.getUpdatedAt();
            if (serverUpdatedAt != null && clientUpdatedAt != null &&
                serverUpdatedAt.isAfter(clientUpdatedAt) &&
                !deviceId.equals(existing.getDeviceId())) {
                log.warn("[SyncService] 检测到 ProjectTask 冲突: id={}", id);
                return true;
            }
        }

        // 构建 ProjectTask 实体
        ProjectTask task = new ProjectTask();
        task.setId(id);
        task.setProjectId((String) record.get("projectId"));
        task.setTitle((String) record.get("title"));
        task.setDescription((String) record.get("description"));
        task.setStatus((String) record.get("status"));
        task.setPriority((String) record.get("priority"));
        task.setAssignee((String) record.get("assignee"));
        task.setDueDate(parseDateTime(record.get("dueDate")));
        task.setCreatedAt(parseDateTime(record.get("createdAt")));
        task.setUpdatedAt(clientUpdatedAt);
        task.setSyncStatus("synced");
        task.setSyncedAt(LocalDateTime.now());
        task.setDeviceId(deviceId);

        if (existing == null) {
            projectTaskMapper.insert(task);
            log.debug("[SyncService] 插入新 ProjectTask: id={}", id);
        } else {
            projectTaskMapper.updateById(task);
            log.debug("[SyncService] 更新 ProjectTask: id={}", id);
        }

        return false;
    }

    /**
     * 插入或更新 ProjectCollaborator 记录
     */
    private boolean upsertProjectCollaborator(Map<String, Object> record, String deviceId) {
        String id = (String) record.get("id");
        ProjectCollaborator existing = projectCollaboratorMapper.selectById(id);

        LocalDateTime clientUpdatedAt = parseDateTime(record.get("updatedAt"));

        // 检测冲突
        if (existing != null) {
            LocalDateTime serverUpdatedAt = existing.getUpdatedAt();
            if (serverUpdatedAt != null && clientUpdatedAt != null &&
                serverUpdatedAt.isAfter(clientUpdatedAt) &&
                !deviceId.equals(existing.getDeviceId())) {
                log.warn("[SyncService] 检测到 ProjectCollaborator 冲突: id={}", id);
                return true;
            }
        }

        // 构建 ProjectCollaborator 实体
        ProjectCollaborator collaborator = new ProjectCollaborator();
        collaborator.setId(id);
        collaborator.setProjectId((String) record.get("projectId"));
        collaborator.setUserId((String) record.get("userId"));
        collaborator.setRole((String) record.get("role"));
        collaborator.setPermissions((String) record.get("permissions"));
        collaborator.setCreatedAt(parseDateTime(record.get("createdAt")));
        collaborator.setUpdatedAt(clientUpdatedAt);
        collaborator.setSyncStatus("synced");
        collaborator.setSyncedAt(LocalDateTime.now());
        collaborator.setDeviceId(deviceId);

        if (existing == null) {
            projectCollaboratorMapper.insert(collaborator);
            log.debug("[SyncService] 插入新 ProjectCollaborator: id={}", id);
        } else {
            projectCollaboratorMapper.updateById(collaborator);
            log.debug("[SyncService] 更新 ProjectCollaborator: id={}", id);
        }

        return false;
    }

    /**
     * 插入或更新 ProjectComment 记录
     */
    private boolean upsertProjectComment(Map<String, Object> record, String deviceId) {
        String id = (String) record.get("id");
        ProjectComment existing = projectCommentMapper.selectById(id);

        LocalDateTime clientUpdatedAt = parseDateTime(record.get("updatedAt"));

        // 检测冲突
        if (existing != null) {
            LocalDateTime serverUpdatedAt = existing.getUpdatedAt();
            if (serverUpdatedAt != null && clientUpdatedAt != null &&
                serverUpdatedAt.isAfter(clientUpdatedAt) &&
                !deviceId.equals(existing.getDeviceId())) {
                log.warn("[SyncService] 检测到 ProjectComment 冲突: id={}", id);
                return true;
            }
        }

        // 构建 ProjectComment 实体
        ProjectComment comment = new ProjectComment();
        comment.setId(id);
        comment.setProjectId((String) record.get("projectId"));
        comment.setUserId((String) record.get("userId"));
        comment.setContent((String) record.get("content"));
        comment.setParentId((String) record.get("parentId"));
        comment.setCreatedAt(parseDateTime(record.get("createdAt")));
        comment.setUpdatedAt(clientUpdatedAt);
        comment.setSyncStatus("synced");
        comment.setSyncedAt(LocalDateTime.now());
        comment.setDeviceId(deviceId);

        if (existing == null) {
            projectCommentMapper.insert(comment);
            log.debug("[SyncService] 插入新 ProjectComment: id={}", id);
        } else {
            projectCommentMapper.updateById(comment);
            log.debug("[SyncService] 更新 ProjectComment: id={}", id);
        }

        return false;
    }

    /**
     * 统计待同步记录数
     */
    private int countPendingRecords(String tableName, String deviceId) {
        try {
            switch (tableName) {
                case "projects":
                    QueryWrapper<Project> projectWrapper = new QueryWrapper<>();
                    projectWrapper.eq("sync_status", "pending")
                                  .or()
                                  .isNull("sync_status");
                    return Math.toIntExact(projectMapper.selectCount(projectWrapper));

                case "project_files":
                    QueryWrapper<ProjectFile> fileWrapper = new QueryWrapper<>();
                    fileWrapper.eq("sync_status", "pending")
                               .or()
                               .isNull("sync_status");
                    return Math.toIntExact(projectFileMapper.selectCount(fileWrapper));

                case "project_conversations":
                    QueryWrapper<ProjectConversation> convWrapper = new QueryWrapper<>();
                    convWrapper.eq("sync_status", "pending")
                               .or()
                               .isNull("sync_status");
                    return Math.toIntExact(projectConversationMapper.selectCount(convWrapper));

                case "project_tasks":
                    QueryWrapper<ProjectTask> taskWrapper = new QueryWrapper<>();
                    taskWrapper.eq("sync_status", "pending")
                               .or()
                               .isNull("sync_status");
                    return Math.toIntExact(projectTaskMapper.selectCount(taskWrapper));

                case "project_collaborators":
                    QueryWrapper<ProjectCollaborator> collabWrapper = new QueryWrapper<>();
                    collabWrapper.eq("sync_status", "pending")
                                 .or()
                                 .isNull("sync_status");
                    return Math.toIntExact(projectCollaboratorMapper.selectCount(collabWrapper));

                case "project_comments":
                    QueryWrapper<ProjectComment> commentWrapper = new QueryWrapper<>();
                    commentWrapper.eq("sync_status", "pending")
                                  .or()
                                  .isNull("sync_status");
                    return Math.toIntExact(projectCommentMapper.selectCount(commentWrapper));

                default:
                    return 0;
            }
        } catch (Exception e) {
            log.error("[SyncService] 统计待同步记录失败: table={}, error={}", tableName, e.getMessage());
            return 0;
        }
    }

    // ==================== 辅助转换方法 ====================

    /**
     * 解析日期时间（支持毫秒时间戳和ISO字符串）
     */
    private LocalDateTime parseDateTime(Object value) {
        if (value == null) {
            return null;
        }

        if (value instanceof LocalDateTime) {
            return (LocalDateTime) value;
        }

        if (value instanceof Long) {
            return LocalDateTime.ofInstant(
                java.time.Instant.ofEpochMilli((Long) value),
                ZoneId.systemDefault()
            );
        }

        if (value instanceof Integer) {
            return LocalDateTime.ofInstant(
                java.time.Instant.ofEpochMilli(((Integer) value).longValue()),
                ZoneId.systemDefault()
            );
        }

        if (value instanceof String) {
            try {
                // 尝试解析 ISO 8601 格式
                return LocalDateTime.parse((String) value);
            } catch (Exception e) {
                // 尝试作为时间戳解析
                try {
                    long timestamp = Long.parseLong((String) value);
                    return LocalDateTime.ofInstant(
                        java.time.Instant.ofEpochMilli(timestamp),
                        ZoneId.systemDefault()
                    );
                } catch (NumberFormatException ex) {
                    log.warn("[SyncService] 无法解析日期时间: {}", value);
                    return null;
                }
            }
        }

        return null;
    }

    /**
     * 获取 Integer 值
     */
    private Integer getInteger(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof Integer) {
            return (Integer) value;
        }
        if (value instanceof Long) {
            return ((Long) value).intValue();
        }
        if (value instanceof String) {
            try {
                return Integer.parseInt((String) value);
            } catch (NumberFormatException e) {
                return null;
            }
        }
        return null;
    }

    /**
     * 获取 Long 值
     */
    private Long getLong(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof Long) {
            return (Long) value;
        }
        if (value instanceof Integer) {
            return ((Integer) value).longValue();
        }
        if (value instanceof String) {
            try {
                return Long.parseLong((String) value);
            } catch (NumberFormatException e) {
                return null;
            }
        }
        return null;
    }

    private void logSync(String tableName, String recordId, String operation,
                        String status, String deviceId, String errorMessage) {
        if (syncLogMapper == null) return;

        SyncLog log = new SyncLog();
        log.setTableName(tableName);
        log.setRecordId(recordId);
        log.setOperation(operation);
        log.setDirection("upload");
        log.setStatus(status);
        log.setDeviceId(deviceId);
        log.setErrorMessage(errorMessage);

        syncLogMapper.insert(log);
    }

    private Long toMillis(LocalDateTime dateTime) {
        if (dateTime == null) return null;
        return dateTime.atZone(ZoneId.systemDefault()).toInstant().toEpochMilli();
    }
}
