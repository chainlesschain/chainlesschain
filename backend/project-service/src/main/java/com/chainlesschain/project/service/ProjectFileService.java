package com.chainlesschain.project.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.toolkit.IdWorker;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.chainlesschain.project.dto.FileCreateRequest;
import com.chainlesschain.project.dto.FileUpdateRequest;
import com.chainlesschain.project.dto.ProjectFileDTO;
import com.chainlesschain.project.entity.FileVersion;
import com.chainlesschain.project.entity.Project;
import com.chainlesschain.project.entity.ProjectFile;
import com.chainlesschain.project.mapper.FileVersionMapper;
import com.chainlesschain.project.mapper.ProjectFileMapper;
import com.chainlesschain.project.mapper.ProjectMapper;
import lombok.RequiredArgsConstructor;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
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
    private final FileVersionMapper fileVersionMapper;

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

        // 保存初始版本到版本历史
        saveFileVersion(file, request.getGeneratedBy() != null ? request.getGeneratedBy() : "user", "Initial version");

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

        // 保存新版本到版本历史
        String createdBy = request.getGeneratedBy() != null ? request.getGeneratedBy() : "user";
        String message = request.getVersionMessage() != null ? request.getVersionMessage() : "Updated file";
        saveFileVersion(file, createdBy, message);

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
     * 搜索文件（全文搜索）
     */
    public Page<ProjectFileDTO> searchFiles(String projectId, String query, String fileType, int pageNum, int pageSize) {
        log.info("搜索文件: projectId={}, query={}, fileType={}", projectId, query, fileType);

        LambdaQueryWrapper<ProjectFile> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(ProjectFile::getProjectId, projectId);

        // 文件名搜索或内容搜索
        wrapper.and(w -> w
            .like(ProjectFile::getFileName, query)
            .or()
            .like(ProjectFile::getFilePath, query)
            .or()
            .like(ProjectFile::getContent, query)
        );

        // 文件类型过滤
        if (fileType != null && !fileType.trim().isEmpty()) {
            wrapper.eq(ProjectFile::getFileType, fileType);
        }

        wrapper.orderByDesc(ProjectFile::getUpdatedAt);

        Page<ProjectFile> page = new Page<>(pageNum, pageSize);
        Page<ProjectFile> result = projectFileMapper.selectPage(page, wrapper);

        // 转换为DTO
        Page<ProjectFileDTO> dtoPage = new Page<>(pageNum, pageSize);
        dtoPage.setTotal(result.getTotal());
        dtoPage.setRecords(result.getRecords().stream()
                .map(file -> {
                    ProjectFileDTO dto = toDTO(file);
                    // 搜索结果包含内容摘要（前200字符）
                    if (file.getContent() != null && file.getContent().length() > 200) {
                        dto.setContent(file.getContent().substring(0, 200) + "...");
                    } else {
                        dto.setContent(file.getContent());
                    }
                    return dto;
                })
                .collect(Collectors.toList()));

        return dtoPage;
    }

    /**
     * 获取文件版本历史
     * 从 file_versions 表查询完整的版本历史记录
     */
    public List<ProjectFileDTO> getFileVersions(String projectId, String fileId, int limit) {
        log.info("获取文件版本历史: projectId={}, fileId={}, limit={}", projectId, fileId, limit);

        // 验证文件存在
        LambdaQueryWrapper<ProjectFile> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(ProjectFile::getId, fileId)
                .eq(ProjectFile::getProjectId, projectId);

        ProjectFile file = projectFileMapper.selectOne(wrapper);
        if (file == null) {
            throw new RuntimeException("文件不存在: " + fileId);
        }

        // 从 file_versions 表查询版本历史
        List<FileVersion> versions = fileVersionMapper.getVersionHistory(fileId, projectId, limit);

        // 转换为 DTO
        List<ProjectFileDTO> result = versions.stream()
                .map(version -> {
                    ProjectFileDTO dto = new ProjectFileDTO();
                    dto.setId(version.getId());
                    dto.setProjectId(version.getProjectId());
                    dto.setVersion(version.getVersion());
                    dto.setContent(version.getContent());
                    dto.setFileSize(version.getFileSize());
                    dto.setCommitHash(version.getCommitHash());
                    dto.setCreatedAt(version.getCreatedAt());
                    // 从原文件复制其他属性
                    dto.setFileName(file.getFileName());
                    dto.setFilePath(file.getFilePath());
                    dto.setFileType(file.getFileType());
                    dto.setLanguage(file.getLanguage());
                    return dto;
                })
                .collect(Collectors.toList());

        log.info("获取到 {} 个版本记录", result.size());
        return result;
    }

    /**
     * 恢复到指定版本
     * 从 file_versions 表获取指定版本并恢复文件内容
     */
    @Transactional
    public ProjectFileDTO restoreFileVersion(String projectId, String fileId, String versionId) {
        log.info("恢复文件版本: projectId={}, fileId={}, versionId={}", projectId, fileId, versionId);

        // 查找当前文件
        LambdaQueryWrapper<ProjectFile> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(ProjectFile::getId, fileId)
                .eq(ProjectFile::getProjectId, projectId);

        ProjectFile file = projectFileMapper.selectOne(wrapper);
        if (file == null) {
            throw new RuntimeException("文件不存在: " + fileId);
        }

        // 查找目标版本
        FileVersion targetVersion = fileVersionMapper.selectById(versionId);
        if (targetVersion == null) {
            throw new RuntimeException("版本不存在: " + versionId);
        }

        // 验证版本属于该文件
        if (!targetVersion.getFileId().equals(fileId)) {
            throw new RuntimeException("版本不属于该文件");
        }

        // 恢复文件内容
        file.setContent(targetVersion.getContent());
        file.setFileSize(targetVersion.getFileSize());
        file.setContentHash(targetVersion.getContentHash());
        file.setVersion(file.getVersion() + 1);

        projectFileMapper.updateById(file);

        // 保存恢复操作作为新版本
        saveFileVersion(file, "user", "Restored from version " + targetVersion.getVersion());

        log.info("文件版本恢复成功: fileId={}, restoredFromVersion={}, newVersion={}",
                fileId, targetVersion.getVersion(), file.getVersion());

        return toDTO(file);
    }

    /**
     * 保存文件版本到版本历史表
     */
    private void saveFileVersion(ProjectFile file, String createdBy, String message) {
        FileVersion version = new FileVersion();
        version.setId(IdWorker.get32UUID());
        version.setFileId(file.getId());
        version.setProjectId(file.getProjectId());
        version.setVersion(file.getVersion());
        version.setContent(file.getContent());
        version.setContentHash(calculateContentHash(file.getContent()));
        version.setFileSize(file.getFileSize());
        version.setCommitHash(file.getCommitHash());
        version.setCreatedBy(createdBy);
        version.setMessage(message);
        version.setDeviceId(file.getDeviceId());

        fileVersionMapper.insert(version);
        log.debug("保存文件版本: fileId={}, version={}", file.getId(), file.getVersion());
    }

    /**
     * 计算内容的 SHA-256 哈希值
     */
    private String calculateContentHash(String content) {
        if (content == null || content.isEmpty()) {
            return null;
        }
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(content.getBytes(StandardCharsets.UTF_8));
            StringBuilder hexString = new StringBuilder();
            for (byte b : hash) {
                String hex = Integer.toHexString(0xff & b);
                if (hex.length() == 1) {
                    hexString.append('0');
                }
                hexString.append(hex);
            }
            return hexString.toString();
        } catch (NoSuchAlgorithmException e) {
            log.error("计算内容哈希失败", e);
            return null;
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
