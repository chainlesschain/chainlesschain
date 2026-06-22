package com.chainlesschain.project.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.chainlesschain.project.dto.ConflictResolutionDTO;
import com.chainlesschain.project.dto.SyncRequestDTO;
import com.chainlesschain.project.dto.SyncResponseDTO;
import com.chainlesschain.project.entity.*;
import com.chainlesschain.project.mapper.*;
import com.chainlesschain.project.security.ProjectAccessGuard;
import com.chainlesschain.project.service.SyncService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.*;
import java.util.concurrent.TimeUnit;

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

    @Autowired
    private ConversationMapper conversationMapper;

    @Autowired
    private ConversationMessageMapper conversationMessageMapper;

    @Autowired
    private KnowledgeItemMapper knowledgeItemMapper;

    @Autowired(required = true)
    private SyncLogMapper syncLogMapper;

    @Autowired
    private ProjectAccessGuard accessGuard;

    @Autowired(required = false)
    private RedisTemplate<String, Object> redisTemplate;

    private final TransactionTemplate requiresNewTransactionTemplate;

    // 构造函数，创建独立事务的 TransactionTemplate
    public SyncServiceImpl(PlatformTransactionManager transactionManager) {
        this.requiresNewTransactionTemplate = new TransactionTemplate(transactionManager);
        // 设置为 REQUIRES_NEW，确保每次都创建新事务
        this.requiresNewTransactionTemplate.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    @Override
    public Map<String, Object> uploadBatch(SyncRequestDTO request, Authentication authentication) {
        long startTime = System.currentTimeMillis();
        String requestId = request.getRequestId();

        // 幂等性保护：检查是否已处理过此请求
        if (requestId != null && redisTemplate != null) {
            String cacheKey = "sync:request:" + requestId;
            Object cachedResult = redisTemplate.opsForValue().get(cacheKey);

            if (cachedResult != null) {
                log.info("[SyncService] 检测到重复请求，返回缓存结果: requestId={}, table={}",
                    requestId, request.getTableName());
                @SuppressWarnings("unchecked")
                Map<String, Object> result = (Map<String, Object>) cachedResult;
                return result;
            }
        }

        log.info("[SyncService] 开始批量上传: table={}, deviceId={}, requestId={}, records={}",
            request.getTableName(), request.getDeviceId(), requestId, request.getRecords().size());

        int successCount = 0;
        int failedCount = 0;
        int conflictCount = 0;
        int deniedCount = 0;
        List<Map<String, Object>> conflicts = new ArrayList<>();

        // 写授权（IDOR 修复 #7 上传侧）：此前 upload 完全无写授权——任意已认证设备凭 id
        // 即可经 updateById 覆盖<b>他人</b>的记录（projects/files/tasks/collaborators/
        // comments/conversations/knowledge）。现按调用方身份限定覆盖：若服务器已存在同 id 的
        // 记录且其归属不在调用方可访问范围内，则拒绝该条覆盖（绝不改他人数据）。新增记录
        // （服务器无同 id）保持放行，避免破坏合法的新建数据同步；dev-mode（未认证 permitAll）
        // 保持旧的无授权行为。
        boolean enforce = accessGuard != null && accessGuard.isCallerAuthenticated(authentication);
        Set<String> ids = enforce ? accessGuard.callerIdentities(authentication) : null;
        Set<String> projectIds = enforce ? accessGuard.accessibleProjectIds(authentication) : null;

        for (Map<String, Object> record : request.getRecords()) {
            String recordId = (String) record.get("id");
            // 拦截跨用户覆盖：仅当服务器已存在同 id 且归属不在调用方范围内时拒绝
            if (enforce && existingOwnerOutOfScope(request.getTableName(), recordId, ids, projectIds)) {
                deniedCount++;
                log.warn("[SyncService] 拒绝跨用户覆盖: table={}, id={}, caller={}",
                    request.getTableName(), recordId, authentication.getName());
                try {
                    logSyncInNewTransaction(request.getTableName(), recordId, "upload", "denied",
                        request.getDeviceId(), "cross-user overwrite blocked");
                } catch (Exception ignore) {
                    // 审计日志失败不影响拒绝结果
                }
                continue;
            }
            try {
                // 每条记录在独立的新事务中处理（REQUIRES_NEW）
                Boolean hasConflict = requiresNewTransactionTemplate.execute(status -> {
                    try {
                        return insertOrUpdateRecord(request.getTableName(), record, request.getDeviceId());
                    } catch (Exception e) {
                        // 标记事务回滚
                        status.setRollbackOnly();
                        throw e;
                    }
                });

                if (hasConflict != null && hasConflict && !request.getForceOverwrite()) {
                    conflictCount++;
                    conflicts.add(record);
                } else {
                    successCount++;
                    // 记录同步日志（独立事务，REQUIRES_NEW）
                    logSyncInNewTransaction(request.getTableName(), (String) record.get("id"),
                        "upload", "success", request.getDeviceId(), null);
                }
            } catch (Exception e) {
                log.error("[SyncService] 上传记录失败: id={}, error={}", record.get("id"), e.getMessage());
                failedCount++;
                // 记录失败日志（独立事务，REQUIRES_NEW）
                logSyncInNewTransaction(request.getTableName(), (String) record.get("id"),
                    "upload", "failed", request.getDeviceId(), e.getMessage());
            }
        }

        long executionTime = System.currentTimeMillis() - startTime;
        log.info("[SyncService] 批量上传完成: success={}, failed={}, conflict={}, denied={}, time={}ms",
            successCount, failedCount, conflictCount, deniedCount, executionTime);

        Map<String, Object> result = new HashMap<>();
        result.put("successCount", successCount);
        result.put("failedCount", failedCount);
        result.put("conflictCount", conflictCount);
        result.put("deniedCount", deniedCount);
        result.put("conflicts", conflicts);
        result.put("executionTimeMs", executionTime);

        // 缓存处理结果（24小时过期），用于幂等性保护
        if (requestId != null && redisTemplate != null) {
            String cacheKey = "sync:request:" + requestId;
            try {
                redisTemplate.opsForValue().set(cacheKey, result, 24, TimeUnit.HOURS);
                log.debug("[SyncService] 已缓存请求结果: requestId={}, key={}", requestId, cacheKey);
            } catch (Exception e) {
                log.warn("[SyncService] 缓存请求结果失败: requestId={}, error={}", requestId, e.getMessage());
                // 缓存失败不影响业务流程，继续执行
            }
        }

        return result;
    }

    /**
     * 在独立事务中处理单条记录（使用 REQUIRES_NEW 事务）
     */
    public boolean processRecordInTransaction(String tableName, Map<String, Object> record, String deviceId) {
        Boolean result = requiresNewTransactionTemplate.execute(status -> {
            try {
                return insertOrUpdateRecord(tableName, record, deviceId);
            } catch (Exception e) {
                status.setRollbackOnly();
                throw e;
            }
        });
        return result != null && result;
    }

    /**
     * 在独立事务中记录同步日志（使用 REQUIRES_NEW 事务，完全独立）
     * 日志记录失败会抛出异常，确保同步操作的可追溯性
     */
    public void logSyncInNewTransaction(String tableName, String recordId, String operation,
                                        String status, String deviceId, String errorMessage) {
        // 在新事务中执行日志记录（REQUIRES_NEW - 完全独立的事务）
        try {
            requiresNewTransactionTemplate.execute(txStatus -> {
                SyncLog syncLog = new SyncLog();
                syncLog.setTableName(tableName);
                syncLog.setRecordId(recordId);
                syncLog.setOperation(operation);
                syncLog.setDirection("upload");
                syncLog.setStatus(status);
                syncLog.setDeviceId(deviceId);
                syncLog.setErrorMessage(errorMessage);
                // createdAt and updatedAt are auto-filled by MyBatis Plus

                int inserted = syncLogMapper.insert(syncLog);

                if (inserted == 0) {
                    throw new RuntimeException("日志插入返回0行，可能插入失败");
                }

                log.debug("[SyncService] 同步日志已记录: table={}, recordId={}, operation={}, status={}",
                    tableName, recordId, operation, status);

                return null;
            });
        } catch (Exception e) {
            log.error("[SyncService] 同步日志记录失败，中止操作: table={}, recordId={}, error={}",
                tableName, recordId, e.getMessage(), e);

            // 抛出异常，确保调用方知道日志记录失败
            throw new RuntimeException(
                String.format("同步日志记录失败: table=%s, recordId=%s, error=%s",
                    tableName, recordId, e.getMessage()),
                e
            );
        }
    }

    @Override
    public SyncResponseDTO downloadIncremental(String tableName, Long lastSyncedAt, String deviceId,
                                               Authentication authentication) {
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
        // null is a supported "full sync from epoch" input (see above); derive a
        // primitive for the millisecond comparison below so it doesn't NPE when
        // auto-unboxing a null Long for the first non-deleted record.
        long lastSyncedMillis = lastSyncedAt == null ? 0L : lastSyncedAt;

        try {
            // 根据表名查询增量数据
            List<Map<String, Object>> records = queryIncrementalData(tableName, lastSyncTime, deviceId, authentication);

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
                } else if (createdAtMillis != null && createdAtMillis > lastSyncedMillis) {
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
        pendingCounts.put("conversations", countPendingRecords("conversations", deviceId));
        pendingCounts.put("messages", countPendingRecords("messages", deviceId));
        pendingCounts.put("knowledge_items", countPendingRecords("knowledge_items", deviceId));

        status.put("pendingCounts", pendingCounts);
        status.put("isOnline", true);

        return status;
    }

    @Override
    public void resolveConflict(ConflictResolutionDTO resolution, Authentication authentication) {
        log.info("[SyncService] 解决冲突: conflictId={}, resolution={}",
            resolution.getConflictId(), resolution.getResolution());

        try {
            // 根据解决策略更新数据（独立事务）
            if ("manual".equals(resolution.getResolution()) && resolution.getMergedData() != null) {
                // 写授权（IDOR 修复 #7）：冲突解决端点同为写入路径，按上传侧同口径防跨用户覆盖。
                boolean enforce = accessGuard != null && accessGuard.isCallerAuthenticated(authentication);
                if (enforce) {
                    Set<String> ids = accessGuard.callerIdentities(authentication);
                    Set<String> projectIds = accessGuard.accessibleProjectIds(authentication);
                    String recordId = (String) resolution.getMergedData().get("id");
                    if (existingOwnerOutOfScope(resolution.getTableName(), recordId, ids, projectIds)) {
                        log.warn("[SyncService] 拒绝经冲突解决跨用户覆盖: table={}, id={}, caller={}",
                            resolution.getTableName(), recordId, authentication.getName());
                        throw new org.springframework.security.access.AccessDeniedException(
                            "无权覆盖该记录");
                    }
                }
                processRecordInTransaction(resolution.getTableName(), resolution.getMergedData(), resolution.getDeviceId());
            }

            // 记录冲突解决日志（独立事务）
            logSyncInNewTransaction(resolution.getTableName(), resolution.getRecordId(),
                "resolve_conflict", "success", resolution.getDeviceId(),
                "Resolution: " + resolution.getResolution());
        } catch (Exception e) {
            log.error("[SyncService] 解决冲突失败: conflictId={}, error={}",
                resolution.getConflictId(), e.getMessage());
            // 记录失败日志
            logSyncInNewTransaction(resolution.getTableName(), resolution.getRecordId(),
                "resolve_conflict", "failed", resolution.getDeviceId(), e.getMessage());
            throw new RuntimeException("解决冲突失败: " + e.getMessage());
        }
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
            case "conversations":
                return upsertConversation(record, deviceId);
            case "messages":
                return upsertMessage(record, deviceId);
            case "knowledge_items":
                return upsertKnowledgeItem(record, deviceId);
            default:
                throw new IllegalArgumentException("不支持的表: " + tableName);
        }
    }

    /**
     * 查询增量数据
     */
    private List<Map<String, Object>> queryIncrementalData(String tableName, LocalDateTime lastSyncTime,
                                                           String deviceId, Authentication authentication) {
        // 简化实现：查询 updatedAt/createdAt > lastSyncTime 的记录。
        //
        // 授权（IDOR 修复）：此前 download 只按时间戳过滤、无任何归属过滤，任意已认证用户凭
        // deviceId 即可拉取<b>所有用户</b>的原始数据行。现按调用方身份强制限定：用户自有数据
        // 按 callerIdentities（user_id/owner_did），项目相关数据按 accessibleProjectIds
        // （project_id），消息按调用方可访问对话 id；调用方无可访问范围时返回空（绝不返回
        // 他人数据）。dev-mode（未认证 permitAll）保持旧的无过滤行为。
        boolean enforce = accessGuard != null && accessGuard.isCallerAuthenticated(authentication);
        Set<String> ids = enforce ? accessGuard.callerIdentities(authentication) : null;
        Set<String> projectIds = enforce ? accessGuard.accessibleProjectIds(authentication) : null;

        switch (tableName) {
            case "projects": {
                QueryWrapper<Project> w = new QueryWrapper<>();
                w.gt("updated_at", lastSyncTime);
                if (enforce) {
                    w.and(q -> q.in("user_id", ids).or().in("owner_did", ids));
                }
                return projectMapper.selectMaps(w);
            }

            case "project_files": {
                if (enforce && projectIds.isEmpty()) return new ArrayList<>();
                QueryWrapper<ProjectFile> w = new QueryWrapper<>();
                w.gt("updated_at", lastSyncTime);
                if (enforce) w.in("project_id", projectIds);
                return projectFileMapper.selectMaps(w);
            }

            case "project_conversations": {
                if (enforce && projectIds.isEmpty()) return new ArrayList<>();
                QueryWrapper<ProjectConversation> w = new QueryWrapper<>();
                w.gt("created_at", lastSyncTime);
                if (enforce) w.in("project_id", projectIds);
                return projectConversationMapper.selectMaps(w);
            }

            case "project_tasks": {
                if (enforce && projectIds.isEmpty()) return new ArrayList<>();
                QueryWrapper<ProjectTask> w = new QueryWrapper<>();
                w.gt("updated_at", lastSyncTime);
                if (enforce) w.in("project_id", projectIds);
                return projectTaskMapper.selectMaps(w);
            }

            case "project_collaborators": {
                QueryWrapper<ProjectCollaborator> w = new QueryWrapper<>();
                w.gt("updated_at", lastSyncTime);
                if (enforce) {
                    w.and(q -> {
                        q.in("user_id", ids);
                        if (!projectIds.isEmpty()) q.or().in("project_id", projectIds);
                    });
                }
                return projectCollaboratorMapper.selectMaps(w);
            }

            case "project_comments": {
                QueryWrapper<ProjectComment> w = new QueryWrapper<>();
                w.gt("updated_at", lastSyncTime);
                if (enforce) {
                    w.and(q -> {
                        q.in("user_id", ids);
                        if (!projectIds.isEmpty()) q.or().in("project_id", projectIds);
                    });
                }
                return projectCommentMapper.selectMaps(w);
            }

            case "conversations": {
                QueryWrapper<Conversation> w = new QueryWrapper<>();
                w.gt("updated_at", lastSyncTime);
                if (enforce) {
                    w.and(q -> {
                        q.in("user_id", ids);
                        if (!projectIds.isEmpty()) q.or().in("project_id", projectIds);
                    });
                }
                return conversationMapper.selectMaps(w);
            }

            case "messages": {
                QueryWrapper<ConversationMessage> w = new QueryWrapper<>();
                w.gt("created_at", lastSyncTime);
                if (enforce) {
                    Set<String> convIds = callerConversationIds(ids, projectIds);
                    if (convIds.isEmpty()) return new ArrayList<>();
                    w.in("conversation_id", convIds);
                }
                return conversationMessageMapper.selectMaps(w);
            }

            case "knowledge_items": {
                QueryWrapper<KnowledgeItem> w = new QueryWrapper<>();
                w.gt("updated_at", lastSyncTime);
                if (enforce) w.in("user_id", ids);
                return knowledgeItemMapper.selectMaps(w);
            }

            default:
                return new ArrayList<>();
        }
    }

    /** 调用方可访问的全部对话 id（自有 user_id 或可访问 project_id）——用于限定消息下载。 */
    private Set<String> callerConversationIds(Set<String> ids, Set<String> projectIds) {
        QueryWrapper<Conversation> w = new QueryWrapper<>();
        w.in("user_id", ids);
        if (projectIds != null && !projectIds.isEmpty()) {
            w.or().in("project_id", projectIds);
        }
        Set<String> result = new HashSet<>();
        for (Conversation c : conversationMapper.selectList(w)) {
            if (c.getId() != null) result.add(c.getId());
        }
        return result;
    }

    /**
     * 上传写授权（#7）：判断「服务器已存在的同 id 记录」是否归属在调用方可访问范围<b>之外</b>。
     * 返回 true 表示该记录归属他人 → 调用方无权覆盖（拒绝写入）。
     * 服务器无同 id 记录（新增）返回 false —— 新增不在此拦截，避免破坏合法新建数据同步。
     * 各表归属判定与下载侧 {@link #queryIncrementalData} 完全对称：
     * 用户自有数据按 {user_id/owner_did}，项目相关数据按 project_id，消息/项目会话为只插入
     * （永不覆盖）故不在此拦截。
     */
    private boolean existingOwnerOutOfScope(String tableName, String id,
                                           Set<String> ids, Set<String> projectIds) {
        if (id == null || ids == null || projectIds == null) {
            return false;
        }
        switch (tableName) {
            case "projects": {
                Project e = projectMapper.selectById(id);
                if (e == null) return false;
                return !(has(ids,e.getUserId()) || has(ids,e.getOwnerDid()));
            }
            case "project_files": {
                ProjectFile e = projectFileMapper.selectById(id);
                if (e == null) return false;
                return !has(projectIds,e.getProjectId());
            }
            case "project_tasks": {
                ProjectTask e = projectTaskMapper.selectById(id);
                if (e == null) return false;
                return !has(projectIds,e.getProjectId());
            }
            case "project_collaborators": {
                ProjectCollaborator e = projectCollaboratorMapper.selectById(id);
                if (e == null) return false;
                return !(has(projectIds,e.getProjectId()) || has(ids,e.getUserId()));
            }
            case "project_comments": {
                ProjectComment e = projectCommentMapper.selectById(id);
                if (e == null) return false;
                return !(has(projectIds,e.getProjectId()) || has(ids,e.getUserId()));
            }
            case "conversations": {
                Conversation e = conversationMapper.selectById(id);
                if (e == null) return false;
                return !(has(ids,e.getUserId()) || has(projectIds,e.getProjectId()));
            }
            case "knowledge_items": {
                KnowledgeItem e = knowledgeItemMapper.selectById(id);
                if (e == null) return false;
                return !has(ids,e.getUserId());
            }
            // messages / project_conversations 为只插入（upsert 命中已存在即跳过，不覆盖）→ 无覆盖风险
            default:
                return false;
        }
    }

    /** Null-safe membership test (entity owner fields may be null; some Set impls reject contains(null)). */
    private static boolean has(Set<String> set, String value) {
        return value != null && set.contains(value);
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
     * 插入或更新 ProjectFile 记录（带乐观锁版本控制）
     */
    private boolean upsertProjectFile(Map<String, Object> record, String deviceId) {
        String id = (String) record.get("id");
        ProjectFile existing = projectFileMapper.selectById(id);

        Integer clientVersion = getInteger(record.get("version"));
        LocalDateTime clientUpdatedAt = parseDateTime(record.get("updatedAt"));

        // 检测冲突
        if (existing != null) {
            Integer serverVersion = existing.getVersion();
            LocalDateTime serverUpdatedAt = existing.getUpdatedAt();

            // 版本号冲突检测
            if (serverVersion != null && clientVersion != null && serverVersion > clientVersion) {
                log.warn("[SyncService] 检测到 ProjectFile 版本冲突: id={}, serverVer={}, clientVer={}",
                    id, serverVersion, clientVersion);
                return true;
            }

            // 时间戳冲突检测（备用）
            if (serverUpdatedAt != null && clientUpdatedAt != null &&
                serverUpdatedAt.isAfter(clientUpdatedAt) &&
                !deviceId.equals(existing.getDeviceId())) {
                log.warn("[SyncService] 检测到 ProjectFile 时间冲突: id={}, serverTime={}, clientTime={}",
                    id, serverUpdatedAt, clientUpdatedAt);
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
        file.setCreatedAt(parseDateTime(record.get("createdAt")));
        file.setUpdatedAt(clientUpdatedAt);
        file.setSyncStatus("synced");
        file.setSyncedAt(LocalDateTime.now());
        file.setDeviceId(deviceId);

        if (existing == null) {
            // 新记录，版本号初始化为1
            file.setVersion(1);
            projectFileMapper.insert(file);
            log.debug("[SyncService] 插入新 ProjectFile: id={}, version=1", id);
        } else {
            // 更新记录，使用CAS（Compare-And-Swap）
            Integer expectedVersion = existing.getVersion() != null ? existing.getVersion() : 1;
            Integer newVersion = expectedVersion + 1;
            file.setVersion(newVersion);

            int updated = projectFileMapper.updateByIdAndVersion(id, expectedVersion, file);

            if (updated == 0) {
                // CAS更新失败，说明在此期间版本号被其他请求修改了
                log.warn("[SyncService] CAS更新失败，版本号已被修改: id={}, expectedVer={}", id, expectedVersion);
                return true;  // 返回冲突
            }

            log.debug("[SyncService] 更新 ProjectFile: id={}, version={}->{}", id, expectedVersion, newVersion);
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
     * 插入或更新 Conversation 记录
     */
    private boolean upsertConversation(Map<String, Object> record, String deviceId) {
        String id = (String) record.get("id");
        Conversation existing = conversationMapper.selectById(id);

        LocalDateTime clientUpdatedAt = parseDateTime(record.get("updatedAt"));

        // 检测冲突
        if (existing != null) {
            LocalDateTime serverUpdatedAt = existing.getUpdatedAt();
            if (serverUpdatedAt != null && clientUpdatedAt != null &&
                serverUpdatedAt.isAfter(clientUpdatedAt) &&
                !deviceId.equals(existing.getDeviceId())) {
                log.warn("[SyncService] 检测到 Conversation 冲突: id={}", id);
                return true;
            }
        }

        // 构建 Conversation 实体
        Conversation conversation = new Conversation();
        conversation.setId(id);
        conversation.setTitle((String) record.get("title"));
        conversation.setProjectId((String) record.get("projectId"));
        conversation.setUserId((String) record.get("userId"));
        conversation.setContextMode((String) record.get("contextMode"));
        conversation.setContextData((String) record.get("contextData"));
        conversation.setMessageCount(getInteger(record.get("messageCount")));
        conversation.setCreatedAt(parseDateTime(record.get("createdAt")));
        conversation.setUpdatedAt(clientUpdatedAt);
        conversation.setSyncStatus("synced");
        conversation.setSyncedAt(LocalDateTime.now());
        conversation.setDeviceId(deviceId);
        conversation.setDeleted(getInteger(record.get("deleted")));

        if (existing == null) {
            conversationMapper.insert(conversation);
            log.debug("[SyncService] 插入新 Conversation: id={}", id);
        } else {
            conversationMapper.updateById(conversation);
            log.debug("[SyncService] 更新 Conversation: id={}", id);
        }

        return false;
    }

    /**
     * 插入或更新 Message (ConversationMessage) 记录
     */
    private boolean upsertMessage(Map<String, Object> record, String deviceId) {
        String id = (String) record.get("id");
        ConversationMessage existing = conversationMessageMapper.selectById(id);

        // 消息一般不会更新，只插入
        if (existing != null) {
            log.debug("[SyncService] ConversationMessage 已存在，跳过: id={}", id);
            return false;
        }

        // 构建 ConversationMessage 实体
        ConversationMessage message = new ConversationMessage();
        message.setId(id);
        message.setConversationId((String) record.get("conversationId"));
        message.setRole((String) record.get("role"));
        message.setContent((String) record.get("content"));
        message.setMessageType((String) record.get("messageType"));
        message.setMetadata((String) record.get("metadata"));
        message.setCreatedAt(parseDateTime(record.get("createdAt")));
        message.setSyncStatus("synced");
        message.setSyncedAt(LocalDateTime.now());
        message.setDeviceId(deviceId);
        message.setDeleted(getInteger(record.get("deleted")));

        conversationMessageMapper.insert(message);
        log.debug("[SyncService] 插入新 ConversationMessage: id={}", id);

        return false;
    }

    /**
     * 插入或更新 KnowledgeItem 记录
     */
    private boolean upsertKnowledgeItem(Map<String, Object> record, String deviceId) {
        String id = (String) record.get("id");
        KnowledgeItem existing = knowledgeItemMapper.selectById(id);

        LocalDateTime clientUpdatedAt = parseDateTime(record.get("updatedAt"));

        // 检测冲突
        if (existing != null) {
            LocalDateTime serverUpdatedAt = existing.getUpdatedAt();
            if (serverUpdatedAt != null && clientUpdatedAt != null &&
                serverUpdatedAt.isAfter(clientUpdatedAt) &&
                !deviceId.equals(existing.getDeviceId())) {
                log.warn("[SyncService] 检测到 KnowledgeItem 冲突: id={}", id);
                return true;
            }
        }

        // 构建 KnowledgeItem 实体
        KnowledgeItem item = new KnowledgeItem();
        item.setId(id);
        item.setTitle((String) record.get("title"));
        item.setType((String) record.get("type"));
        item.setContent((String) record.get("content"));
        item.setContentPath((String) record.get("contentPath"));
        item.setEmbeddingPath((String) record.get("embeddingPath"));
        item.setUserId((String) record.get("userId"));
        item.setCreatedAt(parseDateTime(record.get("createdAt")));
        item.setUpdatedAt(clientUpdatedAt);
        item.setGitCommitHash((String) record.get("gitCommitHash"));
        item.setSyncStatus("synced");
        item.setSyncedAt(LocalDateTime.now());
        item.setDeviceId(deviceId);
        item.setDeleted(getInteger(record.get("deleted")));

        if (existing == null) {
            knowledgeItemMapper.insert(item);
            log.debug("[SyncService] 插入新 KnowledgeItem: id={}", id);
        } else {
            knowledgeItemMapper.updateById(item);
            log.debug("[SyncService] 更新 KnowledgeItem: id={}", id);
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

                case "conversations":
                    QueryWrapper<Conversation> conversationWrapper = new QueryWrapper<>();
                    conversationWrapper.eq("sync_status", "pending")
                                       .or()
                                       .isNull("sync_status");
                    return Math.toIntExact(conversationMapper.selectCount(conversationWrapper));

                case "messages":
                    QueryWrapper<ConversationMessage> messageWrapper = new QueryWrapper<>();
                    messageWrapper.eq("sync_status", "pending")
                                  .or()
                                  .isNull("sync_status");
                    return Math.toIntExact(conversationMessageMapper.selectCount(messageWrapper));

                case "knowledge_items":
                    QueryWrapper<KnowledgeItem> knowledgeWrapper = new QueryWrapper<>();
                    knowledgeWrapper.eq("sync_status", "pending")
                                    .or()
                                    .isNull("sync_status");
                    return Math.toIntExact(knowledgeItemMapper.selectCount(knowledgeWrapper));

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

    private Long toMillis(LocalDateTime dateTime) {
        if (dateTime == null) return null;
        return dateTime.atZone(ZoneId.systemDefault()).toInstant().toEpochMilli();
    }
}
