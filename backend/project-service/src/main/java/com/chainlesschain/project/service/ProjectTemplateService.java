package com.chainlesschain.project.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.chainlesschain.project.entity.ProjectTemplate;
import com.chainlesschain.project.mapper.ProjectTemplateMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * 项目模板服务
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ProjectTemplateService {

    private final ProjectTemplateMapper templateMapper;

    /**
     * 获取所有模板列表
     */
    public List<ProjectTemplate> listTemplates() {
        log.info("获取模板列表");

        LambdaQueryWrapper<ProjectTemplate> wrapper = new LambdaQueryWrapper<>();
        wrapper.orderByDesc(ProjectTemplate::getIsBuiltin)
               .orderByDesc(ProjectTemplate::getUsageCount);

        List<ProjectTemplate> templates = templateMapper.selectList(wrapper);
        log.info("找到 {} 个模板", templates.size());

        return templates;
    }

    /**
     * 根据项目类型获取模板
     */
    public List<ProjectTemplate> listTemplatesByType(String projectType) {
        log.info("获取指定类型的模板: {}", projectType);

        LambdaQueryWrapper<ProjectTemplate> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(ProjectTemplate::getProjectType, projectType)
               .orderByDesc(ProjectTemplate::getIsBuiltin)
               .orderByDesc(ProjectTemplate::getUsageCount);

        return templateMapper.selectList(wrapper);
    }

    /**
     * 根据ID获取模板
     */
    public ProjectTemplate getTemplateById(String id) {
        log.info("获取模板详情: id={}", id);
        return templateMapper.selectById(id);
    }
}
