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

                // 转换时间戳为毫秒
                record.put("createdAt", toMillis(createdAt));
                record.put("updatedAt", toMillis(updatedAt));

                if (deleted != null && deleted == 1) {
                    // 已删除的记录
                    response.getDeletedIds().add((String) record.get("id"));
                    stats.setDeletedCount(stats.getDeletedCount() + 1);
                } else if (toMillis(createdAt) > lastSyncedAt) {
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

    private boolean upsertProject(Map<String, Object> record, String deviceId) {
        // TODO: 实现具体的插入或更新逻辑
        // 这里需要检测冲突并处理
        return false;
    }

    private boolean upsertProjectFile(Map<String, Object> record, String deviceId) {
        return false;
    }

    private boolean upsertProjectConversation(Map<String, Object> record, String deviceId) {
        return false;
    }

    private boolean upsertProjectTask(Map<String, Object> record, String deviceId) {
        return false;
    }

    private boolean upsertProjectCollaborator(Map<String, Object> record, String deviceId) {
        return false;
    }

    private boolean upsertProjectComment(Map<String, Object> record, String deviceId) {
        return false;
    }

    private int countPendingRecords(String tableName, String deviceId) {
        // TODO: 查询待同步记录数
        return 0;
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
