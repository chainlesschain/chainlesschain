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

    /**
     * 导出项目
     */
    @Transactional(readOnly = true)
    public Map<String, Object> exportProject(String projectId, String format, boolean includeHistory, boolean includeComments) {
        log.info("开始导出项目: projectId={}, format={}", projectId, format);

        try {
            // 1. 检查项目是否存在
            Project project = projectMapper.selectById(projectId);
            if (project == null) {
                throw new RuntimeException("项目不存在");
            }

            // 2. 获取项目文件列表
            List<ProjectFile> files = projectFileMapper.selectList(
                    new LambdaQueryWrapper<ProjectFile>()
                            .eq(ProjectFile::getProjectId, projectId)
            );

            // 3. 创建导出目录
            String exportDir = Paths.get(projectsRootPath, "exports").toString();
            Files.createDirectories(Paths.get(exportDir));

            // 4. 生成压缩文件名
            String timestamp = String.valueOf(System.currentTimeMillis());
            String zipFileName = "project_" + projectId + "_" + timestamp + ".zip";
            String zipFilePath = Paths.get(exportDir, zipFileName).toString();

            // 5. 创建ZIP文件
            try (java.util.zip.ZipOutputStream zos = new java.util.zip.ZipOutputStream(
                    new java.io.FileOutputStream(zipFilePath))) {

                // 添加项目元数据
                addZipEntry(zos, "project.json", buildProjectMetadata(project, includeHistory, includeComments));

                // 添加所有文件
                for (ProjectFile file : files) {
                    Path sourcePath = Paths.get(project.getRootPath(), file.getFilePath());
                    if (Files.exists(sourcePath)) {
                        addFileToZip(zos, file.getFilePath(), sourcePath);
                    }
                }

                // 可选：添加对话历史
                if (includeHistory) {
                    List<ProjectConversation> conversations = projectConversationMapper.selectList(
                            new LambdaQueryWrapper<ProjectConversation>()
                                    .eq(ProjectConversation::getProjectId, projectId)
                    );
                    addZipEntry(zos, "history.json", objectMapper.writeValueAsString(conversations));
                }
            }

            // 6. 返回结果
            Map<String, Object> result = new HashMap<>();
            result.put("downloadPath", zipFilePath);
            result.put("fileName", zipFileName);
            result.put("fileSize", Files.size(Paths.get(zipFilePath)));
            result.put("format", format);
            result.put("timestamp", timestamp);

            log.info("项目导出成功: {}", zipFilePath);
            return result;

        } catch (Exception e) {
            log.error("导出项目失败", e);
            throw new RuntimeException("导出项目失败: " + e.getMessage());
        }
    }

    /**
     * 导入项目
     */
    @Transactional
    public ProjectResponse importProject(String zipFilePath, String projectName, boolean overwrite) {
        log.info("开始导入项目: filePath={}, projectName={}", zipFilePath, projectName);

        try {
            // 1. 验证ZIP文件
            Path zipPath = Paths.get(zipFilePath);
            if (!Files.exists(zipPath)) {
                throw new RuntimeException("导入文件不存在: " + zipFilePath);
            }

            // 2. 解压ZIP到临时目录
            String tempDir = Paths.get(projectsRootPath, "temp", "import_" + System.currentTimeMillis()).toString();
            Files.createDirectories(Paths.get(tempDir));

            unzipFile(zipFilePath, tempDir);

            // 3. 读取项目元数据
            String metadataPath = Paths.get(tempDir, "project.json").toString();
            if (!Files.exists(Paths.get(metadataPath))) {
                throw new RuntimeException("导入文件格式错误：缺少project.json");
            }

            String metadataJson = Files.readString(Paths.get(metadataPath));
            Map<String, Object> metadata = objectMapper.readValue(metadataJson, Map.class);

            // 4. 创建新项目
            String newProjectId = IdWorker.get32UUID();
            String newProjectPath = Paths.get(projectsRootPath, newProjectId).toString();

            Project project = new Project();
            project.setId(newProjectId);
            project.setUserId((String) metadata.getOrDefault("userId", "local-user"));
            project.setOwnerDid((String) metadata.getOrDefault("ownerDid", "local-user"));
            project.setName(projectName != null ? projectName : (String) metadata.get("name"));
            project.setDescription((String) metadata.get("description"));
            project.setType((String) metadata.getOrDefault("type", "web"));
            project.setProjectType((String) metadata.getOrDefault("projectType", "web"));
            project.setStatus("active");
            project.setFolderPath(newProjectPath);
            project.setRootPath(newProjectPath);
            project.setFileCount(0L);
            project.setTotalSize(0L);

            projectMapper.insert(project);

            // 5. 创建项目目录
            Files.createDirectories(Paths.get(newProjectPath));

            // 6. 导入文件
            List<ProjectFile> importedFiles = new ArrayList<>();
            List<Map<String, Object>> filesMetadata = (List<Map<String, Object>>) metadata.get("files");

            if (filesMetadata != null) {
                for (Map<String, Object> fileMetadata : filesMetadata) {
                    String filePath = (String) fileMetadata.get("filePath");
                    String sourceFile = Paths.get(tempDir, filePath).toString();
                    String targetFile = Paths.get(newProjectPath, filePath).toString();

                    // 复制文件
                    if (Files.exists(Paths.get(sourceFile))) {
                        Files.createDirectories(Paths.get(targetFile).getParent());
                        Files.copy(Paths.get(sourceFile), Paths.get(targetFile));

                        // 创建文件记录
                        ProjectFile projectFile = new ProjectFile();
                        projectFile.setProjectId(newProjectId);
                        projectFile.setFilePath(filePath);
                        projectFile.setFileName((String) fileMetadata.get("fileName"));
                        projectFile.setFileType((String) fileMetadata.getOrDefault("fileType", "text"));
                        projectFile.setFileSize(Files.size(Paths.get(targetFile)));
                        projectFile.setVersion(1);

                        projectFileMapper.insert(projectFile);
                        importedFiles.add(projectFile);
                    }
                }
            }

            // 7. 更新项目统计
            updateProjectStats(newProjectId);

            // 8. 清理临时目录
            deleteDirectory(new File(tempDir));

            log.info("项目导入成功: {}", newProjectId);
            return buildProjectResponse(project, importedFiles);

        } catch (Exception e) {
            log.error("导入项目失败", e);
            throw new RuntimeException("导入项目失败: " + e.getMessage());
        }
    }

    // ========== ZIP辅助方法 ==========

    private void addZipEntry(java.util.zip.ZipOutputStream zos, String entryName, String content) throws Exception {
        zos.putNextEntry(new java.util.zip.ZipEntry(entryName));
        zos.write(content.getBytes());
        zos.closeEntry();
    }

    private void addFileToZip(java.util.zip.ZipOutputStream zos, String entryName, Path sourceFile) throws Exception {
        zos.putNextEntry(new java.util.zip.ZipEntry(entryName));
        Files.copy(sourceFile, zos);
        zos.closeEntry();
    }

    private String buildProjectMetadata(Project project, boolean includeHistory, boolean includeComments) throws Exception {
        Map<String, Object> metadata = new HashMap<>();
        metadata.put("projectId", project.getId());
        metadata.put("userId", project.getUserId());
        metadata.put("ownerDid", project.getOwnerDid());
        metadata.put("name", project.getName());
        metadata.put("description", project.getDescription());
        metadata.put("type", project.getType());
        metadata.put("projectType", project.getProjectType());
        metadata.put("status", project.getStatus());
        metadata.put("exportTime", LocalDateTime.now().toString());

        // 添加文件列表元数据
        List<ProjectFile> files = projectFileMapper.selectList(
                new LambdaQueryWrapper<ProjectFile>()
                        .eq(ProjectFile::getProjectId, project.getId())
        );

        List<Map<String, Object>> filesMetadata = new ArrayList<>();
        for (ProjectFile file : files) {
            Map<String, Object> fileMetadata = new HashMap<>();
            fileMetadata.put("filePath", file.getFilePath());
            fileMetadata.put("fileName", file.getFileName());
            fileMetadata.put("fileType", file.getFileType());
            fileMetadata.put("fileSize", file.getFileSize());
            filesMetadata.add(fileMetadata);
        }
        metadata.put("files", filesMetadata);

        return objectMapper.writeValueAsString(metadata);
    }

    private void unzipFile(String zipFilePath, String destDir) throws Exception {
        try (java.util.zip.ZipInputStream zis = new java.util.zip.ZipInputStream(
                new java.io.FileInputStream(zipFilePath))) {

            java.util.zip.ZipEntry entry;
            while ((entry = zis.getNextEntry()) != null) {
                Path filePath = Paths.get(destDir, entry.getName());

                if (entry.isDirectory()) {
                    Files.createDirectories(filePath);
                } else {
                    Files.createDirectories(filePath.getParent());
                    Files.copy(zis, filePath);
                }
                zis.closeEntry();
            }
        }
    }

    private void deleteDirectory(File directory) {
        if (directory.exists()) {
            File[] files = directory.listFiles();
            if (files != null) {
                for (File file : files) {
                    if (file.isDirectory()) {
                        deleteDirectory(file);
                    } else {
                        file.delete();
                    }
                }
            }
            directory.delete();
        }
    }
}
