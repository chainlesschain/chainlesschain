package com.chainlesschain.project.controller;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.chainlesschain.project.annotation.OperationLog;
import com.chainlesschain.project.service.OperationLogService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * 操作日志控制器
 */
@RestController
@RequestMapping("/api/logs")
@Tag(name = "操作日志", description = "操作日志查询和管理")
public class OperationLogController {

    @Autowired
    private OperationLogService operationLogService;

    /**
     * 获取操作日志列表
     */
    @GetMapping
    @PreAuthorize("hasRole('ADMIN')")
    @Operation(summary = "获取日志列表", description = "分页获取操作日志列表")
    public ResponseEntity<?> getLogList(
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize,
            @RequestParam(required = false) String userId,
            @RequestParam(required = false) String module,
            @RequestParam(required = false) String operationType,
            @RequestParam(required = false) String status) {
        try {
            Page<com.chainlesschain.project.entity.OperationLog> logPage =
                operationLogService.getLogList(page, pageSize, userId, module, operationType, status);

            return ResponseEntity.ok(Map.of(
                "records", logPage.getRecords(),
                "total", logPage.getTotal(),
                "page", logPage.getCurrent(),
                "pageSize", logPage.getSize(),
                "totalPages", logPage.getPages()
            ));
        } catch (Exception e) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * 获取日志详情
     */
    @GetMapping("/{logId}")
    @PreAuthorize("hasRole('ADMIN')")
    @Operation(summary = "获取日志详情", description = "根据ID获取操作日志详情")
    public ResponseEntity<?> getLogById(@PathVariable String logId) {
        try {
            com.chainlesschain.project.entity.OperationLog log =
                operationLogService.getLogById(logId);

            if (log == null) {
                return ResponseEntity.notFound().build();
            }

            return ResponseEntity.ok(log);
        } catch (Exception e) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * 删除日志
     */
    @DeleteMapping("/{logId}")
    @PreAuthorize("hasRole('ADMIN')")
    @OperationLog(module = "日志管理", type = OperationLog.OperationType.DELETE, description = "删除操作日志")
    @Operation(summary = "删除日志", description = "删除指定的操作日志")
    public ResponseEntity<?> deleteLog(@PathVariable String logId) {
        try {
            operationLogService.deleteLog(logId);
            return ResponseEntity.ok(Map.of("success", true, "message", "日志已删除"));
        } catch (Exception e) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * 批量删除日志
     */
    @DeleteMapping("/batch")
    @PreAuthorize("hasRole('ADMIN')")
    @OperationLog(module = "日志管理", type = OperationLog.OperationType.DELETE, description = "批量删除操作日志")
    @Operation(summary = "批量删除日志", description = "批量删除操作日志")
    public ResponseEntity<?> batchDeleteLogs(@RequestBody List<String> logIds) {
        try {
            operationLogService.batchDeleteLogs(logIds);
            return ResponseEntity.ok(Map.of("success", true, "message", "日志已批量删除"));
        } catch (Exception e) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", e.getMessage()));
        }
    }
}
