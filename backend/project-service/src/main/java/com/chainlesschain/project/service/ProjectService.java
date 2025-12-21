package com.chainlesschain.project.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.toolkit.IdWorker;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.chainlesschain.project.client.AiServiceClient;
import com.chainlesschain.project.dto.ProjectCreateRequest;
import com.chainlesschain.project.dto.ProjectResponse;
import com.chainlesschain.project.dto.TaskExecuteRequest;
import com.chainlesschain.project.entity.*;
import com.chainlesschain.project.mapper.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDateTime;
import java.util.*;
import java.util.stream.Collectors;

/**
 * 项目服务
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ProjectService {

    private final ProjectMapper projectMapper;
    private final ProjectFileMapper projectFileMapper;
    private final ProjectTaskMapper projectTaskMapper;
    private final ProjectConversationMapper projectConversationMapper;
    private final ProjectTemplateMapper projectTemplateMapper;
    private final AiServiceClient aiServiceClient;
    private final ObjectMapper objectMapper;

    @Value("${project.storage.root-path:/data/projects}")
    private String projectsRootPath;

    /**
     * 创建项目
     */
    @Transactional
    public ProjectResponse createProject(ProjectCreateRequest request) {
        log.info("开始创建项目: {}", request.getUserPrompt());

        long startTime = System.currentTimeMillis();

        try {
            // 1. 调用AI Service生成文件
            JsonNode aiResult = aiServiceClient.createProject(
                    request.getUserPrompt(),
                    request.getProjectType(),
                    request.getTemplateId()
            ).block();

            if (aiResult == null) {
                throw new RuntimeException("AI Service返回为空");
            }

            // 2. 解析AI返回结果
            String projectType = aiResult.path("project_type").asText("web");
            if (projectType == null || projectType.trim().isEmpty()) {
                projectType = "web";
            }
            JsonNode filesNode = aiResult.path("result").path("files");
            JsonNode metadataNode = aiResult.path("result").path("metadata");

            // 3. 创建项目记录
            String userId = request.getUserId();
            if (userId == null || userId.trim().isEmpty()) {
                userId = "local-user";
            }
            String projectId = IdWorker.get32UUID();
            String projectPath = Paths.get(projectsRootPath, projectId).toString();

            Project project = new Project();
            project.setId(projectId);
            project.setUserId(userId);
            project.setOwnerDid(userId);
            project.setName(request.getName() != null ? request.getName() : generateProjectName(request.getUserPrompt()));
            project.setDescription(request.getUserPrompt());
            project.setType(projectType);
            project.setProjectType(projectType);
            project.setStatus("active");
            project.setFolderPath(projectPath);
            project.setRootPath(projectPath);
            project.setTemplateId(request.getTemplateId());
            project.setFileCount(0L);
            project.setTotalSize(0L);

            if (metadataNode != null) {
                String metadata = metadataNode.toString();
                project.setMetadata(metadata);
                project.setMetadataJson(metadata);
            }

            projectMapper.insert(project);

            // 4. 创建项目目录
            createProjectDirectory(projectId);

            // 5. 保存文件到磁盘和数据库
            List<ProjectFile> savedFiles = new ArrayList<>();
            if (filesNode != null && filesNode.isArray()) {
                for (JsonNode fileNode : filesNode) {
                    ProjectFile projectFile = saveFile(projectId, projectPath, fileNode, projectType);
                    savedFiles.add(projectFile);
                }
            }

            // 6. 更新项目统计
            updateProjectStats(projectId);

            // 7. 记录任务
            ProjectTask task = new ProjectTask();
            task.setProjectId(projectId);
            task.setDescription(request.getUserPrompt());
            task.setTaskType("generate_file");
            task.setUserPrompt(request.getUserPrompt());
            task.setIntent(aiResult.path("intent").toString());
            task.setStatus("completed");
            task.setResult(aiResult.toString());
            task.setExecutionTimeMs((int) (System.currentTimeMillis() - startTime));
            projectTaskMapper.insert(task);

            // 8. 记录对话
            saveConversation(projectId, "user", request.getUserPrompt(), task.getId());
            saveConversation(projectId, "assistant", "项目创建成功，已生成 " + savedFiles.size() + " 个文件", task.getId());

            // 9. 返回结果
            return buildProjectResponse(project, savedFiles);

        } catch (Exception e) {
            log.error("创建项目失败", e);
            throw new RuntimeException("创建项目失败: " + e.getMessage());
        }
    }

    /**
     * 执行任务
     */
    @Transactional
    public Map<String, Object> executeTask(TaskExecuteRequest request) {
        log.info("执行项目任务: projectId={}, prompt={}", request.getProjectId(), request.getUserPrompt());

        long startTime = System.currentTimeMillis();

        try {
            // 1. 检查项目是否存在
            Project project = projectMapper.selectById(request.getProjectId());
            if (project == null) {
                throw new RuntimeException("项目不存在");
            }

            // 2. 调用AI Service
            JsonNode aiResult = aiServiceClient.executeTask(
                    request.getProjectId(),
                    request.getUserPrompt(),
                    request.getContext()
            ).block();

            if (aiResult == null) {
                throw new RuntimeException("AI Service返回为空");
            }

            // 3. 记录任务
            ProjectTask task = new ProjectTask();
            task.setProjectId(request.getProjectId());
            task.setDescription(request.getUserPrompt());
            task.setTaskType(aiResult.path("intent").path("action").asText("unknown"));
            task.setUserPrompt(request.getUserPrompt());
            task.setIntent(aiResult.path("intent").toString());
            task.setStatus("completed");
            task.setResult(aiResult.toString());
            task.setExecutionTimeMs((int) (System.currentTimeMillis() - startTime));
            projectTaskMapper.insert(task);

            // 4. 记录对话
            saveConversation(request.getProjectId(), "user", request.getUserPrompt(), task.getId());
            saveConversation(request.getProjectId(), "assistant", aiResult.path("message").asText("任务执行完成"), task.getId());

            // 5. 返回结果
            Map<String, Object> result = new HashMap<>();
            result.put("taskId", task.getId());
            result.put("status", task.getStatus());
            result.put("result", aiResult);
            return result;

        } catch (Exception e) {
            log.error("执行任务失败", e);
            throw new RuntimeException("执行任务失败: " + e.getMessage());
        }
    }

    /**
     * 获取项目详情
     */
    public ProjectResponse getProject(String projectId) {
        Project project = projectMapper.selectById(projectId);
        if (project == null) {
            throw new RuntimeException("项目不存在");
        }

        List<ProjectFile> files = projectFileMapper.selectList(
                new LambdaQueryWrapper<ProjectFile>()
                        .eq(ProjectFile::getProjectId, projectId)
                        .orderByDesc(ProjectFile::getUpdatedAt)
        );

        return buildProjectResponse(project, files);
    }

    /**
     * 获取项目列表
     */
    public Page<ProjectResponse> listProjects(String userId, int pageNum, int pageSize) {
        Page<Project> page = new Page<>(pageNum, pageSize);
        Page<Project> projectPage = projectMapper.selectPage(page,
                new LambdaQueryWrapper<Project>()
                        .eq(userId != null, Project::getUserId, userId)
                        .orderByDesc(Project::getUpdatedAt)
        );

        Page<ProjectResponse> responsePage = new Page<>(pageNum, pageSize);
        responsePage.setTotal(projectPage.getTotal());
        responsePage.setRecords(
                projectPage.getRecords().stream()
                        .map(project -> buildProjectResponse(project, null))
                        .collect(Collectors.toList())
        );

        return responsePage;
    }

    /**
     * 删除项目
     */
    @Transactional
    public void deleteProject(String projectId) {
        Project project = projectMapper.selectById(projectId);
        if (project == null) {
            throw new RuntimeException("项目不存在");
        }

        // 删除项目文件
        projectFileMapper.delete(new LambdaQueryWrapper<ProjectFile>()
                .eq(ProjectFile::getProjectId, projectId));

        // 删除项目记录
        projectMapper.deleteById(projectId);

        log.info("项目已删除: {}", projectId);
    }

    // ========== 辅助方法 ==========

    private String generateProjectName(String prompt) {
        // 简单生成项目名称
        return "项目_" + System.currentTimeMillis();
    }

    private String createProjectDirectory(String projectId) {
        try {
            Path projectPath = Paths.get(projectsRootPath, projectId);
            Files.createDirectories(projectPath);
            return projectPath.toString();
        } catch (Exception e) {
            throw new RuntimeException("创建项目目录失败: " + e.getMessage());
        }
    }

    private ProjectFile saveFile(String projectId, String projectPath, JsonNode fileNode, String engineType) {
        try {
            String filePath = fileNode.path("path").asText();
            String content = fileNode.path("content").asText();
            String contentEncoding = fileNode.path("content_encoding").asText();
            String fileType = fileNode.path("language").asText(fileNode.path("type").asText());

            byte[] contentBytes = null;
            if ("base64".equalsIgnoreCase(contentEncoding)) {
                try {
                    contentBytes = Base64.getDecoder().decode(content);
                } catch (IllegalArgumentException e) {
                    log.warn("Invalid base64 content for file {}: {}", filePath, e.getMessage());
                }
            }

            // 保存文件到磁盘
            Path fullPath = Paths.get(projectPath, filePath);
            Files.createDirectories(fullPath.getParent());

            if (fileNode.has("content")) {
                if (contentBytes != null) {
                    Files.write(fullPath, contentBytes);
                } else if (fileType.equals("word") || fileType.equals("pdf") || fileType.equals("excel") || fileType.equals("image")) {
                    // 二进制文件 - 假设content是base64或bytes
                    // 这里简化处理，实际需要根据具体情况解码
                    Files.write(fullPath, content.getBytes());
                } else {
                    // 文本文件
                    Files.writeString(fullPath, content);
                }
            }

            // 保存到数据库
            ProjectFile projectFile = new ProjectFile();
            projectFile.setProjectId(projectId);
            projectFile.setFilePath(filePath);
            projectFile.setFileName(new File(filePath).getName());
            projectFile.setFileType(fileType);
            projectFile.setLanguage(fileNode.path("language").asText());
            projectFile.setFileSize(contentBytes != null ? (long) contentBytes.length : (long) content.length());
            projectFile.setGeneratedBy(engineType + "_engine");
            projectFile.setVersion(1);

            projectFileMapper.insert(projectFile);
            return projectFile;

        } catch (Exception e) {
            log.error("保存文件失败: {}", e.getMessage());
            throw new RuntimeException("保存文件失败: " + e.getMessage());
        }
    }

    private void updateProjectStats(String projectId) {
        List<ProjectFile> files = projectFileMapper.selectList(
                new LambdaQueryWrapper<ProjectFile>()
                        .eq(ProjectFile::getProjectId, projectId)
        );

        long totalSize = files.stream()
                .mapToLong(f -> f.getFileSize() != null ? f.getFileSize() : 0)
                .sum();

        Project project = new Project();
        project.setId(projectId);
        project.setFileCount((long) files.size());
        project.setTotalSize(totalSize);
        projectMapper.updateById(project);
    }

    private void saveConversation(String projectId, String role, String content, String taskId) {
        ProjectConversation conversation = new ProjectConversation();
        conversation.setProjectId(projectId);
        conversation.setRole(role);
        conversation.setContent(content);
        conversation.setTaskId(taskId);
        projectConversationMapper.insert(conversation);
    }

    private ProjectResponse buildProjectResponse(Project project, List<ProjectFile> files) {
        ProjectResponse response = new ProjectResponse();
        BeanUtils.copyProperties(project, response);

        // 解析tags
        if (project.getTags() != null) {
            try {
                response.setTags(objectMapper.readValue(project.getTags(), List.class));
            } catch (Exception e) {
                response.setTags(new ArrayList<>());
            }
        }

        // 添加文件列表
        if (files != null) {
            response.setFiles(files.stream()
                    .map(file -> {
                        ProjectResponse.FileInfo fileInfo = new ProjectResponse.FileInfo();
                        fileInfo.setId(file.getId());
                        fileInfo.setFileName(file.getFileName());
                        fileInfo.setFilePath(file.getFilePath());
                        fileInfo.setFileType(file.getFileType());
                        fileInfo.setFileSize(file.getFileSize());
                        fileInfo.setUpdatedAt(file.getUpdatedAt());
                        return fileInfo;
                    })
                    .collect(Collectors.toList()));
        }

        return response;
    }
}
