package com.chainlesschain.project.controller;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.chainlesschain.project.dto.*;
import com.chainlesschain.project.service.ProjectService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * 项目控制器
 */
@Slf4j
@RestController
@RequestMapping("/api/projects")
@RequiredArgsConstructor
public class ProjectController {

    private final ProjectService projectService;

    /**
     * 创建项目
     */
    @PostMapping("/create")
    public ApiResponse<ProjectResponse> createProject(@Validated @RequestBody ProjectCreateRequest request) {
        try {
            ProjectResponse response = projectService.createProject(request);
            return ApiResponse.success("项目创建成功", response);
        } catch (Exception e) {
            log.error("创建项目失败", e);
            return ApiResponse.error(e.getMessage());
        }
    }

    /**
     * 执行任务
     */
    @PostMapping("/tasks/execute")
    public ApiResponse<Map<String, Object>> executeTask(@Validated @RequestBody TaskExecuteRequest request) {
        try {
            Map<String, Object> result = projectService.executeTask(request);
            return ApiResponse.success("任务执行成功", result);
        } catch (Exception e) {
            log.error("执行任务失败", e);
            return ApiResponse.error(e.getMessage());
        }
    }

    /**
     * 获取项目详情
     */
    @GetMapping("/{projectId}")
    public ApiResponse<ProjectResponse> getProject(@PathVariable String projectId) {
        try {
            ProjectResponse response = projectService.getProject(projectId);
            return ApiResponse.success(response);
        } catch (Exception e) {
            log.error("获取项目详情失败", e);
            return ApiResponse.error(e.getMessage());
        }
    }

    /**
     * 获取项目列表
     */
    @GetMapping("/list")
    public ApiResponse<Page<ProjectResponse>> listProjects(
            @RequestParam(required = false) String userId,
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "10") int pageSize) {
        try {
            Page<ProjectResponse> page = projectService.listProjects(userId, pageNum, pageSize);
            return ApiResponse.success(page);
        } catch (Exception e) {
            log.error("获取项目列表失败", e);
            return ApiResponse.error(e.getMessage());
        }
    }

    /**
     * 删除项目
     */
    @DeleteMapping("/{projectId}")
    public ApiResponse<Void> deleteProject(@PathVariable String projectId) {
        try {
            projectService.deleteProject(projectId);
            return ApiResponse.success("项目删除成功", null);
        } catch (Exception e) {
            log.error("删除项目失败", e);
            return ApiResponse.error(e.getMessage());
        }
    }

    /**
     * 导出项目
     */
    @PostMapping("/{projectId}/export")
    public ApiResponse<Map<String, Object>> exportProject(
            @PathVariable String projectId,
            @RequestParam(defaultValue = "zip") String format,
            @RequestParam(defaultValue = "true") boolean includeHistory,
            @RequestParam(defaultValue = "true") boolean includeComments) {
        try {
            Map<String, Object> result = projectService.exportProject(projectId, format, includeHistory, includeComments);
            return ApiResponse.success("项目导出成功", result);
        } catch (Exception e) {
            log.error("导出项目失败", e);
            return ApiResponse.error(e.getMessage());
        }
    }

    /**
     * 导入项目
     */
    @PostMapping("/import")
    public ApiResponse<ProjectResponse> importProject(
            @RequestParam String filePath,
            @RequestParam(required = false) String projectName,
            @RequestParam(defaultValue = "false") boolean overwrite) {
        try {
            ProjectResponse response = projectService.importProject(filePath, projectName, overwrite);
            return ApiResponse.success("项目导入成功", response);
        } catch (Exception e) {
            log.error("导入项目失败", e);
            return ApiResponse.error(e.getMessage());
        }
    }

    /**
     * 健康检查
     */
    @GetMapping("/health")
    public ApiResponse<Map<String, Object>> health() {
        return ApiResponse.success(Map.of(
                "service", "project-service",
                "status", "running",
                "timestamp", System.currentTimeMillis()
        ));
    }
}
