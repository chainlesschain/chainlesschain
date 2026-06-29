package com.chainlesschain.project.service;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.chainlesschain.project.entity.OperationLog;
import com.chainlesschain.project.mapper.OperationLogMapper;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

/**
 * 操作日志服务
 */
@Service
public class OperationLogService {

    private static final Logger log = LoggerFactory.getLogger(OperationLogService.class);

    @Autowired
    private OperationLogMapper operationLogMapper;

    /**
     * Audit MTC double-track bridge (Q-ENG-2). Optional — when audit.mtc.enabled
     * is false (default) this is a no-op layer.
     */
    @Autowired(required = false)
    private AuditMtcBridgeService auditMtcBridge;

    /**
     * After Spring DI: register the bridge's emit callback so when the CLI
     * returns an event_id, we write it back into OperationLog.details as
     * audit_mtc_event_id. The UI uses that id with `cc audit mtc
     * reconcile-check` to render a per-row "待批次关闭" / "已关批 #N" badge.
     */
    @PostConstruct
    void wireBridgeCallback() {
        if (auditMtcBridge != null) {
            auditMtcBridge.setEmitCallback(this::onAuditMtcEmitted);
        }
    }

    private void onAuditMtcEmitted(OperationLog opLog, String eventId, String stagingPath) {
        if (eventId == null || opLog == null || opLog.getId() == null) return;
        try {
            // Persist event_id back onto the row via dedicated column added in V013.
            // Path is informational only and isn't stored — UI reconstructs from
            // event_id via `cc audit mtc reconcile-check`.
            opLog.setAuditMtcEventId(eventId);
            operationLogMapper.updateById(opLog);
            if (stagingPath != null && log.isDebugEnabled()) {
                log.debug("audit-mtc emit linked log {} → event {} (staging: {})",
                    opLog.getId(), eventId, stagingPath);
            }
        } catch (Exception ex) {
            log.warn("audit-mtc emit callback failed to persist event_id for log {}: {}",
                opLog.getId(), ex.getMessage());
        }
    }

    /**
     * 异步保存操作日志
     */
    @Async
    public void saveLog(OperationLog log) {
        try {
            operationLogMapper.insert(log);
        } catch (Exception e) {
            // 日志保存失败不影响主流程，但必须可见 —— 之前 e.printStackTrace() 只落
            // stderr、不进结构化日志，审计日志被丢弃时无从察觉。注意方法参数名 `log`
            // (OperationLog) 遮蔽了类的 static logger，故显式限定 OperationLogService.log。
            OperationLogService.log.error("Failed to persist operation log {}: {}",
                log.getId(), e.getMessage(), e);
        }

        // Q-ENG-2 audit MTC double-track bridge — fire-and-forget. Wrapped in
        // its own try/catch so a bridge failure can never affect the primary
        // (PostgreSQL) audit log path.
        if (auditMtcBridge != null) {
            try {
                auditMtcBridge.emitForOperationLog(log);
            } catch (Exception ex) {
                // shouldn't reach here — bridge already guards internally —
                // but defensively never throw past saveLog. Log via the (shadowed,
                // hence qualified) class logger, not stderr.
                OperationLogService.log.error("audit-mtc bridge emit failed for log {}: {}",
                    log.getId(), ex.getMessage(), ex);
            }
        }
    }

    /**
     * 查询操作日志（分页）
     */
    public Page<OperationLog> getLogList(int page, int pageSize,
                                         String userId, String module,
                                         String operationType, String status) {
        Page<OperationLog> logPage = new Page<>(page, pageSize);
        QueryWrapper<OperationLog> queryWrapper = new QueryWrapper<>();

        if (userId != null && !userId.isEmpty()) {
            queryWrapper.eq("user_id", userId);
        }

        if (module != null && !module.isEmpty()) {
            queryWrapper.eq("module", module);
        }

        if (operationType != null && !operationType.isEmpty()) {
            queryWrapper.eq("operation_type", operationType);
        }

        if (status != null && !status.isEmpty()) {
            queryWrapper.eq("status", status);
        }

        queryWrapper.orderByDesc("created_at");

        return operationLogMapper.selectPage(logPage, queryWrapper);
    }

    /**
     * 根据ID获取日志详情
     */
    public OperationLog getLogById(String logId) {
        return operationLogMapper.selectById(logId);
    }

    /**
     * 删除日志（物理删除）
     */
    public void deleteLog(String logId) {
        operationLogMapper.deleteById(logId);
    }

    /**
     * 批量删除日志
     */
    public void batchDeleteLogs(java.util.List<String> logIds) {
        operationLogMapper.deleteBatchIds(logIds);
    }
}
