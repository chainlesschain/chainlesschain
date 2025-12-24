package com.chainlesschain.project.controller;

import com.chainlesschain.project.common.Result;
import com.chainlesschain.project.dto.ConflictResolutionDTO;
import com.chainlesschain.project.dto.SyncRequestDTO;
import com.chainlesschain.project.dto.SyncResponseDTO;
import com.chainlesschain.project.service.SyncService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * 数据同步控制器
 * 提供本地SQLite与后端PostgreSQL的数据同步API
 */
@Slf4j
@RestController
@RequestMapping("/api/sync")
@Tag(name = "数据同步", description = "多设备数据同步相关接口")
public class SyncController {

    @Autowired
    private SyncService syncService;

    /**
     * 批量上传数据
     *
     * @param request 同步请求
     * @return 上传结果
     */
    @PostMapping("/upload")
    @Operation(summary = "批量上传数据", description = "客户端批量上传本地变更的数据到服务器")
    public Result<Map<String, Object>> uploadBatch(@Validated @RequestBody SyncRequestDTO request) {
        log.info("[SyncController] 收到批量上传请求: table={}, deviceId={}, records={}",
            request.getTableName(), request.getDeviceId(), request.getRecords().size());

        try {
            Map<String, Object> result = syncService.uploadBatch(request);
            return Result.success(result);
        } catch (Exception e) {
            log.error("[SyncController] 批量上传失败: {}", e.getMessage(), e);
            return Result.error("批量上传失败: " + e.getMessage());
        }
    }

    /**
     * 增量下载数据
     *
     * @param tableName    表名
     * @param lastSyncedAt 最后同步时间戳（毫秒）
     * @param deviceId     设备ID
     * @return 增量数据
     */
    @GetMapping("/download/{tableName}")
    @Operation(summary = "增量下载数据", description = "下载服务器上最新的增量数据")
    public Result<SyncResponseDTO> downloadIncremental(
        @Parameter(description = "表名") @PathVariable String tableName,
        @Parameter(description = "最后同步时间戳（毫秒）") @RequestParam(required = false, defaultValue = "0") Long lastSyncedAt,
        @Parameter(description = "设备ID") @RequestParam String deviceId
    ) {
        log.info("[SyncController] 收到增量下载请求: table={}, lastSyncedAt={}, deviceId={}",
            tableName, lastSyncedAt, deviceId);

        try {
            SyncResponseDTO response = syncService.downloadIncremental(tableName, lastSyncedAt, deviceId);
            return Result.success(response);
        } catch (Exception e) {
            log.error("[SyncController] 增量下载失败: {}", e.getMessage(), e);
            return Result.error("增量下载失败: " + e.getMessage());
        }
    }

    /**
     * 获取同步状态
     *
     * @param deviceId 设备ID
     * @return 同步状态信息
     */
    @GetMapping("/status")
    @Operation(summary = "获取同步状态", description = "获取指定设备的同步状态和统计信息")
    public Result<Map<String, Object>> getSyncStatus(
        @Parameter(description = "设备ID") @RequestParam String deviceId
    ) {
        log.info("[SyncController] 收到同步状态查询: deviceId={}", deviceId);

        try {
            Map<String, Object> status = syncService.getSyncStatus(deviceId);
            return Result.success(status);
        } catch (Exception e) {
            log.error("[SyncController] 获取同步状态失败: {}", e.getMessage(), e);
            return Result.error("获取同步状态失败: " + e.getMessage());
        }
    }

    /**
     * 解决冲突
     *
     * @param resolution 冲突解决方案
     * @return 处理结果
     */
    @PostMapping("/resolve-conflict")
    @Operation(summary = "解决冲突", description = "提交冲突解决方案")
    public Result<Void> resolveConflict(@Validated @RequestBody ConflictResolutionDTO resolution) {
        log.info("[SyncController] 收到冲突解决请求: conflictId={}, resolution={}",
            resolution.getConflictId(), resolution.getResolution());

        try {
            syncService.resolveConflict(resolution);
            return Result.success(null, "冲突解决成功");
        } catch (Exception e) {
            log.error("[SyncController] 解决冲突失败: {}", e.getMessage(), e);
            return Result.error("解决冲突失败: " + e.getMessage());
        }
    }

    /**
     * 健康检查
     *
     * @return 服务状态
     */
    @GetMapping("/health")
    @Operation(summary = "健康检查", description = "检查同步服务是否正常运行")
    public Result<Map<String, Object>> health() {
        Map<String, Object> health = Map.of(
            "status", "UP",
            "timestamp", System.currentTimeMillis()
        );
        return Result.success(health);
    }
}
