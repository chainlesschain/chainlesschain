package com.chainlesschain.project.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.toolkit.IdWorker;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.chainlesschain.project.dto.FileCreateRequest;
import com.chainlesschain.project.dto.FileUpdateRequest;
import com.chainlesschain.project.dto.ProjectFileDTO;
import com.chainlesschain.project.entity.Project;
import com.chainlesschain.project.entity.ProjectFile;
import com.chainlesschain.project.mapper.ProjectFileMapper;
import com.chainlesschain.project.mapper.ProjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.BeanUtils;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.stream.Collectors;

/**
 * 项目文件服务
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ProjectFileService {

    private final ProjectFileMapper projectFileMapper;
    private final ProjectMapper projectMapper;

    /**
     * 获取项目文件列表
     */
    public Page<ProjectFileDTO> listFiles(String projectId, String fileType, int pageNum, int pageSize) {
        log.info("获取项目文件列表: projectId={}, fileType={}, page={}/{}", projectId, fileType, pageNum, pageSize);

        LambdaQueryWrapper<ProjectFile> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(ProjectFile::getProjectId, projectId);

        if (fileType != null && !fileType.trim().isEmpty()) {
            wrapper.eq(ProjectFile::getFileType, fileType);
        }

        wrapper.orderByDesc(ProjectFile::getUpdatedAt);

        Page<ProjectFile> page = new Page<>(pageNum, pageSize);
        Page<ProjectFile> result = projectFileMapper.selectPage(page, wrapper);

        // 转换为DTO（不包含content以减少数据量）
        Page<ProjectFileDTO> dtoPage = new Page<>(pageNum, pageSize);
        dtoPage.setTotal(result.getTotal());
        dtoPage.setRecords(result.getRecords().stream()
                .map(this::toDTO)
                .collect(Collectors.toList()));

        return dtoPage;
    }

    /**
     * 获取单个文件详情（包含内容）
     */
    public ProjectFileDTO getFile(String projectId, String fileId) {
        log.info("获取文件详情: projectId={}, fileId={}", projectId, fileId);

        LambdaQueryWrapper<ProjectFile> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(ProjectFile::getId, fileId)
                .eq(ProjectFile::getProjectId, projectId);

        ProjectFile file = projectFileMapper.selectOne(wrapper);
        if (file == null) {
            throw new RuntimeException("文件不存在: " + fileId);
        }

        ProjectFileDTO dto = toDTO(file);
        dto.setContent(file.getContent());  // 包含完整内容
        return dto;
    }

    /**
     * 创建文件
     */
    @Transactional
    public ProjectFileDTO createFile(String projectId, FileCreateRequest request) {
        log.info("创建文件: projectId={}, filePath={}", projectId, request.getFilePath());

        // 检查项目是否存在
        Project project = projectMapper.selectById(projectId);
        if (project == null) {
            throw new RuntimeException("项目不存在: " + projectId);
        }

        // 创建文件记录
        ProjectFile file = new ProjectFile();
        file.setId(IdWorker.get32UUID());
        file.setProjectId(projectId);
        file.setFilePath(request.getFilePath());
        file.setFileName(request.getFileName());
        file.setFileType(request.getFileType());
        file.setLanguage(request.getLanguage());
        file.setContent(request.getContent());
        file.setGeneratedBy(request.getGeneratedBy() != null ? request.getGeneratedBy() : "user");
        file.setVersion(1);

        // 计算文件大小
        if (request.getContent() != null) {
            long fileSize = request.getIsBase64()
                ? Base64.getDecoder().decode(request.getContent()).length
                : request.getContent().getBytes(StandardCharsets.UTF_8).length;
            file.setFileSize(fileSize);
        }

        projectFileMapper.insert(file);

        // 更新项目统计
        updateProjectStats(projectId);

        log.info("文件创建成功: fileId={}", file.getId());
        return toDTO(file);
    }

    /**
     * 批量创建文件
     */
    @Transactional
    public List<ProjectFileDTO> batchCreateFiles(String projectId, List<FileCreateRequest> files) {
        log.info("批量创建文件: projectId={}, count={}", projectId, files.size());

        List<ProjectFileDTO> result = new ArrayList<>();
        for (FileCreateRequest request : files) {
            try {
                ProjectFileDTO dto = createFile(projectId, request);
                result.add(dto);
            } catch (Exception e) {
                log.error("创建文件失败: {}", request.getFilePath(), e);
                // 继续处理其他文件
            }
        }

        return result;
    }

    /**
     * 更新文件
     */
    @Transactional
    public ProjectFileDTO updateFile(String projectId, String fileId, FileUpdateRequest request) {
        log.info("更新文件: projectId={}, fileId={}", projectId, fileId);

        // 查找文件
        LambdaQueryWrapper<ProjectFile> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(ProjectFile::getId, fileId)
                .eq(ProjectFile::getProjectId, projectId);

        ProjectFile file = projectFileMapper.selectOne(wrapper);
        if (file == null) {
            throw new RuntimeException("文件不存在: " + fileId);
        }

        // 更新内容
        if (request.getContent() != null) {
            file.setContent(request.getContent());

            // 重新计算文件大小
            long fileSize = request.getIsBase64()
                ? Base64.getDecoder().decode(request.getContent()).length
                : request.getContent().getBytes(StandardCharsets.UTF_8).length;
            file.setFileSize(fileSize);
        }

        // 版本号递增
        file.setVersion(file.getVersion() + 1);

        projectFileMapper.updateById(file);

        // 更新项目统计
        updateProjectStats(projectId);

        log.info("文件更新成功: fileId={}, newVersion={}", fileId, file.getVersion());
        return toDTO(file);
    }

    /**
     * 删除文件（软删除）
     */
    @Transactional
    public void deleteFile(String projectId, String fileId) {
        log.info("删除文件: projectId={}, fileId={}", projectId, fileId);

        LambdaQueryWrapper<ProjectFile> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(ProjectFile::getId, fileId)
                .eq(ProjectFile::getProjectId, projectId);

        ProjectFile file = projectFileMapper.selectOne(wrapper);
        if (file == null) {
            throw new RuntimeException("文件不存在: " + fileId);
        }

        projectFileMapper.deleteById(fileId);

        // 更新项目统计
        updateProjectStats(projectId);

        log.info("文件删除成功: fileId={}", fileId);
    }

    /**
     * 更新项目统计信息
     */
    private void updateProjectStats(String projectId) {
        LambdaQueryWrapper<ProjectFile> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(ProjectFile::getProjectId, projectId);

        List<ProjectFile> files = projectFileMapper.selectList(wrapper);

        long fileCount = files.size();
        long totalSize = files.stream()
                .mapToLong(f -> f.getFileSize() != null ? f.getFileSize() : 0L)
                .sum();

        Project project = projectMapper.selectById(projectId);
        if (project != null) {
            project.setFileCount(fileCount);
            project.setTotalSize(totalSize);
            projectMapper.updateById(project);
        }
    }

    /**
     * Entity转DTO（不包含content）
     */
    private ProjectFileDTO toDTO(ProjectFile file) {
        ProjectFileDTO dto = new ProjectFileDTO();
        BeanUtils.copyProperties(file, dto);
        // content需要显式设置，默认不返回
        return dto;
    }
}
