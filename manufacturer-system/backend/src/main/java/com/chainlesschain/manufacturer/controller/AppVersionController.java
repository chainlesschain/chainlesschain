package com.chainlesschain.manufacturer.controller;

import com.chainlesschain.manufacturer.common.Result;
import com.chainlesschain.manufacturer.dto.AppVersionCreateRequest;
import com.chainlesschain.manufacturer.dto.AppVersionUpdateRequest;
import com.chainlesschain.manufacturer.dto.CheckUpdateRequest;
import com.chainlesschain.manufacturer.service.AppVersionService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import jakarta.validation.Valid;

/**
 * APP版本管理Controller
 */
@Tag(name = "APP版本管理", description = "APP安装包上传、版本发布、更新检查等接口")
@RestController
@RequestMapping("/app-versions")
@RequiredArgsConstructor
public class AppVersionController {

    private final AppVersionService appVersionService;

    @Operation(summary = "上传APP安装包")
    @PostMapping("/upload")
    public Result<?> uploadApp(
            @RequestParam("file") MultipartFile file,
            @RequestParam("appType") String appType,
            @RequestParam("versionName") String versionName
    ) {
        return Result.success(appVersionService.uploadApp(file, appType, versionName));
    }

    @Operation(summary = "创建APP版本")
    @PostMapping("/create")
    public Result<?> createVersion(@Valid @RequestBody AppVersionCreateRequest request) {
        return Result.success(appVersionService.createVersion(request));
    }

    @Operation(summary = "更新APP版本信息")
    @PutMapping("/{versionId}")
    public Result<?> updateVersion(
            @PathVariable String versionId,
            @Valid @RequestBody AppVersionUpdateRequest request
    ) {
        return Result.success(appVersionService.updateVersion(versionId, request));
    }

    @Operation(summary = "发布APP版本")
    @PostMapping("/{versionId}/publish")
    public Result<?> publishVersion(@PathVariable String versionId) {
        appVersionService.publishVersion(versionId);
        return Result.success("版本已发布");
    }

    @Operation(summary = "废弃APP版本")
    @PostMapping("/{versionId}/deprecate")
    public Result<?> deprecateVersion(@PathVariable String versionId) {
        appVersionService.deprecateVersion(versionId);
        return Result.success("版本已废弃");
    }

    @Operation(summary = "查询APP版本列表")
    @GetMapping("/list")
    public Result<?> listVersions(
            @RequestParam(required = false) String appType,
            @RequestParam(required = false) String status,
            @RequestParam(defaultValue = "1") Integer page,
            @RequestParam(defaultValue = "20") Integer size
    ) {
        return Result.success(appVersionService.listVersions(appType, status, page, size));
    }

    @Operation(summary = "查询APP版本详情")
    @GetMapping("/{versionId}")
    public Result<?> getVersion(@PathVariable String versionId) {
        return Result.success(appVersionService.getVersionById(versionId));
    }

    @Operation(summary = "检查APP更新")
    @PostMapping("/check-update")
    public Result<?> checkUpdate(@Valid @RequestBody CheckUpdateRequest request) {
        return Result.success(appVersionService.checkUpdate(request));
    }

    @Operation(summary = "获取最新版本")
    @GetMapping("/latest")
    public Result<?> getLatestVersion(@RequestParam String appType) {
        return Result.success(appVersionService.getLatestVersion(appType));
    }

    @Operation(summary = "下载APP")
    @GetMapping("/download/{versionId}")
    public void downloadApp(
            @PathVariable String versionId,
            @RequestParam(required = false) String deviceId
    ) {
        appVersionService.downloadApp(versionId, deviceId);
    }

    @Operation(summary = "查询下载统计")
    @GetMapping("/statistics/downloads")
    public Result<?> getDownloadStatistics(
            @RequestParam(required = false) String versionId,
            @RequestParam(required = false) String startDate,
            @RequestParam(required = false) String endDate
    ) {
        return Result.success(appVersionService.getDownloadStatistics(versionId, startDate, endDate));
    }
}
