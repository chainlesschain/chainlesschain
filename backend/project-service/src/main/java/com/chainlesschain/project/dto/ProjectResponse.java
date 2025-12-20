package com.chainlesschain.project.dto;

import lombok.Data;
import java.time.LocalDateTime;
import java.util.List;

/**
 * 项目响应DTO
 */
@Data
public class ProjectResponse {

    private String id;

    private String userId;

    private String name;

    private String description;

    private String projectType;

    private String status;

    private String rootPath;

    private Long fileCount;

    private Long totalSize;

    private String templateId;

    private String coverImageUrl;

    private List<String> tags;

    private LocalDateTime createdAt;

    private LocalDateTime updatedAt;

    private List<FileInfo> files;  // 文件列表

    @Data
    public static class FileInfo {
        private String id;
        private String fileName;
        private String filePath;
        private String fileType;
        private Long fileSize;
        private LocalDateTime updatedAt;
    }
}
