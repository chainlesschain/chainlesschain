package com.chainlesschain.project.controller;

import com.chainlesschain.project.dto.ApiResponse;
import com.chainlesschain.project.entity.ProjectTemplate;
import com.chainlesschain.project.service.ProjectTemplateService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * 项目模板控制器
 */
@Slf4j
@RestController
@RequestMapping("/api")
@RequiredArgsConstructor
public class TemplateController {

    private final ProjectTemplateService templateService;

    /**
     * 获取所有模板列表
     */
    @GetMapping("/templates")
    public ApiResponse<List<ProjectTemplate>> listTemplates(
            @RequestParam(required = false) String projectType) {
        try {
            List<ProjectTemplate> templates;
            if (projectType != null && !projectType.trim().isEmpty()) {
                templates = templateService.listTemplatesByType(projectType);
            } else {
                templates = templateService.listTemplates();
            }
            return ApiResponse.success(templates);
        } catch (Exception e) {
            log.error("获取模板列表失败", e);
            return ApiResponse.error(e.getMessage());
        }
    }

    /**
     * 根据ID获取模板详情
     */
    @GetMapping("/templates/{id}")
    public ApiResponse<ProjectTemplate> getTemplate(@PathVariable String id) {
        try {
            ProjectTemplate template = templateService.getTemplateById(id);
            if (template == null) {
                return ApiResponse.error("模板不存在");
            }
            return ApiResponse.success(template);
        } catch (Exception e) {
            log.error("获取模板详情失败", e);
            return ApiResponse.error(e.getMessage());
        }
    }
}
