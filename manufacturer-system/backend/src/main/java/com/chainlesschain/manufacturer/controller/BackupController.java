package com.chainlesschain.manufacturer.controller;

import com.chainlesschain.manufacturer.common.Result;
import com.chainlesschain.manufacturer.dto.CreateBackupRequest;
import com.chainlesschain.manufacturer.dto.RestoreBackupRequest;
import com.chainlesschain.manufacturer.service.BackupService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import jakarta.validation.Valid;

/**
 * 数据备份恢复Controller
 */
@Tag(name = "数据备份恢复", description = "设备数据备份和恢复接口")
@RestController
@RequestMapping("/backup")
@RequiredArgsConstructor
public class BackupController {

    private final BackupService backupService;

    @Operation(summary = "创建备份")
    @PostMapping("/create")
    public Result<?> createBackup(@Valid @RequestBody CreateBackupRequest request) {
        return Result.success(backupService.createBackup(request));
    }

    @Operation(summary = "查询备份列表")
    @GetMapping("/list")
    public Result<?> listBackups(
            @RequestParam(required = false) String deviceId,
            @RequestParam(required = false) Long userId,
            @RequestParam(defaultValue = "1") Integer page,
            @RequestParam(defaultValue = "20") Integer size
    ) {
        return Result.success(backupService.listBackups(deviceId, userId, page, size));
    }

    @Operation(summary = "恢复数据")
    @PostMapping("/restore")
    public Result<?> restoreBackup(@Valid @RequestBody RestoreBackupRequest request) {
        return Result.success(backupService.restoreBackup(request));
    }

    @Operation(summary = "删除备份")
    @DeleteMapping("/{backupId}")
    public Result<?> deleteBackup(@PathVariable Long backupId) {
        backupService.deleteBackup(backupId);
        return Result.success("备份已删除");
    }
}
