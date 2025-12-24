package com.chainlesschain.project.controller;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.chainlesschain.project.dto.ApiResponse;
import com.chainlesschain.project.dto.FileCreateRequest;
import com.chainlesschain.project.dto.FileUpdateRequest;
import com.chainlesschain.project.dto.ProjectFileDTO;
import com.chainlesschain.project.service.ProjectFileService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * 项目文件控制器
 */
@Slf4j
@RestController
@RequestMapping("/api/projects/{projectId}/files")
@RequiredArgsConstructor
public class ProjectFileController {

    private final ProjectFileService projectFileService;

    /**
     * 获取项目文件列表
     */
    @GetMapping
    public ApiResponse<Page<ProjectFileDTO>> listFiles(
            @PathVariable String projectId,
            @RequestParam(required = false) String fileType,
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "50") int pageSize) {
        try {
            Page<ProjectFileDTO> page = projectFileService.listFiles(projectId, fileType, pageNum, pageSize);
            return ApiResponse.success(page);
        } catch (Exception e) {
            log.error("获取文件列表失败", e);
            return ApiResponse.error(e.getMessage());
        }
    }

    /**
     * 获取单个文件详情（包含内容）
     */
    @GetMapping("/{fileId}")
    public ApiResponse<ProjectFileDTO> getFile(
            @PathVariable String projectId,
            @PathVariable String fileId) {
        try {
            ProjectFileDTO file = projectFileService.getFile(projectId, fileId);
            return ApiResponse.success(file);
        } catch (Exception e) {
            log.error("获取文件详情失败", e);
            return ApiResponse.error(e.getMessage());
        }
    }

    /**
     * 创建文件
     */
    @PostMapping
    public ApiResponse<ProjectFileDTO> createFile(
            @PathVariable String projectId,
            @Validated @RequestBody FileCreateRequest request) {
        try {
            ProjectFileDTO file = projectFileService.createFile(projectId, request);
            return ApiResponse.success("文件创建成功", file);
        } catch (Exception e) {
            log.error("创建文件失败", e);
            return ApiResponse.error(e.getMessage());
        }
    }

    /**
     * 批量创建文件
     */
    @PostMapping("/batch")
    public ApiResponse<List<ProjectFileDTO>> batchCreateFiles(
            @PathVariable String projectId,
            @RequestBody List<FileCreateRequest> files) {
        try {
            List<ProjectFileDTO> result = projectFileService.batchCreateFiles(projectId, files);
            return ApiResponse.success("批量创建文件成功", result);
        } catch (Exception e) {
            log.error("批量创建文件失败", e);
            return ApiResponse.error(e.getMessage());
        }
    }

    /**
     * 更新文件
     */
    @PutMapping("/{fileId}")
    public ApiResponse<ProjectFileDTO> updateFile(
            @PathVariable String projectId,
            @PathVariable String fileId,
            @Validated @RequestBody FileUpdateRequest request) {
        try {
            ProjectFileDTO file = projectFileService.updateFile(projectId, fileId, request);
            return ApiResponse.success("文件更新成功", file);
        } catch (Exception e) {
            log.error("更新文件失败", e);
            return ApiResponse.error(e.getMessage());
        }
    }

    /**
     * 删除文件
     */
    @DeleteMapping("/{fileId}")
    public ApiResponse<Void> deleteFile(
            @PathVariable String projectId,
            @PathVariable String fileId) {
        try {
            projectFileService.deleteFile(projectId, fileId);
            return ApiResponse.success("文件删除成功", null);
        } catch (Exception e) {
            log.error("删除文件失败", e);
            return ApiResponse.error(e.getMessage());
        }
    }

    /**
     * 搜索文件（全文搜索）
     */
    @GetMapping("/search")
    public ApiResponse<Page<ProjectFileDTO>> searchFiles(
            @PathVariable String projectId,
            @RequestParam String query,
            @RequestParam(required = false) String fileType,
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "20") int pageSize) {
        try {
            Page<ProjectFileDTO> page = projectFileService.searchFiles(projectId, query, fileType, pageNum, pageSize);
            return ApiResponse.success(page);
        } catch (Exception e) {
            log.error("搜索文件失败", e);
            return ApiResponse.error(e.getMessage());
        }
    }

    /**
     * 获取文件版本历史
     */
    @GetMapping("/{fileId}/versions")
    public ApiResponse<List<ProjectFileDTO>> getFileVersions(
            @PathVariable String projectId,
            @PathVariable String fileId,
            @RequestParam(defaultValue = "10") int limit) {
        try {
            List<ProjectFileDTO> versions = projectFileService.getFileVersions(projectId, fileId, limit);
            return ApiResponse.success(versions);
        } catch (Exception e) {
            log.error("获取文件版本历史失败", e);
            return ApiResponse.error(e.getMessage());
        }
    }

    /**
     * 恢复到指定版本
     */
    @PostMapping("/{fileId}/versions/{versionId}/restore")
    public ApiResponse<ProjectFileDTO> restoreFileVersion(
            @PathVariable String projectId,
            @PathVariable String fileId,
            @PathVariable String versionId) {
        try {
            ProjectFileDTO file = projectFileService.restoreFileVersion(projectId, fileId, versionId);
            return ApiResponse.success("文件版本恢复成功", file);
        } catch (Exception e) {
            log.error("恢复文件版本失败", e);
            return ApiResponse.error(e.getMessage());
        }
    }
}
